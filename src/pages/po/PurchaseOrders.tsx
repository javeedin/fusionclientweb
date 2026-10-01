// Purchasing-RR — Manage Purchase Orders (search) + the PO form (?id=… / ?id=new).
import React, { useCallback, useEffect, useState } from 'react';
import { Card, Table, Button, Space, Input, Segmented, Typography, Tag, Checkbox, message, Progress, Tooltip } from 'antd';
import { PlusOutlined, ReloadOutlined, ShoppingCartOutlined, DownloadOutlined } from '@ant-design/icons';
import { useSearchParams } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { poQuery, lit, nlit, money, day, Row, n } from '../../services/po.service';
import { PoBar, BuNotSetUp, StatusTag, useBusinessUnits, usePoUser } from './poShared';
import PurchaseOrderEditor from './PurchaseOrderEditor';

const { Text } = Typography;

const PurchaseOrders: React.FC = () => {
  const buState = useBusinessUnits();
  const user = usePoUser();
  const [params, setParams] = useSearchParams();
  const openId = params.get('id');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('OPEN');
  const [mine, setMine] = useState(false);
  const [search, setSearch] = useState(params.get('q') || '');

  const load = useCallback(async () => {
    if (!buState.bu) { setRows([]); return; }
    setLoading(true);
    try {
      const where = [`BUSINESS_UNIT_ID = ${nlit(buState.bu)}`];
      if (status === 'OPEN') where.push(`DOCUMENT_STATUS = 'APPROVED' AND CLOSURE_STATUS IN ('OPEN','CLOSED_FOR_INVOICING')`);
      else if (status === 'DRAFT') where.push(`DOCUMENT_STATUS IN ('INCOMPLETE','REJECTED')`);
      else if (status === 'CLOSED') where.push(`CLOSURE_STATUS IN ('CLOSED','FINALLY_CLOSED','CLOSED_FOR_RECEIVING')`);
      else if (status === 'HOLD') where.push(`HOLD_FLAG = 'Y'`);
      else if (status !== 'ALL') where.push(`DOCUMENT_STATUS = ${lit(status)}`);
      if (mine) where.push(`UPPER(BUYER_USER) = UPPER(${lit(user)})`);
      if (search.trim()) {
        const s = lit(`%${search.trim().toUpperCase()}%`);
        where.push(`(UPPER(PO_NUMBER) LIKE ${s} OR UPPER(SUPPLIER_NAME) LIKE ${s} OR UPPER(DESCRIPTION) LIKE ${s})`);
      }
      setRows(await poQuery(`SELECT * FROM RR_PO_V_ORDERS WHERE ${where.join(' AND ')} ORDER BY PO_HEADER_ID DESC`, 1000));
    } catch (e: any) { message.error(e.message); } finally { setLoading(false); }
  }, [buState.bu, status, mine, search, user]);
  useEffect(() => { if (!openId) load(); }, [load, openId]);

  if (openId) {
    return <PurchaseOrderEditor key={openId} id={openId === 'new' ? null : Number(openId)} buState={buState} user={user}
      onBack={() => setParams({})} onOpen={i => setParams({ id: String(i) })} />;
  }

  const exportXlsx = () => {
    const ws = XLSX.utils.json_to_sheet(rows.map(r => ({
      'PO': r.PO_NUMBER, Revision: r.REVISION_NUM, Supplier: r.SUPPLIER_NAME, Site: r.SITE_NAME, Description: r.DESCRIPTION,
      Status: r.DOCUMENT_STATUS, Closure: r.CLOSURE_STATUS, Currency: r.CURRENCY_CODE, Ordered: n(r.TOTAL_AMOUNT),
      Received: n(r.AMOUNT_RECEIVED), Billed: n(r.AMOUNT_BILLED), 'To receive': n(r.AMOUNT_TO_RECEIVE),
      Buyer: r.BUYER_USER, Created: day(r.CREATION_DATE), Approved: day(r.APPROVED_DATE),
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Purchase Orders');
    XLSX.writeFile(wb, `purchase-orders-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <div style={{ padding: 20 }}>
      <PoBar title="Purchase Orders" subtitle="Direct and requisition-based purchase orders" icon={<ShoppingCartOutlined />}
        buState={buState}
        extra={<Button type="primary" icon={<PlusOutlined />} disabled={!buState.bu} onClick={() => setParams({ id: 'new' })}>New purchase order</Button>} />
      <BuNotSetUp current={buState.current} />
      <Card size="small">
        <Space wrap style={{ marginBottom: 12 }}>
          <Segmented value={status} onChange={v => setStatus(String(v))} options={[
            { value: 'OPEN', label: 'Open' }, { value: 'DRAFT', label: 'Draft' }, { value: 'PENDING_APPROVAL', label: 'Pending' },
            { value: 'HOLD', label: 'On hold' }, { value: 'CLOSED', label: 'Closed' }, { value: 'CANCELLED', label: 'Cancelled' },
            { value: 'ALL', label: 'All' }]} />
          <Checkbox checked={mine} onChange={e => setMine(e.target.checked)}>My orders (buyer)</Checkbox>
          <Input.Search allowClear defaultValue={search} placeholder="PO, supplier or description" style={{ width: 280 }} onSearch={setSearch} />
          <Button icon={<ReloadOutlined />} onClick={load}>Refresh</Button>
          <Button icon={<DownloadOutlined />} disabled={!rows.length} onClick={exportXlsx}>Excel</Button>
        </Space>
        <Table size="small" rowKey="PO_HEADER_ID" loading={loading} dataSource={rows} pagination={{ pageSize: 20 }} scroll={{ x: 1300 }}
          onRow={r => ({ onClick: () => setParams({ id: String(r.PO_HEADER_ID) }), style: { cursor: 'pointer' } })}
          columns={[
            { title: 'PO', dataIndex: 'PO_NUMBER', width: 160, render: (v, r) => <Space size={4}><Text strong>{v}</Text>
              {n(r.REVISION_NUM) > 0 && <Tag>R{r.REVISION_NUM}</Tag>}{r.HOLD_FLAG === 'Y' && <Tag color="red">Hold</Tag>}
              {n(r.PENDING_CHANGES) > 0 && <Tag color="gold">CO</Tag>}</Space> },
            { title: 'Supplier', dataIndex: 'SUPPLIER_NAME', width: 220, ellipsis: true },
            { title: 'Description', dataIndex: 'DESCRIPTION', ellipsis: true },
            { title: 'Status', width: 210, render: (_, r) => <Space size={2}><StatusTag s={r.DOCUMENT_STATUS} />
              {r.DOCUMENT_STATUS === 'APPROVED' && <StatusTag s={r.CLOSURE_STATUS} />}</Space> },
            { title: 'Ordered', width: 150, align: 'right', render: (_, r) => `${money(r.TOTAL_AMOUNT)} ${r.CURRENCY_CODE}` },
            { title: 'Received', width: 130, render: (_, r) => {
              const o = n(r.TOTAL_AMOUNT) - n(r.AMOUNT_CANCELLED);
              const p = o > 0 ? Math.min(100, Math.round(n(r.AMOUNT_RECEIVED) / o * 100)) : 0;
              return <Tooltip title={`${money(r.AMOUNT_RECEIVED)} received · ${money(r.AMOUNT_TO_RECEIVE)} to receive`}><Progress percent={p} size="small" /></Tooltip>;
            } },
            { title: 'Buyer', dataIndex: 'BUYER_USER', width: 110 },
            { title: 'Created', dataIndex: 'CREATION_DATE', width: 100, render: day },
          ]} />
      </Card>
    </div>
  );
};

export default PurchaseOrders;
