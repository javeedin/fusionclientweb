// Report branding — the logo and company details printed at the top of documents, per business unit and
// document type (database/po/307_report_branding.sql).
//   Reads  → read gateway over RR_REPORT_V_BRANDING / RR_REPORT_V_BRANDING_LOGO (logo in base64 chunks)
//   Writes → po/execute: RR_REPORT_BRANDING_PKG.SAVE_BRANDING / DELETE_BRANDING
// A report asks resolveReportBranding(businessUnitId, 'PO') and draws drawBrandHeader(); without a
// branding row it prints the business unit name, as before.
import type jsPDF from 'jspdf';
import { poExec, poQuery, lit, nlit, type Row } from './po.service';

export const BRANDING_SCRIPT = 'database/po/307_report_branding.sql';
export const BRANDING_PROC = {
  save: 'RR_REPORT_BRANDING_PKG.SAVE_BRANDING',
  remove: 'RR_REPORT_BRANDING_PKG.DELETE_BRANDING',
};

export const BRANDING_DOCS = [
  { code: 'PO', label: 'Purchasing', hint: 'Purchase orders, requisitions' },
  { code: 'AP', label: 'Payables', hint: 'Invoices, payments, remittance advices' },
  { code: 'AR', label: 'Receivables', hint: 'Customer invoices, receipts, statements' },
  { code: 'CM', label: 'Cash Management', hint: 'Bank reconciliations, transfers' },
  { code: 'GL', label: 'General Ledger', hint: 'Journals, financial statements' },
  { code: 'FA', label: 'Fixed Assets', hint: 'Asset registers, depreciation' },
] as const;
export type BrandingDoc = typeof BRANDING_DOCS[number]['code'];
export const docLabel = (c: string) => (c === 'ALL' ? 'All documents' : BRANDING_DOCS.find(d => d.code === c)?.label || c);

export type HeaderStyle = 'LOGO_AND_NAME' | 'LOGO_ONLY' | 'NAME_ONLY';
export const DEFAULT_ACCENT = '#C74634';

export interface Branding {
  brandingId: number | null;
  businessUnitId: number | null;
  businessUnitName: string;
  /** ['ALL'] or document codes */
  appliesTo: string[];
  displayName: string;
  headerStyle: HeaderStyle;
  address: string;
  taxRegistration: string;
  phone: string;
  email: string;
  website: string;
  accentColor: string | null;
  logoMime: string | null;
  logoFileName: string | null;
  logoWidth: number | null;
  logoHeight: number | null;
  logoBytes: number | null;
  logoChunks: number;
  status: 'ACTIVE' | 'INACTIVE';
  lastUpdatedBy?: string;
  lastUpdateDate?: string;
}
/** Branding ready to print: with the logo as a data URL. */
export interface ReportBrand extends Branding { logoDataUrl: string | null }

const s = (v: unknown) => (v == null ? '' : String(v));
const num = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

export const toBranding = (r: Row): Branding => ({
  brandingId: num(r.BRANDING_ID),
  businessUnitId: num(r.BUSINESS_UNIT_ID),
  businessUnitName: s(r.BUSINESS_UNIT_NAME),
  appliesTo: s(r.APPLIES_TO || 'ALL').split(',').map(x => x.trim()).filter(Boolean),
  displayName: s(r.DISPLAY_NAME),
  headerStyle: (['LOGO_AND_NAME', 'LOGO_ONLY', 'NAME_ONLY'].includes(s(r.HEADER_STYLE)) ? s(r.HEADER_STYLE) : 'LOGO_AND_NAME') as HeaderStyle,
  address: s(r.ADDRESS_TEXT),
  taxRegistration: s(r.TAX_REGISTRATION),
  phone: s(r.PHONE),
  email: s(r.EMAIL),
  website: s(r.WEBSITE),
  accentColor: r.ACCENT_COLOR ? s(r.ACCENT_COLOR) : null,
  logoMime: r.LOGO_MIME ? s(r.LOGO_MIME) : null,
  logoFileName: r.LOGO_FILE_NAME ? s(r.LOGO_FILE_NAME) : null,
  logoWidth: num(r.LOGO_WIDTH),
  logoHeight: num(r.LOGO_HEIGHT),
  logoBytes: num(r.LOGO_BYTES),
  logoChunks: num(r.LOGO_CHUNKS) || 0,
  status: s(r.STATUS) === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
  lastUpdatedBy: s(r.LAST_UPDATED_BY) || undefined,
  lastUpdateDate: s(r.LAST_UPDATE_DATE) || undefined,
});

