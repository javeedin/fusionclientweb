import { getFusionAuthHeaders, getFusionInstance } from '../../config/api.helper';
import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  Layout, Breadcrumb, Card, Table, Form, Input, Select, DatePicker, Button,
  Tag, Typography, Space, Tooltip, Spin, Row, Col, message, Modal, Empty, Tabs,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  HomeOutlined, CheckSquareOutlined, SearchOutlined, ReloadOutlined, ClearOutlined,
  ApiOutlined, CopyOutlined, InfoCircleOutlined, ExportOutlined, BankOutlined,
  UnorderedListOutlined, ProfileOutlined, CarOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import dayjs, { type Dayjs } from 'dayjs';
import { getCurrentCompany } from '../../config/company.config';

const { Content } = Layout;

// Get Fusion base URL from current company configuration
const getFusionBase = () => {
  const company = getCurrentCompany();
  return company.fusionBaseUrl ? `${company.fusionBaseUrl}/fscmRestApi/resources/11.13.18.05` : '';
};
const { Title, Text } = Typography;

const FUSION_BASE = `${getFusionBase()}`;
const getHeaders = () => getFusionAuthHeaders();
const PAGE_LIMIT = 500;

const REDWOOD = {
  primary: '#C74634', success: '#1D7B4D', warning: '#B07700', info: '#0572CE',
  error: '#D93025', teal: '#00918A', purple: '#7245A6',
  neutral100: '#F7F7F7', neutral200: '#E5E5E5', neutral300: '#C7C7C7',
  neutral600: '#6B6B6B', neutral900: '#1A1A1A', surface: '#FFFFFF',
};

const fmtDate = (d?: string) => { if (!d) return '—'; try { return dayjs(d).format('D-MMM-YYYY'); } catch { return d; } };
const fmtQty = (v?: number | null) => (v == null ? '—' : new Intl.NumberFormat('en-US').format(v));
const num = (v: any) => { const n = Number(v); return isNaN(n) ? 0 : n; };
const pickField = (r: any, keys: string[]) => { for (const k of keys) { const v = r?.[k]; if (v != null && v !== '') return v; } return undefined; };

const mapLimit = async <T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> => {
  const out: R[] = new Array(items.length); let idx = 0;
  const worker = async () => { while (idx < items.length) { const c = idx++; out[c] = await fn(items[c]); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
};

const fetchAllPages = async (baseUrl: string): Promise<any[]> => {
  const stripped = baseUrl.replace(/[?&]limit=\d+/gi, '').replace(/[?&]offset=\d+/gi, '').replace(/\?&/, '?').replace(/&&/g, '&');
  const all: any[] = [];
  let offset = 0;
  while (true) {
    const sep = stripped.includes('?') ? '&' : '?';
    const url = `${stripped}${sep}limit=${PAGE_LIMIT}&offset=${offset}`;
    const r = await fetch(url, { headers: getHeaders() });
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);
    const d = await r.json();
    const items: any[] = Array.isArray(d) ? d : (d.items ?? []);
    all.push(...items);
    if (!d.hasMore || items.length < PAGE_LIMIT) break;
    offset += PAGE_LIMIT;
  }
  return all;
};

// A field is hidden from generic tables when it's an id/href or empty.
const isHiddenKey = (k: string) => /Id$/.test(k) || k === 'links';
const isEmpty = (v: any) => v == null || v === '' || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v ?? {}).length === 0);
const renderVal = (k: string, v: any): React.ReactNode => {
  if (isEmpty(v)) return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'object') return JSON.stringify(v);
  if (/Date$/.test(k)) return fmtDate(String(v));
  return String(v);
};
const dynamicColumns = (items: any[]): ColumnsType<any> => {
  const keys: string[] = []; const seen = new Set<string>();
  items.forEach(it => Object.keys(it ?? {}).forEach(k => {
    if (seen.has(k) || isHiddenKey(k)) return;
    if (items.some(row => !isEmpty(row?.[k]))) { seen.add(k); keys.push(k); }
  }));
  return keys.map(k => ({
    title: k.replace(/([A-Z])/g, ' $1').replace(/^ /, ''),
    dataIndex: k, width: 160, ellipsis: true,
    render: (v: any) => <Text style={{ fontSize: 12 }}>{renderVal(k, v)}</Text>,
  }));
};

// Clamp long text to 2 lines with a hover tooltip showing the full value.
const ClampTip: React.FC<{ text?: string }> = ({ text }) => {
  if (!text) return <>—</>;
  return (
    <Tooltip title={text}>
      <div style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', cursor: 'help' }}>{text}</div>
    </Tooltip>
  );
};

interface AllocRow { line: any; item: string; lot?: string; from?: string; to?: string; qty: number }

