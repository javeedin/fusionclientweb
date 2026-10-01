// Purchasing-RR — Buyer workbench: approved requisition lines → purchase orders
// (AUTOCREATE), or return lines to the requester.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Card, Table, Button, Space, Input, Select, Typography, Tag, Modal, Form, InputNumber, Alert, message, Segmented, Tooltip,
} from 'antd';
import { ThunderboltOutlined, RollbackOutlined, ReloadOutlined, PlusOutlined, WarningOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { poQuery, poExec, PROC, lit, nlit, money, qty, day, today, Row, n, r2 } from '../../services/po.service';
import { PoBar, BuNotSetUp, useBusinessUnits, useLookups, usePoUser, supplierOptions, siteOptions, askReason } from './poShared';

const { Text } = Typography;

const BuyerWorkbench: React.FC = () => {
  const buState = useBusinessUnits();
  const user = usePoUser();
  const navigate = useNavigate();
  const lookups = useLookups(buState.bu);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [scope, setScope] = useState<'MINE' | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  const [sel, setSel] = useState<number[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [prices, setPrices] = useState<Record<number, number>>({});
  const [busy, setBusy] = useState(false);
  const [form] = Form.useForm();
  const supplierId = Form.useWatch('supplierId', form);
  const currencyCode = Form.useWatch('currencyCode', form);

  const load = useCallback(async () => {
    if (!buState.bu) { setRows([]); return; }
    setLoading(true);
    try {
      const where = [`BUSINESS_UNIT_ID = ${nlit(buState.bu)}`, `REQ_STATUS = 'APPROVED'`, `LINE_STATUS = 'OPEN'`];
      if (scope === 'MINE') where.push(`(UPPER(BUYER_USER) = UPPER(${lit(user)}) OR BUYER_USER IS NULL)`);
      if (search.trim()) {
        const s = lit(`%${search.trim().toUpperCase()}%`);
        where.push(`(UPPER(REQ_NUMBER) LIKE ${s} OR UPPER(ITEM_DESCRIPTION) LIKE ${s} OR UPPER(CATEGORY_NAME) LIKE ${s}
                     OR UPPER(SUGGESTED_SUPPLIER) LIKE ${s} OR UPPER(REQUESTER_USER) LIKE ${s})`);
      }
      setRows(await poQuery(`SELECT * FROM RR_PO_V_REQ_LINES WHERE ${where.join(' AND ')}
                             ORDER BY URGENT_FLAG DESC, NEED_BY_DATE, REQ_HEADER_ID, LINE_NUM`));
      setSel([]);
    } catch (e: any) { message.error(e.message); } finally { setLoading(false); }
  }, [buState.bu, scope, search, user]);
  useEffect(() => { load(); }, [load]);

  const selected = useMemo(() => rows.filter(r => sel.includes(Number(r.REQ_LINE_ID))), [rows, sel]);
  const currencies = Array.from(new Set(selected.map(r => r.CURRENCY_CODE)));

  const openCreate = () => {
    const sup = selected.find(r => r.SUGGESTED_SUPPLIER_ID);
    form.resetFields();
    form.setFieldsValue({
      supplierId: sup ? Number(sup.SUGGESTED_SUPPLIER_ID) : undefined,
      supplierSiteId: sup?.SUGGESTED_SUPPLIER_SITE_ID ? Number(sup.SUGGESTED_SUPPLIER_SITE_ID) : undefined,
      currencyCode: currencies[0], description: selected.length === 1 ? selected[0].ITEM_DESCRIPTION : selected[0]?.REQ_DESCRIPTION,
    });
    setPrices({});
    setCreateOpen(true);
  };

  const create = async () => {
    const v = await form.validateFields();
    setBusy(true);
    try {
      const r = await poExec(PROC.autocreate, {
        p_json: {
          reqLineIds: sel, supplierId: v.supplierId, supplierSiteId: v.supplierSiteId, currencyCode: v.currencyCode,
          rate: v.rate ?? null, description: v.description || null,
          prices: Object.fromEntries(Object.entries(prices).filter(([, p]) => p !== null && p !== undefined)),
        },
      }, user);
      message.success(r.message, 6);
      setCreateOpen(false);
      navigate(`/po/orders?id=${r.id}`);
    } catch (e: any) { message.error(e.message, 8); } finally { setBusy(false); }
  };

  const returnLines = async () => {
    const reason = await askReason(`Return ${sel.length} line(s) to the requester`, { okText: 'Return', danger: true });
    if (reason === null) return;
    try {
      const r = await poExec(PROC.returnReqLines, { p_req_line_ids: sel.join(','), p_reason: reason }, user);
      message.success(r.message || 'Returned');
      load();
    } catch (e: any) { message.error(e.message, 8); }
  };

  const sites = siteOptions(lookups.sites, supplierId);
  const fc = buState.current?.FUNCTIONAL_CURRENCY;

  return (
    <div style={{ padding: 20 }}>
      <PoBar title="Buyer Workbench" subtitle="Approved requisition lines waiting for a purchase order" icon={<ThunderboltOutlined />}
        buState={buState}
        extra={<Button icon={<PlusOutlined />} disabled={!buState.bu} onClick={() => navigate('/po/orders?id=new')}>Direct purchase order</Button>} />
      <BuNotSetUp current={buState.current} />
      <Card size="small">
        <Space wrap style={{ marginBottom: 12 }}>
          <Segmented value={scope} onChange={v => setScope(v as 'MINE' | 'ALL')}
            options={[{ value: 'ALL', label: 'All open demand' }, { value: 'MINE', label: 'Assigned to me' }]} />
          <Input.Search allowClear placeholder="Requisition, item, category, supplier, requester" style={{ width: 340 }} onSearch={setSearch} />
          <Button icon={<ReloadOutlined />} onClick={load}>Refresh</Button>
          <Button type="primary" icon={<ThunderboltOutlined />} disabled={!sel.length || currencies.length > 1} onClick={openCreate}>
            Create PO ({sel.length})
          </Button>
          <Button danger icon={<RollbackOutlined />} disabled={!sel.length} onClick={returnLines}>Return</Button>
          {currencies.length > 1 && <Text type="danger"><WarningOutlined /> Selected lines have different currencies</Text>}
        </Space>
        <Table size="small" rowKey="REQ_LINE_ID" loading={loading} dataSource={rows} pagination={{ pageSize: 25 }}
          rowSelection={{ selectedRowKeys: sel, onChange: k => setSel(k.map(Number)) }} scroll={{ x: 1300 }}
          columns={[
            { title: 'Requisition', dataIndex: 'REQ_NUMBER', width: 150, render: (v, r) => <Space size={4}>
              <a onClick={() => navigate(`/po/requisitions?id=${r.REQ_HEADER_ID}`)}>{v}</a>-{r.LINE_NUM}
              {r.URGENT_FLAG === 'Y' && <Tag color="red">Urgent</Tag>}</Space> },
            { title: 'Item / description', dataIndex: 'ITEM_DESCRIPTION', ellipsis: true, render: (v, r) => <span>{r.ITEM_CODE && <Tag>{r.ITEM_CODE}</Tag>}{v}</span> },
            { title: 'Category', dataIndex: 'CATEGORY_NAME', width: 160, ellipsis: true },
            { title: 'Qty', width: 90, align: 'right', render: (_, r) => r.LINE_TYPE === 'QUANTITY' ? `${qty(r.QUANTITY)} ${r.UOM_CODE || ''}` : <Tag>Service</Tag> },
            { title: 'Price', dataIndex: 'UNIT_PRICE', width: 100, align: 'right', render: v => money(v) },
            { title: 'Amount', width: 130, align: 'right', render: (_, r) => `${money(r.AMOUNT)} ${r.CURRENCY_CODE}` },
            { title: 'Need by', dataIndex: 'NEED_BY_DATE', width: 105, render: (v) => {
              const d = day(v); return <Text type={d && d < today() ? 'danger' : undefined}>{d}</Text>; } },
            { title: 'Suggested supplier', width: 180, ellipsis: true, render: (_, r) => r.SUGGESTED_SUPPLIER || r.SUGGESTED_SUPPLIER_NAME || '' },
            { title: 'Requester', dataIndex: 'REQUESTER_USER', width: 110 },
            { title: 'Buyer', dataIndex: 'BUYER_USER', width: 110, render: v => v || <Text type="secondary">unassigned</Text> },
            { title: 'Note', dataIndex: 'NOTE_TO_BUYER', width: 60, render: v => v ? <Tooltip title={v}><Tag color="blue">note</Tag></Tooltip> : null },
          ]} />
      </Card>

      <Modal open={createOpen} title={`Create purchase order from ${sel.length} line(s)`} width={900} destroyOnHidden
        onCancel={() => setCreateOpen(false)} onOk={create} okText="Create purchase order" confirmLoading={busy}>
        <Form form={form} layout="vertical">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 16 }}>
            <Form.Item name="supplierId" label="Supplier" rules={[{ required: true }]}>
              <Select showSearch optionFilterProp="label" options={supplierOptions(lookups.sites)}
                onChange={() => form.setFieldValue('supplierSiteId', undefined)} />
            </Form.Item>
            <Form.Item name="supplierSiteId" label="Supplier site" rules={[{ required: true }]}>
              <Select options={sites} disabled={!supplierId} />
            </Form.Item>
            <Form.Item name="currencyCode" label="Currency"><Select options={lookups.currencies.map(c => ({ value: c, label: c }))} showSearch /></Form.Item>
            {currencyCode && fc && currencyCode !== fc ? (
              <Form.Item name="rate" label={`Rate to ${fc} (blank = daily rate)`}><InputNumber style={{ width: '100%' }} min={0} /></Form.Item>
            ) : <div />}
            <Form.Item name="description" label="PO description" style={{ gridColumn: '1 / span 2' }}><Input maxLength={240} /></Form.Item>
          </div>
        </Form>
        {lookups.sites.length === 0 && <Alert type="warning" showIcon message="No purchasing supplier sites are assigned to this business unit (RR_SUPPLIER_SITES purchasing flag + site assignment)." />}
        <Table size="small" rowKey="REQ_LINE_ID" pagination={false} dataSource={selected}
          columns={[
            { title: 'Line', render: (_, r) => `${r.REQ_NUMBER}-${r.LINE_NUM}`, width: 140 },
            { title: 'Description', dataIndex: 'ITEM_DESCRIPTION', ellipsis: true },
            { title: 'Qty', width: 90, align: 'right', render: (_, r) => r.LINE_TYPE === 'QUANTITY' ? qty(r.QUANTITY) : '—' },
            { title: 'Requested', width: 120, align: 'right', render: (_, r) => money(r.LINE_TYPE === 'QUANTITY' ? r.UNIT_PRICE : r.AMOUNT) },
            { title: 'Negotiated price / amount', width: 180, render: (_, r) => (
              <InputNumber size="small" min={0} style={{ width: '100%' }} placeholder="keep"
                value={prices[Number(r.REQ_LINE_ID)]}
                onChange={v => setPrices(p => ({ ...p, [Number(r.REQ_LINE_ID)]: v as number }))} />) },
            { title: 'PO amount', width: 120, align: 'right', render: (_, r) => {
              const p = prices[Number(r.REQ_LINE_ID)];
              const amt = r.LINE_TYPE === 'QUANTITY' ? n(r.QUANTITY) * n(p ?? r.UNIT_PRICE) : n(p ?? r.AMOUNT);
              return money(r2(amt));
            } },
          ]} />
      </Modal>
    </div>
  );
};

export default BuyerWorkbench;
