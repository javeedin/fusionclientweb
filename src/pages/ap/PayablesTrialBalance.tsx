// Accounts Payables > Payables Trial Balance (Oracle style).
// Open ACCOUNTED liability per invoice as of a date, grouped by liability account
// and supplier, compared with the posted GL balance of each liability account.
// Pending (not yet accounted) invoices, payments and prepayment applications are
// listed separately: they are in neither the trial balance nor GL until posted.
// Data: GET reerp/ap/reports/trial-balance (database/ap/rr_ap_payables_trial_balance.sql)
import { useCallback, useEffect, useMemo, useState } from 'react';
import dayjs, { Dayjs } from 'dayjs';
import {
  Card, Form, Select, Button, Table, Tag, Statistic, Row, Col, Space, Typography,
  Alert, Tooltip, Input, Tabs, DatePicker, Popover,
} from 'antd';
import {
  SearchOutlined, DownloadOutlined, ApiOutlined, CheckCircleOutlined, WarningOutlined,
  ReconciliationOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import * as XLSX from 'xlsx';
import { APEX_DB_CONFIG } from '../../config/api.config';

const { Text, Title } = Typography;

const REDWOOD = {
  primary: '#C74634', success: '#1D7B4D', info: '#0572CE', warning: '#A86C00',
  neutral100: '#F8F8F8', neutral200: '#E0E0E0', neutral600: '#6B6B6B',
};

interface AccountRow {
  account: string; tb_total: number; gl_balance: number; difference: number;
  invoice_count: number; supplier_count: number;
}
interface InvoiceRow {
  account: string; supplier_number: string; supplier_name: string;
  invoice_id: number; invoice_number: string; invoice_type: string | null;
  invoice_date: string | null; accounting_date: string | null;
  currency: string; rate: number;
  invoice_amount: number; paid_amount: number; prepaid_amount: number;
  open_entered: number; open_functional: number; synced: boolean;
}
interface PendingRow {
  type: 'INVOICE' | 'PAYMENT' | 'PREPAYMENT_APPLICATION'; id: number; number: string;
  supplier_number: string | null; supplier_name: string | null; doc_date: string | null;
  currency: string; amount_functional: number; effect: number;
}
interface TbResponse {
  success: string | boolean; error?: string; asOfDate: string; businessUnit: string | null;
  totals: { tb_total: number; gl_balance: number; difference: number; unaccounted_effect: number };
  accounts: AccountRow[]; invoices: InvoiceRow[]; unaccounted: PendingRow[];
}
interface SupplierRow {
  key: string; account: string; supplier_number: string; supplier_name: string;
  invoice_count: number; open_functional: number;
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
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<TbResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [apiUrl, setApiUrl] = useState('');
  const [tab, setTab] = useState('summary');
  const [invSearch, setInvSearch] = useState('');
  const [drill, setDrill] = useState<{ account?: string; supplier?: string } | null>(null);

  useEffect(() => {
    fetch(`${APEX_DB_CONFIG.baseUrl}/gl/businessunits`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        const items: any[] = Array.isArray(d) ? d : (d?.items || []);
        setBusinessUnits(items.map(i => i.business_unit_name || '').filter(Boolean));
      })
      .catch(() => { /* BU list optional */ });
  }, []);

  const run = useCallback(async () => {
    const v = await form.validateFields();
    const p = new URLSearchParams({ P_AS_OF_DATE: (v.asOfDate as Dayjs).format('YYYY-MM-DD') });
    if (v.businessUnit) p.set('P_BUSINESS_UNIT', v.businessUnit);
    if (v.account?.trim()) p.set('P_LIABILITY_ACCOUNT', v.account.trim());
    if (v.supplier?.trim()) p.set('P_SUPPLIER_NUMBER', v.supplier.trim());
    if (v.currency) p.set('P_CURRENCY', v.currency);
    const url = `${APEX_DB_CONFIG.baseUrl}/ap/reports/trial-balance?${p}`;
    setApiUrl(url);
    setLoading(true); setError(null); setDrill(null); setInvSearch('');
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      const text = await res.text();
      if (!text.trim()) throw new Error(`Empty response (HTTP ${res.status}) — is the trial balance service deployed?`);
      const d = JSON.parse(text) as TbResponse;
      if (d.success === 'false' || d.success === false) throw new Error(d.error || 'Report failed');
      setData(d);
    } catch (e: any) {
      setData(null);
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [form]);

  // supplier summary is derived from the invoice-level rows
  const suppliers = useMemo<SupplierRow[]>(() => {
    const m = new Map<string, SupplierRow>();
    for (const r of data?.invoices || []) {
      const key = `${r.account}|${r.supplier_number}`;
      const s = m.get(key) || { key, account: r.account, supplier_number: r.supplier_number, supplier_name: r.supplier_name, invoice_count: 0, open_functional: 0 };
      s.invoice_count += 1;
      s.open_functional += Number(r.open_functional) || 0;
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

  const openInvoices = (account?: string, supplier?: string) => {
    setDrill({ account, supplier });
    setTab('invoices');
  };

  // ── columns ────────────────────────────────────────────────────────────────
  const accountCols: ColumnsType<AccountRow> = [
    { title: 'Liability Account', dataIndex: 'account', render: v => <Text code style={{ fontSize: 12 }}>{v}</Text> },
    { title: 'Suppliers', dataIndex: 'supplier_count', align: 'right', width: 100 },
    { title: 'Open Invoices', dataIndex: 'invoice_count', align: 'right', width: 120,
      render: (v, r) => (v ? <a onClick={() => openInvoices(r.account)}>{v}</a> : 0) },
    { title: 'Trial Balance (AED)', dataIndex: 'tb_total', align: 'right', width: 170, render: money },
    { title: 'GL Balance (AED)', dataIndex: 'gl_balance', align: 'right', width: 170, render: money },
    { title: 'Difference', dataIndex: 'difference', align: 'right', width: 170,
      render: (v: number) => (isZero(v)
        ? <Tag icon={<CheckCircleOutlined />} color="success">0.00</Tag>
        : <Tag icon={<WarningOutlined />} color="error">{fmt(v)}</Tag>) },
  ];

  const supplierCols: ColumnsType<SupplierRow> = [
    { title: 'Liability Account', dataIndex: 'account', width: 290, render: v => <Text code style={{ fontSize: 12 }}>{v}</Text> },
    { title: 'Supplier', dataIndex: 'supplier_name', sorter: (a, b) => a.supplier_name.localeCompare(b.supplier_name) },
    { title: 'Supplier #', dataIndex: 'supplier_number', width: 120 },
    { title: 'Open Invoices', dataIndex: 'invoice_count', align: 'right', width: 120,
      render: (v, r) => <a onClick={() => openInvoices(r.account, r.supplier_number)}>{v}</a> },
    { title: 'Open Balance (AED)', dataIndex: 'open_functional', align: 'right', width: 170,
      sorter: (a, b) => a.open_functional - b.open_functional, render: money },
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
    { title: 'Open (AED)', dataIndex: 'open_functional', align: 'right', width: 130, render: money,
      sorter: (a, b) => a.open_functional - b.open_functional },
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
      ['As of', data.asOfDate],
      ['Business Unit', data.businessUnit || 'All'],
      [],
    ];
    const summary = XLSX.utils.aoa_to_sheet([
      ...hdr,
      ['Liability Account', 'Suppliers', 'Open Invoices', 'Trial Balance (AED)', 'GL Balance (AED)', 'Difference'],
      ...data.accounts.map(a => [a.account, a.supplier_count, a.invoice_count, a.tb_total, a.gl_balance, a.difference]),
      ['TOTAL', '', '', data.totals.tb_total, data.totals.gl_balance, data.totals.difference],
    ]);
    XLSX.utils.book_append_sheet(wb, summary, 'Summary');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(suppliers.map(s => ({
      'Liability Account': s.account, Supplier: s.supplier_name, 'Supplier #': s.supplier_number,
      'Open Invoices': s.invoice_count, 'Open Balance (AED)': Math.round(s.open_functional * 100) / 100,
    }))), 'By Supplier');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.invoices.map(r => ({
      'Liability Account': r.account, Supplier: r.supplier_name, 'Supplier #': r.supplier_number,
      Invoice: r.invoice_number, Type: r.invoice_type, 'Invoice Date': r.invoice_date,
      'Accounting Date': r.accounting_date, Currency: r.currency, Rate: r.rate,
      'Invoice Amount': r.invoice_amount, Paid: r.paid_amount, Prepaid: r.prepaid_amount,
      'Open (Entered)': r.open_entered, 'Open (AED)': r.open_functional,
      Source: r.synced ? 'Oracle Fusion' : 'Re-ERP',
    }))), 'Invoices');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.unaccounted.map(u => ({
      Type: PENDING_LABEL[u.type] || u.type, Number: u.number, Supplier: u.supplier_name,
      'Supplier #': u.supplier_number, Date: u.doc_date, Currency: u.currency,
      'Amount (AED)': u.amount_functional, 'Effect once posted': u.effect,
    }))), 'Pending Accounting');
    XLSX.writeFile(wb, `Payables_Trial_Balance_${data.asOfDate}.xlsx`);
  };

  const t = data?.totals;
  const reconciled = t && isZero(t.difference);

  return (
    <div style={{ padding: 16, background: REDWOOD.neutral100, minHeight: '100%' }}>
      <Space align="center" style={{ marginBottom: 12 }}>
        <ReconciliationOutlined style={{ fontSize: 22, color: REDWOOD.primary }} />
        <Title level={4} style={{ margin: 0, color: REDWOOD.primary }}>Payables Trial Balance</Title>
        {apiUrl && (
          <Popover trigger="click" title="API" content={<Text copyable style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all', maxWidth: 520, display: 'block' }}>{apiUrl}</Text>}>
            <ApiOutlined style={{ color: REDWOOD.info, cursor: 'pointer' }} />
          </Popover>
        )}
      </Space>

      <Card size="small" style={{ marginBottom: 12 }}>
        <Form form={form} layout="inline" initialValues={{ asOfDate: dayjs() }} onFinish={run} style={{ rowGap: 8 }}>
          <Form.Item name="asOfDate" label="As of Date" rules={[{ required: true, message: 'Required' }]}>
            <DatePicker format="DD-MMM-YYYY" allowClear={false} />
          </Form.Item>
          <Form.Item name="businessUnit" label="Business Unit">
            <Select allowClear showSearch placeholder="All" style={{ width: 240 }}
              options={businessUnits.map(b => ({ value: b, label: b }))} />
          </Form.Item>
          <Form.Item name="account" label="Liability Account"
            tooltip="Full combination (01-00-00-2313101-…) or the natural account only (2313101)">
            <Input allowClear placeholder="e.g. 2313101" style={{ width: 200 }} />
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
          <Row gutter={12} style={{ marginBottom: 12 }}>
            <Col span={6}><Card size="small"><Statistic title="Trial Balance (AED)" value={t.tb_total} precision={2} /></Card></Col>
            <Col span={6}><Card size="small"><Statistic title="GL Balance (AED)" value={t.gl_balance} precision={2} /></Card></Col>
            <Col span={6}>
              <Card size="small">
                <Statistic title="Difference" value={t.difference} precision={2}
                  valueStyle={{ color: reconciled ? REDWOOD.success : REDWOOD.primary }}
                  prefix={reconciled ? <CheckCircleOutlined /> : <WarningOutlined />} />
              </Card>
            </Col>
            <Col span={6}>
              <Tooltip title="Invoices, payments and prepayment applications dated on or before the as-of date that have no posted GL journal yet. They are in neither the trial balance nor GL; posting them changes both by this amount.">
                <Card size="small" hoverable onClick={() => setTab('pending')}>
                  <Statistic title={`Pending accounting (${data.unaccounted.length})`} value={t.unaccounted_effect} precision={2}
                    valueStyle={{ color: data.unaccounted.length ? REDWOOD.warning : undefined }} />
                </Card>
              </Tooltip>
            </Col>
          </Row>

          <Card size="small" styles={{ body: { paddingTop: 0 } }}>
            <Tabs activeKey={tab} onChange={setTab} items={[
              {
                key: 'summary', label: 'Summary by Account',
                children: (
                  <Table<AccountRow> size="small" rowKey="account" columns={accountCols} dataSource={data.accounts}
                    pagination={false}
                    summary={() => (
                      <Table.Summary.Row style={{ fontWeight: 600, background: REDWOOD.neutral100 }}>
                        <Table.Summary.Cell index={0} colSpan={3}>Total</Table.Summary.Cell>
                        <Table.Summary.Cell index={3} align="right">{fmt(t.tb_total)}</Table.Summary.Cell>
                        <Table.Summary.Cell index={4} align="right">{fmt(t.gl_balance)}</Table.Summary.Cell>
                        <Table.Summary.Cell index={5} align="right">{fmt(t.difference)}</Table.Summary.Cell>
                      </Table.Summary.Row>
                    )} />
                ),
              },
              {
                key: 'suppliers', label: `By Supplier (${suppliers.length})`,
                children: (
                  <Table<SupplierRow> size="small" rowKey="key" columns={supplierCols} dataSource={suppliers}
                    pagination={{ pageSize: 50, showSizeChanger: false, showTotal: n => `${n} suppliers` }} />
                ),
              },
              {
                key: 'invoices', label: `Invoices (${data.invoices.length})`,
                children: (
                  <>
                    <Space style={{ marginBottom: 8 }} wrap>
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
                      scroll={{ x: 1800 }} pagination={{ pageSize: 50, showSizeChanger: false }} />
                  </>
                ),
              },
              {
                key: 'pending', label: `Pending Accounting (${data.unaccounted.length})`,
                children: (
                  <>
                    <Alert type="info" showIcon style={{ marginBottom: 8 }}
                      message="Not yet accounted — excluded from both the trial balance and GL"
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
    </div>
  );
}