// Aggregate one line-level child (e.g. itemLots) across every pick line.
// `allocRows` (used for itemSerials) is shown when the collection is empty.
const MergedChildTab: React.FC<{ lines: any[]; name: string; allocRows?: AllocRow[] }> = ({ lines, name, allocRows }) => {
  const [items, setItems] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const targets = useMemo(() =>
    lines.map(l => ({ line: l, href: l.links?.find((x: any) => x.name === name)?.href }))
      .filter(t => t.href) as { line: any; href: string }[],
  [lines, name]);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const results = await mapLimit(targets, 6, async (t) => {
        try {
          const rows = await fetchAllPages(t.href);
          return rows.map(r => ({ ...r, _pickSlipLine: t.line.PickSlipLine, _item: t.line.Item }));
        } catch { return []; }
      });
      setItems(results.flat());
    } catch (e: any) { setError(e.message); setItems([]); }
    finally { setLoading(false); }
  }, [targets]);
  useEffect(() => { load(); }, [load]);

  const cols = useMemo<ColumnsType<any>>(() => ([
    { title: 'Line', dataIndex: '_pickSlipLine', width: 60, align: 'center', fixed: 'left', render: (v: any) => <Tag color="blue" style={{ fontSize: 11 }}>{v ?? '—'}</Tag> },
    { title: 'Item', dataIndex: '_item', width: 130, render: (v: any) => <Text strong style={{ fontSize: 12, color: REDWOOD.info }}>{v ?? '—'}</Text> },
    ...dynamicColumns((items ?? []).map(({ _pickSlipLine, _item, ...rest }) => rest)),
  ]), [items]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <Text type="secondary" style={{ marginRight: 'auto', fontSize: 11 }}>Merged from {targets.length} line{targets.length !== 1 ? 's' : ''}</Text>
        <Tooltip title={<span style={{ fontFamily: 'monospace', fontSize: 11 }}><b>GET</b> …/pickLines/&#123;line&#125;/child/{name}</span>}>
          <Button size="small" type="text" icon={<ApiOutlined />} style={{ color: REDWOOD.info }} />
        </Tooltip>
        <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={load}>Reload</Button>
      </div>
      {loading ? <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
        : error ? <div style={{ color: REDWOOD.error, fontSize: 12 }}><InfoCircleOutlined style={{ marginRight: 6 }} />{error}</div>
        : items && items.length > 0
          ? <Table size="small" columns={cols} dataSource={items} rowKey={(_, i) => `${name}-${i}`}
              pagination={items.length > 20 ? { pageSize: 20, size: 'small' } : false} scroll={{ x: 'max-content', y: 360 }} />
        : (allocRows && allocRows.length > 0) ? (
          <div>
            <div style={{ fontSize: 12, color: REDWOOD.neutral600, marginBottom: 8 }}>
              <InfoCircleOutlined style={{ marginRight: 6 }} />No {name} on the pick lines yet — showing your serial allocation.
            </div>
            <Table size="small" pagination={false} scroll={{ x: 700, y: 360 }}
              dataSource={allocRows.map((a, i) => ({ ...a, key: i }))} rowKey="key"
              columns={[
                { title: 'Line', dataIndex: 'line', width: 60, align: 'center', render: (v: any) => <Tag color="blue" style={{ fontSize: 11 }}>{v ?? '—'}</Tag> },
                { title: 'Item', dataIndex: 'item', width: 140, render: (v: any) => <Text strong style={{ fontSize: 12, color: REDWOOD.info }}>{v ?? '—'}</Text> },
                { title: 'Selected Lot', dataIndex: 'lot', width: 140, render: (v: any) => v ? <Tag color="geekblue" style={{ fontSize: 11 }}>{v}</Tag> : <Text type="secondary">—</Text> },
                { title: 'Serial From', dataIndex: 'from', width: 140, render: (v: any) => <Text style={{ fontSize: 12 }}>{v ?? '—'}</Text> },
                { title: 'Serial To', dataIndex: 'to', width: 140, render: (v: any) => <Text style={{ fontSize: 12 }}>{v ?? '—'}</Text> },
                { title: 'Qty', dataIndex: 'qty', width: 70, align: 'right', render: (v: any) => <Text strong>{v}</Text> },
              ]} />
          </div>
        ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={`No ${name} across the pick lines`} style={{ padding: 24 }} />}
    </div>
  );
};

// ── Lot / Serial allocation for a pick line (from on-hand) ───────────────────
interface Allocation { item: string; lot?: string; serials: string[] }

const AllocateModal: React.FC<{ line: any | null; org?: string; onClose: () => void; onApply: (pickSlipLine: any, alloc: Allocation) => void }> = ({ line, org, onClose, onApply }) => {
  const item = line?.Item;
  const subinv = line?.SourceSubinventory;
  const reqQty = num(line?.RequestedQuantity);

  const [balances, setBalances] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selLot, setSelLot] = useState<string | undefined>(undefined);
  const [selSerials, setSelSerials] = useState<string[]>([]);

  const url = useMemo(() => {
    if (!org || !item) return '';
    const q = `OrganizationCode=${org};ItemNumber=${item}` + (subinv ? `;SubinventoryCode=${subinv}` : '');
    return `${FUSION_BASE}/inventoryOnhandBalances?q=${encodeURIComponent(q)}&expand=lots.lotSerials,serials&onlyData=true&limit=500`;
  }, [org, item, subinv]);

  const load = useCallback(async () => {
    if (!url) return;
    setLoading(true); setError(''); setSelLot(undefined); setSelSerials([]);
    try { setBalances(await fetchAllPages(url)); }
    catch (e: any) { setError(e.message); setBalances([]); }
    finally { setLoading(false); }
  }, [url]);
  useEffect(() => { if (line) load(); }, [line, load]);

  // Available lots (aggregated across balances) with their serials.
  const lots = useMemo(() => {
    const map: Record<string, { lot: string; qty: number; serials: string[] }> = {};
    balances.forEach(b => (b.lots ?? []).forEach((lot: any) => {
      const ln = lot.LotNumber; if (!ln) return;
      if (!map[ln]) map[ln] = { lot: ln, qty: 0, serials: [] };
      map[ln].qty += num(pickField(lot, ['OnhandQuantity', 'PrimaryQuantity', 'Quantity', 'LotQuantity']));
      (lot.lotSerials ?? []).forEach((s: any) => { const sn = pickField(s, ['SerialNumber', 'FmSerialNumber']); if (sn) map[ln].serials.push(sn); });
    }));
    return Object.values(map).sort((a, b) => a.lot.localeCompare(b.lot));
  }, [balances]);

  // Serial-only items (no lot control): serials live directly under the balance.
  const serialOnly = useMemo(() =>
    Array.from(new Set(balances.flatMap(b => (b.serials ?? []).map((s: any) => pickField(s, ['SerialNumber', 'FmSerialNumber'])).filter(Boolean)))),
  [balances]);

  const availSerials: string[] = useMemo(() => {
    if (selLot) return lots.find(l => l.lot === selLot)?.serials ?? [];
    return serialOnly as string[];
  }, [selLot, lots, serialOnly]);

  // Auto-select serials based on requested quantity
  useEffect(() => {
    if (availSerials.length > 0 && selSerials.length === 0) {
      const toSelect = availSerials.slice(0, reqQty);
      setSelSerials(toSelect);
    }
  }, [availSerials, reqQty]);

  const isLotControlled = lots.length > 0;
  const overAllocated = selSerials.length > reqQty;

  return (
    <Modal
      open={!!line} onCancel={onClose} maskClosable={false} width={720}
      title={<Space><ProfileOutlined style={{ color: REDWOOD.primary }} /> Allocate — <Text strong>{item}</Text>
        <Tag color="blue">Line {line?.PickSlipLine}</Tag></Space>}
      footer={<Space>
        <Text type={overAllocated ? 'danger' : undefined} style={{ marginRight: 'auto', fontSize: 12 }}>
          Allocated <b>{selSerials.length}</b> of <b>{reqQty}</b>{overAllocated ? ' — over requested!' : ''}
        </Text>
        <Button onClick={onClose}>Cancel</Button>
        <Button type="primary" disabled={selSerials.length === 0 || overAllocated}
          style={{ background: REDWOOD.success, borderColor: REDWOOD.success }}
          onClick={() => {
            onApply(line?.PickSlipLine, { item, lot: selLot, serials: [...selSerials] });
            message.success(`Allocated ${selSerials.length} serial(s)${selLot ? ` from lot ${selLot}` : ''} to line ${line?.PickSlipLine}`);
            onClose();
          }}>
          Apply Allocation
        </Button>
      </Space>}
    >
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 12, fontSize: 12 }}>
        <span><Text type="secondary">Org: </Text><Tag>{org}</Tag></span>
        <span><Text type="secondary">Requested: </Text><b>{fmtQty(reqQty)} {line?.UOM}</b></span>
        {subinv && <span><Text type="secondary">Subinventory: </Text>{subinv}</span>}
        <Tooltip title={<span style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}><b>GET</b> {url}</span>}>
          <Button size="small" type="text" icon={<ApiOutlined />} style={{ color: REDWOOD.info, marginLeft: 'auto' }} />
        </Tooltip>
        <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={load}>Reload</Button>
      </div>

      {loading ? <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
        : error ? <div style={{ color: REDWOOD.error, fontSize: 12 }}><InfoCircleOutlined style={{ marginRight: 6 }} />{error}</div>
        : (
          <>
            {isLotControlled && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Lot <span style={{ color: REDWOOD.error }}>*</span> <Text type="secondary" style={{ fontWeight: 400 }}>(change lot for this line)</Text></div>
                <Select showSearch style={{ width: '100%' }} placeholder="Select a lot from on-hand" value={selLot}
                  onChange={v => { setSelLot(v); setSelSerials([]); }}
                  options={lots.map(l => ({ value: l.lot, label: `${l.lot} — on-hand ${fmtQty(l.qty)}${l.serials.length ? ` · ${l.serials.length} serial(s)` : ''}` }))}
                  notFoundContent="No lots on hand" />
              </div>
            )}
            {!isLotControlled && serialOnly.length === 0 ? (
              <Empty description="No lots or serials on hand for this item / subinventory" style={{ padding: 24 }} />
            ) : (
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                  Available Serial Numbers {selLot ? <Text type="secondary" style={{ fontWeight: 400 }}>for lot {selLot}</Text> : ''}
                  {availSerials.length > 0 && <Tag style={{ marginLeft: 6 }}>{availSerials.length}</Tag>}
                </div>
                {isLotControlled && !selLot ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Select a lot to see its serials" style={{ padding: 20 }} />
                ) : availSerials.length === 0 ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No serials on hand" style={{ padding: 20 }} />
                ) : (
                  <Table
                    size="small" scroll={{ y: 300 }} pagination={false}
                    dataSource={availSerials.map((s, i) => ({ key: `${s}-${i}`, SerialNumber: s }))}
                    rowKey="SerialNumber"
                    rowSelection={{
                      selectedRowKeys: selSerials,
                      onChange: (keys) => setSelSerials(keys as string[]),
                      getCheckboxProps: (rec: any) => ({ disabled: !selSerials.includes(rec.SerialNumber) && selSerials.length >= reqQty }),
                    }}
                    columns={[{ title: 'Serial Number', dataIndex: 'SerialNumber', render: v => <Text strong style={{ fontSize: 12 }}>{v}</Text> }]}
                  />
                )}
              </div>
            )}
          </>
        )}
    </Modal>
  );
};