/** The table / views are missing — the database script has not been run yet. */
export const brandingNotInstalled = (e: unknown) => /ORA-00942|ORA-04063|does not exist|RR_REPORT_V_BRANDING|not allowed/i.test(String((e as any)?.message || e));

export async function listBrandings(): Promise<Branding[]> {
  const rows = await poQuery(`SELECT * FROM RR_REPORT_V_BRANDING
    ORDER BY BUSINESS_UNIT_NAME, CASE WHEN APPLIES_TO = 'ALL' THEN 2 ELSE 1 END, DISPLAY_NAME`);
  return rows.map(toBranding);
}

// logos are cached per row version, so the list and every print reuse one download
const logoCache = new Map<string, Promise<string | null>>();
const logoKey = (b: Branding) => `${b.brandingId}:${b.lastUpdateDate || ''}:${b.logoBytes || 0}`;
export const forgetBrandingCache = () => { logoCache.clear(); resolveCache.clear(); };

export function loadLogo(b: Branding): Promise<string | null> {
  if (!b.brandingId || !b.logoChunks || !b.logoMime) return Promise.resolve(null);
  const key = logoKey(b);
  let p = logoCache.get(key);
  if (!p) {
    p = poQuery(`SELECT CHUNK_NO, CHUNK_DATA FROM RR_REPORT_V_BRANDING_LOGO WHERE BRANDING_ID = ${nlit(b.brandingId)} ORDER BY CHUNK_NO`, 1000)
      .then(rows => {
        const b64 = rows.map(r => s(r.CHUNK_DATA)).join('');
        return b64 ? `data:${b.logoMime};base64,${b64}` : null;
      });
    p.catch(() => logoCache.delete(key));
    logoCache.set(key, p);
  }
  return p;
}

const resolveCache = new Map<string, { at: number; brand: ReportBrand | null }>();

/**
 * What a document of type `doc` for this business unit prints: the active branding naming `doc`, else the
 * business unit's "all documents" branding, else null (print the business unit name). Never throws.
 */
export async function resolveReportBranding(businessUnitId: number | null | undefined, doc: BrandingDoc): Promise<ReportBrand | null> {
  if (!businessUnitId) return null;
  const key = `${businessUnitId}:${doc}`;
  const hit = resolveCache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.brand;
  try {
    const rows = await poQuery(`SELECT * FROM RR_REPORT_V_BRANDING
      WHERE BUSINESS_UNIT_ID = ${nlit(businessUnitId)} AND STATUS = 'ACTIVE'
        AND (APPLIES_TO = 'ALL' OR INSTR(',' || APPLIES_TO || ',', ${lit(`,${doc},`)}) > 0)
      ORDER BY CASE WHEN APPLIES_TO = 'ALL' THEN 2 ELSE 1 END, LAST_UPDATE_DATE DESC NULLS LAST
      FETCH FIRST 1 ROWS ONLY`);
    const b = rows[0] ? toBranding(rows[0]) : null;
    const brand = b ? { ...b, logoDataUrl: await loadLogo(b).catch(() => null) } : null;
    resolveCache.set(key, { at: Date.now(), brand });
    return brand;
  } catch {
    return null;   // not installed / not reachable → print as before
  }
}

/** Which branding covers each document type of a business unit (specific first, then ALL). */
export function coverage(list: Branding[], businessUnitId: number): Record<string, Branding | null> {
  const active = list.filter(b => b.businessUnitId === businessUnitId && b.status === 'ACTIVE');
  const all = active.find(b => b.appliesTo.includes('ALL')) || null;
  return Object.fromEntries(BRANDING_DOCS.map(d => [d.code, active.find(b => b.appliesTo.includes(d.code)) || all]));
}

