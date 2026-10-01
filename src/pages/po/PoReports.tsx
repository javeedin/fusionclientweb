// Purchasing-RR — reports: spend, open/overdue purchase orders, requisition
// backlog and the write-call activity log. Every grid exports to Excel.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, Table, Button, Space, Tabs, Segmented, Typography, message, Input, Tag } from 'antd';
import { BarChartOutlined, DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import * as XLSX from 'xlsx';
import { poQuery, nlit, lit, money, day, today, Row, n } from '../../services/po.service';
import { PoBar, StatusTag, useBusinessUnits, PO_RED } from './poShared';

const { Text } = Typography;

const toExcel = (name: string, rows: Row[]) => {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 30));
  XLSX.writeFile(wb, `${name.toLowerCase().replace(/\s+/g, '-')}-${today()}.xlsx`);
};

const Bar: React.FC<{ v: number; max: number }> = ({ v, max }) => (
  <div style={{ background: '#f0f0f0', borderRadius: 3, height: 10, width: '100%' }}>
    <div style={{ background: PO_RED, borderRadius: 3, height: 10, width: `${max > 0 ? Math.max(1, v / max * 100) : 0}%` }} />
  </div>
);

const Spend: React.FC<{ bu: number | null; fc: string }> = ({ bu, fc }) => {
  const [rows, setRows] = useState<Row[]>([]);
  const [by, setBy] = useState<'CATEGORY_NAME' | 'SUPPLIER_NAME' | 'CHARGE_ACCOUNT' | 'SPEND_MONTH'>('CATEGORY_NAME');
  const [months, setMonths] = useState(12);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    if (!bu) return;
    setLoading(true);
    try {
      setRows(await poQuery(`SELECT * FROM RR_PO_V_SPEND WHERE BUSINESS_UNIT_ID = ${nlit(bu)}
                             AND SPEND_MONTH >= ADD_MONTHS(TRUNC(SYSDATE, 'MM'), -${nlit(months - 1)})`));
    } catch (e: any) { message.error(e.message); } finally { setLoading(false); }
  }, [bu, months]);
  useEffect(() => { load(); }, [load]);
  const grouped = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach(r => { const k = by === 'SPEND_MONTH' ? day(r.SPEND_MONTH).slice(0, 7) : String(r[by] ?? '(none)'); m.set(k, (m.get(k) || 0) + n(r.AMOUNT_FUNC)); });
    const arr = Array.from(m.entries()).map(([key, amount]) => ({ key, amount }));
    return by === 'SPEND_MONTH' ? arr.sort((a, b) => a.key.localeCompare(b.key)) : arr.sort((a, b) => b.amount - a.amount);
  }, [rows, by]);
  const max = Math.max(0, ...grouped.map(g => g.amount));
  const total = grouped.reduce((s, g) => s + g.amount, 0);
  return (
    <Card size="small">
      <Space wrap style={{ marginBottom: 12 }}>
        <Segmented value={by} onChange={v => setBy(v as typeof by)} options={[
          { value: 'CATEGORY_NAME', label: 'Category' }, { value: 'SUPPLIER_NAME', label: 'Supplier' },
          { value: 'CHARGE_ACCOUNT', label: 'Charge account' }, { value: 'SPEND_MONTH', label: 'Month' }]} />
        <Segmented value={months} onChange={v => setMonths(Number(v))} options={[{ value: 3, label: '3 m' }, { value: 6, label: '6 m' }, { value: 12, label: '12 m' }, { value: 36, label: '3 y' }]} />
        <Button icon={<ReloadOutlined />} onClick={load}>Refresh</Button>
        <Button icon={<DownloadOutlined />} onClick={() => toExcel('Spend', rows)}>Excel (detail)</Button>
        <Text type="secondary">Received value in {fc} (until AP invoices are matched)</Text>
      </Space>
      <Table size="small" rowKey="key" loading={loading} dataSource={grouped} pagination={{ pageSize: 25 }}
        columns={[
          { title: by === 'SPEND_MONTH' ? 'Month' : by.replace('_NAME', '').replace('_', ' ').toLowerCase(), dataIndex: 'key', width: 320 },
          { title: `Amount (${fc})`, dataIndex: 'amount', width: 160, align: 'right', render: v => money(v) },
          { title: '%', width: 80, align: 'right', render: (_, g) => total ? `${(g.amount / total * 100).toFixed(1)}%` : '' },
          { title: '', render: (_, g) => <Bar v={g.amount} max={max} /> },
        ]}
        summary={() => <Table.Summary.Row><Table.Summary.Cell index={0}><Text strong>Total</Text></Table.Summary.Cell>
          <Table.Summary.Cell index={1} align="right"><Text strong>{money(total)}</Text></Table.Summary.Cell>
          <Table.Summary.Cell index={2} colSpan={2} /></Table.Summary.Row>} />
    </Card>
  );
};

