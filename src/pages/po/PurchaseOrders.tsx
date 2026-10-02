// Purchasing-RR — Manage Purchase Orders. Same flow as the other "Manage" pages:
// a Search tab, and every opened or new purchase order in its own closable tab.
// Deep links (?id=123 / ?id=new from other Purchasing pages) open a tab.
import React, { useCallback, useEffect, useState } from 'react';
import { Card, Table, Button, Space, Input, Segmented, Typography, Tag, Checkbox, message, Progress, Tooltip, Tabs, Modal } from 'antd';
import { PlusOutlined, ReloadOutlined, DownloadOutlined, SearchOutlined, FileTextOutlined, FileAddOutlined } from '@ant-design/icons';
import { useSearchParams } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { poQuery, lit, nlit, money, day, Row, n } from '../../services/po.service';
import { PoBar, BuNotSetUp, StatusTag, useBusinessUnits, usePoUser } from './poShared';
import PurchaseOrderEditor from './PurchaseOrderEditor';

const { Text } = Typography;

interface PoTab { key: string; id: number | null; label: string; dirty?: boolean }
let newSeq = 0;

// ── Search tab ─────────────────────────────────────────────────────────────
const SearchTab: React.FC<{ buState: ReturnType<typeof useBusinessUnits>; user: string; onOpen: (r: Row) => void; onNew: () => void; refreshKey: number }> =
  ({ buState, user, onOpen, onNew, refreshKey }) => {
    const [rows, setRows] = useState<Row[]>([]);
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState('OPEN');
    const [mine, setMine] = useState(false);
    const [search, setSearch] = useState('');

    const load = useCallback(async () => {
      setLoading(true);
      try {
        const where = ['1 = 1'];
        if (buState.bu) where.push(`BUSINESS_UNIT_ID = ${nlit(buState.bu)}`);
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
    useEffect(() => { load(); }, [load, refreshKey]);

    const exportXlsx = () => {
      const ws = XLSX.utils.json_to_sheet(rows.map(r => ({
        PO: r.PO_NUMBER, Revision: r.REVISION_NUM, 'Business unit': r.BUSINESS_UNIT_NAME, Supplier: r.SUPPLIER_NAME, Site: r.SITE_NAME,
        Description: r.DESCRIPTION, Status: r.DOCUMENT_STATUS, Closure: r.CLOSURE_STATUS, Currency: r.CURRENCY_CODE,
        Ordered: n(r.TOTAL_AMOUNT), Received: n(r.AMOUNT_RECEIVED), Billed: n(r.AMOUNT_BILLED), 'To receive': n(r.AMOUNT_TO_RECEIVE),
        Buyer: r.BUYER_USER, Created: day(r.CREATION_DATE), Approved: day(r.APPROVED_DATE),
      })));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Purchase Orders');
      XLSX.writeFile(wb, `purchase-orders-${new Date().toISOString().slice(0, 10)}.xlsx`);
    };

    return (
      <div style={{ padding: 16 }}>
        <BuNotSetUp current={buState.current} />
        <Card size="small">
          <Space wrap style={{ marginBottom: 12 }}>
            <Segmented value={status} onChange={v => setStatus(String(v))} options={[
              { value: 'OPEN', label: 'Open' }, { value: 'DRAFT', label: 'Draft' }, { value: 'PENDING_APPROVAL', label: 'Pending' },
              { value: 'HOLD', label: 'On hold' }, { value: 'CLOSED', label: 'Closed' }, { value: 'CANCELLED', label: 'Cancelled' },
              { value: 'ALL', label: 'All' }]} />
            <Checkbox checked={mine} onChange={e => setMine(e.target.checked)}>My orders (buyer)</Checkbox>
            <Input.Search allowClear placeholder="PO, supplier or description" style={{ width: 280 }} onSearch={setSearch} />
            <Button icon={<ReloadOutlined />} onClick={load}>Refresh</Button>
            <Button icon={<DownloadOutlined />} disabled={!rows.length} onClick={exportXlsx}>Excel</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={onNew}>New purchase order</Button>
          </Space>
          <Table size="small" rowKey="PO_HEADER_ID" loading={loading} dataSource={rows} pagination={{ pageSize: 20 }} scroll={{ x: 1300 }}
            onRow={r => ({ onDoubleClick: () => onOpen(r), style: { cursor: 'pointer' } })}
            columns={[
              { title: 'PO', dataIndex: 'PO_NUMBER', width: 170, render: (v, r) => <Space size={4}>
                <a onClick={() => onOpen(r)}>{v}</a>
                {n(r.REVISION_NUM) > 0 && <Tag>R{r.REVISION_NUM}</Tag>}{r.HOLD_FLAG === 'Y' && <Tag color="red">Hold</Tag>}
                {n(r.PENDING_CHANGES) > 0 && <Tag color="gold">CO</Tag>}</Space> },
              ...(!buState.bu ? [{ title: 'Business unit', dataIndex: 'BUSINESS_UNIT_NAME', width: 170, ellipsis: true }] : []),
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
          <Text type="secondary" style={{ fontSize: 12 }}>Click the PO number (or double-click a row) to open it in its own tab.</Text>
        </Card>
      </div>
    );
  };

// ── Workspace ──────────────────────────────────────────────────────────────
const PurchaseOrders: React.FC = () => {
  const buState = useBusinessUnits();
  const user = usePoUser();
  const [params, setParams] = useSearchParams();
  const [tabs, setTabs] = useState<PoTab[]>([]);
  const [active, setActive] = useState('search');
  const [refreshKey, setRefreshKey] = useState(0);

  const openPo = useCallback((id: number, label?: string) => {
    const key = `po-${id}`;
    setTabs(ts => (ts.some(t => t.key === key) ? ts : [...ts, { key, id, label: label || `PO #${id}` }]));
    setActive(key);
  }, []);
  const newPo = useCallback(() => {
    const key = `new-${++newSeq}`;
    setTabs(ts => [...ts, { key, id: null, label: `New PO ${newSeq}` }]);
    setActive(key);
  }, []);
  const closeTab = useCallback((key: string, confirm = false) => {
    const doClose = () => {
      setTabs(ts => {
        const i = ts.findIndex(t => t.key === key);
        const rest = ts.filter(t => t.key !== key);
        setActive(a => (a === key ? (rest[i - 1]?.key ?? rest[i]?.key ?? 'search') : a));
        return rest;
      });
      setRefreshKey(k => k + 1);
    };
    const t = tabs.find(x => x.key === key);
    if (confirm && t && !t.id) {
      Modal.confirm({ title: `Close ${t.label}?`, content: 'This purchase order has not been saved yet.', okText: 'Close tab', okButtonProps: { danger: true }, onOk: doClose });
    } else doClose();
  }, [tabs]);

  // deep links from other Purchasing pages
  useEffect(() => {
    const id = params.get('id');
    if (!id) return;
    if (id === 'new') newPo(); else if (Number(id)) openPo(Number(id));
    setParams({}, { replace: true });
  }, [params, setParams, newPo, openPo]);

  const items = [
    { key: 'search', closable: false, label: <Space size={4}><SearchOutlined />Search</Space>,
      children: <SearchTab buState={buState} user={user} refreshKey={refreshKey} onNew={newPo}
        onOpen={r => openPo(Number(r.PO_HEADER_ID), String(r.PO_NUMBER))} /> },
    ...tabs.map(t => ({
      key: t.key, closable: true,
      label: <Space size={4}>{t.id ? <FileTextOutlined /> : <FileAddOutlined />}
        <span style={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', display: 'inline-block', whiteSpace: 'nowrap', verticalAlign: 'bottom' }}>{t.label}</span></Space>,
      children: (
        <PurchaseOrderEditor key={t.key} id={t.id} buState={buState} user={user}
          onSaved={(id, num) => setTabs(ts => ts.map(x => (x.key === t.key ? { ...x, id, label: num || `PO #${id}` } : x)))}
          onOpenOther={id => openPo(id)}
          onClose={() => closeTab(t.key)} />
      ),
    })),
  ];

  return (
    <div style={{ padding: '12px 20px 20px' }}>
      <PoBar title="Purchase Orders" subtitle="Direct and requisition-based purchase orders" buState={buState} allowAllBu
        extra={<Button type="primary" icon={<PlusOutlined />} onClick={newPo}>New purchase order</Button>} />
      <Tabs type="editable-card" hideAdd activeKey={active} onChange={setActive} items={items}
        onEdit={(key, action) => { if (action === 'remove') closeTab(String(key), true); }}
        style={{ background: '#fff', borderRadius: 8 }} tabBarStyle={{ margin: 0, paddingLeft: 8 }} />
    </div>
  );
};

export default PurchaseOrders;