// ── Confirm Pick — build pickTransactions body & POST ────────────────────────
const CONFIRM_URL = `${FUSION_BASE}/pickTransactions`;

// Build the pickTransactions payload from the recorded per-line allocations.
// Shape mirrors the Fusion pickTransactions resource:
//   { pickLines:[ { PickSlip, PickSlipLine, PickedQuantity, SubinventoryCode,
//       lotSerialItemLots:[ { Lot, Quantity,
//         lotSerialItemSerials:[ { FromSerialNumber, ToSerialNumber } ] } ] } ] }
const buildConfirmPayload = (row: any, pickLines: any[], allocations: Record<string, Allocation>) => {
  const lineByKey: Record<string, any> = {};
  pickLines.forEach(l => { lineByKey[String(l.PickSlipLine)] = l; });
  const lines = Object.entries(allocations).map(([lineKey, a]) => {
    const l = lineByKey[lineKey] ?? {};
    const qty = a.serials.length;
    const subinv = pickField(l, ['SourceSubinventory', 'DestinationSubinventory', 'Subinventory']);
    const base: any = {
      PickSlip: String(row?.PickSlip ?? l.PickSlip ?? ''),
      PickSlipLine: String(lineKey),
      PickedQuantity: String(qty),
      ...(subinv ? { SubinventoryCode: subinv } : {}),
    };
    const serials = a.serials.map(s => ({ FromSerialNumber: s, ToSerialNumber: s }));
    if (a.lot) {
      base.lotSerialItemLots = [{ Lot: a.lot, Quantity: String(qty), lotSerialItemSerials: serials }];
    } else if (serials.length) {
      base.serialItemSerials = serials;
    }
    return base;
  });
  return { pickLines: lines };
};