const SimpleReport: React.FC<{ name: string; sql: string | null; rowKey: string; columns: any[]; note?: string }> = ({ name, sql, rowKey, columns, note }) => {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    if (!sql) return;
    setLoading(true);
    try { setRows(await poQuery(sql)); } catch (e: any) { message.error(e.message); } finally { setLoading(false); }
  }, [sql]);
  useEffect(() => { load(); }, [load]);
  return (
    <Card size="small">
      <Space style={{ marginBottom: 12 }}>
        <Button icon={<ReloadOutlined />} onClick={load}>Refresh</Button>
        <Button icon={<DownloadOutlined />} disabled={!rows.length} onClick={() => toExcel(name, rows)}>Excel</Button>
        <Text type="secondary">{rows.length} row(s){note ? ` · ${note}` : ''}</Text>
      </Space>
      <Table size="small" rowKey={rowKey} loading={loading} dataSource={rows} pagination={{ pageSize: 25 }} columns={columns} scroll={{ x: 1100 }} />
    </Card>
  );
};

const PoReports: React.FC = () => {
  const buState = useBusinessUnits();
  const bu = buState.bu;
  const fc = buState.current?.FUNCTIONAL_CURRENCY || '';
  const [logUser, setLogUser] = useState('');
  return (
    <div style={{ padding: 20 }}>
      <PoBar title="Purchasing Reports" subtitle="Spend · open orders · backlog · activity" icon={<BarChartOutlined />} buState={buState} />
      <Tabs items={[
        { key: 'spend', label: 'Spend analysis', children: <Spend bu={bu} fc={fc} /> },
        { key: 'overdue', label: 'Overdue receipts', children: (
          <SimpleReport name="Overdue receipts" rowKey="SCHEDULE_ID"
            sql={bu ? `SELECT * FROM RR_PO_V_OPEN_SCHEDULES WHERE BUSINESS_UNIT_ID = ${nlit(bu)} AND NEED_BY_DATE < TRUNC(SYSDATE)
                       AND NVL(QUANTITY_REMAINING, AMOUNT_REMAINING) > 0 ORDER BY NEED_BY_DATE` : null}
            columns={[
              { title: 'PO', width: 150, render: (_: unknown, r: Row) => `${r.PO_NUMBER}-${r.LINE_NUM}` },
              { title: 'Supplier', dataIndex: 'SUPPLIER_NAME', width: 200, ellipsis: true },
              { title: 'Item', dataIndex: 'ITEM_DESCRIPTION', ellipsis: true },
              { title: 'Need by', dataIndex: 'NEED_BY_DATE', width: 100, render: day },
              { title: 'Days late', width: 90, align: 'right', render: (_: unknown, r: Row) => <Tag color="red">{Math.round((Date.now() - new Date(day(r.NEED_BY_DATE)).getTime()) / 86400000)}</Tag> },
              { title: 'Remaining', width: 130, align: 'right', render: (_: unknown, r: Row) => r.LINE_TYPE === 'QUANTITY' ? `${n(r.QUANTITY_REMAINING)} ${r.UOM_CODE || ''}` : money(r.AMOUNT_REMAINING) },
              { title: 'Value', width: 130, align: 'right', render: (_: unknown, r: Row) => `${money(r.LINE_TYPE === 'QUANTITY' ? n(r.QUANTITY_REMAINING) * n(r.UNIT_PRICE) : r.AMOUNT_REMAINING)} ${r.CURRENCY_CODE}` },
              { title: 'Buyer', dataIndex: 'BUYER_USER', width: 110 }, { title: 'Requester', dataIndex: 'REQUESTER_USER', width: 110 },
            ]} />) },
        { key: 'open', label: 'Open purchase orders', children: (
          <SimpleReport name="Open purchase orders" rowKey="PO_HEADER_ID"
            sql={bu ? `SELECT PO_HEADER_ID, PO_NUMBER, SUPPLIER_NAME, DESCRIPTION, CURRENCY_CODE, TOTAL_AMOUNT, AMOUNT_RECEIVED, AMOUNT_BILLED,
                              AMOUNT_TO_RECEIVE, CLOSURE_STATUS, BUYER_USER, APPROVED_DATE FROM RR_PO_V_ORDERS
                       WHERE BUSINESS_UNIT_ID = ${nlit(bu)} AND DOCUMENT_STATUS = 'APPROVED' AND CLOSURE_STATUS NOT IN ('CLOSED','FINALLY_CLOSED')
                       ORDER BY APPROVED_DATE` : null}
            columns={[
              { title: 'PO', dataIndex: 'PO_NUMBER', width: 150 }, { title: 'Supplier', dataIndex: 'SUPPLIER_NAME', width: 200, ellipsis: true },
              { title: 'Description', dataIndex: 'DESCRIPTION', ellipsis: true },
              { title: 'Ordered', width: 140, align: 'right', render: (_: unknown, r: Row) => `${money(r.TOTAL_AMOUNT)} ${r.CURRENCY_CODE}` },
              { title: 'Received', dataIndex: 'AMOUNT_RECEIVED', width: 120, align: 'right', render: (v: unknown) => money(v) },
              { title: 'Billed', dataIndex: 'AMOUNT_BILLED', width: 110, align: 'right', render: (v: unknown) => money(v) },
              { title: 'To receive', dataIndex: 'AMOUNT_TO_RECEIVE', width: 120, align: 'right', render: (v: unknown) => money(v) },
              { title: 'Status', dataIndex: 'CLOSURE_STATUS', width: 150, render: (v: unknown) => <StatusTag s={v} /> },
              { title: 'Approved', dataIndex: 'APPROVED_DATE', width: 100, render: day },
            ]} />) },
        { key: 'backlog', label: 'Requisition backlog', children: (
          <SimpleReport name="Requisition backlog" rowKey="REQ_LINE_ID" note="approved lines not yet on a purchase order"
            sql={bu ? `SELECT REQ_LINE_ID, REQ_NUMBER, LINE_NUM, ITEM_DESCRIPTION, CATEGORY_NAME, AMOUNT_FUNC, NEED_BY_DATE, APPROVED_DATE,
                              BUYER_USER, REQUESTER_USER, TRUNC(SYSDATE) - TRUNC(APPROVED_DATE) AS DAYS_WAITING
                       FROM RR_PO_V_REQ_LINES WHERE BUSINESS_UNIT_ID = ${nlit(bu)} AND REQ_STATUS = 'APPROVED' AND LINE_STATUS = 'OPEN'
                       ORDER BY APPROVED_DATE` : null}
            columns={[
              { title: 'Requisition', width: 150, render: (_: unknown, r: Row) => `${r.REQ_NUMBER}-${r.LINE_NUM}` },
              { title: 'Item', dataIndex: 'ITEM_DESCRIPTION', ellipsis: true }, { title: 'Category', dataIndex: 'CATEGORY_NAME', width: 160 },
              { title: `Amount (${fc})`, dataIndex: 'AMOUNT_FUNC', width: 130, align: 'right', render: (v: unknown) => money(v) },
              { title: 'Need by', dataIndex: 'NEED_BY_DATE', width: 100, render: day },
              { title: 'Days waiting', dataIndex: 'DAYS_WAITING', width: 110, align: 'right', render: (v: unknown) => <Tag color={n(v) > 5 ? 'red' : n(v) > 2 ? 'gold' : 'green'}>{n(v)}</Tag> },
              { title: 'Buyer', dataIndex: 'BUYER_USER', width: 110 }, { title: 'Requester', dataIndex: 'REQUESTER_USER', width: 110 },
            ]} />) },
        { key: 'log', label: 'Activity log', children: (
          <>
            <Input.Search allowClear placeholder="Filter by user" style={{ width: 240, marginBottom: 8 }} onSearch={setLogUser} />
            <SimpleReport name="Purchasing activity" rowKey="LOG_ID" note="last 500 write calls through po/execute"
              sql={`SELECT LOG_ID, CREATION_DATE, USER_NAME, PROC_NAME, STATUS, MESSAGE, RESULT_ID, ELAPSED_MS FROM RR_PO_EXEC_LOG
                    ${logUser.trim() ? `WHERE UPPER(USER_NAME) LIKE ${lit(`%${logUser.trim().toUpperCase()}%`)}` : ''} ORDER BY LOG_ID DESC FETCH FIRST 500 ROWS ONLY`}
              columns={[
                { title: 'When', dataIndex: 'CREATION_DATE', width: 160, render: (v: unknown) => String(v ?? '').replace('T', ' ').slice(0, 19) },
                { title: 'User', dataIndex: 'USER_NAME', width: 120 },
                { title: 'Call', dataIndex: 'PROC_NAME', width: 280, render: (v: string) => String(v || '').replace('RR_PO_', '').replace('_PKG', '') },
                { title: 'Status', dataIndex: 'STATUS', width: 80, render: (v: string) => <Tag color={v === 'S' ? 'green' : v === 'W' ? 'gold' : 'red'}>{v}</Tag> },
                { title: 'Message', dataIndex: 'MESSAGE', ellipsis: true },
                { title: 'ms', dataIndex: 'ELAPSED_MS', width: 70, align: 'right' },
              ]} />
          </>) },
      ]} />
    </div>
  );
};

export default PoReports;
