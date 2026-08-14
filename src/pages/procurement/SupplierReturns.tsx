import { getFusionAuthHeaders } from '../../config/api.helper';
import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  Layout, Breadcrumb, Card, Table, Button, Tag, Typography, Space, Tooltip, Spin,
  Row, Col, message, Modal, Empty, Select, Input, InputNumber, Alert,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  HomeOutlined, RollbackOutlined, SearchOutlined, ApiOutlined, ReloadOutlined,
  CheckCircleTwoTone, CloseCircleTwoTone,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
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
const JSON_HDRS = { ...getHeaders(), 'Content-Type': 'application/json' };
const PO_URL = `${FUSION_BASE}/purchaseOrders`;
const RECEIVE_URL = `${FUSION_BASE}/receivingReceiptRequests`;

const REDWOOD = {
  primary: '#C74634', success: '#1D7B4D', warning: '#B07700', info: '#0572CE',
  error: '#D93025', teal: '#00918A', purple: '#7245A6',
  neutral100: '#F7F7F7', neutral200: '#E5E5E5', neutral600: '#6B6B6B', neutral900: '#1A1A1A',
};
const pf = (o: any, keys: string[]) => { for (const k of keys) { if (o?.[k] != null && o[k] !== '') return o[k]; } return undefined; };
const num = (v: any) => { const n = Number(v); return isNaN(n) ? 0 : n; };
const fmtQty = (v: any) => v == null || isNaN(Number(v)) ? '—' : new Intl.NumberFormat('en-US').format(Number(v));
const errOf = (data: any, text: string) => data?.['o:errorDetails']?.[0]?.detail ?? data?.detail ?? data?.message ?? (text || '').slice(0, 300);

interface OrgOpt { code: string; name: string; }
interface RetLine {
  key: string; po: string; lineNum: any; schedNum: any; item: string; description: string;
  org: string; uom: string; ordered: number; received: number; vendor: string;
  returnQty: number; subinventory: string; receiptNumber: string; reason: string;
  status?: 'pending' | 'ok' | 'error'; message?: string;
}

