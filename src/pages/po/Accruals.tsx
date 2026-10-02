// Purchasing-RR — Receipt accounting & accruals:
//   * Receipt accounting (accrue at receipt): Dr charge / Cr receipt accrual (GRNI)
//   * Period-end accrual (accrue at period end): accrual journal + reversal on the reversal date
//   * Uninvoiced receipts (GRNI sub-ledger) and accrual write-offs
// Journals go through the existing SLA → GL pipeline (poAccounting.ts).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Card, Table, Button, Space, Input, Typography, Tag, Tabs, Modal, Form, Alert, message, Select, Statistic, Progress, Popconfirm, Tooltip,
} from 'antd';
import { CalculatorOutlined, ReloadOutlined, ThunderboltOutlined, DeleteOutlined, ScissorOutlined, CheckCircleOutlined } from '@ant-design/icons';
import { poQuery, poExec, PROC, nlit, lit, money, qty, day, today, Row, n, r2 } from '../../services/po.service';
import { PoBar, BuNotSetUp, StatusTag, useBusinessUnits, usePoUser, AccountInput } from './poShared';
import { postJournal, pair, PO_JE_CATEGORY } from './poAccounting';

const { Text } = Typography;
type BuState = ReturnType<typeof useBusinessUnits>;

const Accruals: React.FC = () => {
  const buState = useBusinessUnits();
  return (
    <div style={{ padding: 20 }}>
      <PoBar title="Receipt Accounting & Accruals" subtitle="GRNI · receipt journals · period-end accruals · write-offs"
        icon={<CalculatorOutlined />} buState={buState} />
      <BuNotSetUp current={buState.current} />
      <Tabs items={[
        { key: 'rcv', label: 'Receipt accounting', children: <ReceiptAccounting buState={buState} /> },
        { key: 'period', label: 'Period-end accrual', children: <PeriodEnd buState={buState} /> },
        { key: 'grni', label: 'Uninvoiced receipts', children: <Uninvoiced buState={buState} /> },
        { key: 'wo', label: 'Write-off accounting', children: <WriteOffAccounting buState={buState} /> },
      ]} />
    </div>
  );
};

interface Progress { done: number; total: number; errors: string[] }
const ProgressBox: React.FC<{ p: Progress | null }> = ({ p }) => p ? (
  <div style={{ marginBottom: 12 }}>
    <Progress percent={p.total ? Math.round(p.done / p.total * 100) : 0} status={p.errors.length ? 'exception' : undefined} />
    {p.errors.map((e, i) => <Alert key={i} type="error" showIcon style={{ marginTop: 4 }} message={e} />)}
  </div>
) : null;

