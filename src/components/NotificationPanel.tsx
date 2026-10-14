import React, { useState, useEffect, useCallback } from 'react';
import {
  Drawer, Button, Badge, Tag, Typography, Space, Tooltip, Empty, Spin, Tabs,
  Table, Select, Modal, Descriptions, Divider, Input, Alert, message,
} from 'antd';
import { useNavigate } from 'react-router-dom';
import {
  BellOutlined, CheckOutlined, DeleteOutlined, ReloadOutlined,
  WarningOutlined, InfoCircleOutlined, CloseCircleOutlined, ApiOutlined,
  CheckCircleOutlined, StopOutlined, EyeOutlined, ThunderboltOutlined, PoweroffOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { useNotifications, type AppNotification, type NotificationModule } from '../context/NotificationContext';
import { APEX_DB_CONFIG } from '../config/api.config';
import { poQuery, nlit } from '../services/po.service';
import AccountingLinesView, { type AccountingLine } from './AccountingLinesView';

const { Text } = Typography;

const MODULES: { label: string; value: 'All' | NotificationModule }[] = [
  { label: 'All',       value: 'All'       },
  { label: 'Approvals', value: 'Approvals' },
  { label: 'General',   value: 'General'   },
  { label: 'GL',        value: 'GL'        },
  { label: 'AP',        value: 'AP'        },
  { label: 'AR',        value: 'AR'        },
  { label: 'CM',        value: 'CM'        },
  { label: 'RM',        value: 'RM'        },
  { label: 'FA',        value: 'FA'        },
  { label: 'PMS',       value: 'PMS'       },
];

const SEVERITY_ICON: Record<string, React.ReactNode> = {
  error:   <CloseCircleOutlined style={{ color: '#C74634' }} />,
  warning: <WarningOutlined     style={{ color: '#D4A800' }} />,
  info:    <InfoCircleOutlined  style={{ color: '#0572CE' }} />,
};

const STATUS_COLOR: Record<string, string> = {
  Unread:   'red',
  Read:     'default',
  Actioned: 'green',
};

const MODULE_COLOR: Record<string, string> = {
  AP: 'purple', GL: 'blue', AR: 'cyan', CM: 'geekblue',
  RM: 'volcano', FA: 'orange', PMS: 'magenta', General: 'default',
  Approvals: 'gold',
};

// ── Process Monitor (Notifications → Processes tab) ─────────────────────────────
interface ProcRow {
  pid: number;
  type: string;
  name: string;
  cpu: number;
  memoryMB: number;
  isMain: boolean;
}

const TYPE_COLOR: Record<string, string> = {
  Browser: 'gold', Tab: 'blue', GPU: 'purple', Utility: 'cyan', 'Claude CLI': 'green',
};

type ProcApi = {
  listProcesses?: () => Promise<{ ok: boolean; mainPid?: number; items?: ProcRow[]; error?: string }>;
  killProcess?: (pid: number) => Promise<{ ok: boolean; error?: string }>;
};

const ProcessMonitor: React.FC<{ active: boolean }> = ({ active }) => {
  const api = (window as unknown as { electronAPI?: ProcApi }).electronAPI;
  const [items, setItems] = useState<ProcRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [killing, setKilling] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!api?.listProcesses) return;
    setLoading(true);
    try {
      const r = await api.listProcesses();
      setItems((r.items || []).slice().sort((a, b) => b.memoryMB - a.memoryMB));
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [api]);

  // poll only while this tab is open, so it never runs in the background
  useEffect(() => {
    if (!active || !api?.listProcesses) return;
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [active, api, load]);

  const confirmKill = (row: ProcRow) => {
    Modal.confirm({
      title: `Kill process ${row.pid}?`,
      content: `${row.type}${row.name ? ` · ${row.name}` : ''}. Terminating a window / GPU / utility process may reload or briefly disrupt part of the app.`,
      okText: 'Kill', okButtonProps: { danger: true },
      onOk: async () => {
        if (!api?.killProcess) return;
        setKilling(row.pid);
        try {
          const r = await api.killProcess(row.pid);
          if (r?.ok) message.success(`Killed PID ${row.pid}`);
          else message.error(r?.error || 'Could not kill process');
          setTimeout(load, 500);
        } finally { setKilling(null); }
      },
    });
  };

  if (!api?.listProcesses) {
    return (
      <div style={{ padding: 24 }}>
        <Empty description="Process monitor is only available in the desktop app" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      </div>
    );
  }

  const totalMem = items.reduce((sum, i) => sum + i.memoryMB, 0);
  const totalCpu = items.reduce((sum, i) => sum + i.cpu, 0);

  const columns: ColumnsType<ProcRow> = [
    {
      title: 'PID', dataIndex: 'pid', width: 90,
      render: (v: number, r) => (
        <Text style={{ fontSize: 11, fontFamily: 'monospace' }}>
          {v}{r.isMain && <Tag color="gold" style={{ marginLeft: 6, fontSize: 9 }}>main</Tag>}
        </Text>
      ),
    },
    { title: 'Type', dataIndex: 'type', width: 100, render: (v: string) => <Tag color={TYPE_COLOR[v] || 'default'} style={{ fontSize: 10 }}>{v}</Tag> },
    { title: 'Name', dataIndex: 'name', ellipsis: true, render: (v: string) => v ? <Text style={{ fontSize: 11 }}>{v}</Text> : <Text type="secondary" style={{ fontSize: 11 }}>—</Text> },
    {
      title: 'CPU %', dataIndex: 'cpu', width: 88, align: 'right', sorter: (a, b) => a.cpu - b.cpu,
      render: (v: number) => <Text style={{ fontSize: 11, fontFamily: 'monospace', color: v > 25 ? '#C74634' : undefined, fontWeight: v > 25 ? 600 : undefined }}>{v.toFixed(1)}</Text>,
    },
    {
      title: 'Memory', dataIndex: 'memoryMB', width: 104, align: 'right', defaultSortOrder: 'descend',
      sorter: (a, b) => a.memoryMB - b.memoryMB,
      render: (v: number) => <Text style={{ fontSize: 11, fontFamily: 'monospace' }}>{v.toLocaleString()} MB</Text>,
    },
    {
      title: '', key: 'act', width: 64,
      render: (_: unknown, r: ProcRow) => (
        <Tooltip title={r.isMain ? 'The main app process cannot be killed here' : 'Terminate this process'}>
          <Button size="small" danger icon={<PoweroffOutlined />} disabled={r.isMain} loading={killing === r.pid} onClick={() => confirmKill(r)} />
        </Tooltip>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <Tag icon={<ThunderboltOutlined />} color="purple" style={{ fontSize: 11 }}>{items.length} processes</Tag>
        <Tag style={{ fontSize: 11 }}>≈ {totalMem.toLocaleString()} MB</Tag>
        <Tag style={{ fontSize: 11 }}>CPU {totalCpu.toFixed(1)}%</Tag>
        <Text type="secondary" style={{ fontSize: 11 }}>Auto-refreshes every 3s</Text>
        <div style={{ marginLeft: 'auto' }}>
          <Button size="small" icon={<ReloadOutlined spin={loading} />} onClick={load}>Refresh</Button>
        </div>
      </div>
      <div style={{ background: '#fff', borderRadius: 8, border: '1px solid #E5E5E5', overflow: 'hidden' }}>
        <Table columns={columns} dataSource={items} rowKey="pid" size="small" pagination={false} loading={loading && items.length === 0} />
      </div>
      <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 8 }}>
        These are the processes that make up the running desktop app. High CPU or memory on a “Tab” (window) or “Utility”
        process points to a heavy screen; killing it reloads that part. The <b>main</b> process can’t be killed here
        (that would quit the app).
      </Text>
    </div>
  );
};

// ── Transaction Detail Modal ──────────────────────────────────────────────────
// The AP endpoints answer in snake_case, UPPER_CASE or PascalCase depending on the handler — read any of them.
const pick = (o: any, ...keys: string[]) => {
  if (!o || typeof o !== 'object') return undefined;
  for (const k of keys) {
    for (const v of [k, k.toUpperCase(), k.replace(/(^|_)(\w)/g, (_m, _u, c: string) => c.toUpperCase())]) {
      if (o[v] != null && o[v] !== '') return o[v];
    }
  }
  return undefined;
};
const itemsOf = (d: any): any[] => (Array.isArray(d?.items) ? d.items : Array.isArray(d) ? d : []);
const getJson = async (url: string) => {
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  return r.ok ? r.json().catch(() => null) : null;
};

/** Invoice header: the invoice search by number (matched on the id), then by id, then the single-invoice endpoint. */
async function loadApInvoiceHeader(invoiceId: number, invoiceNumber?: string): Promise<any | null> {
  const base = APEX_DB_CONFIG.baseUrl;
  const same = (r: any) => String(pick(r, 'invoice_id')) === String(invoiceId);
  if (invoiceNumber) {
    const hit = itemsOf(await getJson(`${base}/ap/createinvoice?invoice_number=${encodeURIComponent(invoiceNumber)}`).catch(() => null)).find(same);
    if (hit) return hit;
  }
  const byId = itemsOf(await getJson(`${base}/ap/createinvoice?invoice_id=${invoiceId}`).catch(() => null)).find(same);
  if (byId) return byId;
  const d = await getJson(`${base}/ap/createinvoice/${invoiceId}`).catch(() => null);
  const one = itemsOf(d)[0] || d?.header || d;
  return one && pick(one, 'invoice_number', 'invoice_num') ? one : null;
}

/** External transaction accounting: the GL journal when it is already posted (reference2 = transaction id),
 *  else the lines it will post — money in: Dr bank / Cr offset; money out: Dr offset / Cr bank. */
function cashAccountingLines(txn: any, gl: any[] | null, notif: AppNotification): { lines: AccountingLine[]; posted: boolean } {
  const ledgerCurrency = 'AED';
  if (gl && gl.length) {
    return {
      posted: true,
      lines: gl.map(l => {
        const dr = Number(pick(l, 'entered_dr') || 0), cr = Number(pick(l, 'entered_cr') || 0);
        const adr = Number(pick(l, 'accounted_dr') || 0), acr = Number(pick(l, 'accounted_cr') || 0);
        return {
          side: dr > 0 || adr > 0 ? 'DR' : 'CR', account: String(pick(l, 'account', 'account_combination', 'concatenated_segments') || ''),
          entered: dr || cr, accounted: adr || acr, currency: String(pick(l, 'currency_code') || txn?.currencyCode || ledgerCurrency),
          ledgerCurrency,
        } as AccountingLine;
      }),
    };
  }
  if (!txn) return { lines: [], posted: false };
  const amount = Math.abs(Number(txn.amount ?? notif.approvalAmount ?? 0));
  const rate = Number(txn.bankConversionRate) || 1;
  const currency = txn.currencyCode || notif.approvalCurrency || ledgerCurrency;
  const moneyIn = (txn.transactionDirection ?? (Number(txn.amount ?? 0) >= 0 ? 'DR' : 'CR')) === 'DR';
  const bank = { account: txn.assetAccountCombination || '', label: `Bank account${txn.bankAccountName ? ` — ${txn.bankAccountName}` : ''}` };
  const offset = { account: txn.offsetAccountCombination || '', label: `Offset account${txn.transactionType ? ` — ${txn.transactionType}` : ''}` };
  const line = (side: 'DR' | 'CR', a: { account: string; label: string }): AccountingLine => ({
    side, ...a, entered: amount, currency, accounted: Math.round(amount * rate * 100) / 100, ledgerCurrency,
  });
  return { posted: false, lines: moneyIn ? [line('DR', bank), line('CR', offset)] : [line('DR', offset), line('CR', bank)] };
}

const fmtMoney = (v: any) => (v == null || v === '' || !Number.isFinite(Number(v)) ? '—' : Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const fmtDay = (v: any) => (v && dayjs(v).isValid() ? dayjs(v).format('DD-MMM-YYYY') : v || '—');

const TransactionDetailModal: React.FC<{
  notif: AppNotification | null;
  open: boolean;
  onClose: () => void;
  onApprove: () => void;
  onReject: (comments: string) => void;
  acting: boolean;
  /** open the full invoice (attachments, accounting …) */
  onOpenInvoice?: (invoiceId: number, invoiceNumber: string) => void;
  /** open a page (purchase order / requisition) */
  onOpenPath?: (path: string) => void;
}> = ({ notif, open, onClose, onApprove, onReject, acting, onOpenInvoice, onOpenPath }) => {
  const [invoiceLines, setInvoiceLines] = useState<any[]>([]);
  const [linesLoading, setLinesLoading] = useState(false);
  const [apHeader, setApHeader] = useState<any>(null);
  const [apHeaderLoading, setApHeaderLoading] = useState(false);
  const [cashTxn, setCashTxn] = useState<any>(null);
  const [cashTxnLoading, setCashTxnLoading] = useState(false);
  // its GL journal lines, when it is already accounted
  const [cashGl, setCashGl] = useState<any[] | null>(null);
  // purchasing: the purchase order / requisition (and change order) being approved
  const [poDoc, setPoDoc] = useState<{ kind: string; head: any; lines: any[]; co?: any } | null>(null);
  const [poDocLoading, setPoDocLoading] = useState(false);
  React.useEffect(() => {
    if (!open || !notif?.transactionId || notif.approvalModule !== 'PROCUREMENT') { setPoDoc(null); return; }
    let cancelled = false;
    const id = notif.transactionId;
    const kind = String(notif.approvalTransactionType || 'PURCHASE_ORDER').toUpperCase();
    setPoDocLoading(true);
    (async () => {
      if (kind === 'REQUISITION') {
        const [head] = await poQuery(`SELECT * FROM RR_PO_V_REQUISITIONS WHERE REQ_HEADER_ID = ${nlit(id)}`);
        const lines = await poQuery(`SELECT LINE_NUM, ITEM_DESCRIPTION, CATEGORY_NAME, QUANTITY, UOM_CODE, UNIT_PRICE, AMOUNT, CURRENCY_CODE,
          NEED_BY_DATE, SUGGESTED_SUPPLIER, SUGGESTED_SUPPLIER_NAME, CHARGE_ACCOUNT FROM RR_PO_V_REQ_LINES WHERE REQ_HEADER_ID = ${nlit(id)} ORDER BY LINE_NUM`);
        return { kind, head, lines };
      }
      let co: any;
      let poId = id;
      if (kind === 'PO_CHANGE_ORDER') {
        [co] = await poQuery(`SELECT CHANGE_ORDER_ID, PO_HEADER_ID, CO_NUMBER, REASON, CHANGE_SUMMARY, AMOUNT_DELTA_FUNC, CURRENCY_CODE
          FROM RR_PO_V_CHANGE_ORDERS WHERE CHANGE_ORDER_ID = ${nlit(id)}`);
        poId = co ? Number(co.PO_HEADER_ID) : id;
      }
      const [head] = await poQuery(`SELECT * FROM RR_PO_V_ORDERS WHERE PO_HEADER_ID = ${nlit(poId)}`);
      const lines = await poQuery(`SELECT LINE_NUM, ITEM_DESCRIPTION, CATEGORY_NAME, LINE_TYPE, QUANTITY, UOM_CODE, UNIT_PRICE, AMOUNT,
        NEED_BY_DATE, CHARGE_ACCOUNT, LINE_STATUS FROM RR_PO_V_ORDER_LINES WHERE PO_HEADER_ID = ${nlit(poId)} ORDER BY LINE_NUM`);
      return { kind, head, lines, co };
    })()
      .then(d => { if (!cancelled) setPoDoc(d.head ? d : null); })
      .catch(() => { if (!cancelled) setPoDoc(null); })
      .finally(() => { if (!cancelled) setPoDocLoading(false); });
    return () => { cancelled = true; };
  }, [open, notif?.transactionId, notif?.approvalModule, notif?.approvalTransactionType]);
  const [rejectComments, setRejectComments] = useState('');
  const [showRejectInput, setShowRejectInput] = useState(false);

  React.useEffect(() => {
    if (!open || !notif?.transactionId || notif.approvalModule !== 'AP') {
      setInvoiceLines([]);
      setApHeader(null);
      return;
    }
    let cancelled = false;
    const id = notif.transactionId;
    // Invoice lines (item and tax lines)
    setLinesLoading(true);
    getJson(`${APEX_DB_CONFIG.baseUrl}/ap/createinvoiceslines?P_INVOICE_ID=${id}`)
      .then(d => {
        if (cancelled) return;
        setInvoiceLines(itemsOf(d).map((l: any, i: number) => ({
          key: pick(l, 'line_id') ?? i,
          lineNumber: pick(l, 'line_number', 'line_num') ?? i + 1,
          lineType: pick(l, 'line_type') || 'Item',
          description: pick(l, 'description', 'line_description') || '',
          amount: Number(pick(l, 'line_amount', 'amount') ?? 0),
          distribution: pick(l, 'distribution_combination', 'dist_code_combination', 'distribution') || '',
        })));
      })
      .catch(() => { if (!cancelled) setInvoiceLines([]); })
      .finally(() => { if (!cancelled) setLinesLoading(false); });
    // Invoice header
    setApHeaderLoading(true);
    loadApInvoiceHeader(id, notif.trxNo)
      .then(h => { if (!cancelled) setApHeader(h); })
      .catch(() => { if (!cancelled) setApHeader(null); })
      .finally(() => { if (!cancelled) setApHeaderLoading(false); });
    return () => { cancelled = true; };
  }, [open, notif?.transactionId, notif?.approvalModule, notif?.trxNo]);

  React.useEffect(() => {
    if (!open || !notif?.transactionId || notif.approvalModule !== 'CASH') {
      setCashTxn(null);
      setCashGl(null);
      return;
    }
    setCashTxnLoading(true);
    const base = APEX_DB_CONFIG.baseUrl;
    const id = Number(notif.transactionId);
    // the transaction straight from its table (read gateway); the REST search only when the gateway refuses
    const camel = (row: Record<string, any>) => Object.fromEntries(Object.entries(row).map(([k, v]) =>
      [k.toLowerCase().replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase()), v]));
    const viaRest = () => fetch(`${base}/cash/externaltransactions?external_transaction_id=${id}`, { headers: { Accept: 'application/json' } })
      .then(r => r.json())
      .then(d => (d.items || []).find((t: any) => Number(t.externalTransactionId) === id) ?? null)   // never another transaction
      .catch(() => null);
    Promise.all([
      poQuery(`SELECT * FROM RR_EXTERNAL_CASH_TRANSACTIONS WHERE EXTERNAL_TRANSACTION_ID = ${nlit(id)}`, 1, 'APPROVALS')
        .then(rows => (rows[0] ? camel(rows[0]) : null))
        .catch(() => null)
        .then(t => t ?? viaRest()),
      getJson(`${base}/gl/journals/lines?reference2=${encodeURIComponent(String(notif.transactionId))}&reference5=BANK_EXTERNAL_TRANSACTIONS`)
        .then(itemsOf).catch(() => []),
    ])
      .then(([txn, gl]) => { setCashTxn(txn); setCashGl(gl); })
      .finally(() => setCashTxnLoading(false));
  }, [open, notif?.transactionId, notif?.approvalModule]);

  React.useEffect(() => {
    if (!open) {
      setShowRejectInput(false);
      setRejectComments('');
      setApHeader(null);
      setCashTxn(null);
    }
  }, [open]);

  if (!notif) return null;

  const amt = notif.approvalAmount != null
    ? `${notif.approvalCurrency || ''} ${Number(notif.approvalAmount).toLocaleString(undefined, { minimumFractionDigits: 2 })}`
    : '—';

  const lineColumns: ColumnsType<any> = [
    { title: 'Line #',  dataIndex: 'lineNumber',  key: 'ln',  width: 60 },
    { title: 'Type',    dataIndex: 'lineType',    key: 'lt',  width: 80,
      render: (v: string) => <Tag color={/tax/i.test(v) ? 'purple' : 'default'} style={{ fontSize: 10, margin: 0 }}>{v}</Tag> },
    { title: 'Description', dataIndex: 'description', key: 'ld', ellipsis: true,
      render: (v: string) => <Tooltip title={v}><span>{v || '—'}</span></Tooltip> },
    { title: 'Amount',  dataIndex: 'amount',      key: 'la',  width: 120, align: 'right',
      render: (v: number) => <Text style={{ fontFamily: 'monospace' }}>{fmtMoney(v)}</Text> },
    { title: 'Distribution', dataIndex: 'distribution', key: 'dc', width: 200, ellipsis: true,
      render: (v: string) => <Tooltip title={v}><Text style={{ fontFamily: 'monospace', fontSize: 11 }}>{v || '—'}</Text></Tooltip> },
  ];
  const linesTotal = invoiceLines.reduce((t, l) => t + (Number(l.amount) || 0), 0);

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={
        <Space>
          <BellOutlined style={{ color: '#D4A800' }} />
          <span>Approval Request — {notif.trxNo}</span>
        </Space>
      }
      width={780}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Button onClick={onClose}>Close</Button>
          <Space>
            {showRejectInput ? (
              <>
                <Input.TextArea
                  rows={1}
                  placeholder="Reason for rejection (optional)"
                  value={rejectComments}
                  onChange={e => setRejectComments(e.target.value)}
                  style={{ width: 260, resize: 'none' }}
                  autoFocus
                />
                <Button danger loading={acting} icon={<StopOutlined />}
                  onClick={() => { onReject(rejectComments); setShowRejectInput(false); }}>
                  Confirm Reject
                </Button>
                <Button onClick={() => setShowRejectInput(false)}>Cancel</Button>
              </>
            ) : (
              <>
                <Button danger icon={<StopOutlined />} onClick={() => setShowRejectInput(true)}>
                  Reject
                </Button>
                <Button type="primary" loading={acting} icon={<CheckCircleOutlined />}
                  style={{ background: '#1D7B4D', borderColor: '#1D7B4D' }}
                  onClick={onApprove}>
                  Approve
                </Button>
              </>
            )}
          </Space>
        </div>
      }
    >
      <Descriptions bordered size="small" column={2} style={{ marginBottom: 16 }}>
        <Descriptions.Item label="Reference">{notif.trxNo}</Descriptions.Item>
        <Descriptions.Item label="Amount"><Text strong style={{ fontFamily: 'monospace' }}>{amt}</Text></Descriptions.Item>
        <Descriptions.Item label="Module"><Tag color={MODULE_COLOR[notif.approvalModule || ''] || 'default'}>{notif.approvalModule}</Tag></Descriptions.Item>
        <Descriptions.Item label="Type">{notif.approvalTransactionType || '—'}</Descriptions.Item>
        <Descriptions.Item label="Submitted by">{notif.requestedByName || '—'}</Descriptions.Item>
        <Descriptions.Item label="Date">{notif.date ? dayjs(notif.date).format('DD-MMM-YYYY') : '—'}</Descriptions.Item>
        {notif.approvalDescription && (
          <Descriptions.Item label="Description" span={2}>{notif.approvalDescription}</Descriptions.Item>
        )}
      </Descriptions>

      {notif.approvalModule === 'AP' && notif.transactionId && (
        <>
          <Divider style={{ margin: '8px 0', fontSize: 12 }}>
            <Space size={8}>
              <span>Invoice</span>
              {onOpenInvoice && (
                <Button size="small" type="link" icon={<EyeOutlined />} style={{ padding: 0, height: 'auto', fontSize: 12 }}
                  onClick={() => onOpenInvoice(notif.transactionId!, String(pick(apHeader, 'invoice_number') || notif.trxNo))}>
                  Open invoice
                </Button>
              )}
            </Space>
          </Divider>
          {apHeaderLoading
            ? <div style={{ textAlign: 'center', padding: 8 }}><Spin size="small" /></div>
            : apHeader
              ? <Descriptions bordered size="small" column={2} style={{ marginBottom: 8 }}>
                  <Descriptions.Item label="Invoice #">{pick(apHeader, 'invoice_number', 'invoice_num') || '—'}</Descriptions.Item>
                  <Descriptions.Item label="Type">{pick(apHeader, 'invoice_type') || '—'}</Descriptions.Item>
                  <Descriptions.Item label="Supplier">{pick(apHeader, 'supplier', 'supplier_name', 'party') || '—'}</Descriptions.Item>
                  <Descriptions.Item label="Supplier Site">{pick(apHeader, 'supplier_site') || '—'}</Descriptions.Item>
                  <Descriptions.Item label="Invoice Date">{fmtDay(pick(apHeader, 'invoice_date'))}</Descriptions.Item>
                  <Descriptions.Item label="Accounting Date">{fmtDay(pick(apHeader, 'accounting_date'))}</Descriptions.Item>
                  <Descriptions.Item label="Business Unit">{pick(apHeader, 'business_unit') || '—'}</Descriptions.Item>
                  <Descriptions.Item label="Amount">
                    <Text strong style={{ fontFamily: 'monospace' }}>{pick(apHeader, 'invoice_currency') || notif.approvalCurrency || ''} {fmtMoney(pick(apHeader, 'invoice_amount'))}</Text>
                  </Descriptions.Item>
                  <Descriptions.Item label="Payment Terms">{pick(apHeader, 'payment_terms', 'terms_name') || '—'}</Descriptions.Item>
                  <Descriptions.Item label="Created By">{pick(apHeader, 'created_by') || '—'}</Descriptions.Item>
                  <Descriptions.Item label="Validation"><Tag style={{ margin: 0 }}>{pick(apHeader, 'validation_status') || 'Never validated'}</Tag></Descriptions.Item>
                  <Descriptions.Item label="Liability Account">
                    <Text style={{ fontFamily: 'monospace', fontSize: 11 }}>{pick(apHeader, 'liability_distribution') || '—'}</Text>
                  </Descriptions.Item>
                </Descriptions>
              : <Alert type="warning" showIcon style={{ marginBottom: 8, fontSize: 12 }}
                  message={`Invoice ${notif.trxNo} (id ${notif.transactionId}) could not be loaded — use Open invoice to check it.`} />
          }
          <Divider style={{ margin: '8px 0', fontSize: 12 }}>Invoice Lines{invoiceLines.length ? ` (${invoiceLines.length})` : ''}</Divider>
          {linesLoading
            ? <div style={{ textAlign: 'center', padding: 16 }}><Spin size="small" /></div>
            : invoiceLines.length > 0
              ? <Table dataSource={invoiceLines} columns={lineColumns} rowKey="key" size="small" pagination={false}
                  scroll={invoiceLines.length > 8 ? { y: 260 } : undefined}
                  summary={() => (
                    <Table.Summary.Row>
                      <Table.Summary.Cell index={0} colSpan={3}><Text strong>Total</Text></Table.Summary.Cell>
                      <Table.Summary.Cell index={3} align="right"><Text strong style={{ fontFamily: 'monospace' }}>{fmtMoney(linesTotal)}</Text></Table.Summary.Cell>
                      <Table.Summary.Cell index={4} />
                    </Table.Summary.Row>
                  )} />
              : <Text type="secondary" style={{ fontSize: 12 }}>No lines found</Text>
          }
        </>
      )}

      {notif.approvalModule === 'PROCUREMENT' && notif.transactionId && (() => {
        const isReq = poDoc?.kind === 'REQUISITION';
        const h = poDoc?.head;
        const path = isReq ? `/po/requisitions?id=${h?.REQ_HEADER_ID}` : `/po/orders?id=${h?.PO_HEADER_ID}`;
        const lineCols: ColumnsType<any> = [
          { title: '#', dataIndex: 'LINE_NUM', width: 40 },
          { title: 'Description', dataIndex: 'ITEM_DESCRIPTION', ellipsis: true,
            render: (v: string, r: any) => <Tooltip title={[v, r.CATEGORY_NAME, r.CHARGE_ACCOUNT].filter(Boolean).join(' · ')}>
              <span>{v}{r.LINE_STATUS === 'CANCELLED' && <Tag style={{ marginLeft: 4, fontSize: 10 }}>cancelled</Tag>}</span></Tooltip> },
          ...(isReq ? [{ title: 'Supplier', key: 'sup', width: 150, ellipsis: true, render: (_: unknown, r: any) => r.SUGGESTED_SUPPLIER || r.SUGGESTED_SUPPLIER_NAME || '—' }] : []),
          { title: 'Qty', key: 'q', width: 90, align: 'right' as const, render: (_: unknown, r: any) => r.QUANTITY != null && r.LINE_TYPE !== 'AMOUNT' ? `${Number(r.QUANTITY).toLocaleString()} ${r.UOM_CODE || ''}` : '—' },
          { title: 'Amount', dataIndex: 'AMOUNT', width: 120, align: 'right' as const, render: (v: number) => <Text style={{ fontFamily: 'monospace' }}>{fmtMoney(v)}</Text> },
          { title: 'Need by', dataIndex: 'NEED_BY_DATE', width: 95, render: (v: string) => fmtDay(v) },
        ];
        return (
          <>
            <Divider style={{ margin: '8px 0', fontSize: 12 }}>
              <Space size={8}>
                <span>{isReq ? 'Requisition' : 'Purchase order'}</span>
                {onOpenPath && h && <Button size="small" type="link" icon={<EyeOutlined />} style={{ padding: 0, height: 'auto', fontSize: 12 }}
                  onClick={() => onOpenPath(path)}>Open {isReq ? 'requisition' : 'purchase order'}</Button>}
              </Space>
            </Divider>
            {poDocLoading ? <div style={{ textAlign: 'center', padding: 8 }}><Spin size="small" /></div>
              : !h ? <Alert type="warning" showIcon style={{ fontSize: 12 }} message={`${notif.trxNo} could not be loaded`} />
              : <>
                {poDoc?.co && (
                  <Alert type="info" showIcon style={{ marginBottom: 8 }}
                    message={`Change order ${poDoc.co.CO_NUMBER} — ${poDoc.co.AMOUNT_DELTA_FUNC >= 0 ? '+' : ''}${fmtMoney(poDoc.co.AMOUNT_DELTA_FUNC)} ${poDoc.co.CURRENCY_CODE || ''}`}
                    description={<>{poDoc.co.CHANGE_SUMMARY}{poDoc.co.REASON ? <div style={{ fontStyle: 'italic' }}>Reason: {poDoc.co.REASON}</div> : null}</>} />
                )}
                <Descriptions bordered size="small" column={2} style={{ marginBottom: 8 }}>
                  {isReq ? <>
                    <Descriptions.Item label="Requisition">{h.REQ_NUMBER}{h.URGENT_FLAG === 'Y' && <Tag color="red" style={{ marginLeft: 6 }}>Urgent</Tag>}</Descriptions.Item>
                    <Descriptions.Item label="Preparer">{h.PREPARER_USER || '—'}</Descriptions.Item>
                    <Descriptions.Item label="Business Unit">{h.BUSINESS_UNIT_NAME || '—'}</Descriptions.Item>
                    <Descriptions.Item label="Amount"><Text strong style={{ fontFamily: 'monospace' }}>{h.FUNCTIONAL_CURRENCY} {fmtMoney(h.TOTAL_AMOUNT_FUNC)}</Text></Descriptions.Item>
                    {h.JUSTIFICATION && <Descriptions.Item label="Justification" span={2}>{h.JUSTIFICATION}</Descriptions.Item>}
                  </> : <>
                    <Descriptions.Item label="PO number">{h.PO_NUMBER}{Number(h.REVISION_NUM) > 0 && <Tag style={{ marginLeft: 6 }}>Rev {h.REVISION_NUM}</Tag>}</Descriptions.Item>
                    <Descriptions.Item label="Buyer">{h.BUYER_USER || '—'}</Descriptions.Item>
                    <Descriptions.Item label="Supplier">{h.SUPPLIER_NAME || '—'}</Descriptions.Item>
                    <Descriptions.Item label="Site">{h.SITE_NAME || '—'}</Descriptions.Item>
                    <Descriptions.Item label="Business Unit">{h.BUSINESS_UNIT_NAME || '—'}</Descriptions.Item>
                    <Descriptions.Item label="Amount"><Text strong style={{ fontFamily: 'monospace' }}>{h.CURRENCY_CODE} {fmtMoney(h.TOTAL_AMOUNT)}</Text></Descriptions.Item>
                    <Descriptions.Item label="Payment Terms">{h.PAYMENT_TERMS || '—'}</Descriptions.Item>
                    <Descriptions.Item label="Status"><Tag style={{ margin: 0 }}>{String(h.DOCUMENT_STATUS || '').replace(/_/g, ' ')}</Tag></Descriptions.Item>
                    {h.DESCRIPTION && <Descriptions.Item label="Description" span={2}>{h.DESCRIPTION}</Descriptions.Item>}
                  </>}
                </Descriptions>
                <Table dataSource={poDoc!.lines} columns={lineCols} rowKey="LINE_NUM" size="small" pagination={false}
                  scroll={poDoc!.lines.length > 8 ? { y: 240 } : undefined}
                  summary={() => (
                    <Table.Summary.Row>
                      <Table.Summary.Cell index={0} colSpan={isReq ? 4 : 3}><Text strong>Total</Text></Table.Summary.Cell>
                      <Table.Summary.Cell index={1} align="right"><Text strong style={{ fontFamily: 'monospace' }}>
                        {fmtMoney(poDoc!.lines.filter(l => l.LINE_STATUS !== 'CANCELLED').reduce((t, l) => t + (Number(l.AMOUNT) || 0), 0))}</Text></Table.Summary.Cell>
                      <Table.Summary.Cell index={2} />
                    </Table.Summary.Row>
                  )} />
              </>}
          </>
        );
      })()}

      {notif.approvalModule === 'CASH' && notif.transactionId && (
        <>
          <Divider style={{ margin: '8px 0', fontSize: 12 }}>Transaction Details</Divider>
          {cashTxnLoading
            ? <div style={{ textAlign: 'center', padding: 8 }}><Spin size="small" /></div>
            : cashTxn
              ? <Descriptions bordered size="small" column={2}>
                  <Descriptions.Item label="Bank Account">{cashTxn.bankAccountName || '—'}</Descriptions.Item>
                  <Descriptions.Item label="Business Unit">{cashTxn.businessUnitName || '—'}</Descriptions.Item>
                  <Descriptions.Item label="Direction">
                    <Tag color={cashTxn.transactionDirection === 'DR' ? 'blue' : 'green'}>
                      {cashTxn.transactionDirection === 'DR' ? '▲ Money In (DR)' : '▼ Money Out (CR)'}
                    </Tag>
                  </Descriptions.Item>
                  <Descriptions.Item label="Type">{cashTxn.transactionType || '—'}</Descriptions.Item>
                  <Descriptions.Item label="Reference">{cashTxn.referenceText || cashTxn.description || '—'}</Descriptions.Item>
                  <Descriptions.Item label="Status"><Tag>{cashTxn.status || '—'}</Tag></Descriptions.Item>
                  {cashTxn.payeeName && <Descriptions.Item label="Payee">{cashTxn.payeeName}</Descriptions.Item>}
                  <Descriptions.Item label="Date">{fmtDay(cashTxn.transactionDate)}</Descriptions.Item>
                  {cashTxn.description && cashTxn.description !== cashTxn.referenceText && (
                    <Descriptions.Item label="Description" span={2}>{cashTxn.description}</Descriptions.Item>
                  )}
                </Descriptions>
              : <Text type="secondary" style={{ fontSize: 12 }}>Transaction details not available — the transaction was not found (it may have been deleted)</Text>
          }
          {!cashTxnLoading && (() => {
            const { lines, posted } = cashAccountingLines(cashTxn, cashGl, notif);
            if (!lines.length) return null;
            return (
              <>
                <Divider style={{ margin: '14px 0 8px', fontSize: 12 }}>
                  <Space size={6}>Accounting
                    <Tag color={posted ? 'success' : 'gold'} style={{ margin: 0, fontSize: 10 }}>{posted ? 'posted in the GL' : 'on approval and accounting'}</Tag>
                  </Space>
                </Divider>
                <AccountingLinesView lines={lines} />
              </>
            );
          })()}
        </>
      )}
    </Modal>
  );
};

