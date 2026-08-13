import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  Layout, Breadcrumb, Card, Table, Button, Tag, Typography, Space, Tooltip, Spin,
  Row, Col, message, Modal, Empty, Select, Input, Tabs, Upload, Checkbox, Steps, Alert, Progress, InputNumber, Drawer, Divider,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  HomeOutlined, UploadOutlined, InboxOutlined, CheckCircleTwoTone, CloseCircleTwoTone,
  InfoCircleOutlined, CopyOutlined, SearchOutlined, PlusOutlined, ReloadOutlined, ApiOutlined,
  EditOutlined, ProfileOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { FUSION_POD_HOST, FUSION_POD_AUTH } from '../../config/fusionInstance';

const { Content } = Layout;
const { Title, Text, Paragraph } = Typography;

const FUSION_BASE = `${FUSION_POD_HOST}/fscmRestApi/resources/11.13.18.05`;
const AUTH_HEADER = FUSION_POD_AUTH;
const FUSION_HDRS = { Authorization: AUTH_HEADER, Accept: 'application/json' };
const JSON_HDRS = { ...FUSION_HDRS, 'Content-Type': 'application/json' };
const ITEMS_URL = `${FUSION_BASE}/itemsV2`;

// Master item organization — items are created here first, then assigned to child orgs.
const MASTER_ORG = 'MIM';

const REDWOOD = {
  primary: '#C74634', success: '#1D7B4D', warning: '#B07700', info: '#0572CE',
  error: '#D93025', teal: '#00918A', purple: '#7245A6',
  neutral100: '#F7F7F7', neutral200: '#E5E5E5', neutral300: '#C7C7C7',
  neutral600: '#6B6B6B', neutral900: '#1A1A1A', surface: '#FFFFFF',
};

// Fields copied from the chosen reference item when creating a new one (only those
// present on the reference are sent). Item Number + Description are set per row.
const COPY_FIELDS = [
  'ItemClass', 'PrimaryUOMValue', 'PrimaryUnitOfMeasure', 'ItemStatusValue', 'LifecyclePhaseValue',
  'UserItemType', 'SalesProductType', 'InventoryItemFlag', 'StockEnabledFlag', 'InventoryAssetFlag',
  'PurchasingItemFlag', 'PurchasableFlag', 'CustomerOrderEnabledFlag', 'CustomerOrderFlag',
  'ShippableItemFlag', 'InternalOrderEnabledFlag', 'InternalOrderFlag', 'TransactionEnabledFlag',
  'BuildInWipFlag', 'ReturnableFlag', 'ServiceableProductFlag',
];

const mapLimit = async <T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> => {
  const out: R[] = new Array(items.length); let idx = 0;
  const worker = async () => { while (idx < items.length) { const c = idx++; out[c] = await fn(items[c], c); } };
  await Promise.all(Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, worker));
  return out;
};
// First present value among keys.
const pfv = (o: any, keys: string[]) => { for (const k of keys) { if (o?.[k] != null && o[k] !== '') return o[k]; } return undefined; };
// Rewrite an absolute Fusion self href onto the proxy base (web) or keep it (electron).
const fusionHref = (href: string) => href;
const RESITEM_HDRS = { ...FUSION_HDRS, 'Content-Type': 'application/vnd.oracle.adf.resourceitem+json' };
const fetchJson = async (url: string): Promise<any> => { const r = await fetch(url, { headers: FUSION_HDRS }); return r.ok ? r.json() : null; };
// Exact-match GET of one item in an org.
const getItem = async (itemNumber: string, org: string) =>
  (await fetchJson(`${ITEMS_URL}?q=OrganizationCode=${org};ItemNumber=${encodeURIComponent(itemNumber)}&limit=1&onlyData=true`))?.items?.[0] ?? null;
// Prefix search of items in the master org (reference picker).
const searchMaster = async (term: string) =>
  (await fetchJson(`${ITEMS_URL}?q=OrganizationCode=${MASTER_ORG}${term ? `;ItemNumber LIKE ${encodeURIComponent(term)}%` : ''}&limit=25&onlyData=true`))?.items ?? [];

const buildPayload = (itemNumber: string, description: string, org: string, ref: any) => {
  const body: Record<string, any> = { OrganizationCode: org, ItemNumber: itemNumber, ItemDescription: description };
  if (ref) for (const f of COPY_FIELDS) if (ref[f] != null && ref[f] !== '') body[f] = ref[f];
  return body;
};
const postItem = async (payload: any): Promise<{ ok: boolean; status: number; data: any; text: string }> => {
  const r = await fetch(ITEMS_URL, { method: 'POST', headers: JSON_HDRS, body: JSON.stringify(payload) });
  const text = await r.text(); let data: any = null; try { data = JSON.parse(text); } catch { /* raw */ }
  return { ok: r.ok, status: r.status, data, text };
};
const errOf = (res: { data: any; text: string }) =>
  res.data?.['o:errorDetails']?.[0]?.detail ?? res.data?.detail ?? res.data?.message ?? (res.text || '').slice(0, 240);

interface PasteRow { key: string; itemNumber: string; description: string; exists?: boolean; checking?: boolean; }
interface OrgOpt { code: string; name: string; }

// ─────────────────────────────────────────────────────────────────────────────
// Edit item attributes — adaptive editor: shows the item's real fields relevant
// to lot/serial control, sales account, status and flags, and PATCHes itemsV2.
// ─────────────────────────────────────────────────────────────────────────────
// Curated groups → the field-name patterns that belong to each (matched against
// the actual attribute names Fusion returns, so we don't hardcode exact spellings).
const EDIT_GROUPS: { title: string; re: RegExp }[] = [
  { title: 'Lot & Serial Control', re: /(lot|serial|shelf.?life|expiration|bulk.?picked)/i },
  { title: 'Accounts', re: /(sales.?account|cost.?of.?sales|expense.?account|encumbrance|account)/i },
  { title: 'Item Status & Type', re: /(item.?status|lifecycle|user.?item.?type|sales.?product.?type|primary.?u(om|nit)|item.?class)/i },
  { title: 'Inventory & Ordering Flags', re: /(inventory.?item|stock.?enabled|inventory.?asset|purchas|customer.?order|shippable|internal.?order|transaction.?enabled|returnable|reservable|restrict|locator.?control)/i },
];
const EDIT_SKIP = /^(ItemId|OrganizationId|MasterOrganizationId|links|CategoryCode|.*ObjectVersionNumber|CreatedBy|CreationDate|LastUpdateDate|LastUpdatedBy|LastUpdateLogin)$/i;

// Known enumerated item attributes → their valid values, so these render as a
// dropdown (Fusion rejects free text like "Yes" for LotControlValue etc.).
const ENUM_OPTIONS: Record<string, { value: string; label: string }[]> = {
  lotcontrolvalue: [{ value: 'No lot control', label: 'No lot control' }, { value: 'Full lot control', label: 'Full lot control' }],
  lotcontrolcode: [{ value: '1', label: '1 — No lot control' }, { value: '2', label: '2 — Full lot control' }],
  serialgenerationvalue: [
    { value: 'No serial number control', label: 'No serial number control' },
    { value: 'Predefined serial numbers', label: 'Predefined serial numbers' },
    { value: 'Dynamic entry at inventory receipt', label: 'Dynamic entry at inventory receipt' },
    { value: 'Dynamic entry at sales order issue', label: 'Dynamic entry at sales order issue' },
  ],
  serialgenerationcode: [
    { value: '1', label: '1 — No serial number control' },
    { value: '2', label: '2 — Predefined serial numbers' },
    { value: '5', label: '5 — Dynamic entry at inventory receipt' },
    { value: '6', label: '6 — Dynamic entry at sales order issue' },
  ],
};

