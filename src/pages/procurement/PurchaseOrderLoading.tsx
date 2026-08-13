import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  Layout, Breadcrumb, Card, Table, Button, Tag, Typography, Space, Tooltip, Spin,
  Row, Col, message, Modal, Empty, Select, Statistic,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  HomeOutlined, UploadOutlined, DownloadOutlined, InboxOutlined,
  CheckCircleTwoTone, CloseCircleTwoTone, InfoCircleOutlined, SafetyCertificateOutlined,
  ShoppingCartOutlined, BankOutlined, ThunderboltOutlined, DeleteOutlined, MinusCircleOutlined,
  CloudUploadOutlined, CopyOutlined, CheckCircleOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import * as XLSX from 'xlsx';
import dayjs from 'dayjs';
import { FUSION_POD_HOST, FUSION_POD_AUTH } from '../../config/fusionInstance';

const { Content } = Layout;
const { Title, Text } = Typography;

const FUSION_BASE = `${FUSION_POD_HOST}/fscmRestApi/resources/11.13.18.05`;
const AUTH_HEADER = FUSION_POD_AUTH;
const FUSION_HDRS = { Authorization: AUTH_HEADER, Accept: 'application/json' };
const DRAFT_PO_URL = `${FUSION_BASE}/draftPurchaseOrders`;

const REDWOOD = {
  primary: '#C74634', success: '#1D7B4D', warning: '#B07700', info: '#0572CE',
  error: '#D93025', teal: '#00918A', purple: '#7245A6',
  neutral100: '#F7F7F7', neutral200: '#E5E5E5', neutral300: '#C7C7C7',
  neutral600: '#6B6B6B', neutral900: '#1A1A1A', surface: '#FFFFFF',
};

// ── Helpers ──────────────────────────────────────────────────────────────────
const money = (v?: number | null, ccy?: string) => {
  if (v == null || isNaN(Number(v))) return '—';
  const s = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v));
  return ccy ? `${s} ${ccy}` : s;
};
const qtyFmt = (v?: number | null) => (v == null || isNaN(Number(v)) ? '—' : new Intl.NumberFormat('en-US').format(Number(v)));
const showDate = (v: any) => { if (v == null || v === '') return '—'; const d = dayjs(v); return d.isValid() ? d.format('D-MMM-YYYY') : String(v); };
const uniq = <T,>(a: T[]) => Array.from(new Set(a));

const mapLimit = async <T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> => {
  const out: R[] = new Array(items.length); let idx = 0;
  const worker = async () => { while (idx < items.length) { const c = idx++; out[c] = await fn(items[c]); } };
  await Promise.all(Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, worker));
  return out;
};

// Excel column → normalized field mapping (tolerant of header spelling).
const FIELD_ALIASES: Record<string, string[]> = {
  businessUnit: ['businessunit', 'bu', 'businessunitname'],
  trxCode: ['trxcode', 'trx', 'transactioncode', 'trxtype', 'ordertype', 'documentstyle'],
  poNumber: ['ponumber', 'po', 'purchaseorder', 'ordernumber', 'pono'],
  date: ['date', 'podate', 'orderdate'],
  supplierCode: ['suppliercode', 'supplier', 'suppliernumber', 'vendorcode', 'vendor'],
  currency: ['pocurrency', 'currency', 'currencycode', 'ccy'],
  itemCode: ['itemcode', 'item', 'itemnumber', 'itemcodee'],
  qty: ['qty', 'quantity', 'orderedquantity'],
  unitPrice: ['unitprice', 'price', 'unitcost', 'cost'],
  organization: ['organization', 'org', 'warehouse', 'organizationcode', 'inventoryorg'],
  subinventory: ['subinventory', 'subinv', 'subinventorycode'],
  needByDate: ['needbydate', 'needby', 'requireddate', 'needbydte'],
};
const TEMPLATE_HEADERS = ['BusinessUnit', 'TrxCode', 'PONumber', 'Date', 'SupplierCode', 'POCurrency', 'ItemCode', 'Qty', 'UnitPrice', 'Organization', 'Subinventory', 'NeedByDate'];
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

interface POLine {
  __idx: number;
  businessUnit?: string; trxCode?: string; poNumber?: string; date?: any;
  supplierCode?: string; currency?: string; itemCode?: string;
  qty?: number; unitPrice?: number; organization?: string; subinventory?: string; needByDate?: any;
}
interface LineResult { supplier: boolean; item: boolean; warehouse: boolean }

