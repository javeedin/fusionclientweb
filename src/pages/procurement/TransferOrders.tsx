import { getFusionAuthHeaders } from '../../config/api.helper';
import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  Layout, Breadcrumb, Card, Table, Form, Input, Select, DatePicker, Button,
  Tabs, Tag, Typography, Space, Tooltip, Spin, Row, Col, message, Modal,
  InputNumber, Empty, Divider, Segmented,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  HomeOutlined, SwapOutlined, SearchOutlined, ReloadOutlined, PlusOutlined,
  DeleteOutlined, ApiOutlined, CopyOutlined, ClearOutlined, EyeOutlined,
  CheckCircleOutlined, EnvironmentOutlined, InfoCircleOutlined, CloudUploadOutlined,
  UnorderedListOutlined, EditOutlined, PrinterOutlined, DollarOutlined,
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

// Get Fusion host (without API path) from current company configuration
const getFusionHost = () => {
  const company = getCurrentCompany();
  return company.fusionBaseUrl || '';
};

const { Title, Text } = Typography;

// Electron goes direct (no CORS); browser dev routes via the Vite proxy.
// preload exposes window.electronAPI (not window.electron) — detect via that.
const FUSION_BASE = `${getFusionBase()}`;
// itemCosts is exposed on the "latest" resource version (same as Manage Item Cost).
const LATEST_URL = `${getFusionHost()}/fscmRestApi/resources/latest`;
const HEADERS = getFusionAuthHeaders();
const HEADERS = { Authorization: HEADERS, Accept: 'application/json' };
const CHILD_LIMIT = 500;

const REDWOOD = {
  primary: '#C74634', primaryLight: '#E85D4A', primaryDark: '#A33B2C',
  success: '#1D7B4D', warning: '#B07700', info: '#0572CE', error: '#D93025',
  teal: '#00918A', purple: '#7245A6',
  neutral100: '#F7F7F7', neutral200: '#E5E5E5', neutral300: '#C7C7C7',
  neutral600: '#6B6B6B', neutral900: '#1A1A1A', surface: '#FFFFFF',
};

// ── Helpers ──────────────────────────────────────────────────────────────────
const fmtDate = (d?: string) => { if (!d) return '—'; try { return dayjs(d).format('D-MMM-YYYY'); } catch { return d; } };
const fmtQty = (v?: number | null) => (v == null ? '—' : new Intl.NumberFormat('en-US').format(v));
const fmtPrice = (v?: number | null, ccy?: string) => {
  if (v == null) return '—';
  const s = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v));
  return ccy ? `${s} ${ccy}` : s;
};

// itemCosts stores org inside ValuationUnit "COSTORG-INVORG-SUBINV-LOT". The
// inventory org (parts[1]) is what a transfer's source/destination org matches.
const parseVU = (vu?: string) => {
  if (!vu) return { costOrg: '', invOrg: '', subinv: '', lot: '' };
  const parts = String(vu).split(/(?<!\\)-/);
  return { costOrg: parts[0] || '', invOrg: parts[1] || '', subinv: parts[2] || '', lot: parts.slice(3).join('-').replace(/\\-/g, '-') };
};
const rowOrgMatches = (row: any, org?: string) => {
  if (!org) return false;
  const p = parseVU(row.ValuationUnit);
  return [p.invOrg, p.costOrg, row.OrganizationCode, row.OrganizationName].includes(org);
};