const EditItemModal: React.FC<{ item: any | null; onClose: () => void; onSaved: () => void }> = ({ item, onClose, onSaved }) => {
  const [full, setFull] = useState<any>(null);
  const [selfHref, setSelfHref] = useState('');
  const [loading, setLoading] = useState(false);
  const [edits, setEdits] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const [resp, setResp] = useState<string>('');
  const [applyAllOrgs, setApplyAllOrgs] = useState(false);
  const [orgResults, setOrgResults] = useState<{ org: string; ok: boolean; msg?: string }[]>([]);

  useEffect(() => {
    if (!item) return;
    setFull(null); setEdits({}); setResp(''); setSelfHref(''); setOrgResults([]); setApplyAllOrgs(false);
    (async () => {
      setLoading(true);
      try {
        const r = await fetch(`${ITEMS_URL}?q=OrganizationCode=${item.OrganizationCode};ItemNumber=${encodeURIComponent(item.ItemNumber)}&onlyData=false&limit=1`, { headers: FUSION_HDRS });
        const d = await r.json();
        const it = (d.items ?? [])[0];
        setFull(it ?? null);
        const self = (it?.links ?? []).find((x: any) => x.rel === 'self')?.href;
        if (self) setSelfHref(fusionHref(self));
      } catch (e: any) { setResp(`Load failed: ${e?.message ?? e}`); }
      finally { setLoading(false); }
    })();
  }, [item]);

  const groups = useMemo(() => {
    if (!full) return [] as { title: string; fields: [string, any][] }[];
    const used = new Set<string>();
    return EDIT_GROUPS.map(g => {
      const fields = Object.entries(full).filter(([k, v]) =>
        !EDIT_SKIP.test(k) && (v === null || typeof v !== 'object') && g.re.test(k) && !used.has(k));
      fields.forEach(([k]) => used.add(k));
      return { title: g.title, fields };
    }).filter(g => g.fields.length);
  }, [full]);

  const setVal = (k: string, v: any) => setEdits(prev => ({ ...prev, [k]: v }));
  const curVal = (k: string) => (k in edits ? edits[k] : full?.[k]);

  const save = async () => {
    // Send only changed fields; coerce to the attribute's original numeric type
    // (e.g. LotControlCode is a number even though the dropdown value is a string).
    const body = Object.fromEntries(
      Object.entries(edits)
        .filter(([k]) => String(full?.[k]) !== String(edits[k]))
        .map(([k, v]) => [k, typeof full?.[k] === 'number' && v !== '' && v != null && !isNaN(Number(v)) ? Number(v) : v]),
    );
    if (Object.keys(body).length === 0) { message.warning('No changes to save'); return; }
    setSaving(true); setResp(''); setOrgResults([]);
    try {
      if (applyAllOrgs) {
        // Apply the same changes to this item in every organization it exists in.
        const d = await fetchJson(`${ITEMS_URL}?q=ItemNumber=${encodeURIComponent(item.ItemNumber)}&onlyData=false&limit=500`);
        const orgRows: any[] = d?.items ?? [];
        if (!orgRows.length) { setResp('No organization records found for this item'); setSaving(false); return; }
        const results: { org: string; ok: boolean; msg?: string }[] = [];
        for (const row of orgRows) {
          const self = (row.links ?? []).find((x: any) => x.rel === 'self')?.href;
          const orgCode = row.OrganizationCode ?? '?';
          if (!self) { results.push({ org: orgCode, ok: false, msg: 'no self link' }); continue; }
          try {
            const r = await fetch(fusionHref(self), { method: 'PATCH', headers: RESITEM_HDRS, body: JSON.stringify(body) });
            const t = await r.text();
            results.push({ org: orgCode, ok: r.ok, msg: r.ok ? undefined : errOf({ data: (() => { try { return JSON.parse(t); } catch { return null; } })(), text: t }) });
          } catch (e: any) { results.push({ org: orgCode, ok: false, msg: e?.message ?? String(e) }); }
        }
        setOrgResults(results);
        const okN = results.filter(r => r.ok).length;
        if (okN === results.length) { message.success(`Updated in all ${okN} organization(s)`); setEdits({}); onSaved(); }
        else message.warning(`Updated ${okN}/${results.length} org(s) — see details`);
      } else {
        if (!selfHref) { message.error('No item self link to update'); setSaving(false); return; }
        const r = await fetch(selfHref, { method: 'PATCH', headers: RESITEM_HDRS, body: JSON.stringify(body) });
        const txt = await r.text();
        if (!r.ok) { setResp(`HTTP ${r.status}: ${txt.slice(0, 500)}`); message.error('Update failed — see details'); }
        else { try { setFull(JSON.parse(txt)); } catch { /* keep */ } setEdits({}); message.success('Item updated'); onSaved(); }
      }
    } catch (e: any) { setResp(`Error: ${e?.message ?? e}`); message.error('Update failed'); }
    finally { setSaving(false); }
  };

  const renderField = (k: string, v: any) => {
    const val = curVal(k);
    const enumOpts = ENUM_OPTIONS[k.toLowerCase()];
    const isBool = !enumOpts && (typeof full?.[k] === 'boolean' || /^(true|false)$/i.test(String(full?.[k] ?? '')) || /flag$/i.test(k));
    const isNum = !enumOpts && typeof full?.[k] === 'number';
    return (
      <Col xs={24} md={12} key={k} style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 11, color: REDWOOD.neutral600, marginBottom: 2 }}>{k}{k in edits && String(full?.[k]) !== String(edits[k]) ? <Tag color="warning" style={{ marginLeft: 6, fontSize: 9, lineHeight: '14px' }}>changed</Tag> : null}</div>
        {enumOpts
          ? <Select size="small" showSearch style={{ width: '100%' }} value={val == null ? undefined : String(val)} onChange={x => setVal(k, x)} options={enumOpts} />
          : isBool
            ? <Select size="small" style={{ width: '100%' }} value={String(val)} onChange={x => setVal(k, x === 'true')}
                options={[{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]} />
            : isNum
              ? <InputNumber size="small" style={{ width: '100%' }} value={val as number} onChange={x => setVal(k, x)} />
              : <Input size="small" value={val == null ? '' : String(val)} onChange={e => setVal(k, e.target.value)} />}
      </Col>
    );
  };

  return (
    <Modal open={!!item} onCancel={() => { if (!saving) onClose(); }} width={820} maskClosable={false}
      title={<Space><ProfileOutlined style={{ color: REDWOOD.info }} />Edit Item — {item?.ItemNumber} <Tag>{item?.OrganizationCode}</Tag></Space>}
      footer={<Space>
        <Checkbox checked={applyAllOrgs} onChange={e => setApplyAllOrgs(e.target.checked)}>Apply to all organizations</Checkbox>
        <Button onClick={onClose} disabled={saving}>Close</Button>
        <Button type="primary" loading={saving} disabled={(!selfHref && !applyAllOrgs) || Object.keys(edits).length === 0}
          onClick={save} style={{ background: REDWOOD.success, borderColor: REDWOOD.success }}>
          {applyAllOrgs ? 'Save to All Orgs' : 'Save Changes'}
        </Button>
      </Space>}>
      {loading ? <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
        : !full ? <Empty description="Item not found" />
        : <div>
            <Text type="secondary" style={{ fontSize: 12 }}>Edit the attributes below and Save — changes are PATCHed to <code>itemsV2</code>. Only changed fields are sent.</Text>
            {groups.map(g => (
              <Card key={g.title} size="small" title={g.title} style={{ marginTop: 10, borderRadius: 8 }} styles={{ body: { paddingBottom: 2 } }}>
                <Row gutter={12}>{g.fields.map(([k, v]) => renderField(k, v))}</Row>
              </Card>
            ))}
            {groups.length === 0 && <Empty style={{ marginTop: 12 }} description="No editable lot/serial/account attributes found on this item" />}
            {applyAllOrgs && <Alert type="info" showIcon style={{ marginTop: 10 }} message={`Changes will be applied to this item in every organization it exists in.`} />}
            {orgResults.length > 0 && <Card size="small" title="Per-organization result" style={{ marginTop: 10 }} styles={{ body: { padding: 8 } }}>
              <Space size={[6, 6]} wrap>
                {orgResults.map(r => <Tooltip key={r.org} title={r.msg}><Tag color={r.ok ? 'green' : 'red'} icon={r.ok ? <CheckCircleTwoTone twoToneColor={REDWOOD.success} /> : <CloseCircleTwoTone twoToneColor={REDWOOD.error} />}>{r.org}</Tag></Tooltip>)}
              </Space>
            </Card>}
            {resp && <Alert type="error" showIcon style={{ marginTop: 12 }} message="Update response"
              description={<pre style={{ whiteSpace: 'pre-wrap', fontSize: 11, margin: 0, maxHeight: 200, overflow: 'auto' }}>{resp}</pre>} />}
          </div>}
    </Modal>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Search tab — query itemsV2 by org + item / description
// ─────────────────────────────────────────────────────────────────────────────
// Lot / serial control enabled? Code 1 (or a "No … control" value) means disabled.
const isLotEnabled = (r: any) => { const c = pfv(r, ['LotControlCode']); const v = pfv(r, ['LotControlValue']); if (c != null && c !== '') return Number(c) !== 1; if (v) return !/no\s*lot/i.test(String(v)); return false; };
// Serial control lives under SerialGeneration* in itemsV2 (code 1 / "No serial
// number control" = off; anything else — predefined, dynamic entry — = on).
const isSerialEnabled = (r: any) => { const c = pfv(r, ['SerialGenerationCode', 'SerialNumberControlCode']); const v = pfv(r, ['SerialGenerationValue', 'SerialNumberControlValue', 'SerialGeneration', 'SerialNumberControl']); if (c != null && c !== '') return Number(c) !== 1; if (v) return !/no\s*serial/i.test(String(v)); return false; };
const yesNoIcon = (on: boolean) => on
  ? <CheckCircleTwoTone twoToneColor={REDWOOD.success} style={{ fontSize: 16 }} />
  : <CloseCircleTwoTone twoToneColor={REDWOOD.error} style={{ fontSize: 16 }} />;

const ALL_ORGS = '__ALL__';
const SearchTab: React.FC<{ orgs: OrgOpt[]; onRowsChange?: (rows: any[]) => void }> = ({ orgs, onRowsChange }) => {
  const [selectedOrgs, setSelectedOrgs] = useState<string[]>([]);
  const [itemsText, setItemsText] = useState('');
  const [description, setDescription] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [lastUrl, setLastUrl] = useState('');
  const [editItem, setEditItem] = useState<any | null>(null);

  const updateRows = (newRows: any[]) => {
    setRows(newRows);
    onRowsChange?.(newRows);
  };

  const run = useCallback(async () => {
    if (!selectedOrgs || selectedOrgs.length === 0) {
      message.warning('Select at least one organization');
      return;
    }
    const orgClauses = selectedOrgs.map(o => `OrganizationCode=${o}`).join(';');
    const orgClause = orgClauses ? `${orgClauses};` : '';
    // Parse the pasted item numbers (one per line, or tab/comma separated).
    let nums = Array.from(new Set(itemsText.split(/\r?\n|,|\t|\s{2,}/).map(s => s.trim()).filter(Boolean)));
    if (nums.length > 500) { message.warning(`Too many items (${nums.length}) — searching the first 500`); nums = nums.slice(0, 500); }
    setLoading(true); setErr('');
    try {
      if (nums.length) {
        // itemsV2 has no `in (...)` — query each item number (a few in parallel),
        // returning it across all orgs (or the one chosen org). Fetch without onlyData=true to get links for DFF/EFF.
        const out: any[] = []; let idx = 0;
        const worker = async () => {
          while (idx < nums.length) {
            const n = nums[idx++];
            const url = `${ITEMS_URL}?q=${orgClause}ItemNumber=${encodeURIComponent(n)}&limit=500`;
            setLastUrl(url);
            try { const r = await fetch(url, { headers: FUSION_HDRS }); if (r.ok) { const d = await r.json(); (d.items ?? []).forEach((it: any) => out.push(it)); } } catch { /* skip */ }
          }
        };
        await Promise.all(Array.from({ length: Math.min(6, nums.length) }, worker));
        out.sort((a, b) => String(a.ItemNumber).localeCompare(String(b.ItemNumber)) || String(a.OrganizationCode).localeCompare(String(b.OrganizationCode)));
        updateRows(out);
      } else if (description.trim()) {
        if (selectedOrgs.length === 0) { message.warning('Select at least one organization to search by description'); setLoading(false); return; }
        const url = `${ITEMS_URL}?q=${orgClause}ItemDescription LIKE ${description.trim()}%&limit=500`;
        setLastUrl(url);
        const r = await fetch(url, { headers: FUSION_HDRS });
        const d = r.ok ? await r.json() : { items: [] };
        updateRows(d.items ?? []);
      } else {
        message.warning('Paste one or more item numbers to search'); setLoading(false); return;
      }
    } catch (e: any) { setErr(e?.message ?? String(e)); updateRows([]); }
    finally { setLoading(false); }
  }, [selectedOrgs, itemsText, description, onRowsChange]);

  const cols: ColumnsType<any> = [
    { title: 'Item Number', dataIndex: 'ItemNumber', width: 160, render: v => <Text strong>{String(v ?? '')}</Text> },
    { title: 'Description', dataIndex: 'ItemDescription', width: 320, ellipsis: true, render: v => <Text style={{ fontSize: 12 }}>{v == null ? '—' : String(v)}</Text> },
    { title: 'Org', dataIndex: 'OrganizationCode', width: 120, render: v => <Tag>{String(v ?? '')}</Tag> },
    { title: 'UOM', dataIndex: 'PrimaryUOMValue', width: 90, render: (v, r) => v ?? r.PrimaryUnitOfMeasure ?? '—' },
    { title: 'Item Class', dataIndex: 'ItemClass', width: 150, ellipsis: true, render: v => v ?? '—' },
    { title: <Tooltip title="Lot control enabled">Lot</Tooltip>, key: 'lot', width: 55, align: 'center',
      render: (_: any, r: any) => <Tooltip title={pfv(r, ['LotControlValue']) ?? (isLotEnabled(r) ? 'Lot controlled' : 'No lot control')}>{yesNoIcon(isLotEnabled(r))}</Tooltip> },
    { title: <Tooltip title="Serial number control enabled">Serial</Tooltip>, key: 'serial', width: 60, align: 'center',
      render: (_: any, r: any) => <Tooltip title={pfv(r, ['SerialGenerationValue', 'SerialNumberControlValue']) ?? (isSerialEnabled(r) ? 'Serial controlled' : 'No serial control')}>{yesNoIcon(isSerialEnabled(r))}</Tooltip> },
    { title: 'Status', dataIndex: 'ItemStatusValue', width: 110, render: v => v ? <Tag color="blue">{v}</Tag> : '—' },
    { title: '', key: 'edit', width: 80, fixed: 'right', render: (_: any, r: any) => (
        <Button size="small" icon={<EditOutlined />} onClick={() => setEditItem(r)}
          style={{ color: REDWOOD.info, borderColor: REDWOOD.info }}>Edit</Button>
      ) },
  ];

  return (
    <div>
      <Row gutter={12} style={{ marginBottom: 12 }}>
        <Col xs={24} md={7}><div style={{ fontSize: 12, color: REDWOOD.neutral600, marginBottom: 4 }}>Organization *</div>
          <Select showSearch mode="multiple" style={{ width: '100%' }} value={selectedOrgs} onChange={setSelectedOrgs} optionFilterProp="label" placeholder="Select one or more organizations"
            options={orgs.map(o => ({ value: o.code, label: `${o.code}${o.name ? ' — ' + o.name : ''}` }))} />
          <div style={{ fontSize: 12, color: REDWOOD.neutral600, margin: '10px 0 4px' }}>Description (prefix, single org)</div>
          <Input value={description} onChange={e => setDescription(e.target.value)} onPressEnter={run} allowClear placeholder="Only used when no item numbers are pasted" /></Col>
        <Col xs={24} md={11}><div style={{ fontSize: 12, color: REDWOOD.neutral600, marginBottom: 4 }}>Item Numbers — paste one per line</div>
          <Input.TextArea rows={5} value={itemsText} onChange={e => setItemsText(e.target.value)} style={{ fontFamily: 'monospace', fontSize: 12 }}
            placeholder={'460-BDXV\nDLPB14255-01\n450-BFFP'} /></Col>
        <Col xs={24} md={6} style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', gap: 8 }}>
          <div style={{ fontSize: 12, color: REDWOOD.neutral600, marginBottom: 4 }}>&nbsp;</div>
          <Button type="primary" icon={<SearchOutlined />} loading={loading} onClick={run} disabled={selectedOrgs.length === 0} block
            style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}>Search</Button>
          {lastUrl && <Tooltip title={<span style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}>{lastUrl}</span>}>
            <Button icon={<ApiOutlined />} style={{ color: REDWOOD.info }} block>Last API call</Button></Tooltip>}
          <Text type="secondary" style={{ fontSize: 11 }}>{rows.length ? `${rows.length} row(s) · ${new Set(rows.map(r => r.ItemNumber)).size} item(s)` : ''}</Text>
        </Col>
      </Row>
      {err && <Alert type="error" showIcon message={err} style={{ marginBottom: 12 }} />}
      <Table size="small" rowKey={(_, i) => String(i)} columns={cols} dataSource={rows} loading={loading}
        pagination={{ pageSize: 25, showSizeChanger: true }} scroll={{ x: 980 }}
        locale={{ emptyText: 'No items — run a search' }} />
      <EditItemModal item={editItem} onClose={() => setEditItem(null)} onSaved={run} />
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// DFF Tab — view and update Data Flex Fields for items
// ─────────────────────────────────────────────────────────────────────────────
const DFFTab: React.FC<{ rows: any[] }> = ({ rows }) => {
  const [allDFFData, setAllDFFData] = useState<Record<string, any[]>>({});
  const [dffLoading, setDffLoading] = useState(false);
  const [selectedItem, setSelectedItem] = useState<any | null>(null);
  const [dffFields, setDffFields] = useState<any[]>([]);
  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set());
  const [dffEdits, setDffEdits] = useState<Record<string, any>>({});
  const [dffApiDrawerOpen, setDffApiDrawerOpen] = useState(false);
  const [dffUrl, setDffUrl] = useState('');
  const [dffResponse, setDffResponse] = useState('');
  const [dffUpdateUrl, setDffUpdateUrl] = useState('');
  const [dffUpdatePayload, setDffUpdatePayload] = useState('');
  const [dffUpdating, setDffUpdating] = useState(false);

  useEffect(() => {
    if (rows.length === 0) return;
    setDffLoading(true);
    (async () => {
      const results: Record<string, any[]> = {};
      for (const item of rows) {
        try {
          const dffLink = (item.links ?? []).find((l: any) => l.name === 'ItemDFF')?.href;
          if (dffLink) {
            const r = await fetch(dffLink, { headers: FUSION_HDRS });
            if (r.ok) {
              const d = await r.json();
              const items = d.items ?? [];
              if (Array.isArray(items) && items.length > 0) {
                const firstItem = items[0];
                const fields = Object.entries(firstItem)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([name, value]) => ({
                    name,
                    value: value !== null && value !== undefined ? String(value) : ''
                  }));
                const key = `${item.ItemNumber}:${item.OrganizationCode}`;
                results[key] = fields;
              }
            }
          }
        } catch (e) {
          console.error(`Error fetching DFF for ${item.ItemNumber}:`, e);
        }
      }
      setAllDFFData(results);
      setDffLoading(false);
    })();
  }, [rows]);

  const fetchDFFForEdit = async (item: any) => {
    setSelectedFields(new Set());
    setDffEdits({});
    try {
      const dffLink = (item.links ?? []).find((l: any) => l.name === 'ItemDFF')?.href;
      if (!dffLink) {
        message.warning('No DFF link found for this item');
        return;
      }
      console.log('Fetching DFF from:', dffLink);
      setDffUrl(dffLink);
      const r = await fetch(dffLink, { headers: FUSION_HDRS });
      if (r.ok) {
        const d = await r.json();
        console.log('DFF Response:', d);
        setDffResponse(JSON.stringify(d, null, 2));
        const items = d.items ?? [];
        if (Array.isArray(items) && items.length > 0) {
          const firstItem = items[0];
          const fields = Object.entries(firstItem)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([name, value]) => ({
              name,
              value: value !== null && value !== undefined ? String(value) : ''
            }));
          setDffFields(fields);
        } else {
          setDffFields([]);
        }
        setSelectedItem(item);
      } else {
        message.error(`Failed to fetch DFF data: HTTP ${r.status}`);
        setDffResponse(`HTTP ${r.status}: ${r.statusText}`);
      }
    } catch (e: any) {
      message.error(`Error: ${e?.message ?? e}`);
      setDffResponse(`Error: ${e?.message ?? e}`);
    }
  };

  const handleUpdateClick = () => {
    if (selectedFields.size === 0) {
      message.warning('Select at least one field to update');
      return;
    }
    const updateUrl = dffUrl.replace('/child/ItemDFF', '') || '';
    setDffUpdateUrl(updateUrl);
    const payload: Record<string, any> = {};
    selectedFields.forEach(fieldName => {
      payload[fieldName] = dffEdits[fieldName] ?? dffFields.find((f: any) => f.name === fieldName)?.value ?? '';
    });
    setDffUpdatePayload(JSON.stringify(payload, null, 2));
    setDffApiDrawerOpen(true);
  };

  const confirmUpdate = async () => {
    if (!dffUpdateUrl) return;
    setDffUpdating(true);
    try {
      const payload: Record<string, any> = {};
      selectedFields.forEach(fieldName => {
        payload[fieldName] = dffEdits[fieldName] ?? dffFields.find((f: any) => f.name === fieldName)?.value ?? '';
      });
      const r = await fetch(dffUpdateUrl, { method: 'PATCH', headers: RESITEM_HDRS, body: JSON.stringify(payload) });
      if (r.ok) {
        message.success('DFF updated successfully');
        setDffApiDrawerOpen(false);
        setSelectedItem(null);
      } else {
        message.error(`Update failed: HTTP ${r.status}`);
      }
    } catch (e: any) {
      message.error(`Error: ${e?.message ?? e}`);
    } finally {
      setDffUpdating(false);
    }
  };

  const allColumnNames = useMemo(() => {
    const names = new Set<string>();
    Object.values(allDFFData).forEach(fields => {
      fields.forEach(f => names.add(f.name));
    });
    return Array.from(names).sort();
  }, [allDFFData]);

  const dynamicColumns = useMemo(() => {
    return allColumnNames.map(colName => ({
      title: colName,
      dataIndex: colName,
      key: colName,
      width: 150,
      render: (_: any, r: any) => {
        const key = `${r.ItemNumber}:${r.OrganizationCode}`;
        const fields = allDFFData[key] || [];
        const field = fields.find(f => f.name === colName);
        return <Text style={{ fontSize: 11 }}>{field?.value || '—'}</Text>;
      }
    }));
  }, [allColumnNames, allDFFData]);

  return (
    <div>
      {rows.length === 0 ? (
        <Empty description="Run a search in the Search tab first" />
      ) : (
        <>
          <div style={{ marginBottom: 12 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {dffLoading ? 'Loading DFF data...' : `${rows.length} item(s) with ${allColumnNames.length} DFF columns.`}
            </Text>
          </div>
          <Table size="small" rowKey={(r) => r.ItemNumber + ':' + r.OrganizationCode}
            loading={dffLoading}
            columns={[
              { title: 'Item Number', dataIndex: 'ItemNumber', width: 150, fixed: 'left', render: v => <Text strong>{String(v ?? '')}</Text> },
              { title: 'Description', dataIndex: 'ItemDescription', width: 350, fixed: 'left', ellipsis: true, render: v => <Text style={{ fontSize: 12 }}>{v == null ? '—' : String(v)}</Text> },
              { title: 'Org', dataIndex: 'OrganizationCode', width: 80, fixed: 'left', render: v => <Tag>{String(v ?? '')}</Tag> },
              ...dynamicColumns,
              {
                title: 'Actions',
                key: 'actions',
                width: 100,
                fixed: 'right',
                render: (_: any, r: any) => (
                  <Button size="small" onClick={() => fetchDFFForEdit(r)} style={{ color: REDWOOD.success, borderColor: REDWOOD.success }}>Edit</Button>
                )
              }
            ]}
            dataSource={rows}
            pagination={{ pageSize: 20, showSizeChanger: true }} scroll={{ x: 1200 }} />
        </>
      )}

      <Modal
        open={!!selectedItem}
        onCancel={() => setSelectedItem(null)}
        width={1000}
        title={<Space><ProfileOutlined style={{ color: REDWOOD.info }} />DFF — {selectedItem?.ItemNumber} <Tag>{selectedItem?.OrganizationCode}</Tag><Text type="secondary">({dffFields.length} fields)</Text><Button icon={<ApiOutlined />} size="small" onClick={() => setDffApiDrawerOpen(true)} title="View API details" /></Space>}
        footer={<Space>
          <Button onClick={() => setSelectedItem(null)}>Close</Button>
          <Button type="primary" disabled={selectedFields.size === 0} onClick={handleUpdateClick} style={{ background: REDWOOD.success, borderColor: REDWOOD.success }}>
            Update {selectedFields.size} Field(s)
          </Button>
        </Space>}>
        {dffLoading ? <Spin /> : dffFields.length === 0 ? (
          <Empty description="No DFF fields found for this item" />
        ) : (
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>Select columns to update ({dffFields.length} total fields):</Text>
            <Table size="small" style={{ marginTop: 12 }} columns={[
              {
                title: 'Select',
                width: 60,
                render: (_: any, r: any) => (
                  <Checkbox
                    checked={selectedFields.has(r.name)}
                    onChange={e => {
                      const newSel = new Set(selectedFields);
                      if (e.target.checked) newSel.add(r.name);
                      else newSel.delete(r.name);
                      setSelectedFields(newSel);
                    }}
                  />
                ),
              },
              { title: 'Column Name', dataIndex: 'name', width: 200, render: v => <Text strong>{v}</Text> },
              { title: 'Current Value', dataIndex: 'value', width: 250, ellipsis: true, render: v => <Text style={{ fontSize: 12 }}>{v ?? '—'}</Text> },
              {
                title: 'New Value',
                width: 250,
                render: (_: any, r: any) => selectedFields.has(r.name) ? (
                  <Input size="small" value={dffEdits[r.name] ?? r.value ?? ''} onChange={e => setDffEdits(p => ({ ...p, [r.name]: e.target.value }))} />
                ) : null,
              },
            ]} dataSource={dffFields} pagination={{ pageSize: 10, showSizeChanger: true }} scroll={{ x: 800 }} />
          </div>
        )}
      </Modal>

      <Drawer
        title="API Inspector - DFF Update"
        placement="right"
        onClose={() => setDffApiDrawerOpen(false)}
        open={dffApiDrawerOpen}
        width={600}
        footer={<Button type="primary" loading={dffUpdating} onClick={confirmUpdate} style={{ background: REDWOOD.success, borderColor: REDWOOD.success, width: '100%' }}>Confirm Update</Button>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div>
            <Paragraph>
              <Text strong>Update URL (PATCH):</Text>
            </Paragraph>
            <div style={{ background: '#f5f5f5', padding: '8px', borderRadius: '4px', wordBreak: 'break-all', fontFamily: 'monospace', fontSize: '11px', maxHeight: 150, overflow: 'auto' }}>
              {dffUpdateUrl || 'Loading...'}
            </div>
          </div>

          <Divider />

          <div>
            <Paragraph>
              <Text strong>Update Payload:</Text>
            </Paragraph>
            <pre style={{
              background: '#f5f5f5',
              padding: '8px',
              borderRadius: '4px',
              fontSize: '11px',
              fontFamily: 'monospace',
              maxHeight: 300,
              overflow: 'auto',
              lineHeight: '1.4',
            }}>
              {dffUpdatePayload || 'No data'}
            </pre>
          </div>

          <Divider />

          <div>
            <Paragraph>
              <Text strong>Fetch Response (First 1000 chars):</Text>
            </Paragraph>
            <pre style={{
              background: '#f5f5f5',
              padding: '8px',
              borderRadius: '4px',
              fontSize: '10px',
              fontFamily: 'monospace',
              maxHeight: 200,
              overflow: 'auto',
              lineHeight: '1.2',
            }}>
              {dffResponse.slice(0, 1000)}
            </pre>
          </div>
        </div>
      </Drawer>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// EFF Tab — view and update Entity Flex Fields for items
// ─────────────────────────────────────────────────────────────────────────────
const EFFTab: React.FC<{ rows: any[] }> = ({ rows }) => {
  const [allEFFData, setAllEFFData] = useState<Record<string, any[]>>({});
  const [effLoading, setEffLoading] = useState(false);
  const [selectedItem, setSelectedItem] = useState<any | null>(null);
  const [effFields, setEffFields] = useState<any[]>([]);
  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set());
  const [effEdits, setEffEdits] = useState<Record<string, any>>({});
  const [effApiDrawerOpen, setEffApiDrawerOpen] = useState(false);
  const [effUrl, setEffUrl] = useState('');
  const [effResponse, setEffResponse] = useState('');
  const [effUpdateUrl, setEffUpdateUrl] = useState('');
  const [effUpdatePayload, setEffUpdatePayload] = useState('');
  const [effUpdating, setEffUpdating] = useState(false);

  useEffect(() => {
    if (rows.length === 0) return;
    setEffLoading(true);
    (async () => {
      const results: Record<string, any[]> = {};
      for (const item of rows) {
        try {
          const effLink = (item.links ?? []).find((l: any) => l.name === 'ItemEffCategory')?.href;
          if (effLink) {
            const r = await fetch(effLink, { headers: FUSION_HDRS });
            if (r.ok) {
              const d = await r.json();
              const items = d.items ?? [];
              if (Array.isArray(items) && items.length > 0) {
                const firstItem = items[0];
                const fields = Object.entries(firstItem)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([name, value]) => ({
                    name,
                    value: value !== null && value !== undefined ? String(value) : ''
                  }));
                const key = `${item.ItemNumber}:${item.OrganizationCode}`;
                results[key] = fields;
              }
            }
          }
        } catch (e) {
          console.error(`Error fetching EFF for ${item.ItemNumber}:`, e);
        }
      }
      setAllEFFData(results);
      setEffLoading(false);
    })();
  }, [rows]);

  const fetchEFFForEdit = async (item: any) => {
    setSelectedFields(new Set());
    setEffEdits({});
    try {
      const effLink = (item.links ?? []).find((l: any) => l.name === 'ItemEffCategory')?.href;
      if (!effLink) {
        message.warning('No EFF link found for this item');
        return;
      }
      console.log('Fetching EFF from:', effLink);
      setEffUrl(effLink);
      const r = await fetch(effLink, { headers: FUSION_HDRS });
      if (r.ok) {
        const d = await r.json();
        console.log('EFF Response:', d);
        setEffResponse(JSON.stringify(d, null, 2));
        const items = d.items ?? [];
        if (Array.isArray(items) && items.length > 0) {
          const firstItem = items[0];
          const fields = Object.entries(firstItem)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([name, value]) => ({
              name,
              value: value !== null && value !== undefined ? String(value) : ''
            }));
          setEffFields(fields);
        } else {
          setEffFields([]);
        }
        setSelectedItem(item);
      } else {
        message.error(`Failed to fetch EFF data: HTTP ${r.status}`);
        setEffResponse(`HTTP ${r.status}: ${r.statusText}`);
      }
    } catch (e: any) {
      message.error(`Error: ${e?.message ?? e}`);
      setEffResponse(`Error: ${e?.message ?? e}`);
    }
  };

  const handleUpdateClick = () => {
    if (selectedFields.size === 0) {
      message.warning('Select at least one field to update');
      return;
    }
    const updateUrl = effUrl.replace('/child/ItemEffCategory', '') || '';
    setEffUpdateUrl(updateUrl);
    const payload: Record<string, any> = {};
    selectedFields.forEach(fieldName => {
      payload[fieldName] = effEdits[fieldName] ?? effFields.find((f: any) => f.name === fieldName)?.value ?? '';
    });
    setEffUpdatePayload(JSON.stringify(payload, null, 2));
    setEffApiDrawerOpen(true);
  };

  const confirmUpdate = async () => {
    if (!effUpdateUrl) return;
    setEffUpdating(true);
    try {
      const payload: Record<string, any> = {};
      selectedFields.forEach(fieldName => {
        payload[fieldName] = effEdits[fieldName] ?? effFields.find((f: any) => f.name === fieldName)?.value ?? '';
      });
      const r = await fetch(effUpdateUrl, { method: 'PATCH', headers: RESITEM_HDRS, body: JSON.stringify(payload) });
      if (r.ok) {
        message.success('EFF updated successfully');
        setEffApiDrawerOpen(false);
        setSelectedItem(null);
      } else {
        message.error(`Update failed: HTTP ${r.status}`);
      }
    } catch (e: any) {
      message.error(`Error: ${e?.message ?? e}`);
    } finally {
      setEffUpdating(false);
    }
  };

  const allEFFColumnNames = useMemo(() => {
    const names = new Set<string>();
    Object.values(allEFFData).forEach(fields => {
      fields.forEach(f => names.add(f.name));
    });
    return Array.from(names).sort();
  }, [allEFFData]);

  const dynamicEFFColumns = useMemo(() => {
    return allEFFColumnNames.map(colName => ({
      title: colName,
      dataIndex: colName,
      key: colName,
      width: 150,
      render: (_: any, r: any) => {
        const key = `${r.ItemNumber}:${r.OrganizationCode}`;
        const fields = allEFFData[key] || [];
        const field = fields.find(f => f.name === colName);
        return <Text style={{ fontSize: 11 }}>{field?.value || '—'}</Text>;
      }
    }));
  }, [allEFFColumnNames, allEFFData]);

  return (
    <div>
      {rows.length === 0 ? (
        <Empty description="Run a search in the Search tab first" />
      ) : (
        <>
          <div style={{ marginBottom: 12 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {effLoading ? 'Loading EFF data...' : `${rows.length} item(s) with ${allEFFColumnNames.length} EFF columns.`}
            </Text>
          </div>
          <Table size="small" rowKey={(r) => r.ItemNumber + ':' + r.OrganizationCode}
            loading={effLoading}
            columns={[
              { title: 'Item Number', dataIndex: 'ItemNumber', width: 150, fixed: 'left', render: v => <Text strong>{String(v ?? '')}</Text> },
              { title: 'Description', dataIndex: 'ItemDescription', width: 350, fixed: 'left', ellipsis: true, render: v => <Text style={{ fontSize: 12 }}>{v == null ? '—' : String(v)}</Text> },
              { title: 'Org', dataIndex: 'OrganizationCode', width: 80, fixed: 'left', render: v => <Tag>{String(v ?? '')}</Tag> },
              ...dynamicEFFColumns,
              {
                title: 'Actions',
                key: 'actions',
                width: 100,
                fixed: 'right',
                render: (_: any, r: any) => (
                  <Button size="small" onClick={() => fetchEFFForEdit(r)} style={{ color: REDWOOD.success, borderColor: REDWOOD.success }}>Edit</Button>
                )
              }
            ]}
            dataSource={rows}
            pagination={{ pageSize: 20, showSizeChanger: true }} scroll={{ x: 1200 }} />
        </>
      )}

      <Modal
        open={!!selectedItem}
        onCancel={() => setSelectedItem(null)}
        width={900}
        title={<Space><ProfileOutlined style={{ color: REDWOOD.info }} />EFF — {selectedItem?.ItemNumber} <Tag>{selectedItem?.OrganizationCode}</Tag><Button icon={<ApiOutlined />} size="small" onClick={() => setEffApiDrawerOpen(true)} title="View API details" /></Space>}
        footer={<Space>
          <Button onClick={() => setSelectedItem(null)}>Close</Button>
          <Button type="primary" disabled={selectedFields.size === 0} onClick={handleUpdateClick} style={{ background: REDWOOD.success, borderColor: REDWOOD.success }}>
            Update {selectedFields.size} Field(s)
          </Button>
        </Space>}>
        {effLoading ? <Spin /> : effFields.length === 0 ? (
          <Empty description="No EFF fields found for this item" />
        ) : (
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>Select columns to update:</Text>
            <Table size="small" style={{ marginTop: 12 }} columns={[
              {
                title: 'Select',
                width: 60,
                render: (_: any, r: any) => (
                  <Checkbox
                    checked={selectedFields.has(r.name)}
                    onChange={e => {
                      const newSel = new Set(selectedFields);
                      if (e.target.checked) newSel.add(r.name);
                      else newSel.delete(r.name);
                      setSelectedFields(newSel);
                    }}
                  />
                ),
              },
              { title: 'Column Name', dataIndex: 'name', width: 180, render: v => <Text strong>{v}</Text> },
              { title: 'Current Value', dataIndex: 'value', width: 200, ellipsis: true, render: v => <Text style={{ fontSize: 12 }}>{v ?? '—'}</Text> },
              {
                title: 'New Value',
                width: 200,
                render: (_: any, r: any) => selectedFields.has(r.name) ? (
                  <Input size="small" value={effEdits[r.name] ?? r.value ?? ''} onChange={e => setEffEdits(p => ({ ...p, [r.name]: e.target.value }))} />
                ) : null,
              },
            ]} dataSource={effFields} pagination={false} />
          </div>
        )}
      </Modal>

      <Drawer
        title="API Inspector - EFF Update"
        placement="right"
        onClose={() => setEffApiDrawerOpen(false)}
        open={effApiDrawerOpen}
        width={600}
        footer={<Button type="primary" loading={effUpdating} onClick={confirmUpdate} style={{ background: REDWOOD.success, borderColor: REDWOOD.success, width: '100%' }}>Confirm Update</Button>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div>
            <Paragraph>
              <Text strong>Update URL (PATCH):</Text>
            </Paragraph>
            <div style={{ background: '#f5f5f5', padding: '8px', borderRadius: '4px', wordBreak: 'break-all', fontFamily: 'monospace', fontSize: '11px', maxHeight: 150, overflow: 'auto' }}>
              {effUpdateUrl || 'Loading...'}
            </div>
          </div>

          <Divider />

          <div>
            <Paragraph>
              <Text strong>Update Payload:</Text>
            </Paragraph>
            <pre style={{
              background: '#f5f5f5',
              padding: '8px',
              borderRadius: '4px',
              fontSize: '11px',
              fontFamily: 'monospace',
              maxHeight: 300,
              overflow: 'auto',
              lineHeight: '1.4',
            }}>
              {effUpdatePayload || 'No data'}
            </pre>
          </div>

          <Divider />

          <div>
            <Paragraph>
              <Text strong>Fetch Response:</Text>
            </Paragraph>
            <pre style={{
              background: '#f5f5f5',
              padding: '8px',
              borderRadius: '4px',
              fontSize: '10px',
              fontFamily: 'monospace',
              maxHeight: 200,
              overflow: 'auto',
              lineHeight: '1.2',
            }}>
              {effResponse.slice(0, 1000)}
            </pre>
          </div>
        </div>
      </Drawer>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Additional Info tab — view and update additional fields from searched items
// ─────────────────────────────────────────────────────────────────────────────
const AdditionalInfoTab: React.FC<{ rows: any[] }> = ({ rows }) => {
  const [sel, setSel] = useState<React.Key[]>([]);
  const [updateItem, setUpdateItem] = useState<any | null>(null);
  const [updateEdits, setUpdateEdits] = useState<Record<string, any>>({});
  const [apiDrawerOpen, setApiDrawerOpen] = useState(false);
  const [updatePayload, setUpdatePayload] = useState('');
  const [updateUrl, setUpdateUrl] = useState('');
  const [updating, setUpdating] = useState(false);

  const selectedRows = useMemo(() => rows.filter(r => sel.includes(r.ItemNumber + ':' + r.OrganizationCode)), [rows, sel]);

  const openUpdateDialog = (item: any) => {
    setUpdateItem(item);
    setUpdateEdits({});
    setApiDrawerOpen(false);
  };

  const handleUpdateConfirm = async () => {
    if (!updateItem) return;
    const body = Object.fromEntries(
      Object.entries(updateEdits)
        .filter(([k]) => String(updateItem?.[k]) !== String(updateEdits[k]))
        .map(([k, v]) => [k, typeof updateItem?.[k] === 'number' && v !== '' && v != null && !isNaN(Number(v)) ? Number(v) : v]),
    );
    if (Object.keys(body).length === 0) { message.warning('No changes to save'); return; }

    // Build the self link URL
    const selfLink = (updateItem?.links ?? []).find((x: any) => x.rel === 'self')?.href;
    if (!selfLink) { message.error('No item self link to update'); return; }

    setUpdatePayload(JSON.stringify(body, null, 2));
    setUpdateUrl(selfLink);
    setApiDrawerOpen(true);
  };

  const confirmUpdate = async () => {
    if (!updateItem || !updateUrl) return;
    const body = Object.fromEntries(
      Object.entries(updateEdits)
        .filter(([k]) => String(updateItem?.[k]) !== String(updateEdits[k]))
        .map(([k, v]) => [k, typeof updateItem?.[k] === 'number' && v !== '' && v != null && !isNaN(Number(v)) ? Number(v) : v]),
    );

    setUpdating(true);
    try {
      const r = await fetch(updateUrl, { method: 'PATCH', headers: RESITEM_HDRS, body: JSON.stringify(body) });
      const txt = await r.text();
      if (!r.ok) {
        message.error(`Update failed: HTTP ${r.status}`);
      } else {
        message.success('Item updated successfully');
        setUpdateItem(null);
        setUpdateEdits({});
        setApiDrawerOpen(false);
      }
    } catch (e: any) {
      message.error(`Error: ${e?.message ?? e}`);
    } finally {
      setUpdating(false);
    }
  };

  const cols: ColumnsType<any> = [
    { title: 'Item Number', dataIndex: 'ItemNumber', width: 140, render: v => <Text strong>{String(v ?? '')}</Text> },
    { title: 'Description', dataIndex: 'ItemDescription', width: 200, ellipsis: true, render: v => <Text style={{ fontSize: 12 }}>{v == null ? '—' : String(v)}</Text> },
    { title: 'Org', dataIndex: 'OrganizationCode', width: 70, render: v => <Tag>{String(v ?? '')}</Tag> },
    { title: 'UOM', dataIndex: 'PrimaryUOMValue', width: 70, render: (v, r) => v ?? r.PrimaryUnitOfMeasure ?? '—' },
    { title: 'Item Class', dataIndex: 'ItemClass', width: 100, ellipsis: true, render: v => <Text style={{ fontSize: 12 }}>{v ?? '—'}</Text> },
    { title: 'Lot Ctrl', key: 'lot', width: 70, render: (_: any, r: any) => <Text style={{ fontSize: 11 }}>{pfv(r, ['LotControlValue']) ?? '—'}</Text> },
    { title: 'Serial Ctrl', key: 'serial', width: 70, render: (_: any, r: any) => <Text style={{ fontSize: 11 }}>{pfv(r, ['SerialGenerationValue']) ?? '—'}</Text> },
    { title: 'Status', dataIndex: 'ItemStatusValue', width: 80, render: v => v ? <Tag color="blue" style={{ fontSize: 10 }}>{v}</Tag> : '—' },
    { title: 'Inventory Item', key: 'inv', width: 80, render: (_: any, r: any) => pfv(r, ['InventoryItemFlag']) === true || pfv(r, ['InventoryItemFlag']) === 'true' ? <Text style={{ fontSize: 11, color: REDWOOD.success }}>Yes</Text> : <Text style={{ fontSize: 11, color: REDWOOD.neutral600 }}>No</Text> },
    { title: 'Purchasable', key: 'purch', width: 80, render: (_: any, r: any) => pfv(r, ['PurchasableFlag']) === true || pfv(r, ['PurchasableFlag']) === 'true' ? <Text style={{ fontSize: 11, color: REDWOOD.success }}>Yes</Text> : <Text style={{ fontSize: 11, color: REDWOOD.neutral600 }}>No</Text> },
    { title: 'Shippable', key: 'ship', width: 75, render: (_: any, r: any) => pfv(r, ['ShippableItemFlag']) === true || pfv(r, ['ShippableItemFlag']) === 'true' ? <Text style={{ fontSize: 11, color: REDWOOD.success }}>Yes</Text> : <Text style={{ fontSize: 11, color: REDWOOD.neutral600 }}>No</Text> },
    { title: '', key: 'update', width: 80, fixed: 'right', render: (_: any, r: any) => (
        <Button size="small" icon={<EditOutlined />} onClick={() => openUpdateDialog(r)}
          style={{ color: REDWOOD.info, borderColor: REDWOOD.info }}>Update</Button>
      ) },
  ];

  return (
    <>
      <div>
        {rows.length === 0 ? (
          <Empty description="Run a search in the Search tab first" />
        ) : (
          <>
            <div style={{ marginBottom: 12 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {rows.length} item(s) available • {sel.length} selected
              </Text>
            </div>
            <Table size="small" rowKey={(r) => r.ItemNumber + ':' + r.OrganizationCode} columns={cols} dataSource={rows}
              rowSelection={{ selectedRowKeys: sel, onChange: setSel }}
              pagination={{ pageSize: 20, showSizeChanger: true }} scroll={{ x: 1000 }}
              locale={{ emptyText: 'No items' }} />
          </>
        )}
      </div>

      <Modal
        open={!!updateItem}
        onCancel={() => { if (!updating) setUpdateItem(null); }}
        width={700}
        title={<Space><ProfileOutlined style={{ color: REDWOOD.info }} />Update Additional Info — {updateItem?.ItemNumber} <Tag>{updateItem?.OrganizationCode}</Tag></Space>}
        footer={<Space>
          <Button onClick={() => setUpdateItem(null)} disabled={updating}>Close</Button>
          <Button type="primary" loading={updating} onClick={handleUpdateConfirm}
            style={{ background: REDWOOD.success, borderColor: REDWOOD.success }}>
            Review & Confirm
          </Button>
        </Space>}>
        {updateItem && (
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>Edit the fields below and click "Review & Confirm" to see the API payload.</Text>
            <Card size="small" title="Basic Information" style={{ marginTop: 10, borderRadius: 8 }} styles={{ body: { paddingBottom: 2 } }}>
              <Row gutter={12}>
                <Col xs={24} md={12}>
                  <div style={{ fontSize: 11, color: REDWOOD.neutral600, marginBottom: 2 }}>Item Class</div>
                  <Input size="small" value={updateEdits['ItemClass'] ?? updateItem['ItemClass'] ?? ''}
                    onChange={e => setUpdateEdits(p => ({ ...p, ItemClass: e.target.value }))} />
                </Col>
                <Col xs={24} md={12}>
                  <div style={{ fontSize: 11, color: REDWOOD.neutral600, marginBottom: 2 }}>Primary UOM</div>
                  <Input size="small" value={updateEdits['PrimaryUOMValue'] ?? updateItem['PrimaryUOMValue'] ?? updateItem['PrimaryUnitOfMeasure'] ?? ''}
                    onChange={e => setUpdateEdits(p => ({ ...p, PrimaryUOMValue: e.target.value }))} disabled />
                </Col>
              </Row>
            </Card>
            <Card size="small" title="Lot & Serial Control" style={{ marginTop: 10, borderRadius: 8 }} styles={{ body: { paddingBottom: 2 } }}>
              <Row gutter={12}>
                <Col xs={24} md={12}>
                  <div style={{ fontSize: 11, color: REDWOOD.neutral600, marginBottom: 2 }}>Lot Control Value</div>
                  <Input size="small" value={updateEdits['LotControlValue'] ?? updateItem['LotControlValue'] ?? ''}
                    onChange={e => setUpdateEdits(p => ({ ...p, LotControlValue: e.target.value }))} />
                </Col>
                <Col xs={24} md={12}>
                  <div style={{ fontSize: 11, color: REDWOOD.neutral600, marginBottom: 2 }}>Serial Generation Value</div>
                  <Input size="small" value={updateEdits['SerialGenerationValue'] ?? updateItem['SerialGenerationValue'] ?? ''}
                    onChange={e => setUpdateEdits(p => ({ ...p, SerialGenerationValue: e.target.value }))} />
                </Col>
              </Row>
            </Card>
            <Card size="small" title="Item Status & Type" style={{ marginTop: 10, borderRadius: 8 }} styles={{ body: { paddingBottom: 2 } }}>
              <Row gutter={12}>
                <Col xs={24} md={12}>
                  <div style={{ fontSize: 11, color: REDWOOD.neutral600, marginBottom: 2 }}>Item Status Value</div>
                  <Input size="small" value={updateEdits['ItemStatusValue'] ?? updateItem['ItemStatusValue'] ?? ''}
                    onChange={e => setUpdateEdits(p => ({ ...p, ItemStatusValue: e.target.value }))} />
                </Col>
                <Col xs={24} md={12}>
                  <div style={{ fontSize: 11, color: REDWOOD.neutral600, marginBottom: 2 }}>Lifecycle Phase Value</div>
                  <Input size="small" value={updateEdits['LifecyclePhaseValue'] ?? updateItem['LifecyclePhaseValue'] ?? ''}
                    onChange={e => setUpdateEdits(p => ({ ...p, LifecyclePhaseValue: e.target.value }))} />
                </Col>
              </Row>
            </Card>
            <Card size="small" title="Inventory & Ordering Flags" style={{ marginTop: 10, borderRadius: 8 }} styles={{ body: { paddingBottom: 2 } }}>
              <Row gutter={12}>
                <Col xs={24} md={12}>
                  <div style={{ fontSize: 11, color: REDWOOD.neutral600, marginBottom: 2 }}>Inventory Item Flag</div>
                  <Select size="small" style={{ width: '100%' }}
                    value={String(updateEdits['InventoryItemFlag'] ?? updateItem['InventoryItemFlag'] ?? '')}
                    onChange={v => setUpdateEdits(p => ({ ...p, InventoryItemFlag: v === 'true' }))}
                    options={[{ value: '', label: '— Not set —' }, { value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]} />
                </Col>
                <Col xs={24} md={12}>
                  <div style={{ fontSize: 11, color: REDWOOD.neutral600, marginBottom: 2 }}>Stock Enabled Flag</div>
                  <Select size="small" style={{ width: '100%' }}
                    value={String(updateEdits['StockEnabledFlag'] ?? updateItem['StockEnabledFlag'] ?? '')}
                    onChange={v => setUpdateEdits(p => ({ ...p, StockEnabledFlag: v === 'true' }))}
                    options={[{ value: '', label: '— Not set —' }, { value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]} />
                </Col>
                <Col xs={24} md={12}>
                  <div style={{ fontSize: 11, color: REDWOOD.neutral600, marginBottom: 2 }}>Purchasable Flag</div>
                  <Select size="small" style={{ width: '100%' }}
                    value={String(updateEdits['PurchasableFlag'] ?? updateItem['PurchasableFlag'] ?? '')}
                    onChange={v => setUpdateEdits(p => ({ ...p, PurchasableFlag: v === 'true' }))}
                    options={[{ value: '', label: '— Not set —' }, { value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]} />
                </Col>
                <Col xs={24} md={12}>
                  <div style={{ fontSize: 11, color: REDWOOD.neutral600, marginBottom: 2 }}>Shippable Item Flag</div>
                  <Select size="small" style={{ width: '100%' }}
                    value={String(updateEdits['ShippableItemFlag'] ?? updateItem['ShippableItemFlag'] ?? '')}
                    onChange={v => setUpdateEdits(p => ({ ...p, ShippableItemFlag: v === 'true' }))}
                    options={[{ value: '', label: '— Not set —' }, { value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]} />
                </Col>
              </Row>
            </Card>
          </div>
        )}
      </Modal>

      <Drawer
        title="API Inspector - Update Item"
        placement="right"
        onClose={() => setApiDrawerOpen(false)}
        open={apiDrawerOpen}
        width={600}
        footer={<Button type="primary" loading={updating} onClick={confirmUpdate} style={{ background: REDWOOD.success, borderColor: REDWOOD.success, width: '100%' }}>Confirm Update</Button>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div>
            <Paragraph>
              <Text strong>Update URL:</Text>
            </Paragraph>
            <div style={{ background: '#f5f5f5', padding: '8px', borderRadius: '4px', wordBreak: 'break-all', fontFamily: 'monospace', fontSize: '11px' }}>
              PATCH {updateUrl}
            </div>
          </div>

          <Divider />

          <div>
            <Paragraph>
              <Text strong>Request Payload:</Text>
            </Paragraph>
            <pre style={{
              background: '#f5f5f5',
              padding: '12px',
              borderRadius: '4px',
              maxHeight: '400px',
              overflow: 'auto',
              fontSize: '11px',
              fontFamily: 'monospace',
              lineHeight: '1.4',
            }}>
              {updatePayload}
            </pre>
          </div>

          <Divider />

          <div>
            <Paragraph>
              <Text strong>Headers:</Text>
            </Paragraph>
            <pre style={{
              background: '#f5f5f5',
              padding: '8px',
              borderRadius: '4px',
              fontSize: '11px',
              fontFamily: 'monospace',
            }}>
{`Content-Type: application/vnd.oracle.adf.resourceitem+json
Authorization: Basic [credentials]`}
            </pre>
          </div>
        </div>
      </Drawer>
    </>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Load tab — paste / excel → validate in MIM → create (reference copy) → assign orgs
// ─────────────────────────────────────────────────────────────────────────────
const LoadTab: React.FC<{ orgs: OrgOpt[] }> = ({ orgs }) => {
  const [mode, setMode] = useState<'paste' | 'excel'>('paste');
  const [pasteText, setPasteText] = useState('');
  const [rows, setRows] = useState<PasteRow[]>([]);
  const [validating, setValidating] = useState(false);

  // Parse pasted "item<tab/comma>description" lines into rows.
  const parsePaste = () => {
    const lines = pasteText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const out: PasteRow[] = lines.map((ln, i) => {
      const parts = ln.split(/\t|,|\s{2,}/).map(p => p.trim()).filter(p => p !== '');
      const itemNumber = parts[0] ?? '';
      const description = parts.slice(1).join(' ');
      return { key: `p-${i}-${itemNumber}`, itemNumber, description };
    }).filter(r => r.itemNumber && !/^item\s*(number|no|code)$/i.test(r.itemNumber));
    setRows(out);
  };

  const parseSheet = (file: File) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb = XLSX.read(e.target?.result, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const grid: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false });
        // Skip a header row if the first cell looks like a header.
        const start = grid.length && /item|code|number/i.test(String(grid[0]?.[0] ?? '')) ? 1 : 0;
        const out: PasteRow[] = grid.slice(start).map((r, i) => ({
          key: `x-${i}`, itemNumber: String(r[0] ?? '').trim(), description: String(r[1] ?? '').trim(),
        })).filter(r => r.itemNumber);
        setRows(out);
        message.success(`Loaded ${out.length} row(s) from ${file.name}`);
      } catch (er: any) { message.error(`Failed to read file: ${er?.message ?? er}`); }
    };
    reader.readAsArrayBuffer(file);
    return false;
  };

  // Validate each item's existence in the master org (MIM).
  const validate = async () => {
    if (!rows.length) return;
    setValidating(true);
    setRows(prev => prev.map(r => ({ ...r, checking: true, exists: undefined })));
    try {
      await mapLimit(rows, 6, async (r) => {
        const found = await getItem(r.itemNumber, MASTER_ORG);
        setRows(prev => prev.map(x => x.key === r.key ? { ...x, exists: !!found, checking: false,
          description: x.description || (found?.ItemDescription ?? '') } : x));
      });
    } finally { setValidating(false); }
  };

  const newItems = rows.filter(r => r.exists === false && r.itemNumber);
  const validated = rows.every(r => r.exists != null);

  const [wizardOpen, setWizardOpen] = useState(false);

  const cols: ColumnsType<PasteRow> = [
    { title: '#', width: 44, render: (_, __, i) => i + 1 },
    { title: 'Item Number', dataIndex: 'itemNumber', width: 200, render: v => <Text strong>{v}</Text> },
    { title: 'Description', dataIndex: 'description', render: (v, r) => (
        <Input size="small" value={v} placeholder="Description"
          onChange={e => setRows(prev => prev.map(x => x.key === r.key ? { ...x, description: e.target.value } : x))} />
      ) },
    { title: 'In MIM?', width: 130, align: 'center', render: (_, r) => {
        if (r.checking) return <Spin size="small" />;
        if (r.exists == null) return <Text type="secondary">—</Text>;
        return r.exists
          ? <Tag icon={<CheckCircleTwoTone twoToneColor={REDWOOD.warning} />} color="warning">Exists</Tag>
          : <Tag icon={<PlusOutlined />} color="green">New</Tag>;
      } },
    { title: '', width: 40, render: (_, r) => <Button size="small" type="text" danger icon={<CloseCircleTwoTone twoToneColor={REDWOOD.error} />}
        onClick={() => setRows(prev => prev.filter(x => x.key !== r.key))} /> },
  ];

  return (
    <div>
      <Tabs size="small" activeKey={mode} onChange={k => setMode(k as any)} items={[
        {
          key: 'paste', label: <span><CopyOutlined /> Copy / Paste</span>,
          children: (
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>Paste one item per line — <b>Item Number</b> then <b>Description</b>, separated by a tab, comma, or 2+ spaces (e.g. copied from Excel).</Text>
              <Input.TextArea rows={7} value={pasteText} onChange={e => setPasteText(e.target.value)} style={{ marginTop: 8, fontFamily: 'monospace', fontSize: 12 }}
                placeholder={'460-BDXV\tHDMI Cable 2m\n461-ABCV,Network Switch 24-port'} />
              <Button type="primary" style={{ marginTop: 8, background: REDWOOD.primary, borderColor: REDWOOD.primary }} onClick={parsePaste} disabled={!pasteText.trim()}>Parse {pasteText.trim() ? '' : ''}</Button>
            </div>
          ),
        },
        {
          key: 'excel', label: <span><UploadOutlined /> Load from CSV / Excel</span>,
          children: (
            <Upload.Dragger accept=".xlsx,.xls,.csv" multiple={false} showUploadList={false} beforeUpload={parseSheet}>
              <p className="ant-upload-drag-icon"><InboxOutlined style={{ color: REDWOOD.primary }} /></p>
              <p className="ant-upload-text">Click or drag a CSV/Excel file here</p>
              <p className="ant-upload-hint" style={{ fontSize: 12 }}>Column A = Item Number, Column B = Description (a header row is skipped automatically).</p>
            </Upload.Dragger>
          ),
        },
      ]} />

      {rows.length > 0 && (
        <Card size="small" style={{ marginTop: 12, borderRadius: 8 }}
          title={<Space><Text strong>{rows.length} item(s)</Text>
            {validated && <Tag color="green">{newItems.length} new</Tag>}
            {validated && <Tag color="warning">{rows.length - newItems.length} existing</Tag>}</Space>}
          extra={<Space>
            <Button icon={<ReloadOutlined />} loading={validating} onClick={validate}>Validate in MIM</Button>
            <Button type="primary" icon={<PlusOutlined />} disabled={!newItems.length}
              onClick={() => setWizardOpen(true)} style={newItems.length ? { background: REDWOOD.success, borderColor: REDWOOD.success } : undefined}>
              Create {newItems.length ? `(${newItems.length})` : ''}
            </Button>
          </Space>}>
          <Table size="small" rowKey="key" columns={cols} dataSource={rows} pagination={false} scroll={{ y: 340 }} />
        </Card>
      )}

      <CreateWizard open={wizardOpen} onClose={() => setWizardOpen(false)} items={newItems} orgs={orgs}
        onDone={() => validate()} />
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Create wizard — reference pick → org select → run (create in MIM + assign orgs)
// ─────────────────────────────────────────────────────────────────────────────
interface RunRow { key: string; itemNumber: string; description: string; master?: string; masterOk?: boolean; orgDone: number; orgTotal: number; errors: string[]; running?: boolean; }
const CreateWizard: React.FC<{ open: boolean; onClose: () => void; items: PasteRow[]; orgs: OrgOpt[]; onDone: () => void }> = ({ open, onClose, items, orgs, onDone }) => {
  const [step, setStep] = useState(0);
  const [refTerm, setRefTerm] = useState('');
  const [refOpts, setRefOpts] = useState<any[]>([]);
  const [refLoading, setRefLoading] = useState(false);
  const [refItem, setRefItem] = useState<any | null>(null);
  const [selOrgs, setSelOrgs] = useState<string[]>([]);
  const [runRows, setRunRows] = useState<RunRow[]>([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => { if (open) { setStep(0); setRefItem(null); setRefTerm(''); setRefOpts([]); setSelOrgs([]); setRunRows([]); setRunning(false); setDone(false); } }, [open]);

  const doRefSearch = useCallback(async (term: string) => {
    setRefLoading(true);
    try { setRefOpts(await searchMaster(term)); } catch { setRefOpts([]); } finally { setRefLoading(false); }
  }, []);
  useEffect(() => { if (open && step === 0) { const t = setTimeout(() => doRefSearch(refTerm), 350); return () => clearTimeout(t); } }, [refTerm, open, step, doRefSearch]);

  // Assignable child orgs (exclude the master org — the item is created there first).
  const childOrgs = orgs.filter(o => o.code !== MASTER_ORG);
  const allChildSelected = childOrgs.length > 0 && selOrgs.length === childOrgs.length;

  const run = async () => {
    setRunning(true); setDone(false);
    const initial: RunRow[] = items.map(it => ({ key: it.key, itemNumber: it.itemNumber, description: it.description, orgDone: 0, orgTotal: selOrgs.length, errors: [] }));
    setRunRows(initial);
    const patch = (key: string, p: Partial<RunRow>) => setRunRows(prev => prev.map(r => r.key === key ? { ...r, ...p } : r));
    for (const it of items) {
      patch(it.key, { running: true });
      // 1) Create in the master org from the reference item.
      const mres = await postItem(buildPayload(it.itemNumber, it.description, MASTER_ORG, refItem));
      if (!mres.ok) { patch(it.key, { master: `Failed (${mres.status})`, masterOk: false, running: false, errors: [errOf(mres)] }); continue; }
      patch(it.key, { master: 'Created', masterOk: true });
      // 2) Assign to each selected child org.
      let done = 0; const errs: string[] = [];
      for (const org of selOrgs) {
        const ores = await postItem(buildPayload(it.itemNumber, it.description, org, refItem));
        if (ores.ok) done++; else errs.push(`${org}: ${errOf(ores)}`);
        patch(it.key, { orgDone: done, errors: errs });
      }
      patch(it.key, { running: false });
    }
    setRunning(false); setDone(true); onDone();
  };

  const runCols: ColumnsType<RunRow> = [
    { title: 'Item', dataIndex: 'itemNumber', width: 170, render: v => <Text strong>{v}</Text> },
    { title: `Master (${MASTER_ORG})`, width: 120, render: (_, r) => r.running && !r.master ? <Spin size="small" />
        : r.master ? <Tag color={r.masterOk ? 'green' : 'red'}>{r.master}</Tag> : <Text type="secondary">—</Text> },
    { title: 'Orgs assigned', width: 160, render: (_, r) => r.orgTotal ? <Progress percent={Math.round((r.orgDone / r.orgTotal) * 100)} size="small" format={() => `${r.orgDone}/${r.orgTotal}`} status={r.errors.length ? 'exception' : undefined} /> : '—' },
    { title: 'Errors', render: (_, r) => r.errors.length ? <Tooltip title={r.errors.join('\n')}><Text type="danger" style={{ fontSize: 11 }}>{r.errors[0]}{r.errors.length > 1 ? ` (+${r.errors.length - 1})` : ''}</Text></Tooltip> : <Text type="secondary">—</Text> },
  ];

  return (
    <Modal open={open} onCancel={() => { if (!running) onClose(); }} width={860} maskClosable={false}
      title={<Space><PlusOutlined style={{ color: REDWOOD.success }} />Create {items.length} New Item(s)</Space>}
      footer={
        step === 0 ? <Space><Button onClick={onClose}>Cancel</Button>
          <Button type="primary" disabled={!refItem} onClick={() => setStep(1)} style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}>Next: Organizations</Button></Space>
        : step === 1 ? <Space><Button onClick={() => setStep(0)}>Back</Button>
          <Button type="primary" onClick={() => setStep(2)} style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}>Next: Review &amp; Run</Button></Space>
        : done ? <Button onClick={onClose}>Close</Button>
        : <Space><Button onClick={() => setStep(1)} disabled={running}>Back</Button>
          <Button type="primary" loading={running} onClick={run} style={{ background: REDWOOD.success, borderColor: REDWOOD.success }}>Run — create {items.length} item(s)</Button></Space>
      }>
      <Steps size="small" current={step} style={{ marginBottom: 16 }}
        items={[{ title: 'Reference Item' }, { title: 'Organizations' }, { title: 'Review & Run' }]} />

      {step === 0 && (
        <div>
          <Alert type="info" showIcon style={{ marginBottom: 12 }}
            message="Pick an existing item to copy" description={`The new items are created in the master org (${MASTER_ORG}) by cloning this reference item's item class and attributes — only the Item Number and Description change.`} />
          <Select showSearch style={{ width: '100%' }} placeholder="Search an item in MIM to use as reference…"
            filterOption={false} onSearch={setRefTerm} loading={refLoading} notFoundContent={refLoading ? <Spin size="small" /> : 'Type to search'}
            value={refItem?.ItemNumber} onChange={(_, opt: any) => setRefItem(opt?.item ?? null)}
            options={refOpts.map(it => ({ value: it.ItemNumber, label: `${it.ItemNumber} — ${it.ItemDescription ?? ''}`, item: it }))} />
          {refItem && (
            <Card size="small" style={{ marginTop: 12, background: REDWOOD.neutral100 }}>
              <Row gutter={[12, 6]}>
                <Col span={12}><Text type="secondary" style={{ fontSize: 12 }}>Item Class</Text><div><Text strong>{refItem.ItemClass ?? '—'}</Text></div></Col>
                <Col span={6}><Text type="secondary" style={{ fontSize: 12 }}>UOM</Text><div>{refItem.PrimaryUOMValue ?? refItem.PrimaryUnitOfMeasure ?? '—'}</div></Col>
                <Col span={6}><Text type="secondary" style={{ fontSize: 12 }}>Status</Text><div>{refItem.ItemStatusValue ?? '—'}</div></Col>
              </Row>
              <div style={{ marginTop: 6, fontSize: 11, color: REDWOOD.neutral600 }}>Copied fields: {COPY_FIELDS.filter(f => refItem[f] != null && refItem[f] !== '').join(', ') || '(none found on reference)'}</div>
            </Card>
          )}
        </div>
      )}

      {step === 1 && (
        <div>
          <Alert type="info" showIcon style={{ marginBottom: 12 }}
            message="Assign to organizations" description={`After creation in ${MASTER_ORG}, the item is assigned to each selected organization.`} />
          <Space style={{ marginBottom: 8 }}>
            <Checkbox checked={allChildSelected} indeterminate={selOrgs.length > 0 && !allChildSelected}
              onChange={e => setSelOrgs(e.target.checked ? childOrgs.map(o => o.code) : [])}>Select all ({childOrgs.length})</Checkbox>
            <Text type="secondary" style={{ fontSize: 12 }}>{selOrgs.length} selected</Text>
          </Space>
          <div style={{ maxHeight: 300, overflow: 'auto', border: `1px solid ${REDWOOD.neutral200}`, borderRadius: 6, padding: 8 }}>
            <Checkbox.Group value={selOrgs} onChange={v => setSelOrgs(v as string[])} style={{ width: '100%' }}>
              <Row>{childOrgs.map(o => <Col xs={24} sm={12} md={8} key={o.code} style={{ padding: '2px 0' }}>
                <Checkbox value={o.code}><Text style={{ fontSize: 12 }}>{o.code}{o.name ? ` — ${o.name}` : ''}</Text></Checkbox></Col>)}</Row>
            </Checkbox.Group>
          </div>
        </div>
      )}

      {step === 2 && (
        <div>
          <Alert type={done ? (runRows.some(r => !r.masterOk || r.errors.length) ? 'warning' : 'success') : 'info'} showIcon style={{ marginBottom: 12 }}
            message={done ? 'Completed' : `Ready to create ${items.length} item(s) in ${MASTER_ORG} and assign to ${selOrgs.length} org(s)`}
            description={done ? undefined : `Reference: ${refItem?.ItemNumber ?? '—'} (${refItem?.ItemClass ?? 'no class'})`} />
          <Table size="small" rowKey="key" columns={runCols}
            dataSource={runRows.length ? runRows : items.map(it => ({ key: it.key, itemNumber: it.itemNumber, description: it.description, orgDone: 0, orgTotal: selOrgs.length, errors: [] }))}
            pagination={false} scroll={{ y: 320 }} />
        </div>
      )}
    </Modal>
  );
};

// Contain render errors so a crash shows the message instead of white-screening.
class TabErrorBoundary extends React.Component<{ children: React.ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { /* eslint-disable-next-line no-console */ console.error('ItemLoading render error:', error); }
  render() {
    if (this.state.error) return (
      <Alert type="error" showIcon message="This view hit an error" style={{ margin: 12 }}
        description={<pre style={{ whiteSpace: 'pre-wrap', fontSize: 11, margin: 0, maxHeight: 260, overflow: 'auto' }}>{String(this.state.error?.stack || this.state.error?.message || this.state.error)}</pre>} />
    );
    return this.props.children as React.ReactElement;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
const ItemLoading: React.FC = () => {
  const [orgs, setOrgs] = useState<OrgOpt[]>([]);
  const [orgsLoading, setOrgsLoading] = useState(true);
  const [tab, setTab] = useState('load');
  const [searchRows, setSearchRows] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      setOrgsLoading(true);
      try {
        const all: OrgOpt[] = []; let offset = 0;
        while (true) {
          const d = await fetchJson(`${FUSION_BASE}/inventoryOrganizations?onlyData=true&limit=500&offset=${offset}&fields=OrganizationCode,OrganizationName`);
          const items = d?.items ?? [];
          items.forEach((o: any) => { if (o.OrganizationCode) all.push({ code: o.OrganizationCode, name: o.OrganizationName ?? '' }); });
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
          { title: 'Item Loading' },
        ]} />
        <div style={{ marginBottom: 12 }}>
          <Title level={4} style={{ margin: 0 }}><UploadOutlined style={{ color: REDWOOD.primary, marginRight: 8 }} />Item Loading</Title>
          <Text type="secondary" style={{ fontSize: 13 }}>Search items, or bulk-load new items into the master org ({MASTER_ORG}) from a reference item and assign them to organizations.</Text>
          {orgsLoading && <Spin size="small" style={{ marginLeft: 10 }} />}
          {!orgsLoading && <Tag style={{ marginLeft: 10 }}>{orgs.length} orgs</Tag>}
        </div>
        <Card style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}` }}>
          <TabErrorBoundary>
            <Tabs activeKey={tab} onChange={setTab} items={[
              { key: 'search', label: <span><SearchOutlined /> Search</span>, children: <SearchTab orgs={orgs} onRowsChange={setSearchRows} /> },
              { key: 'additional', label: <span><InfoCircleOutlined /> Additional Info</span>, children: <AdditionalInfoTab rows={searchRows} /> },
              { key: 'dff', label: <span><InfoCircleOutlined /> Additional Info - DFF</span>, children: <DFFTab rows={searchRows} /> },
              { key: 'eff', label: <span><InfoCircleOutlined /> Additional Info - EFF</span>, children: <EFFTab rows={searchRows} /> },
              { key: 'load', label: <span><UploadOutlined /> Load</span>, children: <LoadTab orgs={orgs} /> },
            ]} />
          </TabErrorBoundary>
        </Card>
      </Content>
    </Layout>
  );
};

export default ItemLoading;
