// Purchasing-RR — Requisitions: search + create/edit/submit/withdraw/cancel.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Card, Table, Button, Space, Input, Segmented, Typography, Tag, Form, Alert, Popconfirm, message, Checkbox, Spin, Select, Tabs,
} from 'antd';
import {
  PlusOutlined, ReloadOutlined, SaveOutlined, SearchOutlined, PaperClipOutlined, SendOutlined, RollbackOutlined, StopOutlined,
  DeleteOutlined, FileTextOutlined, ThunderboltOutlined,
} from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  poQuery, poExec, PROC, lit, nlit, money, day, plusDays, Row, n,
} from '../../services/po.service';
import {
  PoBar, BuNotSetUp, StatusTag, useBusinessUnits, useLookups, usePoUser, LinesEditor, EditLine, newLine, linesToJson,
  HistoryButton, askReason, lineAmount,
} from './poShared';
import PoAttachments from './PoAttachments';

const { Text } = Typography;
const EDITABLE = ['INCOMPLETE', 'REJECTED'];

interface ReqTab { key: string; id: number | null; label: string }
let newSeq = 0;

const ReqSearchTab: React.FC<{ buState: ReturnType<typeof useBusinessUnits>; user: string; refreshKey: number;
  onOpen: (r: Row) => void; onNew: () => void }> = ({ buState, user, refreshKey, onOpen, onNew }) => {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string>('ACTIVE');
  const [mine, setMine] = useState(true);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const where = ['1 = 1'];
      if (buState.bu) where.push(`BUSINESS_UNIT_ID = ${nlit(buState.bu)}`);
      if (status === 'ACTIVE') where.push(`STATUS IN ('INCOMPLETE','PENDING_APPROVAL','REJECTED','APPROVED')`);
      else if (status !== 'ALL') where.push(`STATUS = ${lit(status)}`);
      if (mine) where.push(`UPPER(PREPARER_USER) = UPPER(${lit(user)})`);
      if (search.trim()) {
        const s = lit(`%${search.trim().toUpperCase()}%`);
        where.push(`(UPPER(REQ_NUMBER) LIKE ${s} OR UPPER(DESCRIPTION) LIKE ${s})`);
      }
      setRows(await poQuery(`SELECT * FROM RR_PO_V_REQUISITIONS WHERE ${where.join(' AND ')} ORDER BY REQ_HEADER_ID DESC`, 500));
    } catch (e: any) { message.error(e.message); } finally { setLoading(false); }
  }, [buState.bu, status, mine, search, user]);
  useEffect(() => { load(); }, [load, refreshKey]);

  return (
    <div style={{ padding: 16 }}>
      <BuNotSetUp current={buState.current} />
      <Card size="small">
        <Space wrap style={{ marginBottom: 12 }}>
          <Segmented value={status} onChange={v => setStatus(String(v))}
            options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'INCOMPLETE', label: 'Draft' },
              { value: 'PENDING_APPROVAL', label: 'Pending' }, { value: 'APPROVED', label: 'Approved' },
              { value: 'REJECTED', label: 'Rejected' }, { value: 'CANCELLED', label: 'Cancelled' }, { value: 'ALL', label: 'All' }]} />
          <Checkbox checked={mine} onChange={e => setMine(e.target.checked)}>Mine only</Checkbox>
          <Input.Search allowClear placeholder="Number or description" style={{ width: 260 }} onSearch={setSearch} />
          <Button icon={<ReloadOutlined />} onClick={load}>Refresh</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={onNew}>New requisition</Button>
        </Space>
        <Table size="small" rowKey="REQ_HEADER_ID" loading={loading} dataSource={rows} pagination={{ pageSize: 20 }}
          onRow={r => ({ onDoubleClick: () => onOpen(r), style: { cursor: 'pointer' } })}
          columns={[
            { title: 'Requisition', dataIndex: 'REQ_NUMBER', width: 170, render: (v, r) => <Space><a onClick={() => onOpen(r)}>{v}</a>{r.URGENT_FLAG === 'Y' && <Tag color="red">Urgent</Tag>}</Space> },
            ...(!buState.bu ? [{ title: 'Business unit', dataIndex: 'BUSINESS_UNIT_NAME', width: 170, ellipsis: true }] : []),
            { title: 'Description', dataIndex: 'DESCRIPTION', ellipsis: true },
            { title: 'Preparer', dataIndex: 'PREPARER_USER', width: 130 },
            { title: 'Status', dataIndex: 'STATUS', width: 140, render: s => <StatusTag s={s} /> },
            { title: 'Amount', dataIndex: 'TOTAL_AMOUNT_FUNC', width: 140, align: 'right', render: (v, r) => `${money(v)} ${r.FUNCTIONAL_CURRENCY || ''}` },
            { title: 'Lines', width: 100, align: 'center', render: (_, r) => `${r.LINES_ON_PO}/${r.LINE_COUNT} on PO` },
            { title: 'Created', dataIndex: 'CREATION_DATE', width: 110, render: day },
          ]} />
      </Card>
    </div>
  );
};

