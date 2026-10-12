// Purchasing-RR — Report Branding: the logo and company details printed at the top of documents, per business
// unit and document type (Purchasing, Payables, Receivables …). Purchase orders use it today; other modules
// read the same setup through resolveReportBranding(bu, 'AP' | 'AR' | …).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Avatar, Button, Card, Checkbox, Col, ColorPicker, Drawer, Empty, Input, Popconfirm, Row as ARow, Segmented, Select,
  Space, Spin, Switch, Table, Tag, Tooltip, Typography, Upload, message,
} from 'antd';
import {
  CopyOutlined, DeleteOutlined, EditOutlined, FilePdfOutlined, InboxOutlined, PictureOutlined, PlusOutlined, ReloadOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type jsPDF from 'jspdf';
import PdfPreviewModal from '../../components/PdfPreviewModal';
import { PoBar, PO_RED, useBusinessUnits, usePoUser } from './poShared';
import { buildPoPdf } from './poPdf';
import type { Row } from '../../services/po.service';
import {
  BRANDING_DOCS, BRANDING_SCRIPT, DEFAULT_ACCENT, brandingNotInstalled, conflicts, coverage, deleteBranding, docLabel, listBrandings,
  loadLogo, prepareLogo, saveBranding, type Branding, type HeaderStyle, type PreparedLogo, type ReportBrand,
} from '../../services/reportBranding.service';

const { Text, Title } = Typography;

const initials = (s: string) => s.split(/[\s_]+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
const kb = (b: number | null | undefined) => (b ? `${Math.max(1, Math.round(b / 1024))} KB` : '');
const CHECKER = 'repeating-conic-gradient(#f0f0f0 0% 25%, #fff 0% 50%) 50% / 14px 14px';

// ── editor draft ────────────────────────────────────────────────────────────
interface LogoState {
  action: 'KEEP' | 'REPLACE' | 'REMOVE';
  dataUrl: string | null;
  prepared?: PreparedLogo;
  file?: File;
  fileName?: string | null;
  width?: number | null; height?: number | null; bytes?: number | null; mime?: string | null;
}
interface Draft {
  brandingId: number | null;
  businessUnitId: number | null;
  appliesTo: string[];
  displayName: string;
  headerStyle: HeaderStyle;
  address: string; taxRegistration: string; phone: string; email: string; website: string;
  accentColor: string | null;
  active: boolean;
  logo: LogoState;
  trim: boolean;
  palette: string[];
}
const emptyDraft = (p: Partial<Draft> = {}): Draft => ({
  brandingId: null, businessUnitId: null, appliesTo: ['ALL'], displayName: '', headerStyle: 'LOGO_AND_NAME',
  address: '', taxRegistration: '', phone: '', email: '', website: '', accentColor: null, active: true,
  logo: { action: 'KEEP', dataUrl: null }, trim: true, palette: [], ...p,
});
const draftOf = (b: Branding, logo: string | null): Draft => emptyDraft({
  brandingId: b.brandingId, businessUnitId: b.businessUnitId, appliesTo: b.appliesTo, displayName: b.displayName,
  headerStyle: b.headerStyle, address: b.address, taxRegistration: b.taxRegistration, phone: b.phone, email: b.email,
  website: b.website, accentColor: b.accentColor, active: b.status === 'ACTIVE',
  logo: { action: 'KEEP', dataUrl: logo, fileName: b.logoFileName, width: b.logoWidth, height: b.logoHeight, bytes: b.logoBytes, mime: b.logoMime },
});
const brandOf = (d: Draft, buName: string): ReportBrand => ({
  brandingId: d.brandingId, businessUnitId: d.businessUnitId, businessUnitName: buName, appliesTo: d.appliesTo,
  displayName: d.displayName.trim() || buName, headerStyle: d.headerStyle, address: d.address, taxRegistration: d.taxRegistration,
  phone: d.phone, email: d.email, website: d.website, accentColor: d.accentColor, status: d.active ? 'ACTIVE' : 'INACTIVE',
  logoMime: d.logo.action === 'REMOVE' ? null : (d.logo.prepared?.mime ?? d.logo.mime ?? null),
  logoFileName: d.logo.fileName ?? null,
  logoWidth: d.logo.prepared?.width ?? d.logo.width ?? null, logoHeight: d.logo.prepared?.height ?? d.logo.height ?? null,
  logoBytes: d.logo.prepared?.bytes ?? d.logo.bytes ?? null, logoChunks: 0,
  logoDataUrl: d.logo.action === 'REMOVE' ? null : d.logo.dataUrl,
});

/** Sample purchase order for the preview PDF. */
function samplePdf(brand: ReportBrand, user: string): jsPDF {
  const today = new Date().toISOString().slice(0, 10);
  const h: Row = {
    PO_NUMBER: 'PO-SAMPLE-0001', REVISION_NUM: 0, CREATION_DATE: today, BUYER_USER: user, CURRENCY_CODE: 'AED', PAYMENT_TERMS: '30 days',
    DOCUMENT_STATUS: 'APPROVED', APPROVED_DATE: today, SUPPLIER_NAME: 'Sample Supplier LLC', SITE_NAME: 'DUBAI',
    SUPPLIER_ADDRESS: 'Office 12, Business Bay, Dubai', TAX_REGISTRATION_NUMBER: '100000000000003', SHIP_TO_NAME: 'Head office', BILL_TO_NAME: 'Head office',
  };
  const lines: Row[] = [
    { LINE_NUM: 1, ITEM_DESCRIPTION: 'Office chairs, ergonomic', NEED_BY_DATE: today, LINE_TYPE: 'QUANTITY', QUANTITY: 20, UOM_CODE: 'EA', UNIT_PRICE: 650, AMOUNT: 13000 },
    { LINE_NUM: 2, ITEM_DESCRIPTION: 'Delivery and installation', NEED_BY_DATE: today, LINE_TYPE: 'AMOUNT', AMOUNT: 1500 },
  ];
  return buildPoPdf(h, lines, { buName: brand.businessUnitName, brand, terms: 'Sample terms — the order\'s own terms and conditions print here.' });
}

// ── live header preview (HTML, same layout as the PDF) ─────────────────────
const HeaderPreview: React.FC<{ brand: ReportBrand }> = ({ brand }) => {
  const accent = brand.accentColor || DEFAULT_ACCENT;
  const logo = brand.headerStyle !== 'NAME_ONLY' ? brand.logoDataUrl : null;
  const showName = brand.headerStyle !== 'LOGO_ONLY' || !logo;
  const details = [
    ...brand.address.split(/\r?\n/).map(l => l.trim()).filter(Boolean),
    brand.taxRegistration ? `TRN ${brand.taxRegistration}` : '',
    [brand.phone, brand.email, brand.website].filter(Boolean).join('  ·  '),
  ].filter(Boolean);
  return (
    <div style={{ background: '#fff', boxShadow: '0 2px 12px rgba(0,0,0,0.12)', borderRadius: 2, overflow: 'hidden', fontFamily: 'Helvetica, Arial, sans-serif' }}>
      <div style={{ height: 5, background: accent }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '14px 18px 10px' }}>
        <div style={{ minWidth: 0, maxWidth: '58%' }}>
          {logo && <img src={logo} alt="logo" style={{ display: 'block', maxWidth: 180, maxHeight: 56, objectFit: 'contain', marginBottom: 6 }} />}
          {showName && <div style={{ fontWeight: 700, fontSize: logo ? 13 : 17, lineHeight: 1.2, wordBreak: 'break-word' }}>{brand.displayName || brand.businessUnitName || 'Company name'}</div>}
          {details.map((d, i) => <div key={i} style={{ fontSize: 9.5, color: '#5a5a5a', lineHeight: 1.35 }}>{d}</div>)}
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ color: accent, fontWeight: 700, fontSize: 17, letterSpacing: 0.3 }}>PURCHASE ORDER</div>
          {[['PO number', 'PO-SAMPLE-0001'], ['Date', new Date().toISOString().slice(0, 10)], ['Currency', 'AED']].map(([k, v]) => (
            <div key={k} style={{ fontSize: 10, display: 'flex', gap: 16, justifyContent: 'space-between' }}><b>{k}</b><span>{v}</span></div>
          ))}
        </div>
      </div>
      <div style={{ margin: '4px 18px 14px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '24px 1fr 60px 80px', background: accent, color: (() => {
          const v = parseInt(accent.slice(1), 16); const l = 0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255);
          return l > 170 ? '#1a1a1a' : '#fff';
        })(), fontSize: 9.5, fontWeight: 700, padding: '4px 6px' }}>
          <span>#</span><span>Description</span><span style={{ textAlign: 'right' }}>Qty</span><span style={{ textAlign: 'right' }}>Amount</span>
        </div>
        {[['1', 'Office chairs, ergonomic', '20', '13,000.00'], ['2', 'Delivery and installation', '', '1,500.00']].map(r => (
          <div key={r[0]} style={{ display: 'grid', gridTemplateColumns: '24px 1fr 60px 80px', fontSize: 9.5, padding: '4px 6px', background: r[0] === '1' ? '#f7f7f7' : '#fff' }}>
            <span>{r[0]}</span><span>{r[1]}</span><span style={{ textAlign: 'right' }}>{r[2]}</span><span style={{ textAlign: 'right' }}>{r[3]}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

// ── editor ──────────────────────────────────────────────────────────────────
const BrandingEditor: React.FC<{
  draft: Draft | null; onClose: () => void; onSaved: () => void;
  list: Branding[]; bus: { BUSINESS_UNIT_ID: number; BUSINESS_UNIT_NAME: string }[]; user: string;
}> = ({ draft: initial, onClose, onSaved, list, bus, user }) => {
  const [d, setD] = useState<Draft | null>(initial);
  const [busy, setBusy] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [pdf, setPdf] = useState<jsPDF | null>(null);
  useEffect(() => { setD(initial); }, [initial]);

  // colours of a stored logo, for the brand colour suggestions
  useEffect(() => {
    if (!initial?.logo.dataUrl || initial.palette.length) return;
    let gone = false;
    fetch(initial.logo.dataUrl).then(r => r.blob())
      .then(b => prepareLogo(new File([b], 'logo', { type: b.type }), { trim: false }))
      .then(p => { if (!gone) setD(x => (x ? { ...x, palette: p.palette } : x)); })
      .catch(() => { /* suggestions are optional */ });
    return () => { gone = true; };
  }, [initial]);

  if (!d) return null;
  const set = (p: Partial<Draft>) => setD(x => (x ? { ...x, ...p } : x));
  const buName = bus.find(b => Number(b.BUSINESS_UNIT_ID) === d.businessUnitId)?.BUSINESS_UNIT_NAME || '';
  const brand = brandOf(d, buName);
  const clash = conflicts(list, { brandingId: d.brandingId, businessUnitId: d.businessUnitId, appliesTo: d.appliesTo, status: d.active ? 'ACTIVE' : 'INACTIVE' });
  const allDocs = d.appliesTo.includes('ALL');
  const emailBad = !!d.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email.trim());
  const canSave = !!d.businessUnitId && !!d.displayName.trim() && d.appliesTo.length > 0 && !clash.length && !emailBad && !processing;

  const takeFile = async (file: File, trim = d.trim) => {
    setProcessing(true);
    try {
      const p = await prepareLogo(file, { trim });
      setD(x => (x ? {
        ...x, trim, palette: p.palette,
        logo: { action: 'REPLACE', dataUrl: p.dataUrl, prepared: p, file, fileName: file.name, width: p.width, height: p.height, bytes: p.bytes, mime: p.mime },
        accentColor: x.accentColor || p.palette[0] || null,
      } : x));
    } catch (e: any) { message.error(e.message || String(e)); }
    finally { setProcessing(false); }
  };

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    try {
      const r = await saveBranding({
        brandingId: d.brandingId, businessUnitId: d.businessUnitId, appliesTo: d.appliesTo, displayName: d.displayName,
        headerStyle: d.headerStyle, address: d.address, taxRegistration: d.taxRegistration, phone: d.phone, email: d.email,
        website: d.website, accentColor: d.accentColor, status: d.active ? 'ACTIVE' : 'INACTIVE',
        logoAction: d.logo.action, logoBase64: d.logo.prepared?.base64 ?? (d.logo.dataUrl ? d.logo.dataUrl.slice(d.logo.dataUrl.indexOf(',') + 1) : null),
        logoMime: brand.logoMime, logoFileName: d.logo.fileName ?? null, logoWidth: brand.logoWidth, logoHeight: brand.logoHeight, logoBytes: brand.logoBytes,
      }, user);
      message.success(r.message || 'Saved');
      onSaved();
    } catch (e: any) { message.error(e.message, 8); }
    finally { setBusy(false); }
  };

  const logoInfo = d.logo.action !== 'REMOVE' && d.logo.dataUrl;
  const facts = [
    d.logo.width && d.logo.height ? `${d.logo.width} × ${d.logo.height} px` : '',
    (d.logo.mime || '').replace('image/', '').toUpperCase(),
    kb(d.logo.bytes),
    d.logo.prepared?.trimmed ? `margins trimmed (from ${d.logo.prepared.originalWidth} × ${d.logo.prepared.originalHeight})` : '',
  ].filter(Boolean).join(' · ');

  return (
    <Drawer open onClose={onClose} size={1080} destroyOnHidden
      title={<Space><PictureOutlined style={{ color: PO_RED }} />{d.brandingId ? `Edit branding — ${initial?.displayName || ''}` : 'New report branding'}</Space>}
      extra={<Space>
        <Button icon={<FilePdfOutlined />} onClick={() => setPdf(samplePdf(brand, user))} disabled={processing}>Preview PDF</Button>
        <Button type="primary" onClick={save} loading={busy} disabled={!canSave} style={{ background: canSave ? PO_RED : undefined }}>Save</Button>
      </Space>}>
      <ARow gutter={24}>
        <Col xs={24} lg={13}>
          <Text strong>Business unit</Text>
          <Select style={{ width: '100%', margin: '4px 0 14px' }} placeholder="Choose the business unit" showSearch optionFilterProp="label"
            value={d.businessUnitId ?? undefined}
            onChange={v => {
              const prevName = buName;
              const name = bus.find(b => Number(b.BUSINESS_UNIT_ID) === v)?.BUSINESS_UNIT_NAME || '';
              set({ businessUnitId: v, displayName: !d.displayName.trim() || d.displayName === prevName ? name : d.displayName });
            }}
            options={bus.map(b => ({ value: Number(b.BUSINESS_UNIT_ID), label: b.BUSINESS_UNIT_NAME }))} />

          <Text strong>Printed on</Text>
          <div style={{ margin: '4px 0 6px', padding: '10px 12px', border: '1px solid #f0f0f0', borderRadius: 8 }}>
            <Checkbox checked={allDocs} onChange={e => set({ appliesTo: e.target.checked ? ['ALL'] : [] })}>
              <b>All documents</b> <Text type="secondary" style={{ fontSize: 12 }}>— the default for every module that has no branding of its own</Text>
            </Checkbox>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 6, marginTop: 8, opacity: allDocs ? 0.45 : 1 }}>
              {BRANDING_DOCS.map(doc => (
                <Checkbox key={doc.code} disabled={allDocs} checked={!allDocs && d.appliesTo.includes(doc.code)}
                  onChange={e => set({ appliesTo: e.target.checked ? [...d.appliesTo.filter(c => c !== 'ALL'), doc.code] : d.appliesTo.filter(c => c !== doc.code) })}>
                  <span>{doc.label}</span><div style={{ fontSize: 11, color: '#8c8c8c', lineHeight: 1.2 }}>{doc.hint}</div>
                </Checkbox>
              ))}
            </div>
          </div>
          {clash.length > 0 && <Alert type="error" showIcon style={{ marginBottom: 10 }} message="Overlaps another active branding"
            description={<ul style={{ margin: 0, paddingLeft: 18 }}>{clash.map(c => <li key={c}>{c}</li>)}</ul>} />}

          <Text strong>Logo</Text>
          <div style={{ display: 'flex', gap: 12, alignItems: 'stretch', margin: '4px 0 6px' }}>
            <div style={{ flex: '0 0 220px', height: 110, borderRadius: 8, border: '1px solid #f0f0f0', background: CHECKER, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 8 }}>
              {processing ? <Spin /> : logoInfo ? <img src={d.logo.dataUrl!} alt="logo" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                : <Text type="secondary" style={{ fontSize: 12 }}>No logo</Text>}
            </div>
            <Upload.Dragger accept="image/*,.svg" showUploadList={false} disabled={processing} style={{ flex: 1 }}
              beforeUpload={f => { takeFile(f as File); return Upload.LIST_IGNORE; }}>
              <p className="ant-upload-drag-icon" style={{ marginBottom: 4 }}><InboxOutlined /></p>
              <p style={{ margin: 0, fontSize: 13 }}>{logoInfo ? 'Drop a new logo to replace it' : 'Drop the logo here or click to choose'}</p>
              <p style={{ margin: 0, fontSize: 11, color: '#8c8c8c' }}>PNG, JPG, SVG or WebP — trimmed and scaled for print automatically</p>
            </Upload.Dragger>
          </div>
          {logoInfo && (
            <Space size={12} wrap style={{ display: 'flex', marginBottom: 14 }}>
              {facts && <Text type="secondary" style={{ fontSize: 12 }}>{facts}</Text>}
              {d.logo.file && (
                <Checkbox checked={d.trim} onChange={e => takeFile(d.logo.file!, e.target.checked)} disabled={processing}>
                  <span style={{ fontSize: 12 }}>Trim empty margins</span>
                </Checkbox>
              )}
              <Button size="small" danger type="link" icon={<DeleteOutlined />}
                onClick={() => set({ logo: { ...d.logo, action: d.brandingId ? 'REMOVE' : 'KEEP', dataUrl: null, prepared: undefined, file: undefined } })}>Remove logo</Button>
            </Space>
          )}
          {!logoInfo && <div style={{ marginBottom: 14 }} />}

          <Text strong>Header</Text>
          <div style={{ margin: '4px 0 14px' }}>
            <Segmented block value={d.headerStyle} onChange={v => set({ headerStyle: v as HeaderStyle })}
              options={[
                { value: 'LOGO_AND_NAME', label: 'Logo + company name' },
                { value: 'LOGO_ONLY', label: 'Logo only' },
                { value: 'NAME_ONLY', label: 'Name only' },
              ]} />
            {d.headerStyle === 'LOGO_ONLY' && <Text type="secondary" style={{ fontSize: 11 }}>For logos that already contain the company name. Without a logo the name is printed.</Text>}
          </div>

          <ARow gutter={12}>
            <Col span={24}>
              <Text strong>Company name</Text> <Text type="secondary" style={{ fontSize: 11 }}>as printed — e.g. the legal name</Text>
              <Input style={{ margin: '4px 0 12px' }} value={d.displayName} maxLength={240} onChange={e => set({ displayName: e.target.value })}
                status={!d.displayName.trim() ? 'error' : undefined} placeholder="Buimerc Corporation DIFC Investments Ltd" />
            </Col>
            <Col span={24}>
              <Text strong>Address</Text>
              <Input.TextArea style={{ margin: '4px 0 12px' }} rows={3} maxLength={1000} value={d.address} onChange={e => set({ address: e.target.value })}
                placeholder={'Office 1203, Index Tower, DIFC\nP.O. Box 12345, Dubai, United Arab Emirates'} />
            </Col>
            <Col xs={24} md={12}><Text strong>TRN</Text>
              <Input style={{ margin: '4px 0 12px' }} maxLength={60} value={d.taxRegistration} onChange={e => set({ taxRegistration: e.target.value })} placeholder="100000000000003" /></Col>
            <Col xs={24} md={12}><Text strong>Phone</Text>
              <Input style={{ margin: '4px 0 12px' }} maxLength={60} value={d.phone} onChange={e => set({ phone: e.target.value })} placeholder="+971 4 000 0000" /></Col>
            <Col xs={24} md={12}><Text strong>E-mail</Text>
              <Input style={{ margin: '4px 0 12px' }} maxLength={240} value={d.email} status={emailBad ? 'error' : undefined} onChange={e => set({ email: e.target.value })} placeholder="accounts@company.com" /></Col>
            <Col xs={24} md={12}><Text strong>Website</Text>
              <Input style={{ margin: '4px 0 12px' }} maxLength={240} value={d.website} onChange={e => set({ website: e.target.value })} placeholder="www.company.com" /></Col>
          </ARow>

          <Text strong>Brand colour</Text> <Text type="secondary" style={{ fontSize: 11 }}>top bar, title and table headings</Text>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', margin: '4px 0 14px' }}>
            <ColorPicker value={d.accentColor || DEFAULT_ACCENT} showText disabledAlpha
              onChangeComplete={c => set({ accentColor: c.toHexString().toUpperCase().slice(0, 7) })}
              presets={[
                ...(d.palette.length ? [{ label: 'From the logo', colors: d.palette }] : []),
                { label: 'Standard', colors: [DEFAULT_ACCENT, '#0572CE', '#1D7B4D', '#1A1A1A', '#722ED1', '#B8860B'] },
              ]} />
            {d.palette.length > 0 && <>
              <Text type="secondary" style={{ fontSize: 12 }}>From the logo:</Text>
              {d.palette.map(c => (
                <Tooltip key={c} title={c}>
                  <span onClick={() => set({ accentColor: c })} style={{ width: 22, height: 22, borderRadius: 6, background: c, cursor: 'pointer', display: 'inline-block',
                    outline: d.accentColor === c ? `2px solid ${c}` : 'none', outlineOffset: 2, border: '1px solid rgba(0,0,0,0.1)' }} />
                </Tooltip>
              ))}
            </>}
            {d.accentColor && d.accentColor !== DEFAULT_ACCENT && <Button size="small" type="link" onClick={() => set({ accentColor: null })}>Use default</Button>}
          </div>

          <Space>
            <Switch checked={d.active} onChange={v => set({ active: v })} />
            <Text>{d.active ? 'Active — used on reports' : 'Inactive — kept, not printed'}</Text>
          </Space>
        </Col>

        <Col xs={24} lg={11}>
          <div style={{ position: 'sticky', top: 0 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>Live preview — purchase order header</Text>
            <div style={{ background: '#525659', padding: 14, borderRadius: 8, marginTop: 6 }}>
              <HeaderPreview brand={brand} />
            </div>
            <Alert type="info" showIcon style={{ marginTop: 12, fontSize: 12 }}
              message="Which branding a document prints"
              description={<span>A {d.appliesTo.includes('ALL') ? 'document' : d.appliesTo.map(docLabel).join(' / ').toLowerCase() || 'document'} of {buName || 'this business unit'} uses
                its own branding first, then the business unit's <b>All documents</b> branding, then just the business unit name.</span>} />
          </div>
        </Col>
      </ARow>
      <PdfPreviewModal open={!!pdf} doc={pdf} fileName="branding-preview.pdf" title={`Preview — ${brand.displayName}`} onClose={() => setPdf(null)}
        note="Sample purchase order with this branding (not saved yet)" />
    </Drawer>
  );
};

// ── page ────────────────────────────────────────────────────────────────────
const ReportBranding: React.FC = () => {
  const buState = useBusinessUnits();
  const user = usePoUser();
  const [list, setList] = useState<Branding[]>([]);
  const [logos, setLogos] = useState<Record<number, string | null>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [search, setSearch] = useState('');
  const [pdf, setPdf] = useState<{ doc: jsPDF; name: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const rows = await listBrandings();
      setList(rows);
      rows.filter(b => b.logoChunks > 0).forEach(b => loadLogo(b).then(u => setLogos(m => ({ ...m, [b.brandingId!]: u }))).catch(() => undefined));
    } catch (e: any) { setError(e.message || String(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const bus = buState.bus as unknown as { BUSINESS_UNIT_ID: number; BUSINESS_UNIT_NAME: string }[];
  const installed = !error || !brandingNotInstalled(error);
  const openNew = (p: Partial<Draft> = {}) => {
    const name = bus.find(b => Number(b.BUSINESS_UNIT_ID) === p.businessUnitId)?.BUSINESS_UNIT_NAME || '';
    setEditing(emptyDraft({ displayName: name, ...p }));
  };
  const openEdit = async (b: Branding) => {
    const logo = b.brandingId ? (logos[b.brandingId] ?? await loadLogo(b).catch(() => null)) : null;
    setEditing(draftOf(b, logo));
  };
  const copyTo = async (b: Branding) => {
    const logo = b.brandingId ? (logos[b.brandingId] ?? await loadLogo(b).catch(() => null)) : null;
    const d = draftOf(b, logo);
    setEditing({ ...d, brandingId: null, businessUnitId: null, logo: { ...d.logo, action: logo ? 'REPLACE' : 'KEEP' } });
  };
  const remove = async (b: Branding) => {
    try { const r = await deleteBranding(b.brandingId!, user); message.success(r.message || 'Deleted'); load(); }
    catch (e: any) { message.error(e.message, 8); }
  };
  const preview = async (b: Branding) => {
    const logo = b.brandingId ? (logos[b.brandingId] ?? await loadLogo(b).catch(() => null)) : null;
    setPdf({ doc: samplePdf({ ...b, logoDataUrl: logo }, user), name: `${b.displayName}.pdf` });
  };

  const covered = bus.filter(b => Object.values(coverage(list, Number(b.BUSINESS_UNIT_ID))).some(Boolean)).length;
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return list.filter(b => !q || `${b.displayName} ${b.businessUnitName} ${b.appliesTo.map(docLabel).join(' ')}`.toLowerCase().includes(q));
  }, [list, search]);

  const LogoThumb: React.FC<{ b: Branding; h: number; w: number }> = ({ b, h, w }) => {
    const u = b.brandingId ? logos[b.brandingId] : null;
    return u ? <img src={u} alt="" style={{ height: h, maxWidth: w, objectFit: 'contain' }} />
      : <Avatar size={h} style={{ background: b.accentColor || PO_RED, fontSize: Math.max(9, h * 0.42), flexShrink: 0 }}>{initials(b.displayName)}</Avatar>;
  };

  const coverColumns: ColumnsType<{ BUSINESS_UNIT_ID: number; BUSINESS_UNIT_NAME: string }> = [
    { title: 'Business unit', dataIndex: 'BUSINESS_UNIT_NAME', width: 230, fixed: 'left', render: v => <Text strong style={{ fontSize: 12 }}>{v}</Text> },
    ...BRANDING_DOCS.map(doc => ({
      title: <Tooltip title={doc.hint}>{doc.label}</Tooltip>, key: doc.code, width: 170,
      render: (_: unknown, bu: { BUSINESS_UNIT_ID: number; BUSINESS_UNIT_NAME: string }) => {
        const b = coverage(list, Number(bu.BUSINESS_UNIT_ID))[doc.code];
        if (!b) {
          return (
            <Tooltip title={`No branding — prints "${bu.BUSINESS_UNIT_NAME}". Click to add a logo for ${doc.label}.`}>
              <Button size="small" type="dashed" icon={<PlusOutlined />} style={{ fontSize: 11, color: '#8c8c8c' }}
                onClick={() => openNew({ businessUnitId: Number(bu.BUSINESS_UNIT_ID), appliesTo: [doc.code] })}>Name only</Button>
            </Tooltip>
          );
        }
        const all = b.appliesTo.includes('ALL');
        const accent = b.accentColor || PO_RED;
        return (
          <Tooltip title={all ? `"${b.displayName}" — the business unit's branding for all documents` : `"${b.displayName}" — ${b.appliesTo.map(docLabel).join(', ')}`}>
            <div onClick={() => openEdit(b)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, padding: '3px 6px', borderRadius: 6,
              border: `1px ${all ? 'dashed' : 'solid'} ${all ? '#d9d9d9' : `${accent}66`}`, background: all ? '#fafafa' : `${accent}0f`, maxWidth: 160 }}>
              <LogoThumb b={b} h={18} w={44} />
              <span style={{ fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{b.displayName}</span>
              {all && <Tag style={{ fontSize: 9, margin: 0, lineHeight: '14px', padding: '0 3px' }}>ALL</Tag>}
            </div>
          </Tooltip>
        );
      },
    })),
  ];

  return (
    <div style={{ padding: 20 }}>
      <PoBar title="Report Branding" subtitle="Logo and company details printed on documents — per business unit and module" icon={<PictureOutlined />}
        extra={<>
          <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>Refresh</Button>
          <Button type="primary" icon={<PlusOutlined />} disabled={!installed} onClick={() => openNew()} style={{ background: installed ? PO_RED : undefined }}>New branding</Button>
        </>} />

      {error && (installed
        ? <Alert type="error" showIcon style={{ marginBottom: 12 }} message="Could not load the report branding" description={error} />
        : <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="Report branding is not installed yet"
            description={<span>Run <Text code>{BRANDING_SCRIPT}</Text> in APEX SQL Workshop (after 306). Until then documents print the business unit name.</span>} />)}

      <Card size="small" style={{ marginBottom: 16 }}
        title={<Space><span>What each document prints</span><Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
          {covered} of {bus.length} business unit{bus.length === 1 ? '' : 's'} branded</Text></Space>}
        extra={<Space size={12} style={{ fontSize: 11 }}>
          <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: `${PO_RED}22`, border: `1px solid ${PO_RED}66`, marginRight: 4 }} />own branding</span>
          <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: '#fafafa', border: '1px dashed #bbb', marginRight: 4 }} />from "All documents"</span>
        </Space>}>
        <Table size="small" rowKey="BUSINESS_UNIT_ID" columns={coverColumns} dataSource={bus} pagination={false}
          loading={loading || buState.loading} scroll={{ x: 230 + 170 * BRANDING_DOCS.length }} />
      </Card>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '4px 0 10px', gap: 12, flexWrap: 'wrap' }}>
        <Title level={5} style={{ margin: 0 }}>Brandings <Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>({list.length})</Text></Title>
        <Input.Search allowClear placeholder="Search name, business unit, module" style={{ maxWidth: 320 }} value={search} onChange={e => setSearch(e.target.value)} />
      </div>
      {loading && !list.length ? <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
        : !shown.length ? <Empty style={{ padding: 30 }} description={list.length ? 'No branding matches the search' : 'No branding yet — documents print the business unit name'}>
            {!list.length && installed && <Button type="primary" icon={<PlusOutlined />} onClick={() => openNew()} style={{ background: PO_RED }}>Add the first logo</Button>}
          </Empty>
        : <ARow gutter={[16, 16]}>
            {shown.map(b => {
              const accent = b.accentColor || PO_RED;
              const logo = b.brandingId ? logos[b.brandingId] : null;
              return (
                <Col key={b.brandingId} xs={24} md={12} xl={8}>
                  <Card size="small" hoverable style={{ borderTop: `3px solid ${accent}`, opacity: b.status === 'ACTIVE' ? 1 : 0.6 }}
                    actions={[
                      <Tooltip key="e" title="Edit"><EditOutlined onClick={() => openEdit(b)} /></Tooltip>,
                      <Tooltip key="p" title="Preview on a sample purchase order"><FilePdfOutlined onClick={() => preview(b)} /></Tooltip>,
                      <Tooltip key="c" title="Copy to another business unit"><CopyOutlined onClick={() => copyTo(b)} /></Tooltip>,
                      <Popconfirm key="d" title={`Delete "${b.displayName}"?`} description="Documents fall back to the next branding, or the business unit name."
                        okText="Delete" okButtonProps={{ danger: true }} onConfirm={() => remove(b)}>
                        <Tooltip title="Delete"><DeleteOutlined style={{ color: '#D93025' }} /></Tooltip>
                      </Popconfirm>,
                    ]}>
                    <div onClick={() => openEdit(b)} style={{ cursor: 'pointer' }}>
                      <div style={{ height: 84, borderRadius: 6, background: CHECKER, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 10, padding: 8 }}>
                        {logo ? <img src={logo} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                          : b.logoChunks ? <Spin size="small" />
                          : <Text type="secondary" style={{ fontSize: 12 }}>No logo — name only</Text>}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        <div style={{ minWidth: 0 }}>
                          <Text strong ellipsis style={{ display: 'block' }}>{b.displayName}</Text>
                          <Text type="secondary" style={{ fontSize: 12 }}>{b.businessUnitName}</Text>
                        </div>
                        {b.status !== 'ACTIVE' && <Tag style={{ margin: 0, height: 'fit-content' }}>Inactive</Tag>}
                      </div>
                      <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {b.appliesTo.map(c => <Tag key={c} color={c === 'ALL' ? 'default' : 'red'} style={{ margin: 0, fontSize: 11 }}>{docLabel(c)}</Tag>)}
                      </div>
                      <div style={{ marginTop: 8, fontSize: 11, color: '#8c8c8c' }}>
                        {[b.logoBytes ? `${b.logoWidth} × ${b.logoHeight} · ${kb(b.logoBytes)}` : '', b.lastUpdatedBy ? `updated by ${b.lastUpdatedBy}` : ''].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                  </Card>
                </Col>
              );
            })}
          </ARow>}

      {editing && (
        <BrandingEditor draft={editing} list={list} bus={bus} user={user} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }} />
      )}
      <PdfPreviewModal open={!!pdf} doc={pdf?.doc || null} fileName={pdf?.name || 'branding.pdf'} title="Branding preview" onClose={() => setPdf(null)}
        note="Sample purchase order with this branding" />
    </div>
  );
};

export default ReportBranding;
