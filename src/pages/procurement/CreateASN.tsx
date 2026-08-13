import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  Layout, Typography, Card, Table, Button, Form, Input, Space, Tag,
  Tooltip, Row, Col, DatePicker, InputNumber, Modal, message, Divider,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import {
  HomeOutlined, CarOutlined, SearchOutlined, ClearOutlined, ApiOutlined,
  SendOutlined, CheckCircleTwoTone, CloseCircleTwoTone,
  ClockCircleOutlined, InboxOutlined,
} from '@ant-design/icons';
import { Link, useSearchParams } from 'react-router-dom';
import { FUSION_POD_HOST, FUSION_POD_AUTH } from '../../config/fusionInstance';

const { Content } = Layout;
const { Title, Text } = Typography;

// ── Palette ───────────────────────────────────────────────────────────────────
const REDWOOD = {
  primary: '#C74634', primaryDark: '#A33B2C',
  teal: '#00918A', tealDark: '#007A74',
  success: '#1D7B4D', warning: '#B07700', info: '#0572CE', error: '#D93025',
  neutral100: '#F7F7F7', neutral200: '#E5E5E5', neutral300: '#C7C7C7',
  neutral600: '#6B6B6B', neutral900: '#1A1A1A', surface: '#FFFFFF',
};

// ── API ───────────────────────────────────────────────────────────────────────
// In Electron the request goes directly (no CORS). In a browser (dev) it routes
// through the Vite proxy. Mirrors ManageExpectedReceipts.
const FUSION_BASE = `${FUSION_POD_HOST}/fscmRestApi/resources/11.13.18.05`;
const AUTH_HEADER = FUSION_POD_AUTH;
const FUSION_HDRS = { Authorization: AUTH_HEADER, Accept: 'application/json' };

// ASN request source code. This pod uses 'VENDOR' (same value the receiving flow
// in ManageExpectedReceipts posts). Older pods use 'SUPPLIER'.
const RECEIPT_SOURCE_CODE = 'VENDOR';
const ASN_ENDPOINT = `${FUSION_BASE}/receivingReceiptRequests`;

