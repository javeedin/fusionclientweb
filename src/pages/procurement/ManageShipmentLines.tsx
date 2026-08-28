import { getFusionAuthHeaders, getFusionInstance } from '../../config/api.helper';
import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  Layout, Breadcrumb, Card, Table, Form, Input, Select, DatePicker, Button,
  Tag, Typography, Space, Tooltip, Spin, Row, Col, message, Modal, Empty, Tabs,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  HomeOutlined, CarOutlined, SearchOutlined, ReloadOutlined, ClearOutlined,
  ApiOutlined, CopyOutlined, InfoCircleOutlined, ProfileOutlined,
  ExportOutlined, ThunderboltOutlined, CheckCircleOutlined,
  UnorderedListOutlined, BankOutlined, CheckSquareOutlined, DownOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import dayjs, { type Dayjs } from 'dayjs';
import { ShipConfirmModal, PickSlipDialog } from './ConfirmPicks';
import { getCurrentCompany } from '../../config/company.config';

const { Content } = Layout;

// Get Fusion base URL from current company configuration
const getFusionBase = () => {
  const company = getCurrentCompany();
  return company.fusionBaseUrl ? `${company.fusionBaseUrl}/fscmRestApi/resources/11.13.18.05` : '';
};
const { Title, Text } = Typography;

// Electron goes direct (no CORS); browser dev routes via the Vite proxy.
const FUSION_BASE = `${getFusionBase()}`;
const getHeaders = () => getFusionAuthHeaders();
const PAGE_LIMIT = 500;

const REDWOOD = {
  primary: '#C74634', primaryLight: '#E85D4A', success: '#1D7B4D', warning: '#B07700',
  info: '#0572CE', error: '#D93025', teal: '#00918A', purple: '#7245A6',
  neutral100: '#F7F7F7', neutral200: '#E5E5E5', neutral300: '#C7C7C7',
  neutral600: '#6B6B6B', neutral900: '#1A1A1A', surface: '#FFFFFF',
};

// ── Helpers ──────────────────────────────────────────────────────────────────
const fmtDate = (d?: string) => { if (!d) return '—'; try { return dayjs(d).format('D-MMM-YYYY'); } catch { return d; } };
const fmtDateTime = (d?: string) => { if (!d) return '—'; try { return dayjs(d).format('D-MMM-YYYY HH:mm'); } catch { return d; } };
const fmtQty = (v?: number | null) => (v == null ? '—' : new Intl.NumberFormat('en-US').format(v));
const fmtPrice = (v?: number | null, ccy?: string) => {
  if (v == null) return '—';
  const s = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v));
  return ccy ? `${s} ${ccy}` : s;
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

// Search results load one server page at a time (Fetch Next button), instead
// of walking every page like fetchAllPages does.
const SEARCH_PAGE_SIZE = 50;
// Slim row shape for the search grid — fields= keeps Fusion from materializing
// the full 100+ attribute row; the per-row "…" button fetches the complete
// record on demand.
const SEARCH_FIELDS = 'OrganizationCode,OrderType,ShipmentLine,Order,OrderLine,Item,ItemDescription,LineStatus,RequestedDate,RequestedQuantity,RequestedQuantityUOM';
// NOTE: no totalResults=true — computing the total forces Fusion to count the
// entire matching set of this expensive view, which is as slow as fetching
// everything. hasMore alone drives the Fetch Next button.
const fetchPage = async (baseUrl: string, offset: number): Promise<{ items: any[]; hasMore: boolean; totalResults?: number }> => {
  const sep = baseUrl.endsWith('?') ? '' : baseUrl.includes('?') ? '&' : '?';
  const url = `${baseUrl}${sep}limit=${SEARCH_PAGE_SIZE}&offset=${offset}`;
  const r = await fetch(url, { headers: getHeaders() });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);
  const d = await r.json();
  const items: any[] = Array.isArray(d) ? d : (d.items ?? []);
  return { items, hasMore: !!d.hasMore, totalResults: typeof d.totalResults === 'number' ? d.totalResults : undefined };
};

const statusTag = (s?: string) => {
  if (!s) return <Tag>—</Tag>;
  const up = s.toUpperCase();
  const color = up.includes('SHIP') ? 'green' : up.includes('BACKORDER') ? 'red'
    : up.includes('STAGED') ? 'gold' : up.includes('RELEASE') ? 'blue' : 'geekblue';
  return <Tag color={color} style={{ fontSize: 11 }}>{s}</Tag>;
};

// A field is hidden from the "all fields" detail view when it's an id/href or empty.
const isHiddenKey = (k: string) => /Id$/.test(k) || /Id[0-9]+$/.test(k) || k === 'links' || k.startsWith('Src') || /^QuickShip/.test(k);
const isEmpty = (v: any) => v == null || v === '' || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v ?? {}).length === 0);

interface Filters {
  dateOp?: string; date?: Dayjs | null;
  orderType?: string; order?: string; item?: string; itemDesc?: string; lineStatus?: string; orgCode?: string;
}

const ORDER_TYPES = ['Transfer order', 'Sales order', 'Purchase order', 'Return material authorization'];
const LINE_STATUSES = ['Ready to release', 'Released to warehouse', 'Released', 'Staged', 'Shipped', 'Backordered', 'Interfaced', 'Awaiting shipping'];

const renderVal = (k: string, v: any): React.ReactNode => {
  if (v == null || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'object') return JSON.stringify(v);
  if (/Date$/.test(k) || k.endsWith('DateTime')) return fmtDateTime(String(v));
  return String(v);
};

