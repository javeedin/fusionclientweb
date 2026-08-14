import { buildApexUrl } from '../../config/api.helper';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Layout, Breadcrumb, Typography, Card, Table, Input, Row, Col,
  Tag, Select, Drawer, List, Badge, Tabs, Button, Form, Descriptions,
  Space, Alert, Modal, message, Tooltip, Spin, Collapse, Progress, Segmented,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  HomeOutlined, AppstoreOutlined, SearchOutlined, CloseOutlined,
  EditOutlined, ReloadOutlined, TagsOutlined, StopOutlined,
  ApiOutlined, CopyOutlined, DownloadOutlined, DownOutlined, UpOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';

const { Content } = Layout;
const { Title, Text } = Typography;

const ORDS_BASE = buildApexUrl('test/FUSIONCLIENTERP');
const FUSION_BASE  = 'https://iacney-test.fa.ocs.oraclecloud.com/fscmRestApi/resources/11.13.18.05';
const AUTH_HEADER  = 'Basic ' + btoa('emparun:Fusion@1234');
const FUSION_HDRS  = { Authorization: AUTH_HEADER, Accept: 'application/json' };

const REDWOOD = {
  primary: '#C74634', primaryDark: '#A33B2C',
  success: '#1D7B4D', warning: '#D4A800', info: '#0572CE', error: '#D93025',
  neutral100: '#F7F7F7', neutral200: '#E5E5E5', neutral300: '#C7C7C7',
  neutral600: '#6B6B6B', neutral900: '#1A1A1A', surface: '#FFFFFF',
  teal: '#00918A',
};

const ATTR_LABELS: Record<string, string> = {
  attribute1: 'Brand', attribute2: 'Type', attribute3: 'RMA',
  attribute4: 'Rep Status', attribute5: 'Category',
  attribute6: 'Attr 6', attribute7: 'Attr 7', attribute8: 'Attr 8',
  attribute9: 'Attr 9', attribute10: 'Attr 10',
};

interface ItemRow {
  inventory_item_id: string;
  item_number: string;
  description: string;
  primary_uom_code: string;
  inventory_item_status_code: string;
  organization_code: string;
  inventory_org_code: string | null;
  sales_account: string;
  item_price: string;
  barcode: string | null;
  old_item_code: string;
  inventory_item_flag: string;
  stock_enabled_flag: string;
  inventory_asset_flag: string;
  attribute1: string; attribute2: string; attribute3: string;
  attribute4: string; attribute5: string; attribute6: string;
  attribute7: string; attribute8: string; attribute9: string;
  attribute10: string;
  instance_name: string | null;
}

interface OrgOption { label: string; value: string; }
interface EditTab   { key: string; item: ItemRow; }

// Map a Fusion itemsV2 row onto the ItemRow shape (ORDS/APEX field names). Fields
// the Fusion resource doesn't carry (price, sales account, barcode, DFF attrs) are
// left blank so the same table/columns render for both sources.
const pfv = (o: any, keys: string[]) => { for (const k of keys) { if (o?.[k] != null && o[k] !== '') return o[k]; } return undefined; };
const mapFusionItem = (it: any): ItemRow => ({
  inventory_item_id: String(pfv(it, ['ItemId', 'InventoryItemId']) ?? ''),
  item_number:       pfv(it, ['ItemNumber']) ?? '',
  description:       pfv(it, ['ItemDescription', 'Description']) ?? '',
  primary_uom_code:  pfv(it, ['PrimaryUOMValue', 'PrimaryUnitOfMeasureValue', 'PrimaryUOMCode', 'PrimaryUnitOfMeasure']) ?? '',
  inventory_item_status_code: pfv(it, ['ItemStatusValue', 'ItemStatus', 'ApprovalStatusValue']) ?? '',
  organization_code: pfv(it, ['OrganizationCode']) ?? '',
  inventory_org_code: pfv(it, ['OrganizationCode']) ?? null,
  sales_account:     '',
  item_price:        String(pfv(it, ['ListPrice', 'UnitPrice']) ?? ''),
  barcode:           null,
  old_item_code:     '',
  inventory_item_flag:  String(pfv(it, ['InventoryItemFlag']) ?? ''),
  stock_enabled_flag:   String(pfv(it, ['StockEnabledFlag']) ?? ''),
  inventory_asset_flag: String(pfv(it, ['InventoryAssetFlag']) ?? ''),
  attribute1: String(pfv(it, ['Attribute1']) ?? ''), attribute2: String(pfv(it, ['Attribute2']) ?? ''), attribute3: String(pfv(it, ['Attribute3']) ?? ''),
  attribute4: String(pfv(it, ['Attribute4']) ?? ''), attribute5: String(pfv(it, ['Attribute5']) ?? ''), attribute6: String(pfv(it, ['Attribute6']) ?? ''),
  attribute7: String(pfv(it, ['Attribute7']) ?? ''), attribute8: String(pfv(it, ['Attribute8']) ?? ''), attribute9: String(pfv(it, ['Attribute9']) ?? ''),
  attribute10: String(pfv(it, ['Attribute10']) ?? ''),
  instance_name: null,
});

