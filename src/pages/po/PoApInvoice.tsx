// Purchasing-RR — create an AP invoice from a purchase order (line level, partial allowed).
//   1. POST ap/createinvoicefull            the standard AP create: RR_AP_INVOICES_ALL + RR_AP_INVOICE_LINES_ALL
//      (one AP line per PO distribution, carrying PONumber/POLineNumber + POLineId/PODistributionId).
//      The same transaction matches the PO (RR_PO_MATCH_PKG.MATCH_AP_INVOICE, patch database/ap/147):
//      a refused match (over-billing, PO on hold, …) rolls the invoice back and the POST returns ERROR.
//   2. POST ap/createinvoice/installments   one installment for the full amount
//   3. PUT  ap/invoices/:id/validation-status  'Validated' when the checks pass (mirrored on the PO match)
// Accounts: receipt-accrued lines debit the receipt accrual (GRNI) account, others the charge account.
import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Form, Input, Table, InputNumber, Checkbox, Typography, Alert, Space, Tag, Select, message, Steps } from 'antd';
import { APEX_DB_CONFIG } from '../../config/api.config';
import { poQuery, poExec, PROC, nlit, money, qty, day, today, Row, n, r2, logApi } from '../../services/po.service';
import { AccountInput } from './poShared';

const { Text } = Typography;
const BASE = APEX_DB_CONFIG.baseUrl.replace(/\/+$/, '');
const LIAB_KEY = 'po.apLiabilityAccount.';

interface Pick { selected: boolean; qty: number | null; amount: number | null; taxCode: string | null }

async function call(method: string, url: string, body?: unknown, label = 'AP') {
  const t0 = performance.now();
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data: any = null; try { data = JSON.parse(text); } catch { data = text.slice(0, 2000); }
  logApi({ method, url, body: body ?? null, status: res.status, ok: res.ok, ms: Math.round(performance.now() - t0), response: data, label });
  return { res, data };
}

const termsDays = (terms: string | null | undefined) => {
  const m = String(terms || '').match(/(\d+)/);
  return m ? Number(m[1]) : 0;
};
const addDays = (d: string, k: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10); };