// Build dynamic columns from a set of rows: drop id/href/flexfield columns and
// any column that's empty across every row.
const dynamicColumns = (items: any[]): ColumnsType<any> => {
  const keys: string[] = [];
  const seen = new Set<string>();
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

// A tab that lazily fetches a child link (attachments, costs, reservations…).
const ChildLinkTab: React.FC<{ href: string; name: string }> = ({ href, name }) => {
  const [items, setItems] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setItems(await fetchAllPages(href)); }
    catch (e: any) { setError(e.message); setItems([]); }
    finally { setLoading(false); }
  }, [href]);
  useEffect(() => { load(); }, [load]);

  const cols = useMemo(() => dynamicColumns(items ?? []), [items]);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginBottom: 8 }}>
        <Tooltip title={<span style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}><b>GET</b> {href}</span>}>
          <Button size="small" type="text" icon={<ApiOutlined />} style={{ color: REDWOOD.info }} />
        </Tooltip>
        <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={load}>Reload</Button>
      </div>
      {loading ? <div style={{ textAlign: 'center', padding: 30 }}><Spin /></div>
        : error ? <div style={{ color: REDWOOD.error, fontSize: 12 }}><InfoCircleOutlined style={{ marginRight: 6 }} />{error}</div>
        : !items || items.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={`No ${name} records`} style={{ padding: 24 }} />
        : <Table size="small" columns={cols} dataSource={items} rowKey={(_, i) => `${name}-${i}`}
            pagination={items.length > 20 ? { pageSize: 20, size: 'small' } : false} scroll={{ x: 'max-content', y: 340 }} />}
    </div>
  );
};

