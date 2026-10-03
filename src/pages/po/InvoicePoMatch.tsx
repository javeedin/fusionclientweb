// AP invoice → Purchasing-RR PO match details, shown on the invoice (Manage Invoices → Purchase Orders tab).
// Source: RR_PO_V_INVOICE_MATCH_DETAIL (database/po/305) — one row per invoice line / PO distribution billed.
// The match follows the saved invoice lines (RR_PO_MATCH_PKG.RESYNC_AP_INVOICE), so this shows the saved state.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Table, Tag, Space, Typography, Tooltip, Button, Alert, Progress, Switch, Empty } from 'antd';
import { LinkOutlined, ReloadOutlined, CheckCircleFilled, ExclamationCircleFilled, MinusCircleOutlined } from '@ant-design/icons';
import { poQuery, nlit, money, qty, day, n, r2, Row, STATUS_COLOR } from '../../services/po.service';

const { Text } = Typography;

export interface InvoicePoMatchState {
  rows: Row[];            // all match rows (MATCHED + history)
  matched: Row[];         // current match
  loading: boolean;
  available: boolean;     // Purchasing module (305) installed
  reload: () => void;
}

/** Loads the PO match rows of an AP invoice. `tick` changes → reload (e.g. tab opened, invoice saved). */
export function useInvoicePoMatch(invoiceId: number | null | undefined, tick?: unknown): InvoicePoMatchState {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [available, setAvailable] = useState(true);
  const [k, setK] = useState(0);
  useEffect(() => {
    if (!invoiceId) { setRows([]); return; }
    let live = true;
    setLoading(true);
    poQuery(`SELECT * FROM RR_PO_V_INVOICE_MATCH_DETAIL WHERE INVOICE_ID = ${nlit(invoiceId)} ORDER BY INVOICE_LINE_NUMBER, DIST_NUM, MATCH_ID`)
      .then(r => { if (live) { setRows(r); setAvailable(true); } })
      .catch(() => { if (live) { setRows([]); setAvailable(false); } })   // module not installed: stay silent
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [invoiceId, tick, k]);
  const matched = useMemo(() => rows.filter(r => r.MATCH_STATUS === 'MATCHED'), [rows]);
  const reload = useCallback(() => setK(x => x + 1), []);
  return { rows, matched, loading, available, reload };
}

const matchLevel = (r: Row) => (r.MATCH_LEVEL === 'THREE_WAY' ? '3-way' : '2-way');
const acctTag = (r: Row) => (r.ACCRUE_AT_RECEIPT_FLAG === 'Y'
  ? <Tooltip title="Accrued at receipt: the invoice clears the receipt accrual (GRNI) booked when the goods were received"><Tag color="purple" style={{ marginInlineEnd: 0 }}>GRNI</Tag></Tooltip>
  : <Tooltip title="Not accrued at receipt: the invoice debits the PO charge (expense) account"><Tag style={{ marginInlineEnd: 0 }}>Charge</Tag></Tooltip>);

/** Small cell for the invoice lines grid: match state of one invoice line. */
export const PoMatchCell: React.FC<{ state: InvoicePoMatchState; lineNumber: number; poNumber?: string | null }> = ({ state, lineNumber, poNumber }) => {
  if (!state.available) return null;
  const mine = state.matched.filter(r => Number(r.INVOICE_LINE_NUMBER) === Number(lineNumber));
  if (mine.length) {
    const r0 = mine[0];
    const q = mine.reduce((s, r) => s + n(r.QUANTITY_BILLED), 0);
    const a = r2(mine.reduce((s, r) => s + n(r.AMOUNT_BILLED), 0));
    return (
      <Tooltip title={<div style={{ fontSize: 12 }}>
        <div>{r0.PO_NUMBER} line {r0.LINE_NUM} · {r0.ITEM_DESCRIPTION}</div>
        {r0.LINE_TYPE === 'QUANTITY' && <div>Billed {qty(q)} {r0.UOM_CODE} @ {money(r0.UNIT_PRICE)}</div>}
        <div>Amount {money(a)} {r0.CURRENCY_CODE} · {matchLevel(r0)} match</div>
        {mine.map(r => <div key={r.MATCH_ID}>Dist {r.DIST_NUM}: {r.INVOICE_ACCOUNT}</div>)}
      </div>}>
        <Tag color="green" icon={<CheckCircleFilled />} style={{ marginInlineEnd: 0 }}>Matched</Tag>
      </Tooltip>
    );
  }
  if (poNumber) {
    return (
      <Tooltip title="Saved without a Purchasing PO match: the PO number is not a Purchasing-RR PO (reference only), or the line has not been saved yet">
        <Tag icon={<MinusCircleOutlined />} style={{ marginInlineEnd: 0 }}>Reference</Tag>
      </Tooltip>
    );
  }
  return null;
};

/** Panel above the Purchase Orders lines grid: matched POs, per-line detail, PO line progress, history. */
export const InvoicePoMatchPanel: React.FC<{
  state: InvoicePoMatchState;
  invoiceLines: { lineNumber: number; poNumber?: string | null; poLine?: string | number | null }[];
  dirty?: boolean;   // unsaved line edits on the invoice
}> = ({ state, invoiceLines, dirty }) => {
  const navigate = useNavigate();
  const [history, setHistory] = useState(false);
  const { rows, matched, loading, available, reload } = state;

  const pos = useMemo(() => {
    const m = new Map<number, { id: number; num: string; cur: string; amt: number; func: number; rel: number; lines: Set<number>; status: string; hold: boolean }>();
    matched.forEach(r => {
      const id = Number(r.PO_HEADER_ID);
      const x = m.get(id) || { id, num: String(r.PO_NUMBER), cur: String(r.CURRENCY_CODE || ''), amt: 0, func: 0, rel: 0, lines: new Set<number>(), status: String(r.INVOICE_STATUS || ''), hold: r.HOLD_FLAG === 'Y' };
      x.amt += n(r.AMOUNT_BILLED); x.func += n(r.AMOUNT_BILLED_FUNC); x.rel += n(r.ACCRUAL_RELIEVED); x.lines.add(Number(r.PO_LINE_ID));
      m.set(id, x);
    });
    return [...m.values()];
  }, [matched]);

  // invoice lines that name a PO but carry no match
  const unmatched = useMemo(() => invoiceLines.filter(l => l.poNumber && !matched.some(r => Number(r.INVOICE_LINE_NUMBER) === Number(l.lineNumber))), [invoiceLines, matched]);

  if (!available) return null;
  const data = history ? rows : matched;
  const openPo = (id: unknown) => navigate(`/po/orders?id=${id}`);

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <Text strong style={{ fontSize: 13 }}>PO matching</Text>
        {pos.length === 0 && !loading && <Tag>Not matched to a Purchasing PO</Tag>}
        {pos.map(p => (
          <Tag key={p.id} color="green" style={{ cursor: 'pointer', padding: '2px 8px' }} onClick={() => openPo(p.id)}>
            <Space size={6}>
              <LinkOutlined />
              <b>{p.num}</b>
              <span>{p.lines.size} PO line{p.lines.size > 1 ? 's' : ''}</span>
              <span>{money(p.amt)} {p.cur}</span>
              {p.rel > 0 && <Tooltip title="Receipt accrual (GRNI) cleared by this invoice, functional currency"><span>· GRNI cleared {money(p.rel)}</span></Tooltip>}
              {p.status && <span>· {p.status}</span>}
              {p.hold && <Tag color="red" style={{ marginInlineEnd: 0 }}>PO on hold</Tag>}
            </Space>
          </Tag>
        ))}
        <span style={{ flex: 1 }} />
        <Space size={6}>
          <Text type="secondary" style={{ fontSize: 12 }}>History</Text>
          <Switch size="small" checked={history} onChange={setHistory} />
          <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={reload} />
        </Space>
      </div>
      {dirty && (
        <Alert type="info" showIcon style={{ marginBottom: 8, padding: '4px 10px' }}
          message="Unsaved line changes — on save the PO match is recalculated from the new lines (over-billing is refused)." />
      )}
      {unmatched.length > 0 && !dirty && (
        <Alert type="warning" showIcon icon={<ExclamationCircleFilled />} style={{ marginBottom: 8, padding: '4px 10px' }}
          message={`Line${unmatched.length > 1 ? 's' : ''} ${unmatched.map(l => l.lineNumber).join(', ')}: PO number is a reference only (not a Purchasing-RR PO), so nothing was billed on a PO.`} />
      )}
      {(matched.length > 0 || history) && (
        <Table<Row>
          size="small" rowKey="MATCH_ID" pagination={false} loading={loading} dataSource={data} scroll={{ x: 1400 }}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No PO match" /> }}
          onRow={r => ({ style: r.MATCH_STATUS === 'MATCHED' ? undefined : { opacity: 0.55 } })}
          columns={[
            { title: 'Inv line', dataIndex: 'INVOICE_LINE_NUMBER', width: 64, align: 'center' },
            { title: 'PO · line', width: 150, render: (_, r) => (
              <Button type="link" size="small" style={{ padding: 0 }} onClick={() => openPo(r.PO_HEADER_ID)}>{r.PO_NUMBER} · {r.LINE_NUM}</Button>) },
            { title: 'Item', dataIndex: 'ITEM_DESCRIPTION', ellipsis: true, width: 200 },
            { title: 'Match', width: 120, render: (_, r) => <Space size={4}><Tag style={{ marginInlineEnd: 0 }}>{matchLevel(r)}</Tag>{acctTag(r)}</Space> },
            { title: 'Qty billed', width: 100, align: 'right', render: (_, r) => (r.LINE_TYPE === 'QUANTITY' ? `${qty(r.QUANTITY_BILLED)} ${r.UOM_CODE || ''}` : '—') },
            { title: 'Price', width: 90, align: 'right', render: (_, r) => (r.LINE_TYPE === 'QUANTITY' ? money(r.UNIT_PRICE) : '—') },
            { title: 'Amount', width: 110, align: 'right', render: (_, r) => <Text strong>{money(r.AMOUNT_BILLED)}</Text> },
            { title: 'Dist', dataIndex: 'DIST_NUM', width: 50, align: 'center' },
            { title: 'Debit account', dataIndex: 'INVOICE_ACCOUNT', width: 260, ellipsis: true,
              render: (v, r) => <Tooltip title={<div>Charge: {r.CHARGE_ACCOUNT}<br />Accrual: {r.ACCRUAL_ACCOUNT || '—'}</div>}><Text code style={{ fontSize: 11 }}>{v}</Text></Tooltip> },
            { title: 'GRNI cleared', width: 100, align: 'right', render: (_, r) => (n(r.ACCRUAL_RELIEVED) ? money(r.ACCRUAL_RELIEVED) : '—') },
            { title: 'PO line billed', width: 170, render: (_, r) => {
              const isQ = r.LINE_TYPE === 'QUANTITY';
              const ord = n(isQ ? r.LINE_QUANTITY_ORDERED : r.LINE_AMOUNT_ORDERED);
              const rec = n(isQ ? r.LINE_QUANTITY_RECEIVED : r.LINE_AMOUNT_RECEIVED);
              const bil = n(isQ ? r.LINE_QUANTITY_BILLED : r.LINE_AMOUNT_BILLED);
              const f = isQ ? qty : money;
              return (
                <Tooltip title={`Ordered ${f(ord)} · received ${f(rec)} · billed ${f(bil)} (all invoices)`}>
                  <Progress size="small" percent={ord ? Math.round((bil / ord) * 100) : 0} success={{ percent: ord ? Math.round((Math.min(rec, bil) / ord) * 100) : 0 }}
                    format={() => `${f(bil)}/${f(ord)}`} style={{ margin: 0, width: 150 }} />
                </Tooltip>
              );
            } },
            { title: 'Still billable', width: 110, align: 'right', render: (_, r) => (r.LINE_TYPE === 'QUANTITY' ? `${qty(r.LINE_QUANTITY_BILLABLE)} ${r.UOM_CODE || ''}` : money(r.LINE_AMOUNT_BILLABLE)) },
            { title: 'PO line', dataIndex: 'CLOSURE_STATUS', width: 150, render: v => (v ? <Tag color={STATUS_COLOR[String(v)] || 'default'}>{String(v).replace(/_/g, ' ')}</Tag> : null) },
            { title: 'Match status', width: 160, render: (_, r) => (
              <Space size={4} direction="vertical">
                <Tag color={r.MATCH_STATUS === 'MATCHED' ? 'green' : r.MATCH_STATUS === 'REPLACED' ? 'default' : 'volcano'} style={{ marginInlineEnd: 0 }}>{r.MATCH_STATUS}</Tag>
                {r.MATCH_STATUS !== 'MATCHED' && <Text type="secondary" style={{ fontSize: 11 }}>{day(r.CANCELLED_DATE)} {r.CANCELLED_BY}</Text>}
              </Space>) },
          ]}
        />
      )}
    </div>
  );
};