/** Clashes with other active brandings of the same business unit (the database refuses these too). */
export function conflicts(list: Branding[], draft: { brandingId: number | null; businessUnitId: number | null; appliesTo: string[]; status: string }): string[] {
  if (!draft.businessUnitId || draft.status !== 'ACTIVE') return [];
  const others = list.filter(b => b.businessUnitId === draft.businessUnitId && b.status === 'ACTIVE' && b.brandingId !== draft.brandingId);
  const out: string[] = [];
  others.forEach(o => {
    if (draft.appliesTo.includes('ALL') && o.appliesTo.includes('ALL')) out.push(`"${o.displayName}" is already the branding for all documents of this business unit`);
    if (!draft.appliesTo.includes('ALL') && !o.appliesTo.includes('ALL')) {
      draft.appliesTo.filter(c => o.appliesTo.includes(c)).forEach(c => out.push(`${docLabel(c)} documents already use "${o.displayName}"`));
    }
  });
  return out;
}

// ── use one branding for all modules ────────────────────────────────────────

/** What "use for all modules" does to one branding: the modules it gains, and those that keep another branding. */
export interface AllModulesPlan {
  source: Branding;
  /** module codes the branding already prints on */
  has: string[];
  /** module codes it will be added to */
  add: string[];
  /** modules that keep another active branding of the same business unit */
  kept: { code: string; by: Branding }[];
  /** another active "All documents" branding of the business unit (blocks the "All documents" option) */
  otherAll: Branding | null;
}

export function planAllModules(list: Branding[], source: Branding): AllModulesPlan {
  const others = list.filter(b => b.businessUnitId === source.businessUnitId && b.status === 'ACTIVE' && b.brandingId !== source.brandingId);
  const srcAll = source.appliesTo.includes('ALL');
  const plan: AllModulesPlan = { source, has: [], add: [], kept: [], otherAll: others.find(b => b.appliesTo.includes('ALL')) || null };
  BRANDING_DOCS.forEach(({ code }) => {
    const owner = others.find(b => b.appliesTo.includes(code));
    if (!srcAll && source.appliesTo.includes(code)) plan.has.push(code);
    else if (owner) plan.kept.push({ code, by: owner });
    else if (srcAll) plan.has.push(code);   // an "All documents" branding already prints here
    else plan.add.push(code);
  });
  return plan;
}

/** The branding of a business unit to spread over all modules: the active one with the most modules of its own. */
export function primaryBranding(list: Branding[], businessUnitId: number): Branding | null {
  const active = list.filter(b => b.businessUnitId === businessUnitId && b.status === 'ACTIVE');
  return [...active].sort((a, b) => (b.appliesTo.includes('ALL') ? 0 : b.appliesTo.length) - (a.appliesTo.includes('ALL') ? 0 : a.appliesTo.length))[0] || null;
}

/** Save a branding with a new "printed on" list; everything else, the logo included, stays as stored. */
export function saveAppliesTo(b: Branding, appliesTo: string[], user: string) {
  return saveBranding({
    brandingId: b.brandingId, businessUnitId: b.businessUnitId, appliesTo, displayName: b.displayName, headerStyle: b.headerStyle,
    address: b.address, taxRegistration: b.taxRegistration, phone: b.phone, email: b.email, website: b.website,
    accentColor: b.accentColor, status: b.status, logoMime: b.logoMime, logoFileName: b.logoFileName,
    logoWidth: b.logoWidth, logoHeight: b.logoHeight, logoBytes: b.logoBytes, logoAction: 'KEEP',
  }, user);
}

export interface BrandingSave extends Omit<Branding, 'businessUnitName' | 'logoChunks' | 'lastUpdatedBy' | 'lastUpdateDate'> {
  /** KEEP the stored logo, REPLACE it with logoBase64, or REMOVE it */
  logoAction: 'KEEP' | 'REPLACE' | 'REMOVE';
  logoBase64?: string | null;
}