// ── Receipt accounting ─────────────────────────────────────────────────────
const ReceiptAccounting: React.FC<{ buState: BuState }> = ({ buState }) => {
  const user = usePoUser();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState<number[]>([]);
  const [prog, setProg] = useState<Progress | null>(null);
  const bu = buState.current;

  const load = useCallback(async () => {
    if (!buState.bu) { setRows([]); return; }
    setLoading(true);
    try {
      setRows(await poQuery(`SELECT * FROM RR_PO_V_RCV_ACCOUNTING WHERE BUSINESS_UNIT_ID = ${nlit(buState.bu)}
                             AND ACCOUNTING_STATUS = 'UNACCOUNTED' ORDER BY TRANSACTION_DATE, RCV_TRANSACTION_ID, RCV_DIST_ID`));
      setSel([]);
    } catch (e: any) { message.error(e.message); } finally { setLoading(false); }
  }, [buState.bu]);
  useEffect(() => { load(); }, [load]);

  const txns = useMemo(() => {
    const m = new Map<number, Row & { dists: Row[] }>();
    rows.forEach(r => {
      const k = Number(r.RCV_TRANSACTION_ID);
      if (!m.has(k)) m.set(k, { ...r, dists: [] });
      m.get(k)!.dists.push(r);
    });
    return Array.from(m.values()).map(t => ({
      ...t, AMOUNT_T: r2(t.dists.reduce((s, d) => s + n(d.AMOUNT), 0)), AMOUNT_F: r2(t.dists.reduce((s, d) => s + n(d.AMOUNT_FUNC), 0)),
    }) as Row & { dists: Row[] });
  }, [rows]);

  const run = async () => {
    if (!bu) return;
    const todo = txns.filter(t => sel.includes(Number(t.RCV_TRANSACTION_ID)));
    const p: Progress = { done: 0, total: todo.length, errors: [] };
    setProg({ ...p });
    for (const t of todo) {
      try {
        const desc = `${t.TRANSACTION_TYPE} ${t.RECEIPT_NUMBER} · PO ${t.PO_NUMBER}`;
        const lines = t.dists.flatMap(d => pair(n(d.AMOUNT), n(d.AMOUNT_FUNC), d.CHARGE_ACCOUNT,
          d.ACCRUAL_ACCOUNT || bu.RECEIPT_ACCRUAL_ACCOUNT || '', 'CHARGE', 'ACCRUAL', `${desc} · ${d.ITEM_DESCRIPTION}`));
        const res = await postJournal({
          businessUnitName: bu.BUSINESS_UNIT_NAME, sourceTable: 'RR_PO_RCV_TRANSACTIONS', sourceId: Number(t.RCV_TRANSACTION_ID),
          sourceNumber: `${t.RECEIPT_NUMBER}-${t.RCV_TRANSACTION_ID}`, eventTypeCode: t.TRANSACTION_TYPE === 'RECEIVE' ? 'PO_RECEIPT' : `PO_${t.TRANSACTION_TYPE}`,
          accountingDate: day(t.TRANSACTION_DATE), currency: t.CURRENCY_CODE, ledgerCurrency: bu.FUNCTIONAL_CURRENCY || t.CURRENCY_CODE,
          rate: n(t.RATE) || 1, category: PO_JE_CATEGORY.RECEIPT, description: desc, lines, user,
        });
        await poExec(PROC.markAccounted, { p_entity: 'RCV', p_ids: String(t.RCV_TRANSACTION_ID), p_sla_header_id: res.slaHeaderId,
          p_gl_batch_id: res.glBatchId, p_reversal_gl_batch_id: null }, user);
      } catch (e: any) { p.errors.push(`${t.RECEIPT_NUMBER} #${t.RCV_TRANSACTION_ID}: ${e.message}`); }
      p.done += 1; setProg({ ...p, errors: [...p.errors] });
    }
    if (!p.errors.length) message.success(`${p.done} receiving transaction(s) accounted and posted`);
    load();
  };

  return (
    <Card size="small">
      {bu && bu.ACCRUE_AT_RECEIPT_FLAG === 'N' && <Alert type="info" showIcon style={{ marginBottom: 12 }}
        message="This business unit accrues at period end — receipts need no journal; use the Period-end accrual tab." />}
      <Space wrap style={{ marginBottom: 12 }}>
        <Button icon={<ReloadOutlined />} onClick={load}>Refresh</Button>
        <Button type="primary" icon={<ThunderboltOutlined />} disabled={!sel.length} onClick={run}>Create & post accounting ({sel.length})</Button>
        <Text type="secondary">Dr charge account · Cr receipt accrual (GRNI). Returns and negative corrections reverse the sides.</Text>
      </Space>
      <ProgressBox p={prog} />
      <Table size="small" rowKey="RCV_TRANSACTION_ID" loading={loading} dataSource={txns} pagination={{ pageSize: 25 }}
        rowSelection={{ selectedRowKeys: sel, onChange: k => setSel(k.map(Number)) }}
        expandable={{ expandedRowRender: t => (
          <Table size="small" rowKey="RCV_DIST_ID" pagination={false} dataSource={t.dists} columns={[
            { title: 'Dr / Cr', width: 70, render: (_, d) => n(d.AMOUNT) >= 0 ? 'Dr' : 'Cr' },
            { title: 'Charge account', dataIndex: 'CHARGE_ACCOUNT' },
            { title: 'Accrual account', render: (_, d) => d.ACCRUAL_ACCOUNT || <Text type="warning">{bu?.RECEIPT_ACCRUAL_ACCOUNT || 'missing'}</Text> },
            { title: 'Amount', dataIndex: 'AMOUNT', align: 'right', render: v => money(v) },
            { title: 'Functional', dataIndex: 'AMOUNT_FUNC', align: 'right', render: v => money(v) },
          ]} />) }}
        columns={[
          { title: 'Receipt', dataIndex: 'RECEIPT_NUMBER', width: 150 },
          { title: 'Type', dataIndex: 'TRANSACTION_TYPE', width: 150, render: v => <StatusTag s={v} /> },
          { title: 'Date', dataIndex: 'TRANSACTION_DATE', width: 100, render: day },
          { title: 'PO', dataIndex: 'PO_NUMBER', width: 140 },
          { title: 'Item', dataIndex: 'ITEM_DESCRIPTION', ellipsis: true },
          { title: 'Amount', width: 140, align: 'right', render: (_, t) => `${money(t.AMOUNT_T)} ${t.CURRENCY_CODE}` },
          { title: 'Functional', dataIndex: 'AMOUNT_F', width: 120, align: 'right', render: v => money(v) },
        ]} />
    </Card>
  );
};

