// Purchasing-RR — Receiving: receive against approved PO schedules (one supplier
// site per receipt), and review receipts with return-to-supplier / correction.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Card, Table, Button, Space, Input, Typography, Tag, Tabs, InputNumber, Modal, Form, Alert, message, Segmented, Tooltip,
} from 'antd';
import { InboxOutlined, ReloadOutlined, CheckOutlined, UndoOutlined, EditOutlined } from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { poQuery, poExec, PROC, lit, nlit, money, qty, day, today, Row, n } from '../../services/po.service';
import { PoBar, BuNotSetUp, StatusTag, useBusinessUnits, usePoUser } from './poShared';

const { Text } = Typography;

const Receiving: React.FC = () => {
  const buState = useBusinessUnits();
  const [params] = useSearchParams();
  const [tab, setTab] = useState(params.get('tab') || 'receive');
  return (
    <div style={{ padding: 20 }}>
      <PoBar title="Receiving" subtitle="Confirm goods and services received · returns · corrections" icon={<InboxOutlined />} buState={buState} />
      <BuNotSetUp current={buState.current} />
      <Tabs activeKey={tab} onChange={setTab} items={[
        { key: 'receive', label: 'Receive', children: <ReceiveTab bu={buState.bu} initialPo={params.get('po') || ''} /> },
        { key: 'receipts', label: 'Receipts', children: <ReceiptsTab bu={buState.bu} /> },
      ]} />
    </div>
  );
};

