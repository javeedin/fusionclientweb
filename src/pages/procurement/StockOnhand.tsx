import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  Layout, Breadcrumb, Card, Table, Button, Tag, Typography, Space, Tooltip, Spin,
  Row, Col, message, Modal, Empty, Select, Input, Tabs, InputNumber, DatePicker, Segmented, Alert, Progress,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  HomeOutlined, DatabaseOutlined, SearchOutlined, ApiOutlined, ReloadOutlined,
  LoginOutlined, LogoutOutlined, CheckCircleTwoTone, CloseCircleTwoTone, ThunderboltOutlined, SyncOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import dayjs, { Dayjs } from 'dayjs';
import { FUSION_POD_HOST, FUSION_POD_AUTH } from '../../config/fusionInstance';
import { getCurrentCompany } from '../../config/company.config';

const { Content } = Layout;

// Get Fusion base URL from current company configuration
const getFusionBase = () => {
  const company = getCurrentCompany();
  return company.fusionBaseUrl ? `${company.fusionBaseUrl}/fscmRestApi/resources/11.13.18.05` : '';
};
const { Title, Text } = Typography;

const FUSION_BASE = `${getFusionBase()}`;
const AUTH_HEADER = FUSION_POD_AUTH;
const FUSION_HDRS = { Authorization: AUTH_HEADER, Accept: 'application/json' };
const JSON_HDRS = { ...FUSION_HDRS, 'Content-Type': 'application/json' };
const ONHAND_URL = `${FUSION_BASE}/inventoryOnhandBalances`;
const ITEMS_URL = `${FUSION_BASE}/itemsV2`;
const STAGED_TXN_URL = `${FUSION_BASE}/inventoryStagedTransactions`;
// Synchronous processing: the Transaction Manager SOAP service lives on the same host
// under /fscmService (not /fscmRestApi). In Electron we call the host directly.
// insertAndProcessInterfaceRows both inserts the interface rows AND processes them.
const FUSION_HOST = FUSION_BASE.replace(/\/fscmRestApi\/.*$/, '');
const SOAP_TXN_URL = `${FUSION_HOST}/fscmService/TransactionManagerServiceV2`;
const SOAP_TYP_NS = 'http://xmlns.oracle.com/apps/scm/inventory/materialTransactions/pendingTransactions/transactionManagerServiceV2/types/';
const SOAP_STAG_NS = 'http://xmlns.oracle.com/apps/scm/inventory/materialTransactions/pendingTransactions/stagedInventoryTransactionServiceV2/';
const SOAP_ACTION = 'http://xmlns.oracle.com/apps/scm/inventory/materialTransactions/pendingTransactions/transactionManagerServiceV2/insertAndProcessInterfaceRows';

const REDWOOD = {
  primary: '#C74634', success: '#1D7B4D', warning: '#B07700', info: '#0572CE',
  error: '#D93025', teal: '#00918A', purple: '#7245A6',
  neutral100: '#F7F7F7', neutral200: '#E5E5E5', neutral300: '#C7C7C7',
  neutral600: '#6B6B6B', neutral900: '#1A1A1A', surface: '#FFFFFF',
};

const pf = (o: any, keys: string[]) => { for (const k of keys) { if (o?.[k] != null && o[k] !== '') return o[k]; } return undefined; };
const num = (v: any) => { const n = Number(v); return isNaN(n) ? 0 : n; };
// Miscellaneous issues (and negative/FOC types) post a NEGATIVE quantity to the interface;
// receipts and subinventory transfers post positive. Sign the qty by transaction type name.
const signedQty = (typeName: string, qty: number) => /issue|negative|foc/i.test(typeName || '') ? -Math.abs(num(qty)) : Math.abs(num(qty));
// Unique-enough stamp to tag a post batch so we can poll its interface rows back.
const txnStamp = () => Date.now();
const fmtQty = (v: any) => v == null || isNaN(Number(v)) ? '—' : new Intl.NumberFormat('en-US').format(Number(v));
const onhQtyOf = (b: any) => num(pf(b, ['PrimaryQuantity', 'PrimaryTransactionQuantity', 'PrimaryOnhandQuantity', 'OnhandQuantity', 'TransactionPrimaryQuantity', 'Quantity']));
const errOf = (data: any, text: string) =>
  data?.['o:errorDetails']?.[0]?.detail ?? data?.detail ?? data?.message ?? (text || '').slice(0, 300);

const mapLimit = async <T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> => {
  const out: R[] = new Array(items.length); let idx = 0;
  const worker = async () => { while (idx < items.length) { const c = idx++; out[c] = await fn(items[c], c); } };
  await Promise.all(Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, worker));
  return out;
};
const fetchJson = async (url: string) => { const r = await fetch(url, { headers: FUSION_HDRS }); return r.ok ? r.json() : null; };
const getItemMeta = async (item: string, org: string) =>
  (await fetchJson(`${ITEMS_URL}?q=OrganizationCode=${org};ItemNumber=${encodeURIComponent(item)}&limit=1&onlyData=true`))?.items?.[0] ?? null;

// Extract a processing error off an interface row, if any.
const rowError = (row: any): string | null => {
  const e = row?.ErrorExplanation ?? row?.ErrorCode ?? row?.error ?? null;
  return e != null && String(e).trim() ? String(e).trim() : null;
};

// Query one staged row back by its writable source keys (SourceCode/SourceHeaderId/SourceLineId).
const stagedQuery = (srcHeader: number, srcLine: number) =>
  `${STAGED_TXN_URL}?q=SourceCode=ReactERP;SourceHeaderId=${srcHeader};SourceLineId=${srcLine}&onlyData=true&limit=1`;

// Poll a staged transaction after posting. inventoryStagedTransactions does not echo
// a usable key on POST, so we track the row by the unique SourceHeaderId/SourceLineId
// we sent. The Inventory Transaction Manager deletes the row once it processes it
// successfully (query returns 0 rows), or leaves it with an ErrorExplanation if it
// failed. Returns processed / error / pending.
const pollStagedBySource = async (srcHeader: number, srcLine: number, attempts = 10, delayMs = 3000): Promise<{ state: 'processed' | 'error' | 'pending'; message?: string }> => {
  const url = stagedQuery(srcHeader, srcLine);
  let everSeen = false;
  for (let i = 0; i < attempts; i++) {
    await new Promise(res => setTimeout(res, delayMs));
    try {
      const r = await fetch(url, { headers: FUSION_HDRS });
      if (!r.ok) continue;
      const d = await r.json();
      const row = (d?.items ?? [])[0];
      if (!row) {
        // Row gone from the interface — only "processed" if we had confirmed it landed there.
        if (everSeen) return { state: 'processed' };
        continue;
      }
      everSeen = true;
      const err = rowError(row);
      if (err) return { state: 'error', message: err };
      const flag = String(row.ProcessFlag ?? row.TransactionStatus ?? '');
      if (/error|fail/i.test(flag)) return { state: 'error', message: flag };
      if (/processed|complete|success/i.test(flag)) return { state: 'processed' };
    } catch { /* retry */ }
  }
  return { state: 'pending' };
};

// One immediate check of an interface row after a synchronous SOAP process:
// gone = posted into inventory, still present with an error = failed, else pending.
const checkStagedOnce = async (srcHeader: number, srcLine: number): Promise<{ state: 'processed' | 'error' | 'pending'; message?: string }> => {
  try {
    const r = await fetch(stagedQuery(srcHeader, srcLine), { headers: FUSION_HDRS });
    if (r.ok) { const d = await r.json(); const row = (d?.items ?? [])[0]; if (!row) return { state: 'processed' }; const e = rowError(row); if (e) return { state: 'error', message: e }; }
  } catch { /* ignore */ }
  return { state: 'pending' };
};