export async function saveBranding(d: BrandingSave, user: string) {
  const r = await poExec(BRANDING_PROC.save, {
    p_json: {
      brandingId: d.brandingId, businessUnitId: d.businessUnitId, appliesTo: d.appliesTo.join(','),
      displayName: d.displayName.trim(), headerStyle: d.headerStyle, address: d.address.trim() || null,
      taxRegistration: d.taxRegistration.trim() || null, phone: d.phone.trim() || null, email: d.email.trim() || null,
      website: d.website.trim() || null, accentColor: d.accentColor ? d.accentColor.toUpperCase() : null, status: d.status,
      logoAction: d.logoAction,
      ...(d.logoAction === 'REPLACE' ? {
        logoBase64: d.logoBase64, logoMime: d.logoMime, logoFileName: d.logoFileName,
        logoWidth: d.logoWidth, logoHeight: d.logoHeight, logoBytes: d.logoBytes,
      } : {}),
    },
  }, user);
  forgetBrandingCache();
  return r;
}

export async function deleteBranding(id: number, user: string) {
  const r = await poExec(BRANDING_PROC.remove, { p_branding_id: id }, user);
  forgetBrandingCache();
  return r;
}

// ── logo preparation (browser): trim empty margins, scale, pick PNG / JPEG, suggest brand colours ──
export interface PreparedLogo {
  dataUrl: string; base64: string; mime: 'image/png' | 'image/jpeg';
  width: number; height: number; bytes: number;
  /** most used colours of the logo (hex), for the brand colour */
  palette: string[];
  trimmed: boolean; originalWidth: number; originalHeight: number;
}

