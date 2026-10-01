// Purchasing-RR — shared hooks and components (BU picker, lookups, lines editor,
// history, reason prompt).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Select, Space, Typography, Tag, Table, Input, InputNumber, Button, Tooltip, Modal, Alert, message, Empty, Form,
} from 'antd';
import {
  DeleteOutlined, PlusOutlined, SplitCellsOutlined, HistoryOutlined, ShoppingCartOutlined, CopyOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useAuth } from '../../context/AuthContext';
import {
  BusinessUnit, Row, loadBusinessUnits, loadCategories, loadCurrencies, loadItems, loadLocations, loadSupplierSites,
  loadTaxCodes, loadUoms, loadHistory, rememberBu, rememberedBu, STATUS_COLOR, label, money, n, r2,
} from '../../services/po.service';

const { Text, Title } = Typography;
export const PO_RED = '#C74634';

export const usePoUser = () => {
  const { user } = useAuth();
  return (user?.username || user?.email || 'UNKNOWN') as string;
};

// ── Business units ─────────────────────────────────────────────────────────
export function useBusinessUnits() {
  const [bus, setBus] = useState<BusinessUnit[]>([]);
  const [bu, setBuState] = useState<number | null>(rememberedBu());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    loadBusinessUnits()
      .then(rows => {
        setBus(rows);
        setBuState(cur => (cur && rows.some(r => Number(r.BUSINESS_UNIT_ID) === cur)) ? cur
          : rows.length === 1 ? Number(rows[0].BUSINESS_UNIT_ID) : (rows.find(r => r.OPTIONS_SET === 'Y')?.BUSINESS_UNIT_ID ?? null));
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  const setBu = useCallback((id: number | null) => { setBuState(id); rememberBu(id); }, []);
  const current = useMemo(() => bus.find(b => Number(b.BUSINESS_UNIT_ID) === bu) || null, [bus, bu]);
  return { bus, bu, setBu, current, loading, error };
}

export const PoBar: React.FC<{
  title: string; subtitle?: string; icon?: React.ReactNode;
  buState?: ReturnType<typeof useBusinessUnits>; allowAllBu?: boolean; extra?: React.ReactNode;
}> = ({ title, subtitle, icon, buState, allowAllBu, extra }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ width: 40, height: 40, borderRadius: 10, background: `${PO_RED}15`, color: PO_RED, display: 'flex',
        alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>{icon ?? <ShoppingCartOutlined />}</div>
      <div>
        <Title level={4} style={{ margin: 0 }}>{title}</Title>
        {subtitle && <Text type="secondary" style={{ fontSize: 12 }}>{subtitle}</Text>}
      </div>
    </div>
    <Space wrap>
      {buState && (
        <Select
          style={{ minWidth: 260 }}
          loading={buState.loading}
          placeholder="Business unit"
          allowClear={allowAllBu}
          value={buState.bu ?? undefined}
          onChange={v => buState.setBu(v ?? null)}
          showSearch optionFilterProp="label"
          options={buState.bus.map(b => ({
            value: Number(b.BUSINESS_UNIT_ID),
            label: `${b.BUSINESS_UNIT_NAME}${b.OPTIONS_SET === 'Y' ? '' : ' (not set up)'}`,
          }))}
        />
      )}
      {extra}
    </Space>
  </div>
);

export const BuNotSetUp: React.FC<{ current: BusinessUnit | null }> = ({ current }) =>
  current && current.OPTIONS_SET !== 'Y' ? (
    <Alert type="warning" showIcon style={{ marginBottom: 12 }}
      message={`${current.BUSINESS_UNIT_NAME} has no Purchasing Options yet`}
      description="Open Purchasing → Setup → Purchasing Options and save the options for this business unit (currency, accrual account, tolerances, approval flags)." />
  ) : null;

export const StatusTag: React.FC<{ s: unknown }> = ({ s }) =>
  s ? <Tag color={STATUS_COLOR[String(s)] || 'default'} style={{ marginInlineEnd: 0 }}>{label(s)}</Tag> : null;

// ── Lookups ────────────────────────────────────────────────────────────────
export interface Lookups {
  locations: Row[]; categories: Row[]; items: Row[]; uoms: Row[]; sites: Row[]; taxCodes: Row[]; currencies: string[];
  loading: boolean; error: string | null; reload: () => void;
}
export function useLookups(bu: number | null): Lookups {
  const [base, setBase] = useState<Omit<Lookups, 'sites' | 'loading' | 'error' | 'reload'>>({
    locations: [], categories: [], items: [], uoms: [], taxCodes: [], currencies: [],
  });
  const [sites, setSites] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    setLoading(true);
    Promise.all([loadLocations(), loadCategories(), loadItems(), loadUoms(), loadTaxCodes(), loadCurrencies()])
      .then(([locations, categories, items, uoms, taxCodes, currencies]) =>
        setBase({ locations, categories, items, uoms, taxCodes, currencies }))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [tick]);
  useEffect(() => {
    if (!bu) { setSites([]); return; }
    loadSupplierSites(bu).then(setSites).catch(e => setError(e.message));
  }, [bu, tick]);
  return { ...base, sites, loading, error, reload: () => setTick(t => t + 1) };
}

export const supplierOptions = (sites: Row[]) => {
  const m = new Map<number, string>();
  sites.forEach(s => m.set(Number(s.SUPPLIER_ID), `${s.SUPPLIER_NAME}${s.SUPPLIER_NUMBER ? ` (${s.SUPPLIER_NUMBER})` : ''}`));
  return Array.from(m.entries()).map(([value, lbl]) => ({ value, label: lbl }));
};
export const siteOptions = (sites: Row[], supplierId: number | null | undefined) =>
  sites.filter(s => Number(s.SUPPLIER_ID) === Number(supplierId)).map(s => ({
    value: Number(s.SUPPLIER_SITE_ID),
    label: `${s.SITE_NAME}${s.PURCHASING_HOLD_FLAG === 'Y' ? ' — ON HOLD' : ''}`,
    disabled: s.PURCHASING_HOLD_FLAG === 'Y',
  }));

// ── Lines editor (requisition and PO lines, one schedule per line) ─────────
export interface Dist {
  percent: number; chargeAccount?: string | null; requesterUser?: string | null;
  deliverToLocationId?: number | null; reqDistributionId?: number | null;
}
export interface EditLine {
  key: string;
  lineType: 'QUANTITY' | 'AMOUNT';
  expenseItemId?: number | null;
  categoryId?: number | null;
  itemDescription?: string;
  uomCode?: string | null;
  quantity?: number | null;
  unitPrice?: number | null;
  amount?: number | null;
  needByDate?: string | null;
  promisedDate?: string | null;
  locationId?: number | null;
  chargeAccount?: string | null;
  taxCode?: string | null;
  requesterUser?: string | null;
  note?: string | null;
  supplierItemNum?: string | null;
  suggestedSupplierId?: number | null;
  suggestedSupplierSiteId?: number | null;
  suggestedSupplierName?: string | null;
  distributions?: Dist[];
  reqLineIds?: number[];
  status?: string | null;
  received?: number | null;
}

let lineSeq = 0;
export const newLine = (defaults: Partial<EditLine> = {}): EditLine => ({
  key: `n${++lineSeq}-${Date.now()}`, lineType: 'QUANTITY', quantity: 1, unitPrice: null, ...defaults,
});
export const lineAmount = (l: EditLine) =>
  l.lineType === 'QUANTITY' ? r2(n(l.quantity) * n(l.unitPrice)) : r2(n(l.amount));

/** Turns editor lines into the JSON the packages expect (distributions only when split). */
export const linesToJson = (lines: EditLine[], mode: 'REQ' | 'PO') => lines.map(l => {
  const o: Record<string, unknown> = {
    lineType: l.lineType,
    expenseItemId: l.expenseItemId ?? null,
    categoryId: l.categoryId ?? null,
    itemDescription: l.itemDescription || null,
    uomCode: l.lineType === 'QUANTITY' ? (l.uomCode || null) : null,
    quantity: l.lineType === 'QUANTITY' ? l.quantity ?? null : null,
    unitPrice: l.lineType === 'QUANTITY' ? l.unitPrice ?? null : null,
    amount: l.lineType === 'AMOUNT' ? l.amount ?? null : null,
    needByDate: l.needByDate || null,
    taxCode: l.taxCode || null,
    requesterUser: l.requesterUser || null,
    supplierItemNum: l.supplierItemNum || null,
    chargeAccount: l.chargeAccount || null,
  };
  if (mode === 'REQ') {
    o.deliverToLocationId = l.locationId ?? null;
    o.noteToBuyer = l.note || null;
    o.suggestedSupplierId = l.suggestedSupplierId ?? null;
    o.suggestedSupplierSiteId = l.suggestedSupplierSiteId ?? null;
    o.suggestedSupplierName = l.suggestedSupplierName || null;
  } else {
    o.shipToLocationId = l.locationId ?? null;
    o.noteToSupplier = l.note || null;
    o.promisedDate = l.promisedDate || null;
    if (l.reqLineIds?.length) o.reqLineIds = l.reqLineIds;
  }
  if (l.distributions && l.distributions.length > 1) o.distributions = l.distributions;
  else if (l.distributions?.length === 1 && l.distributions[0].reqDistributionId)
    o.distributions = [{ ...l.distributions[0], chargeAccount: l.chargeAccount || l.distributions[0].chargeAccount }];
  return o;
});

export const LinesEditor: React.FC<{
  mode: 'REQ' | 'PO';
  lines: EditLine[];
  onChange: (lines: EditLine[]) => void;
  lookups: Lookups;
  readOnly?: boolean;
  currency?: string;
  defaultLocationId?: number | null;
}> = ({ mode, lines, onChange, lookups, readOnly, currency, defaultLocationId }) => {
  const [splitKey, setSplitKey] = useState<string | null>(null);
  const [splitRows, setSplitRows] = useState<Dist[]>([]);
  const upd = (key: string, patch: Partial<EditLine>) => onChange(lines.map(l => (l.key === key ? { ...l, ...patch } : l)));

  const pickItem = (key: string, id: number | null) => {
    const it = lookups.items.find(i => Number(i.EXPENSE_ITEM_ID) === id);
    if (!it) { upd(key, { expenseItemId: null }); return; }
    upd(key, {
      expenseItemId: id, categoryId: Number(it.CATEGORY_ID), itemDescription: it.DESCRIPTION,
      lineType: it.LINE_TYPE === 'AMOUNT' ? 'AMOUNT' : 'QUANTITY', uomCode: it.UOM_CODE,
      unitPrice: it.LINE_TYPE === 'AMOUNT' ? null : (it.LIST_PRICE ?? null),
      amount: it.LINE_TYPE === 'AMOUNT' ? (it.LIST_PRICE ?? null) : null,
      taxCode: it.TAX_CODE ?? undefined, supplierItemNum: it.SUPPLIER_ITEM_NUM ?? undefined,
      ...(mode === 'REQ' && it.PREFERRED_SUPPLIER_ID ? {
        suggestedSupplierId: Number(it.PREFERRED_SUPPLIER_ID),
        suggestedSupplierSiteId: it.PREFERRED_SUPPLIER_SITE_ID ? Number(it.PREFERRED_SUPPLIER_SITE_ID) : null,
      } : {}),
    });
  };
  const pickCategory = (key: string, id: number | null) => {
    const c = lookups.categories.find(x => Number(x.CATEGORY_ID) === id);
    const cur = lines.find(l => l.key === key);
    upd(key, {
      categoryId: id,
      ...(c && !cur?.expenseItemId ? {
        lineType: c.DEFAULT_LINE_TYPE === 'AMOUNT' ? 'AMOUNT' : 'QUANTITY',
        uomCode: cur?.uomCode || c.DEFAULT_UOM, taxCode: cur?.taxCode || c.DEFAULT_TAX_CODE,
      } : {}),
    });
  };

  const openSplit = (l: EditLine) => {
    setSplitKey(l.key);
    setSplitRows(l.distributions?.length ? l.distributions.map(d => ({ ...d }))
      : [{ percent: 100, chargeAccount: l.chargeAccount || '' }]);
  };
  const splitTotal = splitRows.reduce((s, d) => s + n(d.percent), 0);

  const locOpts = lookups.locations
    .filter(l => (mode === 'REQ' ? l.DELIVER_TO_FLAG : l.SHIP_TO_FLAG) !== 'N')
    .map(l => ({ value: Number(l.LOCATION_ID), label: l.LOCATION_NAME }));

  const columns: ColumnsType<EditLine> = [
    { title: '#', width: 40, render: (_, __, i) => i + 1 },
    {
      title: 'Item', dataIndex: 'expenseItemId', width: 170,
      render: (v, l) => (
        <Select size="small" style={{ width: '100%' }} allowClear disabled={readOnly} value={v ?? undefined}
          placeholder="(free text)" showSearch optionFilterProp="label" popupMatchSelectWidth={360}
          onChange={val => pickItem(l.key, val ?? null)}
          options={lookups.items.map(i => ({ value: Number(i.EXPENSE_ITEM_ID), label: `${i.ITEM_CODE} — ${i.DESCRIPTION}` }))} />
      ),
    },
    {
      title: 'Category', dataIndex: 'categoryId', width: 170,
      render: (v, l) => (
        <Select size="small" style={{ width: '100%' }} disabled={readOnly || !!l.expenseItemId} value={v ?? undefined}
          status={!v ? 'warning' : undefined} placeholder="Category" showSearch optionFilterProp="label"
          popupMatchSelectWidth={340} onChange={val => pickCategory(l.key, val ?? null)}
          options={lookups.categories.filter(c => mode === 'PO' || c.REQUESTABLE_FLAG !== 'N')
            .map(c => ({ value: Number(c.CATEGORY_ID), label: c.FULL_NAME }))} />
      ),
    },
    {
      title: 'Description', dataIndex: 'itemDescription', width: 220,
      render: (v, l) => <Input size="small" disabled={readOnly} value={v} status={!v ? 'warning' : undefined}
        onChange={e => upd(l.key, { itemDescription: e.target.value })} />,
    },
    {
      title: 'Type', dataIndex: 'lineType', width: 100,
      render: (v, l) => (
        <Select size="small" style={{ width: '100%' }} disabled={readOnly} value={v}
          onChange={val => upd(l.key, { lineType: val, ...(val === 'AMOUNT' ? { amount: lineAmount(l) || null } : { quantity: l.quantity ?? 1 }) })}
          options={[{ value: 'QUANTITY', label: 'Goods' }, { value: 'AMOUNT', label: 'Service' }]} />
      ),
    },
    {
      title: 'UOM', dataIndex: 'uomCode', width: 95,
      render: (v, l) => l.lineType === 'AMOUNT' ? <Text type="secondary">—</Text> : (
        <Select size="small" style={{ width: '100%' }} disabled={readOnly} value={v ?? undefined} showSearch
          popupMatchSelectWidth={200} onChange={val => upd(l.key, { uomCode: val })}
          options={lookups.uoms.map(u => ({ value: u.UOM_CODE, label: `${u.UOM_CODE} — ${u.UOM_NAME}` }))} />
      ),
    },
    {
      title: 'Qty', dataIndex: 'quantity', width: 90,
      render: (v, l) => l.lineType === 'AMOUNT' ? <Text type="secondary">—</Text> : (
        <InputNumber size="small" style={{ width: '100%' }} disabled={readOnly} min={0} value={v ?? undefined}
          onChange={val => upd(l.key, { quantity: val as number })} />
      ),
    },
    {
      title: `Price${currency ? ` (${currency})` : ''}`, dataIndex: 'unitPrice', width: 110,
      render: (v, l) => l.lineType === 'AMOUNT' ? <Text type="secondary">—</Text> : (
        <InputNumber size="small" style={{ width: '100%' }} disabled={readOnly} min={0} value={v ?? undefined}
          onChange={val => upd(l.key, { unitPrice: val as number })} />
      ),
    },
    {
      title: 'Amount', width: 120, align: 'right',
      render: (_, l) => l.lineType === 'AMOUNT' ? (
        <InputNumber size="small" style={{ width: '100%' }} disabled={readOnly} min={0} value={l.amount ?? undefined}
          onChange={val => upd(l.key, { amount: val as number })} />
      ) : <Text strong>{money(lineAmount(l))}</Text>,
    },
    {
      title: 'Need by', dataIndex: 'needByDate', width: 130,
      render: (v, l) => <Input size="small" type="date" disabled={readOnly} value={v || ''}
        onChange={e => upd(l.key, { needByDate: e.target.value || null })} />,
    },
    {
      title: mode === 'REQ' ? 'Deliver to' : 'Ship to', dataIndex: 'locationId', width: 150,
      render: (v, l) => (
        <Select size="small" style={{ width: '100%' }} disabled={readOnly} allowClear value={v ?? undefined}
          placeholder={defaultLocationId ? 'Default' : 'Location'} showSearch optionFilterProp="label"
          popupMatchSelectWidth={260} onChange={val => upd(l.key, { locationId: val ?? null })} options={locOpts} />
      ),
    },
    {
      title: <Tooltip title="Leave blank to derive it from requester defaults + category natural account + account rules">Charge account</Tooltip>,
      dataIndex: 'chargeAccount', width: 230,
      render: (v, l) => (l.distributions?.length ?? 0) > 1 ? (
        <Button size="small" icon={<SplitCellsOutlined />} onClick={() => openSplit(l)}>
          Split ({l.distributions!.length})
        </Button>
      ) : (
        <Space.Compact style={{ width: '100%' }}>
          <Input size="small" disabled={readOnly} value={v || ''} placeholder="auto-derived"
            onChange={e => upd(l.key, { chargeAccount: e.target.value })} />
          {!readOnly && <Tooltip title="Split across accounts"><Button size="small" icon={<SplitCellsOutlined />} onClick={() => openSplit(l)} /></Tooltip>}
        </Space.Compact>
      ),
    },
    {
      title: 'Tax', dataIndex: 'taxCode', width: 110,
      render: (v, l) => (
        <Select size="small" style={{ width: '100%' }} disabled={readOnly} allowClear value={v ?? undefined}
          popupMatchSelectWidth={200} onChange={val => upd(l.key, { taxCode: val ?? null })}
          options={lookups.taxCodes.map(t => ({ value: t.TAX_CODE, label: `${t.TAX_CODE}${t.TAX_RATE != null ? ` (${t.TAX_RATE}%)` : ''}` }))} />
      ),
    },
    ...(lines.some(l => l.status) ? [{
      title: 'Status', dataIndex: 'status', width: 110, render: (s: string) => <StatusTag s={s} />,
    }] : []),
    ...(!readOnly ? [{
      title: '', width: 70, fixed: 'right' as const,
      render: (_: unknown, l: EditLine) => (
        <Space size={0}>
          <Tooltip title="Duplicate"><Button size="small" type="text" icon={<CopyOutlined />}
            onClick={() => onChange([...lines, { ...l, key: newLine().key, reqLineIds: undefined, status: undefined,
              distributions: l.distributions?.map(d => ({ ...d, reqDistributionId: null })) }])} /></Tooltip>
          <Tooltip title="Remove line"><Button size="small" type="text" danger icon={<DeleteOutlined />}
            onClick={() => onChange(lines.filter(x => x.key !== l.key))} /></Tooltip>
        </Space>
      ),
    }] : []),
  ];

  const total = lines.reduce((s, l) => s + lineAmount(l), 0);
  return (
    <>
      <Table<EditLine>
        size="small" rowKey="key" columns={columns} dataSource={lines} pagination={false}
        scroll={{ x: 1900 }} bordered
        locale={{ emptyText: <Empty description="No lines yet" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
        expandable={{
          expandedRowRender: l => (
            <Space wrap size={[16, 8]} style={{ padding: '4px 8px' }}>
              <span><Text type="secondary">Requester </Text>
                <Input size="small" style={{ width: 160 }} disabled={readOnly} value={l.requesterUser || ''} placeholder="(you)"
                  onChange={e => upd(l.key, { requesterUser: e.target.value })} /></span>
              <span><Text type="secondary">Supplier item # </Text>
                <Input size="small" style={{ width: 140 }} disabled={readOnly} value={l.supplierItemNum || ''}
                  onChange={e => upd(l.key, { supplierItemNum: e.target.value })} /></span>
              {mode === 'PO' && (
                <span><Text type="secondary">Promised </Text>
                  <Input size="small" type="date" style={{ width: 140 }} disabled={readOnly} value={l.promisedDate || ''}
                    onChange={e => upd(l.key, { promisedDate: e.target.value || null })} /></span>
              )}
              {mode === 'REQ' && (
                <span><Text type="secondary">Suggested supplier </Text>
                  <Select size="small" style={{ width: 240 }} disabled={readOnly} allowClear showSearch optionFilterProp="label"
                    value={l.suggestedSupplierId ?? undefined}
                    onChange={v => upd(l.key, { suggestedSupplierId: v ?? null, suggestedSupplierSiteId: null })}
                    options={supplierOptions(lookups.sites)} />
                  {!l.suggestedSupplierId && (
                    <Input size="small" style={{ width: 180, marginLeft: 6 }} disabled={readOnly} placeholder="or new supplier name"
                      value={l.suggestedSupplierName || ''} onChange={e => upd(l.key, { suggestedSupplierName: e.target.value })} />
                  )}
                </span>
              )}
              <span><Text type="secondary">{mode === 'REQ' ? 'Note to buyer ' : 'Note to supplier '}</Text>
                <Input size="small" style={{ width: 320 }} disabled={readOnly} value={l.note || ''}
                  onChange={e => upd(l.key, { note: e.target.value })} /></span>
              {l.reqLineIds?.length ? <Tag color="blue">From requisition line(s) {l.reqLineIds.join(', ')}</Tag> : null}
            </Space>
          ),
        }}
        summary={() => (
          <Table.Summary.Row>
            <Table.Summary.Cell index={0} colSpan={9} align="right"><Text strong>Total</Text></Table.Summary.Cell>
            <Table.Summary.Cell index={1} align="right"><Text strong>{money(total)} {currency}</Text></Table.Summary.Cell>
            <Table.Summary.Cell index={2} colSpan={10} />
          </Table.Summary.Row>
        )}
      />
      {!readOnly && (
        <Button style={{ marginTop: 8 }} icon={<PlusOutlined />}
          onClick={() => onChange([...lines, newLine({ locationId: defaultLocationId ?? null })])}>Add line</Button>
      )}

      <Modal
        open={!!splitKey} title="Split charge account" width={640} destroyOnHidden
        onCancel={() => setSplitKey(null)}
        okButtonProps={{ disabled: readOnly || Math.abs(splitTotal - 100) > 0.0001 || splitRows.some(d => !d.chargeAccount) }}
        onOk={() => {
          const d = splitRows.map(x => ({ ...x, percent: n(x.percent) }));
          upd(splitKey!, d.length === 1
            ? { distributions: d[0].reqDistributionId ? d : undefined, chargeAccount: d[0].chargeAccount }
            : { distributions: d, chargeAccount: d[0].chargeAccount });
          setSplitKey(null);
        }}
      >
        <Table<Dist & { i: number }>
          size="small" pagination={false} rowKey="i"
          dataSource={splitRows.map((d, i) => ({ ...d, i }))}
          columns={[
            { title: '%', width: 100, render: (_, d) => (
              <InputNumber size="small" min={0} max={100} value={d.percent} disabled={readOnly}
                onChange={v => setSplitRows(rs => rs.map((x, j) => (j === d.i ? { ...x, percent: v as number } : x)))} />) },
            { title: 'Charge account', render: (_, d) => (
              <Input size="small" value={d.chargeAccount || ''} disabled={readOnly}
                onChange={e => setSplitRows(rs => rs.map((x, j) => (j === d.i ? { ...x, chargeAccount: e.target.value } : x)))} />) },
            { title: '', width: 40, render: (_, d) => !readOnly && splitRows.length > 1 && (
              <Button size="small" type="text" danger icon={<DeleteOutlined />}
                onClick={() => setSplitRows(rs => rs.filter((_, j) => j !== d.i))} />) },
          ]}
        />
        <Space style={{ marginTop: 8, width: '100%', justifyContent: 'space-between' }}>
          {!readOnly && <Button size="small" icon={<PlusOutlined />}
            onClick={() => setSplitRows(rs => [...rs, { percent: Math.max(0, r2(100 - splitTotal)), chargeAccount: rs[rs.length - 1]?.chargeAccount || '' }])}>
            Add split</Button>}
          <Text type={Math.abs(splitTotal - 100) > 0.0001 ? 'danger' : 'success'}>Total {r2(splitTotal)}%</Text>
        </Space>
      </Modal>
    </>
  );
};

// ── History modal ──────────────────────────────────────────────────────────
export const HistoryButton: React.FC<{ entityType: 'REQ' | 'PO' | 'RCV' | 'ACR'; id: number | null | undefined }> = ({ entityType, id }) => {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const show = () => {
    if (!id) return;
    setOpen(true); setLoading(true);
    loadHistory(entityType, id).then(setRows).catch(e => message.error(e.message)).finally(() => setLoading(false));
  };
  return (
    <>
      <Button icon={<HistoryOutlined />} disabled={!id} onClick={show}>History</Button>
      <Modal open={open} onCancel={() => setOpen(false)} footer={null} title="Action history" width={820}>
        <Table size="small" rowKey="HISTORY_ID" loading={loading} dataSource={rows} pagination={{ pageSize: 15 }}
          columns={[
            { title: 'When', dataIndex: 'ACTION_DATE', width: 160, render: v => String(v ?? '').replace('T', ' ').slice(0, 16) },
            { title: 'Action', dataIndex: 'ACTION', width: 150, render: v => <Tag>{label(v)}</Tag> },
            { title: 'From → To', width: 220, render: (_, r) => r.FROM_STATUS || r.TO_STATUS
              ? <span><StatusTag s={r.FROM_STATUS} /> → <StatusTag s={r.TO_STATUS} /></span> : '' },
            { title: 'By', dataIndex: 'ACTION_BY', width: 120 },
            { title: 'Comments', dataIndex: 'COMMENTS' },
          ]} />
      </Modal>
    </>
  );
};

// ── Reason prompt (promise-based) ──────────────────────────────────────────
export function askReason(title: string, opts: { required?: boolean; okText?: string; danger?: boolean; extra?: React.ReactNode } = {}):
  Promise<string | null> {
  return new Promise(resolve => {
    let value = '';
    const m = Modal.confirm({
      title, icon: null, okText: opts.okText || 'OK', okButtonProps: { danger: opts.danger },
      content: (
        <div>
          {opts.extra}
          <Input.TextArea autoFocus rows={3} placeholder={opts.required === false ? 'Comments (optional)' : 'Reason'}
            onChange={e => { value = e.target.value; }} />
        </div>
      ),
      onOk: () => {
        if (opts.required !== false && !value.trim()) { message.warning('Please enter a reason'); return Promise.reject(); }
        resolve(value.trim()); m.destroy(); return undefined;
      },
      onCancel: () => resolve(null),
    });
  });
}

// ── Small form helpers ─────────────────────────────────────────────────────
export const YesNo = [{ value: 'Y', label: 'Yes' }, { value: 'N', label: 'No' }];
export const FormRow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', columnGap: 16 }}>{children}</div>
);
export { Form };