// One interface row for insertAndProcessInterfaceRows.
interface SoapTxnRow {
  trxId: number;            // unique TransactionInterfaceId / HeaderId / SourceHeaderId
  srcLine: number;          // SourceLineId
  itemNumber: string; itemId?: string;
  orgCode?: string; orgId?: string;
  subinv: string; transferSubinv?: string; transferOrgId?: string; transferOrgCode?: string;
  qty: number; uom: string; date: string; // date = YYYY-MM-DD
  txnTypeName: string; lot?: string;
}
const xesc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Build a TransactionManagerServiceV2 insertAndProcessInterfaceRows envelope. This single
// call stages the row(s) AND runs the transaction manager synchronously (tableType 1).
const buildTxnSoap = (r: SoapTxnRow, tableType: number, validationLevel: number): string => {
  const uom = r.uom || 'Ea';
  const q = signedQty(r.txnTypeName, r.qty); // issues go negative
  const qtyEl = (tag: string) => `<stag:${tag} unitCode="${xesc(uom)}">${q}</stag:${tag}>`;
  const lotBlock = r.lot ? `
        <stag:StagedInventoryTransactionLot>
          <stag:TransactionInterfaceId>${r.trxId}</stag:TransactionInterfaceId>
          <stag:LotNumber>${xesc(r.lot)}</stag:LotNumber>
          ${qtyEl('TransactionQuantity')}
          ${qtyEl('PrimaryQuantity')}
          <stag:StatusId>1</stag:StatusId>
        </stag:StagedInventoryTransactionLot>` : '';
  const transferBlock = r.transferSubinv ? `
        <stag:TransferSubinventory>${xesc(r.transferSubinv)}</stag:TransferSubinventory>` : '';
  const transferOrgBlock = r.transferOrgId ? `
        <stag:TransferOrganization>${xesc(r.transferOrgId)}</stag:TransferOrganization>`
    : r.transferOrgCode ? `
        <stag:TransferOrganizationCode>${xesc(r.transferOrgCode)}</stag:TransferOrganizationCode>` : '';
  const orgBlock = r.orgId ? `<stag:OrganizationId>${xesc(r.orgId)}</stag:OrganizationId>`
    : `<stag:OrganizationCode>${xesc(r.orgCode)}</stag:OrganizationCode>`;
  const itemIdBlock = r.itemId ? `
        <stag:InventoryItemId>${xesc(r.itemId)}</stag:InventoryItemId>` : '';
  return `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:typ="${SOAP_TYP_NS}" xmlns:stag="${SOAP_STAG_NS}">
  <soapenv:Header/>
  <soapenv:Body>
    <typ:insertAndProcessInterfaceRows>
      <typ:interfaceRows>
        <stag:TransactionInterfaceId>${r.trxId}</stag:TransactionInterfaceId>
        <stag:TransactionHeaderId>${r.trxId}</stag:TransactionHeaderId>
        <stag:SourceCode>ReactERP</stag:SourceCode>
        <stag:SourceLineId>${r.srcLine}</stag:SourceLineId>
        <stag:SourceHeaderId>${r.trxId}</stag:SourceHeaderId>
        <stag:ProcessCode>1</stag:ProcessCode>
        <stag:TransactionMode>3</stag:TransactionMode>${itemIdBlock}
        <stag:ItemNumber>${xesc(r.itemNumber)}</stag:ItemNumber>
        ${orgBlock}
        ${qtyEl('TransactionQuantity')}
        ${qtyEl('PrimaryQuantity')}
        <stag:TransactionUOM>${xesc(uom)}</stag:TransactionUOM>
        <stag:TransactionDate>${r.date}T00:00:00.000-00:00</stag:TransactionDate>
        <stag:SubinventoryCode>${xesc(r.subinv)}</stag:SubinventoryCode>${transferBlock}${transferOrgBlock}
        <stag:TransactionTypeName>${xesc(r.txnTypeName)}</stag:TransactionTypeName>
        <stag:UseCurrentCost>Y</stag:UseCurrentCost>${lotBlock}
      </typ:interfaceRows>
      <typ:headerId>${r.trxId}</typ:headerId>
      <typ:validationLevel>${validationLevel}</typ:validationLevel>
      <typ:tableType>${tableType}</typ:tableType>
    </typ:insertAndProcessInterfaceRows>
  </soapenv:Body>
</soapenv:Envelope>`;
};

// Returns the raw <result> code the service echoes: "0" = success, "-1" (or other) = error.
const callTxnManager = async (r: SoapTxnRow, tableType: number, validationLevel: number): Promise<{ ok: boolean; code: string | null; result: string; raw: string; envelope: string; httpStatus: number }> => {
  const envelope = buildTxnSoap(r, tableType, validationLevel);
  try {
    const resp = await fetch(SOAP_TXN_URL, { method: 'POST', headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: SOAP_ACTION, Authorization: AUTH_HEADER }, body: envelope });
    const raw = await resp.text();
    const fault = raw.match(/<faultstring>([\s\S]*?)<\/faultstring>/i)?.[1]?.trim();
    const code = raw.match(/<(?:\w+:)?result>([\s\S]*?)<\/(?:\w+:)?result>/i)?.[1]?.trim() ?? null;
    // insertAndProcessInterfaceRows echoes any processing error text in the response body.
    const errMsg = raw.match(/<(?:\w+:)?ErrorExplanation>([\s\S]*?)<\/(?:\w+:)?ErrorExplanation>/i)?.[1]?.trim()
      || raw.match(/<(?:\w+:)?ErrorMessage>([\s\S]*?)<\/(?:\w+:)?ErrorMessage>/i)?.[1]?.trim();
    if (fault) return { ok: false, code, result: fault, raw, envelope, httpStatus: resp.status };
    if (!resp.ok) return { ok: false, code, result: errMsg || `HTTP ${resp.status}`, raw, envelope, httpStatus: resp.status };
    const ok = code === '0' || (code == null && !errMsg);
    return { ok, code, result: errMsg || (code != null ? `returned ${code}` : 'Processed'), raw, envelope, httpStatus: resp.status };
  } catch (e: any) { return { ok: false, code: null, result: e?.message ?? String(e), raw: '', envelope, httpStatus: 0 }; }
};

interface OrgOpt { code: string; name: string; id?: string; }
const ALL_ORGS = '__ALL__';
type TxnMethod = 'rest' | 'soap';

// ─────────────────────────────────────────────────────────────────────────────
// Search on-hand
// ── Inventory-transaction modal — issue / receive / subinventory transfer ─────
type TxnKind = 'issue' | 'receipt' | 'transfer';
const TX_TYPE_NAME: Record<TxnKind, string> = { issue: 'Miscellaneous issue', receipt: 'Miscellaneous receipt', transfer: 'Subinventory transfer' };
const TX_LABEL: Record<TxnKind, string> = { issue: 'Issue Out', receipt: 'Receive', transfer: 'Subinventory Transfer' };
interface TxnLine { key: string; item: string; org: string; orgId?: string; itemId?: string; fromSub: string; toSub: string; lot: string; uom?: string; avail: number; qty: number; srcLine?: number; status?: 'pending' | 'ok' | 'processed' | 'error'; message?: string; }