// ── Types ─────────────────────────────────────────────────────────────────────
// linesToReceive rows carry every field we need to build an ASN line.
interface POLine {
  DocumentLineId?: number;
  POHeaderId?: number | string;
  POLineLocationId?: number | string;
  DocumentNumber?: string;
  DocumentLineNumber?: number;
  DocumentScheduleNumber?: number;
  ASNNumber?: string;          // populated once an ASN has been created for the line
  ItemNumber?: string;
  ItemDescription?: string;
  ToOrganizationCode?: string;
  VendorName?: string;
  VendorSiteCode?: string;
  SourceDocumentCode?: string;
  ShipToLocation?: string;
  AvailableQuantity?: number;
  OrderedQuantity?: number;
  UOMCode?: string;
  UnitOfMeasure?: string;
  DueDate?: string;
  CurrencyCode?: string;
  [key: string]: unknown;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const numFmt = (v: any) =>
  v == null || v === '' || isNaN(Number(v)) ? '—'
    : new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(Number(v));

// A fresh, reasonably-unique default ASN/shipment number.
const defaultShipmentNumber = () => `ASN${dayjs().format('YYMMDDHHmm')}`;

const lineKey = (l: POLine) => String(l.DocumentLineId ?? `${l.DocumentNumber}-${l.DocumentLineNumber}-${l.DocumentScheduleNumber}`);

// Fusion HATEOAS links are absolute URLs. Re-point them at the selected POD's
// FUSION_BASE so links always target the current instance (direct call).
const proxied = (href: string) =>
  href.replace(/^https?:\/\/[^/]+\/fscmRestApi\/resources\/11\.13\.18\.05/i, FUSION_BASE);

// Follow the processingErrors child link on each ASN line and collect the
// human-readable error messages Fusion recorded during derive/validate.
async function fetchProcessingErrors(headerId: string | number): Promise<string[]> {
  const out: string[] = [];
  try {
    const r = await fetch(`${ASN_ENDPOINT}/${headerId}?expand=lines`, { headers: FUSION_HDRS });
    const d = await r.json();
    const lines: any[] = d?.lines?.items ?? d?.lines ?? [];
    for (const ln of lines) {
      const link = (ln?.links ?? []).find((l: any) => l?.name === 'processingErrors');
      if (!link?.href) continue;
      try {
        const pr = await fetch(proxied(link.href), { headers: FUSION_HDRS });
        const pd = await pr.json();
        (pd?.items ?? []).forEach((it: any) => {
          const msg = it?.ErrorMessage ?? it?.Message ?? it?.ErrorMessageText ?? it?.ErrorMessageName;
          if (msg) out.push(String(msg));
        });
      } catch { /* skip this line's errors */ }
    }
  } catch { /* header re-read failed */ }
  return out;
}

// Pull all PO lines available to ship (paged).
async function fetchLinesToReceive(q: string): Promise<POLine[]> {
  const qParam = q ? `q=${encodeURIComponent(q)}&` : '';
  const all: POLine[] = [];
  let offset = 0;
  while (true) {
    const url = `${FUSION_BASE}/linesToReceive?${qParam}limit=500&offset=${offset}`;
    const res = await fetch(url, { headers: FUSION_HDRS });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const data = await res.json();
    const items: POLine[] = data.items ?? [];
    all.push(...items);
    if (items.length < 500) break;
    offset += 500;
  }
  return all;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Page
// ═══════════════════════════════════════════════════════════════════════════════
const CreateASN: React.FC = () => {
  const [form] = Form.useForm();

  // Query state
  const [lines, setLines]       = useState<POLine[]>([]);
  const [loading, setLoading]   = useState(false);
  const [err, setErr]           = useState('');
  const [ran, setRan]           = useState(false);

  // Per-line ship quantities and selection
  const [shipQty, setShipQty]         = useState<Record<string, number>>({});
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);

  // ASN header form state
  const [shipmentNumber, setShipmentNumber] = useState(defaultShipmentNumber());
  const [shipmentDate, setShipmentDate]     = useState<any>(dayjs().subtract(1, 'day')); // must be before today
  const [expectedDate, setExpectedDate]     = useState<any>(dayjs().add(3, 'day'));
  const [billOfLading, setBillOfLading]     = useState('');
  const [packingSlip, setPackingSlip]       = useState('');
  const [carrier, setCarrier]               = useState('');
  const [numContainers, setNumContainers]   = useState<number | null>(null);
  const [comments, setComments]             = useState('');

  // Details dialog + inspector + submit state
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [inspectOpen, setInspectOpen] = useState(false);
  const [submitting, setSubmitting]   = useState(false);
  const [result, setResult]           = useState<null | {
    ok: boolean; http: number; status: string; headerId?: string | number; message: string; body: string;
  }>(null);
  const [procErrors, setProcErrors]   = useState<string[]>([]);

  const buildQuery = (po: string, org: string): string => {
    const parts: string[] = [];
    if (po.trim())  parts.push(`DocumentNumber='${po.trim()}'`);
    if (org.trim()) parts.push(`ToOrganizationCode='${org.trim()}'`);
    return parts.join(';');
  };

  const search = useCallback(async () => {
    const { po = '', org = '' } = form.getFieldsValue();
    if (!po.trim() && !org.trim()) { message.warning('Enter a PO number (or organization) to search'); return; }
    setLoading(true); setErr(''); setRan(true); setResult(null);
    try {
      const fetched = await fetchLinesToReceive(buildQuery(po, org));
      // Omit lines that already have an ASN — those are already shipped/noticed.
      const rows = fetched.filter(l => !String(l.ASNNumber ?? '').trim());
      setLines(rows);
      // Default each line's ship qty to the quantity still available to receive.
      const q: Record<string, number> = {};
      rows.forEach(l => { q[lineKey(l)] = Number(l.AvailableQuantity ?? l.OrderedQuantity ?? 0) || 0; });
      setShipQty(q);
      setSelectedKeys([]);
      if (rows.length === 0) message.info('No PO lines available to ship for these criteria');
    } catch (e: any) {
      setErr(e.message); setLines([]);
    } finally { setLoading(false); }
  }, [form]);

  // Pre-fill + auto-search when arriving with ?po=<number> (from the PO search page).
  const [urlParams] = useSearchParams();
  useEffect(() => {
    const po = urlParams.get('po');
    if (po) { form.setFieldsValue({ po }); search(); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const reset = () => {
    form.resetFields();
    setLines([]); setShipQty({}); setSelectedKeys([]); setRan(false); setErr(''); setResult(null);
    setShipmentNumber(defaultShipmentNumber());
  };

  const selectedLines = useMemo(
    () => lines.filter(l => selectedKeys.includes(lineKey(l))),
    [lines, selectedKeys]);

  // The single receivingReceiptRequests body: one ASN header + N SHIP lines.
  const asnBody = useMemo(() => {
    const first = selectedLines[0];
    const header: Record<string, any> = {
      ReceiptSourceCode: RECEIPT_SOURCE_CODE,
      OrganizationCode:  first?.ToOrganizationCode ?? '',
      ASNType:           'ASN',
      ShipmentNumber:    shipmentNumber.trim(),
      VendorName:        first?.VendorName ?? '',
    };
    if (first?.VendorSiteCode) header.VendorSiteCode = first.VendorSiteCode;
    if (shipmentDate)  header.ShippedDate         = dayjs(shipmentDate).format('YYYY-MM-DD');
    if (expectedDate)  header.ExpectedReceiptDate = dayjs(expectedDate).format('YYYY-MM-DD');
    if (billOfLading.trim()) header.BillOfLading      = billOfLading.trim();
    if (packingSlip.trim())  header.PackingSlip       = packingSlip.trim();
    if (carrier.trim())      header.FreightCarrierName = carrier.trim();
    if (numContainers != null) header.NumberOfContainers = numContainers;
    if (comments.trim())     header.Comments          = comments.trim();

    header.lines = selectedLines.map(l => ({
      ReceiptSourceCode:      RECEIPT_SOURCE_CODE,
      SourceDocumentCode:     'PO',
      TransactionType:        'SHIP',
      AutoTransactCode:       'SHIP',
      OrganizationCode:       l.ToOrganizationCode ?? '',
      DocumentNumber:         l.DocumentNumber ?? '',
      DocumentLineNumber:     String(l.DocumentLineNumber ?? ''),
      ItemNumber:             l.ItemNumber ?? '',
      Quantity:               shipQty[lineKey(l)] ?? 0,
      UnitOfMeasure:          l.UnitOfMeasure ?? l.UOMCode ?? '',
      ShipmentNumber:         shipmentNumber.trim(),
    }));
    return header;
  }, [selectedLines, shipmentNumber, shipmentDate, expectedDate, billOfLading, packingSlip, carrier, numContainers, comments, shipQty]);

  const validateBeforeSubmit = (): string | null => {
    if (selectedLines.length === 0) return 'Select at least one PO line to ship.';
    if (!shipmentNumber.trim())     return 'Enter a Shipment (ASN) number.';
    if (!shipmentDate)              return 'Enter a shipment date (before today).';
    if (!dayjs(shipmentDate).isBefore(dayjs().startOf('day')))
      return 'Shipment date must be before today.';
    const badQty = selectedLines.find(l => !(Number(shipQty[lineKey(l)]) > 0));
    if (badQty) return `Enter a ship quantity greater than 0 for item ${badQty.ItemNumber ?? ''}.`;
    const orgs = new Set(selectedLines.map(l => l.ToOrganizationCode));
    if (orgs.size > 1) return 'All lines on one ASN must share the same receiving organization. Deselect lines from other orgs.';
    return null;
  };

  // Open the ASN details dialog once lines are selected.
  const openDetails = () => {
    if (selectedLines.length === 0) { message.warning('Select at least one PO line to ship'); return; }
    setResult(null);
    setDetailsOpen(true);
  };

  const openInspect = () => {
    const v = validateBeforeSubmit();
    if (v) { message.error(v); return; }
    setInspectOpen(true);
  };

  // POST the ASN, then read ProcessingStatusCode. A 201 only means "landed in the
  // interface" — Fusion validates asynchronously, so poll until PENDING resolves.
  // SUCCESS → refresh the lines; ERROR → surface ReturnMessage + processingErrors.
  const submitAsn = async () => {
    const v = validateBeforeSubmit();
    if (v) { message.error(v); return; }
    setSubmitting(true); setResult(null); setProcErrors([]);
    try {
      const res = await fetch(ASN_ENDPOINT, {
        method: 'POST',
        headers: { ...FUSION_HDRS, 'Content-Type': 'application/json' },
        body: JSON.stringify(asnBody),
      });
      const text = await res.text();
      let data: any = null, pretty = text;
      try { data = JSON.parse(text); pretty = JSON.stringify(data, null, 2); } catch { /* not json */ }

      const headerId = data?.HeaderInterfaceId ?? data?.headerInterfaceId;

      // Transport-level failure (no interface record created).
      if (!res.ok) {
        const msg = data?.ReturnMessage ?? data?.returnMessage ?? data?.detail ?? data?.title ?? `HTTP ${res.status}`;
        setResult({ ok: false, http: res.status, status: 'ERROR', headerId, message: String(msg), body: pretty });
        setSubmitting(false);
        return;
      }

      // Read ProcessingStatusCode; poll the header while still PENDING.
      let pStatus = String(data?.ProcessingStatusCode ?? 'PENDING').toUpperCase();
      let retMsg  = data?.ReturnMessage ?? data?.returnMessage ?? '';
      let pollBody = pretty;
      if (headerId != null) {
        for (let i = 0; i < 8 && pStatus === 'PENDING'; i++) {
          await new Promise(r => setTimeout(r, 2000));
          try {
            const pr = await fetch(`${ASN_ENDPOINT}/${headerId}`, { headers: FUSION_HDRS });
            const pd = await pr.json();
            pStatus = String(pd?.ProcessingStatusCode ?? pStatus).toUpperCase();
            retMsg  = pd?.ReturnMessage ?? retMsg;
            pollBody = JSON.stringify(pd, null, 2);
          } catch { /* keep polling */ }
        }
      }

      if (pStatus === 'SUCCESS') {
        setResult({ ok: true, http: res.status, status: 'SUCCESS', headerId, message: 'ASN created successfully.', body: pollBody });
        message.success(`ASN ${shipmentNumber} created${headerId ? ` · Hdr ${headerId}` : ''}`);
        setInspectOpen(false);
        setDetailsOpen(false);
        // Refresh so the just-shipped lines drop off (they now carry an ASN).
        await search();
      } else if (pStatus === 'ERROR') {
        const errs = headerId != null ? await fetchProcessingErrors(headerId) : [];
        setProcErrors(errs);
        setResult({
          ok: false, http: res.status, status: 'ERROR', headerId,
          message: retMsg || 'The receiving transactions couldn’t be processed.',
          body: pollBody,
        });
        message.error('ASN processing failed — see the errors below.');
      } else {
        // Still PENDING after polling — treat as submitted-but-not-yet-confirmed.
        setResult({
          ok: true, http: res.status, status: pStatus || 'PENDING', headerId,
          message: 'ASN submitted — still processing in Fusion (PENDING). Check Manage Inbound Shipments shortly.',
          body: pollBody,
        });
        message.success(`ASN ${shipmentNumber} submitted${headerId ? ` · Hdr ${headerId}` : ''}`);
        setInspectOpen(false);
        setDetailsOpen(false);
      }
    } catch (e: any) {
      setResult({ ok: false, http: 0, status: 'ERROR', message: e?.message ?? 'Network error', body: e?.message ?? '' });
    } finally { setSubmitting(false); }
  };

  const cols: ColumnsType<POLine> = [
    { title: 'PO #',       dataIndex: 'DocumentNumber', width: 130, fixed: 'left' as const, ellipsis: true,
      render: (v) => <Text strong style={{ fontSize: 12 }}>{v || '—'}</Text> },
    { title: 'Line',       dataIndex: 'DocumentLineNumber', width: 60, align: 'center' as const },
    { title: 'Sched',      dataIndex: 'DocumentScheduleNumber', width: 60, align: 'center' as const },
    { title: 'Item',       dataIndex: 'ItemNumber', width: 150, ellipsis: true,
      render: (v) => <Text style={{ fontSize: 12 }}>{v || '—'}</Text> },
    { title: 'Description', dataIndex: 'ItemDescription', width: 200, ellipsis: true,
      render: (v) => <Text type="secondary" style={{ fontSize: 12 }}>{v || '—'}</Text> },
    { title: 'Org',        dataIndex: 'ToOrganizationCode', width: 90 },
    { title: 'Supplier',   dataIndex: 'VendorName', width: 170, ellipsis: true,
      render: (v) => <Text style={{ fontSize: 12 }}>{v || '—'}</Text> },
    { title: 'Ordered',    dataIndex: 'OrderedQuantity', width: 90, align: 'right' as const,
      render: (v) => <Text style={{ fontFamily: 'monospace', fontSize: 12 }}>{numFmt(v)}</Text> },
    { title: 'Available',  dataIndex: 'AvailableQuantity', width: 95, align: 'right' as const,
      render: (v) => <Text style={{ fontFamily: 'monospace', fontSize: 12, color: Number(v) > 0 ? REDWOOD.success : undefined }}>{numFmt(v)}</Text> },
    { title: 'UOM',        dataIndex: 'UnitOfMeasure', width: 90, ellipsis: true,
      render: (v, r) => <Text style={{ fontSize: 12 }}>{v || r.UOMCode || '—'}</Text> },
    { title: 'Ship Qty',   key: 'shipQty', width: 120, fixed: 'right' as const,
      render: (_: any, r: POLine) => {
        const k = lineKey(r);
        const max = Number(r.AvailableQuantity ?? r.OrderedQuantity ?? undefined);
        return (
          <InputNumber
            size="small" min={0} max={isNaN(max) ? undefined : max} style={{ width: '100%' }}
            value={shipQty[k]} onChange={(val) => setShipQty(prev => ({ ...prev, [k]: Number(val) || 0 }))}
            onClick={(e) => e.stopPropagation()}
          />
        );
      } },
  ];

  const asnHeaderField = (label: string, node: React.ReactNode, span = 6) => (
    <Col xs={24} sm={12} md={span}>
      <div style={{ marginBottom: 12 }}>
        <Text style={{ fontSize: 12, color: REDWOOD.neutral600, display: 'block', marginBottom: 4 }}>{label}</Text>
        {node}
      </div>
    </Col>
  );

  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
      <Content>
        {/* Breadcrumb */}
        <div style={{ padding: '10px 24px', background: REDWOOD.surface, borderBottom: `1px solid ${REDWOOD.neutral200}` }}>
          <Space>
            <Link to="/home"><HomeOutlined /> Home</Link>
            <Text type="secondary">/</Text>
            <Link to="/procurement">Fusion Supply Chain</Link>
            <Text type="secondary">/</Text>
            <Text>Create ASN</Text>
          </Space>
        </div>

        <div style={{ padding: 20 }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <div style={{
              width: 44, height: 44, borderRadius: 10,
              background: `linear-gradient(135deg, ${REDWOOD.info} 0%, #045aa2 100%)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: `0 4px 14px ${REDWOOD.info}40`,
            }}>
              <CarOutlined style={{ fontSize: 22, color: '#fff' }} />
            </div>
            <div>
              <Title level={3} style={{ margin: 0, color: REDWOOD.neutral900 }}>Create ASN</Title>
              <Text type="secondary">Query a purchase order and create an Advance Shipment Notice (receivingReceiptRequests)</Text>
            </div>
          </div>

          {/* Search form */}
          <Card size="small" style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}`, marginBottom: 14 }} styles={{ body: { padding: '14px 16px 2px' } }}>
            <Form form={form} layout="vertical" onFinish={search}>
              <Row gutter={12}>
                <Col xs={24} sm={12} md={7}>
                  <Form.Item name="po" label="Purchase Order #" style={{ marginBottom: 12 }}>
                    <Input allowClear placeholder="e.g. 2026020095" onPressEnter={search} />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12} md={5}>
                  <Form.Item name="org" label="Receiving Org (optional)" style={{ marginBottom: 12 }}>
                    <Input allowClear placeholder="e.g. AMS_B2B_GHANA" onPressEnter={search} />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12} md={6}>
                  <Form.Item label=" " style={{ marginBottom: 12 }}>
                    <Space size={4}>
                      <Button type="primary" htmlType="submit" icon={<SearchOutlined />} loading={loading}
                        style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}>Search</Button>
                      <Button icon={<ClearOutlined />} onClick={reset} />
                      <Tooltip
                        title={<span style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}>
                          GET {FUSION_BASE}/linesToReceive?q={buildQuery(form.getFieldValue('po') || '', form.getFieldValue('org') || '') || "DocumentNumber='…'"}
                        </span>} placement="bottomRight">
                        <ApiOutlined style={{ color: REDWOOD.info, cursor: 'pointer', fontSize: 16 }} />
                      </Tooltip>
                    </Space>
                  </Form.Item>
                </Col>
              </Row>
            </Form>
          </Card>

          {err && <div style={{ color: REDWOOD.error, fontSize: 12, marginBottom: 10 }}>Failed to load: {err}</div>}

          {/* PO lines available to ship */}
          <Card size="small"
            title={<Space><InboxOutlined style={{ color: REDWOOD.teal }} /><span style={{ fontSize: 13 }}>PO Lines Available to Ship</span>{lines.length > 0 && <Tag color="blue">{lines.length}</Tag>}</Space>}
            extra={
              <Space>
                {result && (
                  result.ok
                    ? <Tag icon={<CheckCircleTwoTone twoToneColor={REDWOOD.success} />} color="success">{result.status}{result.headerId ? ` · Hdr ${result.headerId}` : ''}</Tag>
                    : <Tag icon={<CloseCircleTwoTone twoToneColor={REDWOOD.error} />} color="error">{result.status}</Tag>
                )}
                <Button type="primary" icon={<SendOutlined />} disabled={selectedLines.length === 0} onClick={openDetails}
                  style={selectedLines.length === 0 ? undefined : { background: REDWOOD.info, borderColor: REDWOOD.info }}>
                  Create ASN{selectedLines.length ? ` (${selectedLines.length})` : ''}
                </Button>
              </Space>
            }
            style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}`, marginBottom: 14 }} styles={{ body: { padding: 0 } }}>
            <Table
              rowKey={lineKey}
              dataSource={lines}
              columns={cols}
              loading={loading}
              size="small"
              scroll={{ x: 'max-content' }}
              rowSelection={{
                selectedRowKeys: selectedKeys,
                onChange: setSelectedKeys,
                getCheckboxProps: (r) => ({ disabled: !(Number(r.AvailableQuantity ?? r.OrderedQuantity ?? 0) > 0) }),
              }}
              pagination={{ pageSize: 25, showSizeChanger: true, pageSizeOptions: ['25', '50', '100'], showTotal: (t) => `${t} line(s)` }}
              locale={{ emptyText: loading ? 'Loading…' : (ran ? (err ? 'Error' : 'No PO lines available to ship') : 'Search a purchase order above') }}
            />
          </Card>

        </div>

        {/* ASN / Shipment Details dialog — opened from the Create ASN button */}
        <Modal
          open={detailsOpen}
          onCancel={() => { if (!submitting) setDetailsOpen(false); }}
          width={780}
          title={<Space><CarOutlined style={{ color: REDWOOD.info }} /><span>ASN / Shipment Details</span>
            <Tag color="geekblue">{selectedLines.length} line(s) selected</Tag></Space>}
          footer={[
            <Button key="close" disabled={submitting} onClick={() => setDetailsOpen(false)}>Close</Button>,
            <Button key="inspect" icon={<ApiOutlined />} onClick={openInspect}>Inspect Request</Button>,
            <Button key="create" type="primary" icon={<SendOutlined />} loading={submitting} onClick={submitAsn}
              style={{ background: REDWOOD.info, borderColor: REDWOOD.info }}>Create</Button>,
          ]}
        >
          <Row gutter={12}>
            {asnHeaderField('Shipment (ASN) Number *',
              <Input value={shipmentNumber} onChange={e => setShipmentNumber(e.target.value)} placeholder="ASN number" />)}
            {asnHeaderField('Shipment Date (before today) *',
              <DatePicker value={shipmentDate} onChange={setShipmentDate} format="YYYY-MM-DD" style={{ width: '100%' }}
                disabledDate={(d) => !!d && !d.isBefore(dayjs().startOf('day'))} />)}
            {asnHeaderField('Expected Receipt Date',
              <DatePicker value={expectedDate} onChange={setExpectedDate} format="YYYY-MM-DD" style={{ width: '100%' }} />)}
            {asnHeaderField('Freight Carrier',
              <Input value={carrier} onChange={e => setCarrier(e.target.value)} placeholder="e.g. DHL" />)}
            {asnHeaderField('Bill of Lading',
              <Input value={billOfLading} onChange={e => setBillOfLading(e.target.value)} placeholder="BOL #" />)}
            {asnHeaderField('Packing Slip',
              <Input value={packingSlip} onChange={e => setPackingSlip(e.target.value)} placeholder="Packing slip #" />)}
            {asnHeaderField('# Containers',
              <InputNumber value={numContainers} onChange={(v) => setNumContainers(v as number)} min={0} style={{ width: '100%' }} placeholder="0" />)}
            {asnHeaderField('Comments',
              <Input value={comments} onChange={e => setComments(e.target.value)} placeholder="Optional" />)}
          </Row>
          {result && !result.ok && (
            <div style={{ marginTop: 8, background: '#FFF1F0', border: '1px solid #FFCCC7', borderRadius: 6, padding: '10px 12px' }}>
              <div style={{ marginBottom: procErrors.length ? 8 : 0 }}>
                <Tag icon={<CloseCircleTwoTone twoToneColor={REDWOOD.error} />} color="error">{result.status}</Tag>
                <Text type="danger" style={{ fontSize: 12 }}>{result.message}</Text>
              </div>
              {procErrors.length > 0 && (
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {procErrors.map((e, i) => (
                    <li key={i}><Text style={{ fontSize: 12, color: REDWOOD.error }}>{e}</Text></li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Modal>

        {/* API Inspector — the exact POST that will be sent */}
        <Modal
          open={inspectOpen}
          onCancel={() => setInspectOpen(false)}
          width={720}
          title={<Space><ApiOutlined style={{ color: REDWOOD.info }} /><span>Create ASN — Request Preview</span></Space>}
          footer={[
            <Button key="close" onClick={() => setInspectOpen(false)}>Close</Button>,
            <Button key="submit" type="primary" icon={<SendOutlined />} loading={submitting} onClick={submitAsn}
              style={{ background: REDWOOD.info, borderColor: REDWOOD.info }}>Create ASN</Button>,
          ]}
        >
          <div style={{ marginBottom: 10 }}>
            <Tag color="green">POST</Tag>
            <Text style={{ fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all' }}>{ASN_ENDPOINT}</Text>
          </div>
          <div style={{ marginBottom: 6 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              ASN marker → header <Text code>ASNType: "ASN"</Text> + <Text code>ShipmentNumber</Text>; each line{' '}
              <Text code>TransactionType: "SHIP"</Text>, <Text code>AutoTransactCode: "SHIP"</Text>,{' '}
              <Text code>SourceDocumentCode: "PO"</Text>.
            </Text>
          </div>
          <pre style={{
            background: REDWOOD.neutral100, border: `1px solid ${REDWOOD.neutral200}`, borderRadius: 6,
            padding: 12, fontSize: 12, maxHeight: 360, overflow: 'auto', margin: 0,
          }}>{JSON.stringify(asnBody, null, 2)}</pre>
          <div style={{ marginTop: 10 }}>
            <Text type="secondary" style={{ fontSize: 11 }}>
              <ClockCircleOutlined /> A 201 means the request landed in the receiving interface as PENDING — it is then
              validated asynchronously. This screen polls <Text code>HeaderInterfaceId</Text> for the final
              <Text code>ProcessingStatusCode</Text> (SUCCESS / ERROR).
            </Text>
          </div>

          {result && (
            <>
              <Divider style={{ margin: '12px 0' }} />
              <div style={{ marginBottom: 6 }}>
                <Text strong style={{ fontSize: 12 }}>Response </Text>
                {result.ok
                  ? <Tag color="success">{result.status}</Tag>
                  : <Tag color="error">{result.status} · HTTP {result.http}</Tag>}
              </div>
              <pre style={{
                background: REDWOOD.neutral100, border: `1px solid ${REDWOOD.neutral200}`, borderRadius: 6,
                padding: 12, fontSize: 11, maxHeight: 220, overflow: 'auto', margin: 0,
              }}>{result.body}</pre>
            </>
          )}
        </Modal>
      </Content>
    </Layout>
  );
};

export default CreateASN;