// ── Receive ────────────────────────────────────────────────────────────────
const ReceiveTab: React.FC<{ bu: number | null; initialPo: string }> = ({ bu, initialPo }) => {
  const user = usePoUser();
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState(initialPo);
  const [scope, setScope] = useState<'MINE' | 'ALL'>(initialPo ? 'ALL' : 'ALL');
  const [sel, setSel] = useState<number[]>([]);
  const [recv, setRecv] = useState<Record<number, number | null>>({});
  const [comments, setComments] = useState<Record<number, string>>({});
  const [hdr, setHdr] = useState({ receiptDate: today(), deliveryNote: '', comments: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!bu) { setRows([]); return; }
    setLoading(true);
    try {
      const where = [`BUSINESS_UNIT_ID = ${nlit(bu)}`, `NVL(QUANTITY_REMAINING, AMOUNT_REMAINING) > 0`];
      if (scope === 'MINE') where.push(`UPPER(REQUESTER_USER) = UPPER(${lit(user)})`);
      if (search.trim()) {
        const s = lit(`%${search.trim().toUpperCase()}%`);
        where.push(`(UPPER(PO_NUMBER) LIKE ${s} OR UPPER(SUPPLIER_NAME) LIKE ${s} OR UPPER(ITEM_DESCRIPTION) LIKE ${s})`);
      }
      const r = await poQuery(`SELECT * FROM RR_PO_V_OPEN_SCHEDULES WHERE ${where.join(' AND ')} ORDER BY NEED_BY_DATE, PO_NUMBER, LINE_NUM`);
      setRows(r); setSel([]); setRecv({}); setComments({});
    } catch (e: any) { message.error(e.message); } finally { setLoading(false); }
  }, [bu, scope, search, user]);
  useEffect(() => { load(); }, [load]);

  const selected = useMemo(() => rows.filter(r => sel.includes(Number(r.SCHEDULE_ID))), [rows, sel]);
  const sites = Array.from(new Set(selected.map(r => r.SUPPLIER_SITE_ID)));
  const remaining = (r: Row) => (r.LINE_TYPE === 'QUANTITY' ? n(r.QUANTITY_REMAINING) : n(r.AMOUNT_REMAINING));
  const value = (r: Row) => recv[Number(r.SCHEDULE_ID)] ?? remaining(r);

  const onSelect = (keys: React.Key[]) => {
    const ks = keys.map(Number);
    const first = rows.find(r => ks.includes(Number(r.SCHEDULE_ID)));
    // keep the selection on one supplier site — a receipt belongs to one supplier site
    setSel(first ? ks.filter(k => rows.find(r => Number(r.SCHEDULE_ID) === k)?.SUPPLIER_SITE_ID === first.SUPPLIER_SITE_ID) : ks);
  };

  const receive = async () => {
    if (!selected.length) return;
    const lines = selected.map(r => ({
      scheduleId: Number(r.SCHEDULE_ID),
      quantity: r.LINE_TYPE === 'QUANTITY' ? value(r) : null,
      amount: r.LINE_TYPE === 'QUANTITY' ? null : value(r),
      comments: comments[Number(r.SCHEDULE_ID)] || null,
    })).filter(l => n(l.quantity ?? l.amount) > 0);
    if (!lines.length) { message.warning('Enter what was received'); return; }
    setBusy(true);
    try {
      const r = await poExec(PROC.receive, {
        p_json: { receiptDate: hdr.receiptDate, deliveryNote: hdr.deliveryNote || null, comments: hdr.comments || null, lines },
      }, user);
      Modal[r.status === 'W' ? 'warning' : 'success']({ title: `Receipt ${r.number || ''}`, content: r.message });
      setHdr(h => ({ ...h, deliveryNote: '', comments: '' }));
      load();
    } catch (e: any) { message.error(e.message, 10); } finally { setBusy(false); }
  };

  return (
    <Card size="small">
      <Space wrap style={{ marginBottom: 12 }}>
        <Segmented value={scope} onChange={v => setScope(v as 'MINE' | 'ALL')}
          options={[{ value: 'ALL', label: 'All open' }, { value: 'MINE', label: 'Requested by me' }]} />
        <Input.Search allowClear defaultValue={initialPo} placeholder="PO, supplier or item" style={{ width: 280 }} onSearch={setSearch} />
        <Button icon={<ReloadOutlined />} onClick={load}>Refresh</Button>
      </Space>
      <Table size="small" rowKey="SCHEDULE_ID" loading={loading} dataSource={rows} pagination={{ pageSize: 25 }} scroll={{ x: 1350 }}
        rowSelection={{ selectedRowKeys: sel, onChange: onSelect,
          getCheckboxProps: r => ({ disabled: sel.length > 0 && selected[0] && r.SUPPLIER_SITE_ID !== selected[0].SUPPLIER_SITE_ID }) }}
        columns={[
          { title: 'PO', dataIndex: 'PO_NUMBER', width: 150, render: (v, r) => <a onClick={() => navigate(`/po/orders?id=${r.PO_HEADER_ID}`)}>{v}-{r.LINE_NUM}</a> },
          { title: 'Supplier', dataIndex: 'SUPPLIER_NAME', width: 190, ellipsis: true, render: (v, r) => <Tooltip title={r.SITE_NAME}>{v}</Tooltip> },
          { title: 'Item', dataIndex: 'ITEM_DESCRIPTION', ellipsis: true },
          { title: 'Need by', dataIndex: 'NEED_BY_DATE', width: 100, render: v => <Text type={day(v) < today() ? 'danger' : undefined}>{day(v)}</Text> },
          { title: 'Ordered', width: 110, align: 'right', render: (_, r) => r.LINE_TYPE === 'QUANTITY' ? `${qty(r.QUANTITY_ORDERED)} ${r.UOM_CODE || ''}` : money(r.AMOUNT_ORDERED) },
          { title: 'Received', width: 100, align: 'right', render: (_, r) => r.LINE_TYPE === 'QUANTITY' ? qty(r.QUANTITY_RECEIVED) : money(r.AMOUNT_RECEIVED) },
          { title: 'Remaining', width: 100, align: 'right', render: (_, r) => <Text strong>{r.LINE_TYPE === 'QUANTITY' ? qty(remaining(r)) : money(remaining(r))}</Text> },
          { title: 'Receive now', width: 140, render: (_, r) => (
            <InputNumber size="small" min={0} style={{ width: '100%' }} disabled={!sel.includes(Number(r.SCHEDULE_ID))}
              value={value(r)} onChange={v => setRecv(m => ({ ...m, [Number(r.SCHEDULE_ID)]: v as number }))}
              status={value(r) > remaining(r) ? 'warning' : undefined}
              addonAfter={r.LINE_TYPE === 'QUANTITY' ? r.UOM_CODE : r.CURRENCY_CODE} />) },
          { title: 'Comments', width: 180, render: (_, r) => (
            <Input size="small" disabled={!sel.includes(Number(r.SCHEDULE_ID))} value={comments[Number(r.SCHEDULE_ID)] || ''}
              onChange={e => setComments(m => ({ ...m, [Number(r.SCHEDULE_ID)]: e.target.value }))} />) },
        ]} />
      <Card size="small" style={{ marginTop: 12, background: '#fafafa' }}>
        <Space wrap align="end">
          <div><Text type="secondary">Receipt date</Text><br />
            <Input type="date" value={hdr.receiptDate} max={today()} onChange={e => setHdr(h => ({ ...h, receiptDate: e.target.value }))} /></div>
          <div><Text type="secondary">Delivery note / waybill</Text><br />
            <Input value={hdr.deliveryNote} onChange={e => setHdr(h => ({ ...h, deliveryNote: e.target.value }))} style={{ width: 200 }} /></div>
          <div><Text type="secondary">Comments</Text><br />
            <Input value={hdr.comments} onChange={e => setHdr(h => ({ ...h, comments: e.target.value }))} style={{ width: 300 }} /></div>
          <Button type="primary" icon={<CheckOutlined />} loading={busy} disabled={!sel.length} onClick={receive}>
            Receive {sel.length ? `${sel.length} line(s)` : ''}</Button>
          {sites.length === 1 && selected[0] && <Text type="secondary">Supplier: {selected[0].SUPPLIER_NAME} · {selected[0].SITE_NAME}</Text>}
        </Space>
      </Card>
    </Card>
  );
};