// ── Main Panel ────────────────────────────────────────────────────────────────
const NotificationPanel: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const {
    notifications, unreadCount, pendingApprovalCount,
    markRead, markAllRead, clearAll,
    refreshPdcNotifications, pdcChecking, lastApiUrl, lastApiResult,
    approvalChecking, refreshApprovalNotifications,
    approveNotification, rejectNotification,
    lastApprovalApiCall,
  } = useNotifications();

  const [activeModule, setActiveModule]       = useState<'All' | NotificationModule>('Approvals');
  const [statusFilter, setStatusFilter]       = useState<string>('All');
  const [apiModalOpen, setApiModalOpen]       = useState(false);
  const [approvalApiModalOpen, setApprovalApiModalOpen] = useState(false);
  const [detailNotif, setDetailNotif]         = useState<AppNotification | null>(null);
  const [actingId, setActingId]               = useState<string | null>(null);
  const [tab, setTab]                         = useState<'notifs' | 'procs'>('notifs');
  const navigate = useNavigate();

  const filtered = notifications.filter(n => {
    if (activeModule !== 'All' && n.module !== activeModule) return false;
    if (statusFilter !== 'All' && n.status !== statusFilter) return false;
    return true;
  });

  const handleApprove = async (notif: AppNotification) => {
    if (!notif.approvalRequestId) return;
    setActingId(notif.id);
    try {
      await approveNotification(notif.approvalRequestId, notif.id);
      message.success(`Approved: ${notif.trxNo}`);
      setDetailNotif(null);
    } catch (e: any) {
      message.error(e?.message || 'Approve failed', 8);
      setApprovalApiModalOpen(true);
    } finally {
      setActingId(null);
    }
  };

  const handleReject = async (notif: AppNotification, comments?: string) => {
    if (!notif.approvalRequestId) return;
    setActingId(notif.id);
    try {
      await rejectNotification(notif.approvalRequestId, notif.id, comments);
      message.success(`Rejected: ${notif.trxNo}`);
      setDetailNotif(null);
    } catch (e: any) {
      message.error(e?.message || 'Reject failed', 8);
      setApprovalApiModalOpen(true);
    } finally {
      setActingId(null);
    }
  };

  // Approval-specific columns
  const approvalColumns: ColumnsType<AppNotification> = [
    {
      title: 'Date',
      dataIndex: 'date',
      key: 'date',
      width: 90,
      render: (v: string) => <Text style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{v ? dayjs(v).format('DD-MMM-YY') : '—'}</Text>,
    },
    {
      title: 'Ref',
      dataIndex: 'trxNo',
      key: 'trxNo',
      width: 130,
      render: (v: string, record: AppNotification) => (
        <Text
          style={{ fontSize: 11, color: '#0572CE', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}
          onClick={e => { e.stopPropagation(); markRead(record.id); setDetailNotif(record); }}
        >
          {v || '—'}
        </Text>
      ),
    },
    {
      title: 'Description',
      dataIndex: 'approvalDescription',
      key: 'approvalDescription',
      ellipsis: true,
      render: (v?: string) => v
        ? <Text style={{ fontSize: 11 }}>{v}</Text>
        : <Text type="secondary" style={{ fontSize: 11 }}>—</Text>,
    },
    {
      title: 'Module',
      dataIndex: 'approvalModule',
      key: 'approvalModule',
      width: 68,
      render: (v: string) => <Tag color={MODULE_COLOR[v] || 'default'} style={{ fontSize: 10, margin: 0 }}>{v || '—'}</Tag>,
    },
    {
      title: 'Amount',
      key: 'amount',
      width: 120,
      render: (_: any, r: AppNotification) =>
        r.approvalAmount != null
          ? <Text style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 600 }}>
              {r.approvalCurrency} {Number(r.approvalAmount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </Text>
          : <Text type="secondary" style={{ fontSize: 11 }}>—</Text>,
    },
    {
      title: 'Requested By',
      dataIndex: 'requestedByName',
      key: 'requestedBy',
      ellipsis: true,
      render: (v: string) => <Text style={{ fontSize: 11 }}>{v || '—'}</Text>,
    },
    {
      title: '',
      key: 'actions',
      width: 150,
      render: (_: any, record: AppNotification) => {
        if (record.status === 'Actioned') return <Tag color="green" style={{ fontSize: 10 }}>Actioned</Tag>;
        const busy = actingId === record.id;
        return (
          <Space size={4}>
            <Tooltip title="View Details">
              <Button size="small" icon={<EyeOutlined />} onClick={() => { markRead(record.id); setDetailNotif(record); }} />
            </Tooltip>
            <Tooltip title="Approve">
              <Button size="small" type="primary" loading={busy} icon={<CheckCircleOutlined />}
                style={{ background: '#1D7B4D', borderColor: '#1D7B4D' }}
                onClick={() => handleApprove(record)} />
            </Tooltip>
            <Tooltip title="Reject">
              <Button size="small" danger loading={busy} icon={<StopOutlined />}
                onClick={() => { markRead(record.id); setDetailNotif(record); }} />
            </Tooltip>
          </Space>
        );
      },
    },
  ];

  // Generic columns for non-Approval modules
  const generalColumns: ColumnsType<AppNotification> = [
    {
      title: 'Module',
      dataIndex: 'module',
      key: 'module',
      width: 72,
      render: (v: string) => <Tag color={MODULE_COLOR[v] || 'default'} style={{ fontSize: 10, margin: 0 }}>{v}</Tag>,
    },
    {
      title: 'Date',
      dataIndex: 'date',
      key: 'date',
      width: 90,
      render: (v: string) => <Text style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{v ? dayjs(v).format('DD-MMM-YY') : '—'}</Text>,
    },
    {
      title: 'Transaction',
      dataIndex: 'transaction',
      key: 'transaction',
      width: 100,
      render: (v: string, record: AppNotification) => (
        <Space size={4}>
          {SEVERITY_ICON[record.severity || 'info']}
          <Text style={{ fontSize: 11 }}>{v}</Text>
        </Space>
      ),
    },
    {
      title: 'Trx No',
      dataIndex: 'trxNo',
      key: 'trxNo',
      width: 90,
      render: (v: string) => <Text style={{ fontSize: 11, color: '#0572CE' }}>{v || '—'}</Text>,
    },
    {
      title: 'Notification Details',
      dataIndex: 'details',
      key: 'details',
      render: (v: string, record: AppNotification) => (
        <Text style={{
          fontSize: 11,
          fontWeight: record.status === 'Unread' ? 600 : undefined,
          color: record.severity === 'error' ? '#C74634' : record.severity === 'warning' ? '#8a6000' : '#1A1A1A',
        }}>
          {v}
        </Text>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 76,
      render: (v: string) => <Tag color={STATUS_COLOR[v] || 'default'} style={{ fontSize: 10, margin: 0 }}>{v}</Tag>,
    },
    {
      title: '',
      key: 'action',
      width: 36,
      render: (_: any, record: AppNotification) =>
        record.status === 'Unread' ? (
          <Tooltip title="Mark as read">
            <Button type="text" size="small" icon={<CheckOutlined style={{ color: '#1D7B4D', fontSize: 12 }} />} onClick={() => markRead(record.id)} />
          </Tooltip>
        ) : null,
    },
  ];

  const isApprovalsView = activeModule === 'Approvals';
  const columns = isApprovalsView ? approvalColumns : generalColumns;
  const isLoading = pdcChecking || approvalChecking;

  return (
    <Drawer
      title={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Space>
            <BellOutlined style={{ color: '#722ed1', fontSize: 16 }} />
            <span style={{ fontWeight: 600 }}>Notifications</span>
            {unreadCount > 0 && <Badge count={unreadCount} style={{ background: '#C74634' }} />}
            {pendingApprovalCount > 0 && (
              <Badge count={pendingApprovalCount} style={{ background: '#D4A800' }}
                title={`${pendingApprovalCount} pending approval(s)`} />
            )}
          </Space>
          <Space size={4}>
            <Tooltip title="View PDC API">
              <Button size="small" icon={<ApiOutlined style={{ color: '#722ed1' }} />} onClick={() => setApiModalOpen(true)} />
            </Tooltip>
            <Tooltip title={lastApprovalApiCall ? `Last approval API call — HTTP ${lastApprovalApiCall.status}` : 'Approval API Inspector (no call yet)'}>
              <Button
                size="small"
                icon={<ApiOutlined style={{
                  color: lastApprovalApiCall
                    ? (String(lastApprovalApiCall.status).startsWith('2') ? '#1D7B4D' : '#C74634')
                    : '#aaa',
                }} />}
                onClick={() => setApprovalApiModalOpen(true)}
              />
            </Tooltip>
            <Tooltip title="Refresh approvals">
              <Button size="small" icon={<ReloadOutlined spin={approvalChecking} />} onClick={refreshApprovalNotifications} loading={approvalChecking} />
            </Tooltip>
            <Tooltip title="Refresh PDC maturity notifications">
              <Button size="small" icon={<ReloadOutlined spin={pdcChecking} />} onClick={refreshPdcNotifications} loading={pdcChecking} />
            </Tooltip>
            <Tooltip title="Mark all read">
              <Button size="small" icon={<CheckOutlined />} onClick={markAllRead} disabled={unreadCount === 0} />
            </Tooltip>
            <Tooltip title="Clear all">
              <Button size="small" danger icon={<DeleteOutlined />} onClick={clearAll} disabled={notifications.length === 0} />
            </Tooltip>
          </Space>
        </div>
      }
      open={open}
      onClose={onClose}
      width={isApprovalsView ? 1000 : 900}
      styles={{ body: { padding: '12px 16px', background: '#F7F7F7' } }}
      closable
    >
      <Tabs
        activeKey={tab}
        onChange={(k) => setTab(k as 'notifs' | 'procs')}
        items={[
          {
            key: 'notifs',
            label: <span><BellOutlined /> Notifications</span>,
            children: (
              <>
      {/* Module filter toggles */}
      <div style={{ marginBottom: 10, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {MODULES.map(m => {
          const cnt = m.value === 'All'
            ? notifications.filter(n => n.status === 'Unread').length
            : notifications.filter(n => n.module === m.value && n.status === 'Unread').length;
          const active = activeModule === m.value;
          return (
            <Badge key={m.value} count={cnt} size="small" offset={[-4, 4]}>
              <Button
                size="small"
                type={active ? 'primary' : 'default'}
                onClick={() => setActiveModule(m.value)}
                style={{
                  borderRadius: 14, fontSize: 12,
                  fontWeight: active ? 600 : undefined,
                  background: active ? (m.value === 'Approvals' ? '#D4A800' : '#722ed1') : undefined,
                  borderColor: active ? (m.value === 'Approvals' ? '#D4A800' : '#722ed1') : undefined,
                }}
              >
                {m.label}
              </Button>
            </Badge>
          );
        })}
        <div style={{ marginLeft: 'auto' }}>
          <Select
            size="small"
            value={statusFilter}
            onChange={setStatusFilter}
            style={{ width: 110 }}
            options={[
              { value: 'All',      label: 'All Status'  },
              { value: 'Unread',   label: 'Unread'      },
              { value: 'Read',     label: 'Read'        },
              { value: 'Actioned', label: 'Actioned'    },
            ]}
          />
        </div>
      </div>

      {/* Approvals summary bar */}
      {isApprovalsView && pendingApprovalCount > 0 && (
        <div style={{
          background: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 6,
          padding: '8px 14px', marginBottom: 10,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <WarningOutlined style={{ color: '#D4A800' }} />
          <Text style={{ fontSize: 12, color: '#8a6000' }}>
            <strong>{pendingApprovalCount}</strong> pending approval{pendingApprovalCount !== 1 ? 's' : ''} require your attention
          </Text>
        </div>
      )}

      {/* Table */}
      {filtered.length === 0 ? (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 200 }}>
          {isLoading
            ? <Spin tip="Checking for notifications…" />
            : <Empty
                description={isApprovalsView ? 'No pending approvals' : 'No notifications'}
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
          }
        </div>
      ) : (
        <div style={{ background: '#fff', borderRadius: 8, border: '1px solid #E5E5E5', overflow: 'hidden' }}>
          <Table
            columns={columns}
            dataSource={filtered}
            rowKey="id"
            size="small"
            pagination={{ pageSize: 15, size: 'small', showTotal: t => `${t} notifications` }}
            rowClassName={(r: AppNotification) => r.status === 'Unread' ? 'notif-unread-row' : ''}
            onRow={(record: AppNotification) => ({
              onClick: () => {
                if (record.status === 'Unread') markRead(record.id);
              },
              style: { cursor: 'pointer' },
            })}
          />
        </div>
      )}
              </>
            ),
          },
          {
            key: 'procs',
            label: <span><ThunderboltOutlined /> Processes</span>,
            children: <ProcessMonitor active={open && tab === 'procs'} />,
          },
        ]}
      />

      <style>{`
        .notif-unread-row td { background: #fdf4ff !important; }
        .notif-unread-row:hover td { background: #f5e6ff !important; }
      `}</style>

      {/* Transaction Detail + Approve/Reject Modal */}
      <TransactionDetailModal
        notif={detailNotif}
        open={!!detailNotif}
        onClose={() => setDetailNotif(null)}
        acting={!!actingId}
        onApprove={() => detailNotif && handleApprove(detailNotif)}
        onReject={(comments) => detailNotif && handleReject(detailNotif, comments)}
        onOpenInvoice={(openInvoiceId, openInvoiceNumber) => {
          setDetailNotif(null);
          onClose();
          navigate('/ap/manage-invoices', { state: { openInvoiceId, openInvoiceNumber } });
        }}
        onOpenPath={path => { setDetailNotif(null); onClose(); navigate(path); }}
      />

      {/* PDC API Inspector Modal */}
      <Modal
        open={apiModalOpen}
        onCancel={() => setApiModalOpen(false)}
        footer={null}
        title={<Space><ApiOutlined style={{ color: '#722ed1' }} /><span>PDC Notification API Inspector</span></Space>}
        width={700}
      >
        <div style={{ fontSize: 12, fontFamily: 'monospace' }}>
          <div style={{ marginBottom: 8, fontWeight: 600, color: '#555' }}>PDC Maturity Check — Endpoint:</div>
          <div style={{ background: '#1e1e2e', color: '#cdd6f4', padding: '10px 14px', borderRadius: 6, wordBreak: 'break-all', marginBottom: 16, userSelect: 'all' }}>
            {lastApiUrl || '(not yet called)'}
          </div>
          <div style={{ marginBottom: 8, fontWeight: 600, color: '#555' }}>Last Result:</div>
          <div style={{ background: '#f5f5f5', padding: '10px 14px', borderRadius: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#333', minHeight: 60 }}>
            {lastApiResult || '(no result yet)'}
          </div>
          <div style={{ marginTop: 16, color: '#888', fontSize: 11 }}>
            Click <strong>Refresh</strong> in the toolbar to re-run the checks and update these values.
          </div>
        </div>
      </Modal>

      {/* Approval API Inspector Modal */}
      <Modal
        open={approvalApiModalOpen}
        onCancel={() => setApprovalApiModalOpen(false)}
        footer={<Button onClick={() => setApprovalApiModalOpen(false)}>Close</Button>}
        title={
          <Space>
            <ApiOutlined style={{
              color: lastApprovalApiCall
                ? (String(lastApprovalApiCall.status).startsWith('2') ? '#1D7B4D' : '#C74634')
                : '#aaa',
            }} />
            <span>Approval API Inspector</span>
            {lastApprovalApiCall && (
              <Text
                style={{
                  fontSize: 12, fontWeight: 700,
                  color: String(lastApprovalApiCall.status).startsWith('2') ? '#1D7B4D' : '#C74634',
                }}
              >
                HTTP {lastApprovalApiCall.status}
              </Text>
            )}
          </Space>
        }
        width={740}
      >
        {!lastApprovalApiCall ? (
          <div style={{ textAlign: 'center', padding: 32, color: '#999' }}>
            No approval API call has been made yet in this session.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* URL */}
            <div style={{ background: '#F0F4FF', border: '1px solid #0572CE33', borderRadius: 6, padding: '8px 12px' }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: '#0572CE', marginBottom: 4 }}>
                {lastApprovalApiCall.method} · Endpoint URL
              </div>
              <Text copyable style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}>
                {lastApprovalApiCall.url}
              </Text>
            </div>

            {/* Request body */}
            <div style={{ background: '#F8F8F8', borderRadius: 6, padding: '8px 12px', border: '1px solid #ddd' }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: '#555', marginBottom: 4 }}>
                Request Body (JSON)
              </div>
              <pre style={{ margin: 0, fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 160, overflow: 'auto' }}>
                {JSON.stringify(lastApprovalApiCall.body, null, 2)}
              </pre>
            </div>

            {/* Response */}
            <div style={{
              background: String(lastApprovalApiCall.status).startsWith('2') ? '#F0FFF4' : '#FFF2F0',
              border: `1px solid ${String(lastApprovalApiCall.status).startsWith('2') ? '#b7ebc8' : '#FFCCC7'}`,
              borderRadius: 6, padding: '8px 12px',
            }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: String(lastApprovalApiCall.status).startsWith('2') ? '#1D7B4D' : '#C74634', marginBottom: 4 }}>
                Response · HTTP {lastApprovalApiCall.status}
              </div>
              <pre style={{
                margin: 0, fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                maxHeight: 240, overflow: 'auto',
                color: String(lastApprovalApiCall.status).startsWith('2') ? '#1D7B4D' : '#C74634',
              }}>
                {lastApprovalApiCall.response || '(empty)'}
              </pre>
            </div>

            <div style={{ fontSize: 11, color: '#aaa' }}>
              Called at {new Date(lastApprovalApiCall.ts).toLocaleTimeString()}
            </div>
          </div>
        )}
      </Modal>
    </Drawer>
  );
};

export default NotificationPanel;
