// Purchasing-RR — purchase order form: draft editing, approval, change orders,
// cancel / close / hold, print + communicate, receipts and revisions.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Card, Table, Button, Space, Input, Select, Typography, Tag, Form, Alert, Popconfirm, message, Checkbox, Spin,
  Tabs, Dropdown, Modal, InputNumber, Progress, Tooltip,
} from 'antd';
import {
  SaveOutlined, SendOutlined, RollbackOutlined, StopOutlined, DeleteOutlined, CopyOutlined,
  PrinterOutlined, MailOutlined, LockOutlined, UnlockOutlined, PauseCircleOutlined, PlayCircleOutlined, EditOutlined,
  InboxOutlined, FileDoneOutlined, DollarOutlined, DownOutlined, PlusOutlined, PaperClipOutlined, FileTextOutlined,
  FileProtectOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { poQuery, poExec, PROC, nlit, money, qty, day, plusDays, Row, n, r2 } from '../../services/po.service';
import {
  StatusTag, useBusinessUnits, useLookups, LinesEditor, EditLine, newLine, linesToJson, HistoryButton, askReason,
  lineAmount, siteOptions, YesNo, SupplierSelect, useSupplierSites, PO_RED,
} from './poShared';
import { buildPoPdf } from './poPdf';
import { loadPoTerms, orderContext, printableClauses, savePoTerms, withMandatory } from './poTerms';
import { PoTermsButton, PoTermsPanel, usePoTerms } from './PoTermsUi';
import PoAttachments from './PoAttachments';
import PoApInvoice from './PoApInvoice';
import { APEX_DB_CONFIG } from '../../config/api.config';
import { logApi } from '../../services/po.service';

const { Text } = Typography;
const EDITABLE = ['INCOMPLETE', 'REJECTED'];

interface ChangeRow { poLineId: number; qty?: number | null; price?: number | null; amount?: number | null; needBy?: string | null; cancel?: boolean }

const PurchaseOrderEditor: React.FC<{
  id: number | null; buState: ReturnType<typeof useBusinessUnits>; user: string;
  /** a new order got its id / number (the tab relabels) */
  onSaved?: (id: number, number: string | null) => void;
  /** open another PO in its own tab (copy) */
  onOpenOther?: (id: number) => void;
  /** close this tab (after delete / not found) */
  onClose?: () => void;
}> = ({ id: initialId, buState, user, onSaved, onOpenOther, onClose }) => {
  const [id, setId] = useState<number | null>(initialId);
  // parent callbacks change identity every render — keep them in refs so loading does not re-run
  const cb = useRef({ onSaved, onClose });
  cb.current = { onSaved, onClose };
  const onBack = useCallback(() => cb.current.onClose?.(), []);
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [hdr, setHdr] = useState<Row | null>(null);
  const [lineRows, setLineRows] = useState<Row[]>([]);
  const [lines, setLines] = useState<EditLine[]>([]);
  const [cos, setCos] = useState<Row[]>([]);
  const [revs, setRevs] = useState<Row[]>([]);
  const [rcv, setRcv] = useState<Row[]>([]);
  const [invs, setInvs] = useState<Row[]>([]);
  const [invOpen, setInvOpen] = useState(false);
  const [loading, setLoading] = useState(!!id);
  const [busy, setBusy] = useState(false);
  const [coOpen, setCoOpen] = useState(false);
  const [coRows, setCoRows] = useState<Record<number, ChangeRow>>({});
  const [coAdds, setCoAdds] = useState<EditLine[]>([]);
  const [coNote, setCoNote] = useState<string | null>(null);
  const [coReason, setCoReason] = useState('');
  const [newBu, setNewBu] = useState<number | null>(buState.bu);
  // a new order follows the business unit chosen at the top of the page
  useEffect(() => {
    if (initialId) return;
    const target = buState.bu ?? (buState.bus[0] ? Number(buState.bus[0].BUSINESS_UNIT_ID) : null);
    setNewBu(prev => {
      if (prev !== target) form.setFieldsValue({ supplierId: undefined, supplierSiteId: undefined, paymentTerms: undefined });
      return target;
    });
  }, [buState.bu, buState.bus, initialId, form]);
  const bu = hdr ? Number(hdr.BUSINESS_UNIT_ID) : newBu;
  const lookups = useLookups(bu);
  const buRow = buState.bus.find(b => Number(b.BUSINESS_UNIT_ID) === bu);
  const fc = buRow?.FUNCTIONAL_CURRENCY || 'AED';
  const supplierId = Form.useWatch('supplierId', form);
  const currencyCode = Form.useWatch('currencyCode', form) || fc;
  const st = hdr?.DOCUMENT_STATUS as string | undefined;
  const editable = !hdr || EDITABLE.includes(st!);

  // terms and conditions (database/po/306_po_terms.sql): toolbar icon, Terms tab, printed PO
  const terms = usePoTerms(id, bu);
  const [termsDirty, setTermsDirty] = useState(false);
  const [tab, setTab] = useState('lines');
  const tabsRef = useRef<HTMLDivElement>(null);
  const termsCtx = useMemo(() => {
    const locName = (lid: unknown) => lookups.locations.find(l => Number(l.LOCATION_ID) === Number(lid))?.LOCATION_NAME;
    return orderContext(hdr, { buName: buRow?.BUSINESS_UNIT_NAME, shipTo: locName(hdr?.SHIP_TO_LOCATION_ID), billTo: locName(hdr?.BILL_TO_LOCATION_ID) });
  }, [hdr, buRow, lookups.locations]);
  const openTermsTab = () => { setTab('terms'); setTimeout(() => tabsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); };
  // a copied order keeps this order's clauses (the database gives it the defaults first)
  const copyTermsTo = async (newId: number) => {
    if (!terms.installed || !terms.data) return;
    try { await savePoTerms(newId, withMandatory(terms.data.clauses, terms.library, bu), user); }
    catch (e: any) { message.warning(`The copy has the default terms — copying this order's terms failed: ${e.message}`, 8); }
  };

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [h] = await poQuery(`SELECT * FROM RR_PO_V_ORDERS WHERE PO_HEADER_ID = ${nlit(id)}`);
      if (!h) { message.error('Purchase order not found'); onBack(); return; }
      const [ls, ds, co, rv, rc] = await Promise.all([
        poQuery(`SELECT * FROM RR_PO_V_ORDER_LINES WHERE PO_HEADER_ID = ${nlit(id)} ORDER BY LINE_NUM`),
        poQuery(`SELECT DISTRIBUTION_ID, PO_LINE_ID, DIST_NUM, PERCENT, CHARGE_ACCOUNT, REQUESTER_USER, DELIVER_TO_LOCATION_ID,
                        REQ_DISTRIBUTION_ID FROM RR_PO_V_DISTRIBUTIONS WHERE PO_HEADER_ID = ${nlit(id)} ORDER BY PO_LINE_ID, DIST_NUM`),
        poQuery(`SELECT * FROM RR_PO_V_CHANGE_ORDERS WHERE PO_HEADER_ID = ${nlit(id)} ORDER BY CHANGE_ORDER_ID DESC`),
        poQuery(`SELECT * FROM RR_PO_V_REVISIONS WHERE PO_HEADER_ID = ${nlit(id)} ORDER BY REVISION_NUM DESC`),
        poQuery(`SELECT * FROM RR_PO_V_RECEIPTS WHERE PO_HEADER_ID = ${nlit(id)} ORDER BY RCV_TRANSACTION_ID DESC`),
      ]);
      setHdr(h); setLineRows(ls);
      if (initialId) cb.current.onSaved?.(Number(h.PO_HEADER_ID), String(h.PO_NUMBER));   // relabel the tab
      setCos(co); setRevs(rv); setRcv(rc);
      // invoices matched to this PO (305_po_invoice_match.sql; empty until it is installed)
      poQuery(`SELECT * FROM RR_PO_V_INVOICE_MATCHES WHERE PO_HEADER_ID = ${nlit(id)} ORDER BY INVOICE_ID DESC, LINE_NUM`)
        .then(setInvs).catch(() => setInvs([]));
      form.setFieldsValue({
        supplierId: Number(h.SUPPLIER_ID), supplierSiteId: Number(h.SUPPLIER_SITE_ID), supplierContact: h.SUPPLIER_CONTACT,
        buyerUser: h.BUYER_USER, currencyCode: h.CURRENCY_CODE, rateType: h.RATE_TYPE, rateDate: day(h.RATE_DATE),
        rate: h.RATE, paymentTerms: h.PAYMENT_TERMS, shipToLocationId: h.SHIP_TO_LOCATION_ID ?? undefined,
        billToLocationId: h.BILL_TO_LOCATION_ID ?? undefined, description: h.DESCRIPTION, noteToSupplier: h.NOTE_TO_SUPPLIER,
        afterFactFlag: h.AFTER_FACT_FLAG,
      });
      setLines(ls.map(l => {
        const myD = ds.filter(d => Number(d.PO_LINE_ID) === Number(l.PO_LINE_ID));
        return {
          key: `p${l.PO_LINE_ID}`, lineType: l.LINE_TYPE, expenseItemId: l.EXPENSE_ITEM_ID, categoryId: l.CATEGORY_ID,
          itemDescription: l.ITEM_DESCRIPTION, uomCode: l.UOM_CODE, quantity: l.QUANTITY, unitPrice: l.UNIT_PRICE,
          amount: l.AMOUNT, needByDate: day(l.NEED_BY_DATE), promisedDate: day(l.PROMISED_DATE),
          locationId: l.SHIP_TO_LOCATION_ID, taxCode: l.TAX_CODE, requesterUser: l.REQUESTER_USER,
          note: l.NOTE_TO_SUPPLIER, supplierItemNum: l.SUPPLIER_ITEM_NUM, chargeAccount: myD[0]?.CHARGE_ACCOUNT ?? l.CHARGE_ACCOUNT,
          distributions: myD.map(d => ({
            percent: n(d.PERCENT), chargeAccount: d.CHARGE_ACCOUNT, requesterUser: d.REQUESTER_USER,
            deliverToLocationId: d.DELIVER_TO_LOCATION_ID, reqDistributionId: d.REQ_DISTRIBUTION_ID,
          })),
          reqLineIds: l.REQ_LINE_IDS ? String(l.REQ_LINE_IDS).split(',').map(Number) : undefined,
          status: l.LINE_STATUS,
        } as EditLine;
      }));
    } catch (e: any) { message.error(e.message); } finally { setLoading(false); }
  }, [id, form, onBack]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (id) return;
    form.setFieldsValue({ buyerUser: user, currencyCode: fc, rateDate: day(new Date().toISOString()), afterFactFlag: 'N' });
    setLines(ls => ls.length ? ls : [newLine({ needByDate: plusDays(7) })]);
  }, [id, form, user, fc]);

  // supplier site → payment terms + default currency
  const supplierSites = useSupplierSites(bu, supplierId);
  const siteId = Form.useWatch('supplierSiteId', form);
  const site = supplierSites.find(s => Number(s.SUPPLIER_SITE_ID) === Number(siteId));
  const onSite = (siteId: number) => {
    const s = supplierSites.find(x => Number(x.SUPPLIER_SITE_ID) === siteId);
    if (!s) return;
    form.setFieldsValue({ paymentTerms: s.PAYMENT_TERMS, ...(s.DEFAULT_CURRENCY && !id ? { currencyCode: s.DEFAULT_CURRENCY } : {}) });
  };

  const exec = async (proc: string, p: Record<string, unknown>, then?: (r: { id: number | null }) => void) => {
    setBusy(true);
    try {
      const r = await poExec(proc, p, user);
      (r.status === 'W' ? message.warning : message.success)(r.message || 'Done', 6);
      if (then) then(r); else await load();
      return r;
    } catch (e: any) { message.error(e.message, 10); return null; } finally { setBusy(false); }
  };

  const save = async (): Promise<number | null> => {
    const v = await form.validateFields().catch(() => null);   // invalid fields are shown on the form
    if (!v) return null;
    if (!lines.length) { message.warning('Add at least one line'); return null; }
    const r = await exec(PROC.savePo, {
      p_json: {
        poHeaderId: id, businessUnitId: bu, supplierId: v.supplierId, supplierSiteId: v.supplierSiteId,
        supplierContact: v.supplierContact || null, buyerUser: v.buyerUser || null, currencyCode: v.currencyCode,
        rateType: v.rateType || null, rateDate: v.rateDate || null, rate: v.currencyCode === fc ? 1 : (v.rate ?? null),
        paymentTerms: v.paymentTerms || null, shipToLocationId: v.shipToLocationId ?? null, billToLocationId: v.billToLocationId ?? null,
        description: v.description || null, noteToSupplier: v.noteToSupplier || null, afterFactFlag: v.afterFactFlag || 'N',
        lines: linesToJson(lines, 'PO'),
      },
    }, r => {
      if (!id && r.id) { setId(r.id); onSaved?.(r.id, (r as { number?: string | null }).number ?? null); }
      else load();
    });
    return r?.id ?? null;
  };

  const submit = async () => {
    const savedId = await save();
    if (savedId) await exec(PROC.submitPo, { p_po_header_id: savedId }, () => { load(); });
  };

  const printPdf = async (mark = false) => {
    if (!hdr) return;
    try {
      const saved = await loadPoTerms(id, bu);   // what is saved on the order, never unsaved edits
      if (termsDirty) message.warning('The PDF uses the saved terms — save the Terms & Conditions tab to include your changes', 6);
      const loc = (lid: unknown) => lookups.locations.find(l => Number(l.LOCATION_ID) === Number(lid)) || null;
      const doc = buildPoPdf(hdr, lineRows, { buName: buRow?.BUSINESS_UNIT_NAME, terms: printableClauses(saved.clauses, termsCtx),
        shipTo: loc(hdr.SHIP_TO_LOCATION_ID), billTo: loc(hdr.BILL_TO_LOCATION_ID) });
      doc.save(`${hdr.PO_NUMBER}${n(hdr.REVISION_NUM) ? `-R${hdr.REVISION_NUM}` : ''}.pdf`);
      if (mark && st === 'APPROVED') await exec(PROC.communicated, { p_po_header_id: id, p_method: 'PRINT', p_to: null });
    } catch (e: any) { message.error(e.message); }
  };

  const email = async () => {
    if (!hdr) return;
    const to = site?.PO_EMAIL || '';
    const addr = window.prompt('Send the purchase order to (e-mail)', to);
    if (!addr) return;
    await printPdf(false);
    window.location.href = `mailto:${encodeURIComponent(addr)}?subject=${encodeURIComponent(`Purchase Order ${hdr.PO_NUMBER}`)}`
      + `&body=${encodeURIComponent(`Dear ${hdr.SUPPLIER_NAME},\n\nPlease find attached purchase order ${hdr.PO_NUMBER} for ${money(hdr.TOTAL_AMOUNT)} ${hdr.CURRENCY_CODE}.\n\nRegards,\n${user}`)}`;
    await exec(PROC.communicated, { p_po_header_id: id, p_method: 'EMAIL', p_to: addr });
  };

  // ── change order ─────────────────────────────────────────────────────────
  const openCo = () => { setCoRows({}); setCoAdds([]); setCoNote(null); setCoReason(''); setCoOpen(true); };
  const coChanges = useMemo(() => {
    const out: Record<string, unknown>[] = [];
    lineRows.forEach(l => {
      const c = coRows[Number(l.PO_LINE_ID)];
      if (!c) return;
      if (c.cancel) { out.push({ op: 'CANCEL_LINE', poLineId: l.PO_LINE_ID }); return; }
      if (c.qty != null && n(c.qty) !== n(l.QUANTITY)) out.push({ op: 'UPDATE_QTY', poLineId: l.PO_LINE_ID, value: c.qty });
      if (c.price != null && n(c.price) !== n(l.UNIT_PRICE)) out.push({ op: 'UPDATE_PRICE', poLineId: l.PO_LINE_ID, value: c.price });
      if (c.amount != null && n(c.amount) !== n(l.AMOUNT)) out.push({ op: 'UPDATE_AMOUNT', poLineId: l.PO_LINE_ID, value: c.amount });
      if (c.needBy && c.needBy !== day(l.NEED_BY_DATE)) out.push({ op: 'UPDATE_NEED_BY', poLineId: l.PO_LINE_ID, value: c.needBy });
    });
    linesToJson(coAdds, 'PO').forEach(line => out.push({ op: 'ADD_LINE', line }));
    if (coNote !== null && coNote !== (hdr?.NOTE_TO_SUPPLIER || '')) out.push({ op: 'UPDATE_NOTE', value: coNote });
    return out;
  }, [coRows, coAdds, coNote, lineRows, hdr]);
  const setCo = (lid: number, p: Partial<ChangeRow>) => setCoRows(r => ({ ...r, [lid]: { ...(r[lid] || { poLineId: lid }), ...p } }));
  const submitCo = async () => {
    if (!coChanges.length) { message.warning('No changes entered'); return; }
    if (!coReason.trim()) { message.warning('Enter the reason for the change'); return; }
    const r = await exec(PROC.submitChange, { p_po_header_id: id, p_changes_json: coChanges, p_reason: coReason.trim() });
    if (r) setCoOpen(false);
  };

  const closeMenu = [
    { key: 'CLOSE', label: 'Close (no more receipts or invoices)', icon: <LockOutlined /> },
    { key: 'REOPEN', label: 'Reopen', icon: <UnlockOutlined /> },
    { key: 'FINAL_CLOSE', label: 'Finally close (permanent)', icon: <FileDoneOutlined />, danger: true },
  ];
  const doClose = async (action: string, lineId?: number) => {
    const reason = await askReason(action === 'FINAL_CLOSE' ? 'Finally close — this cannot be undone' : `${action === 'REOPEN' ? 'Reopen' : 'Close'}`,
      { required: action === 'FINAL_CLOSE', danger: action === 'FINAL_CLOSE', okText: 'Confirm' });
    if (reason === null) return;
    await exec(PROC.closePo, { p_po_header_id: id, p_po_line_id: lineId ?? null, p_action: action, p_reason: reason || null });
  };
  const doCancel = async (lineId?: number) => {
    let recreate = 'Y';
    const reason = await askReason(lineId ? 'Cancel line (open quantity)' : 'Cancel purchase order', {
      danger: true, okText: 'Cancel it',
      extra: hdr?.ORIGIN === 'REQUISITION' ? (
        <Checkbox defaultChecked style={{ marginBottom: 8 }} onChange={e => { recreate = e.target.checked ? 'Y' : 'N'; }}>
          Send requisition demand back to the buyer pool</Checkbox>) : undefined,
    });
    if (reason === null) return;
    await exec(PROC.cancelPo, { p_po_header_id: id, p_po_line_id: lineId ?? null, p_reason: reason, p_recreate_demand: recreate });
  };

  const total = useMemo(() => lines.reduce((s, l) => s + lineAmount(l), 0), [lines]);
  const taxRate = (code?: string | null) => n(lookups.taxCodes.find(t => t.TAX_CODE === code)?.TAX_RATE) / 100;
  const taxEstimate = useMemo(() => r2(lines.reduce((s, l) => s + lineAmount(l) * taxRate(l.taxCode), 0)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines, lookups.taxCodes]);

  if (loading) return <div style={{ padding: 60, textAlign: 'center' }}><Spin /></div>;
  const pendingCo = cos.find(c => c.STATUS === 'PENDING_APPROVAL');
  const ordered = n(hdr?.TOTAL_AMOUNT) - n(hdr?.AMOUNT_CANCELLED);
  const recvPct = ordered > 0 ? Math.min(100, Math.round(n(hdr?.AMOUNT_RECEIVED) / ordered * 100)) : 0;

  const approvedLineCols = [
    { title: '#', dataIndex: 'LINE_NUM', width: 40 },
    { title: 'Description', dataIndex: 'ITEM_DESCRIPTION', ellipsis: true, render: (v: string, r: Row) => <span>{r.ITEM_CODE && <Tag>{r.ITEM_CODE}</Tag>}{v}</span> },
    { title: 'Category', dataIndex: 'CATEGORY_NAME', width: 150, ellipsis: true },
    { title: 'Ordered', width: 120, align: 'right' as const, render: (_: unknown, r: Row) => r.LINE_TYPE === 'QUANTITY' ? `${qty(r.QUANTITY)} ${r.UOM_CODE || ''}` : money(r.AMOUNT) },
    { title: 'Price', dataIndex: 'UNIT_PRICE', width: 100, align: 'right' as const, render: (v: unknown) => money(v) },
    { title: 'Amount', dataIndex: 'AMOUNT', width: 120, align: 'right' as const, render: (v: unknown) => money(v) },
    { title: 'Received', width: 110, align: 'right' as const, render: (_: unknown, r: Row) => r.LINE_TYPE === 'QUANTITY' ? qty(r.QUANTITY_RECEIVED) : money(r.AMOUNT_RECEIVED) },
    { title: 'Billed', width: 90, align: 'right' as const, render: (_: unknown, r: Row) => r.LINE_TYPE === 'QUANTITY' ? qty(r.QUANTITY_BILLED) : money(r.AMOUNT_BILLED) },
    { title: 'Cancelled', width: 90, align: 'right' as const, render: (_: unknown, r: Row) => r.LINE_TYPE === 'QUANTITY' ? qty(r.QUANTITY_CANCELLED) : money(r.AMOUNT_CANCELLED) },
    { title: 'Need by', dataIndex: 'NEED_BY_DATE', width: 100, render: day },
    { title: 'Charge account', dataIndex: 'CHARGE_ACCOUNT', width: 210, render: (v: string, r: Row) => <span>{v}{n(r.DIST_COUNT) > 1 && <Tag style={{ marginLeft: 4 }}>+{n(r.DIST_COUNT) - 1}</Tag>}</span> },
    { title: 'Status', width: 150, render: (_: unknown, r: Row) => <Space size={2} wrap><StatusTag s={r.LINE_STATUS === 'CANCELLED' ? 'CANCELLED' : r.CLOSURE_STATUS} /></Space> },
    { title: '', width: 50, fixed: 'right' as const, render: (_: unknown, r: Row) => st === 'APPROVED' && r.LINE_STATUS !== 'CANCELLED' && r.CLOSURE_STATUS !== 'FINALLY_CLOSED' ? (
      <Dropdown trigger={['click']} menu={{
        items: [
          { key: 'cancel', label: 'Cancel line', danger: true },
          { key: 'CLOSE', label: 'Close line' }, { key: 'REOPEN', label: 'Reopen line' },
          { key: 'FINAL_CLOSE', label: 'Finally close line', danger: true },
        ],
        onClick: ({ key }) => (key === 'cancel' ? doCancel(Number(r.PO_LINE_ID)) : doClose(key, Number(r.PO_LINE_ID))),
      }}><Button size="small" type="text" icon={<DownOutlined />} /></Dropdown>
    ) : null },
  ];

  const rate = n(form.getFieldValue('rate')) || n(hdr?.RATE) || 1;
  const subTotal = editable ? total : n(hdr?.TOTAL_AMOUNT);
  const tax = editable ? taxEstimate : n(hdr?.TOTAL_TAX_ESTIMATE);
  const buOptions = buState.bus.map(b => ({ value: Number(b.BUSINESS_UNIT_ID), label: b.BUSINESS_UNIT_NAME }));
  const TotalRow: React.FC<{ label: string; value: React.ReactNode; strong?: boolean }> = ({ label, value, strong }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px dashed #eee', fontSize: 12 }}>
      <Text type={strong ? undefined : 'secondary'} strong={strong} style={{ fontSize: 12 }}>{label}</Text>
      <Text strong={strong} style={{ fontSize: strong ? 14 : 12 }}>{value}</Text>
    </div>
  );

  // PO invoice status (line level: billed vs what can be billed)
  const invBasis = (l: Row) => {
    const three = l.MATCH_LEVEL === 'THREE_WAY';
    return l.LINE_TYPE === 'QUANTITY'
      ? { basis: three ? n(l.QUANTITY_RECEIVED) : n(l.QUANTITY) - n(l.QUANTITY_CANCELLED), billed: n(l.QUANTITY_BILLED) }
      : { basis: three ? n(l.AMOUNT_RECEIVED) : n(l.AMOUNT) - n(l.AMOUNT_CANCELLED), billed: n(l.AMOUNT_BILLED) };
  };
  const liveLines = lineRows.filter(l => l.LINE_STATUS !== 'CANCELLED');
  const canInvoice = st === 'APPROVED' && hdr?.HOLD_FLAG !== 'Y' && liveLines.some(l => {
    const b = invBasis(l);
    return !['CLOSED', 'FINALLY_CLOSED', 'CLOSED_FOR_INVOICING'].includes(l.CLOSURE_STATUS) && b.basis - b.billed > 0.000001;
  });
  const anyBilled = liveLines.some(l => invBasis(l).billed > 0);
  const allBilled = liveLines.length > 0 && liveLines.every(l => { const b = invBasis(l); const ord = l.LINE_TYPE === 'QUANTITY' ? n(l.QUANTITY) - n(l.QUANTITY_CANCELLED) : n(l.AMOUNT) - n(l.AMOUNT_CANCELLED); return b.billed >= ord - 0.000001; });
  const invoiceStatus = allBilled ? 'FULLY_INVOICED' : anyBilled ? 'PARTIALLY_INVOICED' : 'NOT_INVOICED';

  const openApInvoice = (r: Row) => navigate('/ap/manage-invoices', { state: { openInvoiceId: r.INVOICE_ID, openInvoiceNumber: r.INVOICE_NUM } });
  const cancelApInvoice = (r: Row) => {
    Modal.confirm({
      title: `Cancel AP invoice ${r.INVOICE_NUM}?`, okText: 'Cancel invoice', okButtonProps: { danger: true },
      content: 'The invoice is cancelled in Payables (accounting reversed if posted) and the PO lines open again for invoicing.',
      onOk: async () => {
        const base = APEX_DB_CONFIG.baseUrl.replace(/\/+$/, '');
        const el = await fetch(`${base}/ap/invoices/${r.INVOICE_ID}/cancel-eligibility`).then(x => x.json()).catch(() => null);
        if (el && el.eligible === false) {
          const why = (el.checks || []).filter((c: any) => !c.passed).map((c: any) => c.detail || c.check).join('; ');
          message.error(`Cannot cancel: ${why || 'not eligible'}`, 10); throw new Error('not eligible');
        }
        const t0 = performance.now();
        const res = await fetch(`${base}/ap/invoices/${r.INVOICE_ID}/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cancelledBy: user }) });
        const data = await res.json().catch(() => null);
        logApi({ method: 'POST', url: `${base}/ap/invoices/${r.INVOICE_ID}/cancel`, body: { cancelledBy: user }, status: res.status, ok: res.ok, ms: Math.round(performance.now() - t0), response: data, label: 'AP cancel invoice' });
        if (!res.ok || data?.status === 'error') { message.error(data?.message || `HTTP ${res.status}`, 10); throw new Error('cancel failed'); }
        // the AP trigger reverses the match; this call is a no-op then (and covers installs without the trigger)
        await exec(PROC.cancelInvoiceMatch, { p_invoice_id: r.INVOICE_ID });
      },
    });
  };

  const actions = (
    <Space wrap size={6}>
      {editable && <Button icon={<SaveOutlined />} loading={busy} onClick={save}>Save</Button>}
      {editable && <Button type="primary" icon={<SendOutlined />} loading={busy} onClick={submit}>Submit</Button>}
      {st === 'PENDING_APPROVAL' && <Popconfirm title="Withdraw from approval?" onConfirm={() => exec(PROC.withdrawPo, { p_po_header_id: id })}>
        <Button icon={<RollbackOutlined />} loading={busy}>Withdraw</Button></Popconfirm>}
      {st === 'APPROVED' && hdr?.CLOSURE_STATUS !== 'FINALLY_CLOSED' && <>
        <Button icon={<InboxOutlined />} type="primary" disabled={hdr?.HOLD_FLAG === 'Y'} onClick={() => navigate(`/po/receiving?po=${encodeURIComponent(hdr!.PO_NUMBER)}`)}>Receive</Button>
        <Tooltip title={canInvoice ? 'Create a Payables invoice for received / ordered quantities not yet billed' : 'Nothing left to invoice (receive first for 3-way match lines)'}>
          <Button icon={<DollarOutlined />} disabled={!canInvoice} onClick={() => setInvOpen(true)}>Create AP invoice</Button>
        </Tooltip>
        <Button icon={<EditOutlined />} disabled={!!pendingCo} onClick={openCo}>Change order</Button>
        <Dropdown menu={{ items: closeMenu, onClick: ({ key }) => doClose(key) }}><Button icon={<LockOutlined />}>Close <DownOutlined /></Button></Dropdown>
        {hdr?.HOLD_FLAG === 'Y'
          ? <Button icon={<PlayCircleOutlined />} onClick={() => exec(PROC.holdPo, { p_po_header_id: id, p_action: 'RELEASE', p_reason: null })}>Release hold</Button>
          : <Button icon={<PauseCircleOutlined />} onClick={async () => {
            const r = await askReason('Put the purchase order on hold'); if (r !== null) exec(PROC.holdPo, { p_po_header_id: id, p_action: 'HOLD', p_reason: r });
          }}>Hold</Button>}
        <Button danger icon={<StopOutlined />} onClick={() => doCancel()}>Cancel PO</Button>
      </>}
      <PoTermsButton state={terms} ctx={termsCtx} poNumber={hdr?.PO_NUMBER} dirty={termsDirty}
        onManage={editable && id ? openTermsTab : undefined} />
      {hdr && <Button icon={<PrinterOutlined />} onClick={() => printPdf(st === 'APPROVED' && !hdr.COMMUNICATED_DATE)}>Print PDF</Button>}
      {st === 'APPROVED' && <Button icon={<MailOutlined />} onClick={email}>E-mail supplier</Button>}
      {hdr && <Button icon={<CopyOutlined />} loading={busy} onClick={() => exec(PROC.copyPo, { p_po_header_id: id }, r => {
        if (r.id) { const newId = r.id; copyTermsTo(newId).finally(() => onOpenOther?.(newId)); }
      })}>Copy</Button>}
      {st === 'INCOMPLETE' && !hdr?.APPROVED_DATE && hdr && <Popconfirm title="Delete this draft purchase order?"
        onConfirm={() => exec(PROC.deletePo, { p_po_header_id: id }, () => onBack())}>
        <Button danger icon={<DeleteOutlined />} loading={busy}>Delete</Button></Popconfirm>}
      <HistoryButton entityType="PO" id={id} />
    </Space>
  );

  const section = (title: string, sub?: string) => (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '2px 0 8px' }}>
      <Text strong style={{ fontSize: 11, color: PO_RED, textTransform: 'uppercase', letterSpacing: 0.5 }}>{title}</Text>
      {sub && <Text type="secondary" style={{ fontSize: 12 }}>{sub}</Text>}
      <div style={{ flex: 1, borderBottom: '1px solid #f0f0f0' }} />
    </div>
  );
  const grid = (cols: string) => ({ display: 'grid', gridTemplateColumns: cols, columnGap: 14 } as React.CSSProperties);

  return (
    <div style={{ padding: '12px 20px 20px', background: '#f7f8fa' }}>
      {/* ── title bar ── */}
      <div style={{ position: 'sticky', top: 0, zIndex: 5, background: '#fff', border: '1px solid #eef0f3', borderRadius: 10,
        padding: '8px 14px', marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10,
        boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 34, height: 34, borderRadius: 8, background: `${PO_RED}12`, color: PO_RED, display: 'flex',
            alignItems: 'center', justifyContent: 'center', fontSize: 20 }}><FileTextOutlined /></div>
          <div>
            <Space size={8} wrap>
              <Text strong style={{ fontSize: 16 }}>{hdr ? hdr.PO_NUMBER : 'New purchase order'}</Text>
              {hdr && n(hdr.REVISION_NUM) > 0 && <Tag>Rev {hdr.REVISION_NUM}</Tag>}
              {hdr ? <><StatusTag s={st} />{st === 'APPROVED' && <StatusTag s={hdr.CLOSURE_STATUS} />}{st === 'APPROVED' && <StatusTag s={invoiceStatus} />}</> : <Tag color="blue">Draft</Tag>}
              {hdr?.HOLD_FLAG === 'Y' && <Tooltip title={hdr.HOLD_REASON}><Tag color="red">ON HOLD</Tag></Tooltip>}
              {n(hdr?.PENDING_CHANGES) > 0 && <Tag color="gold">Change pending</Tag>}
            </Space>
            <div><Text type="secondary" style={{ fontSize: 12 }}>
              {buRow?.BUSINESS_UNIT_NAME || 'Choose a business unit'}
              {' · '}{hdr?.ORIGIN === 'REQUISITION' ? 'From requisition' : 'Direct purchase order'}
              {hdr ? ` · Created ${day(hdr.CREATION_DATE)} by ${hdr.CREATED_BY}` : ''}
            </Text></div>
          </div>
        </div>
        {actions}
      </div>

      {st === 'REJECTED' && <Alert type="error" showIcon style={{ marginBottom: 12 }} message="Rejected — see History for the approver's comments, then edit and submit again." />}
      {pendingCo && <Alert type="warning" showIcon style={{ marginBottom: 12 }}
        message={`Change order ${pendingCo.CO_NUMBER} is pending approval`} description={pendingCo.CHANGE_SUMMARY}
        action={<Popconfirm title="Cancel this change order?" onConfirm={() => exec(PROC.cancelChange, { p_change_order_id: pendingCo.CHANGE_ORDER_ID })}>
          <Button size="small" danger>Cancel change</Button></Popconfirm>} />}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 260px', gap: 10, marginBottom: 10, alignItems: 'start' }}>
        <Card size="small" style={{ borderRadius: 10 }} styles={{ body: { padding: '10px 14px 2px' } }}>
          <style>{`
            .po-compact .ant-form-item { margin-bottom: 8px; }
            .po-compact .ant-form-item-label > label { font-size: 12px; color: #595959; }
            .po-compact .ant-form-item-label { padding-right: 8px; }
          `}</style>
          <Form form={form} disabled={!editable} requiredMark className="po-compact" size="small"
            layout="horizontal" labelAlign="left" labelCol={{ flex: '96px' }} wrapperCol={{ flex: 'auto' }} colon={false}>
            {section('Supplier')}
            <div style={grid('minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)')}>
              <Form.Item name="supplierId" label="Supplier" rules={[{ required: true, message: 'Choose the supplier' }]} style={{ gridColumn: 'span 2' }}>
                <SupplierSelect bu={bu} size="small" disabled={!editable || !bu} placeholder={bu ? 'Type supplier name or number' : 'Choose the business unit first'}
                  onChange={() => form.setFieldsValue({ supplierSiteId: undefined, paymentTerms: undefined })} />
              </Form.Item>
              <div style={{ gridRow: 'span 3', background: '#fafbfc', border: '1px dashed #e3e6ea', borderRadius: 8, padding: '6px 10px', marginBottom: 8, fontSize: 12, lineHeight: 1.6 }}>
                {site ? <>
                  <Text strong style={{ fontSize: 12 }}>{site.SUPPLIER_NAME}</Text>
                  {site.PURCHASING_FLAG === 'Y' ? <Tag color="green" style={{ marginLeft: 6, fontSize: 11 }}>Purchasing site</Tag> : <Tag style={{ marginLeft: 6, fontSize: 11 }}>Pay site</Tag>}
                  <div><Text type="secondary">{site.ADDRESS || [site.CITY, site.COUNTRY].filter(Boolean).join(', ') || 'No address'}</Text></div>
                  {site.TAX_REGISTRATION_NUMBER && <div><Text type="secondary">TRN {site.TAX_REGISTRATION_NUMBER}</Text></div>}
                  <div><Text type="secondary">PO by {String(site.PO_COMMUNICATION || 'PRINT').toLowerCase()}{site.PO_EMAIL ? ` · ${site.PO_EMAIL}` : ''}</Text></div>
                </> : <Text type="secondary">Supplier details appear here once a site is chosen.</Text>}
              </div>
              <Form.Item name="supplierSiteId" label="Site" rules={[{ required: true, message: 'Choose the site' }]}>
                <Select options={siteOptions(supplierSites, supplierId)} disabled={!editable || !supplierId} onChange={onSite}
                  placeholder={supplierId ? 'Choose site' : 'Choose supplier first'} />
              </Form.Item>
              <Form.Item name="paymentTerms" label="Pay terms"><Input placeholder="From the supplier site" /></Form.Item>
              <Form.Item name="supplierContact" label="Contact" style={{ gridColumn: 'span 2' }}><Input placeholder="Name / phone / e-mail" /></Form.Item>
            </div>
            {site?.PURCHASING_HOLD_FLAG === 'Y' && <Alert type="error" showIcon style={{ marginBottom: 8 }} message={`Supplier site on purchasing hold: ${site.HOLD_REASON || ''}`} />}

            {section('Order')}
            <div style={grid('minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)')}>
              {!hdr && !buState.bu && (
              <Form.Item label="Business unit" required>
                  <Select value={bu ?? undefined} options={buOptions} showSearch optionFilterProp="label" disabled={!!hdr}
                    placeholder="Choose business unit"
                    onChange={v => { setNewBu(v); form.setFieldsValue({ supplierId: undefined, supplierSiteId: undefined, paymentTerms: undefined }); }} />
                </Form.Item>
              )}
              <Form.Item name="buyerUser" label="Buyer"><Input /></Form.Item>
              <Form.Item name="currencyCode" label="Currency"><Select showSearch options={lookups.currencies.map(c => ({ value: c, label: c }))} /></Form.Item>
              {currencyCode !== fc && <>
                <Form.Item name="rateType" label="Rate type"><Select allowClear options={['Corporate', 'Spot', 'User'].map(v => ({ value: v, label: v }))} /></Form.Item>
                <Form.Item name="rateDate" label="Rate date"><Input type="date" /></Form.Item>
                <Form.Item name="rate" label={`Rate → ${fc}`} tooltip="Blank = daily rate"><InputNumber style={{ width: '100%' }} min={0} /></Form.Item>
              </>}
              <Form.Item name="description" label="Description" style={{ gridColumn: 'span 2' }}><Input maxLength={240} placeholder="What is being purchased" /></Form.Item>
              <Form.Item name="afterFactFlag" label={<Tooltip title="Goods/services already delivered before the PO (needs 'Allow after-the-fact PO' in options)">After fact</Tooltip>}>
                <Select options={YesNo} /></Form.Item>
            </div>

            {section('Delivery & notes')}
            <div style={grid('minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)')}>
              <Form.Item name="shipToLocationId" label="Ship to"><Select allowClear placeholder="BU default" showSearch optionFilterProp="label"
                options={lookups.locations.filter(l => l.SHIP_TO_FLAG !== 'N').map(l => ({ value: Number(l.LOCATION_ID), label: l.LOCATION_NAME }))} /></Form.Item>
              <Form.Item name="billToLocationId" label="Bill to"><Select allowClear placeholder="BU default" showSearch optionFilterProp="label"
                options={lookups.locations.filter(l => l.BILL_TO_FLAG !== 'N').map(l => ({ value: Number(l.LOCATION_ID), label: l.LOCATION_NAME }))} /></Form.Item>
              <Form.Item name="noteToSupplier" label="Note"><Input.TextArea rows={1} autoSize={{ minRows: 1, maxRows: 4 }} maxLength={2000} placeholder="Note to supplier" /></Form.Item>
            </div>
          </Form>
        </Card>

        <Card size="small" style={{ position: 'sticky', top: 84, borderRadius: 10, overflow: 'hidden' }} styles={{ body: { padding: 0 } }}>
          <div style={{ background: `linear-gradient(135deg, ${PO_RED}, #a33b2c)`, color: '#fff', padding: '10px 14px' }}>
            <div style={{ fontSize: 12, opacity: 0.85, textTransform: 'uppercase', letterSpacing: 0.5 }}>Order total</div>
            <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.2 }}>{money(r2(subTotal + tax))}</div>
            <div style={{ fontSize: 12, opacity: 0.85 }}>{currencyCode}{currencyCode !== fc ? ` · ${money(r2((subTotal + tax) * rate))} ${fc}` : ''}</div>
          </div>
          <div style={{ padding: '8px 16px 12px' }}>
            <TotalRow label="Lines" value={editable ? lines.length : lineRows.length} />
            <TotalRow label="Subtotal" value={money(subTotal)} />
            <TotalRow label="Tax (estimate)" value={money(tax)} />
            {hdr && st === 'APPROVED' && <>
              <TotalRow label="Received" value={money(hdr.AMOUNT_RECEIVED)} />
              <TotalRow label="To receive" value={money(hdr.AMOUNT_TO_RECEIVE)} />
              <TotalRow label="Billed" value={money(hdr.AMOUNT_BILLED)} />
              {n(hdr.AMOUNT_CANCELLED) > 0 && <TotalRow label="Cancelled" value={money(hdr.AMOUNT_CANCELLED)} />}
              <div style={{ marginTop: 8 }}><Text type="secondary" style={{ fontSize: 12 }}>Receipt progress</Text><Progress percent={recvPct} size="small" /></div>
            </>}
            {hdr && <div style={{ marginTop: 8, fontSize: 12 }}>
              {hdr.APPROVED_DATE && <><Text type="secondary">Approved {day(hdr.APPROVED_DATE)}</Text><br /></>}
              <Text type="secondary">Sent to supplier {day(hdr.COMMUNICATED_DATE) || '—'}</Text>
            </div>}
          </div>
        </Card>
      </div>

      <div ref={tabsRef} style={{ scrollMarginTop: 70 }} />
      <Tabs activeKey={tab} onChange={setTab} items={[
        {
          key: 'lines', label: `Lines (${editable ? lines.length : lineRows.length})`,
          children: editable ? (
            <LinesEditor mode="PO" lines={lines} onChange={setLines} lookups={lookups} currency={currencyCode} company={buRow?.COMPANY} bu={bu} />
          ) : (
            <Table size="small" rowKey="PO_LINE_ID" dataSource={lineRows} pagination={false} scroll={{ x: 1600 }} columns={approvedLineCols} />
          ),
        },
        ...(hdr ? [
          { key: 'invoices', label: `Invoices (${new Set(invs.filter(i => i.MATCH_STATUS === 'MATCHED').map(i => i.INVOICE_ID)).size})`, children: (
            <Table size="small" rowKey={r => `${r.INVOICE_ID}-${r.PO_LINE_ID}-${r.MATCH_STATUS}`} dataSource={invs} pagination={false} columns={[
              { title: 'Invoice', dataIndex: 'INVOICE_NUM', width: 170, render: (v, r) => (
                <a onClick={() => openApInvoice(r)}>{v || `#${r.INVOICE_ID}`}</a>) },
              { title: 'PO line', dataIndex: 'LINE_NUM', width: 70 },
              { title: 'Description', dataIndex: 'ITEM_DESCRIPTION', ellipsis: true },
              { title: 'Qty billed', dataIndex: 'QUANTITY_BILLED', width: 100, align: 'right', render: qty },
              { title: 'Amount', dataIndex: 'AMOUNT_BILLED', width: 130, align: 'right', render: (v, r) => `${money(v)} ${r.CURRENCY_CODE}` },
              { title: 'Invoice status', dataIndex: 'INVOICE_STATUS', width: 140, render: v => v ? <Tag>{String(v)}</Tag> : null },
              { title: 'Match', dataIndex: 'MATCH_STATUS', width: 110, render: v => <Tag color={v === 'MATCHED' ? 'green' : 'default'}>{v}</Tag> },
              { title: 'Date', dataIndex: 'CREATION_DATE', width: 100, render: day },
              { title: '', width: 120, render: (_, r) => r.MATCH_STATUS === 'MATCHED' ? (
                <Button size="small" danger onClick={() => cancelApInvoice(r)}>Cancel invoice</Button>) : null },
            ]} />) },
          { key: 'receipts', label: `Receipts (${rcv.length})`, children: (
            <Table size="small" rowKey="RCV_TRANSACTION_ID" dataSource={rcv} pagination={{ pageSize: 15 }} columns={[
              { title: 'Receipt', dataIndex: 'RECEIPT_NUMBER', width: 150 },
              { title: 'Type', dataIndex: 'TRANSACTION_TYPE', width: 100, render: v => <StatusTag s={v} /> },
              { title: 'Date', dataIndex: 'TRANSACTION_DATE', width: 110, render: day },
              { title: 'Line', dataIndex: 'LINE_NUM', width: 60 },
              { title: 'Description', dataIndex: 'ITEM_DESCRIPTION', ellipsis: true },
              { title: 'Qty', dataIndex: 'QUANTITY', width: 90, align: 'right', render: qty },
              { title: 'Amount', dataIndex: 'AMOUNT', width: 120, align: 'right', render: v => money(v) },
              { title: 'Accounting', dataIndex: 'ACCOUNTING_STATUS', width: 120, render: v => <StatusTag s={v} /> },
              { title: 'By', dataIndex: 'CREATED_BY', width: 110 },
            ]} />) },
          { key: 'changes', label: `Change orders (${cos.length})`, children: (
            <Table size="small" rowKey="CHANGE_ORDER_ID" dataSource={cos} pagination={false} columns={[
              { title: 'Change', dataIndex: 'CO_NUMBER', width: 150 },
              { title: 'From rev', dataIndex: 'FROM_REVISION', width: 80 },
              { title: 'Status', dataIndex: 'STATUS', width: 140, render: v => <StatusTag s={v} /> },
              { title: 'Summary', dataIndex: 'CHANGE_SUMMARY' },
              { title: 'Δ amount (func)', dataIndex: 'AMOUNT_DELTA_FUNC', width: 130, align: 'right', render: v => money(v) },
              { title: 'Reason', dataIndex: 'REASON', width: 220, ellipsis: true },
              { title: 'By', dataIndex: 'CREATED_BY', width: 100 },
              { title: 'Applied', dataIndex: 'APPLIED_DATE', width: 100, render: day },
            ]} />) },
          { key: 'revs', label: `Revisions (${revs.length})`, children: (
            <Table size="small" rowKey="REVISION_ID" dataSource={revs} pagination={false} columns={[
              { title: 'Revision', dataIndex: 'REVISION_NUM', width: 90 },
              { title: 'Summary', dataIndex: 'CHANGE_SUMMARY' },
              { title: 'By', dataIndex: 'CREATED_BY', width: 120 },
              { title: 'When', dataIndex: 'CREATION_DATE', width: 160, render: v => String(v ?? '').replace('T', ' ').slice(0, 16) },
            ]} />) },
        ] : []),
        { key: 'terms', label: <span><FileProtectOutlined /> Terms & Conditions ({terms.shown.length}){termsDirty && editable ? ' •' : ''}</span>,
          children: <PoTermsPanel state={terms} poId={id} bu={bu} editable={editable} user={user} ctx={termsCtx} onDirtyChange={setTermsDirty} /> },
        { key: 'attachments', label: <span><PaperClipOutlined /> Attachments</span>, disabled: !id,
          children: id ? <PoAttachments entityType="PO" entityId={id} user={user} readOnly={st === 'CANCELLED' || hdr?.CLOSURE_STATUS === 'FINALLY_CLOSED'} /> : null },
      ]} />

      {hdr && <PoApInvoice open={invOpen} onClose={() => setInvOpen(false)} onDone={() => load()} hdr={hdr}
        buName={buRow?.BUSINESS_UNIT_NAME || ''} company={buRow?.COMPANY} fc={fc} taxCodes={lookups.taxCodes} user={user} />}

      <Modal open={coOpen} width={1200} title={`Change order — ${hdr?.PO_NUMBER}`} destroyOnHidden onCancel={() => setCoOpen(false)}
        onOk={submitCo} okText={`Submit change (${coChanges.length})`} confirmLoading={busy}>
        <Alert type="info" showIcon style={{ marginBottom: 8 }}
          message="Changes are applied as a new revision. Increases above the re-approval threshold go to approval; decreases and date changes apply immediately." />
        <Table size="small" rowKey="PO_LINE_ID" pagination={false} scroll={{ x: 1000 }}
          dataSource={lineRows.filter(l => l.LINE_STATUS !== 'CANCELLED' && l.CLOSURE_STATUS !== 'FINALLY_CLOSED')}
          columns={[
            { title: '#', dataIndex: 'LINE_NUM', width: 40 },
            { title: 'Description', dataIndex: 'ITEM_DESCRIPTION', ellipsis: true },
            { title: 'Received', width: 90, align: 'right', render: (_, r) => r.LINE_TYPE === 'QUANTITY' ? qty(r.QUANTITY_RECEIVED) : money(r.AMOUNT_RECEIVED) },
            { title: 'Quantity', width: 120, render: (_, r) => r.LINE_TYPE === 'QUANTITY' ? (
              <InputNumber size="small" min={0} style={{ width: '100%' }} disabled={coRows[r.PO_LINE_ID]?.cancel}
                value={coRows[r.PO_LINE_ID]?.qty ?? r.QUANTITY} onChange={v => setCo(r.PO_LINE_ID, { qty: v as number })} />) : '—' },
            { title: 'Unit price', width: 120, render: (_, r) => r.LINE_TYPE === 'QUANTITY' ? (
              <Tooltip title={n(r.QUANTITY_RECEIVED) ? 'Price is locked after receipt' : ''}>
                <InputNumber size="small" min={0} style={{ width: '100%' }} disabled={!!n(r.QUANTITY_RECEIVED) || coRows[r.PO_LINE_ID]?.cancel}
                  value={coRows[r.PO_LINE_ID]?.price ?? r.UNIT_PRICE} onChange={v => setCo(r.PO_LINE_ID, { price: v as number })} /></Tooltip>) : '—' },
            { title: 'Amount', width: 130, render: (_, r) => r.LINE_TYPE === 'AMOUNT' ? (
              <InputNumber size="small" min={0} style={{ width: '100%' }} disabled={coRows[r.PO_LINE_ID]?.cancel}
                value={coRows[r.PO_LINE_ID]?.amount ?? r.AMOUNT} onChange={v => setCo(r.PO_LINE_ID, { amount: v as number })} />)
              : money(r2(n(coRows[r.PO_LINE_ID]?.qty ?? r.QUANTITY) * n(coRows[r.PO_LINE_ID]?.price ?? r.UNIT_PRICE))) },
            { title: 'Need by', width: 140, render: (_, r) => (
              <Input size="small" type="date" disabled={coRows[r.PO_LINE_ID]?.cancel}
                value={coRows[r.PO_LINE_ID]?.needBy ?? day(r.NEED_BY_DATE)} onChange={e => setCo(r.PO_LINE_ID, { needBy: e.target.value })} />) },
            { title: 'Cancel', width: 70, align: 'center', render: (_, r) => (
              <Checkbox checked={!!coRows[r.PO_LINE_ID]?.cancel} onChange={e => setCo(r.PO_LINE_ID, { cancel: e.target.checked })} />) },
          ]} />
        <Card size="small" title="New lines" style={{ marginTop: 8 }} extra={!coAdds.length && (
          <Button size="small" icon={<PlusOutlined />} onClick={() => setCoAdds([newLine({ needByDate: plusDays(7) })])}>Add line</Button>)}>
          {coAdds.length > 0 && <LinesEditor mode="PO" lines={coAdds} onChange={setCoAdds} lookups={lookups} currency={hdr?.CURRENCY_CODE} company={buRow?.COMPANY} />}
        </Card>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 8 }}>
          <div><Text type="secondary">Note to supplier</Text>
            <Input.TextArea rows={2} value={coNote ?? hdr?.NOTE_TO_SUPPLIER ?? ''} onChange={e => setCoNote(e.target.value)} /></div>
          <div><Text type="secondary">Reason (required)</Text>
            <Input.TextArea rows={2} value={coReason} onChange={e => setCoReason(e.target.value)} status={!coReason.trim() ? 'warning' : undefined} /></div>
        </div>
      </Modal>
    </div>
  );
};

export default PurchaseOrderEditor;