// Run async fn over items with limited concurrency (avoids hammering Fusion).
const mapLimit = async <T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> => {
  const out: R[] = new Array(items.length);
  let idx = 0;
  const worker = async () => {
    while (idx < items.length) {
      const cur = idx++;
      out[cur] = await fn(items[cur], cur);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
};

const fetchAllPages = async (baseUrl: string): Promise<any[]> => {
  const stripped = baseUrl.replace(/[?&]limit=\d+/gi, '').replace(/[?&]offset=\d+/gi, '').replace(/\?&/, '?').replace(/&&/g, '&');
  const all: any[] = [];
  let offset = 0;
  while (true) {
    const sep = stripped.includes('?') ? '&' : '?';
    const url = `${stripped}${sep}limit=${CHILD_LIMIT}&offset=${offset}`;
    const r = await fetch(url, { headers: HEADERS });
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);
    const d = await r.json();
    const items: any[] = Array.isArray(d) ? d : (d.items ?? []);
    all.push(...items);
    if (!d.hasMore || items.length < CHILD_LIMIT) break;
    offset += CHILD_LIMIT;
  }
  return all;
};

const statusTag = (s?: string) => {
  if (!s) return <Tag>—</Tag>;
  const up = s.toUpperCase();
  const color = up.includes('CLOSE') ? 'default' : up.includes('OPEN') ? 'blue'
    : up.includes('PROCESS') || up.includes('INTERFACE') ? 'purple'
    : up.includes('CANCEL') ? 'red' : up.includes('SHIP') ? 'green' : 'geekblue';
  return <Tag color={color} style={{ fontSize: 11 }}>{s}</Tag>;
};

interface Org { code: string; name: string }

// ── Shared: inventory-organization dropdown source ───────────────────────────
const useOrgs = () => {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const url = `${FUSION_BASE}/inventoryOrganizations?onlyData=true&limit=500`;
  const load = useCallback(() => {
    setLoading(true); setError('');
    fetch(url, { headers: HEADERS })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status} ${r.statusText}`)))
      .then(d => {
        const items: any[] = Array.isArray(d) ? d : (d.items ?? []);
        const seen = new Set<string>();
        const list = items
          .map(o => ({ code: o.OrganizationCode, name: o.OrganizationName }))
          .filter(o => o.code && !seen.has(o.code) && seen.add(o.code))
          .sort((a, b) => String(a.code).localeCompare(String(b.code)));
        setOrgs(list);
        if (list.length === 0) setError('inventoryOrganizations returned no rows.');
      })
      .catch(e => setError(e?.message || 'Failed to load organizations'))
      .finally(() => setLoading(false));
  }, [url]);
  useEffect(() => { load(); }, [load]);
  return { orgs, loading, error, load, url };
};

const orgOptions = (orgs: Org[]) => orgs.map(o => ({
  value: o.code, label: `${o.code} — ${o.name ?? ''}`,
}));

// ═══════════════════════════════════════════════════════════════════════════
//  SEARCH TAB
// ═══════════════════════════════════════════════════════════════════════════
const SearchTab: React.FC<{ orgsLoading: boolean; orgsUrl: string; reloadOrgs: () => void; onEdit: (headerId: number, headerNumber: string) => void; onCopyToNew: (seed: NewSeed) => void }> =
  ({ orgsLoading, orgsUrl, reloadOrgs, onEdit, onCopyToNew }) => {
  const [form] = Form.useForm();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');
  const [apiOpen, setApiOpen] = useState(false);
  const [lineCache, setLineCache] = useState<Record<number, any[]>>({});
  const [lineLoading, setLineLoading] = useState<Record<number, boolean>>({});
  const [lineCounts, setLineCounts] = useState<Record<number, number>>({});
  const [countsLoading, setCountsLoading] = useState(false);
  const [pg, setPg] = useState({ current: 1, pageSize: 25 });
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);
  const [busy, setBusy] = useState(false);

  const getLines = useCallback(async (headerId: number) =>
    lineCache[headerId] ?? await fetchAllPages(`${FUSION_BASE}/transferOrders/${headerId}/child/transferOrderLines`),
  [lineCache]);

  // Print the selected transfer order(s) — header + lines in a print window.
  const printSelected = async () => {
    const chosen = rows.filter(r => selectedKeys.includes(r.HeaderId));
    if (chosen.length === 0) return;
    const win = window.open('', '_blank', 'width=1000,height=820');
    if (!win) { message.error('Allow popups to print'); return; }
    win.document.write('<html><head><title>Transfer Orders</title></head><body style="font-family:Segoe UI,Arial,sans-serif;padding:40px">Preparing…</body></html>');
    setBusy(true);
    try {
      const sections: string[] = [];
      for (const o of chosen) {
        const lines = await getLines(o.HeaderId);
        const ccy = lines.find((l: any) => l.CurrencyCode)?.CurrencyCode ?? '';
        const total = lines.reduce((s: number, l: any) => s + (Number(l.TotalTransferPrice) || 0), 0);
        const rowsHtml = lines.map((l: any, i: number) => `
          <tr style="background:${i % 2 ? '#f7f7f7' : '#fff'}">
            <td>${l.DisplayLineNumber ?? l.LineNumber ?? ''}</td>
            <td><b>${l.ItemNumber ?? ''}</b></td>
            <td>${l.ItemDescription ?? ''}</td>
            <td>${l.SourceOrganizationCode ?? ''}${l.SourceSubinventoryCode ? ' / ' + l.SourceSubinventoryCode : ''}</td>
            <td>${l.DestinationOrganizationCode ?? ''}${l.DestinationSubinventoryCode ? ' / ' + l.DestinationSubinventoryCode : ''}</td>
            <td style="text-align:center">${l.QuantityUOMCode ?? ''}</td>
            <td style="text-align:right">${fmtQty(l.RequestedQuantity)}</td>
            <td style="text-align:right">${fmtQty(l.ShippedQuantity)}</td>
            <td style="text-align:right">${fmtQty(l.ReceivedQuantity)}</td>
            <td style="text-align:right">${fmtPrice(l.UnitPrice)}</td>
            <td style="text-align:right;color:#C74634;font-weight:700">${fmtPrice(l.TotalTransferPrice)}</td>
          </tr>`).join('');
        sections.push(`
          <div style="margin-bottom:34px">
            <div style="display:flex;justify-content:space-between;border-bottom:3px solid #C74634;padding-bottom:10px;margin-bottom:12px">
              <div><div style="font-size:10px;font-weight:700;color:#6b6b6b;text-transform:uppercase">Transfer Order</div>
                <div style="font-size:22px;font-weight:800">${o.HeaderNumber ?? ''}</div>
                <div style="font-size:12px;color:#6b6b6b">${o.BusinessUnitName ?? ''}</div></div>
              <div style="text-align:right;font-size:12px">
                <div><b>Status:</b> ${o.Status ?? ''}</div>
                <div><b>Interface:</b> ${o.InterfaceStatus ?? ''}</div>
                <div><b>Ordered:</b> ${o.OrderedDate ? new Date(o.OrderedDate).toLocaleDateString() : ''}</div>
                <div><b>Source:</b> ${o.SourceOfTransferOrder ?? ''}</div>
              </div>
            </div>
            <table style="width:100%;border-collapse:collapse;font-size:11px">
              <thead><tr style="background:#f0f0f0">
                <th style="text-align:left;padding:5px;border:1px solid #e5e5e5">Line</th>
                <th style="text-align:left;padding:5px;border:1px solid #e5e5e5">Item</th>
                <th style="text-align:left;padding:5px;border:1px solid #e5e5e5">Description</th>
                <th style="text-align:left;padding:5px;border:1px solid #e5e5e5">Source</th>
                <th style="text-align:left;padding:5px;border:1px solid #e5e5e5">Destination</th>
                <th style="padding:5px;border:1px solid #e5e5e5">UOM</th>
                <th style="text-align:right;padding:5px;border:1px solid #e5e5e5">Requested</th>
                <th style="text-align:right;padding:5px;border:1px solid #e5e5e5">Shipped</th>
                <th style="text-align:right;padding:5px;border:1px solid #e5e5e5">Received</th>
                <th style="text-align:right;padding:5px;border:1px solid #e5e5e5">Unit Price</th>
                <th style="text-align:right;padding:5px;border:1px solid #e5e5e5">Total Price</th>
              </tr></thead>
              <tbody>${rowsHtml || '<tr><td colspan="11" style="text-align:center;padding:14px">No lines</td></tr>'}
                <tr style="background:#f0f0f0;font-weight:700"><td colspan="10" style="text-align:right;padding:6px;border:1px solid #e5e5e5">Total Transfer Price</td>
                  <td style="text-align:right;padding:6px;border:1px solid #e5e5e5;color:#C74634">${fmtPrice(total, ccy)}</td></tr>
              </tbody>
            </table>
          </div>`);
      }
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Transfer Order${chosen.length > 1 ? 's' : ' ' + chosen[0].HeaderNumber}</title></head>
        <body style="font-family:Segoe UI,Arial,sans-serif;padding:32px;color:#1a1a1a">
          <div style="text-align:right;margin-bottom:16px">
            <button onclick="window.print()" style="padding:7px 18px;background:#C74634;color:#fff;border:none;border-radius:4px;font-weight:600;cursor:pointer">🖨 Print</button>
          </div>
          ${sections.join('')}
          <div style="margin-top:20px;font-size:10px;color:#6b6b6b;text-align:right">Generated ${new Date().toLocaleString()}</div>
        </body></html>`;
      win.document.open(); win.document.write(html); win.document.close();
    } catch (e: any) {
      win.document.body.innerHTML = `<p style="color:#c00">Failed to load lines: ${e.message}</p>`;
    } finally { setBusy(false); }
  };

  // Copy the single selected order into the New Transfer Order tab as a template.
  const copySelected = async () => {
    const chosen = rows.filter(r => selectedKeys.includes(r.HeaderId));
    if (chosen.length !== 1) { message.info('Select exactly one order to copy'); return; }
    setBusy(true);
    try {
      const o = chosen[0];
      const lines = await getLines(o.HeaderId);
      if (lines.length === 0) { message.warning('This order has no lines to copy'); return; }
      const first = lines[0];
      const orgs = new Set(lines.map((l: any) => `${l.SourceOrganizationCode}→${l.DestinationOrganizationCode}`));
      if (orgs.size > 1) message.warning('Lines use different source/destination orgs — using the first line\'s orgs as the header');
      onCopyToNew({
        nonce: Date.now(),
        srcOrg: first.SourceOrganizationCode,
        dstOrg: first.DestinationOrganizationCode,
        srcSub: first.SourceSubinventoryCode ?? undefined,
        dstSub: first.DestinationSubinventoryCode ?? undefined,
        needBy: first.NeedByDate ?? null,
        lines: lines.map((l: any) => ({ itemNumber: l.ItemNumber, quantity: Number(l.RequestedQuantity) || null, uom: l.QuantityUOMCode || 'Ea' })),
      });
      message.success(`Copied ${lines.length} line(s) from ${o.HeaderNumber} to New Transfer Order`);
    } catch (e: any) { message.error(e.message); }
    finally { setBusy(false); }
  };

  const [filters, setFilters] = useState<{ header?: string; bu?: string; status?: string; iface?: string; dateOp?: string; date?: Dayjs | null }>({
    dateOp: '>', date: dayjs().subtract(30, 'day'),
  });

  // NOTE: the transferOrders header has no org fields (source/destination org
  // live on the lines). Dates are filtered UNQUOTED, e.g. OrderedDate>2026-04-06.
  const buildQ = useCallback((f: typeof filters) => {
    const parts: string[] = [];
    if (f.header?.trim()) parts.push(`HeaderNumber="${f.header.trim()}"`);
    if (f.bu?.trim()) parts.push(`BusinessUnitName LIKE "${f.bu.trim()}*"`);
    if (f.status) parts.push(`Status="${f.status}"`);
    if (f.iface?.trim()) parts.push(`InterfaceStatus LIKE "${f.iface.trim()}*"`);
    if (f.date) parts.push(`OrderedDate${f.dateOp || '>'}${dayjs(f.date).format('YYYY-MM-DD')}`);
    return parts.join(';');
  }, []);

  const searchUrl = useMemo(() => {
    const q = buildQ(filters);
    const qs = q ? `q=${encodeURIComponent(q)}&` : '';
    return `${FUSION_BASE}/transferOrders?${qs}orderBy=OrderedDate:desc&onlyData=true&limit=200`;
  }, [filters, buildQ]);

  // Cheap per-order line count via totalResults (1 row + count).
  const fetchCounts = useCallback(async (items: any[]) => {
    if (items.length === 0) { setLineCounts({}); return; }
    setCountsLoading(true);
    const counts: Record<number, number> = {};
    await mapLimit(items, 6, async (o) => {
      const url = `${FUSION_BASE}/transferOrders/${o.HeaderId}/child/transferOrderLines?onlyData=true&limit=1&totalResults=true`;
      try {
        const r = await fetch(url, { headers: HEADERS });
        const d = await r.json();
        counts[o.HeaderId] = d.totalResults ?? (Array.isArray(d.items) ? d.items.length : 0);
      } catch { /* leave undefined */ }
    });
    setLineCounts(counts);
    setCountsLoading(false);
  }, []);

  const runSearch = useCallback(async () => {
    setLoading(true); setError(''); setSearched(true); setLineCache({}); setLineCounts({});
    setPg(p => ({ ...p, current: 1 })); setSelectedKeys([]);
    try {
      const items = await fetchAllPages(searchUrl.replace(/&?limit=\d+/, ''));
      setRows(items);
      if (items.length === 0) setError('No transfer orders matched.');
      else fetchCounts(items);
    } catch (e: any) {
      setError(e.message); setRows([]);
    } finally { setLoading(false); }
  }, [searchUrl, fetchCounts]);

  useEffect(() => { runSearch(); /* initial default search */ }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadLines = useCallback(async (rec: any) => {
    const id = rec.HeaderId;
    if (lineCache[id] || lineLoading[id]) return;
    setLineLoading(p => ({ ...p, [id]: true }));
    try {
      const link = rec.links?.find((l: any) => l.name === 'transferOrderLines')?.href;
      const base = link ?? `${FUSION_BASE}/transferOrders/${id}/child/transferOrderLines`;
      const items = await fetchAllPages(base);
      setLineCache(p => ({ ...p, [id]: items }));
    } catch (e: any) {
      setLineCache(p => ({ ...p, [id]: [] }));
      message.error(`Lines: ${e.message}`);
    } finally { setLineLoading(p => ({ ...p, [id]: false })); }
  }, [lineCache, lineLoading]);

  const columns: ColumnsType<any> = [
    { title: 'Ordered Date', dataIndex: 'OrderedDate', width: 130, fixed: 'left', render: fmtDate },
    { title: 'Order #', dataIndex: 'HeaderNumber', width: 100, fixed: 'left',
      render: (v, r) => <Button type="link" style={{ padding: 0, fontWeight: 700, color: REDWOOD.info, fontSize: 13 }}
        onClick={() => onEdit(r.HeaderId, String(v))}>{v ?? '—'}</Button> },
    { title: 'Business Unit', dataIndex: 'BusinessUnitName', width: 230, ellipsis: true,
      render: v => <Text style={{ fontSize: 12 }}>{v ?? '—'}</Text> },
    { title: 'Lines', key: 'lineCount', width: 70, align: 'center',
      render: (_, r) => {
        const n = lineCounts[r.HeaderId];
        if (n === undefined) return countsLoading ? <Spin size="small" /> : <Text type="secondary">—</Text>;
        return <Tag color={n > 1 ? 'orange' : 'default'} style={{ fontSize: 11, fontWeight: 600, borderRadius: 10, minWidth: 28 }}>{n}</Tag>;
      } },
    { title: 'Source', dataIndex: 'SourceOfTransferOrder', width: 190, ellipsis: true,
      render: (v, r) => <Tooltip title={v}><Tag color="purple" style={{ fontSize: 11 }}>{r.SourceTypeLookup ?? '—'}</Tag>
        <Text style={{ fontSize: 12 }}>{v ?? ''}</Text></Tooltip> },
    { title: 'Status', dataIndex: 'Status', width: 100, render: v => statusTag(v) },
    { title: 'Interface Status', dataIndex: 'InterfaceStatus', width: 170, render: v => statusTag(v) },
    { title: 'Total Transfer Price', dataIndex: 'TotalTransferPrice', width: 150, align: 'right',
      render: (v, r) => <Text strong style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12, color: REDWOOD.primary }}>
        {v == null ? '—' : new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v)) + (r.CurrencyCode ? ` ${r.CurrencyCode}` : '')}
      </Text> },
    { title: 'Created By', dataIndex: 'CreatedBy', width: 110, render: v => v ?? '—' },
    { title: 'Created', dataIndex: 'CreationDate', width: 120, render: fmtDate },
  ];

  const pick = (r: any, keys: string[]) => { for (const k of keys) { const v = r?.[k]; if (v != null && v !== '') return v; } return undefined; };
  const lineColumns: ColumnsType<any> = [
    { title: 'Line', dataIndex: 'LineNumber', width: 55, align: 'center', render: v => <Tag color="blue" style={{ fontSize: 11 }}>{v ?? '—'}</Tag> },
    { title: 'Item', width: 140, render: (_, r) => <Text strong style={{ fontSize: 12, color: REDWOOD.info }}>{pick(r, ['ItemNumber', 'Item']) ?? '—'}</Text> },
    { title: 'Description', width: 220, ellipsis: true, render: (_, r) => <Text style={{ fontSize: 12 }}>{pick(r, ['ItemDescription', 'Description']) ?? '—'}</Text> },
    { title: 'Source Org', width: 130, render: (_, r) => <Tag color="blue" style={{ fontSize: 11 }}>{pick(r, ['SourceOrganizationCode', 'SourceOrganization', 'ShipFromOrganizationCode']) ?? '—'}</Tag> },
    { title: 'Dest Org', width: 130, render: (_, r) => <Tag color="geekblue" style={{ fontSize: 11 }}>{pick(r, ['DestinationOrganizationCode', 'DestinationOrganization', 'ShipToOrganizationCode']) ?? '—'}</Tag> },
    { title: 'UOM', width: 70, align: 'center', render: (_, r) => <Tag style={{ fontSize: 11 }}>{pick(r, ['UOMCode', 'UOMName', 'UnitOfMeasure', 'UOM']) ?? '—'}</Tag> },
    { title: 'Requested Qty', width: 110, align: 'right', render: (_, r) => fmtQty(pick(r, ['Quantity', 'RequestedQuantity', 'OrderedQuantity'])) },
    { title: 'Shipped', width: 90, align: 'right', render: (_, r) => { const v = pick(r, ['ShippedQuantity', 'QuantityShipped']); return <Text style={{ color: (Number(v) || 0) > 0 ? REDWOOD.success : undefined }}>{fmtQty(v)}</Text>; } },
    { title: 'Received', width: 90, align: 'right', render: (_, r) => { const v = pick(r, ['ReceivedQuantity', 'QuantityReceived']); return <Text style={{ color: (Number(v) || 0) > 0 ? REDWOOD.success : undefined }}>{fmtQty(v)}</Text>; } },
    { title: 'Src Subinv', width: 110, render: (_, r) => pick(r, ['SourceSubinventoryCode', 'SourceSubinventory']) ?? '—' },
    { title: 'Dst Subinv', width: 110, render: (_, r) => pick(r, ['DestinationSubinventoryCode', 'DestinationSubinventory']) ?? '—' },
    { title: 'Requested Ship', width: 130, render: (_, r) => fmtDate(pick(r, ['RequestedShipDate', 'ScheduledShipDate'])) },
    { title: 'Requested Delivery', width: 140, render: (_, r) => fmtDate(pick(r, ['RequestedDeliveryDate', 'RequestedArrivalDate'])) },
    { title: 'Status', width: 120, render: (_, r) => statusTag(pick(r, ['Status', 'StatusCode'])) },
  ];

  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Card styles={{ body: { padding: '14px 18px' } }} style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}` }}>
        <Form form={form} layout="vertical">
          <Row gutter={[10, 0]}>
            <Col xs={24} sm={12} md={4}>
              <Form.Item label={<Text style={{ fontSize: 12, fontWeight: 600 }}>Order Number</Text>} style={{ marginBottom: 8 }}>
                <Input placeholder="Header number" allowClear value={filters.header}
                  onChange={e => setFilters(f => ({ ...f, header: e.target.value }))} onPressEnter={runSearch} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} md={6}>
              <Form.Item label={<Text style={{ fontSize: 12, fontWeight: 600 }}>Business Unit</Text>} style={{ marginBottom: 8 }}>
                <Input placeholder="Business unit name" allowClear value={filters.bu}
                  onChange={e => setFilters(f => ({ ...f, bu: e.target.value }))} onPressEnter={runSearch} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} md={4}>
              <Form.Item label={<Text style={{ fontSize: 12, fontWeight: 600 }}>Status</Text>} style={{ marginBottom: 8 }}>
                <Select allowClear placeholder="Any" value={filters.status}
                  onChange={v => setFilters(f => ({ ...f, status: v }))}
                  options={['Open', 'Closed', 'Canceled'].map(s => ({ value: s, label: s }))} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} md={4}>
              <Form.Item label={<Text style={{ fontSize: 12, fontWeight: 600 }}>Interface Status</Text>} style={{ marginBottom: 8 }}>
                <Input placeholder="e.g. Interfaced" allowClear value={filters.iface}
                  onChange={e => setFilters(f => ({ ...f, iface: e.target.value }))} onPressEnter={runSearch} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} md={6}>
              <Form.Item label={<Text style={{ fontSize: 12, fontWeight: 600 }}>Ordered Date</Text>} style={{ marginBottom: 8 }}>
                <Space.Compact style={{ width: '100%' }}>
                  <Select style={{ width: 72 }} value={filters.dateOp} onChange={v => setFilters(f => ({ ...f, dateOp: v }))}
                    options={['>', '>=', '=', '<=', '<'].map(o => ({ value: o, label: o }))} />
                  <DatePicker style={{ width: '100%' }} value={filters.date} onChange={d => setFilters(f => ({ ...f, date: d }))} />
                </Space.Compact>
              </Form.Item>
            </Col>
          </Row>
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <Button type="primary" icon={<SearchOutlined />} loading={loading} onClick={runSearch}
              style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}>Search</Button>
            <Button icon={<ClearOutlined />} onClick={() => { setFilters({ dateOp: '>', date: dayjs().subtract(30, 'day') }); }}>Reset</Button>
            <Tooltip title="API Inspector — transferOrders web service">
              <Button icon={<ApiOutlined />} style={{ marginLeft: 'auto', borderColor: REDWOOD.info, color: REDWOOD.info }}
                onClick={() => setApiOpen(true)}>API</Button>
            </Tooltip>
          </div>
        </Form>
      </Card>

      <Card
        styles={{ body: { padding: 0 } }}
        style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}` }}
        title={<Space><SwapOutlined style={{ color: REDWOOD.primary }} /><Text strong>Transfer Orders</Text>
          {rows.length > 0 && <Tag>{rows.length} result{rows.length !== 1 ? 's' : ''}</Tag>}
          {selectedKeys.length > 0 && <Tag color="blue">{selectedKeys.length} selected</Tag>}</Space>}
        extra={<Space>
          <Tooltip title={selectedKeys.length === 0 ? 'Select one or more orders' : 'Print selected transfer order(s)'}>
            <Button size="small" icon={<PrinterOutlined />} loading={busy} disabled={selectedKeys.length === 0} onClick={printSelected}
              style={selectedKeys.length ? { borderColor: REDWOOD.teal, color: REDWOOD.teal } : undefined}>Print</Button>
          </Tooltip>
          <Tooltip title={selectedKeys.length === 1 ? 'Copy this order into New Transfer Order' : 'Select exactly one order to copy'}>
            <Button size="small" icon={<CopyOutlined />} loading={busy} disabled={selectedKeys.length !== 1} onClick={copySelected}
              style={selectedKeys.length === 1 ? { borderColor: REDWOOD.primary, color: REDWOOD.primary } : undefined}>Copy to New</Button>
          </Tooltip>
          <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={runSearch}>Refresh</Button>
        </Space>}
      >
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Spin size="large" tip="Loading…" /></div>
        ) : error && rows.length === 0 ? (
          <div style={{ padding: 24, color: REDWOOD.error, background: REDWOOD.error + '10', margin: 16, borderRadius: 6 }}>
            <InfoCircleOutlined style={{ marginRight: 8 }} />{error}
          </div>
        ) : !searched ? (
          <Empty description="Run a search" style={{ padding: 60 }} />
        ) : rows.length === 0 ? (
          <Empty description="No transfer orders" style={{ padding: 60 }} />
        ) : (
          <Table
            columns={columns}
            dataSource={rows}
            rowKey="HeaderId"
            size="small"
            scroll={{ x: 1420 }}
            rowSelection={{ selectedRowKeys: selectedKeys, onChange: setSelectedKeys, columnWidth: 44 }}
            pagination={{
              current: pg.current, pageSize: pg.pageSize, total: rows.length,
              size: 'small', showSizeChanger: true, showTotal: t => `${t} orders`,
              onChange: (current, pageSize) => setPg({ current, pageSize }),
            }}
            expandable={{
              onExpand: (expanded, rec) => { if (expanded) loadLines(rec); },
              expandedRowRender: (rec) => {
                const id = rec.HeaderId;
                return lineLoading[id] ? <Spin style={{ margin: 16 }} /> : (
                  <Table
                    columns={lineColumns}
                    dataSource={lineCache[id] ?? []}
                    rowKey={(l, i) => `${l.LineNumber ?? i}`}
                    size="small"
                    pagination={false}
                    scroll={{ x: 1300 }}
                    locale={{ emptyText: 'No lines' }}
                  />
                );
              },
            }}
          />
        )}
      </Card>

      <Modal title={<Space><ApiOutlined style={{ color: REDWOOD.info }} /> Transfer Orders API</Space>}
        open={apiOpen} onCancel={() => setApiOpen(false)} footer={null} width={860}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {[
            { lbl: 'Search Transfer Orders', method: 'GET', url: searchUrl },
            { lbl: 'Transfer Order Lines', method: 'GET', url: `${FUSION_BASE}/transferOrders/{HeaderId}/child/transferOrderLines` },
            { lbl: 'Organizations dropdown', method: 'GET', url: orgsUrl },
          ].map(({ lbl, method, url }) => (
            <div key={lbl}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Text style={{ fontSize: 11, fontWeight: 700, color: REDWOOD.neutral600, textTransform: 'uppercase' }}>{lbl}</Text>
                <Button size="small" type="text" icon={<CopyOutlined />} style={{ marginLeft: 'auto' }}
                  onClick={() => { navigator.clipboard.writeText(url); message.success('Copied'); }}>Copy</Button>
              </div>
              <div style={{ marginTop: 4, padding: '8px 12px', borderRadius: 6, background: REDWOOD.neutral100, border: `1px solid ${REDWOOD.neutral200}`, fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all', color: REDWOOD.info }}>
                <Tag color="blue">{method}</Tag>{url}
              </div>
            </div>
          ))}
          <Button size="small" icon={<ReloadOutlined />} loading={orgsLoading} onClick={reloadOrgs} style={{ alignSelf: 'flex-start' }}>Reload orgs</Button>
          <Text type="secondary" style={{ fontSize: 11 }}>Auth: Basic [{getFusionInstance().username}] · Accept: application/json</Text>
        </div>
      </Modal>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
//  NEW TRANSFER ORDER TAB
// ═══════════════════════════════════════════════════════════════════════════
interface NewLine { key: number; itemNumber: string; quantity: number | null; uom: string; }
interface NewSeed { nonce: number; srcOrg?: string; dstOrg?: string; srcSub?: string; dstSub?: string; needBy?: string | null; ifaceCode?: string; lines?: { itemNumber: string; quantity: number | null; uom: string }[]; }

const NewOrderTab: React.FC<{ orgs: Org[]; orgsLoading: boolean; seed?: NewSeed | null }> = ({ orgs, orgsLoading, seed }) => {
  const [srcOrg, setSrcOrg]   = useState<string>();
  const [dstOrg, setDstOrg]   = useState<string>();
  const [srcSub, setSrcSub]   = useState<string>();
  const [dstSub, setDstSub]   = useState<string>();
  const [needBy, setNeedBy]   = useState<Dayjs | null>(dayjs().add(3, 'day'));
  const [ifaceCode, setIfaceCode] = useState('EXT');
  const [reqStatus, setReqStatus] = useState('NEW');
  const [orderSource, setOrderSource] = useState('EXT');
  const [email, setEmail] = useState('thiyagarajan@mitsumidistribution.com');
  const [lines, setLines]     = useState<NewLine[]>([{ key: 1, itemNumber: '', quantity: null, uom: 'Ea' }]);
  const seqRef = React.useRef(1);
  const sampleBatchRef = React.useRef(`RE${Date.now()}`);
  const sampleRefIdRef = React.useRef(Number(String(Date.now()).slice(-9)));

  const [srcSubs, setSrcSubs] = useState<string[]>([]);
  const [dstSubs, setDstSubs] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult]   = useState<{ ok: boolean; status: number; body: string } | null>(null);
  const [payloadOpen, setPayloadOpen] = useState(false);

  // Per-line item info: description + on-hand qty in source & destination orgs.
  const [info, setInfo] = useState<Record<number, { desc?: string; srcQoh?: number | null; dstQoh?: number | null; srcErr?: string; dstErr?: string; loading?: boolean }>>({});
  // Combined on-hand matrix modal (source + destination, all lines) + item-cost modal.
  const [ohOpen, setOhOpen] = useState(false);
  const [ohLoading, setOhLoading] = useState(false);
  const [ohRows, setOhRows] = useState<any[]>([]);
  const [costItem, setCostItem] = useState<string | null>(null);
  const [costData, setCostData] = useState<{ src: any[]; dst: any[] }>({ src: [], dst: [] });
  const [costLoading, setCostLoading] = useState(false);
  const [costDetailCache, setCostDetailCache] = useState<Record<string, any[]>>({});
  const [costDetailLoading, setCostDetailLoading] = useState<Record<string, boolean>>({});

  // Item search/picker (scoped to the source org) → fills a line.
  const [pickerLine, setPickerLine] = useState<number | null>(null);
  const [pickerField, setPickerField] = useState<'ItemNumber' | 'ItemDescription'>('ItemNumber');
  const [pickerText, setPickerText] = useState('');
  const [pickerRows, setPickerRows] = useState<any[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerErr, setPickerErr] = useState('');
  const [pickerUrls, setPickerUrls] = useState<string[]>([]);

  const COST_FIELDS = ['TotalUnitCost', 'UnitCost', 'ItemCost', 'UnitAverageCost', 'AverageUnitCost'];
  const pickCost = (r: any) => { for (const k of COST_FIELDS) { const v = r?.[k]; if (v != null && v !== '') return Number(v); } return null; };
  const onhandUrl = (org: string, item: string) => `${FUSION_BASE}/inventoryOnhandBalances?q=${encodeURIComponent(`OrganizationCode=${org};ItemNumber=${item}`)}&onlyData=true&limit=500`;
  const itemCostUrl = (item: string) => `${LATEST_URL}/itemCosts?q=${encodeURIComponent(`ItemNumber=${item}`)}&limit=500`;
  const itemDescUrl = (item: string) => `${FUSION_BASE}/itemsV2?q=ItemNumber='${encodeURIComponent(item)}'&limit=1&onlyData=true`;

  // Sum PrimaryQuantity for an item in one org. Throws on HTTP error so the
  // caller can distinguish "0 on hand" (returns 0) from "lookup failed".
  const fetchQoh = async (org: string, item: string): Promise<number> => {
    const r = await fetch(onhandUrl(org, item), { headers: HEADERS });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    const items: any[] = Array.isArray(d.items) ? d.items : [];
    return items.reduce((s, x) => s + (Number(x.PrimaryQuantity) || 0), 0);
  };

  // Fetch description + source/destination on-hand for one line. A failed
  // on-hand call keeps the previous value (so a transient error can't wipe a
  // good number) and records the error for a tooltip.
  const loadLineInfo = useCallback(async (key: number, item: string) => {
    const it = item.trim();
    if (!it) { setInfo(p => ({ ...p, [key]: {} })); return; }
    setInfo(p => ({ ...p, [key]: { ...p[key], loading: true } }));
    const [descR, srcR, dstR] = await Promise.allSettled([
      fetch(itemDescUrl(it), { headers: HEADERS }).then(r => r.json()),
      srcOrg ? fetchQoh(srcOrg, it) : Promise.resolve(null),
      dstOrg ? fetchQoh(dstOrg, it) : Promise.resolve(null),
    ]);
    const desc = descR.status === 'fulfilled' ? descR.value?.items?.[0]?.ItemDescription : undefined;
    setInfo(p => {
      const prev = p[key] ?? {};
      return { ...p, [key]: {
        desc: desc ?? prev.desc,
        srcQoh: srcR.status === 'fulfilled' ? srcR.value : (prev.srcQoh ?? null),
        dstQoh: dstR.status === 'fulfilled' ? dstR.value : (prev.dstQoh ?? null),
        srcErr: srcR.status === 'rejected' ? String((srcR as any).reason?.message ?? 'failed') : undefined,
        dstErr: dstR.status === 'rejected' ? String((dstR as any).reason?.message ?? 'failed') : undefined,
        loading: false,
      } };
    });
  }, [srcOrg, dstOrg]);

  // Re-pull on-hand for all lines when either org changes.
  useEffect(() => {
    lines.forEach(l => { if (l.itemNumber.trim()) loadLineInfo(l.key, l.itemNumber); });
  }, [srcOrg, dstOrg]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchOnhandRows = async (org: string, item: string): Promise<any[]> => {
    const r = await fetch(onhandUrl(org, item), { headers: HEADERS });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    return Array.isArray(d.items) ? d.items : [];
  };

  // Open the combined on-hand matrix — every line item × {source, destination}.
  const openMatrix = async () => {
    const items = Array.from(new Set(lines.map(l => l.itemNumber.trim()).filter(Boolean)));
    if (items.length === 0) { message.info('Enter at least one item first'); return; }
    setOhOpen(true); setOhLoading(true); setOhRows([]);
    const data = await mapLimit(items, 6, async (it) => {
      const [s, d] = await Promise.allSettled([
        srcOrg ? fetchOnhandRows(srcOrg, it) : Promise.resolve([]),
        dstOrg ? fetchOnhandRows(dstOrg, it) : Promise.resolve([]),
      ]);
      const srcRows = s.status === 'fulfilled' ? s.value : [];
      const dstRows = d.status === 'fulfilled' ? d.value : [];
      const sum = (rows: any[]) => rows.reduce((a, x) => a + (Number(x.PrimaryQuantity) || 0), 0);
      return {
        item: it,
        desc: srcRows[0]?.ItemDescription ?? dstRows[0]?.ItemDescription ?? '',
        srcRows, dstRows,
        srcTotal: srcRows.length ? sum(srcRows) : null,
        dstTotal: dstRows.length ? sum(dstRows) : null,
        srcErr: s.status === 'rejected' ? String((s as any).reason?.message ?? 'failed') : undefined,
        dstErr: d.status === 'rejected' ? String((d as any).reason?.message ?? 'failed') : undefined,
      };
    });
    setOhRows(data); setOhLoading(false);
  };

  const openCost = async (item: string) => {
    const it = item.trim();
    if (!it) return;
    setCostItem(it); setCostData({ src: [], dst: [] }); setCostLoading(true);
    setCostDetailCache({}); setCostDetailLoading({});
    try {
      // itemCosts isn't filterable by inventory org (org lives in ValuationUnit),
      // so pull all cost rows for the item and split by org on the client.
      const r = await fetch(itemCostUrl(it), { headers: HEADERS });
      const d = await r.json();
      const rows: any[] = Array.isArray(d.items) ? d.items : [];
      setCostData({
        src: rows.filter(x => rowOrgMatches(x, srcOrg)),
        dst: rows.filter(x => rowOrgMatches(x, dstOrg)),
      });
    } catch { setCostData({ src: [], dst: [] }); }
    finally { setCostLoading(false); }
  };

  // Resolve a cost row's costDetails child URL from its links (or self href).
  const costDetailsHref = (row: any): string | null => {
    const child = row?.links?.find((l: any) => l.name === 'costDetails')?.href;
    if (child) return child;
    const self = row?.links?.find((l: any) => l.rel === 'self' || l.name === 'itemCosts')?.href;
    return self ? `${self}/child/costDetails` : null;
  };
  const loadCostDetail = async (url: string | null) => {
    if (!url || costDetailCache[url] || costDetailLoading[url]) return;
    setCostDetailLoading(p => ({ ...p, [url]: true }));
    try {
      const r = await fetch(url, { headers: HEADERS });
      const d = await r.json();
      setCostDetailCache(p => ({ ...p, [url]: Array.isArray(d.items) ? d.items : [] }));
    } catch { setCostDetailCache(p => ({ ...p, [url]: [] })); }
    finally { setCostDetailLoading(p => ({ ...p, [url]: false })); }
  };

  const openPicker = (lineKey: number, seedText = '') => {
    if (!srcOrg) { message.info('Select a source organization first'); return; }
    setPickerLine(lineKey); setPickerText(seedText); setPickerRows([]); setPickerErr('');
  };

  // Build an itemsV2 search URL. Fusion here uses SQL LIKE with single quotes
  // and % wildcards (e.g. ItemNumber LIKE '167815%'). ItemNumber is a prefix
  // match; description is a contains match. `org` scopes to an inventory org.
  const itemSearchUrl = (field: 'ItemNumber' | 'ItemDescription', text: string, org?: string) => {
    const pattern = field === 'ItemNumber' ? `${text}%` : `%${text}%`;
    const q = (org ? `OrganizationCode=${org};` : '') + `${field} LIKE '${pattern}'`;
    return `${FUSION_BASE}/itemsV2?q=${encodeURIComponent(q)}&limit=100&onlyData=true`;
  };

  const runItemQueries = async (urls: string[]) => {
    const res = await Promise.allSettled(urls.map(u => fetch(u, { headers: HEADERS }).then(async r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })));
    const rows: any[] = []; const seen = new Set<string>();
    res.forEach(x => {
      if (x.status === 'fulfilled' && Array.isArray((x.value as any).items)) {
        (x.value as any).items.forEach((it: any) => { if (it.ItemNumber && !seen.has(it.ItemNumber)) { seen.add(it.ItemNumber); rows.push(it); } });
      }
    });
    const firstErr = res.find(x => x.status === 'rejected') as any;
    return { rows, anyOk: res.some(x => x.status === 'fulfilled'), err: firstErr?.reason?.message as string | undefined };
  };

  const searchItems = async () => {
    const t = pickerText.trim();
    if (!srcOrg) { message.info('Select a source organization first'); return; }
    if (!t) { message.info('Enter a code or description to search'); return; }
    setPickerLoading(true); setPickerErr(''); setPickerRows([]);

    // Search only the chosen field. 1) org-scoped; 2) fall back to item master.
    const orgUrls = [itemSearchUrl(pickerField, t, srcOrg)];
    const masterUrls = [itemSearchUrl(pickerField, t)];
    setPickerUrls(orgUrls);
    try {
      let { rows, anyOk, err } = await runItemQueries(orgUrls);
      let scope = srcOrg;
      if (rows.length === 0) {
        setPickerUrls([...orgUrls, ...masterUrls]);
        const master = await runItemQueries(masterUrls);
        rows = master.rows; anyOk = anyOk || master.anyOk; err = err ?? master.err; scope = 'item master';
      }
      setPickerRows(rows);
      if (rows.length === 0) setPickerErr(anyOk ? `No items matched "${t}" (searched ${srcOrg} then item master)` : `Search failed: ${err ?? 'error'}`);
      else if (scope === 'item master') message.info('No org-scoped match — showing item master results');
    } catch (e: any) { setPickerErr(e.message); }
    finally { setPickerLoading(false); }
  };

  const selectItem = (row: any) => {
    if (pickerLine == null) return;
    updLine(pickerLine, { itemNumber: row.ItemNumber });
    loadLineInfo(pickerLine, row.ItemNumber);
    setPickerLine(null);
  };

  const loadSubs = (org: string | undefined, set: (v: string[]) => void) => {
    if (!org) { set([]); return; }
    fetch(`${FUSION_BASE}/subinventories?q=OrganizationCode=${encodeURIComponent(org)}&onlyData=true&limit=500`, { headers: HEADERS })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(d => {
        const items: any[] = Array.isArray(d) ? d : (d.items ?? []);
        set(Array.from(new Set(items.map(i => i.SecondaryInventoryName).filter(Boolean))).sort());
      })
      .catch(() => set([]));
  };
  // Load subinventory lists when the org changes; the selected sub is cleared
  // by the Select's own onChange (user action), so a seeded value survives.
  useEffect(() => { loadSubs(srcOrg, setSrcSubs); }, [srcOrg]);
  useEffect(() => { loadSubs(dstOrg, setDstSubs); }, [dstOrg]);

  // Prefill from a "Copy" action on an existing transfer order.
  useEffect(() => {
    if (!seed) return;
    setSrcOrg(seed.srcOrg); setDstOrg(seed.dstOrg);
    setSrcSub(seed.srcSub); setDstSub(seed.dstSub);
    setNeedBy(seed.needBy ? dayjs(seed.needBy) : dayjs().add(3, 'day'));
    if (seed.ifaceCode) setIfaceCode(seed.ifaceCode);
    const ls = (seed.lines ?? []).map((l, i) => ({ key: i + 1, itemNumber: l.itemNumber, quantity: l.quantity, uom: l.uom || 'Ea' }));
    seqRef.current = Math.max(1, ls.length);
    setLines(ls.length ? ls : [{ key: 1, itemNumber: '', quantity: null, uom: 'Ea' }]);
    setInfo({});
    // Give the org effects a beat, then pull description + on-hand for each line.
    setTimeout(() => ls.forEach(l => { if (l.itemNumber.trim()) loadLineInfo(l.key, l.itemNumber); }), 0);
  }, [seed?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  const addLine = () => {
    seqRef.current += 1; const key = seqRef.current;
    setLines(l => [...l, { key, itemNumber: '', quantity: null, uom: 'Ea' }]);
    if (srcOrg) openPicker(key, '');   // open the item search for the new line
  };
  const delLine = (key: number) => setLines(l => l.filter(x => x.key !== key));
  const doClearLines = () => { seqRef.current = 1; setLines([{ key: 1, itemNumber: '', quantity: null, uom: 'Ea' }]); setInfo({}); };
  const clearLines = () => {
    const has = lines.some(l => l.itemNumber.trim() || (l.quantity ?? 0) > 0);
    if (!has) { doClearLines(); return; }
    Modal.confirm({
      title: 'Clear all item lines?',
      content: `This will remove ${lines.length} line${lines.length !== 1 ? 's' : ''} from this transfer order. This cannot be undone.`,
      okText: 'Clear', okButtonProps: { danger: true },
      onOk: doClearLines,
    });
  };
  const updLine = (key: number, patch: Partial<NewLine>) => setLines(l => l.map(x => x.key === key ? { ...x, ...patch } : x));

  const validLines = lines.filter(l => l.itemNumber.trim() && (l.quantity ?? 0) > 0);

  // Build the Supply Chain Orchestration (supplyRequests) payload, matching the
  // Oracle-documented transfer-order sample. The header status attribute is
  // SupplyRequestStatus ("NEW") — that is what satisfies the EO ProcessStatus
  // requirement; there is no separate "ProcessStatus" attribute. Lines carry
  // their own InterfaceSourceCode / SupplyOrderSource / BackToBackFlag and a
  // supply-order reference. NeedByDate is a full ISO timestamp.
  const buildPayload = (batchNo: string, refId: number) => ({
    InterfaceSourceCode: ifaceCode || 'EXT',
    InterfaceBatchNumber: batchNo,
    SupplyRequestStatus: reqStatus || 'NEW',
    SupplyRequestDate: dayjs().toISOString(),
    SupplyOrderSource: orderSource || 'EXT',
    SupplyOrderReferenceNumber: batchNo,
    SupplyOrderReferenceId: refId,
    ProcessRequestFlag: 'Y',
    supplyRequestLines: validLines.map((l, i) => ({
      InterfaceBatchNumber: batchNo,
      SupplyOrderReferenceLineNumber: `${batchNo}-${i + 1}`,
      SupplyOrderReferenceLineId: i + 1,
      SupplyType: 'TRANSFER',
      DestinationTypeCode: 'INVENTORY',
      SourceOrganizationCode: srcOrg,
      DestinationOrganizationCode: dstOrg,
      ...(srcSub ? { SourceSubinventoryCode: srcSub } : {}),
      ...(dstSub ? { DestinationSubinventoryCode: dstSub } : {}),
      ItemNumber: l.itemNumber.trim(),
      InterfaceSourceCode: ifaceCode || 'EXT',
      SupplyOrderSource: orderSource || 'EXT',
      BackToBackFlag: 'N',
      ...(email.trim() ? { PreparerEmail: email.trim(), DeliverToRequesterEmail: email.trim() } : {}),
      ...(needBy ? { NeedByDate: dayjs(needBy).toISOString() } : {}),
      Quantity: l.quantity,
      UOMCode: l.uom || 'Ea',
    })),
  });
  const payload = buildPayload(sampleBatchRef.current, sampleRefIdRef.current);   // for preview

  const postUrl = `${FUSION_BASE}/supplyRequests`;

  const validate = (): string | null => {
    if (!srcOrg) return 'Select a source organization';
    if (!dstOrg) return 'Select a destination organization';
    if (srcOrg === dstOrg) return 'Source and destination organizations must differ';
    if (validLines.length === 0) return 'Add at least one line with an item number and quantity';
    return null;
  };

  const submit = async () => {
    const err = validate();
    if (err) { message.error(err); return; }
    Modal.confirm({
      title: 'Create Transfer Order?',
      width: 560,
      content: (
        <div style={{ fontSize: 13 }}>
          Transfer <b>{validLines.length}</b> item line{validLines.length !== 1 ? 's' : ''} from{' '}
          <Tag color="blue">{srcOrg}</Tag> to <Tag color="geekblue">{dstOrg}</Tag> via Supply Chain Orchestration.
          <div style={{ marginTop: 8, color: REDWOOD.neutral600, fontSize: 12 }}>
            POST {postUrl}
          </div>
        </div>
      ),
      okText: 'Create',
      onOk: async () => {
        setSubmitting(true); setResult(null);
        try {
          const stamp = Date.now();
          const body = buildPayload(`RE${stamp}`, Number(String(stamp).slice(-9)));   // unique batch/ref per submission
          const r = await fetch(postUrl, {
            method: 'POST',
            headers: { ...HEADERS, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          const raw = await r.text();
          let pretty = raw; try { pretty = JSON.stringify(JSON.parse(raw), null, 2); } catch { /* keep raw */ }
          setResult({ ok: r.ok, status: r.status, body: pretty });
          if (r.ok) message.success('Supply request submitted — transfer order will be created by SCO');
          else message.error(`Create failed (HTTP ${r.status})`);
        } catch (e: any) {
          setResult({ ok: false, status: 0, body: `Network error: ${e.message}` });
          message.error(e.message);
        } finally { setSubmitting(false); }
      },
    });
  };

  const lineColumns: ColumnsType<NewLine> = [
    { title: '#', width: 40, align: 'center', render: (_, __, i) => <Text style={{ color: REDWOOD.neutral600 }}>{i + 1}</Text> },
    { title: <span>Item Number <span style={{ color: REDWOOD.error }}>*</span></span>, dataIndex: 'itemNumber', width: 190,
      render: (v, r) => <Input placeholder="e.g. AS54888" value={v}
        onChange={e => updLine(r.key, { itemNumber: e.target.value })}
        onBlur={() => loadLineInfo(r.key, r.itemNumber)}
        onPressEnter={() => loadLineInfo(r.key, r.itemNumber)}
        suffix={<Tooltip title="Search items in source org"><SearchOutlined style={{ cursor: 'pointer', color: REDWOOD.info }} onClick={() => openPicker(r.key, r.itemNumber)} /></Tooltip>} /> },
    { title: 'Description', width: 230, ellipsis: true,
      render: (_, r) => info[r.key]?.loading ? <Spin size="small" />
        : <Text style={{ fontSize: 12, color: info[r.key]?.desc ? REDWOOD.neutral900 : REDWOOD.neutral300 }}>{info[r.key]?.desc ?? '—'}</Text> },
    { title: <Tooltip title="On-hand in source org — click to drill to detail">Source QOH</Tooltip>, width: 110, align: 'right',
      render: (_, r) => {
        const i = info[r.key]; const q = i?.srcQoh;
        if (i?.loading) return <Spin size="small" />;
        if (!srcOrg || !r.itemNumber.trim()) return <Text type="secondary">—</Text>;
        if (i?.srcErr) return <Tooltip title={`On-hand lookup failed: ${i.srcErr}`}><Text type="danger" style={{ cursor: 'help' }}>err</Text></Tooltip>;
        if (q == null) return <Text type="secondary">—</Text>;
        return <a onClick={openMatrix}
          style={{ fontVariantNumeric: 'tabular-nums', color: q > 0 ? REDWOOD.success : REDWOOD.error, fontWeight: 600 }}>{fmtQty(q)}</a>;
      } },
    { title: <Tooltip title="On-hand in destination org — click to drill to detail">Dest QOH</Tooltip>, width: 110, align: 'right',
      render: (_, r) => {
        const i = info[r.key]; const q = i?.dstQoh;
        if (i?.loading) return <Spin size="small" />;
        if (!dstOrg || !r.itemNumber.trim()) return <Text type="secondary">—</Text>;
        if (i?.dstErr) return <Tooltip title={`On-hand lookup failed: ${i.dstErr}`}><Text type="danger" style={{ cursor: 'help' }}>err</Text></Tooltip>;
        if (q == null) return <Text type="secondary">—</Text>;
        return <a onClick={openMatrix}
          style={{ fontVariantNumeric: 'tabular-nums', color: q > 0 ? REDWOOD.success : REDWOOD.warning, fontWeight: 600 }}>{fmtQty(q)}</a>;
      } },
    { title: '', width: 34, align: 'center',
      render: (_, r) => r.itemNumber.trim()
        ? <Tooltip title="Reload description & on-hand"><Button size="small" type="text" icon={<ReloadOutlined />} onClick={() => loadLineInfo(r.key, r.itemNumber)} /></Tooltip>
        : null },
    { title: 'Cost', width: 70, align: 'center',
      render: (_, r) => r.itemNumber.trim()
        ? <Tooltip title="Item cost in source & destination orgs"><a onClick={() => openCost(r.itemNumber)}><DollarOutlined style={{ color: REDWOOD.primary }} /></a></Tooltip>
        : <Text type="secondary">—</Text> },
    { title: <span>Quantity <span style={{ color: REDWOOD.error }}>*</span></span>, dataIndex: 'quantity', width: 130,
      render: (v, r) => <InputNumber min={0} style={{ width: '100%' }} value={v ?? undefined} onChange={val => updLine(r.key, { quantity: val })} /> },
    { title: 'UOM', dataIndex: 'uom', width: 90,
      render: (v, r) => <Input value={v} onChange={e => updLine(r.key, { uom: e.target.value })} /> },
    { title: '', width: 46, align: 'center', fixed: 'right',
      render: (_, r) => <Tooltip title="Remove line"><Button size="small" type="text" danger icon={<DeleteOutlined />}
        onClick={() => delLine(r.key)} disabled={lines.length === 1} /></Tooltip> },
  ];

  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Card title={<Space><EnvironmentOutlined style={{ color: REDWOOD.primary }} /><Text strong>Transfer Details</Text></Space>}
        styles={{ body: { padding: '16px 20px' } }} style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}` }}>
        <Row gutter={[14, 4]}>
          <Col xs={24} md={7}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Source Organization <span style={{ color: REDWOOD.error }}>*</span></div>
            <Select showSearch placeholder="From organization" loading={orgsLoading} style={{ width: '100%' }}
              options={orgOptions(orgs)} optionFilterProp="label" value={srcOrg} onChange={v => { setSrcOrg(v); setSrcSub(undefined); }} />
          </Col>
          <Col xs={24} md={5}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Source Subinventory</div>
            <Select allowClear showSearch placeholder={srcOrg ? 'Optional' : 'Pick org first'} disabled={!srcOrg}
              style={{ width: '100%' }} value={srcSub} onChange={setSrcSub}
              options={srcSubs.map(s => ({ value: s, label: s }))}
              notFoundContent={srcSubs.length === 0 ? 'No subinventories' : undefined} />
          </Col>
          <Col xs={24} md={7}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Destination Organization <span style={{ color: REDWOOD.error }}>*</span></div>
            <Select showSearch placeholder="To organization" loading={orgsLoading} style={{ width: '100%' }}
              options={orgOptions(orgs)} optionFilterProp="label" value={dstOrg} onChange={v => { setDstOrg(v); setDstSub(undefined); }} />
          </Col>
          <Col xs={24} md={5}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Destination Subinventory</div>
            <Select allowClear showSearch placeholder={dstOrg ? 'Optional' : 'Pick org first'} disabled={!dstOrg}
              style={{ width: '100%' }} value={dstSub} onChange={setDstSub}
              options={dstSubs.map(s => ({ value: s, label: s }))}
              notFoundContent={dstSubs.length === 0 ? 'No subinventories' : undefined} />
          </Col>
          <Col xs={24} md={6} style={{ marginTop: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Need-By Date</div>
            <DatePicker style={{ width: '100%' }} value={needBy} onChange={setNeedBy} />
          </Col>
          <Col xs={12} md={6} style={{ marginTop: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Interface Source</div>
            <Input value={ifaceCode} onChange={e => setIfaceCode(e.target.value)} placeholder="EXT" />
          </Col>
          <Col xs={12} md={6} style={{ marginTop: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Supply Order Source</div>
            <Input value={orderSource} onChange={e => setOrderSource(e.target.value)} placeholder="EXT" />
          </Col>
          <Col xs={12} md={6} style={{ marginTop: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Supply Request Status</div>
            <Input value={reqStatus} onChange={e => setReqStatus(e.target.value)} placeholder="NEW" />
          </Col>
          <Col xs={24} md={12} style={{ marginTop: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Preparer / Requester Email</div>
            <Input value={email} onChange={e => setEmail(e.target.value)} placeholder="name@company.com" allowClear />
          </Col>
        </Row>
        <div style={{ marginTop: 10, fontSize: 11, color: REDWOOD.neutral600 }}>
          <InfoCircleOutlined style={{ marginRight: 6 }} />
          Sent to Supply Chain Orchestration (matching Oracle's transfer-order sample) with a unique <b>InterfaceBatchNumber</b> / supply-order reference, <b>SupplyRequestStatus=NEW</b>, <b>ProcessRequestFlag=Y</b> and today's <b>SupplyRequestDate</b>.
        </div>
        {srcOrg && dstOrg && srcOrg === dstOrg && (
          <div style={{ marginTop: 10, color: REDWOOD.error, fontSize: 12 }}>
            <InfoCircleOutlined style={{ marginRight: 6 }} />Source and destination organizations must be different.
          </div>
        )}
      </Card>

      <Card title={<Space><SwapOutlined style={{ color: REDWOOD.primary }} /><Text strong>Items to Transfer</Text>
        <Tag>{validLines.length} valid line{validLines.length !== 1 ? 's' : ''}</Tag></Space>}
        styles={{ body: { padding: 0 } }} style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}` }}
        extra={<Space>
          <Button size="small" icon={<EnvironmentOutlined />} onClick={openMatrix}>On-Hand Matrix</Button>
          <Button size="small" icon={<PlusOutlined />} onClick={addLine}>Add Line</Button>
          <Button size="small" icon={<ClearOutlined />} onClick={clearLines}>Clear</Button>
        </Space>}>
        <Table columns={lineColumns} dataSource={lines} rowKey="key" size="small" pagination={false} scroll={{ x: 1160 }} />
      </Card>

      <Card styles={{ body: { padding: '14px 18px' } }} style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}` }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Button icon={<EyeOutlined />} onClick={() => setPayloadOpen(true)}>Show Payload</Button>
          <Button type="primary" icon={<CloudUploadOutlined />} loading={submitting} onClick={submit}
            style={{ background: REDWOOD.success, borderColor: REDWOOD.success }}>Save Transfer Order in Fusion</Button>
          <Text type="secondary" style={{ fontSize: 12, marginLeft: 'auto', fontFamily: 'monospace' }}>
            <Tag color="green">POST</Tag>{postUrl}
          </Text>
        </div>
        {result && (
          <div style={{ marginTop: 14 }}>
            <Space style={{ marginBottom: 6 }}>
              <Tag color={result.ok ? 'success' : result.status === 0 ? 'default' : 'error'}>
                {result.status === 0 ? 'Network Error' : `HTTP ${result.status}`}
              </Tag>
              {result.ok && <Text style={{ color: REDWOOD.success, fontSize: 12 }}><CheckCircleOutlined /> Submitted to Supply Chain Orchestration</Text>}
              <Button size="small" type="text" icon={<CopyOutlined />}
                onClick={() => { navigator.clipboard.writeText(result.body); message.success('Copied'); }}>Copy</Button>
            </Space>
            <div style={{ background: '#1e1e1e', color: '#d4d4d4', padding: 12, borderRadius: 6, fontFamily: 'monospace', fontSize: 11, maxHeight: 300, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {result.body.slice(0, 6000)}{result.body.length > 6000 ? '\n\n… (truncated)' : ''}
            </div>
          </div>
        )}
      </Card>

      <Modal title={<Space><ApiOutlined style={{ color: REDWOOD.info }} /> Request Payload — supplyRequests</Space>}
        open={payloadOpen} onCancel={() => setPayloadOpen(false)} width={720}
        footer={<Button onClick={() => { navigator.clipboard.writeText(JSON.stringify(payload, null, 2)); message.success('Copied'); }} icon={<CopyOutlined />}>Copy JSON</Button>}>
        <div style={{ padding: '6px 10px', borderRadius: 6, background: REDWOOD.neutral100, border: `1px solid ${REDWOOD.neutral200}`, fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all', color: REDWOOD.info, marginBottom: 10 }}>
          <Tag color="green">POST</Tag>{postUrl}
        </div>
        <div style={{ background: '#1e1e1e', color: '#d4d4d4', padding: 12, borderRadius: 6, fontFamily: 'monospace', fontSize: 11, maxHeight: 420, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
          {JSON.stringify(payload, null, 2)}
        </div>
        <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 8 }}>
          <InfoCircleOutlined style={{ marginRight: 6 }} />
          Transfer orders are created asynchronously by Supply Chain Orchestration. After submitting, search the
          Search Orders tab (by source/destination org) to find the generated transfer order.
        </Text>
      </Modal>

      {/* ── On-hand matrix (source + destination, all lines) ───────────── */}
      <Modal
        title={<Space><EnvironmentOutlined style={{ color: REDWOOD.info }} /> On-Hand Matrix
          <Tag color="blue">{srcOrg ?? 'Source'}</Tag><SwapOutlined style={{ color: REDWOOD.neutral600 }} /><Tag color="geekblue">{dstOrg ?? 'Dest'}</Tag></Space>}
        open={ohOpen} onCancel={() => setOhOpen(false)} maskClosable={false} width={900}
        footer={<Button onClick={() => setOhOpen(false)}>Close</Button>}>
        {ohLoading ? <div style={{ textAlign: 'center', padding: 40 }}><Spin size="large" tip="Loading on-hand…" /></div>
          : ohRows.length === 0 ? <Empty description="No items" style={{ padding: 30 }} />
          : (
            <>
              <Table
                size="small" pagination={false} scroll={{ x: 640, y: 420 }} dataSource={ohRows} rowKey="item"
                expandable={{
                  rowExpandable: (r) => (r.srcRows.length + r.dstRows.length) > 0,
                  expandedRowRender: (r) => {
                    const detail = [
                      ...r.srcRows.map((x: any) => ({ ...x, _side: 'Source', _org: srcOrg })),
                      ...r.dstRows.map((x: any) => ({ ...x, _side: 'Dest', _org: dstOrg })),
                    ];
                    return detail.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No subinventory detail" />
                      : <Table size="small" pagination={false} dataSource={detail} rowKey={(_, i) => `d-${i}`}
                          columns={[
                            { title: '', dataIndex: '_side', width: 80, render: (v) => <Tag color={v === 'Source' ? 'blue' : 'geekblue'} style={{ fontSize: 11 }}>{v}</Tag> },
                            { title: 'Org', dataIndex: '_org', width: 70, render: v => <Tag>{v}</Tag> },
                            { title: 'Subinventory', dataIndex: 'SubinventoryCode', width: 140, render: v => v ?? '—' },
                            { title: 'Locator', dataIndex: 'LocatorName', width: 130, render: (v, x) => v ?? x.Locator ?? '—' },
                            { title: 'Lot', dataIndex: 'LotNumber', width: 120, render: v => v ?? '—' },
                            { title: 'UOM', dataIndex: 'UnitOfMeasure', width: 64, align: 'center', render: (v, x) => <Tag style={{ fontSize: 11 }}>{v ?? x.PrimaryUOMCode ?? '—'}</Tag> },
                            { title: 'Qty', dataIndex: 'PrimaryQuantity', width: 90, align: 'right', render: v => <Text strong style={{ color: REDWOOD.success }}>{fmtQty(v)}</Text> },
                          ]} />;
                  },
                }}
                columns={[
                  { title: 'Item', dataIndex: 'item', width: 130, render: v => <Text strong style={{ color: REDWOOD.info, fontSize: 12 }}>{v}</Text> },
                  { title: 'Description', dataIndex: 'desc', ellipsis: true, render: v => <Text style={{ fontSize: 12 }}>{v || '—'}</Text> },
                  { title: <Tooltip title={`On-hand in source org ${srcOrg ?? ''}`}><span>Source QOH</span></Tooltip>, width: 120, align: 'right',
                    render: (_, r) => r.srcErr ? <Tooltip title={r.srcErr}><Text type="danger">err</Text></Tooltip>
                      : r.srcTotal == null ? <Text type="secondary">—</Text>
                      : <Text strong style={{ fontVariantNumeric: 'tabular-nums', color: r.srcTotal > 0 ? REDWOOD.success : REDWOOD.error }}>{fmtQty(r.srcTotal)}</Text> },
                  { title: <Tooltip title={`On-hand in destination org ${dstOrg ?? ''}`}><span>Dest QOH</span></Tooltip>, width: 120, align: 'right',
                    render: (_, r) => r.dstErr ? <Tooltip title={r.dstErr}><Text type="danger">err</Text></Tooltip>
                      : r.dstTotal == null ? <Text type="secondary">—</Text>
                      : <Text strong style={{ fontVariantNumeric: 'tabular-nums', color: r.dstTotal > 0 ? REDWOOD.success : REDWOOD.warning }}>{fmtQty(r.dstTotal)}</Text> },
                ]}
              />
              <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 8 }}>
                <InfoCircleOutlined style={{ marginRight: 6 }} />Expand a row for subinventory / locator / lot detail. Source =
                <Text code>{srcOrg ?? '—'}</Text>, Destination = <Text code>{dstOrg ?? '—'}</Text> · GET inventoryOnhandBalances per item &amp; org.
              </Text>
            </>
          )}
      </Modal>

      {/* ── Item cost (source vs destination) ──────────────────────────── */}
      <Modal
        title={<Space><DollarOutlined style={{ color: REDWOOD.primary }} /> Item Cost — {costItem}</Space>}
        open={!!costItem} onCancel={() => setCostItem(null)} maskClosable={false} width={1160}
        style={{ top: 40 }}
        footer={<Button onClick={() => setCostItem(null)}>Close</Button>}>
        {costLoading ? <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div> : (
          <Row gutter={[14, 14]}>
            {[
              { label: 'Source', org: srcOrg, rows: costData.src, color: REDWOOD.info },
              { label: 'Destination', org: dstOrg, rows: costData.dst, color: REDWOOD.teal },
            ].map(({ label, org, rows, color }) => {
              const c = rows.length ? pickCost(rows[0]) : null;
              const ccy = rows.find(r => r.CurrencyCode)?.CurrencyCode ?? '';
              return (
                <Col xs={24} md={12} key={label}>
                  <Card size="small" style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}` }}
                    title={<Space><Tag color={label === 'Source' ? 'blue' : 'cyan'}>{label}</Tag><Text strong>{org ?? '—'}</Text></Space>}>
                    <div style={{ fontSize: 26, fontWeight: 800, color, fontVariantNumeric: 'tabular-nums' }}>
                      {c == null ? '—' : fmtPrice(c, ccy)}
                    </div>
                    <div style={{ fontSize: 11, color: REDWOOD.neutral600, marginBottom: 8 }}>Unit cost{rows.length > 1 ? ` · ${rows.length} rows` : ''}</div>
                    {rows.length > 0 && (
                      <Table size="small" pagination={false} dataSource={rows} rowKey={(r, i) => costDetailsHref(r) ?? r.ValuationUnit ?? `c-${i}`} scroll={{ y: 260 }} tableLayout="fixed"
                        expandable={{
                          rowExpandable: (r) => !!costDetailsHref(r),
                          onExpand: (exp, r) => { if (exp) loadCostDetail(costDetailsHref(r)); },
                          expandedRowRender: (r) => {
                            const url = costDetailsHref(r); const det = url ? costDetailCache[url] : undefined;
                            if (url && costDetailLoading[url]) return <Spin size="small" style={{ margin: 8 }} />;
                            if (!det || det.length === 0) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No cost breakdown" style={{ margin: 6 }} />;
                            const tot = det.reduce((s: number, x: any) => s + (Number(x.UnitCostAverage) || 0), 0);
                            return (
                              <Table size="small" pagination={false} dataSource={det} rowKey={(_, i) => `cd-${i}`}
                                columns={[
                                  { title: 'Cost Element', dataIndex: 'CostElement', ellipsis: true, render: v => <Text style={{ fontSize: 11, fontWeight: 600 }}>{v ?? '—'}</Text> },
                                  { title: 'Type', dataIndex: 'CostElementType', width: 100, render: v => <Tag style={{ fontSize: 10 }}>{v ?? '—'}</Tag> },
                                  { title: 'Unit Cost', dataIndex: 'UnitCostAverage', width: 130, align: 'right', render: (v, x) => <Text style={{ fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>{fmtPrice(v, x.CurrencyCode)}</Text> },
                                  { title: '%', dataIndex: 'CostPercent', width: 70, align: 'right', render: v => <Text style={{ fontSize: 11 }}>{v == null ? '—' : `${Number(v).toFixed(1)}%`}</Text> },
                                ]}
                                summary={() => (
                                  <Table.Summary.Row style={{ background: REDWOOD.neutral100 }}>
                                    <Table.Summary.Cell index={0} colSpan={2} align="right"><Text strong style={{ fontSize: 11 }}>Total</Text></Table.Summary.Cell>
                                    <Table.Summary.Cell index={1} align="right"><Text strong style={{ fontSize: 11, color: REDWOOD.primary }}>{fmtPrice(tot, det[0]?.CurrencyCode)}</Text></Table.Summary.Cell>
                                    <Table.Summary.Cell index={2} />
                                  </Table.Summary.Row>
                                )} />
                            );
                          },
                        }}
                        columns={[
                          { title: 'Cost Org', width: 120, ellipsis: true, render: (_, r) => { const p = parseVU(r.ValuationUnit); return <Text strong style={{ fontSize: 11 }}>{p.costOrg || '—'}</Text>; } },
                          { title: 'Inv Org', width: 100, ellipsis: true, render: (_, r) => { const p = parseVU(r.ValuationUnit); return <Text style={{ fontSize: 11 }}>{p.invOrg || '—'}</Text>; } },
                          { title: 'Subinv', width: 95, ellipsis: true, render: (_, r) => { const p = parseVU(r.ValuationUnit); return p.subinv ? <Tag color="cyan" style={{ fontSize: 10 }}>{p.subinv}</Tag> : '—'; } },
                          { title: 'Lot', ellipsis: true, render: (_, r) => { const p = parseVU(r.ValuationUnit); return p.lot ? <Tag color="geekblue" style={{ fontSize: 10 }}>{p.lot}</Tag> : '—'; } },
                          { title: 'Unit Cost', width: 130, align: 'right', render: (_, r) => <Text strong style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{fmtPrice(pickCost(r), r.CurrencyCode)}</Text> },
                        ]} />
                    )}
                  </Card>
                </Col>
              );
            })}
          </Row>
        )}
        <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 10 }}>
          <InfoCircleOutlined style={{ marginRight: 6 }} />GET {LATEST_URL}/itemCosts?q=ItemNumber=&lt;item&gt; — rows are matched to each org via the inventory org in <Text code>ValuationUnit</Text>. Expand a row for the cost-element breakdown (child <Text code>costDetails</Text>).
        </Text>
      </Modal>

      {/* ── Item search / picker (source org) ──────────────────────────── */}
      <Modal
        title={<Space><SearchOutlined style={{ color: REDWOOD.info }} /> Find Item in <Tag color="blue">{srcOrg ?? 'source org'}</Tag></Space>}
        open={pickerLine != null} onCancel={() => setPickerLine(null)} maskClosable={false} footer={null} width={820}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <Segmented
            value={pickerField}
            onChange={v => setPickerField(v as any)}
            options={[{ label: 'Item Number', value: 'ItemNumber' }, { label: 'Description', value: 'ItemDescription' }]}
          />
          <Space.Compact style={{ flex: 1, minWidth: 260 }}>
            <Input autoFocus placeholder={pickerField === 'ItemNumber' ? 'Item code starts with…' : 'Description contains…'}
              value={pickerText} onChange={e => setPickerText(e.target.value)} onPressEnter={searchItems} allowClear />
            <Button type="primary" icon={<SearchOutlined />} loading={pickerLoading} onClick={searchItems}
              style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}>Search</Button>
          </Space.Compact>
        </div>
        {pickerErr && <div style={{ color: REDWOOD.error, fontSize: 12, marginBottom: 8 }}><InfoCircleOutlined style={{ marginRight: 6 }} />{pickerErr}</div>}
        {pickerLoading ? <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
          : pickerRows.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Enter a code or description and search" style={{ padding: 30 }} />
          : (
            <Table size="small" dataSource={pickerRows} rowKey={(_, i) => `pk-${i}`}
              pagination={{ pageSize: 10, size: 'small' }} scroll={{ y: 320 }}
              onRow={(row) => ({ style: { cursor: 'pointer' }, onClick: () => selectItem(row) })}
              columns={[
                { title: 'Item', dataIndex: 'ItemNumber', width: 150, render: v => <Text strong style={{ color: REDWOOD.info, fontSize: 12 }}>{v}</Text> },
                { title: 'Description', dataIndex: 'ItemDescription', ellipsis: true, render: v => <Text style={{ fontSize: 12 }}>{v ?? '—'}</Text> },
                { title: 'UOM', dataIndex: 'PrimaryUOMValue', width: 80, align: 'center', render: (v, r) => <Tag style={{ fontSize: 11 }}>{v ?? r.PrimaryUOMCode ?? '—'}</Tag> },
                { title: '', width: 80, align: 'center', render: (_, row) => <Button size="small" type="link" onClick={(e) => { e.stopPropagation(); selectItem(row); }}>Select</Button> },
              ]} />
          )}
        <div style={{ marginTop: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <Text style={{ fontSize: 11, fontWeight: 700, color: REDWOOD.neutral600, textTransform: 'uppercase' }}>Requests run</Text>
            {pickerUrls.length > 0 && <Button size="small" type="text" icon={<CopyOutlined />}
              onClick={() => { navigator.clipboard.writeText(pickerUrls.join('\n')); message.success('Copied'); }}>Copy</Button>}
          </div>
          {pickerUrls.length === 0
            ? <Text type="secondary" style={{ fontSize: 11 }}>Run a search to see the exact itemsV2 URLs.</Text>
            : pickerUrls.map((u, i) => (
              <div key={i} style={{ padding: '6px 10px', borderRadius: 6, background: REDWOOD.neutral100, border: `1px solid ${REDWOOD.neutral200}`, fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all', color: REDWOOD.info, marginBottom: 6 }}>
                <Tag color="blue">GET</Tag>{decodeURIComponent(u)}
              </div>
            ))}
        </div>
      </Modal>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
//  SEARCH LINES TAB — date-driven orders GET, then fan out to each order's lines
// ═══════════════════════════════════════════════════════════════════════════
const SearchLinesTab: React.FC<{ onEdit: (headerId: number, headerNumber: string) => void }> = ({ onEdit }) => {
  const [dateOp, setDateOp] = useState('>');
  const [date, setDate]     = useState<Dayjs | null>(dayjs().subtract(30, 'day'));
  const [allLines, setAllLines] = useState<any[]>([]);
  const [loading, setLoading]   = useState(false);
  const [progress, setProgress] = useState('');
  const [searched, setSearched] = useState(false);
  const [error, setError]       = useState('');
  const [apiOpen, setApiOpen]   = useState(false);

  // client-side filters over the fetched lines
  const [fOrder, setFOrder]   = useState('');
  const [fItem, setFItem]     = useState('');
  const [fSrc, setFSrc]       = useState<string>();
  const [fDst, setFDst]       = useState<string>();
  const [fStatus, setFStatus] = useState<string>();
  const [fText, setFText]     = useState('');
  const [pg, setPg]           = useState({ current: 1, pageSize: 50 });

  const ordersUrl = useMemo(() => {
    const q = date ? `q=${encodeURIComponent(`OrderedDate${dateOp}${dayjs(date).format('YYYY-MM-DD')}`)}&` : '';
    return `${FUSION_BASE}/transferOrders?${q}orderBy=OrderedDate:desc&onlyData=true`;
  }, [date, dateOp]);

  const run = useCallback(async () => {
    setLoading(true); setError(''); setSearched(true); setAllLines([]); setProgress('Fetching transfer orders…');
    try {
      const headers = await fetchAllPages(ordersUrl);
      if (headers.length === 0) { setError('No transfer orders in this date range.'); setLoading(false); return; }
      setProgress(`Loading lines for ${headers.length} order${headers.length !== 1 ? 's' : ''}…`);
      let done = 0;
      const perOrder = await mapLimit(headers, 6, async (h) => {
        const link = h.links?.find((l: any) => l.name === 'transferOrderLines')?.href;
        const base = link ?? `${FUSION_BASE}/transferOrders/${h.HeaderId}/child/transferOrderLines`;
        try {
          const lines = await fetchAllPages(base);
          return lines.map(ln => ({
            ...ln,
            _headerId: h.HeaderId,
            _headerNumber: h.HeaderNumber,
            _orderedDate: h.OrderedDate,
            _headerStatus: h.Status,
          }));
        } catch { return []; }
        finally { done += 1; setProgress(`Loading lines… ${done}/${headers.length} orders`); }
      });
      const flat = perOrder.flat();
      setAllLines(flat);
      if (flat.length === 0) setError('Orders found but no lines returned.');
    } catch (e: any) {
      setError(e.message);
    } finally { setLoading(false); setProgress(''); }
  }, [ordersUrl]);

  useEffect(() => { run(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const srcOrgOpts = useMemo(() => Array.from(new Set(allLines.map(l => l.SourceOrganizationCode).filter(Boolean))).sort()
    .map(c => ({ value: c, label: c })), [allLines]);
  const dstOrgOpts = useMemo(() => Array.from(new Set(allLines.map(l => l.DestinationOrganizationCode).filter(Boolean))).sort()
    .map(c => ({ value: c, label: c })), [allLines]);
  const statusOpts = useMemo(() => Array.from(new Set(allLines.map(l => l.TransferOrderLineStatus).filter(Boolean))).sort()
    .map(c => ({ value: c, label: c })), [allLines]);

  const filtered = useMemo(() => {
    const t = fText.trim().toLowerCase();
    return allLines.filter(l =>
      (!fOrder.trim() || String(l._headerNumber ?? '').toLowerCase().includes(fOrder.trim().toLowerCase())) &&
      (!fItem.trim() || String(l.ItemNumber ?? '').toLowerCase().includes(fItem.trim().toLowerCase())) &&
      (!fSrc || l.SourceOrganizationCode === fSrc) &&
      (!fDst || l.DestinationOrganizationCode === fDst) &&
      (!fStatus || l.TransferOrderLineStatus === fStatus) &&
      (!t || JSON.stringify(l).toLowerCase().includes(t))
    );
  }, [allLines, fOrder, fItem, fSrc, fDst, fStatus, fText]);

  const totalPrice = filtered.reduce((s, l) => s + (Number(l.TotalTransferPrice) || 0), 0);
  const ccy = filtered.find(l => l.CurrencyCode)?.CurrencyCode ?? allLines.find(l => l.CurrencyCode)?.CurrencyCode ?? '';

  // How many lines each order contributes (over the full fetched set) — used to
  // flag multi-line orders in the grid.
  const orderLineCount = useMemo(() => {
    const m: Record<number, number> = {};
    allLines.forEach(l => { m[l._headerId] = (m[l._headerId] ?? 0) + 1; });
    return m;
  }, [allLines]);
  const multiOrders = useMemo(() => new Set(Object.entries(orderLineCount).filter(([, n]) => n > 1).map(([id]) => Number(id))), [orderLineCount]);

  // Reset to page 1 whenever the filter set changes (avoids landing on an empty page).
  useEffect(() => { setPg(p => ({ ...p, current: 1 })); }, [fOrder, fItem, fSrc, fDst, fStatus, fText]);

  const columns: ColumnsType<any> = [
    { title: 'Ordered', dataIndex: '_orderedDate', width: 115, fixed: 'left', render: fmtDate },
    { title: 'Order #', dataIndex: '_headerNumber', width: 128, fixed: 'left',
      render: (v, r) => {
        const n = orderLineCount[r._headerId] ?? 1;
        return (
          <div style={{ borderLeft: n > 1 ? `3px solid ${REDWOOD.warning}` : '3px solid transparent', paddingLeft: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
            <Button type="link" style={{ padding: 0, fontWeight: 700, color: REDWOOD.info, fontSize: 13 }}
              onClick={() => onEdit(r._headerId, String(v))}>{v ?? '—'}</Button>
            {n > 1 && <Tooltip title={`This order has ${n} lines`}><Tag color="orange" style={{ fontSize: 10, margin: 0, lineHeight: '16px', padding: '0 5px' }}>×{n}</Tag></Tooltip>}
          </div>
        );
      } },
    { title: 'Line', dataIndex: 'DisplayLineNumber', width: 70, align: 'center',
      render: (v, r) => {
        const n = orderLineCount[r._headerId] ?? 1;
        const ln = v ?? r.LineNumber ?? '—';
        return n > 1
          ? <Tag color="orange" style={{ fontSize: 11 }}>{ln} / {n}</Tag>
          : <Tag color="blue" style={{ fontSize: 11 }}>{ln}</Tag>;
      } },
    { title: 'Item', dataIndex: 'ItemNumber', width: 120, render: v => <Text strong style={{ fontSize: 12, color: REDWOOD.info }}>{v ?? '—'}</Text> },
    { title: 'Description', dataIndex: 'ItemDescription', width: 220, ellipsis: true, render: v => <Text style={{ fontSize: 12 }}>{v ?? '—'}</Text> },
    { title: 'Source Org', width: 150, ellipsis: true,
      render: (_, r) => <Tooltip title={r.SourceOrganizationName}><Tag color="blue" style={{ fontSize: 11 }}>{r.SourceOrganizationCode ?? '—'}</Tag>
        <Text style={{ fontSize: 11 }}>{r.SourceSubinventoryCode ? `· ${r.SourceSubinventoryCode}` : ''}</Text></Tooltip> },
    { title: 'Dest Org', width: 150, ellipsis: true,
      render: (_, r) => <Tooltip title={r.DestinationOrganizationName}><Tag color="geekblue" style={{ fontSize: 11 }}>{r.DestinationOrganizationCode ?? '—'}</Tag>
        <Text style={{ fontSize: 11 }}>{r.DestinationSubinventoryCode ? `· ${r.DestinationSubinventoryCode}` : ''}</Text></Tooltip> },
    { title: 'UOM', dataIndex: 'QuantityUOMCode', width: 60, align: 'center', render: v => <Tag style={{ fontSize: 11 }}>{v ?? '—'}</Tag> },
    { title: 'Requested', dataIndex: 'RequestedQuantity', width: 90, align: 'right', render: fmtQty },
    { title: 'Shipped', dataIndex: 'ShippedQuantity', width: 80, align: 'right', render: v => <Text style={{ color: (v ?? 0) > 0 ? REDWOOD.success : undefined }}>{fmtQty(v)}</Text> },
    { title: 'Received', dataIndex: 'ReceivedQuantity', width: 80, align: 'right', render: v => <Text style={{ color: (v ?? 0) > 0 ? REDWOOD.success : undefined }}>{fmtQty(v)}</Text> },
    { title: 'Delivered', dataIndex: 'DeliveredQuantity', width: 80, align: 'right', render: fmtQty },
    { title: 'Unit Price', dataIndex: 'UnitPrice', width: 110, align: 'right', render: (v, r) => <Text style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>{fmtPrice(v, r.CurrencyCode)}</Text> },
    { title: 'Total Transfer Price', dataIndex: 'TotalTransferPrice', width: 160, align: 'right',
      render: (v, r) => <Text strong style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12, color: REDWOOD.primary }}>{fmtPrice(v, r.CurrencyCode)}</Text> },
    { title: 'Fulfillment', dataIndex: 'FulfillStatusMeaning', width: 150, render: v => statusTag(v) },
    { title: 'Line Status', dataIndex: 'TransferOrderLineStatus', width: 110, render: v => statusTag(v) },
    { title: 'Supply Ref', dataIndex: 'SupplyOrderReferenceNumber', width: 130,
      render: (v, r) => <Text style={{ fontSize: 12 }}>{v ?? r.SupplyOrderReferenceLineNumber ?? '—'}</Text> },
    { title: 'Need By', dataIndex: 'NeedByDate', width: 115, render: fmtDate },
  ];

  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <style>{`.to-multi-line > td { background: ${REDWOOD.warning}0F; }`}</style>
      <Card styles={{ body: { padding: '14px 18px' } }} style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}` }}>
        <Row gutter={[10, 10]} align="bottom">
          <Col xs={24} md={7}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Ordered Date (main GET on transfer orders)</div>
            <Space.Compact style={{ width: '100%' }}>
              <Select style={{ width: 72 }} value={dateOp} onChange={setDateOp} options={['>', '>=', '=', '<=', '<'].map(o => ({ value: o, label: o }))} />
              <DatePicker style={{ width: '100%' }} value={date} onChange={setDate} />
            </Space.Compact>
          </Col>
          <Col xs={24} md={17}>
            <Space wrap>
              <Button type="primary" icon={<SearchOutlined />} loading={loading} onClick={run}
                style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}>Fetch Orders &amp; Lines</Button>
              <Tooltip title="API Inspector"><Button icon={<ApiOutlined />} style={{ borderColor: REDWOOD.info, color: REDWOOD.info }} onClick={() => setApiOpen(true)}>API</Button></Tooltip>
              {loading && progress && <Text type="secondary" style={{ fontSize: 12 }}><Spin size="small" style={{ marginRight: 6 }} />{progress}</Text>}
            </Space>
          </Col>
        </Row>
        <Divider style={{ margin: '12px 0' }} />
        <Row gutter={[10, 10]}>
          <Col xs={12} md={4}><Input placeholder="Order #" allowClear prefix={<SearchOutlined style={{ color: REDWOOD.neutral300 }} />} value={fOrder} onChange={e => setFOrder(e.target.value)} /></Col>
          <Col xs={12} md={4}><Input placeholder="Item" allowClear value={fItem} onChange={e => setFItem(e.target.value)} /></Col>
          <Col xs={12} md={4}><Select allowClear showSearch placeholder="Source Org" style={{ width: '100%' }} value={fSrc} onChange={setFSrc} options={srcOrgOpts} /></Col>
          <Col xs={12} md={4}><Select allowClear showSearch placeholder="Dest Org" style={{ width: '100%' }} value={fDst} onChange={setFDst} options={dstOrgOpts} /></Col>
          <Col xs={12} md={4}><Select allowClear placeholder="Line Status" style={{ width: '100%' }} value={fStatus} onChange={setFStatus} options={statusOpts} /></Col>
          <Col xs={12} md={4}><Input placeholder="Filter any text…" allowClear value={fText} onChange={e => setFText(e.target.value)} /></Col>
        </Row>
      </Card>

      <Card styles={{ body: { padding: 0 } }} style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}` }}
        title={<Space><UnorderedListOutlined style={{ color: REDWOOD.primary }} /><Text strong>Transfer Order Lines</Text>
          {allLines.length > 0 && <Tag>{filtered.length} of {allLines.length} line{allLines.length !== 1 ? 's' : ''}</Tag>}
          {filtered.length > 0 && <Tag color="volcano">Σ {fmtPrice(totalPrice, ccy)}</Tag>}</Space>}
        extra={<Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={run}>Refresh</Button>}>
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: 50 }}>
            <Spin size="large" /><Text type="secondary">{progress}</Text>
          </div>
        ) : error && allLines.length === 0 ? (
          <div style={{ padding: 24, color: REDWOOD.error, background: REDWOOD.error + '10', margin: 16, borderRadius: 6 }}><InfoCircleOutlined style={{ marginRight: 8 }} />{error}</div>
        ) : !searched ? (
          <Empty description="Fetch orders & lines" style={{ padding: 60 }} />
        ) : filtered.length === 0 ? (
          <Empty description="No lines match the filters" style={{ padding: 60 }} />
        ) : (
          <Table columns={columns} dataSource={filtered} rowKey={(r, i) => `${r.LineId ?? i}`} size="small"
            scroll={{ x: 2080 }}
            pagination={{
              current: pg.current, pageSize: pg.pageSize, total: filtered.length,
              size: 'small', showSizeChanger: true, showTotal: t => `${t} lines`,
              onChange: (current, pageSize) => setPg({ current, pageSize }),
            }}
            rowClassName={(r) => multiOrders.has(r._headerId) ? 'to-multi-line' : ''}
            summary={() => (
              <Table.Summary fixed>
                <Table.Summary.Row style={{ background: REDWOOD.neutral100 }}>
                  <Table.Summary.Cell index={0} colSpan={13} align="right"><Text strong>Total Transfer Price</Text></Table.Summary.Cell>
                  <Table.Summary.Cell index={1} align="right"><Text strong style={{ color: REDWOOD.primary }}>{fmtPrice(totalPrice, ccy)}</Text></Table.Summary.Cell>
                  <Table.Summary.Cell index={2} colSpan={4} />
                </Table.Summary.Row>
              </Table.Summary>
            )} />
        )}
      </Card>

      <Modal title={<Space><ApiOutlined style={{ color: REDWOOD.info }} /> Search Lines API</Space>} open={apiOpen} onCancel={() => setApiOpen(false)} footer={null} width={860}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>Step 1 — get transfer orders in the date range. Step 2 — for each order, follow its <Text code>transferOrderLines</Text> link.</Text>
          {[
            { lbl: '1. Transfer Orders (by date)', url: ordersUrl },
            { lbl: '2. Lines per order', url: `${FUSION_BASE}/transferOrders/{HeaderId}/child/transferOrderLines` },
          ].map(({ lbl, url }) => (
            <div key={lbl}>
              <Text style={{ fontSize: 11, fontWeight: 700, color: REDWOOD.neutral600, textTransform: 'uppercase' }}>{lbl}</Text>
              <div style={{ marginTop: 4, padding: '8px 12px', borderRadius: 6, background: REDWOOD.neutral100, border: `1px solid ${REDWOOD.neutral200}`, fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all', color: REDWOOD.info }}>
                <Tag color="blue">GET</Tag>{url}
              </div>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
//  EDIT TRANSFER ORDER TAB
// ═══════════════════════════════════════════════════════════════════════════
const EditOrderTab: React.FC<{ headerId: number; headerNumber: string; onClose: () => void }> = ({ headerId, headerNumber, onClose }) => {
  const [header, setHeader]   = useState<any>(null);
  const [lines, setLines]     = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [edits, setEdits]     = useState<Record<number, { RequestedQuantity?: number | null; NeedByDate?: string | null }>>({});
  const [saving, setSaving]   = useState(false);
  const [result, setResult]   = useState<string>('');

  const headerUrl = `${FUSION_BASE}/transferOrders/${headerId}`;
  const linesUrl  = `${FUSION_BASE}/transferOrders/${headerId}/child/transferOrderLines`;

  const load = useCallback(async () => {
    setLoading(true); setError(''); setEdits({}); setResult('');
    try {
      const [h, l] = await Promise.all([
        fetch(headerUrl, { headers: HEADERS }).then(r => r.ok ? r.json() : Promise.reject(new Error(`Header HTTP ${r.status}`))),
        fetchAllPages(linesUrl),
      ]);
      setHeader(h); setLines(l);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [headerUrl, linesUrl]);
  useEffect(() => { load(); }, [load]);

  const isEditable = (l: any) => !['CLOSED', 'CANCELED', 'CANCELLED'].includes(String(l.StatusLookup ?? '').toUpperCase());
  const setEdit = (lineId: number, patch: any) => setEdits(p => ({ ...p, [lineId]: { ...p[lineId], ...patch } }));
  const dirtyLines = Object.entries(edits).filter(([id, e]) => {
    const orig = lines.find(l => l.LineId === Number(id));
    if (!orig) return false;
    const qChanged = e.RequestedQuantity != null && Number(e.RequestedQuantity) !== Number(orig.RequestedQuantity);
    const dChanged = e.NeedByDate != null && dayjs(e.NeedByDate).format('YYYY-MM-DD') !== dayjs(orig.NeedByDate).format('YYYY-MM-DD');
    return qChanged || dChanged;
  });

  const buildLinePayload = (lineId: number) => {
    const e = edits[lineId]; const orig = lines.find(l => l.LineId === lineId); const body: any = {};
    if (e?.RequestedQuantity != null && Number(e.RequestedQuantity) !== Number(orig.RequestedQuantity)) body.RequestedQuantity = Number(e.RequestedQuantity);
    if (e?.NeedByDate != null && dayjs(e.NeedByDate).format('YYYY-MM-DD') !== dayjs(orig.NeedByDate).format('YYYY-MM-DD')) body.NeedByDate = dayjs(e.NeedByDate).format('YYYY-MM-DD');
    return body;
  };

  const save = async () => {
    if (dirtyLines.length === 0) { message.info('No changes to save'); return; }
    setSaving(true); setResult('');
    const log: string[] = [];
    for (const [id] of dirtyLines) {
      const lineId = Number(id);
      const body = buildLinePayload(lineId);
      try {
        const r = await fetch(`${linesUrl}/${lineId}`, {
          method: 'PATCH',
          headers: { ...HEADERS, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const raw = await r.text();
        log.push(`Line ${lineId}: HTTP ${r.status} ${r.ok ? 'OK' : ''} — ${JSON.stringify(body)}${r.ok ? '' : '\n' + raw.slice(0, 400)}`);
      } catch (e: any) { log.push(`Line ${lineId}: ${e.message}`); }
    }
    setResult(log.join('\n\n'));
    setSaving(false);
    message.success('Save complete — see results');
    load();
  };

  const cols: ColumnsType<any> = [
    { title: 'Line', dataIndex: 'DisplayLineNumber', width: 55, align: 'center', render: (v, r) => <Tag color="blue">{v ?? r.LineNumber}</Tag> },
    { title: 'Item', dataIndex: 'ItemNumber', width: 120, render: v => <Text strong style={{ color: REDWOOD.info, fontSize: 12 }}>{v}</Text> },
    { title: 'Description', dataIndex: 'ItemDescription', width: 200, ellipsis: true },
    { title: 'Source → Dest', width: 150, render: (_, r) => <span><Tag color="blue" style={{ fontSize: 11 }}>{r.SourceOrganizationCode}</Tag><SwapOutlined style={{ margin: '0 2px', color: REDWOOD.neutral600 }} /><Tag color="geekblue" style={{ fontSize: 11 }}>{r.DestinationOrganizationCode}</Tag></span> },
    { title: 'UOM', dataIndex: 'QuantityUOMCode', width: 60, align: 'center', render: v => <Tag style={{ fontSize: 11 }}>{v}</Tag> },
    { title: 'Requested Qty', width: 130, align: 'right',
      render: (_, r) => isEditable(r)
        ? <InputNumber min={0} size="small" style={{ width: '100%' }} defaultValue={r.RequestedQuantity}
            onChange={v => setEdit(r.LineId, { RequestedQuantity: v })} />
        : <Text>{fmtQty(r.RequestedQuantity)}</Text> },
    { title: 'Shipped', dataIndex: 'ShippedQuantity', width: 80, align: 'right', render: fmtQty },
    { title: 'Received', dataIndex: 'ReceivedQuantity', width: 80, align: 'right', render: fmtQty },
    { title: 'Need By', width: 150,
      render: (_, r) => isEditable(r)
        ? <DatePicker size="small" style={{ width: '100%' }} defaultValue={r.NeedByDate ? dayjs(r.NeedByDate) : null}
            onChange={d => setEdit(r.LineId, { NeedByDate: d ? d.toISOString() : null })} />
        : <Text>{fmtDate(r.NeedByDate)}</Text> },
    { title: 'Unit Price', dataIndex: 'UnitPrice', width: 110, align: 'right', render: (v, r) => fmtPrice(v, r.CurrencyCode) },
    { title: 'Total Transfer Price', dataIndex: 'TotalTransferPrice', width: 150, align: 'right', render: (v, r) => <Text strong style={{ color: REDWOOD.primary }}>{fmtPrice(v, r.CurrencyCode)}</Text> },
    { title: 'Status', dataIndex: 'TransferOrderLineStatus', width: 110, render: v => statusTag(v) },
  ];

  const HInfo: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
    <Col xs={12} sm={8} md={6}>
      <div style={{ fontSize: 10, fontWeight: 700, color: REDWOOD.neutral600, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 13, marginTop: 2 }}>{value ?? '—'}</div>
    </Col>
  );

  const grandTotal = lines.reduce((s, l) => s + (Number(l.TotalTransferPrice) || 0), 0);
  const ccy = lines.find(l => l.CurrencyCode)?.CurrencyCode ?? '';

  return (
    <div style={{ background: REDWOOD.neutral100, minHeight: '100%' }}>
      <div style={{ background: REDWOOD.surface, padding: '10px 20px', borderBottom: `1px solid ${REDWOOD.neutral200}`, display: 'flex', alignItems: 'center', gap: 8 }}>
        <SwapOutlined style={{ color: REDWOOD.primary }} />
        <Text strong style={{ fontSize: 15 }}>Transfer Order {headerNumber}</Text>
        {header && statusTag(header.Status)}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <Button icon={<ReloadOutlined />} loading={loading} onClick={load}>Refresh</Button>
          <Button type="primary" icon={<CloudUploadOutlined />} loading={saving} onClick={save}
            disabled={dirtyLines.length === 0} style={{ background: REDWOOD.success, borderColor: REDWOOD.success }}>
            Save Changes{dirtyLines.length > 0 ? ` (${dirtyLines.length})` : ''}
          </Button>
          <Button onClick={onClose}>Close Tab</Button>
        </div>
      </div>

      {loading && !header ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Spin size="large" tip="Loading order…" /></div>
      ) : error ? (
        <div style={{ padding: 24, color: REDWOOD.error, background: REDWOOD.error + '10', margin: 16, borderRadius: 6 }}><InfoCircleOutlined style={{ marginRight: 8 }} />{error}</div>
      ) : (
        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {header && (
            <Card size="small" title={<Text strong>Order Details</Text>} style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}` }}>
              <Row gutter={[12, 12]}>
                <HInfo label="Order Number" value={<Text strong>{header.HeaderNumber}</Text>} />
                <HInfo label="Business Unit" value={header.BusinessUnitName} />
                <HInfo label="Source" value={header.SourceOfTransferOrder} />
                <HInfo label="Status" value={statusTag(header.Status)} />
                <HInfo label="Interface Status" value={statusTag(header.InterfaceStatus)} />
                <HInfo label="Ordered Date" value={fmtDate(header.OrderedDate)} />
                <HInfo label="Total Transfer Price" value={<Text strong style={{ color: REDWOOD.primary }}>{fmtPrice(header.TotalTransferPrice ?? grandTotal, ccy)}</Text>} />
                <HInfo label="Created By" value={header.CreatedBy} />
              </Row>
            </Card>
          )}

          <Card size="small" styles={{ body: { padding: 0 } }} style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}` }}
            title={<Space><UnorderedListOutlined style={{ color: REDWOOD.primary }} /><Text strong>Lines</Text><Tag>{lines.length}</Tag>
              <Tag color="volcano">Σ {fmtPrice(grandTotal, ccy)}</Tag></Space>}>
            <Table columns={cols} dataSource={lines} rowKey={(r, i) => `${r.LineId ?? i}`} size="small" pagination={false} scroll={{ x: 1400 }} />
          </Card>

          <Text type="secondary" style={{ fontSize: 11 }}>
            <InfoCircleOutlined style={{ marginRight: 6 }} />
            Editable fields (Requested Qty, Need-By) PATCH to <Text code>{linesUrl}/{'{LineId}'}</Text>. Closed/canceled lines are read-only.
          </Text>

          {result && (
            <div>
              <Text style={{ fontSize: 11, fontWeight: 700, color: REDWOOD.neutral600, textTransform: 'uppercase' }}>Save Results</Text>
              <div style={{ background: '#1e1e1e', color: '#d4d4d4', padding: 12, borderRadius: 6, fontFamily: 'monospace', fontSize: 11, maxHeight: 260, overflow: 'auto', whiteSpace: 'pre-wrap', marginTop: 4 }}>{result}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
//  PAGE
// ═══════════════════════════════════════════════════════════════════════════
interface EditTab { id: string; headerId: number; headerNumber: string }

const TransferOrders: React.FC = () => {
  const { orgs, loading: orgsLoading, load: reloadOrgs, url: orgsUrl } = useOrgs();
  const [tab, setTab] = useState('search');
  const [editTabs, setEditTabs] = useState<EditTab[]>([]);
  const [newSeed, setNewSeed] = useState<NewSeed | null>(null);
  const [newTabs, setNewTabs] = useState<number[]>([]);   // extra independent New-order tabs
  const newSeqRef = React.useRef(0);

  const copyToNew = (seed: NewSeed) => { setNewSeed(seed); setTab('new'); };

  // Open a fresh, independent New Transfer Order tab.
  const openNewTab = () => {
    newSeqRef.current += 1; const id = newSeqRef.current;
    setNewTabs(prev => [...prev, id]);
    setTab(`new-${id}`);
  };
  const closeNewTab = (id: number) => {
    setNewTabs(prev => prev.filter(x => x !== id));
    setTab('new');
  };

  const openEdit = (headerId: number, headerNumber: string) => {
    const id = `edit-${headerId}`;
    setEditTabs(prev => prev.find(t => t.id === id) ? prev : [...prev, { id, headerId, headerNumber }]);
    setTab(id);
  };
  const closeEdit = (id: string) => {
    setEditTabs(prev => prev.filter(t => t.id !== id));
    setTab('lines');
  };

  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
      <Content>
        <div style={{ padding: '12px 24px', background: REDWOOD.surface, borderBottom: `1px solid ${REDWOOD.neutral200}` }}>
          <Breadcrumb items={[
            { title: <Link to="/home"><HomeOutlined /> Home</Link> },
            { title: <Link to="/procurement">Fusion Supply Chain</Link> },
            { title: 'Transfer Orders' },
          ]} />
          <Title level={4} style={{ margin: '8px 0 0', display: 'flex', alignItems: 'center', gap: 8 }}>
            <SwapOutlined style={{ color: REDWOOD.primary }} /> Transfer Orders
            <Text type="secondary" style={{ fontSize: 13, fontWeight: 400 }}>— move stock between inventory organizations</Text>
          </Title>
        </div>
        <Tabs
          activeKey={tab}
          onChange={setTab}
          type="editable-card"
          hideAdd
          onEdit={(key, action) => {
            if (action !== 'remove') return;
            const k = String(key);
            if (k.startsWith('new-')) closeNewTab(Number(k.slice(4)));
            else closeEdit(k);
          }}
          style={{ background: REDWOOD.surface }}
          tabBarStyle={{ margin: 0, paddingLeft: 16, borderBottom: `2px solid ${REDWOOD.neutral200}` }}
          tabBarExtraContent={{
            right: (
              <div style={{ paddingRight: 16 }}>
                <Button type="primary" icon={<PlusOutlined />} onClick={openNewTab}
                  style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary, fontWeight: 600 }}>
                  New Transfer Order
                </Button>
              </div>
            ),
          }}
          items={[
            {
              key: 'search',
              label: <span><SearchOutlined style={{ marginRight: 6 }} />Search Orders</span>,
              closable: false,
              children: <SearchTab orgsLoading={orgsLoading} orgsUrl={orgsUrl} reloadOrgs={reloadOrgs} onEdit={openEdit} onCopyToNew={copyToNew} />,
            },
            {
              key: 'lines',
              label: <span><UnorderedListOutlined style={{ marginRight: 6 }} />Search Lines</span>,
              closable: false,
              children: <SearchLinesTab onEdit={openEdit} />,
            },
            {
              key: 'new',
              label: <span><PlusOutlined style={{ marginRight: 6 }} />New Transfer Order</span>,
              closable: false,
              children: <NewOrderTab orgs={orgs} orgsLoading={orgsLoading} seed={newSeed} />,
            },
            ...editTabs.map(t => ({
              key: t.id,
              label: <span><EditOutlined style={{ marginRight: 6, color: REDWOOD.primary }} />Edit {t.headerNumber}</span>,
              closable: true,
              children: <EditOrderTab headerId={t.headerId} headerNumber={t.headerNumber} onClose={() => closeEdit(t.id)} />,
            })),
            ...newTabs.map(id => ({
              key: `new-${id}`,
              label: <span><PlusOutlined style={{ marginRight: 6, color: REDWOOD.primary }} />New Transfer Order</span>,
              closable: true,
              children: <NewOrderTab orgs={orgs} orgsLoading={orgsLoading} />,
            })),
          ]}
        />
      </Content>
    </Layout>
  );
};

export default TransferOrders;