// Dialog for one order: Lines tab (re-queried by Order) + one tab per child link.
const ShipmentOrderDialog: React.FC<{ row: any | null; onClose: () => void }> = ({ row, onClose }) => {
  const [lines, setLines] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const order = row?.Order;
  const linesUrl = order ? `${FUSION_BASE}/shipmentLines?q=${encodeURIComponent(`Order='${order}'`)}&orderBy=OrderLine:asc` : '';

  const loadLines = useCallback(async () => {
    if (!linesUrl) return;
    setLoading(true); setError('');
    try { setLines(await fetchAllPages(linesUrl)); }
    catch (e: any) { setError(e.message); setLines([]); }
    finally { setLoading(false); }
  }, [linesUrl]);
  useEffect(() => { if (row) loadLines(); }, [row, loadLines]);

  const childLinks = (row?.links ?? []).filter((l: any) => l.rel === 'child' && l.href);
  const hdr = lines[0] ?? row;   // header info comes from the order's lines

  // Pick Release is allowed when any line is Ready to release or Backordered.
  const releaseSource = lines.length ? lines : (row ? [row] : []);
  const canRelease = releaseSource.some(l => {
    const s = String(l?.LineStatus ?? '').toLowerCase();
    return s.startsWith('ready to release') || s.includes('backorder');
  });

  // Resolve the order type code from the code field, falling back to the
  // display name. Transfer orders omit OrderType entirely; other types send
  // OrderType as the space-separated name (e.g. SALES_ORDER -> "SALES ORDER").
  const orderTypeDisplay = String(hdr?.OrderType ?? '').toLowerCase();
  const orderTypeCode = hdr?.OrderTypeCode
    ?? (orderTypeDisplay.includes('transfer') ? 'TRANSFER_ORDER'
      : orderTypeDisplay.includes('sales') ? 'SALES_ORDER'
      : orderTypeDisplay.includes('purchase') ? 'PURCHASE_ORDER'
      : orderTypeDisplay.includes('return') ? 'RETURN_MATERIAL_AUTHORIZATION'
      : undefined);
  const isTransferOrder = orderTypeCode === 'TRANSFER_ORDER' || orderTypeDisplay.includes('transfer');
  const orderTypeValue = orderTypeCode?.replace(/_/g, ' ');   // "SALES ORDER"

  const pickPayload = {
    SourceSystemName: 'OPS',
    BatchPrefix: `PR-${order}`,
    ShipFromOrganizationCode: hdr?.OrganizationCode,
    ReleaseStatus: 'All',
    ...(!isTransferOrder && orderTypeValue ? { OrderType: orderTypeValue } : {}),
    OrderNumber: String(order ?? ''),
    PickReleaseFlag: 'true',
    AutoPickConfirmFlag: 'false',
    ShipConfirmRule: '002_Ship_Confirm_Rule',
    CreateShipmentsFlag: 'true',
    ShipmentCreationCriteria: 'Across orders',
  };
  const pickUrl = `${FUSION_BASE}/pickWaves`;

  const [releasing, setReleasing] = useState(false);
  const [releaseResult, setReleaseResult] = useState<{ ok: boolean; status: number; body: string } | null>(null);
  const [payloadOpen, setPayloadOpen] = useState(false);

  // Ship Confirm (shippingTransactions) — shipment name & org come from the lines.
  const [shipOpen, setShipOpen] = useState(false);
  const shipmentName = hdr?.Shipment ?? hdr?.ShipmentName ?? lines.map(l => l.Shipment).find(Boolean);

  // Pickslip — query Confirm-Picks pick slips for this order and reuse its dialog.
  const [psLoading, setPsLoading] = useState(false);
  const [psRows, setPsRows] = useState<any[] | null>(null);   // chooser list (>1 slip)
  const [psDialogRow, setPsDialogRow] = useState<any | null>(null);
  const openPickSlips = useCallback(async () => {
    if (!order) return;
    setPsLoading(true);
    try {
      const url = `${FUSION_BASE}/pickSlipDetails?q=${encodeURIComponent(`Order='${order}'`)}&orderBy=CreationDate:desc`;
      const slips = await fetchAllPages(url);
      if (slips.length === 0) { message.info(`No pick slips found for order ${order}`); }
      else if (slips.length === 1) { setPsDialogRow(slips[0]); }
      else { setPsRows(slips); }
    } catch (e: any) { message.error(`Pick slip lookup failed: ${e.message}`); }
    finally { setPsLoading(false); }
  }, [order]);

  const pickRelease = () => {
    Modal.confirm({
      title: 'Pick Release this order?',
      width: 560,
      content: (
        <div style={{ fontSize: 13 }}>
          Release order <Tag color="volcano">{order}</Tag> from <Tag color="blue">{hdr?.OrganizationCode}</Tag> for picking &amp; shipment via <b>pickWaves</b>.
          <div style={{ marginTop: 8, color: REDWOOD.neutral600, fontSize: 12 }}>POST {pickUrl}</div>
        </div>
      ),
      okText: 'Pick Release',
      onOk: async () => {
        setReleasing(true); setReleaseResult(null);
        try {
          const r = await fetch(pickUrl, {
            method: 'POST',
            headers: { ...getHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify(pickPayload),
          });
          const raw = await r.text();
          let data: any = null, pretty = raw;
          try { data = JSON.parse(raw); pretty = JSON.stringify(data, null, 2); } catch { /* keep raw */ }
          // pickWaves can return HTTP 200 with ReturnStatus 'E' — treat that as a failure.
          const retStatus = String(data?.ReturnStatus ?? data?.returnStatus ?? '').toUpperCase();
          const retMsg = data?.ReturnMessage ?? data?.returnMessage;
          const ok = r.ok && retStatus !== 'E';
          setReleaseResult({ ok, status: r.status, body: pretty });
          if (ok) {
            message.success('Pick Release Success');
            loadLines();
          } else {
            const msg = retMsg || `Pick release failed (HTTP ${r.status})`;
            Modal.error({ title: 'Pick Release Failed', width: 600, content: <div style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>{msg}</div> });
          }
        } catch (e: any) {
          setReleaseResult({ ok: false, status: 0, body: `Network error: ${e.message}` });
          Modal.error({ title: 'Pick Release Failed', content: e.message });
        } finally { setReleasing(false); }
      },
    });
  };

  const HInfo: React.FC<{ label: string; value: React.ReactNode; icon?: React.ReactNode }> = ({ label, value, icon }) => (
    <Col xs={12} sm={8} md={6}>
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: REDWOOD.neutral600, textTransform: 'uppercase', letterSpacing: '0.03em' }}>{icon}{icon ? ' ' : ''}{label}</div>
        <div style={{ fontSize: 12.5, color: REDWOOD.neutral900, marginTop: 2 }}>{value ?? '—'}</div>
      </div>
    </Col>
  );

  const lineCols: ColumnsType<any> = [
    { title: 'Ship Line', dataIndex: 'ShipmentLine', width: 100, render: v => <Text strong style={{ color: REDWOOD.info, fontSize: 12 }}>{v}</Text> },
    { title: 'Line', dataIndex: 'OrderLine', width: 55, align: 'center', render: v => <Tag color="blue" style={{ fontSize: 11 }}>{v ?? '—'}</Tag> },
    { title: 'Item', dataIndex: 'Item', width: 130, render: v => <Text strong style={{ fontSize: 12 }}>{v ?? '—'}</Text> },
    { title: 'Description', dataIndex: 'ItemDescription', ellipsis: true, render: v => <Text style={{ fontSize: 12 }}>{v ?? '—'}</Text> },
    { title: 'Requested Qty', dataIndex: 'RequestedQuantity', width: 110, align: 'right', render: (v, r) => `${fmtQty(v)}${r.RequestedQuantityUOM ? ' ' + r.RequestedQuantityUOM : ''}` },
    { title: 'Shipped', dataIndex: 'ShippedQuantity', width: 90, align: 'right', render: fmtQty },
    { title: 'Pending', dataIndex: 'PendingQuantity', width: 90, align: 'right', render: fmtQty },
    { title: 'Line Status', dataIndex: 'LineStatus', width: 140, render: v => statusTag(v) },
    { title: 'Org', dataIndex: 'OrganizationCode', width: 75, render: v => <Tag style={{ fontSize: 11 }}>{v ?? '—'}</Tag> },
    { title: 'Src → Dest Subinv', width: 140, render: (_, r) => <span>{r.SourceSubinventory ?? '—'} <SwapMini /> {r.DestinationSubinventory ?? '—'}</span> },
    { title: 'Requested Date', dataIndex: 'RequestedDate', width: 130, render: fmtDate },
    { title: 'Shipment', dataIndex: 'Shipment', width: 100, render: v => v ?? '—' },
  ];

  const iconFor = (name: string) => {
    if (name === 'costs') return <DollarMini />;
    return <ProfileOutlined />;
  };

  return (
    <Modal
      open={!!row} onCancel={onClose} maskClosable={false} width={1080} style={{ top: 24 }}
      footer={<Button onClick={onClose}>Close</Button>}
      title={<Space><CarOutlined style={{ color: REDWOOD.primary }} /> Order <Tag color="volcano">{order}</Tag>
        {hdr?.OrderType && <Tag color="purple">{hdr.OrderType}</Tag>}
        {statusTag(hdr?.LineStatus)}</Space>}
    >
      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <Tooltip title={canRelease ? 'Release this order for picking & shipment' : 'Pick Release needs a line in Ready to release or Backordered status'}>
          <Button type="primary" icon={<ThunderboltOutlined />} disabled={!canRelease} loading={releasing} onClick={pickRelease}
            style={canRelease ? { background: REDWOOD.success, borderColor: REDWOOD.success } : undefined}>
            Pick Release
          </Button>
        </Tooltip>
        <Tooltip title="Ship confirm this shipment (shippingTransactions)">
          <Button icon={<CarOutlined />} onClick={() => setShipOpen(true)}
            style={{ borderColor: REDWOOD.info, color: REDWOOD.info }}>Ship Confirm</Button>
        </Tooltip>
        <Tooltip title="Query the Confirm Picks pick slips for this order">
          <Button icon={<CheckSquareOutlined />} loading={psLoading} onClick={openPickSlips}
            style={{ borderColor: REDWOOD.purple, color: REDWOOD.purple }}>Pickslip</Button>
        </Tooltip>
        <Button icon={<ReloadOutlined />} loading={loading} onClick={loadLines}>Refresh</Button>
        <Tooltip title={releaseResult
          ? `Pick Release API — request & last response (HTTP ${releaseResult.status || 'error'})`
          : 'Pick Release API — URL & request body'}>
          <Button icon={<ApiOutlined />} onClick={() => setPayloadOpen(true)}
            style={{ marginLeft: 'auto', borderColor: releaseResult ? (releaseResult.ok ? REDWOOD.success : REDWOOD.error) : REDWOOD.info,
              color: releaseResult ? (releaseResult.ok ? REDWOOD.success : REDWOOD.error) : REDWOOD.info }}>
            API{releaseResult ? (releaseResult.ok ? ' ✓' : ' ✗') : ''}
          </Button>
        </Tooltip>
      </div>

      {/* Header */}
      <Card size="small" title={<Space><BankOutlined style={{ color: REDWOOD.primary }} /><Text strong>Header</Text></Space>}
        style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}`, marginBottom: 12 }}>
        {!hdr ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="—" /> : (
          <Row gutter={[12, 0]}>
            <HInfo label="Order" value={<Text strong>{order}</Text>} />
            <HInfo label="Order Type" value={<span>{hdr.OrderType}{hdr.OrderTypeCode ? <Tag style={{ marginLeft: 6, fontSize: 10 }}>{hdr.OrderTypeCode}</Tag> : null}</span>} />
            <HInfo label="Ship-From Org" value={<span><Tag>{hdr.OrganizationCode}</Tag>{hdr.OrganizationName ?? ''}</span>} />
            <HInfo label="Destination Org" value={hdr.DestinationOrganizationCode ?? '—'} />
            <HInfo label="Business Unit" value={hdr.BusinessUnit ?? '—'} />
            <HInfo label="Legal Entity" value={hdr.LegalEntity ?? '—'} />
            <HInfo label="Requested Date" value={fmtDate(hdr.RequestedDate)} />
            <HInfo label="Scheduled Ship" value={fmtDate(hdr.ScheduledShipDate)} />
            <HInfo label="Creation Date" value={fmtDate(hdr.CreationDate)} />
            <HInfo label="Currency" value={hdr.CurrencyCode ?? '—'} />
            <HInfo label="Ship To Location" value={hdr.ShipToLocation ?? '—'} />
            <HInfo label="Src / Dest Subinv" value={`${hdr.SourceSubinventory ?? '—'} → ${hdr.DestinationSubinventory ?? '—'}`} />
          </Row>
        )}
      </Card>

      {/* Lines + child-link tabs */}
      <Tabs
        size="small"
        items={[
          {
            key: 'lines',
            label: <span><UnorderedListOutlined style={{ marginRight: 5 }} />Lines{lines.length ? ` (${lines.length})` : ''}</span>,
            children: loading ? <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
              : error ? <div style={{ color: REDWOOD.error, fontSize: 12 }}><InfoCircleOutlined style={{ marginRight: 6 }} />{error}</div>
              : lines.length === 0 ? <Empty description="No lines" style={{ padding: 30 }} />
              : (<>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
                    <Tooltip title={<span style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}><b>GET</b> {decodeURIComponent(linesUrl)}</span>}>
                      <Button size="small" type="text" icon={<ApiOutlined />} style={{ color: REDWOOD.info }} />
                    </Tooltip>
                  </div>
                  <Table size="small" columns={lineCols} dataSource={lines} rowKey={(r, i) => `${r.ShipmentLine ?? i}`}
                    pagination={false} scroll={{ x: 1300, y: 340 }} />
                </>),
          },
          ...childLinks.map((l: any) => ({
            key: l.name,
            label: <span>{iconFor(l.name)}<span style={{ marginLeft: 5, textTransform: 'capitalize' }}>{l.name}</span></span>,
            children: <ChildLinkTab href={l.href} name={l.name} />,
          })),
        ]}
      />

      {/* Pick Release API inspector — URL, request body & last response */}
      <Modal title={<Space><ThunderboltOutlined style={{ color: REDWOOD.success }} /> Pick Release API — pickWaves</Space>}
        open={payloadOpen} onCancel={() => setPayloadOpen(false)} maskClosable={false} width={680}
        footer={<Button onClick={() => setPayloadOpen(false)}>Close</Button>}>
        <div style={{ padding: '6px 10px', borderRadius: 6, background: REDWOOD.neutral100, border: `1px solid ${REDWOOD.neutral200}`, fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all', color: REDWOOD.info, marginBottom: 12 }}>
          <Tag color="green">POST</Tag>{pickUrl}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <Text style={{ fontSize: 11, fontWeight: 700, color: REDWOOD.neutral600, textTransform: 'uppercase' }}>Request body</Text>
          <Button size="small" type="text" icon={<CopyOutlined />} style={{ marginLeft: 'auto' }}
            onClick={() => { navigator.clipboard.writeText(JSON.stringify(pickPayload, null, 2)); message.success('Copied'); }}>Copy</Button>
        </div>
        <div style={{ background: '#1e1e1e', color: '#d4d4d4', padding: 12, borderRadius: 6, fontFamily: 'monospace', fontSize: 11, maxHeight: 280, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
          {JSON.stringify(pickPayload, null, 2)}
        </div>

        {releaseResult && (
          <div style={{ marginTop: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <Text style={{ fontSize: 11, fontWeight: 700, color: REDWOOD.neutral600, textTransform: 'uppercase' }}>Response</Text>
              <Tag color={releaseResult.ok ? 'success' : releaseResult.status === 0 ? 'default' : 'error'}>
                {releaseResult.status === 0 ? 'Network Error' : `HTTP ${releaseResult.status}`}
              </Tag>
              {releaseResult.ok && <Text style={{ color: REDWOOD.success, fontSize: 12 }}><CheckCircleOutlined /> Pick wave released</Text>}
              <Button size="small" type="text" icon={<CopyOutlined />} style={{ marginLeft: 'auto' }}
                onClick={() => { navigator.clipboard.writeText(releaseResult.body); message.success('Copied'); }}>Copy</Button>
            </div>
            <div style={{ background: '#1e1e1e', color: '#d4d4d4', padding: 12, borderRadius: 6, fontFamily: 'monospace', fontSize: 11, maxHeight: 280, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {releaseResult.body.slice(0, 8000)}{releaseResult.body.length > 8000 ? '\n\n… (truncated)' : ''}
            </div>
          </div>
        )}
      </Modal>

      {/* Ship Confirm (shared dialog → shippingTransactions) */}
      <ShipConfirmModal open={shipOpen} shipmentName={shipmentName} organization={hdr?.OrganizationCode}
        onClose={() => setShipOpen(false)} onDone={loadLines} />

      {/* Pick slip chooser when the order has more than one pick slip */}
      <Modal title={<Space><CheckSquareOutlined style={{ color: REDWOOD.purple }} /> Pick Slips — order {order}</Space>}
        open={!!psRows} onCancel={() => setPsRows(null)} maskClosable={false} width={720}
        footer={<Button onClick={() => setPsRows(null)}>Close</Button>}>
        <Table size="small" pagination={false} scroll={{ y: 360 }}
          dataSource={(psRows ?? []).map((r, i) => ({ ...r, _k: i }))} rowKey="_k"
          columns={[
            { title: 'Pick Slip', dataIndex: 'PickSlip', width: 130, render: (v, r) => (
              <Button type="link" style={{ padding: 0, fontWeight: 700, color: REDWOOD.info }}
                onClick={() => { setPsDialogRow(r); setPsRows(null); }}>{v}</Button>) },
            { title: 'Pick Wave', dataIndex: 'PickWave', width: 110, render: v => v ?? '—' },
            { title: 'Org', dataIndex: 'Organization', width: 80, render: v => <Tag>{v ?? '—'}</Tag> },
            { title: '# Picks', dataIndex: 'NumberOfPicks', width: 80, align: 'right', render: v => v ?? '—' },
            { title: 'Creation Date', dataIndex: 'CreationDate', width: 130, render: fmtDate },
          ]} />
      </Modal>

      {/* Same Confirm-Picks pick slip dialog */}
      <PickSlipDialog row={psDialogRow} onClose={() => setPsDialogRow(null)} />
    </Modal>
  );
};

const SwapMini = () => <span style={{ color: REDWOOD.neutral600, margin: '0 2px' }}>→</span>;
const DollarMini = () => <span style={{ color: REDWOOD.primary }}>$</span>;

const ManageShipmentLines: React.FC = () => {
  const [form] = Form.useForm();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');
  const [apiOpen, setApiOpen] = useState(false);
  const [detail, setDetail] = useState<any | null>(null);
  const [orderDialog, setOrderDialog] = useState<any | null>(null);
  const [filterText, setFilterText] = useState('');
  // Server-side pagination state (Fetch Next button)
  const [nextOffset, setNextOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [fetchingMore, setFetchingMore] = useState(false);
  const [totalCount, setTotalCount] = useState<number | undefined>(undefined);
  const [organizations, setOrganizations] = useState<any[]>([]);
  const [orgsLoading, setOrgsLoading] = useState(false);

  // Creation Date has NO default — it enters the query only when picked.
  // Organization and Order Type are mandatory; everything else is optional.
  const [filters, setFilters] = useState<Filters>({ dateOp: '>', lineStatus: 'Ready to release' });

  // Load inventory organizations on mount
  useEffect(() => {
    const loadOrgs = async () => {
      setOrgsLoading(true);
      try {
        const url = `${FUSION_BASE}/inventoryOrganizations?onlyData=true&limit=500&fields=OrganizationCode,OrganizationName`;
        const orgs = await fetchAllPages(url);
        setOrganizations(orgs);
      } catch (e: any) {
        console.error('Failed to load organizations:', e);
      } finally {
        setOrgsLoading(false);
      }
    };
    loadOrgs();
  }, []);

  // Fusion here uses SQL LIKE with single quotes and % wildcards; dates unquoted.
  const buildQ = useCallback((f: Filters) => {
    const parts: string[] = [];
    if (f.date) parts.push(`CreationDate${f.dateOp || '>'}${dayjs(f.date).format('YYYY-MM-DD')}`);
    if (f.orgCode) parts.push(`OrganizationCode='${f.orgCode}'`);
    if (f.orderType) parts.push(`OrderType='${f.orderType}'`);
    if (f.order?.trim()) parts.push(`Order='${f.order.trim()}'`);
    if (f.item?.trim()) parts.push(`Item LIKE '${f.item.trim()}%'`);
    if (f.itemDesc?.trim()) parts.push(`ItemDescription LIKE '%${f.itemDesc.trim()}%'`);
    if (f.lineStatus) parts.push(`LineStatus='${f.lineStatus}'`);
    return parts.join(';');
  }, []);

  const searchUrl = useMemo(() => {
    const q = buildQ(filters);
    const qs = q ? `q=${encodeURIComponent(q)}&` : '';
    return `${FUSION_BASE}/shipmentLines?${qs}onlyData=true&fields=${SEARCH_FIELDS}`;
  }, [filters, buildQ]);

  const runSearch = useCallback(async () => {
    if (!filters.orgCode)   { message.warning('Organization is required.'); return; }
    if (!filters.orderType) { message.warning('Order Type is required.');  return; }
    setLoading(true); setError(''); setSearched(true);
    try {
      const { items, hasMore: more, totalResults } = await fetchPage(searchUrl, 0);
      setRows(items);
      setNextOffset(items.length);
      setHasMore(more);
      setTotalCount(totalResults);
      if (items.length === 0) setError(`No shipment lines matched.${filters.date ? ` Note: the Creation Date filter (${filters.dateOp || '>'} ${dayjs(filters.date).format('D-MMM-YYYY')}) is part of the query — clear or widen it to match older lines.` : ''} The API button shows the exact URL sent.`);
    } catch (e: any) { setError(e.message); setRows([]); setHasMore(false); setTotalCount(undefined); }
    finally { setLoading(false); }
  }, [searchUrl, filters]);

  // The grid rows are slim (fields=…) — pull the complete record for the
  // detail modal only when asked.
  const openDetail = useCallback(async (r: any) => {
    if (!r?.ShipmentLine) { setDetail(r); return; }
    const hide = message.loading('Loading full record…', 0);
    try {
      const res = await fetch(`${FUSION_BASE}/shipmentLines?q=${encodeURIComponent(`ShipmentLine=${r.ShipmentLine}`)}&onlyData=true&limit=1`, { headers: getHeaders() });
      const d = await res.json();
      setDetail((d.items && d.items[0]) || r);
    } catch { setDetail(r); }
    finally { hide(); }
  }, []);

  // Fetch Next: appends the next server page of SEARCH_PAGE_SIZE records.
  const fetchMore = useCallback(async () => {
    setFetchingMore(true);
    try {
      const { items, hasMore: more, totalResults } = await fetchPage(searchUrl, nextOffset);
      setRows(prev => [...prev, ...items]);
      setNextOffset(nextOffset + items.length);
      setHasMore(more);
      if (totalResults != null) setTotalCount(totalResults);
    } catch (e: any) { message.error(`Fetch next failed: ${e.message}`); }
    finally { setFetchingMore(false); }
  }, [searchUrl, nextOffset]);

  const filtered = useMemo(() => {
    const t = filterText.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter(r => JSON.stringify(r).toLowerCase().includes(t));
  }, [rows, filterText]);

  const columns: ColumnsType<any> = [
    { title: 'Requested Date', dataIndex: 'RequestedDate', width: 130, fixed: 'left', render: fmtDate,
      sorter: (a, b) => String(a.RequestedDate ?? '').localeCompare(String(b.RequestedDate ?? '')) },
    { title: 'Line Status', dataIndex: 'LineStatus', width: 140, render: v => statusTag(v) },
    { title: 'Org', dataIndex: 'OrganizationCode', width: 80, render: (v, r) => <Tooltip title={r.OrganizationName}><Tag style={{ fontSize: 11 }}>{v ?? '—'}</Tag></Tooltip> },
    { title: 'Shipment Line', dataIndex: 'ShipmentLine', width: 110, render: v => <Text strong style={{ color: REDWOOD.info, fontSize: 12 }}>{v ?? '—'}</Text> },
    { title: 'Order Type', dataIndex: 'OrderType', width: 130,
      render: (v, r) => <Tooltip title={r.OrderTypeCode}><Tag color="purple" style={{ fontSize: 11 }}>{v ?? '—'}</Tag></Tooltip> },
    { title: 'Order', dataIndex: 'Order', width: 120,
      render: (v, r) => v ? (
        <Space size={2}>
          <Button type="link" style={{ padding: 0, fontWeight: 700, color: REDWOOD.info, fontSize: 12 }}
            onClick={() => setOrderDialog(r)}>{v}</Button>
          <Tooltip title="Open order"><Button size="small" type="text" icon={<ExportOutlined />} style={{ color: REDWOOD.info }} onClick={() => setOrderDialog(r)} /></Tooltip>
        </Space>
      ) : <Text>—</Text> },
    { title: 'Line', dataIndex: 'OrderLine', width: 55, align: 'center', render: v => <Tag color="blue" style={{ fontSize: 11 }}>{v ?? '—'}</Tag> },
    { title: 'Item', dataIndex: 'Item', width: 130, render: v => <Text strong style={{ color: REDWOOD.info, fontSize: 12 }}>{v ?? '—'}</Text> },
    { title: 'Description', dataIndex: 'ItemDescription', width: 240, ellipsis: true, render: v => <Text style={{ fontSize: 12 }}>{v ?? '—'}</Text> },
    { title: 'Requested Qty', dataIndex: 'RequestedQuantity', width: 110, align: 'right', render: (v, r) => <span><Text style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>{fmtQty(v)}</Text>{r.RequestedQuantityUOM ? <Text type="secondary" style={{ fontSize: 11 }}> {r.RequestedQuantityUOM}</Text> : ''}</span> },
    { title: '', key: 'more', width: 46, fixed: 'right', align: 'center',
      render: (_, r) => (
        <Tooltip title="Show all remaining fields">
          <Button size="small" type="text" icon={<ProfileOutlined />} style={{ color: REDWOOD.info }} onClick={() => openDetail(r)} />
        </Tooltip>
      ) },
  ];

  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
      <Content>
        <div style={{ padding: '12px 24px', background: REDWOOD.surface, borderBottom: `1px solid ${REDWOOD.neutral200}` }}>
          <Breadcrumb items={[
            { title: <Link to="/home"><HomeOutlined /> Home</Link> },
            { title: <Link to="/procurement">Fusion Supply Chain</Link> },
            { title: 'Manage Shipment Lines' },
          ]} />
          <Title level={4} style={{ margin: '8px 0 0', display: 'flex', alignItems: 'center', gap: 8 }}>
            <CarOutlined style={{ color: REDWOOD.primary }} /> Manage Shipment Lines
            <Text type="secondary" style={{ fontSize: 13, fontWeight: 400 }}>— pending &amp; in-progress shipment lines (Fusion shipmentLines)</Text>
          </Title>
        </div>

        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Search panel */}
          <Card styles={{ body: { padding: '14px 18px' } }} style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}` }}>
            <Form form={form} layout="vertical" size="small">
              <Row gutter={[8, 0]}>
                <Col xs={24} sm={12} md={5}>
                  <Form.Item label={<Text style={{ fontSize: 11, fontWeight: 600 }}>Creation Date</Text>} style={{ marginBottom: 6 }}>
                    <Space.Compact style={{ width: '100%' }}>
                      <Select style={{ width: 62 }} value={filters.dateOp} onChange={v => setFilters(f => ({ ...f, dateOp: v }))}
                        options={['>', '>=', '=', '<=', '<'].map(o => ({ value: o, label: o }))} />
                      <DatePicker style={{ width: '100%' }} value={filters.date} onChange={d => setFilters(f => ({ ...f, date: d }))} />
                    </Space.Compact>
                  </Form.Item>
                </Col>
                <Col xs={12} sm={12} md={4}>
                  <Form.Item label={<Text style={{ fontSize: 11, fontWeight: 600 }}><Text style={{ color: REDWOOD.error }}>*</Text> Organization</Text>} style={{ marginBottom: 6 }}>
                    <Select allowClear showSearch placeholder="Any" value={filters.orgCode} loading={orgsLoading}
                      onChange={v => setFilters(f => ({ ...f, orgCode: v }))}
                      options={organizations.map(o => ({ value: o.OrganizationCode, label: `${o.OrganizationCode} — ${o.OrganizationName}` }))} />
                  </Form.Item>
                </Col>
                <Col xs={12} sm={12} md={4}>
                  <Form.Item label={<Text style={{ fontSize: 11, fontWeight: 600 }}><Text style={{ color: REDWOOD.error }}>*</Text> Order Type</Text>} style={{ marginBottom: 6 }}>
                    <Select allowClear showSearch placeholder="Any" value={filters.orderType}
                      onChange={v => setFilters(f => ({ ...f, orderType: v }))}
                      options={ORDER_TYPES.map(s => ({ value: s, label: s }))} />
                  </Form.Item>
                </Col>
                <Col xs={12} sm={8} md={2}>
                  <Form.Item label={<Text style={{ fontSize: 11, fontWeight: 600 }}>Order</Text>} style={{ marginBottom: 6 }}>
                    <Input placeholder="Order #" allowClear value={filters.order}
                      onChange={e => setFilters(f => ({ ...f, order: e.target.value }))} onPressEnter={runSearch} />
                  </Form.Item>
                </Col>
                <Col xs={12} sm={8} md={3}>
                  <Form.Item label={<Text style={{ fontSize: 11, fontWeight: 600 }}>Item</Text>} style={{ marginBottom: 6 }}>
                    <Input placeholder="Item code" allowClear value={filters.item}
                      onChange={e => setFilters(f => ({ ...f, item: e.target.value }))} onPressEnter={runSearch} />
                  </Form.Item>
                </Col>
                <Col xs={12} sm={8} md={4}>
                  <Form.Item label={<Text style={{ fontSize: 11, fontWeight: 600 }}>Line Status</Text>} style={{ marginBottom: 6 }}>
                    <Select allowClear showSearch placeholder="Any" value={filters.lineStatus}
                      onChange={v => setFilters(f => ({ ...f, lineStatus: v }))}
                      options={LINE_STATUSES.map(s => ({ value: s, label: s }))} />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12} md={5}>
                  <Form.Item label={<Text style={{ fontSize: 11, fontWeight: 600 }}>Description contains</Text>} style={{ marginBottom: 6 }}>
                    <Input placeholder="e.g. FUJIFILM" allowClear value={filters.itemDesc}
                      onChange={e => setFilters(f => ({ ...f, itemDesc: e.target.value }))} onPressEnter={runSearch} />
                  </Form.Item>
                </Col>
              </Row>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <Button type="primary" size="small" icon={<SearchOutlined />} loading={loading} onClick={runSearch}
                  style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}>Search</Button>
                <Button size="small" icon={<ClearOutlined />} onClick={() => setFilters({ dateOp: '>', orgCode: undefined, lineStatus: 'Ready to release' })}>Reset</Button>
                <Tooltip title="API Inspector — shipmentLines web service">
                  <Button size="small" icon={<ApiOutlined />} style={{ marginLeft: 'auto', borderColor: REDWOOD.info, color: REDWOOD.info }}
                    onClick={() => setApiOpen(true)}>API</Button>
                </Tooltip>
              </div>
            </Form>
          </Card>

          {/* Results */}
          <Card styles={{ body: { padding: 0 } }} style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}` }}
            title={<Space><CarOutlined style={{ color: REDWOOD.primary }} /><Text strong>Shipment Lines</Text>
              {rows.length > 0 && <Tag>{filtered.length}{filtered.length !== rows.length ? ` of ${rows.length}` : ''} loaded{totalCount != null ? ` · ${new Intl.NumberFormat('en-US').format(totalCount)} total` : hasMore ? ' · more available' : ''}</Tag>}</Space>}
            extra={<Space>
              <Input placeholder="Filter any column…" allowClear size="small"
                prefix={<SearchOutlined style={{ color: REDWOOD.neutral300 }} />}
                value={filterText} onChange={e => setFilterText(e.target.value)} style={{ width: 240 }} />
              {hasMore && !loading && (
                <Button size="small" type="primary" ghost icon={<DownOutlined />} loading={fetchingMore} onClick={fetchMore}>
                  Fetch next {SEARCH_PAGE_SIZE}
                </Button>
              )}
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
              <Empty description="No shipment lines" style={{ padding: 60 }} />
            ) : (
              <>
                <Table columns={columns} dataSource={filtered} rowKey={(r, i) => `${r.ShipmentLine ?? i}`} size="small"
                  scroll={{ x: 1260 }} pagination={{ pageSize: 25, size: 'small', showSizeChanger: true, showTotal: t => `${t} lines loaded` }} />
                {hasMore && (
                  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10, padding: '10px 0 16px', borderTop: `1px solid ${REDWOOD.neutral200}` }}>
                    <Button type="primary" ghost icon={<DownOutlined />} loading={fetchingMore} onClick={fetchMore}>
                      Fetch next {SEARCH_PAGE_SIZE} records
                    </Button>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {rows.length} loaded{totalCount != null ? ` of ${new Intl.NumberFormat('en-US').format(totalCount)}` : ''}
                    </Text>
                  </div>
                )}
              </>
            )}
          </Card>
        </div>

        {/* API inspector */}
        <Modal title={<Space><ApiOutlined style={{ color: REDWOOD.info }} /> Shipment Lines API</Space>}
          open={apiOpen} onCancel={() => setApiOpen(false)} maskClosable={false} width={860}
          footer={<Button onClick={() => setApiOpen(false)}>Close</Button>}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Text style={{ fontSize: 11, fontWeight: 700, color: REDWOOD.neutral600, textTransform: 'uppercase' }}>Search shipment lines</Text>
                <Button size="small" type="text" icon={<CopyOutlined />} style={{ marginLeft: 'auto' }}
                  onClick={() => { navigator.clipboard.writeText(decodeURIComponent(searchUrl)); message.success('Copied'); }}>Copy</Button>
              </div>
              <div style={{ marginTop: 4, padding: '8px 12px', borderRadius: 6, background: REDWOOD.neutral100, border: `1px solid ${REDWOOD.neutral200}`, fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all', color: REDWOOD.info }}>
                <Tag color="blue">GET</Tag>{decodeURIComponent(searchUrl)}
              </div>
            </div>
            <Text type="secondary" style={{ fontSize: 11 }}>Dates are unquoted (CreationDate&gt;2026-07-25); text uses SQL LIKE. Auth: Basic [{getFusionInstance().username}]. Search fetches {SEARCH_PAGE_SIZE} records per request (&amp;limit={SEARCH_PAGE_SIZE}&amp;offset=N) — the Fetch Next button appends the following page. totalResults is intentionally NOT requested (counting the full set is slow).</Text>
          </div>
        </Modal>

        {/* Full-detail modal — remaining fields, null & id columns hidden */}
        <Modal
          title={<Space><ProfileOutlined style={{ color: REDWOOD.info }} /> Shipment Line {detail?.ShipmentLine} — all fields</Space>}
          open={!!detail} onCancel={() => setDetail(null)} maskClosable={false} width={900}
          footer={<Button onClick={() => setDetail(null)}>Close</Button>}>
          {detail && (() => {
            const entries = Object.entries(detail).filter(([k, v]) => !isHiddenKey(k) && !isEmpty(v));
            const LV: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
              <Col xs={24} sm={12} md={8}>
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: REDWOOD.neutral600, textTransform: 'uppercase', letterSpacing: '0.03em' }}>{label}</div>
                  <div style={{ fontSize: 12, color: REDWOOD.neutral900, marginTop: 2, wordBreak: 'break-word' }}>{value}</div>
                </div>
              </Col>
            );
            return (
              <div style={{ maxHeight: '65vh', overflowY: 'auto' }}>
                <Row gutter={[12, 0]}>
                  {entries.map(([k, v]) => (
                    <LV key={k} label={k.replace(/([A-Z])/g, ' $1').replace(/^ /, '')} value={
                      typeof v === 'boolean' ? (v ? 'Yes' : 'No')
                        : typeof v === 'object' ? JSON.stringify(v)
                        : /Date$/.test(k) || k.endsWith('DateTime') ? fmtDateTime(String(v))
                        : String(v)
                    } />
                  ))}
                </Row>
              </div>
            );
          })()}
        </Modal>

        {/* Order dialog — Lines tab + one tab per child link */}
        <ShipmentOrderDialog row={orderDialog} onClose={() => setOrderDialog(null)} />
      </Content>
    </Layout>
  );
};

export default ManageShipmentLines;