const mapExcelRow = (raw: any, idx: number): POLine => {
  const entries = Object.entries(raw);
  const out: any = { __idx: idx };
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    const hit = entries.find(([k]) => aliases.includes(norm(k)));
    out[field] = hit ? hit[1] : undefined;
  }
  const str = (v: any) => (v == null || v === '' ? undefined : String(v).trim());
  out.businessUnit = str(out.businessUnit); out.trxCode = str(out.trxCode); out.poNumber = str(out.poNumber);
  out.supplierCode = str(out.supplierCode); out.currency = str(out.currency); out.itemCode = str(out.itemCode);
  out.organization = str(out.organization); out.subinventory = str(out.subinventory);
  out.qty = out.qty == null || out.qty === '' ? undefined : Number(out.qty);
  out.unitPrice = out.unitPrice == null || out.unitPrice === '' ? undefined : Number(out.unitPrice);
  return out as POLine;
};

const Flag: React.FC<{ ok?: boolean; label?: string }> = ({ ok, label }) => {
  if (ok === undefined) return <MinusCircleOutlined style={{ color: REDWOOD.neutral300 }} />;
  return (
    <Tooltip title={label ? `${label}: ${ok ? 'valid' : 'not found'}` : (ok ? 'Valid' : 'Not found')}>
      {ok ? <CheckCircleTwoTone twoToneColor={REDWOOD.success} /> : <CloseCircleTwoTone twoToneColor={REDWOOD.error} />}
    </Tooltip>
  );
};