const PoApInvoice: React.FC<{
  open: boolean; onClose: () => void; onDone: () => void;
  hdr: Row; buName: string; company?: string | null; fc: string; taxCodes: Row[]; user: string;
}> = ({ open, onClose, onDone, hdr, buName, company, fc, taxCodes, user }) => {
  const [form] = Form.useForm();
  const [lines, setLines] = useState<Row[]>([]);
  const [dists, setDists] = useState<Row[]>([]);
  const [picks, setPicks] = useState<Record<number, Pick>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(-1);
  const [stepErr, setStepErr] = useState<string | null>(null);
  const [validate, setValidate] = useState(true);
  const rateOf = (code?: string | null) => n(taxCodes.find(t => t.TAX_CODE === code)?.TAX_RATE) / 100;

  useEffect(() => {
    if (!open) return;
    setStep(-1); setStepErr(null);
    let liab: string | null = null;
    try { liab = localStorage.getItem(LIAB_KEY + hdr.BUSINESS_UNIT_ID); } catch { /* ignore */ }
    form.setFieldsValue({ invoiceNumber: '', invoiceDate: today(), accountingDate: today(), description: `PO ${hdr.PO_NUMBER}${hdr.DESCRIPTION ? ` — ${hdr.DESCRIPTION}` : ''}`,
      paymentTerms: hdr.PAYMENT_TERMS, liability: liab, rate: n(hdr.RATE) || 1 });
    setLoading(true);
    Promise.all([
      poQuery(`SELECT * FROM RR_PO_V_INVOICEABLE_LINES WHERE PO_HEADER_ID = ${nlit(hdr.PO_HEADER_ID)} ORDER BY LINE_NUM`),
      poQuery(`SELECT * FROM RR_PO_V_INVOICE_DIST_ACCOUNTS WHERE PO_HEADER_ID = ${nlit(hdr.PO_HEADER_ID)} ORDER BY PO_LINE_ID, DIST_NUM`),
    ]).then(([ls, ds]) => {
      setLines(ls); setDists(ds);
      const p: Record<number, Pick> = {};
      ls.forEach(l => {
        const can = l.INVOICEABLE_FLAG === 'Y' && (l.LINE_TYPE === 'QUANTITY' ? n(l.QUANTITY_BILLABLE) : n(l.AMOUNT_BILLABLE)) > 0;
        p[Number(l.PO_LINE_ID)] = {
          selected: can,
          qty: l.LINE_TYPE === 'QUANTITY' ? n(l.QUANTITY_BILLABLE) : null,
          amount: l.LINE_TYPE === 'QUANTITY' ? null : n(l.AMOUNT_BILLABLE),
          taxCode: l.TAX_CODE ?? null,
        };
      });
      setPicks(p);
    }).catch(e => message.error(e.message.includes('RR_PO_V_INVOICEABLE') ? 'Run database/po/305_po_invoice_match.sql first' : e.message))
      .finally(() => setLoading(false));
  }, [open, hdr, form]);

  const lineAmt = (l: Row) => {
    const p = picks[Number(l.PO_LINE_ID)];
    if (!p?.selected) return 0;
    return l.LINE_TYPE === 'QUANTITY' ? r2(n(p.qty) * n(l.UNIT_PRICE)) : r2(n(p.amount));
  };
  const lineTax = (l: Row) => r2(lineAmt(l) * rateOf(picks[Number(l.PO_LINE_ID)]?.taxCode));
  const chosen = lines.filter(l => picks[Number(l.PO_LINE_ID)]?.selected && lineAmt(l) > 0);
  const subtotal = useMemo(() => r2(chosen.reduce((s, l) => s + lineAmt(l), 0)), [chosen, picks]); // eslint-disable-line react-hooks/exhaustive-deps
  const tax = useMemo(() => r2(chosen.reduce((s, l) => s + lineTax(l), 0)), [chosen, picks]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = r2(subtotal + tax);
  const set = (id: number, p: Partial<Pick>) => setPicks(x => ({ ...x, [id]: { ...x[id], ...p } }));

  const create = async () => {
    const v = await form.validateFields().catch(() => null);
    if (!v) return;
    if (!chosen.length) { message.warning('Select at least one line with something to invoice'); return; }
    for (const l of chosen) {
      const p = picks[Number(l.PO_LINE_ID)];
      const lim = l.LINE_TYPE === 'QUANTITY' ? n(l.QUANTITY_BILLABLE) : n(l.AMOUNT_BILLABLE);
      const val = l.LINE_TYPE === 'QUANTITY' ? n(p.qty) : n(p.amount);
      if (val > lim + 0.000001) { message.error(`Line ${l.LINE_NUM}: at most ${l.LINE_TYPE === 'QUANTITY' ? qty(lim) : money(lim)} can be invoiced`); return; }
    }
    try { localStorage.setItem(LIAB_KEY + hdr.BUSINESS_UNIT_ID, v.liability); } catch { /* ignore */ }
    setBusy(true); setStepErr(null);

    // AP lines: one per PO distribution (AP lines carry their own account)
    const apLines: Record<string, unknown>[] = [];
    let ln = 0;
    chosen.forEach(l => {
      const p = picks[Number(l.PO_LINE_ID)];
      const amt = lineAmt(l);
      const myD = dists.filter(d => Number(d.PO_LINE_ID) === Number(l.PO_LINE_ID));
      const parts: Row[] = myD.length ? myD : [{ INVOICE_ACCOUNT: l.INVOICE_ACCOUNT, PERCENT: 100 }];
      let used = 0; let usedQ = 0;
      parts.forEach((d, i) => {
        const last = i === parts.length - 1;
        const a = last ? r2(amt - used) : r2(amt * n(d.PERCENT) / 100);
        const q = l.LINE_TYPE === 'QUANTITY' ? (last ? r2(n(p.qty) - usedQ) : r2(n(p.qty) * n(d.PERCENT) / 100)) : null;
        used = r2(used + a); usedQ = r2(usedQ + n(q));
        const t = r2(a * rateOf(p.taxCode));
        ln += 1;
        apLines.push({
          LineNumber: ln, LineType: 'Item', LineAmount: a,
          Description: `${hdr.PO_NUMBER}-${l.LINE_NUM} ${l.ITEM_DESCRIPTION}`.slice(0, 240),
          AccountingDate: v.accountingDate, DistributionCombination: d.INVOICE_ACCOUNT,
          ...(p.taxCode ? { TaxClassification: p.taxCode, TaxAmount: t, TaxControlAmount: t } : {}),
          ...(l.LINE_TYPE === 'QUANTITY' ? { Quantity: q, UnitPrice: n(l.UNIT_PRICE), UOM: l.UOM_CODE } : {}),
          PONumber: hdr.PO_NUMBER, POLineNumber: Number(l.LINE_NUM),
          POLineId: Number(l.PO_LINE_ID), ...(d.DISTRIBUTION_ID ? { PODistributionId: Number(d.DISTRIBUTION_ID) } : {}),
        });
      });
    });
    const missing = apLines.find(a => !a.DistributionCombination);
    if (missing) { setBusy(false); message.error(`Line "${missing.Description}" has no account on the PO`); return; }

    const payload = {
      InvoiceNumber: v.invoiceNumber.trim(), InvoiceCurrency: hdr.CURRENCY_CODE, PaymentCurrency: hdr.CURRENCY_CODE,
      InvoiceAmount: total, InvoiceDate: v.invoiceDate, AccountingDate: v.accountingDate,
      BusinessUnit: buName, Supplier: `${hdr.SUPPLIER_NAME}${hdr.SUPPLIER_NUMBER ? ` (${hdr.SUPPLIER_NUMBER})` : ''}`,
      SupplierNumber: hdr.SUPPLIER_NUMBER, SupplierSite: String(hdr.SUPPLIER_SITE_ID),
      InvoiceType: 'Standard', Description: v.description, InvoiceSource: 'MANUAL', PaymentTerms: v.paymentTerms || undefined,
      LiabilityDistribution: v.liability, PayAlone: 'N',
      ...(hdr.CURRENCY_CODE !== fc ? { ConversionRateType: 'User', ConversionDate: v.invoiceDate, ConversionRate: v.rate } : {}),
      CreatedBy: user, LastUpdatedBy: user, lines: apLines,
    };

    let invoiceId: number | null = null;
    try {
      // 1. AP invoice + PO match (one transaction on the server)
      setStep(0);
      const c = await call('POST', `${BASE}/ap/createinvoicefull`, payload, 'AP create invoice + PO match');
      if (!c.res.ok || c.data?.success !== true || !c.data?.invoiceId) throw new Error(c.data?.message || c.data?.error || `HTTP ${c.res.status}`);
      invoiceId = Number(c.data.invoiceId);
      if (!/matched to/i.test(String(c.data.message || ''))) {
        message.warning('The AP invoice was created but the server did not report a PO match — run database/ap/147_ap_create_invoice_po_match.sql', 12);
      }
      // 2. installment (one, full amount)
      setStep(1);
      const due = addDays(v.invoiceDate, termsDays(v.paymentTerms));
      const inst = await call('POST', `${BASE}/ap/createinvoice/installments?P_INVOICE_ID=${invoiceId}`, {
        items: [{ InvoiceId: invoiceId, InstallmentNumber: 1, DueDate: due, GrossAmount: total, UnpaidAmount: total,
          PaymentPriority: 99, CreatedBy: user, LastUpdatedBy: user }],
      }, 'AP installment');
      if (!inst.res.ok) message.warning('Installment not created — open the invoice in Manage Invoices to add it');
      // 3. validation
      setStep(2);
      if (validate) {
        const okChecks = !!v.liability && apLines.every(a => a.DistributionCombination) && (!taxCodes.length || chosen.every(l => picks[Number(l.PO_LINE_ID)].taxCode));
        const status = okChecks && inst.res.ok ? 'Validated' : 'Needs Revalidation';
        await call('PUT', `${BASE}/ap/invoices/${invoiceId}/validation-status`, { VALIDATION_STATUS: status }, 'AP validation');
        await poExec(PROC.setInvoiceStatus, { p_invoice_id: invoiceId, p_invoice_status: status }, user).catch(() => null);
        if (status !== 'Validated') message.warning('Invoice saved but needs revalidation in Manage Invoices (tax code / installment)');
      }
      setStep(3);
      message.success(`AP invoice ${payload.InvoiceNumber} created and matched to ${hdr.PO_NUMBER}`, 6);
      onDone();
      onClose();
    } catch (e: any) {
      setStepErr(e.message);
      // a refused PO match never leaves an AP invoice behind (rolled back on the server)
      message.error(invoiceId ? `${e.message} — AP invoice ${invoiceId} was created and matched; finish it in Manage Invoices` : e.message, 12);
      if (invoiceId) onDone();
    } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onCancel={onClose} width={1180} destroyOnHidden okText={`Create AP invoice · ${money(total)} ${hdr.CURRENCY_CODE}`}
      onOk={create} confirmLoading={busy} okButtonProps={{ disabled: !chosen.length }}
      title={<Space>Create AP invoice from {hdr.PO_NUMBER}<Tag>{hdr.SUPPLIER_NAME}</Tag></Space>}>
      {step >= 0 && (
        <Steps size="small" style={{ marginBottom: 12 }} current={Math.min(step, 2)} status={stepErr ? 'error' : step >= 3 ? 'finish' : 'process'}
          items={[{ title: 'AP invoice + PO match' }, { title: 'Installment' }, { title: 'Validate' }]} />
      )}
      <Form form={form} layout="horizontal" size="small" labelCol={{ flex: '110px' }} labelAlign="left" colon={false}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', columnGap: 14 }}>
          <Form.Item name="invoiceNumber" label="Invoice number" rules={[{ required: true, whitespace: true }]} style={{ marginBottom: 8 }}>
            <Input placeholder="Supplier's invoice no." maxLength={50} />
          </Form.Item>
          <Form.Item name="invoiceDate" label="Invoice date" rules={[{ required: true }]} style={{ marginBottom: 8 }}><Input type="date" /></Form.Item>
          <Form.Item name="accountingDate" label="GL date" rules={[{ required: true }]} style={{ marginBottom: 8 }}><Input type="date" /></Form.Item>
          <Form.Item name="liability" label="Liability acct" rules={[{ required: true, message: 'AP liability account is required' }]} style={{ marginBottom: 8, gridColumn: 'span 2' }}>
            <AccountInput company={company} />
          </Form.Item>
          <Form.Item name="paymentTerms" label="Payment terms" style={{ marginBottom: 8 }}><Input /></Form.Item>
          <Form.Item name="description" label="Description" style={{ marginBottom: 8, gridColumn: 'span 2' }}><Input maxLength={240} /></Form.Item>
          {hdr.CURRENCY_CODE !== fc
            ? <Form.Item name="rate" label={`Rate → ${fc}`} rules={[{ required: true }]} style={{ marginBottom: 8 }}><InputNumber min={0} style={{ width: '100%' }} /></Form.Item>
            : <div />}
        </div>
      </Form>
      <Table size="small" rowKey="PO_LINE_ID" loading={loading} dataSource={lines} pagination={false} scroll={{ x: 1100, y: 340 }}
        columns={[
          { title: '', width: 36, render: (_, l) => (
            <Checkbox checked={!!picks[Number(l.PO_LINE_ID)]?.selected}
              disabled={l.INVOICEABLE_FLAG !== 'Y' || (l.LINE_TYPE === 'QUANTITY' ? n(l.QUANTITY_BILLABLE) : n(l.AMOUNT_BILLABLE)) <= 0}
              onChange={e => set(Number(l.PO_LINE_ID), { selected: e.target.checked })} />) },
          { title: '#', dataIndex: 'LINE_NUM', width: 40 },
          { title: 'Description', dataIndex: 'ITEM_DESCRIPTION', ellipsis: true },
          { title: 'Ordered', width: 100, align: 'right', render: (_, l) => l.LINE_TYPE === 'QUANTITY' ? `${qty(l.QUANTITY_ORDERED)} ${l.UOM_CODE || ''}` : money(l.AMOUNT_ORDERED) },
          { title: 'Received', width: 90, align: 'right', render: (_, l) => l.LINE_TYPE === 'QUANTITY' ? qty(l.QUANTITY_RECEIVED) : money(l.AMOUNT_RECEIVED) },
          { title: 'Billed', width: 90, align: 'right', render: (_, l) => l.LINE_TYPE === 'QUANTITY' ? qty(l.QUANTITY_BILLED) : money(l.AMOUNT_BILLED) },
          { title: 'Can invoice', width: 110, align: 'right', render: (_, l) => {
            const v = l.LINE_TYPE === 'QUANTITY' ? n(l.QUANTITY_BILLABLE) : n(l.AMOUNT_BILLABLE);
            return l.INVOICEABLE_FLAG !== 'Y' || v <= 0
              ? <Tag color={n(l.AMOUNT_BILLED) > 0 ? 'green' : 'default'}>{n(l.AMOUNT_BILLED) > 0 ? 'Invoiced' : l.MATCH_LEVEL === 'THREE_WAY' ? 'Receive first' : 'Closed'}</Tag>
              : <Text strong>{l.LINE_TYPE === 'QUANTITY' ? qty(v) : money(v)}</Text>;
          } },
          { title: 'Invoice now', width: 120, render: (_, l) => {
            const p = picks[Number(l.PO_LINE_ID)];
            if (!p?.selected) return null;
            return l.LINE_TYPE === 'QUANTITY'
              ? <InputNumber size="small" min={0} max={n(l.QUANTITY_BILLABLE)} value={p.qty ?? undefined} style={{ width: '100%' }}
                  onChange={v => set(Number(l.PO_LINE_ID), { qty: v as number })} />
              : <InputNumber size="small" min={0} max={n(l.AMOUNT_BILLABLE)} value={p.amount ?? undefined} style={{ width: '100%' }}
                  onChange={v => set(Number(l.PO_LINE_ID), { amount: v as number })} />;
          } },
          { title: 'Amount', width: 110, align: 'right', render: (_, l) => money(lineAmt(l)) },
          { title: 'Tax', width: 130, render: (_, l) => picks[Number(l.PO_LINE_ID)]?.selected ? (
            <Select size="small" allowClear style={{ width: '100%' }} value={picks[Number(l.PO_LINE_ID)]?.taxCode ?? undefined}
              onChange={v => set(Number(l.PO_LINE_ID), { taxCode: v ?? null })}
              options={taxCodes.map(t => ({ value: t.TAX_CODE, label: `${t.TAX_CODE}${t.TAX_RATE != null ? ` ${t.TAX_RATE}%` : ''}` }))} />) : null },
          { title: 'Tax amt', width: 90, align: 'right', render: (_, l) => money(lineTax(l)) },
          { title: 'Debit account', width: 230, ellipsis: true, render: (_, l) => (
            <span>{n(l.DIST_COUNT) > 1 ? <Tag>{l.DIST_COUNT} accounts</Tag> : <Text style={{ fontSize: 12 }}>{l.INVOICE_ACCOUNT}</Text>}
              {l.ACCRUE_AT_RECEIPT_FLAG === 'Y' && <Tag color="blue" style={{ marginLeft: 4 }}>GRNI</Tag>}</span>) },
        ]} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, flexWrap: 'wrap', gap: 8 }}>
        <Checkbox checked={validate} onChange={e => setValidate(e.target.checked)}>Validate the invoice after creating it</Checkbox>
        <Space size={18}>
          <Text type="secondary">Lines {chosen.length}</Text>
          <Text>Subtotal <b>{money(subtotal)}</b></Text>
          <Text>Tax <b>{money(tax)}</b></Text>
          <Text>Total <b>{money(total)} {hdr.CURRENCY_CODE}</b></Text>
        </Space>
      </div>
      <Alert type="info" showIcon style={{ marginTop: 10 }}
        message="Partial invoicing is allowed per line. Fully invoiced lines close for invoicing and cannot be invoiced again; cancelling the AP invoice reopens them." />
      {stepErr && <Alert type="error" showIcon style={{ marginTop: 8 }} message={stepErr} />}
      <Text type="secondary" style={{ fontSize: 11 }}>Due date = invoice date + payment terms days · invoice date {day(form.getFieldValue('invoiceDate'))}</Text>
    </Modal>
  );
};

export default PoApInvoice;