// ── Edit Item Panel ───────────────────────────────────────────────────────────
const EditItemPanel: React.FC<{ item: ItemRow }> = ({ item }) => {
  const flagTag = (v: string) =>
    v === 'Y' ? <Tag color="success">Yes</Tag> : <Tag color="default">{v || 'No'}</Tag>;

  const section = (title: string, children: React.ReactNode) => (
    <div style={{ marginBottom: 20 }}>
      <div style={{
        fontSize: 11, fontWeight: 700, color: REDWOOD.neutral600, textTransform: 'uppercase',
        letterSpacing: '0.06em', marginBottom: 10, paddingBottom: 4,
        borderBottom: `2px solid ${REDWOOD.neutral200}`,
      }}>{title}</div>
      {children}
    </div>
  );

  return (
    <div style={{ padding: '0 4px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>{item.item_number}</Title>
          <Text type="secondary" style={{ fontSize: 13 }}>{item.description}</Text>
        </div>
        <Tag style={{ borderRadius: 10, fontSize: 12 }}
          color={item.inventory_item_status_code === 'Active' ? 'success' : 'error'}>
          {item.inventory_item_status_code}
        </Tag>
      </div>

      {section('Basic Information',
        <Descriptions size="small" bordered column={3}
          labelStyle={{ fontWeight: 600, fontSize: 12, background: REDWOOD.neutral100 }}
          contentStyle={{ fontSize: 12 }}>
          <Descriptions.Item label="Item Number">{item.item_number || '—'}</Descriptions.Item>
          <Descriptions.Item label="Old Item Code">{item.old_item_code || '—'}</Descriptions.Item>
          <Descriptions.Item label="Barcode">{item.barcode || '—'}</Descriptions.Item>
          <Descriptions.Item label="Description" span={2}>{item.description || '—'}</Descriptions.Item>
          <Descriptions.Item label="UOM">{item.primary_uom_code || '—'}</Descriptions.Item>
          <Descriptions.Item label="Organization">{item.organization_code || '—'}</Descriptions.Item>
          <Descriptions.Item label="Inv Org Code">{item.inventory_org_code || '—'}</Descriptions.Item>
          <Descriptions.Item label="Instance">{item.instance_name || '—'}</Descriptions.Item>
        </Descriptions>
      )}

      {section('Pricing & Accounting',
        <Descriptions size="small" bordered column={3}
          labelStyle={{ fontWeight: 600, fontSize: 12, background: REDWOOD.neutral100 }}
          contentStyle={{ fontSize: 12 }}>
          <Descriptions.Item label="Item Price">
            {item.item_price?.trim()
              ? <Text strong style={{ color: REDWOOD.success }}>{item.item_price.trim()}</Text>
              : '—'}
          </Descriptions.Item>
          <Descriptions.Item label="Sales Account">{item.sales_account?.trim() || '—'}</Descriptions.Item>
          <Descriptions.Item label="Status">
            <Tag color={item.inventory_item_status_code === 'Active' ? 'success' : 'error'} style={{ borderRadius: 10 }}>
              {item.inventory_item_status_code}
            </Tag>
          </Descriptions.Item>
        </Descriptions>
      )}

      {section('Inventory Flags',
        <Descriptions size="small" bordered column={3}
          labelStyle={{ fontWeight: 600, fontSize: 12, background: REDWOOD.neutral100 }}
          contentStyle={{ fontSize: 12 }}>
          <Descriptions.Item label="Inventory Item">{flagTag(item.inventory_item_flag)}</Descriptions.Item>
          <Descriptions.Item label="Stock Enabled">{flagTag(item.stock_enabled_flag)}</Descriptions.Item>
          <Descriptions.Item label="Inventory Asset">{flagTag(item.inventory_asset_flag)}</Descriptions.Item>
        </Descriptions>
      )}

      {section('Attributes',
        <Descriptions size="small" bordered column={3}
          labelStyle={{ fontWeight: 600, fontSize: 12, background: REDWOOD.neutral100 }}
          contentStyle={{ fontSize: 12 }}>
          {[1,2,3,4,5,6,7,8,9,10].map(n => (
            <Descriptions.Item key={n} label={ATTR_LABELS[`attribute${n}`] ?? `Attr ${n}`}>
              {(item as any)[`attribute${n}`] || '—'}
            </Descriptions.Item>
          ))}
        </Descriptions>
      )}
    </div>
  );
};

// ── Main Page ─────────────────────────────────────────────────────────────────
const ItemMaster: React.FC = () => {
  const [form] = Form.useForm();

  // organizations
  const [orgs, setOrgs]           = useState<OrgOption[]>([]);
  const [orgsLoading, setOrgsLoading] = useState(true);
  const [orgsError, setOrgsError] = useState('');

  // search
  const [searching, setSearching]   = useState(false);
  const [searchError, setSearchError] = useState('');
  const [results, setResults]       = useState<ItemRow[]>([]);
  const [searched, setSearched]     = useState(false);
  const [lastUrl, setLastUrl]       = useState('');
  const [fetchPage, setFetchPage]   = useState(0);
  const [fetchCount, setFetchCount] = useState(0);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [paramsOpen, setParamsOpen] = useState(true);
  const [exporting, setExporting]   = useState(false);
  const [tableFilter, setTableFilter] = useState('');

  // attribute drawer
  const [drawer, setDrawer] = useState<{ open: boolean; label: string; values: { value: string; count: number }[] }>({
    open: false, label: '', values: [],
  });

  // API debug modal
  const [apiOpen, setApiOpen]       = useState(false);
  const [apiLoading, setApiLoading] = useState(false);
  const [apiResponse, setApiResponse] = useState<any>(null);
  const [apiError, setApiError]     = useState('');

  // tabs
  const [activeTabKey, setActiveTabKey] = useState('search');
  const [editTabs, setEditTabs]         = useState<EditTab[]>([]);
  // Data source: APEX (ORDS) — default — or Fusion (itemsV2).
  const [source, setSource] = useState<'apex' | 'fusion'>('apex');

  const abortRef = useRef<AbortController | null>(null);

  // ── Load organizations on mount ──────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      try {
        const all: any[] = [];
        let offset = 0;
        while (true) {
          const r = await fetch(
            `${FUSION_BASE}/inventoryOrganizations?limit=500&offset=${offset}`,
            { headers: FUSION_HDRS },
          );
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const d = await r.json();
          const items = d.items ?? [];
          all.push(...items);
          if (!d.hasMore || items.length < 500) break;
          offset += 500;
        }
        const opts: OrgOption[] = all
          .map((o: any) => ({
            label: o.OrganizationCode
              ? `${o.OrganizationCode}${o.OrganizationName ? ' — ' + o.OrganizationName : ''}`
              : String(o.OrganizationCode ?? o.organizationCode ?? ''),
            value: o.OrganizationCode ?? o.organizationCode ?? '',
          }))
          .filter(o => o.value)
          .sort((a, b) => a.value.localeCompare(b.value));
        setOrgs(opts);
      } catch (e: any) {
        setOrgsError(e.message);
      } finally {
        setOrgsLoading(false);
      }
    };
    load();
  }, []);

  // ── Build search URL from form values ────────────────────────────────────────
  const buildUrl = useCallback((vals: any, limit = 500, offset = 0): string => {
    if (source === 'fusion') {
      // Fusion itemsV2 — filter by org + item/description/status via the q parameter.
      // Fusion itemsV2 q syntax: unquoted values, LIKE with a trailing % (prefix match),
      // and no function calls (upper() etc. are rejected).
      const q: string[] = [];
      if (vals.org)         q.push(`OrganizationCode=${vals.org}`);
      if (vals.itemNumber)  q.push(`ItemNumber LIKE ${String(vals.itemNumber)}%`);
      if (vals.description) q.push(`ItemDescription LIKE ${String(vals.description)}%`);
      if (vals.status)      q.push(`ItemStatusValue=${vals.status}`);
      const p = new URLSearchParams();
      p.set('limit', String(limit));
      p.set('offset', String(offset));
      p.set('onlyData', 'true');
      p.set('totalResults', 'true');
      if (q.length) p.set('q', q.join(';'));
      return `${FUSION_BASE}/itemsV2?${p.toString()}`;
    }
    const p = new URLSearchParams();
    p.set('limit', String(limit));
    p.set('offset', String(offset));
    if (vals.org)         p.set('org', vals.org);
    if (vals.itemNumber)  p.set('code', vals.itemNumber);
    if (vals.description) p.set('description', vals.description);
    if (vals.status)      p.set('status', vals.status);
    if (vals.barcode)     p.set('barcode', vals.barcode);
    if (vals.search)      p.set('search', vals.search);
    if (vals.attr1)       p.set('attr1', vals.attr1);
    if (vals.attr2)       p.set('attr2', vals.attr2);
    if (vals.attr3)       p.set('attr3', vals.attr3);
    if (vals.attr4)       p.set('attr4', vals.attr4);
    if (vals.attr5)       p.set('attr5', vals.attr5);
    return `${ORDS_BASE}/inventory/itemmaster?${p.toString()}`;
  }, [source]);

  // ── Search handler ───────────────────────────────────────────────────────────
  const handleSearch = useCallback(async () => {
    const vals = form.getFieldsValue();
    if (!vals.org) {
      message.warning('Organization is required. Please select an organization.');
      return;
    }

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setSearching(true);
    setSearchError('');
    setFetchPage(0);
    setFetchCount(0);
    setTotalCount(null);
    setTableFilter('');
    setParamsOpen(false);

    const url = buildUrl(vals);
    setLastUrl(url);

    try {
      const all: ItemRow[] = [];
      let offset = 0;
      let page = 1;
      while (true) {
        if (ctrl.signal.aborted) break;
        const pageUrl = buildUrl(vals, 500, offset);
        const r = await fetch(pageUrl, { signal: ctrl.signal, ...(source === 'fusion' ? { headers: FUSION_HDRS } : {}) });
        if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
        const d = await r.json();
        const raw: any[] = d.items ?? (Array.isArray(d) ? d : []);
        const items: ItemRow[] = source === 'fusion' ? raw.map(mapFusionItem) : raw;
        all.push(...items);
        if (d.count != null) setTotalCount(d.count);
        setFetchPage(page);
        setFetchCount(all.length);
        if (!d.hasMore || items.length < 500) break;
        offset += 500;
        page++;
      }
      setResults(all);
      setSearched(true);
    } catch (e: any) {
      if (e.name !== 'AbortError') setSearchError(e.message);
    } finally {
      setSearching(false);
    }
  }, [form, buildUrl, source]);

  const handleCancel = () => abortRef.current?.abort();

  const handleReset = () => {
    form.resetFields();
    setResults([]);
    setSearched(false);
    setSearchError('');
    setLastUrl('');
    setParamsOpen(true);
  };

  // ── Export to Excel ──────────────────────────────────────────────────────────
  const handleExport = useCallback(async () => {
    if (!results.length) return;
    setExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Item Master');

      const headerFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF203864' } };
      const white  = { argb: 'FFFFFFFF' };
      const numFmt = '#,##0.00';

      const cols = [
        'Item Number', 'Description', 'Old Item Code', 'Barcode',
        'Org Code', 'Inv Org Code', 'UOM', 'Status',
        'Price', 'Sales Account',
        'Inv Flag', 'Stock Flag', 'Asset Flag',
        'Brand', 'Type', 'RMA', 'Rep Status', 'Category',
        'Attr 6', 'Attr 7', 'Attr 8', 'Attr 9', 'Attr 10',
        'Instance',
      ];

      // Title row
      ws.mergeCells(1, 1, 1, cols.length);
      const titleCell = ws.getCell(1, 1);
      titleCell.value = `Item Master — ${form.getFieldValue('org') ?? ''}`;
      titleCell.font = { bold: true, size: 13, color: white };
      titleCell.fill = headerFill;
      titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
      ws.getRow(1).height = 22;

      // Filter summary row
      ws.mergeCells(2, 1, 2, cols.length);
      const vals = form.getFieldsValue();
      const filters = [
        vals.itemNumber  && `Item: ${vals.itemNumber}`,
        vals.description && `Desc: ${vals.description}`,
        vals.status      && `Status: ${vals.status}`,
        vals.search      && `Search: ${vals.search}`,
      ].filter(Boolean).join('  |  ');
      ws.getCell(2, 1).value = filters || 'All items';
      ws.getCell(2, 1).font = { italic: true, size: 10, color: { argb: 'FF444444' } };
      ws.getCell(2, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF3FA' } };
      ws.getRow(2).height = 16;

      // Stats row
      ws.mergeCells(3, 1, 3, cols.length);
      ws.getCell(3, 1).value = `Exported: ${new Date().toLocaleString()}  |  Records: ${results.length.toLocaleString()}`;
      ws.getCell(3, 1).font = { size: 10, color: { argb: 'FF666666' } };
      ws.getCell(3, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF3FA' } };

      // Column headers
      cols.forEach((label, i) => {
        const cell = ws.getCell(4, i + 1);
        cell.value = label;
        cell.fill = headerFill;
        cell.font = { bold: true, size: 10, color: white };
        cell.alignment = { horizontal: 'center' };
        cell.border = { bottom: { style: 'thin', color: { argb: 'FFFFFFFF' } } };
      });
      ws.getRow(4).height = 16;

      // Data rows
      const evenFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F7F7' } };
      results.forEach((row, idx) => {
        const r = ws.addRow([
          row.item_number, row.description, row.old_item_code, row.barcode ?? '',
          row.organization_code, row.inventory_org_code ?? '', row.primary_uom_code,
          row.inventory_item_status_code,
          row.item_price?.trim() ? parseFloat(row.item_price) : null,
          row.sales_account?.trim() ?? '',
          row.inventory_item_flag, row.stock_enabled_flag, row.inventory_asset_flag,
          row.attribute1, row.attribute2, row.attribute3, row.attribute4, row.attribute5,
          row.attribute6, row.attribute7, row.attribute8, row.attribute9, row.attribute10,
          row.instance_name ?? '',
        ]);
        r.font = { size: 10 };
        if (idx % 2 === 1) r.fill = evenFill;
        // price column (col 9)
        const priceCell = r.getCell(9);
        if (priceCell.value != null) priceCell.numFmt = numFmt;
      });

      // Column widths
      const widths = [16, 40, 16, 14, 10, 12, 8, 12, 10, 16, 9, 9, 9, 14, 12, 10, 12, 12, 10, 10, 10, 10, 10, 14];
      ws.columns.forEach((col, i) => { col.width = widths[i] ?? 12; });

      // Freeze header rows
      ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 4, activeCell: 'A5' }];

      const buf = await wb.xlsx.writeBuffer();
      const org = form.getFieldValue('org') ?? 'items';
      saveAs(new Blob([buf]), `ItemMaster_${org}_${new Date().toISOString().slice(0,10)}.xlsx`);
    } catch (e: any) {
      message.error(`Export failed: ${e.message}`);
    } finally {
      setExporting(false);
    }
  }, [results, form]);

  // ── Attribute drawer ─────────────────────────────────────────────────────────
  const openDrawer = (attrKey: string) => {
    const map = new Map<string, number>();
    results.forEach(row => {
      const v = String((row as any)[attrKey] ?? '').trim() || '(blank)';
      map.set(v, (map.get(v) ?? 0) + 1);
    });
    const values = Array.from(map.entries())
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count);
    setDrawer({ open: true, label: ATTR_LABELS[attrKey] ?? attrKey, values });
  };

  // ── Edit tabs ────────────────────────────────────────────────────────────────
  const openEditTab = (item: ItemRow) => {
    const key = `edit-${item.inventory_item_id}`;
    if (editTabs.some(t => t.key === key)) { setActiveTabKey(key); return; }
    setEditTabs(prev => [...prev, { key, item }]);
    setActiveTabKey(key);
  };

  const closeEditTab = (targetKey: string) => {
    const newTabs = editTabs.filter(t => t.key !== targetKey);
    setEditTabs(newTabs);
    if (activeTabKey === targetKey)
      setActiveTabKey(newTabs.length > 0 ? newTabs[newTabs.length - 1].key : 'search');
  };

  // ── Columns ──────────────────────────────────────────────────────────────────
  const columns: ColumnsType<ItemRow> = [
    {
      title: 'Item Number', dataIndex: 'item_number', key: 'item_number',
      width: 140, fixed: 'left', ellipsis: true,
      render: v => <Text code style={{ fontSize: 11 }}>{v}</Text>,
    },
    { title: 'Description', dataIndex: 'description', key: 'description', width: 280, ellipsis: true },
    { title: 'Org', dataIndex: 'organization_code', key: 'org', width: 70, align: 'center' },
    { title: 'UOM', dataIndex: 'primary_uom_code', key: 'uom', width: 65, align: 'center' },
    {
      title: 'Status', dataIndex: 'inventory_item_status_code', key: 'status', width: 90,
      render: (v: string) => (
        <Tag style={{ borderRadius: 10, fontSize: 11 }} color={v === 'Active' ? 'success' : 'error'}>{v || '—'}</Tag>
      ),
    },
    {
      title: 'Price', dataIndex: 'item_price', key: 'price', width: 80, align: 'right',
      render: v => v?.trim() || '—',
    },
    {
      title: 'Inv', dataIndex: 'inventory_item_flag', key: 'inv', width: 55, align: 'center',
      render: v => v === 'Y' ? <Tag color="success" style={{ fontSize: 10, margin: 0 }}>Y</Tag> : <Text type="secondary">—</Text>,
    },
    {
      title: 'Stock', dataIndex: 'stock_enabled_flag', key: 'stock', width: 60, align: 'center',
      render: v => v === 'Y' ? <Tag color="success" style={{ fontSize: 10, margin: 0 }}>Y</Tag> : <Text type="secondary">—</Text>,
    },
    { title: 'Brand',      dataIndex: 'attribute1', key: 'a1', width: 110, ellipsis: true, render: v => v || '—' },
    { title: 'Type',       dataIndex: 'attribute2', key: 'a2', width: 100, ellipsis: true, render: v => v || '—' },
    { title: 'RMA',        dataIndex: 'attribute3', key: 'a3', width: 80,  render: v => v || '—' },
    { title: 'Rep Status', dataIndex: 'attribute4', key: 'a4', width: 100, render: v => v || '—' },
    { title: 'Category',   dataIndex: 'attribute5', key: 'a5', width: 100, render: v => v || '—' },
    {
      title: '', key: 'actions', width: 80, fixed: 'right',
      render: (_: any, record: ItemRow) => (
        <Button size="small" icon={<EditOutlined />} onClick={() => openEditTab(record)}
          style={{ fontSize: 11, color: REDWOOD.info, borderColor: REDWOOD.info }}>
          Edit
        </Button>
      ),
    },
  ];

  // ── Status options (derived from current results once searched) ───────────────
  const statusOptions = searched
    ? Array.from(new Set(results.map(r => r.inventory_item_status_code).filter(Boolean)))
        .sort().map(v => ({ label: v, value: v }))
    : [
        { label: 'Active',   value: 'Active' },
        { label: 'Inactive', value: 'Inactive' },
        { label: 'Obsolete', value: 'Obsolete' },
      ];

  // ── KPI cards from current results ───────────────────────────────────────────
  const kpiAttrs = ['attribute1', 'attribute2', 'attribute3', 'attribute4', 'attribute5'];

  // ── Search tab content ───────────────────────────────────────────────────────
  const searchTabContent = (
    <div>
      {/* KPI cards — shown after a search */}
      {searched && results.length > 0 && (
        <Row gutter={[12, 12]} style={{ marginBottom: 20 }}>
          <Col xs={12} sm={8} md={4}>
            <Card style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}`, textAlign: 'center' }}
              styles={{ body: { padding: '12px 10px' } }}>
              <Text style={{ fontSize: 22, fontWeight: 700, color: REDWOOD.success, display: 'block' }}>
                {results.length.toLocaleString()}
              </Text>
              <Text type="secondary" style={{ fontSize: 11 }}>Items Found</Text>
            </Card>
          </Col>
          {kpiAttrs.map(attr => {
            const set = new Set(results.map(r => (r as any)[attr]).filter(Boolean));
            return (
              <Col xs={12} sm={8} md={4} key={attr}>
                <Card hoverable onClick={() => openDrawer(attr)}
                  style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}`, textAlign: 'center', cursor: 'pointer' }}
                  styles={{ body: { padding: '12px 10px' } }}>
                  <Text style={{ fontSize: 22, fontWeight: 700, color: REDWOOD.info, display: 'block' }}>{set.size}</Text>
                  <Text type="secondary" style={{ fontSize: 11 }}>{ATTR_LABELS[attr]}</Text>
                  <Text style={{ fontSize: 10, color: REDWOOD.neutral300, display: 'block' }}>distinct values</Text>
                </Card>
              </Col>
            );
          })}
        </Row>
      )}

      {/* Search form — collapsible */}
      <Collapse
        activeKey={paramsOpen ? ['params'] : []}
        onChange={keys => setParamsOpen(keys.includes('params'))}
        style={{ marginBottom: 16, borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}` }}
        items={[{
          key: 'params',
          label: (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
              <Space>
                <SearchOutlined style={{ color: REDWOOD.primary }} />
                <Text strong style={{ fontSize: 13 }}>Search Parameters</Text>
                {!paramsOpen && searched && (
                  <Tag color="blue" style={{ borderRadius: 10, fontSize: 11 }}>
                    {results.length.toLocaleString()} results loaded
                  </Tag>
                )}
              </Space>
              <Space size={6} onClick={e => e.stopPropagation()}>
                <Tooltip title="Choose where to query items from — the APEX (ORDS) database or Fusion itemsV2">
                  <Segmented size="small" value={source} onChange={(v) => setSource(v as 'apex' | 'fusion')}
                    options={[{ label: 'APEX', value: 'apex' }, { label: 'Fusion', value: 'fusion' }]} />
                </Tooltip>
                <Tooltip title="View API endpoint and test">
                  <Button size="small" icon={<ApiOutlined />}
                    onClick={() => { setApiResponse(null); setApiError(''); setApiOpen(true); }}
                    style={{ fontSize: 11, color: REDWOOD.info, borderColor: REDWOOD.info }}>
                    API
                  </Button>
                </Tooltip>
              </Space>
            </div>
          ),
          children: (
            <>
              {orgsError && (
                <Alert type="warning" message={`Could not load organizations: ${orgsError}`}
                  style={{ marginBottom: 12 }} closable />
              )}
              <Form form={form} layout="vertical">
                <Row gutter={[16, 0]}>
                  {/* Organization — mandatory */}
                  <Col xs={24} sm={12} md={6}>
                    <Form.Item
                      name="org"
                      label={
                        <Space size={4}>
                          <Text style={{ fontSize: 12 }}>Organization</Text>
                          <Tag color="error" style={{ fontSize: 10, lineHeight: '16px', padding: '0 4px' }}>required</Tag>
                        </Space>
                      }
                      style={{ marginBottom: 12 }}
                    >
                      <Select
                        placeholder={orgsLoading ? 'Loading...' : 'Select organization'}
                        options={orgs}
                        loading={orgsLoading}
                        showSearch
                        allowClear
                        filterOption={(input, opt) =>
                          (opt?.label ?? '').toLowerCase().includes(input.toLowerCase())
                        }
                        style={{ width: '100%' }}
                        notFoundContent={orgsLoading ? <Spin size="small" /> : 'No organizations found'}
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={12} md={6}>
                    <Form.Item name="itemNumber" label={<Text style={{ fontSize: 12 }}>Item Number</Text>} style={{ marginBottom: 12 }}>
                      <Input placeholder="Partial match" allowClear />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={12} md={6}>
                    <Form.Item name="description" label={<Text style={{ fontSize: 12 }}>Description</Text>} style={{ marginBottom: 12 }}>
                      <Input placeholder="Partial match" allowClear />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={12} md={6}>
                    <Form.Item name="search" label={<Text style={{ fontSize: 12 }}>Universal Search</Text>} style={{ marginBottom: 12 }}>
                      <Input placeholder="Searches all fields" allowClear />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={8} md={4}>
                    <Form.Item name="status" label={<Text style={{ fontSize: 12 }}>Status</Text>} style={{ marginBottom: 12 }}>
                      <Select placeholder="Any" options={statusOptions} allowClear />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={8} md={4}>
                    <Form.Item name="barcode" label={<Text style={{ fontSize: 12 }}>Barcode</Text>} style={{ marginBottom: 12 }}>
                      <Input placeholder="Exact barcode" allowClear />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={8} md={4}>
                    <Form.Item name="attr1" label={<Text style={{ fontSize: 12 }}>Brand (Attr 1)</Text>} style={{ marginBottom: 12 }}>
                      <Input placeholder="e.g. EMC" allowClear />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={8} md={4}>
                    <Form.Item name="attr5" label={<Text style={{ fontSize: 12 }}>Category (Attr 5)</Text>} style={{ marginBottom: 12 }}>
                      <Input placeholder="e.g. NORMAL" allowClear />
                    </Form.Item>
                  </Col>
                </Row>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <Button
                    type="primary"
                    icon={<SearchOutlined />}
                    onClick={handleSearch}
                    disabled={searching}
                    style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary, fontWeight: 600, minWidth: 100 }}
                  >
                    Search
                  </Button>
                  <Button icon={<ReloadOutlined />} onClick={handleReset} disabled={searching}>
                    Clear
                  </Button>
                </div>
              </Form>
            </>
          ),
        }]}
      />

      {/* Fetch progress */}
      {searching && (
        <Card style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}`, marginBottom: 16 }}
          styles={{ body: { padding: '14px 20px' } }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <Space>
              <Spin size="small" />
              <Text strong style={{ fontSize: 13 }}>
                Fetching page {fetchPage} — {fetchCount.toLocaleString()} items loaded
                {totalCount ? ` of ${totalCount.toLocaleString()}` : ''}
              </Text>
            </Space>
            <Button danger size="small" icon={<StopOutlined />} onClick={handleCancel}>
              Cancel
            </Button>
          </div>
          <Progress
            percent={totalCount && totalCount > 0 ? Math.min(Math.round((fetchCount / totalCount) * 100), 99) : undefined}
            status="active"
            strokeColor={REDWOOD.primary}
            format={p => totalCount ? `${p}%` : `Page ${fetchPage}`}
          />
        </Card>
      )}

      {searchError && (
        <Alert type="error" message={searchError} style={{ marginBottom: 16 }} closable
          onClose={() => setSearchError('')} />
      )}

      {/* Results */}
      {searched && !searching && (
        <Card style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}` }} styles={{ body: { padding: 0 } }}>
          <div style={{
            padding: '10px 16px', borderBottom: `1px solid ${REDWOOD.neutral200}`,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <Space>
              <Text strong style={{ fontSize: 13 }}>Results</Text>
              <Tag style={{ borderRadius: 10 }} color="blue">
                {tableFilter
                  ? `${results.filter(r => {
                      const q = tableFilter.toLowerCase();
                      return (r.item_number||'').toLowerCase().includes(q)
                          || (r.description||'').toLowerCase().includes(q)
                          || (r.attribute1||'').toLowerCase().includes(q)
                          || (r.attribute2||'').toLowerCase().includes(q)
                          || (r.attribute5||'').toLowerCase().includes(q);
                    }).length.toLocaleString()} of ${results.length.toLocaleString()}`
                  : results.length.toLocaleString()
                } items
              </Tag>
            </Space>
            <Space size={8}>
              <Input
                placeholder="Filter results..."
                prefix={<SearchOutlined style={{ color: REDWOOD.neutral300 }} />}
                value={tableFilter}
                onChange={e => setTableFilter(e.target.value)}
                allowClear
                style={{ width: 220 }}
                size="small"
              />
              <Button
                icon={<DownloadOutlined />}
                loading={exporting}
                onClick={handleExport}
                style={{ color: REDWOOD.success, borderColor: REDWOOD.success, fontWeight: 600 }}
              >
                Export Excel
              </Button>
            </Space>
          </div>
          <Table
            dataSource={tableFilter ? results.filter(r => {
              const q = tableFilter.toLowerCase();
              return (r.item_number||'').toLowerCase().includes(q)
                  || (r.description||'').toLowerCase().includes(q)
                  || (r.attribute1||'').toLowerCase().includes(q)
                  || (r.attribute2||'').toLowerCase().includes(q)
                  || (r.attribute5||'').toLowerCase().includes(q)
                  || (r.organization_code||'').toLowerCase().includes(q)
                  || (r.barcode||'').toLowerCase().includes(q);
            }) : results}
            columns={columns}
            rowKey={(r, i) => r.inventory_item_id || String(i)}
            size="small"
            bordered
            scroll={{ x: 1400 }}
            pagination={{
              pageSize: 100, showSizeChanger: true,
              pageSizeOptions: ['50', '100', '250', '500'],
              showTotal: t => `${t.toLocaleString()} records`,
            }}
          />
        </Card>
      )}

      {/* API Debug Modal */}
      <Modal
        title={<Space><ApiOutlined style={{ color: REDWOOD.info }} /> API Debug — Item Master</Space>}
        open={apiOpen}
        onCancel={() => setApiOpen(false)}
        footer={<Button onClick={() => setApiOpen(false)}>Close</Button>}
        width={760}
      >
        <Space direction="vertical" style={{ width: '100%' }} size={16}>
          <div>
            <Text type="secondary" style={{ fontSize: 11 }}>
              Last executed URL (filled after Search):
            </Text>
            <div style={{
              background: REDWOOD.neutral100, border: `1px solid ${REDWOOD.neutral200}`,
              borderRadius: 6, padding: '8px 12px', fontFamily: 'monospace',
              fontSize: 12, wordBreak: 'break-all', margin: '6px 0',
              color: lastUrl ? REDWOOD.neutral900 : REDWOOD.neutral300,
            }}>
              {lastUrl || '(no search run yet)'}
            </div>
            {lastUrl && (
              <Button size="small" icon={<CopyOutlined />} onClick={() => {
                navigator.clipboard.writeText(lastUrl);
                message.success('URL copied!');
              }}>Copy</Button>
            )}
          </div>

          <div>
            <Text type="secondary" style={{ fontSize: 11 }}>
              Test URL — first 5 items for selected org (or no org filter):
            </Text>
            <div style={{
              background: REDWOOD.neutral100, border: `1px solid ${REDWOOD.neutral200}`,
              borderRadius: 6, padding: '8px 12px', fontFamily: 'monospace',
              fontSize: 12, wordBreak: 'break-all', margin: '6px 0 8px',
            }}>
              {buildUrl(form.getFieldsValue(), 5, 0)}
            </div>
            <Button type="primary" icon={<ApiOutlined />} loading={apiLoading}
              style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}
              onClick={async () => {
                setApiLoading(true); setApiResponse(null); setApiError('');
                const testUrl = buildUrl(form.getFieldsValue(), 5, 0);
                try {
                  const res = await fetch(testUrl, { headers: source === 'fusion' ? FUSION_HDRS : { Accept: 'application/json' } });
                  const text = await res.text();
                  let parsed: any;
                  try { parsed = JSON.parse(text); } catch { parsed = text; }
                  setApiResponse({ status: res.status, ok: res.ok, body: parsed });
                } catch (err: any) {
                  setApiError(err.message);
                } finally { setApiLoading(false); }
              }}>
              Test API
            </Button>
          </div>

          {apiError && <Alert type="error" message={apiError} />}

          {apiResponse && (
            <div>
              <Space style={{ marginBottom: 6 }}>
                <Tag color={apiResponse.ok ? 'success' : 'error'}>HTTP {apiResponse.status}</Tag>
                {apiResponse.ok && (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {apiResponse.body?.items?.length ?? 0} items · hasMore: {String(apiResponse.body?.hasMore)} · count: {apiResponse.body?.count ?? 'n/a'}
                  </Text>
                )}
              </Space>
              <div style={{
                background: '#1e1e1e', borderRadius: 6, padding: '10px 14px',
                fontFamily: 'monospace', fontSize: 11, color: '#d4d4d4',
                maxHeight: 340, overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
              }}>
                {JSON.stringify(apiResponse.body, null, 2)}
              </div>
            </div>
          )}
        </Space>
      </Modal>

      {/* Attribute Drawer */}
      <Drawer
        title={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Space><TagsOutlined />{drawer.label} — Distinct Values</Space>
            <Badge count={drawer.values.length} style={{ backgroundColor: REDWOOD.info }} />
          </div>
        }
        open={drawer.open}
        onClose={() => setDrawer(d => ({ ...d, open: false }))}
        width={380} closeIcon={<CloseOutlined />}
      >
        <List size="small" dataSource={drawer.values}
          renderItem={item => (
            <List.Item style={{ padding: '8px 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', gap: 8 }}>
                <Text style={{ flex: 1, fontSize: 13 }} ellipsis title={item.value}>{item.value}</Text>
                <Tag style={{ borderRadius: 10, minWidth: 44, textAlign: 'center' }} color="blue">
                  {item.count.toLocaleString()}
                </Tag>
              </div>
            </List.Item>
          )}
        />
      </Drawer>
    </div>
  );

  // ── Tabs ─────────────────────────────────────────────────────────────────────
  const tabItems = [
    {
      key: 'search',
      label: <span style={{ fontSize: 12 }}><SearchOutlined style={{ marginRight: 5 }} />Search Items</span>,
      closable: false,
      children: searchTabContent,
    },
    ...editTabs.map(tab => ({
      key: tab.key,
      label: (
        <span style={{ fontSize: 12 }}>
          <EditOutlined style={{ marginRight: 5, color: REDWOOD.info }} />
          {tab.item.item_number}
        </span>
      ),
      closable: true,
      children: <EditItemPanel item={tab.item} />,
    })),
  ];

  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
      <Content>
        <div style={{ padding: '10px 24px', background: REDWOOD.surface, borderBottom: `1px solid ${REDWOOD.neutral200}` }}>
          <Breadcrumb items={[
            { title: <Link to="/home"><HomeOutlined /> Home</Link> },
            { title: <Link to="/procurement">Fusion Supply Chain</Link> },
            { title: 'Item Master' },
          ]} />
        </div>

        <div style={{ padding: '0 16px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 0 10px' }}>
            <div style={{
              width: 42, height: 42, borderRadius: 10,
              background: `linear-gradient(135deg, ${REDWOOD.success} 0%, #155E3A 100%)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: `0 3px 10px ${REDWOOD.success}40`,
            }}>
              <AppstoreOutlined style={{ fontSize: 22, color: '#fff' }} />
            </div>
            <div>
              <Title level={3} style={{ margin: 0, color: REDWOOD.neutral900 }}>Item Master</Title>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Item catalog — select an organization to search
              </Text>
            </div>
          </div>

          <Tabs
            type="editable-card"
            activeKey={activeTabKey}
            onChange={setActiveTabKey}
            onEdit={(targetKey, action) => {
              if (action === 'remove' && typeof targetKey === 'string') closeEditTab(targetKey);
            }}
            hideAdd
            items={tabItems}
            tabBarStyle={{ marginBottom: 0 }}
          />
        </div>
      </Content>
    </Layout>
  );
};

export default ItemMaster;