// ── Validation dialog ────────────────────────────────────────────────────────
const ValidateDialog: React.FC<{
  open: boolean; lines: POLine[]; onClose: () => void;
  bUnits: { name: string }[]; orgs: { code: string; name?: string }[];
}> = ({ open, lines, onClose, bUnits, orgs }) => {
  const [selBU, setSelBU] = useState<string | undefined>(undefined);
  const [gOrg, setGOrg] = useState<string | undefined>(undefined);
  const [gSub, setGSub] = useState<string | undefined>(undefined);
  // Per-line overrides for organization / subinventory.
  const [lineOrg, setLineOrg] = useState<Record<number, string | undefined>>({});
  const [lineSub, setLineSub] = useState<Record<number, string | undefined>>({});
  const [subByOrg, setSubByOrg] = useState<Record<string, string[]>>({});
  const [results, setResults] = useState<Record<number, LineResult>>({});
  const [validating, setValidating] = useState(false);
  const [summary, setSummary] = useState<{ suppliers?: string; items?: string; wh?: string } | null>(null);
  const [posting, setPosting] = useState(false);
  const [loadResults, setLoadResults] = useState<{ po: string; ok: boolean; status: number; body: string; orderNumber?: string; payload: string }[] | null>(null);
  const validated = Object.keys(results).length > 0;
  const allValid = validated && lines.every(l => { const r = results[l.__idx]; return r && r.supplier && r.item && r.warehouse; });

  const orgSet = useMemo(() => new Set(orgs.map(o => o.code)), [orgs]);

  useEffect(() => {
    if (open) {
      setSelBU(lines.find(l => l.businessUnit)?.businessUnit);
      setLineOrg({}); setLineSub({}); setResults({}); setSummary(null); setGOrg(undefined); setGSub(undefined);
    }
  }, [open, lines]);

  const effOrg = useCallback((l: POLine) => lineOrg[l.__idx] ?? l.organization, [lineOrg]);
  const effSub = useCallback((l: POLine) => lineSub[l.__idx] ?? l.subinventory, [lineSub]);

  // Lazily load subinventories for an org.
  const loadSubs = useCallback(async (org?: string) => {
    if (!org || subByOrg[org]) return;
    try {
      const r = await fetch(`${FUSION_BASE}/subinventories?q=OrganizationCode=${encodeURIComponent(org)}&onlyData=true&limit=500`, { headers: FUSION_HDRS });
      const d = await r.json();
      const names = uniq((d.items ?? []).map((s: any) => s.SecondaryInventoryName).filter(Boolean)) as string[];
      setSubByOrg(p => ({ ...p, [org]: names.sort() }));
    } catch { setSubByOrg(p => ({ ...p, [org]: [] })); }
  }, [subByOrg]);

  // Preload subs for orgs already present on the lines.
  useEffect(() => { if (open) uniq(lines.map(l => l.organization).filter(Boolean) as string[]).forEach(o => loadSubs(o)); }, [open, lines, loadSubs]);

  const applyGlobalToBlank = () => {
    if (!gOrg) { message.warning('Pick an Organization to apply'); return; }
    loadSubs(gOrg);
    setLineOrg(p => { const n = { ...p }; lines.forEach(l => { if (!effOrg(l)) n[l.__idx] = gOrg; }); return n; });
    if (gSub) setLineSub(p => { const n = { ...p }; lines.forEach(l => { if (!effSub(l)) n[l.__idx] = gSub; }); return n; });
    message.success('Applied to lines without a warehouse');
  };

  const validate = async () => {
    setValidating(true); setResults({}); setSummary(null);
    try {
      const supCodes = uniq(lines.map(l => l.supplierCode).filter(Boolean) as string[]);
      const itemCodes = uniq(lines.map(l => l.itemCode).filter(Boolean) as string[]);
      const usedOrgs = uniq(lines.map(l => effOrg(l)).filter(Boolean) as string[]);

      // Supplier existence (suppliers?q=SupplierNumber='code').
      const supOk: Record<string, boolean> = {};
      await mapLimit(supCodes, 5, async (code) => {
        try {
          const r = await fetch(`${FUSION_BASE}/suppliers?q=${encodeURIComponent(`SupplierNumber='${code}'`)}&limit=1&onlyData=true`, { headers: FUSION_HDRS });
          const d = await r.json(); supOk[code] = ((d.items ?? []).length > 0);
        } catch { supOk[code] = false; }
      });

      // Item existence (itemsV2?q=ItemNumber='code').
      const itemOk: Record<string, boolean> = {};
      await mapLimit(itemCodes, 6, async (code) => {
        try {
          const r = await fetch(`${FUSION_BASE}/itemsV2?q=${encodeURIComponent(`ItemNumber='${code}'`)}&limit=1&onlyData=true`, { headers: FUSION_HDRS });
          const d = await r.json(); itemOk[code] = ((d.items ?? []).length > 0);
        } catch { itemOk[code] = false; }
      });

      // Ensure subinventory lists are loaded for every used org.
      const subMap: Record<string, string[]> = { ...subByOrg };
      await mapLimit(usedOrgs.filter(o => !subMap[o]), 4, async (org) => {
        try {
          const r = await fetch(`${FUSION_BASE}/subinventories?q=OrganizationCode=${encodeURIComponent(org)}&onlyData=true&limit=500`, { headers: FUSION_HDRS });
          const d = await r.json();
          subMap[org] = uniq((d.items ?? []).map((s: any) => s.SecondaryInventoryName).filter(Boolean)) as string[];
        } catch { subMap[org] = []; }
      });
      setSubByOrg(subMap);

      const res: Record<number, LineResult> = {};
      lines.forEach(l => {
        const org = effOrg(l); const sub = effSub(l);
        const orgValid = !!org && orgSet.has(org);
        const subValid = !!sub && (subMap[org ?? ''] ?? []).includes(sub);
        res[l.__idx] = {
          supplier: !!l.supplierCode && !!supOk[l.supplierCode],
          item: !!l.itemCode && !!itemOk[l.itemCode],
          warehouse: orgValid && subValid,
        };
      });
      setResults(res);

      const okSup = supCodes.filter(c => supOk[c]).length;
      const okItem = itemCodes.filter(c => itemOk[c]).length;
      const okWh = lines.filter(l => res[l.__idx].warehouse).length;
      setSummary({
        suppliers: `${okSup}/${supCodes.length} suppliers valid`,
        items: `${okItem}/${itemCodes.length} items valid`,
        wh: `${okWh}/${lines.length} lines have a valid warehouse`,
      });
      message.success('Validation complete');
    } catch (e: any) { message.error(`Validation failed: ${e.message}`); }
    finally { setValidating(false); }
  };

  // Build a draftPurchaseOrders body for one PO (grouped lines).
  const buildPoPayload = (poLines: POLine[]) => {
    const first = poLines[0];
    const bu = selBU ?? first.businessUnit;
    return {
      ...(bu ? { ProcurementBU: bu, RequisitioningBU: bu } : {}),
      ...(first.supplierCode ? { SupplierNumber: first.supplierCode } : {}),
      ...(first.currency ? { CurrencyCode: first.currency } : {}),
      ...(first.trxCode ? { StyleDisplayName: first.trxCode } : {}),
      lines: poLines.map((l, i) => {
        const org = effOrg(l); const sub = effSub(l);
        return {
          LineNumber: i + 1,
          LineType: 'Goods',
          ...(l.itemCode ? { Item: l.itemCode } : {}),
          ...(l.qty != null ? { Quantity: l.qty } : {}),
          ...(l.unitPrice != null ? { Price: l.unitPrice } : {}),
          schedules: [{
            ScheduleNumber: 1,
            ...(org ? { ShipToOrganizationCode: org } : {}),
            ...(l.qty != null ? { Quantity: l.qty } : {}),
            ...(l.needByDate ? { RequestedDeliveryDate: dayjs(l.needByDate).format('YYYY-MM-DD') } : {}),
            ...(sub ? { distributions: [{ DistributionNumber: 1, ...(l.qty != null ? { Quantity: l.qty } : {}), DestinationSubinventory: sub }] } : {}),
          }],
        };
      }),
    };
  };

  const runLoad = async () => {
    setPosting(true); setLoadResults(null);
    const byPo: Record<string, POLine[]> = {};
    lines.forEach(l => { const k = l.poNumber ?? '(blank)'; (byPo[k] ??= []).push(l); });
    const out: NonNullable<typeof loadResults> = [];
    for (const [po, pls] of Object.entries(byPo)) {
      const payload = buildPoPayload(pls);
      const payloadStr = JSON.stringify(payload, null, 2);
      try {
        const r = await fetch(DRAFT_PO_URL, { method: 'POST', headers: { ...FUSION_HDRS, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const text = await r.text();
        let parsed: any = null; try { parsed = JSON.parse(text); } catch { /* keep raw */ }
        out.push({ po, ok: r.ok, status: r.status, body: parsed ? JSON.stringify(parsed, null, 2) : text, orderNumber: parsed?.OrderNumber, payload: payloadStr });
      } catch (e: any) { out.push({ po, ok: false, status: 0, body: e.message, payload: payloadStr }); }
    }
    setLoadResults(out);
    setPosting(false);
    const okc = out.filter(o => o.ok).length;
    if (okc === out.length) message.success(`Loaded ${okc} draft PO(s) in Fusion`);
    else message.warning(`${okc}/${out.length} PO(s) loaded — check the errors`);
  };

  const cols: ColumnsType<POLine> = [
    { title: 'PO', dataIndex: 'poNumber', width: 110, fixed: 'left', render: v => <Text strong style={{ fontSize: 12 }}>{v ?? '—'}</Text> },
    { title: 'Supplier', dataIndex: 'supplierCode', width: 110, render: (v, r) => <Space size={4}><Flag ok={results[r.__idx]?.supplier} label="Supplier" /><Text style={{ fontSize: 12 }}>{v ?? '—'}</Text></Space> },
    { title: 'Item', dataIndex: 'itemCode', width: 130, render: (v, r) => <Space size={4}><Flag ok={results[r.__idx]?.item} label="Item" /><Text style={{ fontSize: 12 }}>{v ?? '—'}</Text></Space> },
    { title: 'Qty', dataIndex: 'qty', width: 70, align: 'right', render: qtyFmt },
    { title: 'Unit Price', dataIndex: 'unitPrice', width: 90, align: 'right', render: (v, r) => money(v, r.currency) },
    { title: 'Warehouse', key: 'wh', width: 240,
      render: (_, r) => {
        const org = effOrg(r); const subs = subByOrg[org ?? ''] ?? [];
        return (
          <Space size={4} align="center">
            <Flag ok={results[r.__idx]?.warehouse} label="Warehouse" />
            <Select size="small" showSearch placeholder="Org" style={{ width: 92 }} value={org}
              onChange={v => { setLineOrg(p => ({ ...p, [r.__idx]: v })); setLineSub(p => ({ ...p, [r.__idx]: undefined })); loadSubs(v); }}
              options={orgs.map(o => ({ value: o.code, label: o.code }))} optionFilterProp="label" />
            <Select size="small" showSearch placeholder="Subinv" style={{ width: 108 }} value={effSub(r)}
              onChange={v => setLineSub(p => ({ ...p, [r.__idx]: v }))}
              notFoundContent={org ? 'None' : 'Pick org'} options={subs.map(s => ({ value: s, label: s }))} optionFilterProp="label" />
          </Space>
        );
      } },
    { title: 'Need By', dataIndex: 'needByDate', width: 110, render: showDate },
  ];

  return (
    <Modal open={open} onCancel={onClose} maskClosable={false} width={1160} style={{ top: 16 }}
      title={<Space><SafetyCertificateOutlined style={{ color: REDWOOD.primary }} /> Validate PO Load
        <Tag color="volcano">{uniq(lines.map(l => l.poNumber)).length} PO(s)</Tag><Tag>{lines.length} lines</Tag></Space>}
      footer={<Space>
        {summary && <Text type={allValid ? 'success' : undefined} style={{ marginRight: 'auto', fontSize: 12 }}>
          {summary.suppliers} · {summary.items} · {summary.wh}{allValid ? ' — all valid ✓' : ''}
        </Text>}
        <Button onClick={onClose}>Close</Button>
        <Button type="primary" icon={<SafetyCertificateOutlined />} loading={validating} onClick={validate}
          style={{ background: REDWOOD.success, borderColor: REDWOOD.success }}>Validate</Button>
        <Tooltip title={validated ? (allValid ? 'Create draft purchase orders in Fusion' : 'Some lines are invalid — fix them or load anyway') : 'Validate first'}>
          <Button type="primary" icon={<CloudUploadOutlined />} loading={posting} disabled={!validated} onClick={runLoad}
            style={validated ? { background: REDWOOD.primary, borderColor: REDWOOD.primary } : undefined}>Load to Fusion</Button>
        </Tooltip>
      </Space>}>
      {/* Header controls */}
      <Card size="small" style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}`, marginBottom: 12 }}
        styles={{ body: { padding: '12px 14px' } }}>
        <Row gutter={[12, 8]} align="bottom">
          <Col xs={24} md={8}>
            <div style={{ fontSize: 11, fontWeight: 700, color: REDWOOD.neutral600, textTransform: 'uppercase', marginBottom: 4 }}><BankOutlined /> Business Unit</div>
            <Select showSearch style={{ width: '100%' }} placeholder="Select business unit" value={selBU} onChange={setSelBU}
              options={uniq([...(bUnits.map(b => b.name)), ...(lines.map(l => l.businessUnit).filter(Boolean) as string[])]).map(n => ({ value: n, label: n }))}
              optionFilterProp="label" />
          </Col>
          <Col xs={12} md={5}>
            <div style={{ fontSize: 11, fontWeight: 700, color: REDWOOD.neutral600, textTransform: 'uppercase', marginBottom: 4 }}>Fill Organization</div>
            <Select showSearch allowClear style={{ width: '100%' }} placeholder="Org" value={gOrg}
              onChange={v => { setGOrg(v); setGSub(undefined); loadSubs(v); }}
              options={orgs.map(o => ({ value: o.code, label: `${o.code}${o.name ? ' — ' + o.name : ''}` }))} optionFilterProp="label" />
          </Col>
          <Col xs={12} md={5}>
            <div style={{ fontSize: 11, fontWeight: 700, color: REDWOOD.neutral600, textTransform: 'uppercase', marginBottom: 4 }}>Fill Subinventory</div>
            <Select showSearch allowClear style={{ width: '100%' }} placeholder="Subinv" value={gSub} onChange={setGSub}
              notFoundContent={gOrg ? 'None' : 'Pick org'} options={(subByOrg[gOrg ?? ''] ?? []).map(s => ({ value: s, label: s }))} optionFilterProp="label" />
          </Col>
          <Col xs={24} md={6}>
            <Button block icon={<ThunderboltOutlined />} onClick={applyGlobalToBlank}>Apply to blank warehouses</Button>
          </Col>
        </Row>
        <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 8 }}>
          <InfoCircleOutlined style={{ marginRight: 4 }} />Validates supplier (suppliers), item (itemsV2) and warehouse (organization + subinventory). Fix any ✗ line, then re-validate.
        </Text>
      </Card>

      <Table size="small" columns={cols} dataSource={lines} rowKey="__idx"
        pagination={lines.length > 50 ? { pageSize: 50, size: 'small' } : false} scroll={{ x: 960, y: 380 }} />

      {/* Load results */}
      <Modal open={!!loadResults} onCancel={() => setLoadResults(null)} maskClosable={false} width={820}
        title={<Space><CloudUploadOutlined style={{ color: REDWOOD.primary }} /> Load to Fusion — draftPurchaseOrders
          {loadResults && <Tag color={loadResults.every(r => r.ok) ? 'success' : 'error'}>{loadResults.filter(r => r.ok).length}/{loadResults.length} OK</Tag>}</Space>}
        footer={<Button onClick={() => setLoadResults(null)}>Close</Button>}>
        <div style={{ fontSize: 12, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Tag color="green">POST</Tag><Text style={{ fontFamily: 'monospace', fontSize: 11, color: REDWOOD.info, wordBreak: 'break-all' }}>{DRAFT_PO_URL}</Text>
        </div>
        <div style={{ maxHeight: '60vh', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {(loadResults ?? []).map((r, i) => (
            <div key={i} style={{ border: `1px solid ${(r.ok ? REDWOOD.success : REDWOOD.error)}55`, borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: (r.ok ? REDWOOD.success : REDWOOD.error) + '12' }}>
                {r.ok ? <CheckCircleOutlined style={{ color: REDWOOD.success }} /> : <InfoCircleOutlined style={{ color: REDWOOD.error }} />}
                <Text strong style={{ fontSize: 13 }}>PO {r.po}</Text>
                <Tag color={r.ok ? 'success' : r.status === 0 ? 'default' : 'error'}>{r.status === 0 ? 'Network Error' : `HTTP ${r.status}`}</Tag>
                {r.orderNumber && <Tag color="volcano">Order {r.orderNumber}</Tag>}
                <Button size="small" type="text" icon={<CopyOutlined />} style={{ marginLeft: 'auto' }}
                  onClick={() => { navigator.clipboard.writeText(r.payload); message.success('Payload copied'); }}>Payload</Button>
                <Button size="small" type="text" icon={<CopyOutlined />}
                  onClick={() => { navigator.clipboard.writeText(r.body); message.success('Response copied'); }}>Response</Button>
              </div>
              <pre style={{ margin: 0, padding: 12, fontSize: 11, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 220, overflow: 'auto', background: REDWOOD.neutral100 }}>{r.body.slice(0, 6000)}{r.body.length > 6000 ? '\n\n… (truncated)' : ''}</pre>
            </div>
          ))}
        </div>
      </Modal>
    </Modal>
  );
};

// ── Page ─────────────────────────────────────────────────────────────────────
const PurchaseOrderLoading: React.FC = () => {
  const [rows, setRows] = useState<POLine[]>([]);
  const [fileName, setFileName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedPOs, setSelectedPOs] = useState<string[]>([]);
  const [validateOpen, setValidateOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const [bUnits, setBUnits] = useState<{ name: string }[]>([]);
  const [orgs, setOrgs] = useState<{ code: string; name?: string }[]>([]);

  // Reference lists for the validation dialog.
  useEffect(() => {
    fetch(`${FUSION_BASE}/finBusinessUnitsLOV?onlyData=true&limit=500&fields=BusinessUnitName`, { headers: FUSION_HDRS })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => setBUnits(uniq((d.items ?? []).map((b: any) => b.BusinessUnitName).filter(Boolean)).map((name: any) => ({ name }))))
      .catch(() => { /* fall back to distinct values from the file */ });
    fetch(`${FUSION_BASE}/inventoryOrganizations?onlyData=true&limit=500&fields=OrganizationCode,OrganizationName`, { headers: FUSION_HDRS })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => setOrgs((d.items ?? []).map((o: any) => ({ code: o.OrganizationCode, name: o.OrganizationName })).filter((o: any) => o.code)))
      .catch(() => { /* org validation will fail closed */ });
  }, []);

  // ── Excel read ──────────────────────────────────────────────────────────────
  const handleFile = useCallback((file: File) => {
    setLoading(true); setError(''); setSelectedPOs([]);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array', cellDates: true });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json<any>(sheet, { defval: null });
        if (json.length === 0) { setError('No data rows found in the spreadsheet.'); setRows([]); setLoading(false); return; }
        const mapped = json.map((r, i) => mapExcelRow(r, i)).filter(l => l.poNumber || l.itemCode || l.supplierCode);
        if (mapped.length === 0) { setError('Could not recognise the columns. Please use the PO Load template.'); setRows([]); setLoading(false); return; }
        setRows(mapped); setFileName(file.name);
      } catch {
        setError('Failed to read the file. Make sure it is a valid Excel (.xlsx / .xls) file.');
        setRows([]);
      }
      setLoading(false);
    };
    reader.readAsArrayBuffer(file);
  }, []);

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; };

  const downloadTemplate = () => {
    const sample = {
      BusinessUnit: 'MITSUMI DISTRIBUTION FZCO', TrxCode: 'STANDARD', PONumber: 'PO-1001',
      Date: '2026-07-27', SupplierCode: 'DCLG0030', POCurrency: 'AED', ItemCode: '167815',
      Qty: 10, UnitPrice: 25.5, Organization: 'MLC', Subinventory: 'S01EA', NeedByDate: '2026-08-15',
    };
    const ws = XLSX.utils.json_to_sheet([sample], { header: TEMPLATE_HEADERS });
    ws['!cols'] = TEMPLATE_HEADERS.map(h => ({ wch: Math.max(12, h.length + 2) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'PO_Load');
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = document.createElement('a'); a.href = url; a.download = 'PO_Load_Template.xlsx'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  // ── Group into POs ──────────────────────────────────────────────────────────
  const poSummary = useMemo(() => {
    const map: Record<string, { po: string; bu?: string; trx?: string; supplier?: string; currency?: string; date?: any; lines: number; qty: number; value: number; items: Set<string> }> = {};
    rows.forEach(l => {
      const key = l.poNumber ?? '(blank)';
      if (!map[key]) map[key] = { po: key, bu: l.businessUnit, trx: l.trxCode, supplier: l.supplierCode, currency: l.currency, date: l.date, lines: 0, qty: 0, value: 0, items: new Set() };
      const g = map[key];
      g.lines += 1; g.qty += Number(l.qty) || 0; g.value += (Number(l.qty) || 0) * (Number(l.unitPrice) || 0);
      if (l.itemCode) g.items.add(l.itemCode);
    });
    return Object.values(map).map(g => ({ ...g, itemCount: g.items.size }));
  }, [rows]);

  const stats = useMemo(() => ({
    pos: poSummary.length,
    lines: rows.length,
    suppliers: uniq(rows.map(r => r.supplierCode).filter(Boolean)).length,
    items: uniq(rows.map(r => r.itemCode).filter(Boolean)).length,
    value: rows.reduce((s, r) => s + (Number(r.qty) || 0) * (Number(r.unitPrice) || 0), 0),
  }), [poSummary, rows]);

  const selectedLines = useMemo(() => rows.filter(l => selectedPOs.includes(l.poNumber ?? '(blank)')), [rows, selectedPOs]);

  const summaryCols: ColumnsType<any> = [
    { title: 'Business Unit', dataIndex: 'bu', width: 200, fixed: 'left', ellipsis: true, render: v => <Text strong style={{ fontSize: 12 }}>{v ?? '—'}</Text> },
    { title: 'PO Number', dataIndex: 'po', width: 130, render: v => <Text strong style={{ color: REDWOOD.info, fontSize: 12 }}>{v}</Text> },
    { title: 'Trx Code', dataIndex: 'trx', width: 110, render: v => v ? <Tag style={{ fontSize: 11 }}>{v}</Tag> : '—' },
    { title: 'Supplier', dataIndex: 'supplier', width: 120, render: v => <Text style={{ fontSize: 12 }}>{v ?? '—'}</Text> },
    { title: 'Currency', dataIndex: 'currency', width: 90, align: 'center', render: v => <Tag style={{ fontSize: 11 }}>{v ?? '—'}</Tag> },
    { title: 'Date', dataIndex: 'date', width: 120, render: showDate },
    { title: '# Items', dataIndex: 'itemCount', width: 80, align: 'right', render: v => <Tag color="blue">{v}</Tag> },
    { title: '# Lines', dataIndex: 'lines', width: 80, align: 'right', render: qtyFmt },
    { title: 'Total Qty', dataIndex: 'qty', width: 100, align: 'right', render: qtyFmt },
    { title: 'Total Value', dataIndex: 'value', width: 130, align: 'right', render: (v, r) => <Text strong style={{ color: REDWOOD.primary }}>{money(v, r.currency)}</Text> },
  ];

  const lineCols: ColumnsType<POLine> = [
    { title: 'PO', dataIndex: 'poNumber', width: 110, fixed: 'left', render: v => <Text strong style={{ fontSize: 12 }}>{v ?? '—'}</Text> },
    { title: 'Business Unit', dataIndex: 'businessUnit', width: 180, ellipsis: true, render: v => v ?? '—' },
    { title: 'Trx', dataIndex: 'trxCode', width: 100, render: v => v ? <Tag style={{ fontSize: 11 }}>{v}</Tag> : '—' },
    { title: 'Supplier', dataIndex: 'supplierCode', width: 110, render: v => v ?? '—' },
    { title: 'Currency', dataIndex: 'currency', width: 80, align: 'center', render: v => <Tag style={{ fontSize: 11 }}>{v ?? '—'}</Tag> },
    { title: 'Item', dataIndex: 'itemCode', width: 130, render: v => <Text strong style={{ color: REDWOOD.info, fontSize: 12 }}>{v ?? '—'}</Text> },
    { title: 'Qty', dataIndex: 'qty', width: 70, align: 'right', render: qtyFmt },
    { title: 'Unit Price', dataIndex: 'unitPrice', width: 100, align: 'right', render: (v, r) => money(v, r.currency) },
    { title: 'Amount', key: 'amt', width: 120, align: 'right', render: (_, r) => <Text strong>{money((Number(r.qty) || 0) * (Number(r.unitPrice) || 0), r.currency)}</Text> },
    { title: 'Organization', dataIndex: 'organization', width: 110, render: v => v ? <Tag style={{ fontSize: 11 }}>{v}</Tag> : <Text type="secondary">—</Text> },
    { title: 'Subinventory', dataIndex: 'subinventory', width: 110, render: v => v ?? <Text type="secondary">—</Text> },
    { title: 'Need By', dataIndex: 'needByDate', width: 110, render: showDate },
  ];

  const StatTile: React.FC<{ label: string; value: React.ReactNode; color: string; icon: React.ReactNode }> = ({ label, value, color, icon }) => (
    <div style={{ flex: 1, minWidth: 130, background: REDWOOD.surface, border: `1px solid ${REDWOOD.neutral200}`, borderRadius: 10, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{ width: 34, height: 34, borderRadius: 9, background: color + '18', color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17 }}>{icon}</span>
      <Statistic title={<span style={{ fontSize: 11, color: REDWOOD.neutral600 }}>{label}</span>} value={value as any} valueStyle={{ fontSize: 18, fontWeight: 700, color: REDWOOD.neutral900 }} />
    </div>
  );

  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
      <Content>
        <div style={{ padding: '12px 24px', background: REDWOOD.surface, borderBottom: `1px solid ${REDWOOD.neutral200}` }}>
          <Breadcrumb items={[
            { title: <Link to="/home"><HomeOutlined /> Home</Link> },
            { title: <Link to="/procurement">Procurement</Link> },
            { title: 'Purchase Order Loading' },
          ]} />
          <Title level={4} style={{ margin: '8px 0 0', display: 'flex', alignItems: 'center', gap: 8 }}>
            <ShoppingCartOutlined style={{ color: REDWOOD.primary }} /> Purchase Order Loading
            <Text type="secondary" style={{ fontSize: 13, fontWeight: 400 }}>— load purchase orders from Excel, review & validate</Text>
          </Title>
        </div>

        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Upload */}
          <Card styles={{ body: { padding: 16 } }} style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}` }}>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'stretch' }}>
              <label
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f); }}
                style={{ flex: 1, minWidth: 320, cursor: 'pointer', border: `2px dashed ${dragOver ? REDWOOD.primary : REDWOOD.neutral300}`,
                  borderRadius: 10, padding: '20px 16px', display: 'flex', alignItems: 'center', gap: 14, background: dragOver ? REDWOOD.primary + '08' : REDWOOD.neutral100 }}>
                <InboxOutlined style={{ fontSize: 34, color: REDWOOD.primary }} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{fileName ? `Loaded: ${fileName}` : 'Drop the PO Excel here, or click to browse'}</div>
                  <Text type="secondary" style={{ fontSize: 12 }}>Columns: BusinessUnit, TrxCode, PONumber, Date, SupplierCode, POCurrency, ItemCode, Qty, UnitPrice, Organization, Subinventory, NeedByDate</Text>
                </div>
                <input type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={onInputChange} />
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'center' }}>
                <Button icon={<DownloadOutlined />} onClick={downloadTemplate}>Download Format</Button>
                {rows.length > 0 && <Button danger icon={<DeleteOutlined />} onClick={() => { setRows([]); setFileName(''); setSelectedPOs([]); }}>Clear</Button>}
              </div>
            </div>
            {loading && <div style={{ marginTop: 12 }}><Spin size="small" /> <Text type="secondary">Reading…</Text></div>}
            {error && <div style={{ marginTop: 12, color: REDWOOD.error, fontSize: 12 }}><InfoCircleOutlined style={{ marginRight: 6 }} />{error}</div>}
          </Card>

          {rows.length > 0 && (
            <>
              {/* Summary stats */}
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <StatTile label="Purchase Orders" value={stats.pos} color={REDWOOD.primary} icon={<ShoppingCartOutlined />} />
                <StatTile label="Lines" value={stats.lines} color={REDWOOD.info} icon={<InboxOutlined />} />
                <StatTile label="Suppliers" value={stats.suppliers} color={REDWOOD.purple} icon={<BankOutlined />} />
                <StatTile label="Distinct Items" value={stats.items} color={REDWOOD.teal} icon={<UploadOutlined />} />
                <StatTile label="Total Value" value={money(stats.value)} color={REDWOOD.success} icon={<ThunderboltOutlined />} />
              </div>

              {/* PO summary with selection */}
              <Card styles={{ body: { padding: 0 } }} style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}` }}
                title={<Space><ShoppingCartOutlined style={{ color: REDWOOD.primary }} /><Text strong>Purchase Orders</Text><Tag>{poSummary.length}</Tag>
                  {selectedPOs.length > 0 && <Tag color="volcano">{selectedPOs.length} selected</Tag>}</Space>}
                extra={
                  <Button type="primary" icon={<SafetyCertificateOutlined />} disabled={selectedPOs.length === 0}
                    style={selectedPOs.length ? { background: REDWOOD.primary, borderColor: REDWOOD.primary } : undefined}
                    onClick={() => setValidateOpen(true)}>Load &amp; Validate</Button>
                }>
                <Table size="small" columns={summaryCols} dataSource={poSummary} rowKey="po"
                  rowSelection={{ selectedRowKeys: selectedPOs, onChange: keys => setSelectedPOs(keys as string[]) }}
                  pagination={poSummary.length > 20 ? { pageSize: 20, size: 'small' } : false} scroll={{ x: 1180 }} />
              </Card>

              {/* All lines */}
              <Card styles={{ body: { padding: 0 } }} style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}` }}
                title={<Space><InboxOutlined style={{ color: REDWOOD.primary }} /><Text strong>Lines</Text><Tag>{rows.length}</Tag></Space>}>
                <Table size="small" columns={lineCols} dataSource={rows} rowKey="__idx"
                  pagination={rows.length > 25 ? { pageSize: 25, size: 'small', showSizeChanger: true } : false} scroll={{ x: 1420 }} />
              </Card>
            </>
          )}

          {rows.length === 0 && !loading && (
            <Card style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}` }}>
              <Empty description="Load a PO Excel file to begin. Use “Download Format” for the template." />
            </Card>
          )}
        </div>

        <ValidateDialog open={validateOpen} lines={selectedLines} onClose={() => setValidateOpen(false)} bUnits={bUnits} orgs={orgs} />
      </Content>
    </Layout>
  );
};

export default PurchaseOrderLoading;