// ── Period-end accrual ─────────────────────────────────────────────────────
const PeriodEnd: React.FC<{ buState: BuState }> = ({ buState }) => {
  const user = usePoUser();
  const bu = buState.current;
  const [runs, setRuns] = useState<Row[]>([]);
  const [lines, setLines] = useState<Row[]>([]);
  const [runId, setRunId] = useState<number | null>(null);
  const [periods, setPeriods] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    if (!buState.bu) return;
    setLoading(true);
    try {
      setRuns(await poQuery(`SELECT * FROM RR_PO_V_ACCRUAL_RUNS WHERE BUSINESS_UNIT_ID = ${nlit(buState.bu)} ORDER BY RUN_ID DESC`));
    } catch (e: any) { message.error(e.message); } finally { setLoading(false); }
  }, [buState.bu]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!bu?.PRIMARY_LEDGER_ID) { setPeriods([]); return; }
    poQuery(`SELECT period_name AS PERIOD_NAME, start_date AS START_DATE, end_date AS END_DATE FROM rr_accounting_periods_status
             WHERE ledger_id = ${nlit(bu.PRIMARY_LEDGER_ID)} AND application_id = 101 AND closing_status = 'O'
             AND NVL(adjustment_period_flag, 'N') = 'N' ORDER BY start_date DESC`)
      .then(setPeriods).catch(() => setPeriods([]));
  }, [bu?.PRIMARY_LEDGER_ID]);
  useEffect(() => {
    if (!runId) { setLines([]); return; }
    poQuery(`SELECT * FROM RR_PO_V_ACCRUAL_LINES WHERE RUN_ID = ${nlit(runId)} ORDER BY PO_NUMBER, LINE_NUM`).then(setLines).catch(e => message.error(e.message));
  }, [runId]);

  const onPeriod = (p: string) => {
    const r = periods.find(x => x.PERIOD_NAME === p);
    if (r) {
      const end = day(r.END_DATE);
      const next = new Date(`${end}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
      form.setFieldsValue({ accrualDate: end, reversalDate: next.toISOString().slice(0, 10) });
    }
  };

  const create = async () => {
    const v = await form.validateFields();
    setBusy(true);
    try {
      const r = await poExec(PROC.runAccrual, { p_business_unit_id: buState.bu, p_period_name: v.periodName,
        p_accrual_date: v.accrualDate, p_reversal_date: v.reversalDate }, user);
      message.success(r.message, 6);
      await load(); setRunId(r.id);
    } catch (e: any) { message.error(e.message, 10); } finally { setBusy(false); }
  };

  const post = async (run: Row) => {
    if (!bu) return;
    setBusy(true);
    try {
      const ls = await poQuery(`SELECT * FROM RR_PO_V_ACCRUAL_LINES WHERE RUN_ID = ${nlit(run.RUN_ID)}`);
      if (!ls.length) throw new Error('The run has no lines');
      const fc = bu.FUNCTIONAL_CURRENCY || 'AED';
      const desc = `Period-end receipt accrual ${run.PERIOD_NAME}`;
      const mk = (rev: boolean) => ls.flatMap(l => {
        const p = pair(n(l.AMOUNT_FUNC), n(l.AMOUNT_FUNC), l.CHARGE_ACCOUNT, l.ACCRUAL_ACCOUNT, 'CHARGE', 'ACCRUAL',
          `${rev ? 'Reversal · ' : ''}PO ${l.PO_NUMBER}-${l.LINE_NUM} ${l.ITEM_DESCRIPTION}`);
        return rev ? p.map(x => ({ ...x, side: (x.side === 'DR' ? 'CR' : 'DR') as 'DR' | 'CR' })) : p;
      });
      const a = await postJournal({ businessUnitName: bu.BUSINESS_UNIT_NAME, sourceTable: 'RR_PO_ACCRUAL_RUNS', sourceId: Number(run.RUN_ID),
        sourceNumber: `ACR-${run.PERIOD_NAME}-${run.RUN_ID}`, eventTypeCode: 'PO_PERIOD_ACCRUAL', accountingDate: day(run.ACCRUAL_DATE),
        periodName: run.PERIOD_NAME, currency: fc, ledgerCurrency: fc, rate: 1, category: PO_JE_CATEGORY.ACCRUAL, description: desc, lines: mk(false), user });
      const b = await postJournal({ businessUnitName: bu.BUSINESS_UNIT_NAME, sourceTable: 'RR_PO_ACCRUAL_RUNS_REV', sourceId: Number(run.RUN_ID),
        sourceNumber: `ACR-${run.PERIOD_NAME}-${run.RUN_ID}-REV`, eventTypeCode: 'PO_PERIOD_ACCRUAL_REV', accountingDate: day(run.REVERSAL_DATE),
        currency: fc, ledgerCurrency: fc, rate: 1, category: PO_JE_CATEGORY.ACCRUAL, description: `Reversal of ${desc}`, lines: mk(true), user });
      await poExec(PROC.markAccounted, { p_entity: 'ACCRUAL_RUN', p_ids: String(run.RUN_ID), p_sla_header_id: a.slaHeaderId,
        p_gl_batch_id: a.glBatchId, p_reversal_gl_batch_id: b.glBatchId }, user);
      message.success(`Accrual posted (batch ${a.glBatchId}) with reversal (batch ${b.glBatchId})`, 8);
      load();
    } catch (e: any) { message.error(e.message, 12); } finally { setBusy(false); }
  };

  return (
    <Card size="small">
      <Alert type="info" showIcon style={{ marginBottom: 12 }}
        message="For schedules that accrue at period end: received-but-not-billed value as of the accrual date is accrued (Dr charge / Cr accrual) and reversed on the reversal date." />
      <Form form={form} layout="inline" style={{ marginBottom: 12, rowGap: 8 }}>
        <Form.Item name="periodName" label="Period" rules={[{ required: true }]}>
          {periods.length
            ? <Select style={{ width: 140 }} onChange={onPeriod} options={periods.map(p => ({ value: p.PERIOD_NAME, label: p.PERIOD_NAME }))} />
            : <Input style={{ width: 120 }} placeholder="Mon-YY" />}
        </Form.Item>
        <Form.Item name="accrualDate" label="Accrual date" rules={[{ required: true }]}><Input type="date" /></Form.Item>
        <Form.Item name="reversalDate" label="Reversal date" rules={[{ required: true }]}><Input type="date" /></Form.Item>
        <Button type="primary" icon={<CalculatorOutlined />} loading={busy} onClick={create}>Calculate accrual</Button>
        <Button icon={<ReloadOutlined />} onClick={load}>Refresh</Button>
      </Form>
      <Table size="small" rowKey="RUN_ID" loading={loading} dataSource={runs} pagination={false}
        rowClassName={r => (Number(r.RUN_ID) === runId ? 'ant-table-row-selected' : '')}
        onRow={r => ({ onClick: () => setRunId(Number(r.RUN_ID)), style: { cursor: 'pointer' } })}
        columns={[
          { title: 'Run', dataIndex: 'RUN_ID', width: 120 },
          { title: 'Period', dataIndex: 'PERIOD_NAME', width: 100 },
          { title: 'Accrual date', dataIndex: 'ACCRUAL_DATE', width: 110, render: day },
          { title: 'Reversal date', dataIndex: 'REVERSAL_DATE', width: 110, render: day },
          { title: 'Lines', dataIndex: 'LINE_COUNT', width: 70 },
          { title: 'Total', dataIndex: 'TOTAL_AMOUNT_FUNC', width: 140, align: 'right', render: v => `${money(v)} ${bu?.FUNCTIONAL_CURRENCY || ''}` },
          { title: 'Status', dataIndex: 'STATUS', width: 110, render: v => <StatusTag s={v} /> },
          { title: 'GL batch', width: 160, render: (_, r) => r.GL_BATCH_ID ? `${r.GL_BATCH_ID} / rev ${r.REVERSAL_GL_BATCH_ID || '—'}` : '' },
          { title: '', width: 200, render: (_, r) => r.STATUS === 'DRAFT' ? (
            <Space size={4} onClick={e => e.stopPropagation()}>
              <Popconfirm title="Create and post the accrual and its reversal?" onConfirm={() => post(r)}>
                <Button size="small" type="primary" icon={<CheckCircleOutlined />} loading={busy} disabled={!n(r.LINE_COUNT)}>Post</Button></Popconfirm>
              <Popconfirm title="Cancel this draft run?" onConfirm={async () => {
                try { await poExec(PROC.cancelAccrual, { p_run_id: r.RUN_ID }, user); load(); } catch (e: any) { message.error(e.message); }
              }}><Button size="small" danger icon={<DeleteOutlined />}>Cancel</Button></Popconfirm>
            </Space>) : null },
        ]} />
      {runId && (
        <Card size="small" title={`Run ${runId} lines`} style={{ marginTop: 12 }}>
          <Table size="small" rowKey="ACCRUAL_LINE_ID" dataSource={lines} pagination={{ pageSize: 20 }} columns={[
            { title: 'PO', render: (_, l) => `${l.PO_NUMBER}-${l.LINE_NUM}`, width: 150 },
            { title: 'Supplier', dataIndex: 'SUPPLIER_NAME', width: 180, ellipsis: true },
            { title: 'Item', dataIndex: 'ITEM_DESCRIPTION', ellipsis: true },
            { title: 'Qty', dataIndex: 'QUANTITY', width: 80, align: 'right', render: qty },
            { title: 'Charge', dataIndex: 'CHARGE_ACCOUNT', width: 220 },
            { title: 'Accrual', dataIndex: 'ACCRUAL_ACCOUNT', width: 220 },
            { title: 'Amount', dataIndex: 'AMOUNT_FUNC', width: 120, align: 'right', render: v => money(v) },
          ]} />
        </Card>
      )}
    </Card>
  );
};

// ── Uninvoiced receipts + write-off ────────────────────────────────────────
const Uninvoiced: React.FC<{ buState: BuState }> = ({ buState }) => {
  const user = usePoUser();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [sel, setSel] = useState<number[]>([]);
  const [woOpen, setWoOpen] = useState(false);
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!buState.bu) { setRows([]); return; }
    setLoading(true);
    try {
      const where = [`BUSINESS_UNIT_ID = ${nlit(buState.bu)}`];
      if (search.trim()) {
        const s = lit(`%${search.trim().toUpperCase()}%`);
        where.push(`(UPPER(PO_NUMBER) LIKE ${s} OR UPPER(SUPPLIER_NAME) LIKE ${s} OR UPPER(ITEM_DESCRIPTION) LIKE ${s})`);
      }
      setRows(await poQuery(`SELECT * FROM RR_PO_V_UNINVOICED WHERE ${where.join(' AND ')} ORDER BY LAST_RECEIPT_DATE, PO_NUMBER, LINE_NUM`));
      setSel([]);
    } catch (e: any) { message.error(e.message); } finally { setLoading(false); }
  }, [buState.bu, search]);
  useEffect(() => { load(); }, [load]);

  const totalUnbilled = rows.reduce((s, r) => s + n(r.AMOUNT_UNBILLED_FUNC), 0);
  const totalAccrued = rows.reduce((s, r) => s + n(r.ACCRUED_AMOUNT_FUNC), 0);
  const fc = buState.current?.FUNCTIONAL_CURRENCY || '';

  const writeOff = async () => {
    const v = await form.validateFields();
    setBusy(true);
    try {
      const r = await poExec(PROC.writeOff, { p_json: { distributionIds: sel, reason: v.reason, writeOffDate: v.writeOffDate, account: v.account || null } }, user);
      message.success(r.message, 8);
      setWoOpen(false); load();
    } catch (e: any) { message.error(e.message, 10); } finally { setBusy(false); }
  };

  return (
    <Card size="small">
      <Space size={32} style={{ marginBottom: 12 }}>
        <Statistic title={`Received not billed (${fc})`} value={money(totalUnbilled)} />
        <Statistic title={`Accrued in GRNI (${fc})`} value={money(totalAccrued)} />
        <Statistic title="Lines" value={rows.length} />
      </Space>
      <Alert type="info" showIcon style={{ marginBottom: 12 }}
        message="Billed amounts stay 0 until AP invoices are matched to purchase orders/receipts (next phase). Write off only accruals that will never be invoiced." />
      <Space wrap style={{ marginBottom: 12 }}>
        <Input.Search allowClear placeholder="PO, supplier or item" style={{ width: 280 }} onSearch={setSearch} />
        <Button icon={<ReloadOutlined />} onClick={load}>Refresh</Button>
        <Button danger icon={<ScissorOutlined />} disabled={!sel.length}
          onClick={() => { form.resetFields(); form.setFieldsValue({ writeOffDate: today() }); setWoOpen(true); }}>Write off ({sel.length})</Button>
      </Space>
      <Table size="small" rowKey="DISTRIBUTION_ID" loading={loading} dataSource={rows} pagination={{ pageSize: 25 }} scroll={{ x: 1400 }}
        rowSelection={{ selectedRowKeys: sel, onChange: k => setSel(k.map(Number)), getCheckboxProps: r => ({ disabled: n(r.ACCRUED_AMOUNT_FUNC) <= 0 }) }}
        columns={[
          { title: 'PO', width: 150, render: (_, r) => `${r.PO_NUMBER}-${r.LINE_NUM}` },
          { title: 'Supplier', dataIndex: 'SUPPLIER_NAME', width: 180, ellipsis: true },
          { title: 'Item', dataIndex: 'ITEM_DESCRIPTION', ellipsis: true },
          { title: 'Delivered', width: 120, align: 'right', render: (_, r) => money(r.AMOUNT_DELIVERED) },
          { title: 'Billed', width: 100, align: 'right', render: (_, r) => money(r.AMOUNT_BILLED) },
          { title: 'Unbilled', width: 120, align: 'right', render: (_, r) => <Text strong>{money(r.AMOUNT_UNBILLED)} {r.CURRENCY_CODE}</Text> },
          { title: 'Accrued (func)', dataIndex: 'ACCRUED_AMOUNT_FUNC', width: 120, align: 'right', render: v => money(v) },
          { title: 'Accrue at', width: 100, render: (_, r) => <Tag>{r.ACCRUE_AT_RECEIPT_FLAG === 'Y' ? 'Receipt' : 'Period end'}</Tag> },
          { title: 'Last receipt', dataIndex: 'LAST_RECEIPT_DATE', width: 110, render: day },
          { title: 'Line status', dataIndex: 'CLOSURE_STATUS', width: 140, render: v => <StatusTag s={v} /> },
          { title: 'Accrual account', dataIndex: 'ACCRUAL_ACCOUNT', width: 220, render: v => <Tooltip title={v}><Text ellipsis style={{ width: 200 }}>{v}</Text></Tooltip> },
        ]} />
      <Modal open={woOpen} title={`Write off ${sel.length} accrual(s)`} destroyOnHidden onCancel={() => setWoOpen(false)} onOk={writeOff}
        okText="Write off" okButtonProps={{ danger: true }} confirmLoading={busy}>
        <Form form={form} layout="vertical">
          <Form.Item name="reason" label="Reason" rules={[{ required: true }]}><Input.TextArea rows={2} /></Form.Item>
          <Form.Item name="writeOffDate" label="Write-off date" rules={[{ required: true }]}><Input type="date" /></Form.Item>
          <Form.Item name="account" label="Write-off account (blank = Purchasing Options default)"><AccountInput company={buState.current?.COMPANY} /></Form.Item>
        </Form>
        <Text type="secondary">Only closed lines (or receipts older than the configured age) can be written off. Then create the accounting in the Write-off accounting tab.</Text>
      </Modal>
    </Card>
  );
};

const WriteOffAccounting: React.FC<{ buState: BuState }> = ({ buState }) => {
  const user = usePoUser();
  const bu = buState.current;
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState<number[]>([]);
  const [prog, setProg] = useState<Progress | null>(null);

  const load = useCallback(async () => {
    if (!buState.bu) { setRows([]); return; }
    setLoading(true);
    try {
      setRows(await poQuery(`SELECT WRITE_OFF_ID, DISTRIBUTION_ID, AMOUNT_FUNC, WRITE_OFF_ACCOUNT, ACCRUAL_ACCOUNT, WRITE_OFF_DATE, REASON,
                                    ACCOUNTING_STATUS, GL_BATCH_ID, PO_NUMBER, ITEM_DESCRIPTION, CREATED_BY
                             FROM RR_PO_V_WRITE_OFFS WHERE BUSINESS_UNIT_ID = ${nlit(buState.bu)} ORDER BY WRITE_OFF_ID DESC`));
      setSel([]);
    } catch (e: any) { message.error(e.message); } finally { setLoading(false); }
  }, [buState.bu]);
  useEffect(() => { load(); }, [load]);

  const run = async () => {
    if (!bu) return;
    const todo = rows.filter(r => sel.includes(Number(r.WRITE_OFF_ID)));
    const p: Progress = { done: 0, total: todo.length, errors: [] };
    setProg({ ...p });
    const fc = bu.FUNCTIONAL_CURRENCY || 'AED';
    for (const w of todo) {
      try {
        const desc = `Accrual write-off PO ${w.PO_NUMBER} · ${w.REASON}`;
        const res = await postJournal({ businessUnitName: bu.BUSINESS_UNIT_NAME, sourceTable: 'RR_PO_ACCRUAL_WRITE_OFFS', sourceId: Number(w.WRITE_OFF_ID),
          sourceNumber: `WO-${w.WRITE_OFF_ID}`, eventTypeCode: 'PO_ACCRUAL_WRITE_OFF', accountingDate: day(w.WRITE_OFF_DATE),
          currency: fc, ledgerCurrency: fc, rate: 1, category: PO_JE_CATEGORY.WRITE_OFF, description: desc, user,
          lines: pair(n(w.AMOUNT_FUNC), n(w.AMOUNT_FUNC), w.ACCRUAL_ACCOUNT, w.WRITE_OFF_ACCOUNT, 'ACCRUAL', 'WRITE_OFF', desc) });
        await poExec(PROC.markAccounted, { p_entity: 'WRITE_OFF', p_ids: String(w.WRITE_OFF_ID), p_sla_header_id: res.slaHeaderId,
          p_gl_batch_id: res.glBatchId, p_reversal_gl_batch_id: null }, user);
      } catch (e: any) { p.errors.push(`Write-off ${w.WRITE_OFF_ID}: ${e.message}`); }
      p.done += 1; setProg({ ...p, errors: [...p.errors] });
    }
    if (!p.errors.length) message.success(`${p.done} write-off(s) accounted`);
    load();
  };

  return (
    <Card size="small">
      <Space style={{ marginBottom: 12 }}>
        <Button icon={<ReloadOutlined />} onClick={load}>Refresh</Button>
        <Button type="primary" icon={<ThunderboltOutlined />} disabled={!sel.length} onClick={run}>Create & post accounting ({sel.length})</Button>
        <Text type="secondary">Dr receipt accrual · Cr write-off account</Text>
      </Space>
      <ProgressBox p={prog} />
      <Table size="small" rowKey="WRITE_OFF_ID" loading={loading} dataSource={rows} pagination={{ pageSize: 25 }}
        rowSelection={{ selectedRowKeys: sel, onChange: k => setSel(k.map(Number)), getCheckboxProps: r => ({ disabled: r.ACCOUNTING_STATUS !== 'UNACCOUNTED' }) }}
        columns={[
          { title: 'Write-off', dataIndex: 'WRITE_OFF_ID', width: 120 },
          { title: 'PO', dataIndex: 'PO_NUMBER', width: 140 },
          { title: 'Item', dataIndex: 'ITEM_DESCRIPTION', ellipsis: true },
          { title: 'Date', dataIndex: 'WRITE_OFF_DATE', width: 100, render: day },
          { title: 'Amount', dataIndex: 'AMOUNT_FUNC', width: 120, align: 'right', render: v => money(v) },
          { title: 'Write-off account', dataIndex: 'WRITE_OFF_ACCOUNT', width: 220 },
          { title: 'Reason', dataIndex: 'REASON', width: 200, ellipsis: true },
          { title: 'Status', dataIndex: 'ACCOUNTING_STATUS', width: 120, render: v => <StatusTag s={v} /> },
          { title: 'GL batch', dataIndex: 'GL_BATCH_ID', width: 100 },
        ]} />
    </Card>
  );
};

export default Accruals;