const ConfirmPickModal: React.FC<{ open: boolean; payload: any | null; onClose: () => void; onDone: () => void }> = ({ open, payload, onClose, onDone }) => {
  const [submitting, setSubmitting] = useState(false);
  const [resp, setResp] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { if (open) setResp(null); }, [open]);

  const body = useMemo(() => (payload ? JSON.stringify(payload, null, 2) : ''), [payload]);
  const nLines = payload?.pickLines?.length ?? 0;

  const submit = async () => {
    if (!payload) return;
    setSubmitting(true); setResp(null);
    try {
      const r = await fetch(CONFIRM_URL, {
        method: 'POST',
        headers: { ...getHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const text = await r.text();
      let pretty = text; try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch { /* keep raw */ }
      if (r.ok) { setResp({ ok: true, text: pretty }); message.success('Pick confirmed in Fusion'); onDone(); }
      else { setResp({ ok: false, text: `HTTP ${r.status} ${r.statusText}\n${pretty}` }); message.error(`Confirm failed (HTTP ${r.status})`); }
    } catch (e: any) { setResp({ ok: false, text: e.message }); message.error('Confirm failed'); }
    finally { setSubmitting(false); }
  };

  return (
    <Modal open={open} onCancel={onClose} maskClosable={false} width={780}
      title={<Space><CheckSquareOutlined style={{ color: REDWOOD.success }} /> Confirm Pick
        <Tag color="green">{nLines} line{nLines !== 1 ? 's' : ''}</Tag></Space>}
      footer={<Space>
        <Button size="small" type="text" icon={<CopyOutlined />} style={{ marginRight: 'auto' }}
          onClick={() => { navigator.clipboard.writeText(body); message.success('Copied'); }}>Copy JSON</Button>
        <Button onClick={onClose}>{resp?.ok ? 'Close' : 'Cancel'}</Button>
        {!resp?.ok && (
          <Button type="primary" loading={submitting} disabled={nLines === 0}
            style={{ background: REDWOOD.success, borderColor: REDWOOD.success }} onClick={submit}>Submit to Fusion</Button>
        )}
      </Space>}>
      <div style={{ fontSize: 12, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
        <Tag color="green">POST</Tag>
        <Text style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all', color: REDWOOD.info }}>{CONFIRM_URL}</Text>
      </div>
      {nLines === 0
        ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No allocated lines to confirm — use Allocate on a pick line first." style={{ padding: 24 }} />
        : (
          <div style={{ maxHeight: 340, overflow: 'auto', background: REDWOOD.neutral100, border: `1px solid ${REDWOOD.neutral200}`, borderRadius: 6, padding: 12 }}>
            <pre style={{ margin: 0, fontSize: 11, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{body}</pre>
          </div>
        )}
      {resp && (
        <div style={{ marginTop: 12, padding: 12, borderRadius: 6,
          background: (resp.ok ? REDWOOD.success : REDWOOD.error) + '12', border: `1px solid ${(resp.ok ? REDWOOD.success : REDWOOD.error)}55` }}>
          <div style={{ fontWeight: 700, color: resp.ok ? REDWOOD.success : REDWOOD.error, marginBottom: 6, fontSize: 12 }}>
            {resp.ok ? <><CheckSquareOutlined /> Success</> : <><InfoCircleOutlined /> Error</>}
          </div>
          <pre style={{ margin: 0, fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 200, overflow: 'auto' }}>{resp.text}</pre>
        </div>
      )}
    </Modal>
  );
};

// ── Ship Confirm ─────────────────────────────────────────────────────────────
// Without a date: quick-action POST shippingTransactions {ShipmentName,
// Action:"CONFIRM", Organization} — confirms with rule defaults (actual ship
// date = today). With an Actual Ship Date: the documented external-confirm
// route — POST shipmentTransactionRequests, ActionCode "ShipmentUpdate", the
// shipments node carrying ActualShipDate + ShipConfirmRule.
export const SHIP_CONFIRM_URL = `${FUSION_BASE}/shippingTransactions`;
export const SHIP_TXN_REQ_URL = `${FUSION_BASE}/shipmentTransactionRequests`;
const DEFAULT_SHIP_CONFIRM_RULE = '002_Ship_Confirm_Rule';

// Reusable ship-confirm dialog.
export const ShipConfirmModal: React.FC<{
  open: boolean; shipmentName?: string; organization?: string; onClose: () => void; onDone?: () => void;
}> = ({ open, shipmentName, organization, onClose, onDone }) => {
  const [name, setName] = useState('');
  const [org, setOrg] = useState('');
  const [actualDate, setActualDate] = useState<Dayjs | null>(null);
  const [rule, setRule] = useState(DEFAULT_SHIP_CONFIRM_RULE);
  const [submitting, setSubmitting] = useState(false);
  const [resp, setResp] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { if (open) { setName(shipmentName ?? ''); setOrg(organization ?? ''); setActualDate(null); setResp(null); } }, [open, shipmentName, organization]);

  const useDated = !!actualDate;
  const payload = useMemo(() => useDated
    ? {
        ActionCode: 'ShipmentUpdate',
        shipments: [{
          Shipment: name,
          ShipFromOrganizationCode: org,
          ActualShipDate: actualDate!.format('YYYY-MM-DDTHH:mm:ssZ'),
          ...(rule.trim() ? { ShipConfirmRule: rule.trim() } : {}),
        }],
      }
    : { ShipmentName: name, Action: 'CONFIRM', Organization: org },
  [useDated, name, org, actualDate, rule]);
  const submitUrl = useDated ? SHIP_TXN_REQ_URL : SHIP_CONFIRM_URL;
  const body = useMemo(() => JSON.stringify(payload, null, 2), [payload]);

  const submit = async () => {
    if (!name.trim() || !org.trim()) { message.warning('Shipment and Organization are required'); return; }
    setSubmitting(true); setResp(null);
    try {
      const r = await fetch(submitUrl, {
        method: 'POST',
        headers: { ...getHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const text = await r.text();
      let pretty = text; try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch { /* keep raw */ }
      if (r.ok) { setResp({ ok: true, text: pretty }); message.success(useDated ? 'Shipment update request submitted (processed via the shipment interface — recheck the line status shortly)' : 'Ship confirmed in Fusion'); onDone?.(); }
      else { setResp({ ok: false, text: `HTTP ${r.status} ${r.statusText}\n${pretty}` }); message.error(`Ship confirm failed (HTTP ${r.status})`); }
    } catch (e: any) { setResp({ ok: false, text: e.message }); message.error('Ship confirm failed'); }
    finally { setSubmitting(false); }
  };

  return (
    <Modal open={open} onCancel={onClose} maskClosable={false} width={620}
      title={<Space><CarOutlined style={{ color: REDWOOD.success }} /> Ship Confirm</Space>}
      footer={<Space>
        <Button size="small" type="text" icon={<CopyOutlined />} style={{ marginRight: 'auto' }}
          onClick={() => { navigator.clipboard.writeText(body); message.success('Copied'); }}>Copy JSON</Button>
        <Button onClick={onClose}>{resp?.ok ? 'Close' : 'Cancel'}</Button>
        {!resp?.ok && (
          <Button type="primary" loading={submitting} onClick={submit}
            style={{ background: REDWOOD.success, borderColor: REDWOOD.success }}>Submit to Fusion</Button>
        )}
      </Space>}>
      <Row gutter={12}>
        <Col span={16}>
          <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}>Shipment <span style={{ color: REDWOOD.error }}>*</span></div>
          <Input value={name} placeholder="Shipment name / number" onChange={e => setName(e.target.value)} />
        </Col>
        <Col span={8}>
          <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}>Organization <span style={{ color: REDWOOD.error }}>*</span></div>
          <Input value={org} placeholder="e.g. AMS" onChange={e => setOrg(e.target.value)} />
        </Col>
      </Row>
      <Row gutter={12} style={{ marginTop: 10 }}>
        <Col span={12}>
          <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}>Actual Ship Date <Text type="secondary" style={{ fontWeight: 400 }}>(optional — empty = today)</Text></div>
          <DatePicker showTime value={actualDate} onChange={setActualDate} format="D-MMM-YYYY HH:mm" style={{ width: '100%' }} />
        </Col>
        {useDated && (
          <Col span={12}>
            <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}>Ship Confirm Rule</div>
            <Input value={rule} onChange={e => setRule(e.target.value)} placeholder={DEFAULT_SHIP_CONFIRM_RULE} />
          </Col>
        )}
      </Row>
      {useDated && (
        <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 6 }}>
          With a date set, the confirm goes through the shipment interface (shipmentTransactionRequests, ActionCode ShipmentUpdate) so ActualShipDate is honored — shippingTransactions cannot carry a date. The request is processed asynchronously; recheck the shipment after a moment.
        </Text>
      )}
      <div style={{ fontSize: 12, margin: '12px 0 6px', display: 'flex', alignItems: 'center', gap: 6 }}>
        <Tag color="green">POST</Tag>
        <Text style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all', color: REDWOOD.info }}>{submitUrl}</Text>
      </div>
      <div style={{ maxHeight: 220, overflow: 'auto', background: REDWOOD.neutral100, border: `1px solid ${REDWOOD.neutral200}`, borderRadius: 6, padding: 12 }}>
        <pre style={{ margin: 0, fontSize: 11, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{body}</pre>
      </div>
      {resp && (
        <div style={{ marginTop: 12, padding: 12, borderRadius: 6,
          background: (resp.ok ? REDWOOD.success : REDWOOD.error) + '12', border: `1px solid ${(resp.ok ? REDWOOD.success : REDWOOD.error)}55` }}>
          <div style={{ fontWeight: 700, color: resp.ok ? REDWOOD.success : REDWOOD.error, marginBottom: 6, fontSize: 12 }}>
            {resp.ok ? <><CheckSquareOutlined /> Success</> : <><InfoCircleOutlined /> Error</>}
          </div>
          <pre style={{ margin: 0, fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 200, overflow: 'auto' }}>{resp.text}</pre>
        </div>
      )}
    </Modal>
  );
};

// ── Pick Slip drill dialog (header + pickLines) ──────────────────────────────
export const PickSlipDialog: React.FC<{ row: any | null; onClose: () => void }> = ({ row, onClose }) => {
  const pickLinesHref = row?.links?.find((l: any) => l.name === 'pickLines')?.href
    ?? (row ? `${FUSION_BASE}/pickSlipDetails/${row.PickSlip}/child/pickLines` : '');

  // Load the pick lines (with their links) at the dialog level so we can also
  // aggregate each line-level child (itemLots, itemSerials, …) across lines.
  const [pickLines, setPickLines] = useState<any[]>([]);
  const [linesLoading, setLinesLoading] = useState(false);
  const [linesError, setLinesError] = useState('');
  const loadPickLines = useCallback(async () => {
    if (!pickLinesHref) return;
    setLinesLoading(true); setLinesError('');
    try { setPickLines(await fetchAllPages(pickLinesHref)); }
    catch (e: any) { setLinesError(e.message); setPickLines([]); }
    finally { setLinesLoading(false); }
  }, [pickLinesHref]);
  useEffect(() => { if (row) loadPickLines(); }, [row, loadPickLines]);

  // Distinct line-level child collections across all pick lines → one tab each.
  const childNames = useMemo(() => {
    const s = new Set<string>();
    pickLines.forEach(l => (l.links ?? []).forEach((x: any) => { if (x.rel === 'child' && x.name) s.add(x.name); }));
    return Array.from(s).sort();
  }, [pickLines]);

  const [allocLine, setAllocLine] = useState<any | null>(null);
  const [allocations, setAllocations] = useState<Record<string, Allocation>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [shipOpen, setShipOpen] = useState(false);
  const allocCount = Object.keys(allocations).length;
  const confirmPayload = useMemo(
    () => buildConfirmPayload(row, pickLines, allocations),
    [row, pickLines, allocations],
  );

  // Turn recorded allocations into rows (Line, Item, Lot, Serial From/To, Qty).
  const allocRows: AllocRow[] = useMemo(() => Object.entries(allocations).map(([line, a]) => {
    const sorted = [...a.serials].sort((x, y) => x.localeCompare(y, undefined, { numeric: true }));
    return { line, item: a.item, lot: a.lot, from: sorted[0], to: sorted[sorted.length - 1], qty: a.serials.length };
  }), [allocations]);
  // Clear recorded allocations when a different pick slip is opened.
  useEffect(() => { setAllocations({}); }, [row?.PickSlip]);

  const HInfo: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
    <Col xs={12} sm={8} md={6}>
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: REDWOOD.neutral600, textTransform: 'uppercase', letterSpacing: '0.03em' }}>{label}</div>
        <div style={{ fontSize: 12.5, color: REDWOOD.neutral900, marginTop: 2, wordBreak: 'break-word' }}>{value ?? '—'}</div>
      </div>
    </Col>
  );

  const lineCols: ColumnsType<any> = [
    { title: 'Slip Line', dataIndex: 'PickSlipLine', width: 75, align: 'center', render: v => <Tag color="blue" style={{ fontSize: 11 }}>{v ?? '—'}</Tag> },
    { title: 'Item', dataIndex: 'Item', width: 130, render: v => <Text strong style={{ color: REDWOOD.info, fontSize: 12 }}>{v ?? '—'}</Text> },
    { title: 'Requested Qty', dataIndex: 'RequestedQuantity', width: 110, align: 'right', render: (v, r) => `${fmtQty(v)}${r.UOM ? ' ' + r.UOM : ''}` },
    { title: 'Max Picked', dataIndex: 'MaximumPickedQuantity', width: 100, align: 'right', render: fmtQty },
    { title: 'Transaction Type', dataIndex: 'TransactionType', width: 150, render: v => <Tag style={{ fontSize: 11 }}>{v ?? '—'}</Tag> },
    { title: 'Src Subinv', dataIndex: 'SourceSubinventory', width: 110, render: v => v ?? '—' },
    { title: 'Dest Subinv', dataIndex: 'DestinationSubinventory', width: 110, render: v => v ?? '—' },
    { title: 'Src Locator', dataIndex: 'SourceLocator', width: 110, render: v => v ?? '—' },
    { title: 'Required Date', dataIndex: 'RequiredDate', width: 120, render: fmtDate },
    { title: 'Source Order', dataIndex: 'SourceOrder', width: 110, render: (v, r) => v ? `${v}${r.SourceOrderLine ? ' / ' + r.SourceOrderLine : ''}` : '—' },
    { title: 'Mv Req Line', dataIndex: 'MovementRequestLine', width: 100, align: 'center', render: v => v ?? '—' },
    { title: 'Error', dataIndex: 'ErrorExplanation', width: 160, ellipsis: true,
      render: (v, r) => (v || r.ErrorCode) ? <Text type="danger" style={{ fontSize: 11 }}>{v ?? r.ErrorCode}</Text> : '—' },
    { title: '', key: 'alloc', width: 110, fixed: 'right', align: 'center',
      render: (_, r) => (
        <Tooltip title="Change lot & allocate serials from on-hand">
          <Button size="small" icon={<ProfileOutlined />} style={{ borderColor: REDWOOD.primary, color: REDWOOD.primary, fontSize: 11 }}
            onClick={() => setAllocLine(r)}>Allocate</Button>
        </Tooltip>
      ) },
  ];

  return (
    <Modal
      open={!!row} onCancel={onClose} maskClosable={false} width={1040} style={{ top: 24 }}
      footer={<Space>
        <Text type="secondary" style={{ marginRight: 'auto', fontSize: 12 }}>
          {allocCount > 0
            ? <>Allocated <b>{allocCount}</b> line{allocCount !== 1 ? 's' : ''} — ready to confirm</>
            : 'Use Allocate on a pick line to enable Confirm Pick'}
        </Text>
        <Button onClick={onClose}>Close</Button>
        <Button type="primary" icon={<CheckSquareOutlined />} disabled={allocCount === 0}
          style={{ background: REDWOOD.success, borderColor: REDWOOD.success }}
          onClick={() => setConfirmOpen(true)}>Confirm Pick</Button>
        <Button icon={<CarOutlined />} onClick={() => setShipOpen(true)}
          style={{ borderColor: REDWOOD.info, color: REDWOOD.info }}>Ship Confirm</Button>
      </Space>}
      title={<Space><CheckSquareOutlined style={{ color: REDWOOD.primary }} /> Pick Slip <Tag color="volcano">{row?.PickSlip}</Tag>
        {row?.PickWave && <Tag color="purple">Wave {row.PickWave}</Tag>}</Space>}
    >
      {/* Header */}
      <Card size="small" title={<Space><BankOutlined style={{ color: REDWOOD.primary }} /><Text strong>Header</Text></Space>}
        style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}`, marginBottom: 12 }}>
        {!row ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="—" /> : (
          <Row gutter={[12, 0]}>
            <HInfo label="Pick Slip" value={<Text strong>{row.PickSlip}</Text>} />
            <HInfo label="Pick Wave" value={row.PickWave} />
            <HInfo label="Organization" value={<Tag>{row.Organization}</Tag>} />
            <HInfo label="Order" value={<Text strong>{row.Order}</Text>} />
            <HInfo label="Customer" value={row.Customer} />
            <HInfo label="# Picks" value={row.NumberOfPicks} />
            <HInfo label="Due Date" value={fmtDate(row.DueDate)} />
            <HInfo label="Creation Date" value={fmtDate(row.CreationDate)} />
            <HInfo label="Shipment" value={row.Shipment} />
            <HInfo label="Movement Request" value={row.MovementRequest} />
            <HInfo label="Shipping Method" value={row.ShippingMethod} />
            <HInfo label="Ship To Location" value={<ClampTip text={row.ShipToLocation} />} />
          </Row>
        )}
      </Card>

      {/* Pick Lines + one tab per line-level child collection (merged across lines) */}
      <Tabs
        size="small"
        items={[
          {
            key: 'pickLines',
            label: <span><UnorderedListOutlined style={{ marginRight: 5 }} />Pick Lines{pickLines.length ? ` (${pickLines.length})` : ''}</span>,
            children: (
              <div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 8 }}>
                  <Tooltip title={<span style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}><b>GET</b> {pickLinesHref}</span>}>
                    <Button size="small" type="text" icon={<ApiOutlined />} style={{ color: REDWOOD.info }} />
                  </Tooltip>
                  <Button size="small" icon={<ReloadOutlined />} loading={linesLoading} onClick={loadPickLines}>Reload</Button>
                </div>
                {linesLoading ? <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
                  : linesError ? <div style={{ color: REDWOOD.error, fontSize: 12 }}><InfoCircleOutlined style={{ marginRight: 6 }} />{linesError}</div>
                  : pickLines.length === 0 ? <Empty description="No pick lines" style={{ padding: 30 }} />
                  : <Table size="small" columns={lineCols} dataSource={pickLines} rowKey={(r, i) => `${r.PickSlipLine ?? i}`}
                      pagination={false} scroll={{ x: 1520, y: 340 }} />}
              </div>
            ),
          },
          ...childNames.map((name) => ({
            key: name,
            label: <span><ProfileOutlined style={{ marginRight: 5 }} /><span style={{ textTransform: 'capitalize' }}>{name}</span>
              {name === 'itemSerials' && allocRows.length > 0 && <Tag color="green" style={{ marginLeft: 5, fontSize: 10 }}>alloc {allocRows.length}</Tag>}</span>,
            children: <MergedChildTab lines={pickLines} name={name} allocRows={name === 'itemSerials' ? allocRows : undefined} />,
          })),
        ]}
      />

      <AllocateModal line={allocLine} org={row?.Organization} onClose={() => setAllocLine(null)}
        onApply={(k, a) => setAllocations(p => ({ ...p, [String(k)]: a }))} />

      <ConfirmPickModal open={confirmOpen} payload={confirmPayload}
        onClose={() => setConfirmOpen(false)} onDone={() => { /* keep dialog open to show response */ }} />

      <ShipConfirmModal open={shipOpen} shipmentName={row?.Shipment} organization={row?.Organization}
        onClose={() => setShipOpen(false)} />
    </Modal>
  );
};

// ── Page ─────────────────────────────────────────────────────────────────────
interface Filters { dateOp?: string; date?: Dayjs | null; order?: string; org?: string; }

const ConfirmPicks: React.FC = () => {
  const [form] = Form.useForm();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');
  const [apiOpen, setApiOpen] = useState(false);
  const [filterText, setFilterText] = useState('');
  const [dialog, setDialog] = useState<any | null>(null);
  const [orgs, setOrgs] = useState<string[]>([]);

  const [filters, setFilters] = useState<Filters>({ dateOp: '>', date: dayjs().subtract(7, 'day') });

  // Organization dropdown from inventoryOrganizations.
  useEffect(() => {
    fetch(`${FUSION_BASE}/inventoryOrganizations?onlyData=true&limit=500&fields=OrganizationCode`, { headers: getHeaders() })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => setOrgs(Array.from(new Set((d.items ?? []).map((o: any) => o.OrganizationCode).filter(Boolean))).sort() as string[]))
      .catch(() => { /* free-type fallback via the select's search */ });
  }, []);

  const buildQ = useCallback((f: Filters) => {
    const parts: string[] = [];
    if (f.date) parts.push(`CreationDate${f.dateOp || '>'}${dayjs(f.date).format('YYYY-MM-DD')}`);
    if (f.order?.trim()) parts.push(`Order='${f.order.trim()}'`);
    if (f.org) parts.push(`Organization='${f.org}'`);
    return parts.join(';');
  }, []);

  const searchUrl = useMemo(() => {
    const q = buildQ(filters);
    const qs = q ? `q=${encodeURIComponent(q)}&` : '';
    return `${FUSION_BASE}/pickSlipDetails?${qs}orderBy=CreationDate:desc`;
  }, [filters, buildQ]);

  const runSearch = useCallback(async () => {
    setLoading(true); setError(''); setSearched(true);
    try {
      const items = await fetchAllPages(searchUrl);
      setRows(items);
      if (items.length === 0) setError('No pick slips matched.');
    } catch (e: any) { setError(e.message); setRows([]); }
    finally { setLoading(false); }
  }, [searchUrl]);

  const filtered = useMemo(() => {
    const t = filterText.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter(r => JSON.stringify(r).toLowerCase().includes(t));
  }, [rows, filterText]);

  const columns: ColumnsType<any> = [
    { title: 'Pick Slip', dataIndex: 'PickSlip', width: 130, fixed: 'left',
      render: (v, r) => (
        <Space size={2}>
          <Button type="link" style={{ padding: 0, fontWeight: 700, color: REDWOOD.info, fontSize: 12 }} onClick={() => setDialog(r)}>{v}</Button>
          <Tooltip title="Open pick slip"><Button size="small" type="text" icon={<ExportOutlined />} style={{ color: REDWOOD.info }} onClick={() => setDialog(r)} /></Tooltip>
        </Space>
      ) },
    { title: 'Pick Wave', dataIndex: 'PickWave', width: 100, render: v => v ?? '—' },
    { title: 'Org', dataIndex: 'Organization', width: 80, render: v => <Tag style={{ fontSize: 11 }}>{v ?? '—'}</Tag> },
    { title: 'Order', dataIndex: 'Order', width: 150, render: v => <Text strong style={{ fontSize: 12 }}>{v ?? '—'}</Text> },
    { title: 'Customer', dataIndex: 'Customer', width: 200, ellipsis: true, render: v => <Text style={{ fontSize: 12 }}>{v ?? '—'}</Text> },
    { title: '# Picks', dataIndex: 'NumberOfPicks', width: 80, align: 'right', render: fmtQty },
    { title: 'Due Date', dataIndex: 'DueDate', width: 120, render: fmtDate },
    { title: 'Creation Date', dataIndex: 'CreationDate', width: 130, render: fmtDate,
      sorter: (a, b) => String(a.CreationDate ?? '').localeCompare(String(b.CreationDate ?? '')) },
    { title: 'Shipment', dataIndex: 'Shipment', width: 100, render: v => v ?? '—' },
    { title: 'Movement Request', dataIndex: 'MovementRequest', width: 150, render: v => v ?? '—' },
    { title: 'Shipping Method', dataIndex: 'ShippingMethod', width: 130, render: v => v ?? '—' },
    { title: 'Ship To Location', dataIndex: 'ShipToLocation', width: 260, ellipsis: true, render: v => <Text style={{ fontSize: 12 }}>{v ?? '—'}</Text> },
  ];

  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
      <Content>
        <div style={{ padding: '12px 24px', background: REDWOOD.surface, borderBottom: `1px solid ${REDWOOD.neutral200}` }}>
          <Breadcrumb items={[
            { title: <Link to="/home"><HomeOutlined /> Home</Link> },
            { title: <Link to="/procurement">Fusion Supply Chain</Link> },
            { title: 'Confirm Picks' },
          ]} />
          <Title level={4} style={{ margin: '8px 0 0', display: 'flex', alignItems: 'center', gap: 8 }}>
            <CheckSquareOutlined style={{ color: REDWOOD.primary }} /> Confirm Picks
            <Text type="secondary" style={{ fontSize: 13, fontWeight: 400 }}>— pick slips awaiting confirmation (Fusion pickSlipDetails)</Text>
          </Title>
        </div>

        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Card styles={{ body: { padding: '14px 18px' } }} style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}` }}>
            <Form form={form} layout="vertical" size="small">
              <Row gutter={[8, 0]}>
                <Col xs={24} sm={12} md={6}>
                  <Form.Item label={<Text style={{ fontSize: 11, fontWeight: 600 }}>Creation Date</Text>} style={{ marginBottom: 6 }}>
                    <Space.Compact style={{ width: '100%' }}>
                      <Select style={{ width: 62 }} value={filters.dateOp} onChange={v => setFilters(f => ({ ...f, dateOp: v }))}
                        options={['>', '>=', '=', '<=', '<'].map(o => ({ value: o, label: o }))} />
                      <DatePicker style={{ width: '100%' }} value={filters.date} onChange={d => setFilters(f => ({ ...f, date: d }))} />
                    </Space.Compact>
                  </Form.Item>
                </Col>
                <Col xs={12} sm={8} md={5}>
                  <Form.Item label={<Text style={{ fontSize: 11, fontWeight: 600 }}>Order</Text>} style={{ marginBottom: 6 }}>
                    <Input placeholder="Order number" allowClear value={filters.order}
                      onChange={e => setFilters(f => ({ ...f, order: e.target.value }))} onPressEnter={runSearch} />
                  </Form.Item>
                </Col>
                <Col xs={12} sm={8} md={5}>
                  <Form.Item label={<Text style={{ fontSize: 11, fontWeight: 600 }}>Organization</Text>} style={{ marginBottom: 6 }}>
                    <Select allowClear showSearch placeholder="Any" value={filters.org}
                      onChange={v => setFilters(f => ({ ...f, org: v }))}
                      options={orgs.map(o => ({ value: o, label: o }))} />
                  </Form.Item>
                </Col>
              </Row>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <Button type="primary" size="small" icon={<SearchOutlined />} loading={loading} onClick={runSearch}
                  style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}>Search</Button>
                <Button size="small" icon={<ClearOutlined />} onClick={() => setFilters({ dateOp: '>', date: dayjs().subtract(7, 'day') })}>Reset</Button>
                <Tooltip title="API Inspector — pickSlipDetails web service">
                  <Button size="small" icon={<ApiOutlined />} style={{ marginLeft: 'auto', borderColor: REDWOOD.info, color: REDWOOD.info }}
                    onClick={() => setApiOpen(true)}>API</Button>
                </Tooltip>
              </div>
            </Form>
          </Card>

          <Card styles={{ body: { padding: 0 } }} style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}` }}
            title={<Space><CheckSquareOutlined style={{ color: REDWOOD.primary }} /><Text strong>Pick Slips</Text>
              {rows.length > 0 && <Tag>{filtered.length}{filtered.length !== rows.length ? ` of ${rows.length}` : ''} slip{rows.length !== 1 ? 's' : ''}</Tag>}</Space>}
            extra={<Space>
              <Input placeholder="Filter any column…" allowClear size="small" prefix={<SearchOutlined style={{ color: REDWOOD.neutral300 }} />}
                value={filterText} onChange={e => setFilterText(e.target.value)} style={{ width: 220 }} />
              <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={runSearch}>Refresh</Button>
            </Space>}>
            {loading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Spin size="large" tip="Loading…" /></div>
            ) : error && rows.length === 0 ? (
              <div style={{ padding: 24, color: REDWOOD.error, background: REDWOOD.error + '10', margin: 16, borderRadius: 6 }}>
                <InfoCircleOutlined style={{ marginRight: 8 }} />{error}
              </div>
            ) : !searched ? (
              <Empty description="Run a search" style={{ padding: 60 }} />
            ) : filtered.length === 0 ? (
              <Empty description="No pick slips" style={{ padding: 60 }} />
            ) : (
              <Table columns={columns} dataSource={filtered} rowKey={(r, i) => `${r.PickSlip ?? i}`} size="small"
                scroll={{ x: 1700 }} pagination={{ pageSize: 25, size: 'small', showSizeChanger: true, showTotal: t => `${t} slips` }} />
            )}
          </Card>
        </div>

        <Modal title={<Space><ApiOutlined style={{ color: REDWOOD.info }} /> Pick Slips API</Space>}
          open={apiOpen} onCancel={() => setApiOpen(false)} maskClosable={false} width={860}
          footer={<Button onClick={() => setApiOpen(false)}>Close</Button>}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[
              { lbl: 'Search pick slips', url: decodeURIComponent(searchUrl) },
              { lbl: 'Pick lines (per slip)', url: `${FUSION_BASE}/pickSlipDetails/{PickSlip}/child/pickLines` },
            ].map(({ lbl, url }) => (
              <div key={lbl}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Text style={{ fontSize: 11, fontWeight: 700, color: REDWOOD.neutral600, textTransform: 'uppercase' }}>{lbl}</Text>
                  <Button size="small" type="text" icon={<CopyOutlined />} style={{ marginLeft: 'auto' }}
                    onClick={() => { navigator.clipboard.writeText(url); message.success('Copied'); }}>Copy</Button>
                </div>
                <div style={{ marginTop: 4, padding: '8px 12px', borderRadius: 6, background: REDWOOD.neutral100, border: `1px solid ${REDWOOD.neutral200}`, fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all', color: REDWOOD.info }}>
                  <Tag color="blue">GET</Tag>{url}
                </div>
              </div>
            ))}
            <Text type="secondary" style={{ fontSize: 11 }}>Dates unquoted (CreationDate&gt;2026-07-25); text exact ('value'). Auth: Basic [{getFusionInstance().username}].</Text>
          </div>
        </Modal>

        <PickSlipDialog row={dialog} onClose={() => setDialog(null)} />
      </Content>
    </Layout>
  );
};

export default ConfirmPicks;