const Requisitions: React.FC = () => {
  const buState = useBusinessUnits();
  const user = usePoUser();
  const [params, setParams] = useSearchParams();
  const [tabs, setTabs] = useState<ReqTab[]>([]);
  const [active, setActive] = useState('search');
  const [refreshKey, setRefreshKey] = useState(0);

  const openReq = useCallback((id: number, label?: string) => {
    const key = `req-${id}`;
    setTabs(ts => (ts.some(t => t.key === key) ? ts : [...ts, { key, id, label: label || `REQ #${id}` }]));
    setActive(key);
  }, []);
  const newReq = useCallback(() => {
    const key = `new-${++newSeq}`;
    setTabs(ts => [...ts, { key, id: null, label: `New requisition ${newSeq}` }]);
    setActive(key);
  }, []);
  const closeTab = useCallback((key: string) => {
    setTabs(ts => {
      const i = ts.findIndex(t => t.key === key);
      const rest = ts.filter(t => t.key !== key);
      setActive(a => (a === key ? (rest[i - 1]?.key ?? rest[i]?.key ?? 'search') : a));
      return rest;
    });
    setRefreshKey(k => k + 1);
  }, []);

  useEffect(() => {
    const id = params.get('id');
    if (!id) return;
    if (id === 'new') newReq(); else if (Number(id)) openReq(Number(id));
    setParams({}, { replace: true });
  }, [params, setParams, newReq, openReq]);

  return (
    <div style={{ padding: '12px 20px 20px' }}>
      <PoBar title="Requisitions" subtitle="Request goods and services · approval · hand-off to buyers" icon={<FileTextOutlined />}
        buState={buState} allowAllBu
        extra={<Button type="primary" icon={<PlusOutlined />} onClick={newReq}>New requisition</Button>} />
      <Tabs type="editable-card" hideAdd activeKey={active} onChange={setActive}
        onEdit={(key, action) => { if (action === 'remove') closeTab(String(key)); }}
        style={{ background: '#fff', borderRadius: 8 }} tabBarStyle={{ margin: 0, paddingLeft: 8 }}
        items={[
          { key: 'search', closable: false, label: <Space size={4}><SearchOutlined />Search</Space>,
            children: <ReqSearchTab buState={buState} user={user} refreshKey={refreshKey} onNew={newReq}
              onOpen={r => openReq(Number(r.REQ_HEADER_ID), String(r.REQ_NUMBER))} /> },
          ...tabs.map(t => ({
            key: t.key, closable: true, label: t.label,
            children: <RequisitionEditor key={t.key} id={t.id} buState={buState} user={user}
              onBack={() => closeTab(t.key)}
              onSaved={(id, num) => setTabs(ts => ts.map(x => (x.key === t.key ? { ...x, id, label: num || `REQ #${id}` } : x)))} />,
          })),
        ]} />
    </div>
  );
};