const TxnModal: React.FC<{ kind: TxnKind | null; rows: any[]; onClose: () => void; onDone: () => void }> = ({ kind, rows, onClose, onDone }) => {
  const [date, setDate] = useState<Dayjs>(dayjs());
  const [account, setAccount] = useState('');
  const [destSub, setDestSub] = useState<string>('');
  const [lines, setLines] = useState<TxnLine[]>([]);
  const [subinvs, setSubinvs] = useState<string[]>([]);
  const [posting, setPosting] = useState(false);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [method, setMethod] = useState<TxnMethod>('rest');
  const [tableType, setTableType] = useState(1);
  const [validationLevel, setValidationLevel] = useState(1);
  const [soapResp, setSoapResp] = useState<{ envelope: string; raw: string } | null>(null);
  const [dirty, setDirty] = useState(false);

  // Refresh the parent on-hand list only when the dialog is dismissed, so posting
  // results (statuses + errors) stay visible on screen until the user closes it.
  const handleClose = () => { onClose(); if (dirty) onDone(); };

  useEffect(() => {
    if (!kind) return;
    setPosting(false); setDestSub(''); setAccount(''); setSoapResp(null); setDirty(false);
    setLines(rows.map((r, i) => ({
      key: `l-${i}`, item: pf(r, ['ItemNumber']) ?? '', org: pf(r, ['OrganizationCode']) ?? '',
      orgId: pf(r, ['OrganizationId']) != null ? String(pf(r, ['OrganizationId'])) : undefined,
      itemId: pf(r, ['InventoryItemId']) != null ? String(pf(r, ['InventoryItemId'])) : undefined,
      fromSub: pf(r, ['SubinventoryCode']) ?? '', toSub: '', lot: pf(r, ['LotNumber']) ?? '',
      uom: pf(r, ['PrimaryUOMCode', 'PrimaryUnitOfMeasure', 'UOMCode']), avail: onhQtyOf(r), qty: onhQtyOf(r),
    })));
  }, [kind, rows]);

  const org = pf(rows[0] ?? {}, ['OrganizationCode']);
  const multiOrg = new Set(rows.map(r => pf(r, ['OrganizationCode']))).size > 1;
  useEffect(() => {
    if (!kind || kind !== 'transfer' || !org) return;
    fetchJson(`${FUSION_BASE}/subinventories?q=OrganizationCode=${encodeURIComponent(org)}&onlyData=true&limit=500`)
      .then(d => setSubinvs(Array.from(new Set((d?.items ?? []).map((i: any) => i.SecondaryInventoryName).filter(Boolean))) as string[]))
      .catch(() => setSubinvs([]));
  }, [kind, org]);

  const upd = (key: string, patch: Partial<TxnLine>) => setLines(prev => prev.map(l => l.key === key ? { ...l, ...patch } : l));
  const buildBody = (l: TxnLine, srcHeader?: number, txnHeader?: number): Record<string, any> => {
    const body: Record<string, any> = {
      TransactionTypeName: TX_TYPE_NAME[kind!],
      SourceCode: 'ReactERP', SourceHeaderId: srcHeader ?? 0, SourceLineId: l.srcLine ?? 0,
      OrganizationCode: l.org, ItemNumber: l.item,
      SubinventoryCode: l.fromSub,
      TransactionQuantity: signedQty(TX_TYPE_NAME[kind!], l.qty),
      TransactionUnitOfMeasure: l.uom || undefined,
      TransactionDate: date.format('YYYY-MM-DDTHH:mm:ss'),
    };
    if (txnHeader) body.TransactionHeaderId = txnHeader;
    if (kind === 'transfer') body.TransferSubinventoryCode = destSub || l.toSub;
    if (kind !== 'transfer' && account.trim()) body.DistributionAccountCombination = account.trim();
    if (l.lot) body.lotItemLots = [{ LotNumber: l.lot, TransactionQuantity: signedQty(TX_TYPE_NAME[kind!], l.qty) }];
    return body;
  };

  const soapRowOf = (l: TxnLine, trxId: number, srcLine: number): SoapTxnRow => ({
    trxId, srcLine, itemNumber: l.item, itemId: l.itemId, orgCode: l.org, orgId: l.orgId,
    subinv: l.fromSub, qty: num(l.qty), uom: l.uom || '', date: date.format('YYYY-MM-DD'),
    txnTypeName: TX_TYPE_NAME[kind!], lot: l.lot || undefined,
    transferSubinv: kind === 'transfer' ? (destSub || l.toSub) : undefined,
  });

  const post = async () => {
    if (kind === 'transfer' && !destSub && lines.every(l => !l.toSub)) { message.warning('Choose a destination subinventory'); return; }
    const targets = lines.filter(l => num(l.qty) > 0 && !l.status);
    if (!targets.length) { message.warning('Nothing to post'); return; }
    setPosting(true); setSoapResp(null);
    const base = txnStamp();

    // SOAP: one insertAndProcessInterfaceRows call per line — stages AND processes instantly.
    if (method === 'soap') {
      message.info('Processing instantly via Transaction Manager…');
      let last: { envelope: string; raw: string } | null = null; let idx = 0;
      for (const l of targets) {
        const trxId = base + idx, srcLine = idx; idx++;
        l.srcLine = srcLine; upd(l.key, { status: 'pending', srcLine });
        const res = await callTxnManager(soapRowOf(l, trxId, srcLine), tableType, validationLevel);
        last = { envelope: res.envelope, raw: res.raw };
        const chk = await checkStagedOnce(trxId, srcLine);
        const codeTxt = res.code != null ? `result ${res.code}` : (res.httpStatus ? `HTTP ${res.httpStatus}` : 'no result');
        const detail = chk.state === 'error' ? chk.message : (res.ok ? '' : res.result);
        if (res.ok && chk.state !== 'error') upd(l.key, { status: 'processed', message: `SOAP ${codeTxt} — processed into inventory` });
        else upd(l.key, { status: 'error', message: `SOAP ${codeTxt}${detail ? ' — ' + detail : ''}` });
      }
      if (last) setSoapResp(last);
      setPosting(false); setDirty(true);
      return;
    }

    // REST: stage to the interface, then rely on the background transaction manager.
    const srcHeader = base;
    const staged: { key: string; srcLine: number }[] = [];
    let idx = 0;
    for (const l of targets) {
      const srcLine = idx++;
      l.srcLine = srcLine; upd(l.key, { status: 'pending', srcLine });
      try {
        const r = await fetch(STAGED_TXN_URL, { method: 'POST', headers: JSON_HDRS, body: JSON.stringify(buildBody(l, srcHeader)) });
        const txt = await r.text(); let d: any = null; try { d = JSON.parse(txt); } catch { /* raw */ }
        if (r.ok) { upd(l.key, { status: 'ok', message: 'Submitted to interface…' }); staged.push({ key: l.key, srcLine }); }
        else upd(l.key, { status: 'error', message: errOf(d, txt) });
      } catch (e: any) { upd(l.key, { status: 'error', message: e?.message ?? String(e) }); }
    }
    if (!staged.length) { setPosting(false); message.error('Nothing was staged — see per-line errors'); return; }
    setPosting(false);
    message.info('Submitted to the interface — checking processing status…');
    await Promise.all(staged.map(async s => {
      const res = await pollStagedBySource(srcHeader, s.srcLine);
      upd(s.key, res.state === 'processed' ? { status: 'processed', message: 'Processed into inventory' }
        : res.state === 'error' ? { status: 'error', message: res.message }
        : { status: 'ok', message: 'Submitted — still pending in interface (transaction manager not run yet)' });
    }));
    setDirty(true);
  };

  const cols: ColumnsType<TxnLine> = [
    { title: 'Item', dataIndex: 'item', width: 160, render: v => <Text strong>{v}</Text> },
    { title: 'Org', dataIndex: 'org', width: 120, render: v => <Tag>{v}</Tag> },
    { title: kind === 'transfer' ? 'From Subinv' : 'Subinventory', dataIndex: 'fromSub', width: 130, render: v => v ? <Tag color="cyan">{v}</Tag> : '—' },
    ...(kind === 'transfer' ? [{ title: 'To Subinv', dataIndex: 'toSub', width: 150, render: (_: any, l: TxnLine) => (
        <Select size="small" showSearch allowClear style={{ width: 130 }} value={l.toSub || destSub || undefined} placeholder="Dest"
          options={Array.from(new Set([...subinvs, l.toSub].filter(Boolean))).map(s => ({ value: s, label: s }))}
          onChange={x => upd(l.key, { toSub: x || '' })} /> ) } as any] : []),
    { title: 'Lot', dataIndex: 'lot', width: 130, render: v => v ? <Tag color="geekblue">{v}</Tag> : '—' },
    { title: 'Avail', dataIndex: 'avail', width: 80, align: 'right' as const, render: v => fmtQty(v) },
    { title: 'Qty', dataIndex: 'qty', width: 100, align: 'right' as const, render: (v, l) => <InputNumber size="small" min={0} max={kind === 'receipt' ? undefined : l.avail} value={v} onChange={n => upd(l.key, { qty: Number(n) || 0 })} style={{ width: 90 }} /> },
    { title: 'UOM', dataIndex: 'uom', width: 60, render: v => v ?? '—' },
    { title: 'Status', width: 240, render: (_, l) => l.status === 'pending' ? <Spin size="small" />
      : l.status === 'processed' ? <Tooltip title={l.message}><Tag color="green" icon={<CheckCircleTwoTone twoToneColor={REDWOOD.success} />} style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.message || 'Processed'}</Tag></Tooltip>
      : l.status === 'ok' ? <Tooltip title={l.message}><Tag color="processing" icon={<SyncOutlined spin />}>Processing…</Tag></Tooltip>
      : l.status === 'error' ? <Tooltip title={l.message}><Tag color="red" icon={<CloseCircleTwoTone twoToneColor={REDWOOD.error} />} style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.message}</Tag></Tooltip>
      : <Text type="secondary">—</Text> },
  ];

  return (
    <Modal open={!!kind} onCancel={() => { if (!posting) handleClose(); }} width={960} maskClosable={false}
      title={<Space>{kind === 'issue' ? <LogoutOutlined /> : kind === 'receipt' ? <LoginOutlined /> : <DatabaseOutlined />}{kind ? TX_LABEL[kind] : ''} — {rows.length} line(s)</Space>}
      footer={<Space>
        <Button onClick={handleClose} disabled={posting}>Close</Button>
        {lines.length > 0 && <Button icon={<ApiOutlined />} onClick={() => setJsonOpen(true)}>View JSON</Button>}
        <Button type="primary" loading={posting} onClick={post} icon={method === 'soap' ? <ThunderboltOutlined /> : undefined}
          style={{ background: kind === 'issue' ? REDWOOD.primary : REDWOOD.success, borderColor: kind === 'issue' ? REDWOOD.primary : REDWOOD.success }}>
          {kind ? TX_LABEL[kind] : ''}{method === 'soap' ? ' now' : ''}
        </Button>
      </Space>}>
      {multiOrg && <Alert type="warning" showIcon style={{ marginBottom: 10 }} message="Selected rows span multiple organizations — transactions post per row's own org." />}
      <div style={{ marginBottom: 10, padding: '8px 12px', background: REDWOOD.neutral100, borderRadius: 6, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Text style={{ fontSize: 12, fontWeight: 600 }}>Processing method</Text>
        <Segmented value={method} onChange={v => setMethod(v as TxnMethod)} options={[
          { label: 'REST — stage & let manager run', value: 'rest' },
          { label: 'SOAP — process instantly', value: 'soap' },
        ]} />
        {method === 'soap' && <>
          <Text type="secondary" style={{ fontSize: 12 }}>Table type</Text>
          <InputNumber size="small" value={tableType} onChange={n => setTableType(Number(n) || 0)} style={{ width: 80 }} />
          <Text type="secondary" style={{ fontSize: 12 }}>Validation</Text>
          <InputNumber size="small" value={validationLevel} onChange={n => setValidationLevel(Number(n) || 0)} style={{ width: 70 }} />
          <Tooltip title={`Calls TransactionManagerServiceV2.insertAndProcessInterfaceRows — stages and processes the row in one synchronous call. Endpoint: ${SOAP_TXN_URL}`}>
            <ThunderboltOutlined style={{ color: REDWOOD.warning }} />
          </Tooltip>
        </>}
      </div>
      <Row gutter={12} style={{ marginBottom: 10 }}>
        <Col xs={12} md={6}><div style={{ fontSize: 12, color: REDWOOD.neutral600, marginBottom: 4 }}>Transaction Date</div>
          <DatePicker style={{ width: '100%' }} value={date} onChange={d => d && setDate(d)} allowClear={false} /></Col>
        {kind === 'transfer'
          ? <Col xs={12} md={6}><div style={{ fontSize: 12, color: REDWOOD.neutral600, marginBottom: 4 }}>Destination subinventory (all)</div>
              <Select showSearch allowClear style={{ width: '100%' }} value={destSub || undefined} placeholder="Apply to all lines"
                options={subinvs.map(s => ({ value: s, label: s }))} onChange={v => setDestSub(v || '')} /></Col>
          : <Col xs={12} md={6}><div style={{ fontSize: 12, color: REDWOOD.neutral600, marginBottom: 4 }}>Account (optional)</div>
              <Input value={account} onChange={e => setAccount(e.target.value)} placeholder="Code combination" /></Col>}
      </Row>
      <Table size="small" rowKey="key" columns={cols} dataSource={lines} pagination={false} scroll={{ x: 900, y: 340 }} />
      {lines.some(l => l.status === 'error') && <Alert type="error" showIcon style={{ marginTop: 10 }}
        message={`${lines.filter(l => l.status === 'error').length} line(s) failed`}
        description={<ul style={{ margin: 0, paddingLeft: 18 }}>{lines.filter(l => l.status === 'error').map(l => <li key={l.key} style={{ fontSize: 12 }}><b>{l.item}</b>: {l.message}</li>)}</ul>} />}
      {lines.some(l => l.status === 'processed') && !lines.some(l => l.status === 'error') &&
        <Alert type="success" showIcon style={{ marginTop: 10 }} message={`${lines.filter(l => l.status === 'processed').length} line(s) processed`} />}
      {soapResp && <div style={{ marginTop: 10 }}>
        <Text style={{ fontSize: 12, fontWeight: 600 }}>Transaction Manager SOAP response</Text>
        <pre style={{ maxHeight: 160, overflow: 'auto', background: REDWOOD.neutral100, padding: 10, borderRadius: 6, fontSize: 11, marginTop: 4 }}>{soapResp.raw || '(empty response)'}</pre>
      </div>}
      <Modal open={jsonOpen} onCancel={() => setJsonOpen(false)} width={760} title="API payload" footer={<Button onClick={() => setJsonOpen(false)}>Close</Button>}>
        {method === 'rest'
          ? <><Text style={{ fontSize: 12, fontWeight: 600 }}>POST {STAGED_TXN_URL}</Text>
              <pre style={{ maxHeight: 380, overflow: 'auto', background: REDWOOD.neutral100, padding: 10, borderRadius: 6, fontSize: 11, marginTop: 4 }}>{JSON.stringify(lines.map((l, i) => buildBody({ ...l, srcLine: i }, 999)), null, 2)}</pre></>
          : <><Text style={{ fontSize: 12, fontWeight: 600 }}>POST {SOAP_TXN_URL} · insertAndProcessInterfaceRows (per line)</Text>
              <pre style={{ maxHeight: 420, overflow: 'auto', background: REDWOOD.neutral100, padding: 10, borderRadius: 6, fontSize: 11, marginTop: 4 }}>{lines[0] ? buildTxnSoap(soapRowOf(lines[0], 999, 0), tableType, validationLevel) : '(add lines to preview)'}</pre></>}
      </Modal>
    </Modal>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
const SearchOnhand: React.FC<{ orgs: OrgOpt[] }> = ({ orgs }) => {
  const [org, setOrg] = useState<string>(ALL_ORGS);
  const [itemsText, setItemsText] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [lastUrl, setLastUrl] = useState('');
  const [selKeys, setSelKeys] = useState<React.Key[]>([]);
  const [txnKind, setTxnKind] = useState<TxnKind | null>(null);
  const [filter, setFilter] = useState('');
  const [truncated, setTruncated] = useState(false);
  const selectedRows = rows.filter(r => selKeys.includes(r.__k));

  const run = useCallback(async () => {
    const nums = Array.from(new Set(itemsText.split(/\r?\n|,|\t|\s{2,}/).map(s => s.trim()).filter(Boolean)));
    const orgClause = org && org !== ALL_ORGS ? `OrganizationCode=${org}` : '';
    // No item numbers → list all on-hand for the org (requires a specific org, capped).
    if (!nums.length && !orgClause) { message.warning('Select an organization to list all its on-hand, or paste item numbers'); return; }
    setLoading(true); setErr(''); setSelKeys([]); setTruncated(false);
    try {
      const out: any[] = [];
      if (!nums.length) {
        const url = `${ONHAND_URL}?q=${orgClause}&limit=500&onlyData=true`;
        setLastUrl(url);
        const r = await fetch(url, { headers: FUSION_HDRS });
        if (r.ok) { const d = await r.json(); (d.items ?? []).forEach((b: any) => out.push(b)); if (d.hasMore) setTruncated(true); }
        else { const t = await r.text(); let j: any = null; try { j = JSON.parse(t); } catch { /* raw */ } setErr(errOf(j, t)); }
      } else {
        await mapLimit(nums, 6, async (n) => {
          const url = `${ONHAND_URL}?q=${orgClause ? orgClause + ';' : ''}ItemNumber=${encodeURIComponent(n)}&limit=500&onlyData=true`;
          setLastUrl(url);
          try { const r = await fetch(url, { headers: FUSION_HDRS }); if (r.ok) { const d = await r.json(); (d.items ?? []).forEach((b: any) => out.push(b)); } } catch { /* skip */ }
        });
      }
      out.sort((a, b) => String(pf(a, ['ItemNumber'])).localeCompare(String(pf(b, ['ItemNumber']))));
      out.forEach((r, i) => { r.__k = String(i); });
      setRows(out);
      if (!out.length && !err) message.info(nums.length ? 'No on-hand found for those items' : 'No on-hand found for this organization');
    } catch (e: any) { setErr(e?.message ?? String(e)); setRows([]); }
    finally { setLoading(false); }
  }, [org, itemsText]);

  const filteredRows = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return rows;
    const keys = ['ItemNumber', 'ItemDescription', 'OrganizationCode', 'SubinventoryCode', 'LocatorName', 'Locator', 'LotNumber', 'MaterialStatus'];
    return rows.filter(r => keys.some(k => String(pf(r, [k]) ?? '').toLowerCase().includes(f)));
  }, [rows, filter]);
  const total = useMemo(() => filteredRows.reduce((s, r) => s + onhQtyOf(r), 0), [filteredRows]);
  const cols: ColumnsType<any> = [
    { title: 'Item', dataIndex: 'ItemNumber', width: 170, render: (_, r) => <Text strong>{pf(r, ['ItemNumber'])}</Text> },
    { title: 'Description', width: 220, ellipsis: true, render: (_, r) => pf(r, ['ItemDescription']) ?? '—' },
    { title: 'Org', width: 130, render: (_, r) => <Tag>{pf(r, ['OrganizationCode'])}</Tag> },
    { title: 'Subinventory', width: 130, render: (_, r) => { const s = pf(r, ['SubinventoryCode']); return s ? <Tag color="cyan">{s}</Tag> : '—'; } },
    { title: 'Locator', width: 120, render: (_, r) => pf(r, ['LocatorName', 'Locator']) ?? '—' },
    { title: 'Lot', width: 150, render: (_, r) => { const l = pf(r, ['LotNumber']); return l ? <Tag color="geekblue">{l}</Tag> : '—'; } },
    { title: 'On-Hand', width: 110, align: 'right', render: (_, r) => <Text strong style={{ color: REDWOOD.success, fontVariantNumeric: 'tabular-nums' }}>{fmtQty(onhQtyOf(r))}</Text> },
    { title: 'UOM', width: 70, render: (_, r) => pf(r, ['PrimaryUOMCode', 'ItemPrimaryUOMCode', 'UOMCode']) ?? '—' },
    { title: 'Consigned', width: 90, align: 'right', render: (_, r) => { const c = num(pf(r, ['ConsignedQuantity'])); return c ? <Text style={{ fontSize: 12 }}>{fmtQty(c)}</Text> : '—'; } },
    { title: 'Status', width: 100, render: (_, r) => { const s = pf(r, ['MaterialStatus']); return s ? <Tag color={/active/i.test(String(s)) ? 'green' : 'default'}>{s}</Tag> : '—'; } },
  ];

  return (
    <div>
      <Row gutter={12} style={{ marginBottom: 12 }}>
        <Col xs={24} md={7}><div style={{ fontSize: 12, color: REDWOOD.neutral600, marginBottom: 4 }}>Organization</div>
          <Select showSearch style={{ width: '100%' }} value={org} onChange={setOrg} optionFilterProp="label"
            options={[{ value: ALL_ORGS, label: '— All organizations —' }, ...orgs.map(o => ({ value: o.code, label: `${o.code}${o.name ? ' — ' + o.name : ''}` }))]} /></Col>
        <Col xs={24} md={11}><div style={{ fontSize: 12, color: REDWOOD.neutral600, marginBottom: 4 }}>Item Numbers — paste one per line <Text type="secondary" style={{ fontSize: 11 }}>(leave blank to list all on-hand for the org)</Text></div>
          <Input.TextArea rows={4} value={itemsText} onChange={e => setItemsText(e.target.value)} style={{ fontFamily: 'monospace', fontSize: 12 }} placeholder={'460-BDXV\nDLPB14255-01\n\n(or leave blank for all items)'} /></Col>
        <Col xs={24} md={6} style={{ display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'flex-start' }}>
          <div style={{ fontSize: 12, marginBottom: 4 }}>&nbsp;</div>
          <Button type="primary" icon={<SearchOutlined />} loading={loading} onClick={run} block style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}>Search On-Hand</Button>
          {lastUrl && <Tooltip title={<span style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}>{lastUrl}</span>}><Button icon={<ApiOutlined />} block style={{ color: REDWOOD.info }}>Last API call</Button></Tooltip>}
        </Col>
      </Row>
      {err && <Alert type="error" showIcon message={err} style={{ marginBottom: 12 }} />}
      {truncated && <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="Showing the first 500 rows — narrow by item number or filter to see the rest." />}
      {rows.length > 0 && (
        <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Input allowClear prefix={<SearchOutlined style={{ color: REDWOOD.neutral600 }} />} placeholder="Filter results — item, description, subinventory, lot, status…"
            value={filter} onChange={e => setFilter(e.target.value)} style={{ maxWidth: 420 }} />
          <Text type="secondary" style={{ fontSize: 12 }}>{filteredRows.length} of {rows.length} row(s)</Text>
        </div>
      )}
      {selKeys.length > 0 && (
        <div style={{ marginBottom: 8, padding: '6px 10px', background: REDWOOD.neutral100, borderRadius: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Text strong style={{ fontSize: 12 }}>{selKeys.length} selected</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>— perform an inventory transaction:</Text>
          <Button size="small" icon={<LogoutOutlined />} onClick={() => setTxnKind('issue')} style={{ color: REDWOOD.primary, borderColor: REDWOOD.primary }}>Issue Out</Button>
          <Button size="small" icon={<LoginOutlined />} onClick={() => setTxnKind('receipt')} style={{ color: REDWOOD.success, borderColor: REDWOOD.success }}>Receive</Button>
          <Button size="small" icon={<DatabaseOutlined />} onClick={() => setTxnKind('transfer')} style={{ color: REDWOOD.info, borderColor: REDWOOD.info }}>Subinventory Transfer</Button>
        </div>
      )}
      <Table size="small" rowKey={(r) => r.__k} columns={cols} dataSource={filteredRows} loading={loading}
        rowSelection={{ selectedRowKeys: selKeys, onChange: setSelKeys, preserveSelectedRowKeys: true }}
        pagination={{ pageSize: 25, showSizeChanger: true }} scroll={{ x: 1310 }}
        locale={{ emptyText: 'No on-hand — paste items (or leave blank for all) and search' }}
        summary={() => filteredRows.length === 0 ? null : (
          <Table.Summary fixed><Table.Summary.Row style={{ background: REDWOOD.neutral100 }}>
            <Table.Summary.Cell index={-1} />
            <Table.Summary.Cell index={0} colSpan={6}><Text strong>Total on-hand ({filteredRows.length} row(s))</Text></Table.Summary.Cell>
            <Table.Summary.Cell index={6} align="right"><Text strong style={{ color: REDWOOD.success }}>{fmtQty(total)}</Text></Table.Summary.Cell>
            <Table.Summary.Cell index={7} colSpan={3} />
          </Table.Summary.Row></Table.Summary>
        )} />
      <TxnModal kind={txnKind} rows={selectedRows} onClose={() => setTxnKind(null)} onDone={() => { setSelKeys([]); run(); }} />
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Load / Issue — miscellaneous receipt / issue via inventoryStagedTransactions
// ─────────────────────────────────────────────────────────────────────────────
interface TxnRow { key: string; itemNumber: string; qty?: number; subinventory: string; locator?: string; lot?: string; uom?: string; itemId?: string; srcLine?: number; status?: 'pending' | 'ok' | 'processed' | 'error'; message?: string; }
const LoadTab: React.FC<{ orgs: OrgOpt[] }> = ({ orgs }) => {
  const [org, setOrg] = useState<string | undefined>();
  const [txnType, setTxnType] = useState<'receipt' | 'issue'>('receipt');
  const [txnDate, setTxnDate] = useState<Dayjs>(dayjs());
  const [account, setAccount] = useState('');
  const [subinvs, setSubinvs] = useState<string[]>([]);
  const [pasteText, setPasteText] = useState('');
  const [rows, setRows] = useState<TxnRow[]>([]);
  const [posting, setPosting] = useState(false);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [method, setMethod] = useState<TxnMethod>('rest');
  const [tableType, setTableType] = useState(1);
  const [validationLevel, setValidationLevel] = useState(1);
  const [soapRaw, setSoapRaw] = useState<string | null>(null);

  // Subinventories for the chosen org.
  useEffect(() => {
    if (!org) { setSubinvs([]); return; }
    fetchJson(`${FUSION_BASE}/subinventories?q=OrganizationCode=${encodeURIComponent(org)}&onlyData=true&limit=500`)
      .then(d => setSubinvs(Array.from(new Set((d?.items ?? []).map((i: any) => i.SecondaryInventoryName).filter(Boolean))) as string[]))
      .catch(() => setSubinvs([]));
  }, [org]);

  const parse = () => {
    const lines = pasteText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const out: TxnRow[] = lines.map((ln, i) => {
      const p = ln.split(/\t|,|\s{2,}/).map(x => x.trim());
      return { key: `t-${i}`, itemNumber: p[0] ?? '', qty: p[1] != null ? num(p[1]) : undefined, subinventory: p[2] ?? '', lot: p[3] ?? '' };
    }).filter(r => r.itemNumber && !/^item/i.test(r.itemNumber));
    setRows(out);
  };

  const upd = (key: string, patch: Partial<TxnRow>) => setRows(prev => prev.map(r => r.key === key ? { ...r, ...patch } : r));

  const buildBody = (l: TxnRow, srcHeader?: number, txnHeader?: number) => {
    const typeName = txnType === 'receipt' ? 'Miscellaneous receipt' : 'Miscellaneous issue';
    const body: Record<string, any> = {
      TransactionTypeName: typeName,
      SourceCode: 'ReactERP', SourceHeaderId: srcHeader ?? 0, SourceLineId: l.srcLine ?? 0,
      OrganizationCode: org,
      ItemNumber: l.itemNumber,
      SubinventoryCode: l.subinventory,
      TransactionQuantity: signedQty(typeName, l.qty),
      TransactionUnitOfMeasure: l.uom || undefined,
      TransactionDate: txnDate.format('YYYY-MM-DDTHH:mm:ss'),
    };
    if (txnHeader) body.TransactionHeaderId = txnHeader;
    if (l.locator) body.LocatorName = l.locator;
    if (account.trim()) body.DistributionAccountCombination = account.trim();
    if (l.lot) body.lotItemLots = [{ LotNumber: l.lot, TransactionQuantity: signedQty(typeName, l.qty) }];
    return body;
  };

  const soapRowOf = (l: TxnRow, trxId: number, srcLine: number): SoapTxnRow => ({
    trxId, srcLine, itemNumber: l.itemNumber, itemId: l.itemId,
    orgCode: org, orgId: orgs.find(o => o.code === org)?.id,
    subinv: l.subinventory, qty: num(l.qty), uom: l.uom || '', date: txnDate.format('YYYY-MM-DD'),
    txnTypeName: txnType === 'receipt' ? 'Miscellaneous receipt' : 'Miscellaneous issue', lot: l.lot || undefined,
  });

  const post = async () => {
    if (!org) { message.warning('Select an organization'); return; }
    const targets = rows.filter(r => r.itemNumber && num(r.qty) > 0 && r.subinventory && !r.status);
    if (!targets.length) { message.warning('Add lines with item, qty and subinventory'); return; }
    setPosting(true); setSoapRaw(null);
    // Fill UOM + item id per item where missing.
    await mapLimit(targets, 6, async (l) => {
      if (!l.uom || !l.itemId) {
        const m = await getItemMeta(l.itemNumber, org);
        const u = m?.PrimaryUOMValue ?? m?.PrimaryUnitOfMeasure ?? m?.PrimaryUOMCode;
        const patch: Partial<TxnRow> = {};
        if (u && !l.uom) { l.uom = u; patch.uom = u; }
        if (m?.InventoryItemId != null && !l.itemId) { l.itemId = String(m.InventoryItemId); patch.itemId = l.itemId; }
        if (Object.keys(patch).length) upd(l.key, patch);
      }
    });
    const base = txnStamp();

    // SOAP: one insertAndProcessInterfaceRows call per line — stages AND processes instantly.
    if (method === 'soap') {
      message.info('Processing instantly via Transaction Manager…');
      let lastRaw = ''; let idx = 0;
      for (const l of targets) {
        const trxId = base + idx, srcLine = idx; idx++;
        l.srcLine = srcLine; upd(l.key, { status: 'pending', srcLine });
        const res = await callTxnManager(soapRowOf(l, trxId, srcLine), tableType, validationLevel);
        lastRaw = res.raw || '(empty response)';
        const chk = await checkStagedOnce(trxId, srcLine);
        const codeTxt = res.code != null ? `result ${res.code}` : (res.httpStatus ? `HTTP ${res.httpStatus}` : 'no result');
        const detail = chk.state === 'error' ? chk.message : (res.ok ? '' : res.result);
        if (res.ok && chk.state !== 'error') upd(l.key, { status: 'processed', message: `SOAP ${codeTxt} — processed into inventory` });
        else upd(l.key, { status: 'error', message: `SOAP ${codeTxt}${detail ? ' — ' + detail : ''}` });
      }
      setSoapRaw(lastRaw);
      setPosting(false);
      return;
    }

    // REST: stage to the interface, then rely on the background transaction manager.
    const srcHeader = base;
    const staged: { key: string; srcLine: number }[] = [];
    let idx = 0;
    for (const l of targets) {
      const srcLine = idx++;
      l.srcLine = srcLine; upd(l.key, { status: 'pending', srcLine });
      try {
        const r = await fetch(STAGED_TXN_URL, { method: 'POST', headers: JSON_HDRS, body: JSON.stringify(buildBody(l, srcHeader)) });
        const txt = await r.text(); let d: any = null; try { d = JSON.parse(txt); } catch { /* raw */ }
        if (r.ok) { upd(l.key, { status: 'ok', message: 'Submitted to interface…' }); staged.push({ key: l.key, srcLine }); }
        else upd(l.key, { status: 'error', message: errOf(d, txt) });
      } catch (e: any) { upd(l.key, { status: 'error', message: e?.message ?? String(e) }); }
    }
    if (!staged.length) { setPosting(false); message.error('Nothing was staged — see per-line errors'); return; }
    setPosting(false);
    message.info('Submitted to the interface — checking processing status…');
    await Promise.all(staged.map(async s => {
      const res = await pollStagedBySource(srcHeader, s.srcLine);
      upd(s.key, res.state === 'processed' ? { status: 'processed', message: 'Processed into inventory' }
        : res.state === 'error' ? { status: 'error', message: res.message }
        : { status: 'ok', message: 'Submitted — still pending in interface (transaction manager not run yet)' });
    }));
  };

  const cols: ColumnsType<TxnRow> = [
    { title: '#', width: 40, render: (_, __, i) => i + 1 },
    { title: 'Item Number', dataIndex: 'itemNumber', width: 180, render: v => <Text strong>{v}</Text> },
    { title: 'Qty', dataIndex: 'qty', width: 100, render: (v, r) => <InputNumber size="small" min={0} value={v} onChange={n => upd(r.key, { qty: Number(n) || 0 })} style={{ width: 90 }} /> },
    { title: 'Subinventory', dataIndex: 'subinventory', width: 170, render: (v, r) => (
        <Select size="small" showSearch allowClear style={{ width: 150 }} value={v || undefined} placeholder="Subinv"
          options={Array.from(new Set([...subinvs, v].filter(Boolean))).map(s => ({ value: s, label: s }))}
          onChange={x => upd(r.key, { subinventory: x || '' })} /> ) },
    { title: 'Lot', dataIndex: 'lot', width: 150, render: (v, r) => <Input size="small" value={v} placeholder="(optional)" onChange={e => upd(r.key, { lot: e.target.value })} /> },
    { title: 'Status', width: 240, render: (_, r) => {
        if (r.status === 'pending') return <Spin size="small" />;
        if (r.status === 'processed') return <Tooltip title={r.message}><Tag color="green" icon={<CheckCircleTwoTone twoToneColor={REDWOOD.success} />} style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.message || 'Processed'}</Tag></Tooltip>;
        if (r.status === 'ok') return <Tooltip title={r.message}><Tag color="processing" icon={<SyncOutlined spin />}>Processing…</Tag></Tooltip>;
        if (r.status === 'error') return <Tooltip title={r.message}><Tag color="red" icon={<CloseCircleTwoTone twoToneColor={REDWOOD.error} />} style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.message}</Tag></Tooltip>;
        return <Text type="secondary">—</Text>;
      } },
    { title: '', width: 36, render: (_, r) => <Button size="small" type="text" danger icon={<CloseCircleTwoTone twoToneColor={REDWOOD.error} />} onClick={() => setRows(prev => prev.filter(x => x.key !== r.key))} /> },
  ];

  return (
    <div>
      <Row gutter={12} style={{ marginBottom: 10 }}>
        <Col xs={24} md={6}><div style={{ fontSize: 12, color: REDWOOD.neutral600, marginBottom: 4 }}>Organization *</div>
          <Select showSearch style={{ width: '100%' }} value={org} onChange={setOrg} optionFilterProp="label" placeholder="Select inventory org"
            options={orgs.map(o => ({ value: o.code, label: `${o.code}${o.name ? ' — ' + o.name : ''}` }))} /></Col>
        <Col xs={24} md={7}><div style={{ fontSize: 12, color: REDWOOD.neutral600, marginBottom: 4 }}>Transaction</div>
          <Segmented block value={txnType} onChange={v => setTxnType(v as any)}
            options={[{ label: <span><LoginOutlined /> Load On-Hand (Receipt)</span>, value: 'receipt' }, { label: <span><LogoutOutlined /> Issue Out</span>, value: 'issue' }]} /></Col>
        <Col xs={12} md={5}><div style={{ fontSize: 12, color: REDWOOD.neutral600, marginBottom: 4 }}>Transaction Date</div>
          <DatePicker style={{ width: '100%' }} value={txnDate} onChange={d => d && setTxnDate(d)} allowClear={false} /></Col>
        <Col xs={12} md={6}><div style={{ fontSize: 12, color: REDWOOD.neutral600, marginBottom: 4 }}>Account (optional)</div>
          <Input value={account} onChange={e => setAccount(e.target.value)} placeholder="Code combination" /></Col>
      </Row>

      <div style={{ marginBottom: 8, padding: '8px 12px', background: REDWOOD.neutral100, borderRadius: 6, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Text style={{ fontSize: 12, fontWeight: 600 }}>Processing method</Text>
        <Segmented value={method} onChange={v => setMethod(v as TxnMethod)} options={[
          { label: 'REST — stage & let manager run', value: 'rest' },
          { label: 'SOAP — process instantly', value: 'soap' },
        ]} />
        {method === 'soap' && <>
          <Text type="secondary" style={{ fontSize: 12 }}>Table type</Text>
          <InputNumber size="small" value={tableType} onChange={n => setTableType(Number(n) || 0)} style={{ width: 80 }} />
          <Text type="secondary" style={{ fontSize: 12 }}>Validation</Text>
          <InputNumber size="small" value={validationLevel} onChange={n => setValidationLevel(Number(n) || 0)} style={{ width: 70 }} />
          <Tooltip title={`Calls TransactionManagerServiceV2.insertAndProcessInterfaceRows — stages and processes each row in one synchronous call. Endpoint: ${SOAP_TXN_URL}`}>
            <ThunderboltOutlined style={{ color: REDWOOD.warning }} />
          </Tooltip>
        </>}
      </div>
      <Text type="secondary" style={{ fontSize: 12 }}>Paste one line per row — <b>Item Number, Qty, Subinventory, Lot</b> (tab/comma separated; lot optional).</Text>
      <Input.TextArea rows={5} value={pasteText} onChange={e => setPasteText(e.target.value)} style={{ marginTop: 6, fontFamily: 'monospace', fontSize: 12 }}
        placeholder={'460-BDXV\t10\tAMSB2BGH\nDLPB14255-01\t5\tAMSB2BGH\tLOT001'} />
      <Space style={{ marginTop: 8 }}>
        <Button onClick={parse} disabled={!pasteText.trim()}>Parse</Button>
        {rows.length > 0 && <Button icon={<ApiOutlined />} onClick={() => setJsonOpen(true)}>View JSON</Button>}
        <Button type="primary" icon={<ThunderboltOutlined />} loading={posting} disabled={!org || !rows.length}
          onClick={post} style={{ background: txnType === 'receipt' ? REDWOOD.success : REDWOOD.primary, borderColor: txnType === 'receipt' ? REDWOOD.success : REDWOOD.primary }}>
          {txnType === 'receipt' ? 'Load On-Hand' : 'Issue Out'}{method === 'soap' ? ' now' : ''} {rows.length ? `(${rows.length})` : ''}
        </Button>
      </Space>

      {rows.length > 0 && (
        <Table size="small" rowKey="key" columns={cols} dataSource={rows} pagination={false} scroll={{ y: 340 }} style={{ marginTop: 12 }} />
      )}

      {rows.some(r => r.status === 'error') && <Alert type="error" showIcon style={{ marginTop: 12 }}
        message={`${rows.filter(r => r.status === 'error').length} line(s) failed`}
        description={<ul style={{ margin: 0, paddingLeft: 18 }}>{rows.filter(r => r.status === 'error').map(r => <li key={r.key} style={{ fontSize: 12 }}><b>{r.itemNumber}</b>: {r.message}</li>)}</ul>} />}
      {rows.some(r => r.status === 'processed') && !rows.some(r => r.status === 'error') &&
        <Alert type="success" showIcon style={{ marginTop: 12 }} message={`${rows.filter(r => r.status === 'processed').length} line(s) processed`} />}

      {soapRaw && <div style={{ marginTop: 12 }}>
        <Text style={{ fontSize: 12, fontWeight: 600 }}>Transaction Manager SOAP response</Text>
        <pre style={{ maxHeight: 180, overflow: 'auto', background: REDWOOD.neutral100, padding: 10, borderRadius: 6, fontSize: 11, marginTop: 4 }}>{soapRaw}</pre>
      </div>}

      <Modal open={jsonOpen} onCancel={() => setJsonOpen(false)} width={760} title="API payload" footer={<Button onClick={() => setJsonOpen(false)}>Close</Button>}>
        {method === 'rest'
          ? <><div style={{ fontSize: 11, marginBottom: 6 }}><Tag color="green">POST</Tag> {STAGED_TXN_URL} · one request per line · TransactionTypeName <Tag>{txnType === 'receipt' ? 'Miscellaneous receipt' : 'Miscellaneous issue'}</Tag></div>
              <pre style={{ maxHeight: 380, overflow: 'auto', background: REDWOOD.neutral100, padding: 10, borderRadius: 6, fontSize: 11 }}>{JSON.stringify(rows.filter(r => r.itemNumber).map((r, i) => buildBody({ ...r, srcLine: i }, 999)), null, 2)}</pre></>
          : <><div style={{ fontSize: 11, marginBottom: 6 }}><Tag color="blue">SOAP</Tag> {SOAP_TXN_URL} · insertAndProcessInterfaceRows (per line)</div>
              <pre style={{ maxHeight: 420, overflow: 'auto', background: REDWOOD.neutral100, padding: 10, borderRadius: 6, fontSize: 11 }}>{rows.filter(r => r.itemNumber)[0] ? buildTxnSoap(soapRowOf(rows.filter(r => r.itemNumber)[0], 999, 0), tableType, validationLevel) : '(parse lines to preview)'}</pre></>}
      </Modal>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
const StockOnhand: React.FC = () => {
  const [orgs, setOrgs] = useState<OrgOpt[]>([]);
  const [orgsLoading, setOrgsLoading] = useState(true);
  const [tab, setTab] = useState('search');

  useEffect(() => {
    (async () => {
      setOrgsLoading(true);
      try {
        const all: OrgOpt[] = []; let offset = 0;
        while (true) {
          const d = await fetchJson(`${FUSION_BASE}/inventoryOrganizations?onlyData=true&limit=500&offset=${offset}&fields=OrganizationCode,OrganizationName,OrganizationId`);
          (d?.items ?? []).forEach((o: any) => { if (o.OrganizationCode) all.push({ code: o.OrganizationCode, name: o.OrganizationName ?? '', id: o.OrganizationId != null ? String(o.OrganizationId) : undefined }); });
          if (!d?.hasMore) break; offset += 500;
        }
        all.sort((a, b) => a.code.localeCompare(b.code));
        setOrgs(all);
      } catch { setOrgs([]); } finally { setOrgsLoading(false); }
    })();
  }, []);

  return (
    <Layout style={{ background: 'transparent' }}>
      <Content style={{ padding: '8px 4px' }}>
        <Breadcrumb style={{ marginBottom: 10 }} items={[
          { title: <Link to="/"><HomeOutlined /></Link> },
          { title: <Link to="/procurement">Fusion Supply Chain</Link> },
          { title: 'Stock Onhand' },
        ]} />
        <div style={{ marginBottom: 12 }}>
          <Title level={4} style={{ margin: 0 }}><DatabaseOutlined style={{ color: REDWOOD.success, marginRight: 8 }} />Stock Onhand</Title>
          <Text type="secondary" style={{ fontSize: 13 }}>Search on-hand balances across inventory organizations, and load on-hand (miscellaneous receipt) or issue stock out (miscellaneous issue).</Text>
          {orgsLoading ? <Spin size="small" style={{ marginLeft: 10 }} /> : <Tag style={{ marginLeft: 10 }}>{orgs.length} orgs</Tag>}
        </div>
        <Card style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}` }}>
          <Tabs activeKey={tab} onChange={setTab} items={[
            { key: 'search', label: <span><SearchOutlined /> Search On-Hand</span>, children: <SearchOnhand orgs={orgs} /> },
            { key: 'load', label: <span><DatabaseOutlined /> Load / Issue</span>, children: <LoadTab orgs={orgs} /> },
          ]} />
        </Card>
      </Content>
    </Layout>
  );
};

export default StockOnhand;