// ── Receipts (returns / corrections) ──────────────────────────────────────
const ReceiptsTab: React.FC<{ bu: number | null }> = ({ bu }) => {
  const user = usePoUser();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [days, setDays] = useState<number>(90);
  const [adj, setAdj] = useState<{ type: 'RETURN' | 'CORRECT'; row: Row } | null>(null);
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!bu) { setRows([]); return; }
    setLoading(true);
    try {
      const where = [`BUSINESS_UNIT_ID = ${nlit(bu)}`, `TRANSACTION_DATE >= TRUNC(SYSDATE) - ${nlit(days)}`];
      if (search.trim()) {
        const s = lit(`%${search.trim().toUpperCase()}%`);
        where.push(`(UPPER(RECEIPT_NUMBER) LIKE ${s} OR UPPER(PO_NUMBER) LIKE ${s} OR UPPER(SUPPLIER_NAME) LIKE ${s} OR UPPER(DELIVERY_NOTE_NUM) LIKE ${s})`);
      }
      setRows(await poQuery(`SELECT * FROM RR_PO_V_RECEIPTS WHERE ${where.join(' AND ')} ORDER BY RCV_TRANSACTION_ID DESC`));
    } catch (e: any) { message.error(e.message); } finally { setLoading(false); }
  }, [bu, search, days]);
  useEffect(() => { load(); }, [load]);

  const open = (type: 'RETURN' | 'CORRECT', row: Row) => {
    form.resetFields();
    form.setFieldsValue({ txnDate: today(), value: type === 'RETURN' ? (row.LINE_TYPE === 'QUANTITY' ? row.QUANTITY_RETURNABLE : row.AMOUNT_RETURNABLE) : null });
    setAdj({ type, row });
  };
  const submit = async () => {
    if (!adj) return;
    const v = await form.validateFields();
    const isQ = adj.row.LINE_TYPE === 'QUANTITY';
    setBusy(true);
    try {
      const r = adj.type === 'RETURN'
        ? await poExec(PROC.returnRcv, { p_rcv_transaction_id: adj.row.RCV_TRANSACTION_ID, p_quantity: isQ ? v.value : null,
          p_amount: isQ ? null : v.value, p_reason: v.reason, p_txn_date: v.txnDate, p_comments: v.comments || null }, user)
        : await poExec(PROC.correctRcv, { p_rcv_transaction_id: adj.row.RCV_TRANSACTION_ID, p_quantity: isQ ? v.value : null,
          p_amount: isQ ? null : v.value, p_txn_date: v.txnDate, p_comments: v.comments || null }, user);
      message.success(r.message);
      setAdj(null); load();
    } catch (e: any) { message.error(e.message, 10); } finally { setBusy(false); }
  };

  return (
    <Card size="small">
      <Space wrap style={{ marginBottom: 12 }}>
        <Segmented value={days} onChange={v => setDays(Number(v))} options={[{ value: 30, label: '30 days' }, { value: 90, label: '90 days' }, { value: 365, label: '1 year' }, { value: 3650, label: 'All' }]} />
        <Input.Search allowClear placeholder="Receipt, PO, supplier, delivery note" style={{ width: 300 }} onSearch={setSearch} />
        <Button icon={<ReloadOutlined />} onClick={load}>Refresh</Button>
      </Space>
      <Table size="small" rowKey="RCV_TRANSACTION_ID" loading={loading} dataSource={rows} pagination={{ pageSize: 25 }} scroll={{ x: 1400 }}
        columns={[
          { title: 'Receipt', dataIndex: 'RECEIPT_NUMBER', width: 150 },
          { title: 'Type', dataIndex: 'TRANSACTION_TYPE', width: 150, render: v => <StatusTag s={v} /> },
          { title: 'Date', dataIndex: 'TRANSACTION_DATE', width: 100, render: day },
          { title: 'PO', width: 140, render: (_, r) => `${r.PO_NUMBER}-${r.LINE_NUM}` },
          { title: 'Supplier', dataIndex: 'SUPPLIER_NAME', width: 180, ellipsis: true },
          { title: 'Item', dataIndex: 'ITEM_DESCRIPTION', ellipsis: true },
          { title: 'Qty', width: 90, align: 'right', render: (_, r) => r.LINE_TYPE === 'QUANTITY' ? `${qty(r.QUANTITY)} ${r.UOM_CODE || ''}` : '' },
          { title: 'Amount', width: 120, align: 'right', render: (_, r) => `${money(r.AMOUNT)} ${r.CURRENCY_CODE}` },
          { title: 'Delivery note', dataIndex: 'DELIVERY_NOTE_NUM', width: 120 },
          { title: 'Accounting', dataIndex: 'ACCOUNTING_STATUS', width: 120, render: v => <StatusTag s={v} /> },
          { title: '', width: 170, fixed: 'right', render: (_, r) => r.TRANSACTION_TYPE === 'RECEIVE' ? (
            <Space size={4}>
              <Button size="small" icon={<UndoOutlined />} disabled={n(r.LINE_TYPE === 'QUANTITY' ? r.QUANTITY_RETURNABLE : r.AMOUNT_RETURNABLE) <= 0}
                onClick={() => open('RETURN', r)}>Return</Button>
              <Button size="small" icon={<EditOutlined />} onClick={() => open('CORRECT', r)}>Correct</Button>
            </Space>) : r.PARENT_TRANSACTION_ID ? <Tag>of #{r.PARENT_TRANSACTION_ID}</Tag> : null },
        ]} />
      <Modal open={!!adj} destroyOnHidden width={520} onCancel={() => setAdj(null)} onOk={submit} confirmLoading={busy}
        title={adj ? `${adj.type === 'RETURN' ? 'Return to supplier' : 'Correct receipt'} — ${adj.row.RECEIPT_NUMBER} · ${adj.row.ITEM_DESCRIPTION}` : ''}>
        {adj && (
          <Form form={form} layout="vertical">
            <Alert style={{ marginBottom: 12 }} type="info" showIcon message={adj.type === 'RETURN'
              ? `Returnable: ${adj.row.LINE_TYPE === 'QUANTITY' ? qty(adj.row.QUANTITY_RETURNABLE) : money(adj.row.AMOUNT_RETURNABLE)}`
              : 'Enter a positive value to add, a negative value to reduce what was received'} />
            <Form.Item name="value" label={adj.row.LINE_TYPE === 'QUANTITY' ? 'Quantity' : 'Amount'} rules={[{ required: true }]}>
              <InputNumber style={{ width: '100%' }} min={adj.type === 'RETURN' ? 0 : undefined} />
            </Form.Item>
            {adj.type === 'RETURN' && <Form.Item name="reason" label="Reason" rules={[{ required: true }]}><Input /></Form.Item>}
            <Form.Item name="txnDate" label="Date" rules={[{ required: true }]}><Input type="date" /></Form.Item>
            <Form.Item name="comments" label="Comments"><Input.TextArea rows={2} /></Form.Item>
          </Form>
        )}
      </Modal>
    </Card>
  );
};

export default Receiving;