const SupplierReturns: React.FC = () => {
  const [orgs, setOrgs] = useState<OrgOpt[]>([]);
  const [org, setOrg] = useState<string | undefined>();
  const [poNum, setPoNum] = useState('');
  const [lines, setLines] = useState<RetLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [lastUrl, setLastUrl] = useState('');
  const [subinvs, setSubinvs] = useState<string[]>([]);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${FUSION_BASE}/inventoryOrganizations?onlyData=true&limit=500&fields=OrganizationCode,OrganizationName`, { headers: getHeaders() });
        const d = r.ok ? await r.json() : { items: [] };
        setOrgs((d.items ?? []).map((o: any) => ({ code: o.OrganizationCode, name: o.OrganizationName ?? '' })).filter((o: OrgOpt) => o.code).sort((a: OrgOpt, b: OrgOpt) => a.code.localeCompare(b.code)));
      } catch { setOrgs([]); }
    })();
  }, []);

  useEffect(() => {
    if (!org) { setSubinvs([]); return; }
    fetch(`${FUSION_BASE}/subinventories?q=OrganizationCode=${encodeURIComponent(org)}&onlyData=true&limit=500`, { headers: getHeaders() })
      .then(r => r.ok ? r.json() : { items: [] })
      .then(d => setSubinvs(Array.from(new Set((d.items ?? []).map((i: any) => i.SecondaryInventoryName).filter(Boolean))) as string[]))
      .catch(() => setSubinvs([]));
  }, [org]);

  const upd = (key: string, patch: Partial<RetLine>) => setLines(prev => prev.map(l => l.key === key ? { ...l, ...patch } : l));

  // Find the PO's received schedules (QuantityReceived > 0) — those are returnable.
  const search = useCallback(async () => {
    if (!poNum.trim()) { message.warning('Enter a PO number'); return; }
    setLoading(true); setErr(''); setLines([]);
    const url = `${PO_URL}?q=OrderNumber=${encodeURIComponent(poNum.trim())}&onlyData=true&limit=5&expand=lines.schedules`;
    setLastUrl(url);
    try {
      const r = await fetch(url, { headers: getHeaders() });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      const po = (d.items ?? [])[0];
      if (!po) { setErr('PO not found'); setLoading(false); return; }
      const vendor = pf(po, ['Supplier', 'SupplierName']) ?? '';
      const poNumber = pf(po, ['OrderNumber']) ?? poNum.trim();
      const out: RetLine[] = [];
      for (const line of (po.lines?.items ?? po.lines ?? [])) {
        const item = pf(line, ['Item', 'ItemNumber']) ?? '';
        const desc = pf(line, ['Description', 'ItemDescription']) ?? '';
        const uom = pf(line, ['UOM', 'UOMCode', 'UnitOfMeasure']) ?? '';
        for (const s of (line.schedules?.items ?? line.schedules ?? [])) {
          const received = num(pf(s, ['QuantityReceived', 'ReceivedQuantity']));
          if (received <= 0) continue;
          const sOrg = pf(s, ['DestinationOrganizationCode', 'ShipToOrganizationCode', 'ReceivingOrganizationCode']) ?? org ?? '';
          out.push({
            key: `${pf(line, ['LineNumber']) ?? line.POLineId}-${pf(s, ['ScheduleNumber']) ?? s.LineLocationId}`,
            po: poNumber, lineNum: pf(line, ['LineNumber']), schedNum: pf(s, ['ScheduleNumber']),
            item, description: desc, org: sOrg, uom,
            ordered: num(pf(s, ['Quantity', 'OrderedQuantity'])), received, vendor,
            returnQty: received, subinventory: '', receiptNumber: '', reason: '',
          });
        }
      }
      if (!out.length) setErr('No received quantities found on this PO — nothing to return');
      if (org && !out.some(l => l.org === org)) { /* keep results, org may differ */ }
      setLines(out);
      if (out.length && !org) setOrg(out[0].org);
    } catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setLoading(false); }
  }, [poNum, org]);

  const buildBody = (l: RetLine) => ({
    ReceiptSourceCode: 'VENDOR',
    OrganizationCode: l.org,
    VendorName: l.vendor || undefined,
    lines: [{
      TransactionType: 'RETURN TO VENDOR',
      SourceDocumentCode: 'PO',
      DocumentNumber: l.po,
      DocumentLineNumber: l.lineNum != null ? String(l.lineNum) : undefined,
      ItemNumber: l.item,
      OrganizationCode: l.org,
      Quantity: num(l.returnQty),
      UnitOfMeasure: l.uom || undefined,
      ...(l.subinventory ? { Subinventory: l.subinventory } : {}),
      ...(l.receiptNumber.trim() ? { ReceiptNumber: l.receiptNumber.trim() } : {}),
      ...(l.reason.trim() ? { ReasonName: l.reason.trim() } : {}),
    }],
  });

  const postReturns = async () => {
    const targets = lines.filter(l => num(l.returnQty) > 0 && !l.status);
    if (!targets.length) { message.warning('Set a return quantity on at least one line'); return; }
    setPosting(true);
    for (const l of targets) {
      upd(l.key, { status: 'pending' });
      try {
        const r = await fetch(RECEIVE_URL, { method: 'POST', headers: JSON_HDRS, body: JSON.stringify(buildBody(l)) });
        const txt = await r.text(); let d: any = null; try { d = JSON.parse(txt); } catch { /* raw */ }
        upd(l.key, r.ok ? { status: 'ok', message: `Return #${d?.HeaderInterfaceId ?? d?.ReceiptNumber ?? ''}` } : { status: 'error', message: errOf(d, txt) });
      } catch (e: any) { upd(l.key, { status: 'error', message: e?.message ?? String(e) }); }
    }
    setPosting(false);
    message.success('Done — see per-line status');
  };

  const cols: ColumnsType<RetLine> = [
    { title: 'Line/Sch', width: 80, render: (_, r) => `${r.lineNum ?? '—'}.${r.schedNum ?? '—'}` },
    { title: 'Item', dataIndex: 'item', width: 160, render: v => <Text strong>{v}</Text> },
    { title: 'Description', dataIndex: 'description', width: 240, ellipsis: true, render: v => <Text style={{ fontSize: 12 }}>{v || '—'}</Text> },
    { title: 'Org', dataIndex: 'org', width: 120, render: v => <Tag>{v}</Tag> },
    { title: 'Received', dataIndex: 'received', width: 90, align: 'right', render: v => <Text style={{ color: REDWOOD.success }}>{fmtQty(v)}</Text> },
    { title: 'UOM', dataIndex: 'uom', width: 60 },
    { title: 'Return Qty', width: 110, align: 'right', render: (_, r) => <InputNumber size="small" min={0} max={r.received} value={r.returnQty} onChange={n => upd(r.key, { returnQty: Number(n) || 0 })} style={{ width: 95 }} /> },
    { title: 'Subinventory', width: 150, render: (_, r) => (
        <Select size="small" showSearch allowClear style={{ width: 130 }} value={r.subinventory || undefined} placeholder="From"
          options={subinvs.map(s => ({ value: s, label: s }))} onChange={v => upd(r.key, { subinventory: v || '' })} /> ) },
    { title: 'Receipt #', width: 150, render: (_, r) => <Input size="small" value={r.receiptNumber} placeholder="(if required)" onChange={e => upd(r.key, { receiptNumber: e.target.value })} /> },
    { title: 'Status', width: 160, render: (_, r) => r.status === 'pending' ? <Spin size="small" />
        : r.status === 'ok' ? <Tooltip title={r.message}><Tag color="green" icon={<CheckCircleTwoTone twoToneColor={REDWOOD.success} />}>Returned</Tag></Tooltip>
        : r.status === 'error' ? <Tooltip title={r.message}><Tag color="red" icon={<CloseCircleTwoTone twoToneColor={REDWOOD.error} />} style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.message}</Tag></Tooltip>
        : <Text type="secondary">—</Text> },
  ];

  return (
    <Layout style={{ background: 'transparent' }}>
      <Content style={{ padding: '8px 4px' }}>
        <Breadcrumb style={{ marginBottom: 10 }} items={[
          { title: <Link to="/"><HomeOutlined /></Link> },
          { title: <Link to="/procurement">Fusion Supply Chain</Link> },
          { title: 'Supplier Returns' },
        ]} />
        <div style={{ marginBottom: 12 }}>
          <Title level={4} style={{ margin: 0 }}><RollbackOutlined style={{ color: REDWOOD.primary, marginRight: 8 }} />Supplier Returns</Title>
          <Text type="secondary" style={{ fontSize: 13 }}>Return received purchase-order quantities to the supplier (Return to Vendor). After returning you can receive the PO again from Expected PO Receipts.</Text>
        </div>
        <Card style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}` }}>
          <Row gutter={12} style={{ marginBottom: 12 }}>
            <Col xs={24} md={6}><div style={{ fontSize: 12, color: REDWOOD.neutral600, marginBottom: 4 }}>Organization</div>
              <Select showSearch allowClear style={{ width: '100%' }} value={org} onChange={setOrg} optionFilterProp="label" placeholder="Any / from PO"
                options={orgs.map(o => ({ value: o.code, label: `${o.code}${o.name ? ' — ' + o.name : ''}` }))} /></Col>
            <Col xs={24} md={6}><div style={{ fontSize: 12, color: REDWOOD.neutral600, marginBottom: 4 }}>Purchase Order *</div>
              <Input value={poNum} onChange={e => setPoNum(e.target.value)} onPressEnter={search} placeholder="PO number" allowClear /></Col>
            <Col xs={24} md={6} style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
              <Button type="primary" icon={<SearchOutlined />} loading={loading} onClick={search} style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}>Search Received</Button>
              {lastUrl && <Tooltip title={<span style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}>{lastUrl}</span>}><Button icon={<ApiOutlined />} style={{ color: REDWOOD.info }} /></Tooltip>}
            </Col>
          </Row>
          {err && <Alert type="warning" showIcon message={err} style={{ marginBottom: 12 }} />}
          {lines.length > 0 && (
            <div style={{ marginBottom: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Button icon={<ApiOutlined />} onClick={() => setJsonOpen(true)}>View JSON</Button>
              <Button icon={<ReloadOutlined />} onClick={search}>Refresh</Button>
              <Button type="primary" danger icon={<RollbackOutlined />} loading={posting} onClick={postReturns}>Return to Supplier ({lines.filter(l => num(l.returnQty) > 0).length})</Button>
            </div>
          )}
          <Table size="small" rowKey="key" columns={cols} dataSource={lines} loading={loading}
            pagination={false} scroll={{ x: 1280 }} locale={{ emptyText: 'Search a PO to list its received lines' }} />
        </Card>

        <Modal open={jsonOpen} onCancel={() => setJsonOpen(false)} width={720} title={`POST ${RECEIVE_URL}`} footer={<Button onClick={() => setJsonOpen(false)}>Close</Button>}>
          <div style={{ fontSize: 11, marginBottom: 6 }}><Tag color="green">POST</Tag> one request per line · TransactionType <Tag>RETURN TO VENDOR</Tag></div>
          <pre style={{ maxHeight: 380, overflow: 'auto', background: REDWOOD.neutral100, padding: 10, borderRadius: 6, fontSize: 11 }}>
            {JSON.stringify(lines.filter(l => num(l.returnQty) > 0).map(buildBody), null, 2)}
          </pre>
        </Modal>
      </Content>
    </Layout>
  );
};

export default SupplierReturns;