// ── Editor ─────────────────────────────────────────────────────────────────
export const RequisitionEditor: React.FC<{
  id: number | null; buState: ReturnType<typeof useBusinessUnits>; user: string;
  onBack: () => void; onSaved: (id: number, number?: string | null) => void;
}> = ({ id, buState, user, onBack: onBackProp, onSaved: onSavedProp }) => {
  // parent callbacks change identity every render — keep them in refs so loading does not re-run
  const cb = useRef({ onBackProp, onSavedProp });
  cb.current = { onBackProp, onSavedProp };
  const onBack = useCallback(() => cb.current.onBackProp(), []);
  const onSaved = useCallback((i: number, num?: string | null) => cb.current.onSavedProp(i, num), []);
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [hdr, setHdr] = useState<Row | null>(null);
  const [lines, setLines] = useState<EditLine[]>([]);
  const [loading, setLoading] = useState(!!id);
  const [busy, setBusy] = useState(false);
  const [defaults, setDefaults] = useState<Row | null>(null);
  const [newBu, setNewBu] = useState<number | null>(buState.bu);
  useEffect(() => { setNewBu(b => b ?? buState.bu ?? (buState.bus[0] ? Number(buState.bus[0].BUSINESS_UNIT_ID) : null)); }, [buState.bu, buState.bus]);
  const bu = hdr ? Number(hdr.BUSINESS_UNIT_ID) : newBu;
  const lookups = useLookups(bu);
  const currency = hdr?.FUNCTIONAL_CURRENCY || buState.bus.find(b => Number(b.BUSINESS_UNIT_ID) === bu)?.FUNCTIONAL_CURRENCY || '';
  const editable = !hdr || EDITABLE.includes(hdr.STATUS);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [h] = await poQuery(`SELECT * FROM RR_PO_V_REQUISITIONS WHERE REQ_HEADER_ID = ${nlit(id)}`);
      if (!h) { message.error('Requisition not found'); onBack(); return; }
      const ls = await poQuery(`SELECT * FROM RR_PO_V_REQ_LINES WHERE REQ_HEADER_ID = ${nlit(id)} ORDER BY LINE_NUM`);
      const ds = await poQuery(`SELECT REQ_LINE_ID, PERCENT, CHARGE_ACCOUNT FROM RR_PO_V_REQ_DISTRIBUTIONS
                                WHERE REQ_HEADER_ID = ${nlit(id)} ORDER BY REQ_LINE_ID, DIST_NUM`);
      setHdr(h);
      onSaved(Number(h.REQ_HEADER_ID), String(h.REQ_NUMBER));   // relabel the tab
      form.setFieldsValue({ description: h.DESCRIPTION, justification: h.JUSTIFICATION, urgentFlag: h.URGENT_FLAG === 'Y' });
      setLines(ls.map(l => {
        const myD = ds.filter(d => Number(d.REQ_LINE_ID) === Number(l.REQ_LINE_ID));
        return {
          key: `r${l.REQ_LINE_ID}`, lineType: l.LINE_TYPE, expenseItemId: l.EXPENSE_ITEM_ID, categoryId: l.CATEGORY_ID,
          itemDescription: l.ITEM_DESCRIPTION, uomCode: l.UOM_CODE, quantity: l.QUANTITY, unitPrice: l.UNIT_PRICE,
          amount: l.AMOUNT, needByDate: day(l.NEED_BY_DATE), locationId: l.DELIVER_TO_LOCATION_ID, taxCode: l.TAX_CODE,
          requesterUser: l.REQUESTER_USER, note: l.NOTE_TO_BUYER, supplierItemNum: l.SUPPLIER_ITEM_NUM,
          suggestedSupplierId: l.SUGGESTED_SUPPLIER_ID, suggestedSupplierSiteId: l.SUGGESTED_SUPPLIER_SITE_ID,
          suggestedSupplierName: l.SUGGESTED_SUPPLIER_NAME, chargeAccount: myD[0]?.CHARGE_ACCOUNT ?? l.CHARGE_ACCOUNT,
          distributions: myD.length > 1 ? myD.map(d => ({ percent: n(d.PERCENT), chargeAccount: d.CHARGE_ACCOUNT })) : undefined,
          status: l.LINE_STATUS,
        } as EditLine;
      }));
    } catch (e: any) { message.error(e.message); } finally { setLoading(false); }
  }, [id, form, onBack]);
  useEffect(() => { load(); }, [load]);

  // requester defaults (deliver-to) for a new requisition
  useEffect(() => {
    if (id || !bu) return;
    poQuery(`SELECT d.DELIVER_TO_LOCATION_ID, d.CHARGE_ACCOUNT_TEMPLATE FROM RR_PO_REQUESTER_DEFAULTS d
             WHERE UPPER(d.USER_NAME) = UPPER(${lit(user)}) AND d.BUSINESS_UNIT_ID = ${nlit(bu)}`)
      .then(r => {
        setDefaults(r[0] || null);
        setLines(ls => ls.length ? ls : [newLine({ needByDate: plusDays(7), locationId: r[0]?.DELIVER_TO_LOCATION_ID ?? null })]);
      })
      .catch(() => setLines(ls => ls.length ? ls : [newLine({ needByDate: plusDays(7) })]));
  }, [id, bu, user]);

  const save = async (): Promise<number | null> => {
    const v = await form.validateFields().catch(() => null);   // invalid fields are shown on the form
    if (!v) return null;
    if (!lines.length) { message.warning('Add at least one line'); return null; }
    setBusy(true);
    try {
      const r = await poExec(PROC.saveReq, {
        p_json: {
          reqHeaderId: id, businessUnitId: bu, description: v.description, justification: v.justification || null,
          urgentFlag: v.urgentFlag ? 'Y' : 'N', lines: linesToJson(lines, 'REQ'),
        },
      }, user);
      message.success(r.message || 'Saved');
      if (!id && r.id) onSaved(r.id, r.number); else await load();
      return r.id;
    } catch (e: any) { message.error(e.message, 8); return null; } finally { setBusy(false); }
  };

  const act = async (proc: string, p: Record<string, unknown>, after?: 'back') => {
    setBusy(true);
    try {
      const r = await poExec(proc, p, user);
      (r.status === 'W' ? message.warning : message.success)(r.message || 'Done', 6);
      if (after === 'back') onBack(); else await load();
    } catch (e: any) { message.error(e.message, 8); } finally { setBusy(false); }
  };

  const submit = async () => {
    const savedId = editable ? await save() : id;
    if (savedId) await act(PROC.submitReq, { p_req_header_id: savedId });
  };

  const total = useMemo(() => lines.reduce((s, l) => s + lineAmount(l), 0), [lines]);

  if (loading) return <div style={{ padding: 60, textAlign: 'center' }}><Spin /></div>;
  const st = hdr?.STATUS as string | undefined;
  const actions = (
    <Space wrap size={6}>
      {editable && <Button icon={<SaveOutlined />} loading={busy} onClick={save}>Save</Button>}
      {editable && <Button type="primary" icon={<SendOutlined />} loading={busy} onClick={submit}>Submit for approval</Button>}
      {st === 'PENDING_APPROVAL' && (
        <Popconfirm title="Withdraw from approval?" onConfirm={() => act(PROC.withdrawReq, { p_req_header_id: id })}>
          <Button icon={<RollbackOutlined />} loading={busy}>Withdraw</Button>
        </Popconfirm>
      )}
      {st === 'APPROVED' && (
        <Button icon={<ThunderboltOutlined />} onClick={() => navigate('/po/buyer-workbench')}>Open buyer workbench</Button>
      )}
      {st && st !== 'CANCELLED' && !(st === 'INCOMPLETE' && !hdr?.SUBMITTED_DATE) && (
        <Button danger icon={<StopOutlined />} loading={busy} onClick={async () => {
          const reason = await askReason('Cancel requisition', { danger: true, okText: 'Cancel requisition',
            extra: <Text type="secondary">Lines already on a purchase order stay there.</Text> });
          if (reason !== null) await act(PROC.cancelReq, { p_req_header_id: id, p_reason: reason });
        }}>Cancel requisition</Button>
      )}
      {st === 'INCOMPLETE' && !hdr?.SUBMITTED_DATE && (
        <Popconfirm title="Delete this draft?" onConfirm={() => act(PROC.deleteReq, { p_req_header_id: id }, 'back')}>
          <Button danger icon={<DeleteOutlined />} loading={busy}>Delete draft</Button>
        </Popconfirm>
      )}
      <HistoryButton entityType="REQ" id={id} />
    </Space>
  );
  const row = (label: string, value: React.ReactNode, strong?: boolean) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px dashed #eee' }}>
      <Text type={strong ? undefined : 'secondary'} strong={strong}>{label}</Text><Text strong={strong}>{value}</Text>
    </div>
  );

  return (
    <div style={{ padding: '12px 20px 20px' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 5, background: '#fff', padding: '8px 0 10px', marginBottom: 10,
        borderBottom: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <Space size={10} wrap>
          <Text strong style={{ fontSize: 18 }}>{hdr ? `Requisition ${hdr.REQ_NUMBER}` : 'New requisition'}</Text>
          {hdr && <StatusTag s={st} />}
          {hdr?.URGENT_FLAG === 'Y' && <Tag color="red">Urgent</Tag>}
        </Space>
        {actions}
      </div>
      {st === 'REJECTED' && <Alert type="error" showIcon style={{ marginBottom: 12 }} message="Rejected — see History for the approver's comments, edit and submit again." />}
      {!id && defaults === null && (
        <Alert type="info" showIcon style={{ marginBottom: 12 }}
          message="No requester defaults for you in this business unit"
          description="Enter a charge account on each line, or ask the administrator to add your requester default (Setup → Requester Defaults) so accounts are derived automatically." />
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 300px', gap: 12, marginBottom: 12, alignItems: 'start' }}>
        <Card size="small" title="Requisition details">
          <Form form={form} layout="vertical" disabled={!editable}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', columnGap: 14 }}>
              <Form.Item label="Business unit" required>
                <Select value={bu ?? undefined} disabled={!!hdr} showSearch optionFilterProp="label" placeholder="Choose business unit"
                  onChange={v => setNewBu(v)}
                  options={buState.bus.map(b => ({ value: Number(b.BUSINESS_UNIT_ID), label: b.BUSINESS_UNIT_NAME }))} />
              </Form.Item>
              <Form.Item name="description" label="Description" rules={[{ required: true }]} style={{ gridColumn: 'span 2' }}><Input maxLength={240} /></Form.Item>
              <Form.Item name="urgentFlag" label="Urgent" valuePropName="checked"><Checkbox>Urgent</Checkbox></Form.Item>
              <Form.Item name="justification" label="Justification" style={{ gridColumn: '1 / -1' }}><Input.TextArea rows={2} maxLength={2000} /></Form.Item>
            </div>
          </Form>
        </Card>
        <Card size="small" title="Totals">
          {row('Lines', lines.length)}
          {row('Total', `${money(total)} ${currency}`, true)}
          {hdr && <>
            {row('Lines on PO', `${hdr.LINES_ON_PO}/${hdr.LINE_COUNT}`)}
            {row('Prepared by', hdr.PREPARER_USER)}
            {row('Submitted', day(hdr.SUBMITTED_DATE) || '—')}
            {row('Approved', day(hdr.APPROVED_DATE) || '—')}
          </>}
        </Card>
      </div>

      <Tabs defaultActiveKey="lines" items={[
        { key: 'lines', label: `Lines (${lines.length})`, children: (
          <LinesEditor mode="REQ" lines={lines} onChange={setLines} lookups={lookups} readOnly={!editable} currency={currency}
            company={buState.bus.find(b => Number(b.BUSINESS_UNIT_ID) === bu)?.COMPANY}
            defaultLocationId={defaults?.DELIVER_TO_LOCATION_ID ?? null} />) },
        { key: 'attachments', label: <span><PaperClipOutlined /> Attachments</span>, disabled: !id,
          children: id ? <PoAttachments entityType="REQ" entityId={id} user={user} readOnly={st === 'CANCELLED'} /> : null },
      ]} />
    </div>
  );
};

export default Requisitions;
