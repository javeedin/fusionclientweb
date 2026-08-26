// ── POS Sales Order ──────────────────────────────────────────────────────────
// Point-of-sale mode for the Sales Orders page. Opened from the "POS Order"
// button after the customer is set in Register New Order. Customer details are
// hidden behind the customer icon; the barcode input owns the keyboard — a
// scan (barcode = item code, terminated by Enter) adds a line with qty 1, or
// bumps qty when the item is already on the ticket.
import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  Button, Input, InputNumber, Select, Tag, Typography, Tooltip, Popover,
  Modal, Empty, message, Spin, Checkbox,
} from 'antd';
import {
  BarcodeOutlined, UserOutlined, DeleteOutlined, PlusOutlined, MinusOutlined,
  ApiOutlined, CheckCircleFilled, ShoppingCartOutlined, EditOutlined,
  ClearOutlined, CopyOutlined, PrinterOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { getCurrentCompany } from '../../config/company.config';
import { getFusionAuthHeaders, buildApexUrl } from '../../config/api.helper';
import type { OrderHeader, NewLine } from './SalesOrders';

const { Text } = Typography;

const POS = {
  primary: '#C74634', dark: '#1A1A1A', panel: '#232323', success: '#1D7B4D',
  warning: '#D4A800', info: '#0572CE', error: '#D93025',
  n100: '#F7F7F7', n200: '#E5E5E5', n600: '#6B6B6B', n900: '#1A1A1A', surface: '#FFFFFF',
};

const getFusionBase = () => {
  const company = getCurrentCompany();
  return company.fusionBaseUrl ? `${company.fusionBaseUrl}/fscmRestApi/resources/11.13.18.05` : '';
};
const getFusionHost = () => getCurrentCompany().fusionBaseUrl || '';
const getHeaders = () => getFusionAuthHeaders();

const _isElectron = !!(window as unknown as { electron?: unknown }).electron
  || !!(window as unknown as { electronAPI?: unknown }).electronAPI;
const ORDS_AR = _isElectron ? buildApexUrl('test/FUSIONCLIENTERP/ar') : '/ords-mitsu/ar';

const num = (v: any) => { const n = Number(v); return isNaN(n) ? 0 : n; };
const pf = (r: any, keys: string[]) => { for (const k of keys) { const v = r?.[k]; if (v != null && v !== '') return v; } return undefined; };
const round2 = (v: number) => Math.round((num(v) + Number.EPSILON) * 100) / 100;
const fmt2 = (v: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
const COST_FIELDS = ['TotalUnitCost', 'UnitCost', 'ItemCost', 'UnitAverageCost', 'AverageUnitCost'];
const parseVU = (vu?: string) => { const p = String(vu ?? '').split('-'); return { costOrg: p[0], invOrg: p[1] }; };
const rowOrgMatches = (row: any, org?: string) => { if (!org) return true; const p = parseVU(row.ValuationUnit); return p.invOrg === org || p.costOrg === org; };

// Short audio feedback — classic POS beep on scan, low buzz on error.
const beep = (ok: boolean) => {
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator(); const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = ok ? 1200 : 180;
    gain.gain.value = 0.06;
    osc.start();
    osc.stop(ctx.currentTime + (ok ? 0.09 : 0.28));
    osc.onended = () => ctx.close();
  } catch { /* audio unavailable */ }
};

interface TaxOpt { code: string; pct: number }

interface PosSalesOrderProps {
  header: OrderHeader;
  onOpenDraft?: (draft: { header: OrderHeader; lines: NewLine[] }) => void;
}

const PosSalesOrder: React.FC<PosSalesOrderProps> = ({ header, onOpenDraft }) => {
  const FUSION_BASE = getFusionBase();
  const LATEST_URL = `${getFusionHost()}/fscmRestApi/resources/latest`;
  const SO_CREATE_URL = `${FUSION_BASE}/salesOrdersForOrderHub`;

  const [lines, setLines] = useState<NewLine[]>([]);
  const [scan, setScan] = useState('');
  const [scanning, setScanning] = useState(false);
  const [lastKey, setLastKey] = useState<string>('');
  const [posting, setPosting] = useState(false);
  const [autoSubmit, setAutoSubmit] = useState(false);
  const [taxOpts, setTaxOpts] = useState<TaxOpt[]>([]);
  const [taxCode, setTaxCode] = useState<string | undefined>();
  const [saleDone, setSaleDone] = useState<{ orderNumber: string; total: number; count: number } | null>(null);
  const [orderSeq, setOrderSeq] = useState(() => Math.floor(Date.now() / 1000) % 100000);
  const inputRef = useRef<any>(null);
  const itemCache = useRef<Record<string, { description: string; uom?: string; price: number } | null>>({});

  const taxPct = taxOpts.find(t => t.code === taxCode)?.pct ?? 0;
  const orderNumber = useMemo(() => `${header.orderType || 'SO'}${dayjs(header.orderDate ?? undefined).format('YYYYMM')}${orderSeq}`, [header.orderType, header.orderDate, orderSeq]);
  const ccy = header.txnCurrency || 'AED';

  const focusScan = useCallback(() => { setTimeout(() => inputRef.current?.focus?.(), 60); }, []);
  useEffect(() => { focusScan(); }, [focusScan]);

  // Tax codes for the BU (same ORDS source the order editor uses).
  useEffect(() => {
    if (!header.businessUnit) return;
    const qs = new URLSearchParams({ P_BUSINESS_UNIT: header.businessUnit, business_unit: header.businessUnit }).toString();
    fetch(`${ORDS_AR}/taxcodes?${qs}`, { headers: { Accept: 'application/json' } })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => {
        const items = d.items ?? (Array.isArray(d) ? d : []);
        const seen = new Set<string>(); const list: TaxOpt[] = [];
        items.forEach((x: any) => {
          const code = String(pf(x, ['tax_code', 'TAX_CODE', 'code', 'name']) ?? '').trim();
          if (code && !seen.has(code)) { seen.add(code); list.push({ code, pct: num(pf(x, ['tax_code_per', 'TAX_CODE_PER', 'rate', 'pct', 'percentage'])) }); }
        });
        setTaxOpts(list);
      })
      .catch(() => setTaxOpts([]));
  }, [header.businessUnit]);

  // Item master + price lookup (cached per code). Barcode = ItemNumber for now.
  const lookupItem = async (code: string): Promise<{ description: string; uom?: string; price: number } | null> => {
    if (code in itemCache.current) return itemCache.current[code];
    let description = ''; let uom: string | undefined; let price = 0; let found = false;
    try {
      const r = await fetch(`${FUSION_BASE}/itemsV2?q=${encodeURIComponent(`ItemNumber='${code}'`)}&onlyData=true&limit=2`, { headers: getHeaders() });
      if (r.ok) {
        const d = await r.json();
        const it = (d.items ?? [])[0];
        if (it) { found = true; description = it.ItemDescription ?? ''; uom = it.PrimaryUOMCode ?? it.PrimaryUOMValue ?? undefined; }
      }
    } catch { /* offline item master — still try costs */ }
    try {
      const r = await fetch(`${LATEST_URL}/itemCosts?q=${encodeURIComponent(`ItemNumber=${code}`)}&onlyData=true&limit=100`, { headers: getHeaders() });
      if (r.ok) {
        const d = await r.json();
        const rows = ((d.items ?? []) as any[]).filter(x => rowOrgMatches(x, header.warehouse));
        const row = rows[0] ?? (d.items ?? [])[0];
        if (row) { found = true; price = num(pf(row, COST_FIELDS)); }
      }
    } catch { /* no cost — price stays 0, editable on the ticket */ }
    const res = found ? { description, uom, price } : null;
    itemCache.current[code] = res;
    return res;
  };

  const applyTax = (l: NewLine, pct: number): NewLine =>
    ({ ...l, taxPct: pct, taxAmount: round2(l.qty * l.unitPrice * pct / 100) });

  // Re-derive tax on all lines when the tax code changes.
  useEffect(() => { setLines(prev => prev.map(l => applyTax(l, taxPct))); }, [taxPct]); // eslint-disable-line react-hooks/exhaustive-deps

  const setQty = (key: string, qty: number) => {
    if (qty <= 0) { setLines(prev => prev.filter(l => l.key !== key)); return; }
    setLines(prev => prev.map(l => l.key === key ? applyTax({ ...l, qty }, taxPct) : l));
  };
  const setPrice = (key: string, unitPrice: number) =>
    setLines(prev => prev.map(l => l.key === key ? applyTax({ ...l, unitPrice }, taxPct) : l));

  const onScan = async () => {
    const code = scan.trim();
    setScan('');
    if (!code) return;
    const existing = lines.find(l => l.itemNumber.toLowerCase() === code.toLowerCase());
    if (existing) {
      setQty(existing.key, existing.qty + 1);
      setLastKey(existing.key);
      beep(true);
      focusScan();
      return;
    }
    setScanning(true);
    try {
      const it = await lookupItem(code);
      if (!it) {
        beep(false);
        message.error({ content: `Item "${code}" not found in the item master`, key: 'pos-scan' });
        return;
      }
      const key = `pos-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setLines(prev => [...prev, applyTax({ key, itemNumber: code, description: it.description, uom: it.uom, qty: 1, unitPrice: it.price }, taxPct)]);
      setLastKey(key);
      beep(true);
      if (!it.price) message.warning({ content: `No cost found for ${code} — set the price on the ticket`, key: 'pos-scan' });
    } finally {
      setScanning(false);
      focusScan();
    }
  };

  const units = lines.reduce((s, l) => s + l.qty, 0);
  const subtotal = round2(lines.reduce((s, l) => s + l.qty * l.unitPrice, 0));
  const taxTotal = round2(lines.reduce((s, l) => s + num(l.taxAmount), 0));
  const grandTotal = round2(subtotal + taxTotal);

  // Minimal salesOrdersForOrderHub payload — same shape the order editor sends
  // (header + billTo/shipTo + per-line QP_SALE_PRICE charge components).
  const buildPayload = () => {
    const dateIso = dayjs(header.orderDate ?? undefined).format('YYYY-MM-DD[T]00:00:00[Z]');
    const numOrStr = (v: any) => { const n = Number(v); return v != null && v !== '' && !Number.isNaN(n) ? n : v; };
    const invFlag = (header as any).inventoryTransactionFlag ?? false;
    return {
      SourceTransactionNumber: orderNumber,
      SourceTransactionSystem: 'OPS',
      SourceTransactionId: `APEX:${orderSeq}`,
      TransactionalCurrencyCode: ccy,
      ...(header.rate != null ? {
        CurrencyConversionRate: Number(header.rate),
        CurrencyConversionType: header.currencyRateType || 'User',
        CurrencyConversionDate: dateIso,
      } : {}),
      ...(header.businessUnitId != null ? { BusinessUnitId: numOrStr(header.businessUnitId), RequestingBusinessUnitId: numOrStr(header.businessUnitId) } : {}),
      ...(header.accountNumber ? { BuyingPartyNumber: header.accountNumber } : {}),
      RequestedShipDate: dateIso,
      TransactionOn: dateIso,
      ...(header.orderType ? { TransactionTypeCode: header.orderType, TransactionType: header.orderType } : {}),
      SubmittedFlag: autoSubmit ? 'true' : 'false',
      FreezePriceFlag: 'true',
      FreezeShippingChargeFlag: 'true',
      FreezeTaxFlag: 'true',
      ...(header.paymentTerms ? { PaymentTerms: header.paymentTerms } : {}),
      ...(header.warehouse ? { RequestedFulfillmentOrganizationCode: header.warehouse } : {}),
      CustomerPONumber: orderNumber,
      billToCustomer: [{
        ...(header.custAccountId != null ? { CustomerAccountId: numOrStr(header.custAccountId) } : {}),
        ...(header.billToSite != null ? { SiteUseId: numOrStr(header.billToSite) } : {}),
      }],
      shipToCustomer: [{
        ...(header.partyId != null ? { PartyId: String(header.partyId) } : {}),
        ...(header.shipToSite != null ? { SiteId: numOrStr(header.shipToSite) } : {}),
      }],
      lines: lines.map((l, i) => {
        const qty = num(l.qty), price = num(l.unitPrice), tax = num(l.taxAmount);
        const ext = round2(price * qty), taxUnit = qty ? round2(tax / qty) : 0;
        const lineId = String(orderSeq * 100 + (i + 1));
        return {
          SourceTransactionLineId: lineId,
          SourceTransactionLineNumber: i + 1,
          SourceTransactionScheduleId: lineId,
          SourceScheduleNumber: lineId,
          ...(l.uom ? { OrderedUOMCode: l.uom } : {}),
          OrderedQuantity: qty,
          ProductNumber: l.itemNumber,
          ...(header.subinventory ? { SubinventoryCode: header.subinventory } : {}),
          ...(header.paymentTerms ? { PaymentTerms: header.paymentTerms } : {}),
          InventoryTransactionFlag: invFlag,
          TransactionCategoryCode: 'ORDER',
          charges: [{
            SourceChargeId: `C${i + 1}`,
            ApplyTo: 'Price', PricedQuantity: qty, GSAUnitPrice: price,
            PriceType: 'One time', ChargeType: 'Sale', ChargeSubType: 'Price',
            ChargeCurrencyCode: ccy, SequenceNumber: 1,
            ChargeDefinitionCode: 'QP_SALE_PRICE', PrimaryFlag: 'true', RollupFlag: 'false',
            chargeComponents: [
              { SourceChargeComponentId: `C${i + 1}-CC1`, PriceElementCode: 'QP_LIST_PRICE', PriceElementUsageCode: 'LIST_PRICE', HeaderCurrencyUnitPrice: price, HeaderCurrencyExtendedAmount: ext, RollupFlag: 'false', SequenceNumber: 1 },
              { SourceChargeComponentId: `C${i + 1}-CC2`, PriceElementCode: 'QP_NET_PRICE', PriceElementUsageCode: 'NET_PRICE', HeaderCurrencyUnitPrice: price, HeaderCurrencyExtendedAmount: ext, RollupFlag: 'false', SequenceNumber: 2 },
              { SourceChargeComponentId: `C${i + 1}-CC3`, PriceElementCode: 'QP_EXCLUSIVE_TAX', PriceElementUsageCode: 'EXCLUSIVE_TAX', HeaderCurrencyUnitPrice: taxUnit, HeaderCurrencyExtendedAmount: tax, RollupFlag: 'false', SequenceNumber: 3 },
              { SourceChargeComponentId: `C${i + 1}-CC4`, PriceElementCode: 'QP_NET_PRICE_PLUS_TAX', PriceElementUsageCode: 'NET_PRICE_PLUS_TAX', HeaderCurrencyUnitPrice: round2(price + taxUnit), HeaderCurrencyExtendedAmount: round2(ext + tax), RollupFlag: 'false', SequenceNumber: 4 },
            ],
          }],
        };
      }),
    };
  };

  const completeSale = async () => {
    if (!lines.length) { message.warning('Scan at least one item'); return; }
    setPosting(true);
    try {
      const body = JSON.stringify(buildPayload());
      const r = await fetch(SO_CREATE_URL, { method: 'POST', headers: { ...getHeaders(), 'Content-Type': 'application/json' }, body });
      const text = await r.text();
      let data: any = {}; try { data = JSON.parse(text); } catch { /* keep raw */ }
      if (!r.ok) {
        const msg = data['o:errorDetails']?.map((e: any) => e.detail).join('\n')
          ?? data.detail ?? data.title ?? text.slice(0, 400) ?? `HTTP ${r.status}`;
        throw new Error(msg);
      }
      const createdNo = String(data.OrderNumber ?? data.SourceTransactionNumber ?? orderNumber);
      beep(true);
      setSaleDone({ orderNumber: createdNo, total: grandTotal, count: lines.length });
    } catch (e: any) {
      beep(false);
      Modal.error({ title: 'Sale failed', content: <div style={{ whiteSpace: 'pre-wrap', maxHeight: 300, overflow: 'auto' }}>{e?.message || String(e)}</div>, width: 560 });
    } finally {
      setPosting(false);
    }
  };

  const newSale = () => {
    setLines([]);
    setSaleDone(null);
    setOrderSeq(Math.floor(Date.now() / 1000) % 100000);
    focusScan();
  };

  const customerContent = (
    <div style={{ maxWidth: 340 }}>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>{header.customerName || '—'}</div>
      <div style={{ color: POS.n600, fontSize: 12, marginBottom: 8 }}>Account # {header.accountNumber || '—'}</div>
      {[['Business Unit', header.businessUnit], ['Warehouse', header.warehouse], ['Subinventory', header.subinventory],
        ['Payment Terms', header.paymentTerms], ['Salesperson', header.salesRep],
        ['Bill To', header.billToAddress], ['Ship To', header.shipToAddress]]
        .filter(([, v]) => v)
        .map(([k, v]) => (
          <div key={k as string} style={{ display: 'flex', gap: 8, fontSize: 12, padding: '3px 0', borderBottom: `1px dashed ${POS.n200}` }}>
            <span style={{ color: POS.n600, minWidth: 92 }}>{k}</span>
            <span style={{ fontWeight: 500 }}>{v}</span>
          </div>
        ))}
    </div>
  );

  const payloadPreview = useMemo(() => JSON.stringify(buildPayload(), null, 2), [lines, header, orderSeq, autoSubmit, taxPct]); // eslint-disable-line react-hooks/exhaustive-deps

  const apiContent = (
    <div style={{ maxWidth: 560 }}>
      <div style={{ fontFamily: 'monospace', fontSize: 11, background: POS.n100, padding: 8, borderRadius: 4, wordBreak: 'break-all' }}>
        <Tag color="green" style={{ marginRight: 6 }}>POST</Tag>{SO_CREATE_URL}
      </div>
      <pre style={{ fontFamily: 'monospace', fontSize: 10.5, background: POS.n100, padding: 8, borderRadius: 4, margin: '6px 0', maxHeight: 320, overflow: 'auto' }}>{payloadPreview}</pre>
      <Button size="small" icon={<CopyOutlined />} onClick={() => { navigator.clipboard.writeText(`POST ${SO_CREATE_URL}\n${payloadPreview}`); message.success('Copied'); }}>Copy</Button>
    </div>
  );

  return (
    <div style={{ display: 'flex', gap: 14, minHeight: 'calc(100vh - 210px)', alignItems: 'stretch' }} onClick={focusScan}>
      <style>{`
        @keyframes posFlash { 0% { background: #FFF6D6; } 100% { background: transparent; } }
        .pos-line-flash { animation: posFlash 1.1s ease-out; }
        .pos-scan-input input { font-size: 20px !important; letter-spacing: 1px; font-family: monospace; }
        .pos-lines::-webkit-scrollbar { width: 8px; } .pos-lines::-webkit-scrollbar-thumb { background: ${POS.n200}; border-radius: 4px; }
      `}</style>

      {/* ── Left: scan + ticket lines ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Scan bar */}
        <div style={{ background: POS.dark, borderRadius: 12, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.18)' }}>
          <span style={{ width: 44, height: 44, borderRadius: 10, background: POS.primary, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, flexShrink: 0 }}>
            <BarcodeOutlined />
          </span>
          <Input
            ref={inputRef}
            className="pos-scan-input"
            size="large"
            placeholder="Scan barcode / type item code and press Enter…"
            value={scan}
            onChange={e => setScan(e.target.value)}
            onPressEnter={onScan}
            disabled={!!saleDone}
            suffix={scanning ? <Spin size="small" /> : <span style={{ color: POS.n600, fontSize: 11 }}>ENTER ↵</span>}
            style={{ height: 52, borderRadius: 10 }}
            onClick={e => e.stopPropagation()}
          />
          <div style={{ color: '#fff', textAlign: 'right', flexShrink: 0, lineHeight: 1.3 }}>
            <div style={{ fontSize: 11, opacity: 0.65 }}>ORDER</div>
            <div style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 700 }}>{orderNumber}</div>
          </div>
        </div>

        {/* Ticket lines */}
        <div className="pos-lines" style={{ flex: 1, marginTop: 12, background: POS.surface, border: `1px solid ${POS.n200}`, borderRadius: 12, overflow: 'auto' }}>
          {lines.length === 0 ? (
            <div style={{ padding: '70px 20px', textAlign: 'center' }}>
              <BarcodeOutlined style={{ fontSize: 64, color: POS.n200 }} />
              <div style={{ marginTop: 14, fontSize: 16, fontWeight: 600, color: POS.n600 }}>Ready to scan</div>
              <div style={{ fontSize: 12.5, color: POS.n600, marginTop: 4 }}>Scan a barcode (item code) — each scan adds the item with qty 1.<br />Scanning the same item again increases the quantity.</div>
            </div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '34px 1.5fr 2fr 110px 132px 120px 36px', gap: 8, padding: '9px 14px', borderBottom: `2px solid ${POS.n200}`, fontSize: 11, fontWeight: 700, color: POS.n600, textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, background: POS.surface, zIndex: 1 }}>
                <span>#</span><span>Item</span><span>Description</span><span style={{ textAlign: 'right' }}>Price</span><span style={{ textAlign: 'center' }}>Qty</span><span style={{ textAlign: 'right' }}>Total</span><span />
              </div>
              {lines.map((l, i) => (
                <div key={l.key} className={l.key === lastKey ? 'pos-line-flash' : undefined}
                  style={{ display: 'grid', gridTemplateColumns: '34px 1.5fr 2fr 110px 132px 120px 36px', gap: 8, alignItems: 'center', padding: '8px 14px', borderBottom: `1px solid ${POS.n100}` }}>
                  <span style={{ color: POS.n600, fontSize: 12 }}>{i + 1}</span>
                  <span style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.itemNumber}</span>
                  <span style={{ fontSize: 12.5, color: POS.n900, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={l.description}>{l.description || '—'}{l.uom ? <Tag style={{ marginLeft: 6, fontSize: 10 }}>{l.uom}</Tag> : null}</span>
                  <span style={{ textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                    <InputNumber size="small" min={0} value={l.unitPrice} onChange={v => setPrice(l.key, num(v))}
                      style={{ width: 100 }} controls={false} />
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }} onClick={e => e.stopPropagation()}>
                    <Button size="small" icon={<MinusOutlined />} onClick={() => setQty(l.key, l.qty - 1)} style={{ width: 26 }} />
                    <InputNumber size="small" min={1} value={l.qty} onChange={v => setQty(l.key, Math.max(1, num(v)))} style={{ width: 52 }} controls={false} />
                    <Button size="small" icon={<PlusOutlined />} onClick={() => setQty(l.key, l.qty + 1)} style={{ width: 26 }} />
                  </span>
                  <span style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmt2(l.qty * l.unitPrice)}</span>
                  <span onClick={e => e.stopPropagation()}>
                    <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => setLines(prev => prev.filter(x => x.key !== l.key))} />
                  </span>
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      {/* ── Right: totals + actions ── */}
      <div style={{ width: 330, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 12 }} onClick={e => e.stopPropagation()}>
        <div style={{ background: POS.dark, borderRadius: 12, padding: '14px 16px', color: '#fff', boxShadow: '0 2px 8px rgba(0,0,0,0.18)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <ShoppingCartOutlined style={{ fontSize: 18, color: POS.primary }} />
              <span style={{ fontWeight: 800, fontSize: 15, letterSpacing: '0.08em' }}>POS SALE</span>
            </div>
            <Popover content={customerContent} title="Customer" trigger="click" placement="bottomRight">
              <Tooltip title="Customer details">
                <Button shape="circle" icon={<UserOutlined />} style={{ background: '#333', borderColor: '#444', color: '#fff' }} />
              </Tooltip>
            </Popover>
          </div>
          <div style={{ fontSize: 11.5, opacity: 0.6 }}>{dayjs().format('ddd, D MMM YYYY')} · {header.businessUnit || '—'}</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            {header.warehouse && <Tag color="volcano" style={{ margin: 0 }}>{header.warehouse}</Tag>}
            {header.subinventory && <Tag style={{ margin: 0, background: '#333', color: '#ddd', borderColor: '#444' }}>{header.subinventory}</Tag>}
            <Tag style={{ margin: 0, background: '#333', color: '#ddd', borderColor: '#444' }}>{ccy}</Tag>
          </div>
        </div>

        <div style={{ background: POS.surface, border: `1px solid ${POS.n200}`, borderRadius: 12, padding: '14px 16px', flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0', color: POS.n600 }}>
            <span>Items</span><span style={{ fontWeight: 700, color: POS.n900 }}>{lines.length}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0', color: POS.n600, borderBottom: `1px dashed ${POS.n200}` }}>
            <span>Units</span><span style={{ fontWeight: 700, color: POS.n900 }}>{units}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '7px 0 4px', color: POS.n600 }}>
            <span>Subtotal</span><span style={{ fontWeight: 700, color: POS.n900, fontVariantNumeric: 'tabular-nums' }}>{fmt2(subtotal)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, padding: '4px 0', color: POS.n600, borderBottom: `1px dashed ${POS.n200}` }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              Tax
              <Select size="small" allowClear placeholder="None" value={taxCode} onChange={setTaxCode}
                options={taxOpts.map(t => ({ value: t.code, label: `${t.code} (${t.pct}%)` }))}
                style={{ minWidth: 110 }} popupMatchSelectWidth={false} />
            </span>
            <span style={{ fontWeight: 700, color: POS.n900, fontVariantNumeric: 'tabular-nums' }}>{fmt2(taxTotal)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '14px 0 6px' }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: POS.n600, letterSpacing: '0.06em' }}>TOTAL</span>
            <span style={{ fontSize: 30, fontWeight: 900, color: POS.primary, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: POS.n600, marginRight: 5 }}>{ccy}</span>{fmt2(grandTotal)}
            </span>
          </div>

          <div style={{ marginTop: 'auto' }}>
            <Checkbox checked={autoSubmit} onChange={e => setAutoSubmit(e.target.checked)} style={{ fontSize: 12, marginBottom: 8 }}>
              Submit order on completion <Tooltip title="Unchecked: the order is created as DRAFT (same as the order editor) and can be confirmed later. Checked: SubmittedFlag=true — Fusion submits it straight into fulfillment."><Text type="secondary" style={{ fontSize: 11 }}>(?)</Text></Tooltip>
            </Checkbox>
            <Button type="primary" block size="large" loading={posting} disabled={!lines.length}
              onClick={completeSale}
              style={{ height: 54, fontSize: 17, fontWeight: 800, background: POS.success, borderColor: POS.success, borderRadius: 10 }}>
              COMPLETE SALE
            </Button>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              {onOpenDraft && (
                <Button block icon={<EditOutlined />} disabled={!lines.length}
                  onClick={() => onOpenDraft({ header, lines })}>
                  Order Editor
                </Button>
              )}
              <Button block icon={<ClearOutlined />} danger disabled={!lines.length}
                onClick={() => Modal.confirm({ title: 'Clear this sale?', content: 'All scanned lines will be removed.', okText: 'Clear', okButtonProps: { danger: true }, onOk: () => { setLines([]); focusScan(); } })}>
                Clear
              </Button>
              <Popover content={apiContent} title="Create Order API" trigger="click" placement="topRight">
                <Button icon={<ApiOutlined />} />
              </Popover>
            </div>
          </div>
        </div>
      </div>

      {/* ── Sale complete ── */}
      <Modal open={!!saleDone} footer={null} closable={false} centered width={420}>
        <div style={{ textAlign: 'center', padding: '18px 6px 8px' }}>
          <CheckCircleFilled style={{ fontSize: 64, color: POS.success }} />
          <div style={{ fontSize: 20, fontWeight: 800, marginTop: 14 }}>Sale Complete</div>
          <div style={{ fontFamily: 'monospace', fontSize: 15, marginTop: 6, color: POS.info }}>{saleDone?.orderNumber}</div>
          <div style={{ fontSize: 13, color: POS.n600, marginTop: 4 }}>{saleDone?.count} item(s) · {ccy} {fmt2(saleDone?.total ?? 0)} · {autoSubmit ? 'Submitted' : 'Draft — confirm in the order editor'}</div>
          <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
            <Button block icon={<PrinterOutlined />} onClick={() => window.print()}>Print</Button>
            <Button block type="primary" size="large" onClick={newSale}
              style={{ background: POS.primary, borderColor: POS.primary, fontWeight: 700 }}>
              New Sale
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default PosSalesOrder;