const readAsDataUrl = (f: Blob) => new Promise<string>((res, rej) => {
  const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(f);
});
const loadImage = (src: string) => new Promise<HTMLImageElement>((res, rej) => {
  const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('This file could not be read as an image')); i.src = src;
});
const hex = (r: number, g: number, b: number) => `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase();

export async function prepareLogo(file: File, opts: { trim?: boolean; maxWidth?: number; maxHeight?: number } = {}): Promise<PreparedLogo> {
  const { trim = true, maxWidth = 1000, maxHeight = 400 } = opts;
  if (!/^image\//.test(file.type) && !/\.(png|jpe?g|svg|webp|gif|bmp)$/i.test(file.name)) throw new Error('Choose an image file (PNG, JPG, SVG, WebP)');
  if (file.size > 8 * 1024 * 1024) throw new Error('The image is larger than 8 MB');
  const img = await loadImage(await readAsDataUrl(file));
  // SVGs without a size get a sensible one
  const w0 = img.naturalWidth || 800, h0 = img.naturalHeight || 300;
  const scale0 = Math.min(1, 3000 / Math.max(w0, h0));
  const cw = Math.max(1, Math.round(w0 * scale0)), ch = Math.max(1, Math.round(h0 * scale0));
  const c = document.createElement('canvas'); c.width = cw; c.height = ch;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, cw, ch);
  const data = ctx.getImageData(0, 0, cw, ch).data;

  // content box: pixels that are not transparent and not (near) white
  let minX = cw, minY = ch, maxX = -1, maxY = -1, alpha = false;
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const i = (y * cw + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      if (a < 250) alpha = true;
      if (a < 24 || (r > 244 && g > 244 && b > 244)) continue;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      // colour buckets (skip greys, near black)
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (a > 200 && mx - mn > 40 && mx > 40) {
        const k = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
        const e = buckets.get(k) || { n: 0, r: 0, g: 0, b: 0 };
        e.n++; e.r += r; e.g += g; e.b += b; buckets.set(k, e);
      }
    }
  }
  if (maxX < 0) throw new Error('The image is empty (all white or transparent)');
  let sx = 0, sy = 0, sw = cw, sh = ch, trimmed = false;
  if (trim) {
    const pad = Math.round(Math.max(maxX - minX, maxY - minY) * 0.02);
    sx = Math.max(0, minX - pad); sy = Math.max(0, minY - pad);
    sw = Math.min(cw, maxX + pad + 1) - sx; sh = Math.min(ch, maxY + pad + 1) - sy;
    trimmed = sw < cw - 2 || sh < ch - 2;
  }
  const scale = Math.min(1, maxWidth / sw, maxHeight / sh);
  const ow = Math.max(1, Math.round(sw * scale)), oh = Math.max(1, Math.round(sh * scale));
  const out = document.createElement('canvas'); out.width = ow; out.height = oh;
  const octx = out.getContext('2d')!;
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(c, sx, sy, sw, sh, 0, 0, ow, oh);

  // PNG keeps transparency and sharp edges; a photo-like logo without transparency is smaller as JPEG
  let mime: PreparedLogo['mime'] = 'image/png';
  let dataUrl = out.toDataURL('image/png');
  if (!alpha && dataUrl.length > 400_000) {
    const j = document.createElement('canvas'); j.width = ow; j.height = oh;
    const jctx = j.getContext('2d')!; jctx.fillStyle = '#fff'; jctx.fillRect(0, 0, ow, oh); jctx.drawImage(out, 0, 0);
    const jpeg = j.toDataURL('image/jpeg', 0.9);
    if (jpeg.length < dataUrl.length) { dataUrl = jpeg; mime = 'image/jpeg'; }
  }
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const palette = [...buckets.values()].sort((a, b) => b.n - a.n).slice(0, 12)
    .map(e => hex(Math.round(e.r / e.n), Math.round(e.g / e.n), Math.round(e.b / e.n)))
    .filter((h, i, arr) => arr.findIndex(x => colorDistance(x, h) < 40) === i)
    .slice(0, 5);
  return { dataUrl, base64, mime, width: ow, height: oh, bytes: Math.round(base64.length * 3 / 4), palette, trimmed, originalWidth: w0, originalHeight: h0 };
}

export const hexToRgb = (h: string | null | undefined, fallback: [number, number, number] = [199, 70, 52]): [number, number, number] => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(h || '').trim());
  if (!m) return fallback;
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};
function colorDistance(a: string, b: string) {
  const x = hexToRgb(a), y = hexToRgb(b);
  return Math.sqrt((x[0] - y[0]) ** 2 + (x[1] - y[1]) ** 2 + (x[2] - y[2]) ** 2);
}
/** Text colour that reads on a fill of this colour. */
export const textOn = (rgb: [number, number, number]): [number, number, number] =>
  (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) > 170 ? [26, 26, 26] : [255, 255, 255];

// ── PDF header ──────────────────────────────────────────────────────────────
/**
 * Draw the branding block (logo, company name, address, TRN, contacts) at the top-left of a report page.
 * Without branding it prints `fallbackName` like before. Returns the y below the block.
 */
export function drawBrandHeader(doc: jsPDF, brand: ReportBrand | null | undefined, o: {
  x: number; y: number; maxWidth: number; fallbackName: string; maxLogoWidth?: number; maxLogoHeight?: number;
}): number {
  const style: HeaderStyle = brand?.headerStyle || 'NAME_ONLY';
  let y = o.y;
  let logoDrawn = false;
  if (brand?.logoDataUrl && style !== 'NAME_ONLY') {
    const w0 = brand.logoWidth || 300, h0 = brand.logoHeight || 100;
    const k = Math.min((o.maxLogoWidth ?? 180) / w0, (o.maxLogoHeight ?? 56) / h0, o.maxWidth / w0);
    const w = w0 * k, h = h0 * k;
    try {
      doc.addImage(brand.logoDataUrl, brand.logoMime === 'image/jpeg' ? 'JPEG' : 'PNG', o.x, y, w, h, undefined, 'FAST');
      y += h + 8;
      logoDrawn = true;
    } catch { /* unreadable image: print the name instead */ }
  }
  const name = (brand?.displayName || o.fallbackName || '').trim();
  if (name && (style !== 'LOGO_ONLY' || !logoDrawn)) {
    const fs = logoDrawn ? 13 : 18;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(fs); doc.setTextColor(0);
    const lines: string[] = doc.splitTextToSize(name, o.maxWidth).slice(0, 2);
    lines.forEach(l => { doc.text(l, o.x, y + fs * 0.82); y += fs * 1.18; });
    y += 2;
  }
  if (brand) {
    const details = [
      ...brand.address.split(/\r?\n/).map(l => l.trim()).filter(Boolean),
      brand.taxRegistration ? `TRN ${brand.taxRegistration}` : '',
      [brand.phone, brand.email, brand.website].filter(Boolean).join('   ·   '),
    ].filter(Boolean);
    if (details.length) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(90);
      details.forEach(d => (doc.splitTextToSize(d, o.maxWidth) as string[]).forEach(l => { doc.text(l, o.x, y + 7.5); y += 10.5; }));
      doc.setTextColor(0);
    }
  }
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(0);
  return y;
}
