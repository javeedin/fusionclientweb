import React, { useState, useEffect, useCallback } from 'react';
import {
  Drawer, Button, Tag, Typography, Space, Tooltip, Spin, Segmented, Dropdown, Checkbox, Empty,
  Table, Select, Modal, Descriptions, Divider, Input, Alert, message,
} from 'antd';
import { useNavigate } from 'react-router-dom';
import {
  BellOutlined, CheckOutlined, DeleteOutlined, ReloadOutlined,
  WarningOutlined, InfoCircleOutlined, CloseCircleOutlined, ApiOutlined,
  CheckCircleOutlined, StopOutlined, EyeOutlined, ThunderboltOutlined, PoweroffOutlined,
  AuditOutlined, BankOutlined, BookOutlined, CloseOutlined, DollarOutlined, FileTextOutlined, MoreOutlined,
  SearchOutlined, ShoppingCartOutlined, ToolOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { useNotifications, type AppNotification } from '../context/NotificationContext';
import { APEX_DB_CONFIG } from '../config/api.config';
import { poQuery, nlit } from '../services/po.service';
import AccountingLinesView, { type AccountingLine } from './AccountingLinesView';
import { loadExternalTransaction } from '../services/externalTxnLookup';
import { loadJournalForApproval, cleanDbMessage, type JournalForApproval } from '../services/glApproval.service';

const { Text } = Typography;

const SEVERITY_ICON: Record<string, React.ReactNode> = {
  error:   <CloseCircleOutlined style={{ color: '#C74634' }} />,
  warning: <WarningOutlined     style={{ color: '#D4A800' }} />,
  info:    <InfoCircleOutlined  style={{ color: '#0572CE' }} />,
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
  // GL: the journal batch being approved (headers + lines, direct SQL)
  const [glJe, setGlJe] = useState<JournalForApproval | null>(null);
  const [glLoading, setGlLoading] = useState(false);
  React.useEffect(() => {
    if (!open || !notif?.transactionId || notif.approvalModule !== 'GL') { setGlJe(null); return; }
    let cancelled = false;
    setGlLoading(true);
    loadJournalForApproval(Number(notif.transactionId))
      .then(j => { if (!cancelled) setGlJe(j); })
      .catch(() => { if (!cancelled) setGlJe(null); })
      .finally(() => { if (!cancelled) setGlLoading(false); });
    return () => { cancelled = true; };
  }, [open, notif?.transactionId, notif?.approvalModule]);

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
    Promise.all([
      loadExternalTransaction({ extId: Number(notif.transactionId) }),
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
                <Tooltip title={notif.approvalModule === 'GL' ? 'Approving posts the journal (status Posted)'
                  : notif.approvalModule === 'CASH' ? 'Approving creates the accounting and posts its journal (if not accounted yet)' : undefined}>
                  <Button type="primary" loading={acting} icon={<CheckCircleOutlined />}
                    style={{ background: '#1D7B4D', borderColor: '#1D7B4D' }}
                    onClick={onApprove}>
                    {notif.approvalModule === 'GL' ? 'Approve & post' : notif.approvalModule === 'CASH' ? 'Approve & account' : 'Approve'}
                  </Button>
                </Tooltip>
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

      {notif.approvalModule === 'GL' && notif.transactionId && (() => {
        const j = glJe;
        const sent = Number(notif.approvalAmount);
        const changed = j && Number.isFinite(sent) && Math.abs(j.totalDr - sent) > 0.01;
        const balanced = j && Math.abs(j.totalDr - j.totalCr) <= 0.01;
        const posted = j && /^(p|posted)$/i.test(String(j.batchStatus || ''));
        return (
          <>
            <Divider style={{ margin: '8px 0', fontSize: 12 }}>
              <Space size={8}>
                <span>Journal</span>
                {onOpenPath && <Button size="small" type="link" icon={<EyeOutlined />} style={{ padding: 0, height: 'auto', fontSize: 12 }}
                  onClick={() => onOpenPath('/gl/manage-journals')}>Open Manage Journals</Button>}
              </Space>
            </Divider>
            {glLoading ? <div style={{ textAlign: 'center', padding: 8 }}><Spin size="small" /></div>
              : !j ? <Alert type="warning" showIcon style={{ fontSize: 12 }} message={`Journal batch ${notif.transactionId} could not be loaded — it may have been deleted`} />
              : <>
                {changed && (
                  <Alert type="warning" showIcon style={{ marginBottom: 8, fontSize: 12 }}
                    message={`Changed after it was sent — sent ${notif.approvalCurrency || ''} ${fmtMoney(sent)}, now ${j.ledgerCurrency} ${fmtMoney(j.totalDr)}`}
                    description="Approving is refused; ask the sender to send it for approval again (or reject it)." />
                )}
                {posted && <Alert type="info" showIcon style={{ marginBottom: 8, fontSize: 12 }} message="This journal is already posted." />}
                <Descriptions bordered size="small" column={2} style={{ marginBottom: 8 }}>
                  <Descriptions.Item label="Batch" span={2}>{j.batchName}</Descriptions.Item>
                  <Descriptions.Item label="Period">{j.period || '—'}</Descriptions.Item>
                  <Descriptions.Item label="Accounting date">{fmtDay(j.accountingDate)}</Descriptions.Item>
                  <Descriptions.Item label="Ledger">{j.ledger || '—'}</Descriptions.Item>
                  <Descriptions.Item label="Source">{j.source || '—'}</Descriptions.Item>
                  <Descriptions.Item label="Created by">{j.createdBy || '—'}</Descriptions.Item>
                  <Descriptions.Item label="Status"><Tag style={{ margin: 0 }}>{j.batchStatus || 'Unposted'}</Tag></Descriptions.Item>
                  <Descriptions.Item label="Amount" span={2}>
                    <Text strong style={{ fontFamily: 'monospace' }}>{j.ledgerCurrency} {fmtMoney(j.totalDr)}</Text>
                    <Tag color={balanced ? 'success' : 'error'} icon={balanced ? <CheckCircleOutlined /> : <WarningOutlined />} style={{ marginLeft: 8 }}>
                      {balanced ? 'balanced' : `out of balance — Cr ${fmtMoney(j.totalCr)}`}
                    </Tag>
                  </Descriptions.Item>
                </Descriptions>
                {j.journals.length > 1 && (
                  <div style={{ fontSize: 12, marginBottom: 8 }}>
                    {j.journals.map(x => (
                      <div key={x.headerId} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '2px 0', borderBottom: '1px solid #f5f5f5' }}>
                        <span>{x.name}{x.category ? <Text type="secondary" style={{ fontSize: 11 }}> · {x.category}</Text> : null}</span>
                        <Text type="secondary" style={{ fontSize: 11 }}>{x.lines} line{x.lines === 1 ? '' : 's'}</Text>
                      </div>
                    ))}
                  </div>
                )}
                {j.journals.length === 1 && j.journals[0].description && (
                  <Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 8 }}>{j.journals[0].description}</Text>
                )}
                <Divider style={{ margin: '10px 0 8px', fontSize: 12 }}>
                  <Space size={6}>Accounting <Text type="secondary" style={{ fontSize: 11 }}>{j.lines.length} line{j.lines.length === 1 ? '' : 's'}{j.mixed ? ` · in ${j.ledgerCurrency}` : ''}</Text></Space>
                </Divider>
                {j.lineNote && j.lineNote !== j.journals[0]?.description && (
                  <Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 6 }}>{j.lineNote}</Text>
                )}
                {j.lines.length
                  ? <div style={{ maxHeight: 380, overflowY: 'auto' }}><AccountingLinesView lines={j.lines} /></div>
                  : <Text type="secondary" style={{ fontSize: 12 }}>No lines</Text>}
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

// ── Inbox look ────────────────────────────────────────────────────────────────
const MODULE_LOOK: Record<string, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  CASH:        { label: 'Cash',            color: '#0f6cbd', bg: '#e8f1fb', icon: <BankOutlined /> },
  GL:          { label: 'General Ledger',  color: '#1c5cab', bg: '#e9effa', icon: <BookOutlined /> },
  AP:          { label: 'Payables',        color: '#6d3fb8', bg: '#f1ebfa', icon: <FileTextOutlined /> },
  AR:          { label: 'Receivables',     color: '#08767c', bg: '#e5f4f4', icon: <DollarOutlined /> },
  FA:          { label: 'Fixed Assets',    color: '#a55300', bg: '#fcefe2', icon: <ToolOutlined /> },
  PROCUREMENT: { label: 'Purchasing',      color: '#9c2f73', bg: '#faeaf3', icon: <ShoppingCartOutlined /> },
};
const lookOf = (m?: string) => MODULE_LOOK[String(m || '').toUpperCase()] ?? { label: m || 'Other', color: '#595959', bg: '#f0f0f0', icon: <BellOutlined /> };
/** what approving does, per module (see NotificationContext) */
const approveLabel = (m?: string) => (m === 'GL' ? 'Approve & post' : m === 'CASH' ? 'Approve & account' : 'Approve');
const money2 = (v: number) => v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ago = (d?: string) => {
  if (!d || !dayjs(d).isValid()) return '';
  const min = dayjs().diff(dayjs(d), 'minute');
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const days = Math.floor(h / 24);
  return days < 7 ? `${days} d ago` : dayjs(d).format('D MMM YYYY');
};
const dayGroup = (d?: string) => {
  if (!d || !dayjs(d).isValid()) return 'Earlier';
  if (dayjs(d).isSame(dayjs(), 'day')) return 'Today';
  if (dayjs(d).isSame(dayjs().subtract(1, 'day'), 'day')) return 'Yesterday';
  return 'Earlier';
};
const AVATAR_TONES = ['#2a78d6', '#7b3fbf', '#08767c', '#a55300', '#9c2f73', '#1c5cab'];
const person = (who?: string) => {
  const raw = String(who || '').trim();
  const name = raw.includes('@') ? raw.split('@')[0] : raw;
  const parts = name.split(/[\s._-]+/).filter(Boolean);
  const initials = (parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase() || '?';
  const tone = AVATAR_TONES[[...name].reduce((h, c) => h + c.charCodeAt(0), 0) % AVATAR_TONES.length];
  return { initials, tone, label: raw || 'unknown' };
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

  const [view, setView]                       = useState<'approvals' | 'activity' | 'procs'>('approvals');
  const [moduleFilter, setModuleFilter]       = useState<string>('ALL');
  const [statusFilter, setStatusFilter]       = useState<string>('All');
  const [search, setSearch]                   = useState('');
  const [picked, setPicked]                   = useState<Set<string>>(new Set());
  const [bulkRunning, setBulkRunning]         = useState(false);
  const [apiModalOpen, setApiModalOpen]       = useState(false);
  const [approvalApiModalOpen, setApprovalApiModalOpen] = useState(false);
  const [detailNotif, setDetailNotif]         = useState<AppNotification | null>(null);
  const [actingId, setActingId]               = useState<string | null>(null);
  const navigate = useNavigate();

  const approvals = notifications.filter(n => n.module === 'Approvals');
  const activity = notifications.filter(n => n.module !== 'Approvals');
  const activityUnread = activity.filter(n => n.status === 'Unread').length;
  const q = search.trim().toLowerCase();
  const matches = (n: AppNotification) => !q || [n.trxNo, n.approvalDescription, n.details, n.requestedByName, n.approvalModule, n.transaction]
    .some(v => String(v ?? '').toLowerCase().includes(q));
  const shownApprovals = approvals
    .filter(n => moduleFilter === 'ALL' || String(n.approvalModule).toUpperCase() === moduleFilter)
    .filter(matches)
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  const shownActivity = activity
    .filter(n => moduleFilter === 'ALL' || n.module === moduleFilter)
    .filter(n => statusFilter === 'All' || n.status === statusFilter)
    .filter(matches);
  const pending = approvals.filter(n => n.status !== 'Actioned');
  const totals = Object.entries(pending.reduce<Record<string, number>>((t, n) => {
    if (n.approvalAmount == null || !Number.isFinite(Number(n.approvalAmount))) return t;
    const c = n.approvalCurrency || '—';
    t[c] = (t[c] || 0) + Number(n.approvalAmount);
    return t;
  }, {})).sort((a, b) => b[1] - a[1]);
  const moduleCounts = Object.entries(pending.reduce<Record<string, number>>((t, n) => {
    const m = String(n.approvalModule || 'OTHER').toUpperCase(); t[m] = (t[m] || 0) + 1; return t;
  }, {})).sort((a, b) => b[1] - a[1]);
  const activityModules = [...new Set(activity.map(n => n.module))];
  const oldest = pending.reduce<string | undefined>((o, n) => (!o || (n.date && n.date < o) ? n.date : o), undefined);

  const switchView = (v: typeof view) => { setView(v); setModuleFilter('ALL'); setSearch(''); setPicked(new Set()); };

  const handleApprove = async (notif: AppNotification) => {
    if (!notif.approvalRequestId) return;
    setActingId(notif.id);
    try {
      // a journal approval also posts it; a cash approval starts its accounting (both reported in the note)
      const r = await approveNotification(notif.approvalRequestId, notif.id);
      setDetailNotif(null);
      if (r?.warn) {
        Modal.warning({
          title: `${notif.trxNo} approved, but not posted`, width: 540,
          content: <div>
            <p style={{ marginBottom: 6 }}>{cleanDbMessage(String(r.note || '').replace(/^.*approved, but not posted:\s*/i, '')) || 'The journal could not be posted.'}</p>
            <p style={{ marginTop: 8, color: '#8c8c8c', fontSize: 12 }}>It stays approved — post it from the GL dashboard or Manage Journals once fixed.</p>
          </div>,
        });
      } else if (notif.approvalModule !== 'CASH') {
        message.success(`${r?.note ? `${notif.trxNo} ${r.note}` : `Approved: ${notif.trxNo}`}`);
      }
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

  // several at once — one after the other; each does what its own Approve does (post / account)
  const approvePicked = async () => {
    const list = shownApprovals.filter(n => picked.has(n.id) && n.approvalRequestId && n.status !== 'Actioned');
    if (!list.length) return;
    setBulkRunning(true);
    let ok = 0;
    const issues: string[] = [];
    for (const n of list) {
      setActingId(n.id);
      try {
        const r = await approveNotification(n.approvalRequestId!, n.id);
        ok += 1;
        if (r?.warn) issues.push(`${n.trxNo}: ${cleanDbMessage(String(r.note || ''))}`);
      } catch (e: any) {
        issues.push(`${n.trxNo}: ${e?.message || 'approve failed'}`);
      }
    }
    setActingId(null); setBulkRunning(false); setPicked(new Set());
    if (issues.length) {
      Modal.warning({ title: `${ok} of ${list.length} approved`, width: 560,
        content: <ul style={{ paddingLeft: 18, margin: '6px 0 0' }}>{issues.map((x, i) => <li key={i} style={{ fontSize: 12 }}>{x}</li>)}</ul> });
    } else message.success(`${ok} request${ok === 1 ? '' : 's'} approved`);
  };

  const isLoading = pdcChecking || approvalChecking;
  const refreshAll = () => { refreshApprovalNotifications(); refreshPdcNotifications(); };
  const openDetail = (n: AppNotification) => { markRead(n.id); setDetailNotif(n); };
  const togglePick = (id: string, on: boolean) => setPicked(prev => { const nx = new Set(prev); if (on) nx.add(id); else nx.delete(id); return nx; });

  const approvalCard = (n: AppNotification) => {
    const look = lookOf(n.approvalModule);
    const who = person(n.requestedByName);
    const busy = actingId === n.id;
    const done = n.status === 'Actioned';
    const amount = n.approvalAmount != null && Number.isFinite(Number(n.approvalAmount)) ? Number(n.approvalAmount) : null;
    return (
      <div key={n.id} className={`np-card${n.status === 'Unread' ? ' np-unread' : ''}${done ? ' np-done' : ''}${picked.has(n.id) ? ' np-picked' : ''}`}
        onClick={() => openDetail(n)}>
        <div onClick={e => e.stopPropagation()} style={{ paddingTop: 10 }}>
          <Checkbox checked={picked.has(n.id)} disabled={done || bulkRunning} onChange={e => togglePick(n.id, e.target.checked)} />
        </div>
        <div className="np-icon" style={{ color: look.color, background: look.bg }}>{look.icon}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
            <Text strong style={{ fontSize: 14, color: '#1f1f1f', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.trxNo || '—'}</Text>
            <span style={{ fontSize: 11, color: look.color, fontWeight: 600, whiteSpace: 'nowrap' }}>{look.label}</span>
            {n.approvalTransactionType && <span style={{ fontSize: 11, color: '#8c8c8c', whiteSpace: 'nowrap' }}>· {String(n.approvalTransactionType).replace(/_/g, ' ').toLowerCase()}</span>}
          </div>
          <div style={{ fontSize: 13, color: '#434343', margin: '2px 0 6px', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
            {n.approvalDescription || <span style={{ color: '#bfbfbf' }}>No description</span>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#8c8c8c' }}>
            <span className="np-avatar" style={{ background: who.tone }}>{who.initials}</span>
            <span style={{ color: '#595959', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{who.label}</span>
            <span>·</span>
            <Tooltip title={n.date ? dayjs(n.date).format('D MMM YYYY HH:mm') : ''}><span style={{ whiteSpace: 'nowrap' }}>{ago(n.date)}</span></Tooltip>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8, flexShrink: 0 }}>
          {amount != null ? (
            <div style={{ textAlign: 'right', lineHeight: 1.2 }}>
              <div style={{ fontSize: 11, color: '#8c8c8c', letterSpacing: 0.4 }}>{n.approvalCurrency}</div>
              <div style={{ fontSize: 17, fontWeight: 600, color: '#1f1f1f', fontVariantNumeric: 'tabular-nums' }}>{money2(amount)}</div>
            </div>
          ) : <span />}
          {done ? (
            <Tag color="success" icon={<CheckCircleOutlined />} style={{ margin: 0 }}>Done</Tag>
          ) : (
            <Space size={6} onClick={e => e.stopPropagation()}>
              <Tooltip title="Details and lines"><Button size="small" type="text" icon={<EyeOutlined />} onClick={() => openDetail(n)} /></Tooltip>
              <Tooltip title="Reject — with a reason"><Button size="small" danger icon={<StopOutlined />} disabled={busy || bulkRunning} onClick={() => openDetail(n)} /></Tooltip>
              <Button size="small" type="primary" loading={busy} disabled={bulkRunning && !busy} icon={<CheckCircleOutlined />}
                style={{ background: '#1D7B4D', borderColor: '#1D7B4D' }} onClick={() => handleApprove(n)}>
                {approveLabel(n.approvalModule)}
              </Button>
            </Space>
          )}
        </div>
      </div>
    );
  };

  const activityCard = (n: AppNotification) => (
    <div key={n.id} className={`np-card${n.status === 'Unread' ? ' np-unread' : ''}`} onClick={() => n.status === 'Unread' && markRead(n.id)}>
      <div className="np-icon" style={{ background: '#f5f5f5', fontSize: 16 }}>{SEVERITY_ICON[n.severity || 'info']}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <Text strong style={{ fontSize: 13 }}>{n.transaction}</Text>
          {n.trxNo && <span style={{ fontSize: 12, color: '#0572CE' }}>{n.trxNo}</span>}
          <Tag color={MODULE_COLOR[n.module] || 'default'} style={{ fontSize: 10, margin: 0, lineHeight: '16px' }}>{n.module}</Tag>
        </div>
        <div style={{ fontSize: 13, color: n.severity === 'error' ? '#C74634' : '#434343', marginTop: 2 }}>{n.details}</div>
        <div style={{ fontSize: 12, color: '#8c8c8c', marginTop: 4 }}>{ago(n.date) || (n.date ? dayjs(n.date).format('D MMM YYYY') : '')}</div>
      </div>
      {n.status === 'Unread' && (
        <Tooltip title="Mark as read">
          <Button size="small" type="text" icon={<CheckOutlined style={{ color: '#1D7B4D' }} />} onClick={e => { e.stopPropagation(); markRead(n.id); }} />
        </Tooltip>
      )}
    </div>
  );

  const grouped = (list: AppNotification[], card: (n: AppNotification) => React.ReactNode) =>
    ['Today', 'Yesterday', 'Earlier'].map(g => {
      const items = list.filter(n => dayGroup(n.date) === g);
      if (!items.length) return null;
      return (
        <div key={g} style={{ marginBottom: 14 }}>
          <div className="np-group">{g}<span>{items.length}</span></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{items.map(card)}</div>
        </div>
      );
    });

  const emptyState = (title: string, sub: string) => (
    <div style={{ textAlign: 'center', padding: '56px 16px', color: '#8c8c8c' }}>
      {isLoading ? <Spin tip="Checking…" /> : <>
        <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#e8f5ee', color: '#1D7B4D', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, marginBottom: 12 }}>
          <CheckCircleOutlined />
        </div>
        <div style={{ fontSize: 15, fontWeight: 600, color: '#262626' }}>{title}</div>
        <div style={{ fontSize: 13, marginTop: 4 }}>{sub}</div>
      </>}
    </div>
  );

  const pickable = shownApprovals.filter(n => n.status !== 'Actioned' && n.approvalRequestId);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      closable={false}
      width={760}
      styles={{ header: { padding: '14px 20px', borderBottom: '1px solid #f0f0f0' }, body: { padding: 0, background: '#f6f7f9', display: 'flex', flexDirection: 'column' } }}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: '#f1ebfa', color: '#6d3fb8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>
            <BellOutlined />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#1f1f1f', lineHeight: 1.3 }}>Notifications</div>
            <div style={{ fontSize: 12, color: '#8c8c8c', fontWeight: 400 }}>
              {pendingApprovalCount ? <><b style={{ color: '#ad6800' }}>{pendingApprovalCount}</b> waiting for your decision</> : 'Nothing waiting for your decision'}
              {activityUnread ? <> · {activityUnread} unread update{activityUnread === 1 ? '' : 's'}</> : null}
            </div>
          </div>
          <Space size={2}>
            <Tooltip title="Refresh"><Button type="text" icon={<ReloadOutlined spin={isLoading} />} onClick={refreshAll} /></Tooltip>
            <Tooltip title="Mark all read"><Button type="text" icon={<CheckOutlined />} onClick={markAllRead} disabled={unreadCount === 0} /></Tooltip>
            <Dropdown trigger={['click']} menu={{
              items: [
                { key: 'appr-api', icon: <ApiOutlined style={{ color: lastApprovalApiCall ? (String(lastApprovalApiCall.status).startsWith('2') ? '#1D7B4D' : '#C74634') : undefined }} />,
                  label: `Approval API inspector${lastApprovalApiCall ? ` · HTTP ${lastApprovalApiCall.status}` : ''}`, onClick: () => setApprovalApiModalOpen(true) },
                { key: 'pdc-api', icon: <ApiOutlined />, label: 'PDC maturity API inspector', onClick: () => setApiModalOpen(true) },
                { type: 'divider' },
                { key: 'clear', icon: <DeleteOutlined />, danger: true, label: 'Clear all notifications', disabled: notifications.length === 0, onClick: clearAll },
              ],
            }}>
              <Button type="text" icon={<MoreOutlined />} />
            </Dropdown>
            <Tooltip title="Close"><Button type="text" icon={<CloseOutlined />} onClick={onClose} /></Tooltip>
          </Space>
        </div>
      }
    >
      <div style={{ padding: '12px 20px 0', background: '#fff', borderBottom: '1px solid #f0f0f0' }}>
        <Segmented block value={view} onChange={v => switchView(v as typeof view)} style={{ marginBottom: 12 }}
          options={[
            { value: 'approvals', label: <span><AuditOutlined /> Approvals{pendingApprovalCount ? <span className="np-count np-count-warn">{pendingApprovalCount}</span> : null}</span> },
            { value: 'activity', label: <span><BellOutlined /> Activity{activityUnread ? <span className="np-count">{activityUnread}</span> : null}</span> },
            { value: 'procs', label: <span><ThunderboltOutlined /> Processes</span> },
          ]} />
      </div>

      {view === 'procs' ? (
        <div style={{ padding: 16, overflow: 'auto', flex: 1 }}><ProcessMonitor active={open && view === 'procs'} /></div>
      ) : (
        <div style={{ flex: 1, overflow: 'auto', padding: '14px 20px 20px' }}>
          {view === 'approvals' && pending.length > 0 && (
            <div className="np-hero">
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 28, fontWeight: 600, color: '#1f1f1f', lineHeight: 1 }}>{pending.length}</span>
                <span style={{ fontSize: 13, color: '#595959' }}>waiting for your decision{oldest ? ` · oldest ${ago(oldest)}` : ''}</span>
              </div>
              {totals.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', marginTop: 8 }}>
                  {totals.map(([c, v]) => (
                    <span key={c} style={{ fontSize: 13, color: '#262626', fontVariantNumeric: 'tabular-nums' }}>
                      <span style={{ color: '#8c8c8c', fontSize: 11, marginRight: 4 }}>{c}</span>{money2(v)}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <Input allowClear size="middle" prefix={<SearchOutlined style={{ color: '#bfbfbf' }} />} value={search} onChange={e => setSearch(e.target.value)}
              placeholder={view === 'approvals' ? 'Search reference or requester' : 'Search updates'} style={{ flex: '1 1 220px', maxWidth: 320 }} />
            <div style={{ display: (view === 'approvals' ? pending.length : activity.length) ? 'flex' : 'none', gap: 6, flexWrap: 'wrap' }}>
              {(view === 'approvals' ? [['ALL', pending.length] as [string, number], ...moduleCounts] : [['ALL', activity.length] as [string, number], ...activityModules.map(m => [m, activity.filter(n => n.module === m).length] as [string, number])])
                .map(([m, c]) => {
                  const active = moduleFilter === m;
                  const label = m === 'ALL' ? 'All' : view === 'approvals' ? lookOf(m).label : m;
                  return (
                    <button key={m} className={`np-chip${active ? ' np-chip-on' : ''}`} onClick={() => setModuleFilter(m)}>
                      {label}<span>{c}</span>
                    </button>
                  );
                })}
            </div>
            {view === 'activity' && (
              <Select size="small" value={statusFilter} onChange={setStatusFilter} style={{ width: 110, marginLeft: 'auto' }}
                options={[{ value: 'All', label: 'All status' }, { value: 'Unread', label: 'Unread' }, { value: 'Read', label: 'Read' }, { value: 'Actioned', label: 'Actioned' }]} />
            )}
            {view === 'approvals' && pickable.length > 1 && (
              <Checkbox style={{ marginLeft: 'auto', fontSize: 12 }} disabled={bulkRunning}
                checked={pickable.every(n => picked.has(n.id))} indeterminate={picked.size > 0 && !pickable.every(n => picked.has(n.id))}
                onChange={e => setPicked(e.target.checked ? new Set(pickable.map(n => n.id)) : new Set())}>Select all</Checkbox>
            )}
          </div>

          {view === 'approvals'
            ? (shownApprovals.length ? grouped(shownApprovals, approvalCard)
              : emptyState(q || moduleFilter !== 'ALL' ? 'No matching requests' : "You're all caught up", q || moduleFilter !== 'ALL' ? 'Clear the search or filter to see everything.' : 'No approvals are waiting for you.'))
            : (shownActivity.length ? grouped(shownActivity, activityCard) : emptyState('No updates', 'PDC maturities and other alerts show up here.'))}
        </div>
      )}

      {view === 'approvals' && picked.size > 0 && (
        <div className="np-bulk">
          <span style={{ fontSize: 13 }}><b>{picked.size}</b> selected</span>
          <Space>
            <Button size="small" type="text" style={{ color: '#d9d9d9' }} disabled={bulkRunning} onClick={() => setPicked(new Set())}>Clear</Button>
            <Button size="small" type="primary" loading={bulkRunning} icon={<CheckCircleOutlined />} style={{ background: '#1D7B4D', borderColor: '#1D7B4D' }} onClick={approvePicked}>
              Approve {picked.size}
            </Button>
          </Space>
        </div>
      )}

      <style>{`
        .np-hero { background: #fff; border: 1px solid #f0f0f0; border-radius: 12px; padding: 14px 16px; margin-bottom: 12px; box-shadow: 0 1px 2px rgba(0,0,0,0.03); }
        .np-card { position: relative; display: flex; gap: 12px; align-items: stretch; background: #fff; border: 1px solid #ececec; border-radius: 12px; padding: 12px 14px 12px 12px; cursor: pointer; transition: box-shadow .15s, border-color .15s, transform .15s; }
        .np-card:hover { border-color: #d6e4f7; box-shadow: 0 4px 14px rgba(15,23,42,0.07); }
        .np-unread::before { content: ''; position: absolute; left: -1px; top: 12px; bottom: 12px; width: 3px; border-radius: 0 3px 3px 0; background: #2a78d6; }
        .np-picked { border-color: #2a78d6; background: #f7fbff; }
        .np-done { opacity: .6; }
        .np-icon { width: 40px; height: 40px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 18px; flex-shrink: 0; margin-top: 2px; }
        .np-avatar { width: 20px; height: 20px; border-radius: 50%; color: #fff; font-size: 9px; font-weight: 600; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .np-group { font-size: 11px; font-weight: 600; letter-spacing: .6px; text-transform: uppercase; color: #8c8c8c; margin: 4px 2px 8px; display: flex; align-items: center; gap: 6px; }
        .np-group span { background: #ececec; color: #595959; border-radius: 10px; padding: 0 7px; font-size: 10px; letter-spacing: 0; }
        .np-chip { border: 1px solid #e5e5e5; background: #fff; color: #434343; border-radius: 16px; padding: 3px 10px; font-size: 12px; cursor: pointer; display: inline-flex; gap: 6px; align-items: center; transition: all .15s; }
        .np-chip span { color: #8c8c8c; font-size: 11px; }
        .np-chip:hover { border-color: #2a78d6; color: #2a78d6; }
        .np-chip-on { background: #2a78d6; border-color: #2a78d6; color: #fff; }
        .np-chip-on span, .np-chip-on:hover { color: #fff; }
        .np-count { margin-left: 6px; background: #e6f0fb; color: #1c5cab; border-radius: 10px; padding: 0 7px; font-size: 11px; font-weight: 600; }
        .np-count-warn { background: #fff4e0; color: #ad6800; }
        .np-bulk { position: sticky; bottom: 0; display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 10px 20px; background: #1f1f1f; color: #fff; }
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
