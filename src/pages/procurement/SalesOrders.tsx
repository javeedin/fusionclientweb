import { buildApexUrl, buildCurrencyUrl, getFusionAuthHeaders, getFusionInstanceUrl } from '../../config/api.helper';
import { getFusionInstance } from '../../config/fusionInstance';
import { useAuth } from '../../context/AuthContext';
import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  Layout, Breadcrumb, Card, Table, Form, Input, Select, DatePicker, Button,
  Tag, Typography, Space, Tooltip, Spin, Row, Col, message, Modal, Empty, Tabs, InputNumber, Upload, Checkbox, Dropdown, Steps, Collapse, Segmented, Radio, Drawer, Divider, Statistic,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  HomeOutlined, ProfileOutlined, SearchOutlined, ReloadOutlined, ClearOutlined,
  ApiOutlined, CopyOutlined, InfoCircleOutlined, ExportOutlined, BankOutlined,
  UnorderedListOutlined, ShoppingOutlined, DollarOutlined, PrinterOutlined, DownloadOutlined,
  ReconciliationOutlined, PlusOutlined, SaveOutlined, DeleteOutlined, CloudUploadOutlined,
  DatabaseOutlined, CheckCircleTwoTone, CloseCircleTwoTone, RiseOutlined, TagsOutlined,
  CheckCircleOutlined, EyeOutlined, EditOutlined,
  SafetyCertificateOutlined, StopOutlined, SendOutlined, RollbackOutlined,
  FilePdfOutlined, FileExcelOutlined, SnippetsOutlined, ImportOutlined, TableOutlined, DownOutlined,
  ThunderboltOutlined, CarOutlined, InboxOutlined, WarningFilled, AppstoreOutlined,
  PaperClipOutlined, FileTextOutlined, LinkOutlined, FileOutlined, FileImageOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { ShipConfirmModal, PickSlipDialog } from './ConfirmPicks';
import dayjs, { type Dayjs } from 'dayjs';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer } from 'recharts';
import { getCurrentCompany } from '../../config/company.config';
import CustomerSearchBipModal from '../../components/CustomerSearchBipModal';
import { convertBipCustomerToFill, type CustomerSearchResult } from '../../services/customerSearchBip.service';
import { ORACLE_SOAP_CONFIG } from '../../config/api.config';

const { Content } = Layout;

// Get Fusion base URL from current company configuration
const getFusionBase = () => {
  const company = getCurrentCompany();
  return company.fusionBaseUrl ? `${company.fusionBaseUrl}/fscmRestApi/resources/11.13.18.05` : '';
};

// Get Fusion host (without API path) from current company configuration
const getFusionHost = () => {
  const company = getCurrentCompany();
  return company.fusionBaseUrl || '';
};

const { Title, Text } = Typography;

const _isElectron = !!(window as unknown as { electron?: unknown; electronAPI?: unknown }).electron
  || !!(window as unknown as { electronAPI?: unknown }).electronAPI;
const FUSION_BASE = `${getFusionBase()}`;
// NOTE: Do NOT use a module-level HEADERS constant - credentials are stored after login.
// Instead, call getFusionAuthHeaders() on each fetch to get fresh credentials.
const getHeaders = () => getFusionAuthHeaders();
const APEX_BASE = buildApexUrl('');
const PAGE_LIMIT = 500;

const REDWOOD = {
  primary: '#C74634', success: '#1D7B4D', warning: '#B07700', info: '#0572CE',
  error: '#D93025', teal: '#00918A', purple: '#7245A6',
  neutral100: '#F7F7F7', neutral200: '#E5E5E5', neutral300: '#C7C7C7',
  neutral600: '#6B6B6B', neutral900: '#1A1A1A', surface: '#FFFFFF',
};

// ── Helpers ──────────────────────────────────────────────────────────────────
const fmtDate = (d?: string) => { if (!d) return '—'; try { return dayjs(d).format('D-MMM-YYYY'); } catch { return d; } };
const fmtDateTime = (d?: string) => { if (!d) return '—'; try { return dayjs(d).format('D-MMM-YYYY HH:mm'); } catch { return d; } };
const fmtQty = (v?: number | null) => (v == null ? '—' : new Intl.NumberFormat('en-US').format(v));
const num = (v: any) => { const n = Number(v); return isNaN(n) ? 0 : n; };
const fmt = (v: any) => (v == null || v === '' ? '—' : String(v));
const norm = (s: string) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const pf = (r: any, keys: string[]) => { for (const k of keys) { const v = r?.[k]; if (v != null && v !== '') return v; } return undefined; };

// Which line-level child collections to surface as tabs (rest hidden), in order.
// `customer:true` merges billTo/shipTo into one tab; lineDetails shows as "Billing".
const LINE_TAB_DEFS: { key: string; label: string; match?: string[]; customer?: boolean }[] = [
  { key: 'additionalInformation', label: 'Additional Information', match: ['additionalinformation', 'additionalinfo'] },
  { key: 'attachments', label: 'Attachments', match: ['attachments', 'attachment'] },
  { key: 'customers', label: 'Customers', customer: true },
  { key: 'charges', label: 'Charges', match: ['charges', 'charge'] },
  { key: 'holds', label: 'Holds', match: ['holds', 'hold'] },
  { key: 'billing', label: 'Billing', match: ['linedetails', 'linedetail'] },
  { key: 'lotSerials', label: 'Lot Serials', match: ['lotserials', 'lotserial'] },
  { key: 'notes', label: 'Notes', match: ['notes', 'note'] },
];
const CUST_BILL_MATCH = ['billtocustomer', 'billto'];
const CUST_SHIP_MATCH = ['shiptocustomer', 'shipto'];

const mapLimit = async <T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> => {
  const out: R[] = new Array(items.length); let idx = 0;
  const worker = async () => { while (idx < items.length) { const c = idx++; out[c] = await fn(items[c]); } };
  await Promise.all(Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, worker));
  return out;
};

// Fusion PODs can be unreachable (VPN / wrong region) — without a timeout the
// request hangs and the page spins forever. Abort after 30s with a clear error.
const FETCH_TIMEOUT_MS = 30000;
const fetchWithTimeout = async (url: string, init?: RequestInit): Promise<Response> => {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      const host = (() => { try { return new URL(url, window.location.href).host; } catch { return url; } })();
      throw new Error(`Request timed out after ${FETCH_TIMEOUT_MS / 1000}s — ${host} did not respond (check the POD/instance is reachable).`);
    }
    throw e;
  } finally {
    clearTimeout(t);
  }
};

// maxRows caps the paging so a huge result set (or Fusion's slow deep-offset
// paging) can't make the page grind forever — it stops once the cap is reached.
const fetchAllPages = async (baseUrl: string, maxRows = Infinity): Promise<any[]> => {
  const stripped = baseUrl.replace(/[?&]limit=\d+/gi, '').replace(/[?&]offset=\d+/gi, '').replace(/\?&/, '?').replace(/&&/g, '&');
  const all: any[] = [];
  let offset = 0;
  while (true) {
    const sep = stripped.includes('?') ? '&' : '?';
    const url = `${stripped}${sep}limit=${PAGE_LIMIT}&offset=${offset}`;
    const r = await fetchWithTimeout(url, { headers: getHeaders() });
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);
    const d = await r.json();
    const items: any[] = Array.isArray(d) ? d : (d.items ?? []);
    all.push(...items);
    if (!d.hasMore || items.length < PAGE_LIMIT || all.length >= maxRows) break;
    offset += PAGE_LIMIT;
  }
  return all;
};

// Hide id/href columns and (for detail views) null/empty ones.
const isIdKey = (k: string) => /Id$/.test(k) || /Id[0-9]+$/.test(k) || k === 'links';
const isEmpty = (v: any) => v == null || v === '' || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v ?? {}).length === 0);
const humanize = (k: string) => k.replace(/([A-Z])/g, ' $1').replace(/^ /, '').replace(/\bU O M\b/, 'UOM').replace(/\bP O\b/, 'PO');

// EFF plumbing / row-audit columns that Fusion returns alongside the real user
// segments — never shown or uploaded. Everything else on an EffB VO is a segment.
const EFF_SYS_ATTR = /^(links|ContextCode|Category|CategoryCode|CategoryName|ObjectVersionNumber|CreatedBy|CreationDate|LastUpdateDate|LastUpdatedBy|LastUpdateLogin|ParentEntity|CorpCurrencyCode|CurcyConvRateType|CurrencyCode|SetId|.*Id|_.*)$/i;
const isEffSegment = (name?: string) => !!name && !EFF_SYS_ATTR.test(name);

const renderVal = (k: string, v: any): React.ReactNode => {
  if (isEmpty(v)) return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'object') return JSON.stringify(v);
  if (/Date$/.test(k) || k.endsWith('DateTime') || k === 'TransactionOn' || k === 'PricedOn') return fmtDateTime(String(v));
  return String(v);
};

// Build dynamic columns from rows: drop id/href columns and any column empty
// across every row. `exclude` skips keys already rendered elsewhere.
const dynamicColumns = (items: any[], exclude: string[] = []): ColumnsType<any> => {
  const ex = new Set(exclude);
  const keys: string[] = []; const seen = new Set<string>();
  items.forEach(it => Object.keys(it ?? {}).forEach(k => {
    if (seen.has(k) || isIdKey(k) || ex.has(k)) return;
    if (items.some(row => !isEmpty(row?.[k]))) { seen.add(k); keys.push(k); }
  }));
  return keys.map(k => ({
    title: humanize(k), dataIndex: k, width: 170, ellipsis: true,
    render: (v: any) => <Text style={{ fontSize: 12 }}>{renderVal(k, v)}</Text>,
  }));
};

// ── Line EFF (extensible flexfield) discovery ────────────────────────────────
// The DOO line EFF is exposed on the additionalInformation child via a nested
// FulfillLineEffB<Context>privateVO array keyed by ContextCode, one field per
// segment API name. Config is instance-specific, so discover it from the
// describe metadata and map "lot"/"cost" to segments by name. Returns null when
// nothing suitable is configured (then no EFF is sent — a safe no-op).
interface EffMeta { category: string; voName: string; contextCode: string; lotSeg?: string; costSeg?: string; segs: { name: string; label: string }[] }
const parseEffDescribe = (d: any): EffMeta | null => {
  try {
    let found: { voName: string; node: any } | null = null;
    const visit = (o: any) => {
      if (!o || typeof o !== 'object' || found) return;
      for (const k of Object.keys(o)) {
        if (/EffB.+privateVO$/i.test(k)) { found = { voName: k, node: (o as any)[k] }; return; }
        visit((o as any)[k]);
      }
    };
    visit(d);
    if (!found) return null;
    const node: any = found.node;
    const attrObjs: any[] = node?.attributes ?? node?.Attributes ?? (Array.isArray(node) ? node : []);
    const segs: { name: string; label: string }[] = [];
    for (const a of attrObjs) {
      const name = a?.name ?? a?.Name;
      const label = a?.title ?? a?.label ?? a?.Title ?? name;
      if (isEffSegment(name)) segs.push({ name: String(name), label: String(label) });
    }
    const ctxMatch = found.voName.match(/EffB(.+)privateVO$/i);
    const contextCode = node?.contextCode ?? node?.ContextCode ?? (ctxMatch ? ctxMatch[1].replace(/_+/g, ' ').trim() : '');
    const lotSeg = segs.find(s => /lot/i.test(s.name) || /lot/i.test(s.label))?.name;
    const costSeg = segs.find(s => /cost/i.test(s.name) || /cost/i.test(s.label))?.name;
    if (!lotSeg && !costSeg) return null;
    return { category: 'DOO_FULFILL_LINES_ADD_INFO', voName: found.voName, contextCode, lotSeg, costSeg, segs };
  } catch { return null; }
};

// General EFF context discovery — returns every EffB<Context>privateVO node in a
// describe response with all of its editable segments (used for header + line
// "Additional Information" upload). category is the CategoryCode to send back.
interface EffCtx { category: string; voName: string; contextCode: string; segs: { name: string; label: string; type?: string }[] }
const parseEffContexts = (d: any, category: string): EffCtx[] => {
  const out: EffCtx[] = [];
  const seen = new Set<string>();
  const visit = (o: any) => {
    if (!o || typeof o !== 'object') return;
    for (const k of Object.keys(o)) {
      if (/EffB.+privateVO$/i.test(k) && !seen.has(k)) {
        seen.add(k);
        const node: any = (o as any)[k];
        const attrObjs: any[] = node?.attributes ?? node?.Attributes ?? (Array.isArray(node) ? node : []);
        const segs: { name: string; label: string; type?: string }[] = [];
        for (const a of attrObjs) {
          const name = a?.name ?? a?.Name;
          const label = a?.title ?? a?.label ?? a?.Title ?? name;
          const type = a?.type ?? a?.Type;
          // Skip system/id columns — keep only user-facing flexfield segments.
          if (isEffSegment(name)) segs.push({ name: String(name), label: String(label), type });
        }
        const ctxMatch = k.match(/EffB(.+)privateVO$/i);
        const contextCode = node?.contextCode ?? node?.ContextCode ?? (ctxMatch ? ctxMatch[1].replace(/_+/g, ' ').trim() : '');
        if (segs.length) out.push({ category, voName: k, contextCode, segs });
      } else visit((o as any)[k]);
    }
  };
  visit(d);
  return out;
};

// Known EFF contexts for this Fusion instance (from the flexfield setup) — used
// as a fallback when the live `describe` metadata can't be parsed, so the create/
// edit form still shows the fields and uploads with the correct VO/context.
const FALLBACK_HDR_EFF: EffCtx[] = [
  { category: 'DOO_HEADERS_ADD_INFO', voName: 'HeaderEffBTransaction__CodeprivateVO', contextCode: 'Transaction Code',
    segs: [{ name: 'transactionCode', label: 'Transaction Code' }, { name: 'customer', label: 'customer' }, { name: 'branchsalesorder', label: 'Branch Sales Order' }, { name: 'pricelist', label: 'PRICELIST' }, { name: 'branchBusinessUnit', label: 'BRANCH BUSINESS UNIT' }] },
];
const FALLBACK_LINE_EFF: EffCtx[] = [
  { category: 'DOO_FULFILL_LINES_ADD_INFO', voName: 'FulfillLineEffBaddinfoprivateVO', contextCode: 'addinfo',
    segs: [{ name: 'itemcost', label: 'Item Cost' }, { name: 'itemlot', label: 'Item Lot' }, { name: 'lotqty', label: 'Lot Qty' }] },
];
const FALLBACK_LINE_EFF_META: EffMeta = {
  category: 'DOO_FULFILL_LINES_ADD_INFO', voName: 'FulfillLineEffBaddinfoprivateVO', contextCode: 'addinfo',
  lotSeg: 'itemlot', costSeg: 'itemcost', segs: FALLBACK_LINE_EFF[0].segs,
};

const statusTag = (s?: string, code?: string) => {
  if (!s && !code) return <Tag>—</Tag>;
  const up = String(code || s).toUpperCase();
  const color = up.includes('CANCEL') ? 'red' : up.includes('CLOSE') ? 'default'
    : up.includes('DRAFT') ? 'gold' : up.includes('SHIP') || up.includes('FULFILL') || up.includes('COMPLETE') ? 'green'
    : up.includes('PROGRESS') || up.includes('AWAIT') ? 'blue' : 'geekblue';
  return <Tag color={color} style={{ fontSize: 11 }}>{s ?? code}</Tag>;
};

// ── All-fields modal (hide null & id columns) ────────────────────────────────
const AllFieldsModal: React.FC<{ title: string; row: any | null; onClose: () => void }> = ({ title, row, onClose }) => (
  <Modal title={<Space><ProfileOutlined style={{ color: REDWOOD.info }} /> {title}</Space>}
    open={!!row} onCancel={onClose} maskClosable={false} width={920}
    footer={<Button onClick={onClose}>Close</Button>}>
    {row && (() => {
      const entries = Object.entries(row).filter(([k, v]) => !isIdKey(k) && !isEmpty(v));
      return (
        <div style={{ maxHeight: '65vh', overflowY: 'auto' }}>
          <Row gutter={[12, 0]}>
            {entries.map(([k, v]) => (
              <Col key={k} xs={24} sm={12} md={8}>
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: REDWOOD.neutral600, textTransform: 'uppercase', letterSpacing: '0.03em' }}>{humanize(k)}</div>
                  <div style={{ fontSize: 12, color: REDWOOD.neutral900, marginTop: 2, wordBreak: 'break-word' }}>{renderVal(k, v)}</div>
                </div>
              </Col>
            ))}
          </Row>
        </div>
      );
    })()}
  </Modal>
);

const fmtAmount = (v?: number | null, ccy?: string) => {
  if (v == null) return '—';
  const s = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v));
  return ccy ? `${s} ${ccy}` : s;
};

const totalsHref = (order: any) => order?.links?.find((l: any) => l.name === 'totals')?.href
  ?? (order?.HeaderId ? `${FUSION_BASE}/salesOrdersForOrderHub/${order.HeaderId}/child/totals` : '');

// Classify a total line so the summary can order & label it like an order.
const totalRank = (t: any) => {
  const c = String(t.TotalCode ?? t.TotalName ?? '').toUpperCase();
  if (/SUB.?TOTAL|LINE|ITEM/.test(c)) return 0;
  if (/DISC/.test(c)) return 1;
  if (/SHIP|FREIGHT|HANDLING/.test(c)) return 2;
  if (/TAX/.test(c)) return 3;
  if (/CHARGE|MISC/.test(c)) return 4;
  return 5;
};
const isGrandTotal = (t: any) => t.PrimaryFlag
  || (/ORDER|GRAND|NET/.test(String(t.TotalCode ?? '').toUpperCase()) && !/TAX|SHIP|DISC|SUB|LINE|CHARGE|MARGIN/.test(String(t.TotalCode ?? '').toUpperCase()));

// Invoice-style order total summary (right-aligned rows + emphasized total).
const TotalsSummary: React.FC<{ items: any[]; currency?: string }> = ({ items, currency }) => {
  if (!items.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No totals" style={{ padding: 20 }} />;
  const ccy = items.find(i => i.CurrencyCode)?.CurrencyCode ?? currency;
  const grand = items.find(isGrandTotal);
  const rows = items.filter(i => i !== grand).sort((a, b) => totalRank(a) - totalRank(b));
  return (
    <div style={{ maxWidth: 400, marginLeft: 'auto' }}>
      {rows.map((t, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '6px 0', borderBottom: `1px dashed ${REDWOOD.neutral200}` }}>
          <span style={{ color: REDWOOD.neutral600, fontSize: 12.5 }}>
            {t.TotalName ?? t.TotalCode}
            {t.EstimatedFlag && <Tag color="gold" style={{ fontSize: 9, marginLeft: 6, lineHeight: '15px' }}>est</Tag>}
          </span>
          <span style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums', color: REDWOOD.neutral900 }}>{fmtAmount(t.TotalAmount, t.CurrencyCode ?? ccy)}</span>
        </div>
      ))}
      {grand && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, padding: '11px 0 2px', marginTop: 4, borderTop: `2px solid ${REDWOOD.neutral300}` }}>
          <span style={{ fontWeight: 700, fontSize: 13.5, color: REDWOOD.neutral900 }}>{grand.TotalName ?? 'Order Total'}</span>
          <span style={{ fontWeight: 800, fontSize: 18, color: REDWOOD.success, fontVariantNumeric: 'tabular-nums' }}>{fmtAmount(grand.TotalAmount, grand.CurrencyCode ?? ccy)}</span>
        </div>
      )}
      {ccy && <div style={{ textAlign: 'right', marginTop: 4 }}><Text type="secondary" style={{ fontSize: 11 }}>Amounts in {ccy}</Text></div>}
    </div>
  );
};

// Fetches totals for an order (used by the inline section and the modal).
const useTotals = (order: any | null, active: boolean) => {
  const href = totalsHref(order);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    if (!href) return;
    setLoading(true); setError('');
    try { setItems(await fetchAllPages(href)); }
    catch (e: any) { setError(e.message); setItems([]); }
    finally { setLoading(false); }
  }, [href]);
  useEffect(() => { if (active && order) load(); }, [active, order, load]);
  return { href, items, loading, error, load };
};

// ── Order totals drill (…/child/totals) — modal for the search grid ──────────
const TotalsModal: React.FC<{ order: any | null; onClose: () => void }> = ({ order, onClose }) => {
  const { href, items, loading, error, load } = useTotals(order, !!order);
  return (
    <Modal open={!!order} onCancel={onClose} maskClosable={false} width={560}
      title={<Space><DollarOutlined style={{ color: REDWOOD.success }} /> Order Total
        <Tag color="volcano">{order?.OrderNumber}</Tag></Space>}
      footer={<Space>
        <Tooltip title={<span style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}><b>GET</b> {href}</span>}>
          <Button size="small" type="text" icon={<ApiOutlined />} style={{ color: REDWOOD.info, marginRight: 'auto' }} />
        </Tooltip>
        <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={load}>Reload</Button>
        <Button onClick={onClose}>Close</Button>
      </Space>}>
      {loading ? <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
        : error ? <div style={{ color: REDWOOD.error, fontSize: 12 }}><InfoCircleOutlined style={{ marginRight: 6 }} />{error}</div>
        : <TotalsSummary items={items} currency={order?.TransactionalCurrencyCode ?? order?.AppliedCurrencyCode} />}
    </Modal>
  );
};

// Aggregate one line-level child collection (e.g. lotSerials) across every
// order line. The child rows carry no item context, so we prepend the line's
// Line #, Product, Description and UOM from the parent line.
const MergedLineChildTab: React.FC<{ lines: any[]; name: string; overrides?: { match: string[]; render: (v: any, row: any) => React.ReactNode }[] }> = ({ lines, name, overrides }) => {
  const [items, setItems] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const targets = useMemo(() =>
    lines.map(l => ({ line: l, href: l.links?.find((x: any) => x.name === name)?.href }))
      .filter(t => t.href) as { line: any; href: string }[],
  [lines, name]);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const results = await mapLimit(targets, 6, async (t) => {
        try {
          const rows = await fetchAllPages(t.href);
          return rows.map(r => ({ ...r,
            _line: t.line.DisplayLineNumber ?? t.line.LineNumber,
            _item: t.line.ProductNumber, _desc: t.line.ProductDescription, _uom: t.line.OrderedUOM }));
        } catch { return []; }
      });
      setItems(results.flat());
    } catch (e: any) { setError(e.message); setItems([]); }
    finally { setLoading(false); }
  }, [targets]);
  useEffect(() => { load(); }, [load]);

  const cols = useMemo<ColumnsType<any>>(() => ([
    { title: 'Line', dataIndex: '_line', width: 60, align: 'center', fixed: 'left', render: v => <Tag color="blue" style={{ fontSize: 11 }}>{v ?? '—'}</Tag> },
    { title: 'Product', dataIndex: '_item', width: 130, fixed: 'left', render: v => <Text strong style={{ fontSize: 12, color: REDWOOD.info }}>{v ?? '—'}</Text> },
    { title: 'Description', dataIndex: '_desc', width: 240, ellipsis: true, render: v => <Text style={{ fontSize: 12 }}>{v ?? '—'}</Text> },
    ...dynamicColumns((items ?? []).map(({ _line, _item, _desc, _uom, ...rest }) => rest)).map((col: any) => {
      const ov = overrides?.find(o => o.match.includes(norm(String(col.dataIndex ?? ''))));
      return ov ? { ...col, render: (v: any, row: any) => ov.render(v, row) } : col;
    }),
  ]), [items, overrides]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <Text type="secondary" style={{ marginRight: 'auto', fontSize: 11 }}>Merged from {targets.length} line{targets.length !== 1 ? 's' : ''}</Text>
        <Tooltip title={<span style={{ fontFamily: 'monospace', fontSize: 11 }}><b>GET</b> …/lines/&#123;line&#125;/child/{name}</span>}>
          <Button size="small" type="text" icon={<ApiOutlined />} style={{ color: REDWOOD.info }} />
        </Tooltip>
        <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={load}>Reload</Button>
      </div>
      {loading ? <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
        : error ? <div style={{ color: REDWOOD.error, fontSize: 12 }}><InfoCircleOutlined style={{ marginRight: 6 }} />{error}</div>
        : items && items.length > 0
          ? <Table size="small" columns={cols} dataSource={items} rowKey={(_, i) => `${name}-${i}`}
              pagination={items.length > 25 ? { pageSize: 25, size: 'small' } : false} scroll={{ x: 'max-content', y: 380 }} />
          : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={`No ${name} across the order lines`} style={{ padding: 24 }} />}
    </div>
  );
};

// Merged Bill-To + Ship-To customer tab (two sections).
const CustomerTab: React.FC<{ lines: any[]; billName?: string; shipName?: string }> = ({ lines, billName, shipName }) => {
  const Section: React.FC<{ title: string; name: string }> = ({ title, name }) => (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <ProfileOutlined style={{ color: REDWOOD.primary }} />
        <Text strong style={{ fontSize: 13 }}>{title}</Text>
      </div>
      <MergedLineChildTab lines={lines} name={name} />
    </div>
  );
  if (!billName && !shipName) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No customer details" style={{ padding: 24 }} />;
  return (
    <div>
      {billName && <Section title="Bill-To Customer" name={billName} />}
      {shipName && <Section title="Ship-To Customer" name={shipName} />}
    </div>
  );
};

// Actual costing tab: per-line price + an order-level margin summary.
const ActualCostingTab: React.FC<{ lines: any[]; currency?: string }> = ({ lines, currency }) => {
  const totalPrice = (l: any) => (l.ExtendedAmount != null ? num(l.ExtendedAmount) : num(l.OrderedQuantity) * num(l.UnitSellingPrice));
  const totExt = lines.reduce((s, l) => s + totalPrice(l), 0);
  const totCost = lines.reduce((s, l) => s + num(l.EstimateFulfillmentCost), 0);
  const totMargin = lines.reduce((s, l) => s + (l.EstimateMargin != null ? num(l.EstimateMargin) : 0), 0);
  const marginPct = totExt ? (totMargin / totExt) * 100 : null;
  const marginColor = totMargin < 0 ? REDWOOD.error : REDWOOD.success;

  const marginOf = (v?: any) => (v == null ? '—' : <Text strong style={{ color: num(v) < 0 ? REDWOOD.error : REDWOOD.success, fontVariantNumeric: 'tabular-nums' }}>{fmtAmount(v, currency)}</Text>);

  const cols: ColumnsType<any> = [
    { title: 'Line', dataIndex: 'DisplayLineNumber', width: 60, align: 'center', render: (v, r) => <Tag color="blue" style={{ fontSize: 11 }}>{v ?? r.LineNumber ?? '—'}</Tag> },
    { title: 'Item', dataIndex: 'ProductNumber', width: 130, render: v => <Text strong style={{ color: REDWOOD.info, fontSize: 12 }}>{v ?? '—'}</Text> },
    { title: 'Description', dataIndex: 'ProductDescription', width: 240, ellipsis: true, render: v => <Text style={{ fontSize: 12 }}>{v ?? '—'}</Text> },
    { title: 'Qty', dataIndex: 'OrderedQuantity', width: 80, align: 'right', render: (v, r) => `${fmtQty(v)}${r.OrderedUOM ? ' ' + r.OrderedUOM : ''}` },
    { title: 'Unit Price', dataIndex: 'UnitSellingPrice', width: 100, align: 'right', render: v => (v == null ? '—' : fmtAmount(v, currency)) },
    { title: 'Total Price', key: 'tot', width: 120, align: 'right', render: (_, r) => <Text strong style={{ color: REDWOOD.primary, fontVariantNumeric: 'tabular-nums' }}>{fmtAmount(totalPrice(r), currency)}</Text> },
    { title: 'Est Fulfillment Cost', dataIndex: 'EstimateFulfillmentCost', width: 130, align: 'right', render: v => (v == null ? '—' : fmtAmount(v, currency)) },
    { title: 'Est Margin', dataIndex: 'EstimateMargin', width: 120, align: 'right', render: marginOf },
  ];

  const MRow: React.FC<{ label: string; value: React.ReactNode; strong?: boolean; color?: string }> = ({ label, value, strong, color }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, padding: '7px 0', borderBottom: `1px dashed ${REDWOOD.neutral200}` }}>
      <span style={{ color: REDWOOD.neutral600, fontSize: 12.5, fontWeight: strong ? 700 : 400 }}>{label}</span>
      <span style={{ fontSize: strong ? 16 : 13, fontWeight: strong ? 800 : 500, color: color ?? REDWOOD.neutral900, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );

  return (
    <div>
      <Table size="small" columns={cols} dataSource={lines} rowKey={(r, i) => `${r.LineId ?? r.FulfillLineId ?? i}`}
        pagination={lines.length > 25 ? { pageSize: 25, size: 'small' } : false} scroll={{ x: 980, y: 320 }}
        summary={(data) => (
          <Table.Summary fixed>
            <Table.Summary.Row style={{ background: REDWOOD.neutral100 }}>
              <Table.Summary.Cell index={0} colSpan={3}><Text strong>Total ({data.length})</Text></Table.Summary.Cell>
              <Table.Summary.Cell index={3} />
              <Table.Summary.Cell index={4} />
              <Table.Summary.Cell index={5} align="right"><Text strong style={{ color: REDWOOD.primary }}>{fmtAmount(totExt, currency)}</Text></Table.Summary.Cell>
              <Table.Summary.Cell index={6} align="right"><Text strong>{fmtAmount(totCost, currency)}</Text></Table.Summary.Cell>
              <Table.Summary.Cell index={7} align="right"><Text strong style={{ color: marginColor }}>{fmtAmount(totMargin, currency)}</Text></Table.Summary.Cell>
            </Table.Summary.Row>
          </Table.Summary>
        )} />

      {/* Order margin */}
      <div style={{ maxWidth: 420, marginLeft: 'auto', marginTop: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: REDWOOD.neutral600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>Order Margin</div>
        <MRow label="Extended Amount (revenue)" value={fmtAmount(totExt, currency)} />
        <MRow label="Estimate Fulfillment Cost" value={fmtAmount(totCost, currency)} />
        <MRow label="Estimate Margin" strong color={marginColor}
          value={<span>{fmtAmount(totMargin, currency)}{marginPct != null && <Text style={{ fontSize: 12, marginLeft: 8, color: marginColor }}>({marginPct.toFixed(1)}%)</Text>}</span>} />
      </div>
    </div>
  );
};

// ── AR invoice drill (receivablesInvoices) by billing transaction number ─────
const AR_RES = 'receivablesInvoices';
const AR_LINES = 'receivablesInvoiceLines';

// Small labelled field (label right-aligned, value bold) — mirrors the AR form.
const ARField: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div style={{ display: 'flex', gap: 10, marginBottom: 7, fontSize: 12.5, alignItems: 'baseline' }}>
    <span style={{ color: REDWOOD.neutral600, minWidth: 118, textAlign: 'right', flexShrink: 0 }}>{label}</span>
    <span style={{ color: REDWOOD.neutral900, fontWeight: 600, wordBreak: 'break-word' }}>{value ?? '—'}</span>
  </div>
);
const ARSection: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div style={{ marginBottom: 18 }}>
    <div style={{ fontSize: 13.5, fontWeight: 700, color: REDWOOD.primary, borderBottom: `2px solid ${REDWOOD.primary}22`, paddingBottom: 5, marginBottom: 12 }}>{title}</div>
    {children}
  </div>
);

const ARInvoiceDialog: React.FC<{ txn: string | null; onClose: () => void }> = ({ txn, onClose }) => {
  const [inv, setInv] = useState<any | null>(null);
  const [lines, setLines] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [allOpen, setAllOpen] = useState(false);
  const [dists, setDists] = useState<any[]>([]);
  const [acctOpen, setAcctOpen] = useState(false);

  const url = txn ? `${FUSION_BASE}/${AR_RES}?q=${encodeURIComponent(`TransactionNumber=${txn}`)}&limit=1` : '';
  const load = useCallback(async () => {
    if (!url) return;
    setLoading(true); setError(''); setInv(null); setLines([]); setDists([]);
    try {
      const r = await fetch(url, { headers: getHeaders() });
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);
      const d = await r.json();
      const h = (d.items ?? [])[0];
      if (!h) { setError(`No AR invoice found for transaction ${txn}`); return; }
      setInv(h);
      const lh = h.links?.find((l: any) => l.name === AR_LINES)?.href
        ?? (h.CustomerTransactionId ? `${FUSION_BASE}/${AR_RES}/${h.CustomerTransactionId}/child/${AR_LINES}` : '');
      let ld: any[] = [];
      if (lh) { try { ld = await fetchAllPages(lh); setLines(ld); } catch { /* lines optional */ } }

      // Accounting distributions — the source of tax / freight / charges amounts.
      const isAcct = (n: string) => /account|distribut|journal/i.test(n ?? '');
      const hAcct = (h.links ?? []).find((l: any) => l.rel === 'child' && isAcct(l.name));
      let dl: any[] = [];
      try {
        if (hAcct?.href) {
          dl = await fetchAllPages(hAcct.href);
        } else {
          const lname = (ld[0]?.links ?? []).find((l: any) => l.rel === 'child' && isAcct(l.name))?.name;
          if (lname) {
            const res = await mapLimit(ld, 6, async (l: any) => {
              const href = l.links?.find((x: any) => x.name === lname)?.href;
              if (!href) return [];
              try { return await fetchAllPages(href); } catch { return []; }
            });
            dl = res.flat();
          }
        }
      } catch { /* accounting optional */ }
      setDists(dl);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [url, txn]);
  useEffect(() => { if (txn) load(); }, [txn, load]);

  const ccy = pf(inv, ['InvoiceCurrencyCode', 'CurrencyCode']);
  const amt = (v: any) => fmtAmount(v, ccy);

  // Line classification → header amounts (fall back to header fields).
  const typeOf = (l: any) => String(pf(l, ['LineType', 'TransactionLineType', 'LineTypeCode']) ?? 'LINE').toUpperCase();
  const amtOf = (l: any) => num(pf(l, ['LineAmount', 'Amount', 'ExtendedAmount', 'RevenueAmount']));
  const productLines = lines.filter(l => { const t = typeOf(l); return !t.includes('TAX') && !t.includes('FREIGHT') && !t.includes('CHARGE'); });
  const linesTotal = productLines.reduce((s, l) => s + amtOf(l), 0);

  // Amounts from accounting distributions, grouped by AR account class:
  // REC = receivable (= transaction total), REV = revenue, TAX, FREIGHT, CHARGES.
  const nz = (v: any) => (v == null || v === '' || isNaN(Number(v)) ? undefined : Number(v));
  const distClass = (d: any) => String(pf(d, ['AccountClass', 'AccountClassCode', 'ClassCode', 'AccountClassMeaning']) ?? '').toUpperCase();
  const distAmt = (d: any) => Math.abs(num(pf(d, ['Amount', 'AccountedAmount', 'AmountDr', 'DistributionAmount', 'LineAmount'])));
  const distSum = (test: (c: string) => boolean) => dists.filter(d => test(distClass(d))).reduce((s, d) => s + distAmt(d), 0);
  const dOn = dists.length > 0;
  const lineTaxSum = lines.filter(l => typeOf(l).includes('TAX')).reduce((s, l) => s + amtOf(l), 0);
  const taxTotal = dOn ? distSum(c => c.includes('TAX')) : (nz(pf(inv, ['TaxAmount', 'TotalTax'])) ?? lineTaxSum);
  const freight = dOn ? distSum(c => c.includes('FREIGHT')) : (nz(pf(inv, ['FreightAmount', 'Freight'])) ?? 0);
  const charges = dOn ? distSum(c => c.includes('CHARGE')) : (nz(pf(inv, ['ChargeAmount', 'Charges'])) ?? 0);
  const recTotal = dOn ? distSum(c => c.includes('REC')) : 0;
  const total = recTotal || nz(pf(inv, ['TransactionTotal', 'InvoiceAmount', 'TotalAmount', 'EnteredAmount'])) || (linesTotal + taxTotal + freight + charges);

  const shipToHeader = pf(inv, ['ShipToCustomerName', 'ShipToPartyName']);

  const lineCols: ColumnsType<any> = [
    { title: 'Line', dataIndex: 'x', width: 55, align: 'center', render: (_, l) => <Tag color="blue" style={{ fontSize: 11 }}>{pf(l, ['LineNumber', 'CustomerTrxLineNumber']) ?? '—'}</Tag> },
    { title: 'Item', width: 120, render: (_, l) => <Text strong style={{ color: REDWOOD.info, fontSize: 12 }}>{pf(l, ['ItemNumber', 'InventoryItemNumber', 'Item']) ?? '—'}</Text> },
    { title: 'Description', width: 260, ellipsis: true, render: (_, l) => <Text style={{ fontSize: 12 }}>{pf(l, ['Description', 'LineDescription']) ?? '—'}</Text> },
    { title: 'UOM', width: 70, render: (_, l) => pf(l, ['UnitOfMeasure', 'UOM', 'UOMCode']) ?? '—' },
    { title: 'Quantity', width: 90, align: 'right', render: (_, l) => fmtQty(pf(l, ['Quantity', 'InvoicedQuantity'])) },
    { title: 'Unit Price', width: 100, align: 'right', render: (_, l) => amt(pf(l, ['UnitSellingPrice', 'UnitPrice', 'UnitStandardPrice'])) },
    { title: 'Amount', width: 120, align: 'right', render: (_, l) => <Text strong style={{ fontVariantNumeric: 'tabular-nums' }}>{amt(amtOf(l))}</Text> },
    { title: 'Sales Order', width: 150, render: (_, l) => pf(l, ['SalesOrderNumber', 'SalesOrder', 'InterfaceLineAttribute1']) ?? '—' },
    { title: 'Date', width: 110, render: (_, l) => fmtDate(pf(l, ['SalesOrderDate', 'LineDate', 'RuleStartDate'])) },
    { title: 'Ship-to Customer', width: 180, ellipsis: true, render: (_, l) => pf(l, ['ShipToCustomerName']) ?? shipToHeader ?? '—' },
    { title: 'Tax Classification', width: 140, ellipsis: true, render: (_, l) => pf(l, ['TaxClassificationCode', 'TaxClassification']) ?? '—' },
  ];

  return (
    <Modal open={!!txn} onCancel={onClose} maskClosable={false} width={1120} style={{ top: 16 }}
      footer={<Button onClick={onClose}>Close</Button>}
      title={<Space><DollarOutlined style={{ color: REDWOOD.primary }} /> AR Invoice
        <Tag color="volcano">{pf(inv, ['TransactionNumber']) ?? txn}</Tag>
        {inv && <Tag color={/complete/i.test(String(pf(inv, ['Status', 'TransactionStatus']) ?? '')) ? 'green' : 'blue'}>{pf(inv, ['Status', 'TransactionStatus', 'PaymentStatus', 'StatusCode'])}</Tag>}</Space>}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 10, alignItems: 'center' }}>
        <Tooltip title={<span style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}><b>GET</b> {decodeURIComponent(url)}</span>}>
          <Button size="small" type="text" icon={<ApiOutlined />} style={{ color: REDWOOD.info }} />
        </Tooltip>
        {dists.length > 0 && <Button size="small" icon={<ReconciliationOutlined />} style={{ borderColor: REDWOOD.purple, color: REDWOOD.purple }} onClick={() => setAcctOpen(true)}>View Accounting ({dists.length})</Button>}
        {inv && <Button size="small" icon={<ProfileOutlined />} onClick={() => setAllOpen(true)}>All fields</Button>}
        <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={load}>Reload</Button>
      </div>

      {loading ? <div style={{ textAlign: 'center', padding: 50 }}><Spin size="large" /></div>
        : error ? <div style={{ padding: 20, color: REDWOOD.error, background: REDWOOD.error + '10', borderRadius: 6 }}><InfoCircleOutlined style={{ marginRight: 8 }} />{error}</div>
        : !inv ? <Empty description="No invoice" style={{ padding: 40 }} />
        : (
          <>
            {/* General Information */}
            <ARSection title="General Information">
              <Row gutter={[16, 0]}>
                <Col xs={24} md={9}>
                  <ARField label="Business Unit" value={pf(inv, ['BusinessUnit', 'BusinessUnitName'])} />
                  <ARField label="Transaction Source" value={pf(inv, ['TransactionSource', 'TransactionBatchSource', 'BatchSource', 'TransactionSourceName'])} />
                  <ARField label="Transaction Type" value={pf(inv, ['TransactionType', 'TransactionTypeName'])} />
                  <ARField label="Transaction Number" value={<Text strong>{pf(inv, ['TransactionNumber'])}</Text>} />
                  <ARField label="Sales Order" value={pf(inv, ['SalesOrderNumber']) ?? pf(productLines[0], ['SalesOrderNumber', 'SalesOrder', 'InterfaceLineAttribute1'])} />
                  <ARField label="Status" value={pf(inv, ['Status', 'TransactionStatus', 'PaymentStatus', 'StatusCode'])} />
                </Col>
                <Col xs={24} md={8}>
                  <ARField label="Transaction Date" value={fmtDate(pf(inv, ['TransactionDate']))} />
                  <ARField label="Accounting Date" value={fmtDate(pf(inv, ['AccountingDate', 'GlDate']))} />
                  <ARField label="Currency" value={ccy} />
                  <ARField label="Comments" value={pf(inv, ['Comments'])} />
                </Col>
                <Col xs={24} md={7}>
                  <div style={{ border: `1px solid ${REDWOOD.neutral200}`, borderRadius: 8, padding: '10px 14px', background: REDWOOD.neutral100 }}>
                    {[
                      ['Transaction Total', amt(total), true],
                      ['Lines', amt(linesTotal), false],
                      ['Tax', amt(taxTotal), false],
                      ['Freight', amt(freight), false],
                      ['Charges', amt(charges), false],
                    ].map(([lbl, val, strong]) => (
                      <div key={lbl as string} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '5px 0', borderBottom: `1px dashed ${REDWOOD.neutral200}` }}>
                        <span style={{ color: REDWOOD.neutral600, fontSize: 12.5, fontWeight: strong ? 700 : 400 }}>{lbl}</span>
                        <span style={{ fontWeight: strong ? 800 : 600, fontSize: strong ? 15 : 13, color: strong ? REDWOOD.primary : REDWOOD.neutral900, fontVariantNumeric: 'tabular-nums' }}>{val}</span>
                      </div>
                    ))}
                  </div>
                </Col>
              </Row>
            </ARSection>

            {/* Customer + Payment */}
            <Row gutter={[16, 0]}>
              <Col xs={24} md={16}>
                <ARSection title="Customer">
                  <Row gutter={[16, 0]}>
                    <Col xs={24} sm={12}>
                      <ARField label="Bill-to Name" value={pf(inv, ['BillToCustomerName'])} />
                      <ARField label="Bill-to Site" value={pf(inv, ['BillToSite', 'BillToCustomerSiteNumber', 'BillToSiteNumber', 'BillToCustomerAccountSiteId'])} />
                    </Col>
                    <Col xs={24} sm={12}>
                      <ARField label="Ship-to Name" value={pf(inv, ['ShipToCustomerName'])} />
                      <ARField label="Ship-to Site" value={pf(inv, ['ShipToSite', 'ShipToCustomerSiteNumber', 'ShipToSiteNumber'])} />
                    </Col>
                  </Row>
                </ARSection>
              </Col>
              <Col xs={24} md={8}>
                <ARSection title="Payment">
                  <ARField label="Payment Terms" value={pf(inv, ['PaymentTerms', 'PaymentTermsName'])} />
                  <ARField label="Due Date" value={fmtDate(pf(inv, ['DueDate', 'PaymentDueDate']))} />
                </ARSection>
              </Col>
            </Row>

            {/* Invoice Lines */}
            <Card size="small" styles={{ body: { padding: 0 } }} style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}` }}
              title={<Space><UnorderedListOutlined style={{ color: REDWOOD.primary }} /><Text strong>Invoice Lines</Text>{productLines.length > 0 && <Tag>{productLines.length}</Tag>}</Space>}>
              {productLines.length === 0 ? <Empty description="No invoice lines" style={{ padding: 30 }} />
                : <Table size="small" columns={lineCols} dataSource={productLines} rowKey={(_, i) => `ar-line-${i}`}
                    pagination={productLines.length > 20 ? { pageSize: 20, size: 'small' } : false} scroll={{ x: 1500, y: 300 }}
                    summary={(data) => {
                      const q = data.reduce((s, l) => s + num(pf(l, ['Quantity', 'InvoicedQuantity'])), 0);
                      const a = data.reduce((s, l) => s + amtOf(l), 0);
                      return (
                        <Table.Summary fixed>
                          <Table.Summary.Row style={{ background: REDWOOD.neutral100 }}>
                            <Table.Summary.Cell index={0} colSpan={4} align="right"><Text strong>Total</Text></Table.Summary.Cell>
                            <Table.Summary.Cell index={4} align="right"><Text strong>{fmtQty(q)}</Text></Table.Summary.Cell>
                            <Table.Summary.Cell index={5} />
                            <Table.Summary.Cell index={6} align="right"><Text strong style={{ color: REDWOOD.primary }}>{amt(a)}</Text></Table.Summary.Cell>
                            <Table.Summary.Cell index={7} colSpan={4} />
                          </Table.Summary.Row>
                        </Table.Summary>
                      );
                    }} />}
            </Card>
          </>
        )}

      <AllFieldsModal title={`AR Invoice ${pf(inv, ['TransactionNumber']) ?? ''} — all fields`} row={allOpen ? inv : null} onClose={() => setAllOpen(false)} />

      <Modal open={acctOpen} onCancel={() => setAcctOpen(false)} maskClosable={false} width={1000}
        title={<Space><ReconciliationOutlined style={{ color: REDWOOD.purple }} /> Invoice Accounting <Tag color="volcano">{pf(inv, ['TransactionNumber']) ?? ''}</Tag></Space>}
        footer={<Button onClick={() => setAcctOpen(false)}>Close</Button>}>
        {dists.length === 0 ? <Empty description="No accounting distributions" style={{ padding: 30 }} />
          : <Table size="small" columns={dynamicColumns(dists)} dataSource={dists} rowKey={(_, i) => `dist-${i}`}
              pagination={dists.length > 20 ? { pageSize: 20, size: 'small' } : false} scroll={{ x: 'max-content', y: 400 }} />}
      </Modal>
    </Modal>
  );
};

// ── Inventory reservations for an order (DemandSourceName = source txn number) ──
// The inventoryReservations GET needs a complete filter group; the working form
// is per-item: q=ItemNumber=<item>;DemandSourceName=<source txn number>.
const RESV_URL = `${FUSION_BASE}/inventoryReservations`;
async function fetchReservations(demandName: string, items: string[]): Promise<any[]> {
  if (!demandName || !items.length) return [];
  const uniq = Array.from(new Set(items.map(i => String(i ?? '').trim()).filter(Boolean)));
  const seen = new Set<string>();
  const out: any[] = [];
  await mapLimit(uniq, 4, async (item) => {
    const q = `ItemNumber=${item};DemandSourceName=${demandName}`;
    try {
      const r = await fetch(`${RESV_URL}?q=${encodeURIComponent(q)}&onlyData=true&limit=500`, { headers: getHeaders() });
      if (!r.ok) return;
      const d = await r.json();
      (d.items ?? []).forEach((it: any) => { const id = String(pf(it, ['ReservationId']) ?? ''); if (id && !seen.has(id)) { seen.add(id); out.push(it); } });
    } catch { /* skip this item */ }
  });
  return out;
}
// The GET used to look up an order's reservations (shown behind the API icon; one per item).
const reservationsQueryUrl = (demandName?: string, sampleItem?: string) =>
  `${RESV_URL}?q=ItemNumber=${sampleItem ?? '<item>'};DemandSourceName=${demandName ?? '<source txn #>'}&onlyData=true&limit=500`;
// Read-only reservations list for an order (used by the order view + create tab).
const ReservationsView: React.FC<{ orderNo?: string; items?: string[]; open: boolean; onClose: () => void; reloadKey?: number }> = ({ orderNo, items = [], open, onClose, reloadKey }) => {
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const apiUrl = reservationsQueryUrl(orderNo, items[0]);
  useEffect(() => {
    if (!open || !orderNo) return;
    setLoading(true);
    fetchReservations(String(orderNo), items).then(setList).finally(() => setLoading(false));
  }, [open, orderNo, reloadKey, items.join(',')]);
  const cols: ColumnsType<any> = [
    { title: 'Item', width: 150, render: (_, r) => <Text strong style={{ color: REDWOOD.info, fontSize: 12 }}>{pf(r, ['ItemNumber']) ?? '—'}</Text> },
    { title: 'Lot', width: 130, render: (_, r) => { const l = pf(r, ['LotNumber']); return l ? <Tag color="geekblue">{l}</Tag> : <Text type="secondary">—</Text>; } },
    { title: 'Subinv', width: 100, render: (_, r) => { const s = pf(r, ['SubinventoryCode']); return s ? <Tag color="cyan">{s}</Tag> : '—'; } },
    { title: 'Org', width: 80, render: (_, r) => pf(r, ['OrganizationCode']) ?? '—' },
    { title: 'Qty', width: 90, align: 'right', render: (_, r) => <Text strong style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtQty(num(pf(r, ['ReservationQuantity'])))}{pf(r, ['ReservationUOMCode']) ? ` ${pf(r, ['ReservationUOMCode'])}` : ''}</Text> },
    { title: 'Demand', width: 120, render: (_, r) => <Text style={{ fontSize: 11 }}>{pf(r, ['DemandSourceType']) ?? '—'}</Text> },
    { title: 'Reservation Id', width: 150, render: (_, r) => <Text code style={{ fontSize: 11 }}>{pf(r, ['ReservationId']) ?? '—'}</Text> },
  ];
  return (
    <Modal open={open} onCancel={onClose} width={860} footer={<Button onClick={onClose}>Close</Button>}
      title={<Space><SafetyCertificateOutlined style={{ color: REDWOOD.success }} /> Reservations — order {orderNo}{list.length ? <Tag color="green">{list.length}</Tag> : null}
        <Tooltip title={<span style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}><b>GET</b> {apiUrl}</span>}>
          <Button size="small" type="text" icon={<ApiOutlined />} style={{ color: REDWOOD.info }} onClick={() => { navigator.clipboard.writeText(apiUrl); message.success('Reservations query copied'); }} />
        </Tooltip></Space>}>
      <div style={{ fontSize: 11.5, marginBottom: 8 }}>
        <Tag color="green">GET</Tag><Text style={{ fontFamily: 'monospace', fontSize: 11, color: REDWOOD.info, wordBreak: 'break-all' }}>{apiUrl}</Text>
        <div><Text type="secondary" style={{ fontSize: 11 }}>One call per line item · DemandSourceName = source transaction number.</Text></div>
      </div>
      <Table size="small" loading={loading} columns={cols} dataSource={list} rowKey={(r, i) => String(pf(r, ['ReservationId']) ?? i)}
        pagination={list.length > 20 ? { pageSize: 20 } : false} scroll={{ x: 'max-content', y: 360 }}
        locale={{ emptyText: 'No reservations for this order' }} />
    </Modal>
  );
};

// ── Auto Ship Confirm — orchestrates pick release → pick confirm → ship confirm ──
const SHIPLINES_URL = (order: string) => `${FUSION_BASE}/shipmentLines?q=${encodeURIComponent(`Order='${order}'`)}&orderBy=OrderLine:asc`;
const PICKWAVES_URL = `${FUSION_BASE}/pickWaves`;
const PICKSLIPS_URL = (order: string) => `${FUSION_BASE}/pickSlipDetails?q=${encodeURIComponent(`Order='${order}'`)}&orderBy=CreationDate:desc`;
// Create/assign a shipment for lines with no Shipment yet. shipmentLines has no
// create action; pickRelease (the real action on shipmentLineChangeRequests, one
// line per call) is what materialises + assigns the shipment.
const SHIPASSIGN_URL = `${FUSION_BASE}/shipmentLineChangeRequests/action/pickRelease`;
// Per-line stage: 0 Open · 1 Pick Released · 2 Pick Confirmed · 3 Ship Confirmed.
// A line counts as fully shipped when its status is Interfaced / Shipped /
// Ship Confirmed, OR its Shipped quantity has reached the Requested quantity.
const lineStage = (l: any): number => {
  const s = String(pf(l, ['LineStatus']) ?? '').toLowerCase();
  const shipped = num(pf(l, ['ShippedQuantity'])), req = num(pf(l, ['RequestedQuantity']));
  if (s.includes('interfaced') || s.includes('shipped') || (s.includes('ship') && s.includes('confirm')) || (req > 0 && shipped >= req)) return 3;
  if (s.includes('stage') || s.includes('pick confirm') || s.includes('picked')) return 2;
  if (s.includes('released') || s.includes('backorder') || s.includes('warehouse')) return 1;
  return 0;
};
// Overall Steps `current`: the least-progressed line drives it, so all four
// steps tick (current = 4) only once every line is shipped / interfaced.
const shipStage = (lines: any[]): number => {
  if (!lines.length) return 0;
  const m = Math.min(...lines.map(lineStage));
  return m >= 3 ? 4 : m;
};
const AutoShipConfirmModal: React.FC<{ orderNo?: string; org?: string; open: boolean; onClose: () => void }> = ({ orderNo, org, open, onClose }) => {
  const [lines, setLines] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [creatingShip, setCreatingShip] = useState(false);
  const [psRows, setPsRows] = useState<any[] | null>(null);
  const [psRow, setPsRow] = useState<any | null>(null);
  const [shipOpen, setShipOpen] = useState(false);
  const [autoRunning, setAutoRunning] = useState(false);
  const [autoStep, setAutoStep] = useState<'idle' | 'pick-release' | 'pick-confirm' | 'ship-confirm' | 'done'>('idle');
  const [autoStatus, setAutoStatus] = useState<string>('');
  const load = useCallback(async () => {
    if (!orderNo) return;
    setLoading(true);
    try { setLines(await fetchAllPages(SHIPLINES_URL(orderNo))); }
    catch (e: any) { message.error(`Shipment lines: ${e.message}`); setLines([]); }
    finally { setLoading(false); }
  }, [orderNo]);
  useEffect(() => { if (open) load(); }, [open, load]);
  const stage = shipStage(lines);
  const orgCode = org ?? lines.map(l => pf(l, ['OrganizationCode'])).find(Boolean);
  const shipmentName = lines.map(l => pf(l, ['Shipment', 'ShipmentName'])).find(Boolean);

  const pickRelease = async () => {
    if (!orgCode) { message.warning('No organization on the shipment lines'); return; }
    setReleasing(true);
    try {
      const body = { SourceSystemName: 'OPS', BatchPrefix: `PR-${orderNo}`, ShipFromOrganizationCode: orgCode, ReleaseStatus: 'All', OrderNumber: String(orderNo), PickReleaseFlag: 'true', AutoPickConfirmFlag: 'false', ShipConfirmRule: '002_Ship_Confirm_Rule', CreateShipmentsFlag: 'true', ShipmentCreationCriteria: 'Across orders' };
      const r = await fetch(PICKWAVES_URL, { method: 'POST', headers: { ...getHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const text = await r.text(); let data: any = null; try { data = JSON.parse(text); } catch { /* raw */ }
      const ret = String(data?.ReturnStatus ?? data?.returnStatus ?? '').toUpperCase();
      if (r.ok && ret !== 'E') { message.success('Pick Release Success'); load(); }
      else Modal.error({ title: 'Pick Release Failed', width: 600, content: <div style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>{data?.ReturnMessage ?? data?.returnMessage ?? `HTTP ${r.status}`}</div> });
    } catch (e: any) { message.error(e.message); }
    finally { setReleasing(false); }
  };
  const openPickConfirm = async () => {
    if (!orderNo) return;
    try {
      const slips = await fetchAllPages(PICKSLIPS_URL(orderNo));
      if (!slips.length) message.info('No pick slips yet — run Pick Release first');
      else if (slips.length === 1) setPsRow(slips[0]);
      else setPsRows(slips);
    } catch (e: any) { message.error(e.message); }
  };
  // Lines with no Shipment attached (staged or ready) → candidates for a shipment.
  const noShipLines = lines.filter(l => !pf(l, ['Shipment', 'ShipmentName']) && pf(l, ['ShipmentLine']) != null
    && /stage|ready|release|backorder/i.test(String(pf(l, ['LineStatus']) ?? '')));
  const assignBody = (l: any) => ({ shipmentLine: num(pf(l, ['ShipmentLine'])) });
  const createShipment = async () => {
    if (!noShipLines.length) { message.info('No lines without a shipment'); return; }
    setCreatingShip(true);
    const fails: string[] = [];
    for (const l of noShipLines) {
      try {
        const r = await fetch(SHIPASSIGN_URL, { method: 'POST', headers: { ...getHeaders(), 'Content-Type': 'application/vnd.oracle.adf.action+json' }, body: JSON.stringify(assignBody(l)) });
        const text = await r.text(); let data: any = null; try { data = JSON.parse(text); } catch { /* raw */ }
        if (!r.ok || String(data?.ReturnStatus ?? '').toUpperCase() === 'E') fails.push(`${pf(l, ['Item'])} (line ${pf(l, ['OrderLine'])}): ${data?.ReturnMessage ?? (collectOrderErrors(data, text, true)[0] || 'HTTP ' + r.status)}`);
      } catch (e: any) { fails.push(`${pf(l, ['Item'])}: ${e?.message}`); }
    }
    setCreatingShip(false);
    if (fails.length) Modal.error({ title: 'Create Shipment Failed', width: 660, content: <div style={{ whiteSpace: 'pre-wrap', fontSize: 12.5 }}>{fails.join('\n\n')}</div> });
    else { message.success(`Shipment created for ${noShipLines.length} line(s)`); }
    load();
  };

  // Automated workflow: Pick Release → Pick Confirm → Ship Confirm
  const runAllSteps = async () => {
    if (!orgCode || !orderNo) { message.error('Organization or order number missing'); return; }
    setAutoRunning(true);
    setAutoStep('pick-release');
    setAutoStatus('Starting Pick Release...');

    try {
      // STEP 1: Pick Release
      const body = { SourceSystemName: 'OPS', BatchPrefix: `PR-${orderNo}`, ShipFromOrganizationCode: orgCode, ReleaseStatus: 'All', OrderNumber: String(orderNo), PickReleaseFlag: 'true', AutoPickConfirmFlag: 'false', ShipConfirmRule: '002_Ship_Confirm_Rule', CreateShipmentsFlag: 'true', ShipmentCreationCriteria: 'Across orders' };
      const r1 = await fetch(PICKWAVES_URL, { method: 'POST', headers: { ...getHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const text1 = await r1.text(); let data1: any = null; try { data1 = JSON.parse(text1); } catch { /* raw */ }
      const ret1 = String(data1?.ReturnStatus ?? data1?.returnStatus ?? '').toUpperCase();
      if (!r1.ok || ret1 === 'E') { message.error('Pick Release failed'); setAutoRunning(false); setAutoStep('idle'); return; }
      setAutoStatus('Pick Release completed, waiting for status update...');

      // Poll until all lines show "Pick Released"
      let pollCount = 0;
      while (pollCount < 30) {
        await new Promise(res => setTimeout(res, 1000));
        const lines = await fetchAllPages(SHIPLINES_URL(orderNo));
        const allReleased = lines.every(l => lineStage(l) >= 1);
        if (allReleased) break;
        pollCount++;
        setAutoStatus(`Waiting for status update... (${pollCount}s)`);
      }

      // STEP 2: Pick Confirm (auto-allocate serials)
      setAutoStep('pick-confirm');
      setAutoStatus('Fetching pick slips...');
      const slips = await fetchAllPages(PICKSLIPS_URL(orderNo));
      if (!slips.length) { message.error('No pick slips found'); setAutoRunning(false); setAutoStep('idle'); return; }

      // Auto-confirm picks with lot/serial allocation
      const pickLinesUrl = (slip: any) => slip?.links?.find((l: any) => l.name === 'pickLines')?.href ?? `${FUSION_BASE}/pickSlipDetails/${slip.PickSlip}/child/pickLines`;
      const ONHAND_URL = (org: string, item: string, subinv?: string) => {
        const q = `OrganizationCode=${org};ItemNumber=${item}` + (subinv ? `;SubinventoryCode=${subinv}` : '');
        return `${FUSION_BASE}/inventoryOnhandBalances?q=${encodeURIComponent(q)}&expand=lots.lotSerials,serials&onlyData=true&limit=500`;
      };

      for (let si = 0; si < slips.length; si++) {
        const slip = slips[si];
        setAutoStatus(`Processing pick slip ${si + 1}/${slips.length}...`);
        const pickLines = await fetchAllPages(pickLinesUrl(slip));
        const allocations: Record<string, any> = {};

        for (const pl of pickLines) {
          const item = pl.Item;
          const subinv = pf(pl, ['SourceSubinventory']);
          const reqQty = num(pl.RequestedQuantity);
          if (!item || reqQty <= 0) continue;

          // Fetch on-hand balances
          const onhands = await fetchAllPages(ONHAND_URL(orgCode, item, subinv));
          const lots: Record<string, { qty: number; serials: string[] }> = {};
          const serialOnly: string[] = [];

          onhands.forEach(b => {
            (b.lots ?? []).forEach((lot: any) => {
              const ln = lot.LotNumber; if (!ln) return;
              if (!lots[ln]) lots[ln] = { qty: 0, serials: [] };
              lots[ln].qty += num(pf(lot, ['OnhandQuantity', 'PrimaryQuantity', 'Quantity', 'LotQuantity']));
              (lot.lotSerials ?? []).forEach((s: any) => { const sn = pf(s, ['SerialNumber', 'FmSerialNumber']); if (sn) lots[ln].serials.push(sn); });
            });
            (b.serials ?? []).forEach((s: any) => { const sn = pf(s, ['SerialNumber', 'FmSerialNumber']); if (sn) serialOnly.push(sn); });
          });

          // Auto-allocate: prefer lot if available, otherwise use serial-only
          const lotEntries = Object.values(lots).sort((a, b) => a.qty - b.qty).reverse();
          let selectedSerials: string[] = [];
          let selectedLot: string | undefined;

          if (lotEntries.length > 0) {
            // Lot-controlled: use first lot with enough serials
            for (const lot of lotEntries) {
              if (lot.serials.length >= reqQty) {
                selectedLot = Object.keys(lots).find(k => lots[k] === lot);
                selectedSerials = lot.serials.slice(0, reqQty);
                break;
              }
            }
            if (!selectedSerials.length) {
              selectedLot = Object.keys(lots)[0];
              selectedSerials = lotEntries[0].serials.slice(0, reqQty);
            }
          } else if (serialOnly.length > 0) {
            selectedSerials = serialOnly.slice(0, reqQty);
          }

          if (selectedSerials.length > 0) {
            allocations[String(pl.PickSlipLine)] = { item, lot: selectedLot, serials: selectedSerials };
          }
        }

        // Submit confirm payload
        if (Object.keys(allocations).length > 0) {
          const confirmPayload = { pickLines: Object.entries(allocations).map(([lineKey, a]) => {
            const qty = a.serials.length;
            const subinv = pf(pickLines.find((l: any) => String(l.PickSlipLine) === lineKey), ['SourceSubinventory']);
            const base: any = {
              PickSlip: String(slip.PickSlip ?? ''),
              PickSlipLine: String(lineKey),
              PickedQuantity: String(qty),
              ...(subinv ? { SubinventoryCode: subinv } : {}),
            };
            const serials = a.serials.map((s: string) => ({ FromSerialNumber: s, ToSerialNumber: s }));
            if (a.lot) {
              base.lotSerialItemLots = [{ Lot: a.lot, Quantity: String(qty), lotSerialItemSerials: serials }];
            } else if (serials.length) {
              base.serialItemSerials = serials;
            }
            return base;
          }) };

          const r2 = await fetch(`${FUSION_BASE}/pickTransactions`, {
            method: 'POST',
            headers: { ...getHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify(confirmPayload),
          });
          if (!r2.ok) { message.error(`Pick confirm failed for slip ${slip.PickSlip}`); }
        }
      }

      // STEP 3: Ship Confirm
      setAutoStep('ship-confirm');
      setAutoStatus('Performing Ship Confirm...');

      const shipName = shipmentName;
      const shipPayload = { ShipmentName: shipName, Action: 'CONFIRM', Organization: orgCode };
      const r3 = await fetch(`${FUSION_BASE}/shipConfirmations`, {
        method: 'POST',
        headers: { ...getHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(shipPayload),
      });

      if (r3.ok) {
        setAutoStep('done');
        setAutoStatus('All steps completed successfully!');
        message.success('Automated workflow completed');
        setTimeout(() => { setAutoRunning(false); setAutoStep('idle'); load(); }, 2000);
      } else {
        message.error('Ship Confirm failed');
        setAutoRunning(false);
        setAutoStep('idle');
      }
    } catch (e: any) {
      message.error(`Automation error: ${e.message}`);
      setAutoRunning(false);
      setAutoStep('idle');
    }
  };

  const cols: ColumnsType<any> = [
    { title: 'Line', dataIndex: 'OrderLine', width: 55, align: 'center', fixed: 'left' as const, render: v => <Tag color="blue">{v ?? '—'}</Tag> },
    { title: 'Item', dataIndex: 'Item', width: 150, fixed: 'left' as const, render: v => <Text strong style={{ color: REDWOOD.info, fontSize: 12 }}>{v ?? '—'}</Text> },
    { title: 'Description', dataIndex: 'ItemDescription', width: 240, ellipsis: true, render: v => <Text style={{ fontSize: 12 }}>{v ?? '—'}</Text> },
    { title: 'Requested', dataIndex: 'RequestedQuantity', width: 100, align: 'right', render: (v, r) => <span>{fmtQty(num(v))}{pf(r, ['RequestedQuantityUOMCode', 'RequestedQuantityUOM']) ? <Text type="secondary" style={{ fontSize: 11 }}> {pf(r, ['RequestedQuantityUOMCode', 'RequestedQuantityUOM'])}</Text> : null}</span> },
    { title: 'Shipped', dataIndex: 'ShippedQuantity', width: 90, align: 'right', render: v => fmtQty(num(v)) },
    { title: 'Unit Price', width: 100, align: 'right', render: (_, r) => { const p = pf(r, ['SellingPrice', 'UnitPrice']); return p != null ? <Text style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtAmount(num(p))}</Text> : '—'; } },
    { title: 'Subinv', dataIndex: 'Subinventory', width: 100, render: v => v ? <Tag color="cyan">{v}</Tag> : '—' },
    { title: 'Organization', width: 160, render: (_, r) => { const c = pf(r, ['OrganizationCode']); const n = pf(r, ['OrganizationName']); return c ? <Tooltip title={n}><Tag>{c}</Tag></Tooltip> : '—'; } },
    { title: 'Shipment', dataIndex: 'Shipment', width: 120, render: v => v ? <Tag>{v}</Tag> : '—' },
    { title: 'Line Status', dataIndex: 'LineStatus', width: 150, fixed: 'right' as const, render: v => statusTag(v) },
  ];
  return (
    <Modal open={open} onCancel={onClose} width={940} footer={<Button onClick={onClose}>Close</Button>}
      title={<Space><CarOutlined style={{ color: REDWOOD.success }} /> Auto Ship Confirm — order {orderNo}
        <Tooltip title={<span style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}><b>GET</b> {SHIPLINES_URL(String(orderNo ?? ''))}</span>}>
          <Button size="small" type="text" icon={<ApiOutlined />} style={{ color: REDWOOD.info }} /></Tooltip></Space>}>
      <Steps size="small" current={autoRunning ? (autoStep === 'pick-release' ? 0 : autoStep === 'pick-confirm' ? 1 : autoStep === 'ship-confirm' ? 2 : 3) : stage} style={{ marginBottom: 16 }}
        items={[{ title: 'Open' }, { title: 'Pick Released' }, { title: 'Pick Confirmed' }, { title: 'Ship Confirmed' }]} />

      {/* Automation Status */}
      {autoRunning && (
        <Card style={{ marginBottom: 12, background: REDWOOD.neutral100, borderColor: REDWOOD.info }}>
          <Space direction="vertical" style={{ width: '100%' }} size="small">
            <Space>
              <Spin size="small" />
              <Text strong>Automated Workflow Running</Text>
            </Space>
            <Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>{autoStatus}</Text>
          </Space>
        </Card>
      )}

      <Space wrap style={{ marginBottom: 10 }}>
        <Button type="primary" icon={<ThunderboltOutlined />} loading={autoRunning} disabled={autoRunning || stage >= 1 || !lines.length} onClick={runAllSteps}
          style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}>Run All Steps (Auto)</Button>
        <Divider type="vertical" />
        <Button icon={<ReloadOutlined />} loading={loading} onClick={load}>Check Status</Button>
        <Button type="primary" icon={<ThunderboltOutlined />} loading={releasing} disabled={autoRunning || stage >= 1 || !lines.length} onClick={pickRelease}
          style={stage >= 1 || !lines.length ? undefined : { background: REDWOOD.success, borderColor: REDWOOD.success }}>Pick Release</Button>
        <Button icon={<InboxOutlined />} disabled={autoRunning || stage < 1} onClick={openPickConfirm}>Pick Confirm — assign lots / serials</Button>
        <Tooltip title={noShipLines.length
          ? <span style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}><b>POST</b> {SHIPASSIGN_URL}<br />{JSON.stringify(assignBody(noShipLines[0]))} · per line</span>
          : 'No lines without a shipment'}>
          <Button icon={<InboxOutlined />} loading={creatingShip} disabled={autoRunning || !noShipLines.length} onClick={createShipment}
            style={noShipLines.length ? { borderColor: REDWOOD.primary, color: REDWOOD.primary } : undefined}>
            Create Shipment{noShipLines.length ? ` (${noShipLines.length})` : ''}
          </Button>
        </Tooltip>
        <Button icon={<CarOutlined />} disabled={autoRunning || stage < 2} onClick={() => setShipOpen(true)}>Ship Confirm</Button>
      </Space>
      {loading ? <div style={{ textAlign: 'center', padding: 30 }}><Spin /></div>
        : lines.length === 0 ? <Empty description="No shipment lines yet for this order — confirm the order first, then Check Status" style={{ padding: 24 }} />
        : <Table size="small" columns={cols} dataSource={lines} rowKey={(r, i) => String(pf(r, ['ShipmentLine', 'OrderLine']) ?? i)} pagination={lines.length > 20 ? { pageSize: 20 } : false} scroll={{ x: 'max-content', y: 320 }} />}

      {/* Pick slip chooser when more than one exists */}
      <Modal open={!!psRows} onCancel={() => setPsRows(null)} width={560} footer={<Button onClick={() => setPsRows(null)}>Cancel</Button>}
        title={<Space><InboxOutlined style={{ color: REDWOOD.info }} /> Choose a pick slip</Space>}>
        <Table size="small" dataSource={psRows ?? []} rowKey={(r, i) => String(r.PickSlip ?? i)} pagination={false}
          columns={[{ title: 'Pick Slip', dataIndex: 'PickSlip' }, { title: 'Status', dataIndex: 'PickSlipStatus', render: v => statusTag(v) },
            { title: '', align: 'right', render: (_, r) => <Button size="small" type="primary" style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }} onClick={() => { setPsRow(r); setPsRows(null); }}>Open</Button> }]} />
      </Modal>
      <PickSlipDialog row={psRow} onClose={() => { setPsRow(null); load(); }} />
      <ShipConfirmModal open={shipOpen} shipmentName={shipmentName} organization={orgCode} onClose={() => setShipOpen(false)} onDone={load} />
    </Modal>
  );
};

// ── AR AutoInvoice (Import Receivables Transactions Using AutoInvoice) ────────
// Submits the ESS job via erpintegrations / submitESSJobRequest, filtered to
// one order via the From/To Sales Order Number parameters, then polls status.
const ERP_INT_URL = `${FUSION_BASE}/erpintegrations`;
const AI_JOB_PACKAGE = '/oracle/apps/ess/financials/receivables/transactions/autoInvoices';
const AI_JOB_DEF = 'AutoInvoiceMasterEss';
// Parameter order = the 26 positional args of the standard "Import Receivables
// Transactions Using AutoInvoice" (AutoInvoiceMasterEss) job. argument3
// (Transaction Source) is the numeric batch-source id; the sales-order filter is
// From/To Sales Order Number (args 16/17); Base Due Date is arg 24.
const AI_PARAM_LABELS = [
  'Number of Workers', 'Business Unit', 'Transaction Source', 'Default Date', 'Transaction Type',
  'From Customer', 'To Customer', 'From Customer Account Number', 'To Customer Account Number',
  'From Accounting Date', 'To Accounting Date', 'From Ship Date', 'To Ship Date',
  'From Transaction Number', 'To Transaction Number', 'From Sales Order Number', 'To Sales Order Number',
  'From Transaction Date', 'To Transaction Date', 'From Ship-to Customer Account Number',
  'To Ship-to Customer Account Number', 'From Ship-to Customer Name', 'To Ship-to Customer Name',
  'Base Due Date on Transaction Date', 'Due Date Adjustment Days', 'Load Request ID',
];
// 0-based indices used for defaults / highlighting.
const AI_IX = { workers: 0, bu: 1, source: 2, date: 3, soFrom: 15, soTo: 16, baseDue: 23 };
const AutoInvoiceModal: React.FC<{ orderNo?: string; buId?: string | number; open: boolean; onClose: () => void }> = ({ orderNo, buId, open, onClose }) => {
  const [jobPackage, setJobPackage] = useState(AI_JOB_PACKAGE);
  const [jobDef, setJobDef] = useState(AI_JOB_DEF);
  const [vals, setVals] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [reqId, setReqId] = useState<string>('');
  const [status, setStatus] = useState<string>('');
  const [resp, setResp] = useState<string>('');
  useEffect(() => {
    if (!open) return;
    const v = AI_PARAM_LABELS.map(() => '');
    v[AI_IX.workers] = '1';                                    // Number of Workers
    if (buId != null && String(buId).trim()) v[AI_IX.bu] = String(buId);  // Business Unit id
    v[AI_IX.source] = '5';                                     // Transaction Source (5 = Distributed Order Orchestration)
    v[AI_IX.date] = new Date().toISOString().slice(0, 10);    // Default Date (YYYY-MM-DD)
    v[AI_IX.soFrom] = String(orderNo ?? '');                  // From Sales Order Number (arg 16)
    v[AI_IX.soTo] = String(orderNo ?? '');                    // To Sales Order Number (arg 17)
    v[AI_IX.baseDue] = 'Y';                                    // Base Due Date on Transaction Date (arg 24)
    setVals(v); setReqId(''); setStatus(''); setResp('');
  }, [open, orderNo, buId]);
  const setVal = (i: number, s: string) => setVals(p => p.map((x, j) => j === i ? s : x));
  const essParams = vals.map(v => (v == null || v.trim() === '') ? '#NULL' : v.trim()).join(',');
  const body = { OperationName: 'submitESSJobRequest', JobPackageName: jobPackage.trim(), JobDefName: jobDef.trim(), ESSParameters: essParams };

  const submit = async () => {
    if (!vals[AI_IX.source] || vals[AI_IX.source].trim() === '') { message.warning('Transaction Source (batch-source id, e.g. 5) is required'); return; }
    setSubmitting(true); setStatus(''); setResp('');
    try {
      const r = await fetch(ERP_INT_URL, { method: 'POST', headers: { ...getHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const text = await r.text(); let data: any = null; try { data = JSON.parse(text); } catch { /* raw */ }
      setResp(text);
      const id = data?.ReqstId ?? data?.reqstId ?? data?.RequestId ?? data?.DocumentId ?? '';
      if (!r.ok || !id) { message.error('AutoInvoice submit failed — see the response'); return; }
      setReqId(String(id)); setStatus('RUNNING');
      message.success(`AutoInvoice submitted — request ${id}`);
      pollStatus(String(id));
    } catch (e: any) { setResp(e?.message); message.error(e?.message || 'Submit failed'); }
    finally { setSubmitting(false); }
  };
  const pollStatus = async (id: string) => {
    try {
      const r = await fetch(`${ERP_INT_URL}?finder=ESSJobStatusRF;requestId=${encodeURIComponent(id)}`, { headers: getHeaders() });
      const text = await r.text(); let data: any = null; try { data = JSON.parse(text); } catch { /* raw */ }
      const st = data?.items?.[0]?.RequestStatus ?? data?.RequestStatus ?? data?.requestStatus ?? (r.ok ? 'UNKNOWN' : `HTTP ${r.status}`);
      setStatus(String(st));
    } catch (e: any) { setStatus(`status error: ${e?.message}`); }
  };
  const stTag = (s: string) => {
    const u = s.toUpperCase();
    if (u.includes('SUCCEED')) return <Tag color="success">{s}</Tag>;
    if (u.includes('ERROR') || u.includes('WARN')) return <Tag color="error">{s}</Tag>;
    if (u.includes('RUN') || u.includes('WAIT') || u.includes('READY')) return <Tag color="processing">{s}</Tag>;
    return <Tag>{s}</Tag>;
  };
  return (
    <Modal open={open} onCancel={onClose} width={720} maskClosable={false}
      title={<Space><DollarOutlined style={{ color: REDWOOD.primary }} /> Push to AR — Import AutoInvoice{orderNo ? <Tag color="geekblue">{orderNo}</Tag> : null}</Space>}
      footer={<Space>
        <Button size="small" type="text" icon={<CopyOutlined />} onClick={() => { navigator.clipboard.writeText(`POST ${ERP_INT_URL}\n${JSON.stringify(body, null, 2)}`); message.success('Copied'); }}>Copy request</Button>
        {reqId && <Button icon={<ReloadOutlined />} onClick={() => pollStatus(reqId)}>Refresh status</Button>}
        <Button onClick={onClose}>Close</Button>
        <Button type="primary" icon={<SendOutlined />} loading={submitting} onClick={submit}
          style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}>Submit AutoInvoice</Button>
      </Space>}>
      {/* Status — the main thing to watch after submit */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: REDWOOD.neutral100, border: `1px solid ${REDWOOD.neutral200}`, borderRadius: 8, marginBottom: 12 }}>
        <DollarOutlined style={{ color: REDWOOD.primary }} />
        {reqId
          ? <Space size={8}><Text style={{ fontSize: 13 }}>Request</Text><Text code>{reqId}</Text><Text style={{ fontSize: 13 }}>status</Text>{stTag(status || '—')}
              <Button size="small" icon={<ReloadOutlined />} onClick={() => pollStatus(reqId)}>Refresh</Button></Space>
          : <Text type="secondary" style={{ fontSize: 12.5 }}>Submit AutoInvoice to push order <b>{orderNo}</b> into Receivables. Filtered by sales-order number; source id <b>{vals[AI_IX.source] || '5'}</b>.</Text>}
      </div>

      {/* Everything else — collapsed by default */}
      <Collapse ghost size="small" items={[{
        key: 'req', label: <Text style={{ fontSize: 12 }}>Request details &amp; parameters ({AI_PARAM_LABELS.length} args) · edit if needed</Text>,
        children: (
          <div>
            <div style={{ fontSize: 12, marginBottom: 8 }}>
              <Tag color="green">POST</Tag><Text style={{ fontFamily: 'monospace', fontSize: 11, color: REDWOOD.info, wordBreak: 'break-all' }}>{ERP_INT_URL}</Text>
              <div style={{ marginTop: 4 }}><Text type="secondary" style={{ fontSize: 11.5 }}>OperationName <b>submitESSJobRequest</b> · job <b>{jobDef}</b>.</Text></div>
            </div>
            <Row gutter={[8, 6]}>
              <Col span={12}><Text style={{ fontSize: 11 }}>Job Package</Text><Input size="small" value={jobPackage} onChange={e => setJobPackage(e.target.value)} /></Col>
              <Col span={12}><Text style={{ fontSize: 11 }}>Job Definition</Text><Input size="small" value={jobDef} onChange={e => setJobDef(e.target.value)} /></Col>
            </Row>
            <div style={{ fontSize: 11, color: REDWOOD.neutral500, margin: '10px 0 4px' }}>Parameters (blank → #NULL). 26 positional args. <b>Transaction Source</b> = batch-source id (5 = DOO); <b>Business Unit</b> = its id (blank = all).</div>
            <div style={{ maxHeight: 240, overflow: 'auto', border: `1px solid ${REDWOOD.neutral200}`, borderRadius: 6, padding: 8 }}>
              <Row gutter={[8, 6]}>
                {AI_PARAM_LABELS.map((lbl, i) => {
                  const key = i === AI_IX.soFrom || i === AI_IX.soTo;
                  const req = i === AI_IX.workers || i === AI_IX.source || i === AI_IX.date || i === AI_IX.baseDue;
                  return <Col span={12} key={i}>
                    <Text style={{ fontSize: 10.5, color: key ? REDWOOD.primary : undefined, fontWeight: key ? 700 : 400 }}>{i + 1}. {lbl}{req ? ' *' : ''}</Text>
                    <Input size="small" value={vals[i] ?? ''} placeholder="#NULL" onChange={e => setVal(i, e.target.value)}
                      style={key ? { borderColor: REDWOOD.primary } : undefined} />
                  </Col>;
                })}
              </Row>
            </div>
            <div style={{ marginTop: 8 }}>
              <Text style={{ fontSize: 11, color: REDWOOD.neutral500 }}>ESSParameters</Text>
              <pre style={{ margin: '2px 0 0', fontSize: 10.5, background: REDWOOD.neutral100, borderRadius: 6, padding: 8, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{essParams}</pre>
            </div>
            {resp && <pre style={{ marginTop: 8, fontSize: 10.5, background: '#0b0b0b', color: '#d6f5d6', borderRadius: 6, padding: 8, maxHeight: 160, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{resp}</pre>}
          </div>
        ),
      }]} />
    </Modal>
  );
};

// Self href of an order (proxy-rewritten), or a key-based fallback.
const orderSelfHref = (o: any) => {
  const h = (o?.links ?? []).find((x: any) => x.rel === 'self' || x.name === 'self')?.href;
  if (h) return fusionHref(h);
  return o?.OrderKey ? `${FUSION_BASE}/salesOrdersForOrderHub/${encodeURIComponent(o.OrderKey)}` : '';
};

// Real CategoryCode / ContextCode discovered from live records, keyed by the
// flexfield code (DOO_HEADERS_ADD_INFO / DOO_FULFILL_LINES_ADD_INFO). Used when
// writing EFF so we send the exact discriminator Fusion actually stored — the
// hardcoded guesses were what triggered the "invalid Category" save error.
const EFF_CAT_CACHE: Record<string, { category?: string; context?: string }> = {};
const flexOfVo = (voName?: string) => /^Fulfill/i.test(voName || '') ? 'DOO_FULFILL_LINES_ADD_INFO' : /^Header/i.test(voName || '') ? 'DOO_HEADERS_ADD_INFO' : '';
const learnEff = (flex: string, category?: string, context?: string) => {
  if (!flex) return;
  const e = EFF_CAT_CACHE[flex] ?? (EFF_CAT_CACHE[flex] = {});
  if (category) e.category = String(category);
  if (context) e.context = String(context);
};
// The CategoryCode/ContextCode to send for a context — the real learned value
// when we've seen it on a live record, else the configured (guessed) value.
const effCategoryFor = (ctx: { category: string }) => EFF_CAT_CACHE[ctx.category]?.category ?? ctx.category;
const effContextFor = (ctx: { category: string; contextCode: string }) => EFF_CAT_CACHE[ctx.category]?.context ?? ctx.contextCode;

// Read a record's additionalInformation child and, for each row, the nested
// EffB<Context>privateVO segment values. Works for both order headers and lines.
interface EffRow { context: string; category?: string; segs: { k: string; v: any }[]; href: string }
const fetchEffRows = async (baseHref: string): Promise<EffRow[]> => {
  const aiUrl = `${baseHref}/child/additionalInformation`;
  const r = await fetch(`${aiUrl}?onlyData=false&limit=200`, { headers: getHeaders() });
  if (!r.ok) throw new Error(`HTTP ${r.status} on additionalInformation`);
  const d = await r.json();
  const items: any[] = Array.isArray(d) ? d : (d.items ?? []);
  const out: EffRow[] = [];
  for (const it of items) {
    const link = (it.links ?? []).find((x: any) => /EffB.+privateVO$/i.test(x.name || x.rel || ''));
    if (!link?.href) continue;
    const voName = (link.name || '').match(/EffB.+privateVO$/i)?.[0] ?? link.name;
    const cr = await fetch(`${fusionHref(link.href)}?onlyData=true&limit=200`, { headers: getHeaders() });
    if (!cr.ok) continue;
    const cd = await cr.json();
    const segRows: any[] = Array.isArray(cd) ? cd : (cd.items ?? []);
    for (const seg of segRows) {
      // Learn the real discriminator values from this live record.
      const catVal = it.Category ?? it.CategoryCode;
      learnEff(flexOfVo(voName), catVal, seg.ContextCode);
      const segs = Object.entries(seg)
        .filter(([k, v]) => isEffSegment(k) && v != null && v !== '')
        .map(([k, v]) => ({ k, v }));
      const ctxName = seg.ContextCode ?? (link.name || '').replace(/^.*EffB/i, '').replace(/privateVO$/i, '').replace(/_+/g, ' ').trim();
      out.push({ context: ctxName || 'Additional Information', category: catVal, segs, href: fusionHref(link.href) });
    }
  }
  return out;
};

// Write EFF segment values onto a record (order header or a line) — PATCH the
// existing nested VO row in place, else create the additionalInformation row +
// nested segment row. baseHref is the record self href.
const EFF_JSON_HDRS = { ...getHeaders(), 'Content-Type': 'application/vnd.oracle.adf.resourceitem+json' };
const writeEffToRecord = async (baseHref: string, ctx: EffCtx, vals: Record<string, any>): Promise<void> => {
  let aiHref = '', voHref = '';
  const r = await fetch(`${baseHref}/child/additionalInformation?onlyData=false&limit=200`, { headers: getHeaders() });
  if (r.ok) {
    const d = await r.json();
    for (const it of (d.items ?? [])) {
      const link = (it.links ?? []).find((x: any) => /EffB.+privateVO$/i.test(x.name || x.rel || ''));
      if (!link?.href) continue;
      aiHref = fusionHref((it.links ?? []).find((x: any) => x.rel === 'self')?.href ?? '');
      const cr = await fetch(`${fusionHref(link.href)}?onlyData=false&limit=200`, { headers: getHeaders() });
      if (cr.ok) { const seg = ((await cr.json()).items ?? [])[0]; if (seg) voHref = fusionHref((seg.links ?? []).find((x: any) => x.rel === 'self')?.href ?? ''); }
      break;
    }
  }
  const ctxCode = effContextFor(ctx), catCode = effCategoryFor(ctx);
  let resp: Response;
  if (voHref) resp = await fetch(voHref, { method: 'PATCH', headers: EFF_JSON_HDRS, body: JSON.stringify(vals) });
  else if (aiHref) resp = await fetch(`${aiHref}/child/${ctx.voName}`, { method: 'POST', headers: EFF_JSON_HDRS, body: JSON.stringify({ ContextCode: ctxCode, ...vals }) });
  else resp = await fetch(`${baseHref}/child/additionalInformation`, { method: 'POST', headers: EFF_JSON_HDRS, body: JSON.stringify({ Category: catCode, [ctx.voName]: [{ ContextCode: ctxCode, ...vals }] }) });
  const txt = await resp.text();
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${txt.slice(0, 300)}`);
};

// Header Additional Information (EFF) for the view page.
const HeaderEffView: React.FC<{ order: any }> = ({ order }) => {
  const base = orderSelfHref(order);
  const aiUrl = base ? `${base}/child/additionalInformation` : '';
  const [rows, setRows] = useState<EffRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const load = useCallback(async () => {
    if (!base) { setErr('No order self link available'); return; }
    setLoading(true); setErr('');
    try { setRows(await fetchEffRows(base)); }
    catch (e: any) { setErr(e?.message ?? String(e)); } finally { setLoading(false); }
  }, [base]);
  useEffect(() => { load(); }, [load]);

  const showApi = () => Modal.info({
    title: 'Additional Information (EFF) — web service', width: 760,
    content: <div style={{ fontSize: 12 }}>
      <div style={{ marginBottom: 8 }}><b>1) Header EFF rows (GET):</b><br /><code style={{ wordBreak: 'break-all' }}>{aiUrl || '(no self link)'}</code></div>
      <div style={{ marginBottom: 8 }}><b>2) For each row, the segment values (GET):</b><br /><code style={{ wordBreak: 'break-all' }}>{`${aiUrl}/{rowId}/child/HeaderEffB<Context>privateVO`}</code></div>
      {rows && rows.length > 0 && <div style={{ marginTop: 8 }}><b>Resolved segment rows:</b>
        <pre style={{ maxHeight: 260, overflow: 'auto', background: REDWOOD.neutral100, padding: 8, borderRadius: 6, fontSize: 10.5 }}>{JSON.stringify(rows, null, 2).slice(0, 10000)}</pre></div>}
    </div>,
  });
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 6 }}>
        <Tooltip title={<span style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}><b>GET</b> {aiUrl || '(no self link)'}</span>}>
          <Button size="small" type="text" icon={<ApiOutlined />} style={{ color: REDWOOD.info }} onClick={showApi} />
        </Tooltip>
        <Button size="small" type="primary" icon={<ReloadOutlined />} loading={loading} onClick={load}
          style={{ background: REDWOOD.info, borderColor: REDWOOD.info }}>Run</Button>
      </div>
      {loading ? <div style={{ textAlign: 'center', padding: 30 }}><Spin /></div>
        : err ? <div style={{ color: REDWOOD.error, fontSize: 12, padding: 10 }}><InfoCircleOutlined style={{ marginRight: 6 }} />{err}</div>
        : !rows || rows.length === 0 ? <Empty description="No additional information on this order" style={{ padding: 20 }} />
        : <Row gutter={[12, 12]}>
            {rows.map((r, i) => (
              <Col xs={24} md={12} key={i}>
                <Card size="small" title={<Space><ProfileOutlined style={{ color: REDWOOD.purple }} /><Text strong style={{ fontSize: 12.5 }}>{r.context}</Text></Space>}
                  style={{ borderRadius: 8 }} styles={{ body: { padding: 10 } }}>
                  {r.segs.length === 0 ? <Text type="secondary" style={{ fontSize: 12 }}>No values</Text>
                    : <Row gutter={[8, 6]}>
                        {r.segs.map(s => (
                          <React.Fragment key={s.k}>
                            <Col span={11}><Text type="secondary" style={{ fontSize: 12 }}>{humanize(s.k)}</Text></Col>
                            <Col span={13}><Text style={{ fontSize: 12.5 }}>{typeof s.v === 'object' ? JSON.stringify(s.v) : String(s.v)}</Text></Col>
                          </React.Fragment>
                        ))}
                      </Row>}
                </Card>
              </Col>
            ))}
          </Row>}
    </div>
  );
};

// Line-level Additional Information (EFF) — reads each line's additionalInformation
// child + nested FulfillLineEffB<Context>privateVO segments (itemcost/itemlot/lotqty…).
const LineEffView: React.FC<{ lines: any[] }> = ({ lines }) => {
  const [rows, setRows] = useState<{ line: string; item: string; context: string; segs: { k: string; v: any }[] }[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const out: { line: string; item: string; context: string; segs: { k: string; v: any }[] }[] = [];
      for (const l of lines) {
        const self = (l.links ?? []).find((x: any) => x.rel === 'self')?.href;
        if (!self) continue;
        let effRows: EffRow[] = [];
        try { effRows = await fetchEffRows(fusionHref(self)); } catch { /* line has no EFF */ }
        for (const er of effRows) out.push({
          line: String(pf(l, ['LineNumber', 'SourceTransactionLineNumber']) ?? ''),
          item: String(pf(l, ['ProductNumber', 'Item', 'ItemNumber']) ?? ''),
          context: er.context, segs: er.segs,
        });
      }
      setRows(out);
    } catch (e: any) { setErr(e?.message ?? String(e)); } finally { setLoading(false); }
  }, [lines]);
  useEffect(() => { load(); }, [load]);

  const showApi = () => Modal.info({
    title: 'Line Additional Information (EFF) — web service', width: 760,
    content: <div style={{ fontSize: 12 }}>
      <div style={{ marginBottom: 8 }}><b>Per line (GET):</b><br /><code style={{ wordBreak: 'break-all' }}>{`${FUSION_BASE}/salesOrdersForOrderHub/{OrderKey}/child/lines/{lineId}/child/additionalInformation/{rowId}/child/FulfillLineEffBaddinfoprivateVO`}</code></div>
      {rows && rows.length > 0 && <div><b>Resolved:</b><pre style={{ maxHeight: 260, overflow: 'auto', background: REDWOOD.neutral100, padding: 8, borderRadius: 6, fontSize: 10.5 }}>{JSON.stringify(rows, null, 2).slice(0, 10000)}</pre></div>}
    </div>,
  });
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 6 }}>
        <Button size="small" type="text" icon={<ApiOutlined />} style={{ color: REDWOOD.info }} onClick={showApi} />
        <Button size="small" type="primary" icon={<ReloadOutlined />} loading={loading} onClick={load}
          style={{ background: REDWOOD.info, borderColor: REDWOOD.info }}>Run</Button>
      </div>
      {loading ? <div style={{ textAlign: 'center', padding: 30 }}><Spin /></div>
        : err ? <div style={{ color: REDWOOD.error, fontSize: 12, padding: 10 }}><InfoCircleOutlined style={{ marginRight: 6 }} />{err}</div>
        : !rows || rows.length === 0 ? <Empty description="No line additional information" style={{ padding: 20 }} />
        : <Table size="small" pagination={false} rowKey={(_, i) => String(i)}
            dataSource={rows}
            columns={[
              { title: 'Line', dataIndex: 'line', width: 70 },
              { title: 'Item', dataIndex: 'item', width: 160, ellipsis: true },
              { title: 'Context', dataIndex: 'context', width: 150, render: (v: string) => <Tag color="purple">{v}</Tag> },
              { title: 'Segments', dataIndex: 'segs', render: (segs: { k: string; v: any }[]) => (
                <Space size={[8, 4]} wrap>{segs.map(s => <Tag key={s.k} style={{ margin: 0 }}><b>{humanize(s.k)}:</b> {typeof s.v === 'object' ? JSON.stringify(s.v) : String(s.v)}</Tag>)}</Space>
              ) },
            ]} scroll={{ x: 'max-content' }} />}
    </div>
  );
};

// ── Order view (header + lines) shown in its own tab ─────────────────────────
const OrderView: React.FC<{ order: any; onCopy?: (order: any, lines: any[]) => void; onReturn?: (order: any, lines: any[]) => void }> = ({ order, onCopy, onReturn }) => {
  const auth = useAuth();
  const linesHref = order?.links?.find((l: any) => l.name === 'lines')?.href
    ?? (order?.OrderKey ? `${FUSION_BASE}/salesOrdersForOrderHub/${encodeURIComponent(order.OrderKey)}/child/lines` : '');

  const [lines, setLines] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lineDetail, setLineDetail] = useState<any | null>(null);
  const [hdrOpen, setHdrOpen] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [arTxn, setArTxn] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);
  const [resvOpen, setResvOpen] = useState(false);
  const [resvCount, setResvCount] = useState<number | null>(null);
  const [arOpen, setArOpen] = useState(false);
  const [autoShipOpen, setAutoShipOpen] = useState(false);
  const orderNo = String(order.OrderNumber ?? order.SourceTransactionNumber ?? '');
  const sourceNo = String(order.SourceTransactionNumber ?? order.OrderNumber ?? '');  // reservations + AutoInvoice key off the source order number
  const totals = useTotals(order, true);
  const lineKey = (r: any, i: number) => `${r.LineId ?? r.FulfillLineId ?? i}`;
  const selectedLines = () => lines.filter((l, i) => selectedKeys.includes(lineKey(l, i)));
  const doReturn = (all: boolean) => {
    const picked = all ? lines : selectedLines();
    if (!picked.length) { message.warning('Select at least one line to return'); return; }
    onReturn?.(order, picked);
  };

  // Distinct line-level child collections across all lines (lotSerials, …).
  const childNames = useMemo(() => {
    const s = new Set<string>();
    lines.forEach(l => (l.links ?? []).forEach((x: any) => { if (x.rel === 'child' && x.name) s.add(x.name); }));
    return Array.from(s).sort();
  }, [lines]);

  // Only the allowlisted child collections become tabs (rest hidden); billTo +
  // shipTo merge into a single Customers tab; lineDetails shows as "Billing".
  const childTabItems = useMemo(() => {
    const findLink = (matches: string[]) => childNames.find(n => matches.includes(norm(n)));
    const billLink = findLink(CUST_BILL_MATCH);
    const shipLink = findLink(CUST_SHIP_MATCH);
    return LINE_TAB_DEFS.map(def => {
      if (def.customer) {
        if (!billLink && !shipLink) return null;
        return { key: def.key, label: <span><ProfileOutlined style={{ marginRight: 5 }} />Customers</span>,
          children: <CustomerTab lines={lines} billName={billLink} shipName={shipLink} /> };
      }
      const nm = findLink(def.match!);
      if (!nm) return null;
      // Billing tab: make the Billing Transaction Number drill into the AR invoice.
      const overrides = def.key === 'billing'
        ? [{ match: ['billingtransactionnumber', 'billingtrxnumber', 'billingtransactionnum'],
            render: (v: any) => v
              ? <Tooltip title="Open AR invoice"><Button type="link" style={{ padding: 0, fontWeight: 700, color: REDWOOD.info, fontSize: 12 }} onClick={() => setArTxn(String(v))}>{v}</Button></Tooltip>
              : '—' }]
        : undefined;
      return { key: def.key, label: <span><ProfileOutlined style={{ marginRight: 5 }} />{def.label}</span>,
        children: <MergedLineChildTab lines={lines} name={nm} overrides={overrides} /> };
    }).filter(Boolean) as { key: string; label: React.ReactNode; children: React.ReactNode }[];
  }, [childNames, lines]);

  // Fulfillment org & subinventory come from the lines — surface the distinct
  // values in the header.
  const orgList = useMemo(() => Array.from(new Set(lines.map((l: any) => l.RequestedFulfillmentOrganizationCode).filter(Boolean))) as string[], [lines]);
  const orgNameOf = (code: string) => lines.find((l: any) => l.RequestedFulfillmentOrganizationCode === code)?.RequestedFulfillmentOrganizationName;
  const subList = useMemo(() => Array.from(new Set(lines.map((l: any) => l.SubinventoryCode).filter(Boolean))) as string[], [lines]);
  const lineItems = useMemo(() => Array.from(new Set(lines.map((l: any) => pf(l, ['ProductNumber', 'Item', 'ItemNumber'])).filter(Boolean))) as string[], [lines]);
  // Reservation count (found by item + source txn number) once the lines load.
  useEffect(() => { if (sourceNo && lineItems.length) fetchReservations(sourceNo, lineItems).then(l => setResvCount(l.length)); else setResvCount(0); }, [sourceNo, lineItems.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadLines = useCallback(async () => {
    if (!linesHref) return;
    setLoading(true); setError('');
    try { setLines(await fetchAllPages(linesHref)); }
    catch (e: any) { setError(e.message); setLines([]); }
    finally { setLoading(false); }
  }, [linesHref]);
  useEffect(() => { loadLines(); }, [loadLines]);

  // Header: curated highlights + all remaining non-null, non-id fields.
  const HInfo: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
    <Col xs={12} sm={8} md={6}>
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: REDWOOD.neutral600, textTransform: 'uppercase', letterSpacing: '0.03em' }}>{label}</div>
        <div style={{ fontSize: 12.5, color: REDWOOD.neutral900, marginTop: 2, wordBreak: 'break-word' }}>{value ?? '—'}</div>
      </div>
    </Col>
  );

  const lineCols = useMemo<ColumnsType<any>>(() => ([
    { title: 'Line', dataIndex: 'DisplayLineNumber', width: 60, align: 'center', fixed: 'left',
      render: (v, r) => <Tag color="blue" style={{ fontSize: 11 }}>{v ?? r.LineNumber ?? '—'}</Tag> },
    { title: 'Product', dataIndex: 'ProductNumber', width: 140, fixed: 'left',
      render: v => <Text strong style={{ color: REDWOOD.info, fontSize: 12 }}>{v ?? '—'}</Text> },
    { title: 'Description', dataIndex: 'ProductDescription', width: 260, ellipsis: true, render: v => <Text style={{ fontSize: 12 }}>{v ?? '—'}</Text> },
    { title: 'Ordered Qty', dataIndex: 'OrderedQuantity', width: 100, align: 'right', render: (v, r) => `${fmtQty(v)}${r.OrderedUOM ? ' ' + r.OrderedUOM : ''}` },
    { title: 'Unit List', dataIndex: 'UnitListPrice', width: 100, align: 'right', render: v => (v == null ? '—' : fmtQty(v)) },
    { title: 'Unit Selling', dataIndex: 'UnitSellingPrice', width: 100, align: 'right', render: v => (v == null ? '—' : fmtQty(v)) },
    { title: 'Line Total', key: 'lineTotal', width: 120, align: 'right',
      render: (_, r) => {
        const ext = num(r.OrderedQuantity) * num(r.UnitSellingPrice);
        return <Text strong style={{ color: REDWOOD.primary, fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>{fmtAmount(ext, order.TransactionalCurrencyCode ?? order.AppliedCurrencyCode)}</Text>;
      } },
    { title: 'Status', dataIndex: 'Status', width: 120, render: (v, r) => statusTag(v, r.StatusCode) },
    { title: 'Req Ship Date', dataIndex: 'RequestedShipDate', width: 120, render: fmtDate },
    { title: 'Inv Org', dataIndex: 'InventoryOrganizationCode', width: 90, render: v => v ? <Tag style={{ fontSize: 11 }}>{v}</Tag> : '—' },
    { title: 'Organization', dataIndex: 'RequestedFulfillmentOrganizationCode', width: 120,
      render: (v, r) => v ? <Tooltip title={r.RequestedFulfillmentOrganizationName}><Tag style={{ fontSize: 11 }}>{v}</Tag></Tooltip> : '—' },
    { title: 'Subinventory', dataIndex: 'SubinventoryCode', width: 120, render: v => v ?? '—' },
    ...dynamicColumns(lines, [
      'DisplayLineNumber', 'LineNumber', 'ProductNumber', 'ProductDescription', 'OrderedQuantity', 'OrderedUOM',
      'UnitListPrice', 'UnitSellingPrice', 'Status', 'StatusCode', 'RequestedShipDate', 'InventoryOrganizationCode',
      'RequestedFulfillmentOrganizationCode', 'RequestedFulfillmentOrganizationName', 'SubinventoryCode', 'Subinventory',
    ]),
    { title: '', key: 'more', width: 46, fixed: 'right', align: 'center',
      render: (_, r) => (
        <Tooltip title="All fields (null & id hidden)">
          <Button size="small" type="text" icon={<ProfileOutlined />} style={{ color: REDWOOD.info }} onClick={() => setLineDetail(r)} />
        </Tooltip>
      ) },
  ]), [lines]);

  // Build a nicely formatted Sales Order PDF (header + lines + totals).
  const buildPdf = () => {
    const doc = new jsPDF('p', 'mm', 'a4');
    const pageW = doc.internal.pageSize.getWidth();
    const RED: [number, number, number] = [199, 70, 52];
    const GREEN: [number, number, number] = [29, 123, 77];

    doc.setFillColor(...RED); doc.rect(0, 0, pageW, 24, 'F');
    doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
    doc.text('SALES ORDER', 14, 15);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    doc.text(`Order ${fmt(order.OrderNumber)}`, pageW - 14, 10, { align: 'right' });
    doc.text(`Status: ${fmt(order.Status)}`, pageW - 14, 15.5, { align: 'right' });
    doc.text(`Date: ${fmtDate(order.TransactionOn)}`, pageW - 14, 21, { align: 'right' });
    doc.setTextColor(0);

    let y = 32;
    autoTable(doc, {
      startY: y,
      body: [
        ['Business Unit', fmt(order.BusinessUnitName), 'Customer', fmt(order.BuyingPartyName)],
        ['Legal Entity', fmt(order.RequestingLegalEntity), 'Customer #', fmt(order.BuyingPartyNumber)],
        ['Source Txn #', `${fmt(order.SourceTransactionNumber)} (${fmt(order.SourceTransactionSystem)})`, 'Customer PO', fmt(order.CustomerPONumber)],
        ['Transaction Type', fmt(order.TransactionType ?? order.TransactionTypeCode), 'Currency', fmt(order.TransactionalCurrencyCode ?? order.AppliedCurrencyCode)],
        ['Payment Terms', fmt(order.PaymentTerms ?? order.PaymentTermsCode), 'Requested Ship', fmtDate(order.RequestedShipDate)],
        ['Order Key', fmt(order.OrderKey), 'Created', fmtDateTime(order.CreationDate)],
      ],
      styles: { fontSize: 9, cellPadding: 2.2 },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 32, fillColor: [245, 245, 245] }, 2: { fontStyle: 'bold', cellWidth: 30, fillColor: [245, 245, 245] } },
      margin: { left: 14, right: 14 },
    });
    y = (doc as any).lastAutoTable.finalY + 6;

    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text('Lines', 14, y); y += 2;
    autoTable(doc, {
      startY: y,
      head: [['#', 'Product', 'Description', 'Qty', 'Unit List', 'Unit Price', 'Extended', 'Status']],
      body: lines.map(l => {
        const ext = num(l.OrderedQuantity) * num(l.UnitSellingPrice);
        return [
          fmt(l.DisplayLineNumber ?? l.LineNumber),
          fmt(l.ProductNumber),
          fmt(l.ProductDescription),
          `${fmtQty(l.OrderedQuantity)}${l.OrderedUOM ? ' ' + l.OrderedUOM : ''}`,
          l.UnitListPrice == null ? '—' : fmtAmount(l.UnitListPrice),
          l.UnitSellingPrice == null ? '—' : fmtAmount(l.UnitSellingPrice),
          fmtAmount(ext),
          fmt(l.Status),
        ];
      }),
      styles: { fontSize: 8, cellPadding: 1.8, overflow: 'linebreak' },
      headStyles: { fillColor: [58, 58, 58], textColor: 255 },
      alternateRowStyles: { fillColor: [249, 249, 249] },
      columnStyles: { 0: { cellWidth: 10, halign: 'center' }, 1: { cellWidth: 26 }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { cellWidth: 22 } },
      margin: { left: 14, right: 14 },
    });
    y = (doc as any).lastAutoTable.finalY + 6;

    const tItems = totals.items;
    if (tItems.length) {
      const grand = tItems.find(isGrandTotal);
      const rows = tItems.filter(t => t !== grand).sort((a, b) => totalRank(a) - totalRank(b));
      autoTable(doc, {
        startY: y,
        body: rows.map(t => [fmt(t.TotalName ?? t.TotalCode), fmtAmount(t.TotalAmount, t.CurrencyCode)]),
        foot: grand ? [[fmt(grand.TotalName ?? 'Order Total'), fmtAmount(grand.TotalAmount, grand.CurrencyCode)]] : undefined,
        styles: { fontSize: 9, cellPadding: 2 },
        footStyles: { fillColor: GREEN, textColor: 255, fontStyle: 'bold', fontSize: 11 },
        columnStyles: { 0: { fontStyle: 'bold' }, 1: { halign: 'right' } },
        tableWidth: 80,
        margin: { left: pageW - 94, right: 14 },
      });
      y = (doc as any).lastAutoTable.finalY + 6;
    }

    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i); doc.setFontSize(8); doc.setTextColor(120);
      doc.text(`Page ${i} of ${pageCount}`, pageW / 2, 290, { align: 'center' });
      doc.text('Generated by Fusion Client', 14, 290);
      doc.setTextColor(0);
    }
    return doc;
  };

  const printOrder = () => {
    try {
      const doc = buildPdf();
      const url = URL.createObjectURL(doc.output('blob'));
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
      setPdfUrl(url);
    } catch (e: any) { message.error(`Print failed: ${e.message}`); }
  };
  const closePdf = () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); setPdfUrl(null); };

  return (
    <div style={{ padding: '4px 2px' }}>
      {/* Header card */}
      <Card size="small" style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}`, marginBottom: 12 }}
        title={<Space><BankOutlined style={{ color: REDWOOD.primary }} /><Text strong>Header</Text>
          <Tag color="volcano">{order.OrderNumber}</Tag>{statusTag(order.Status, order.StatusCode)}</Space>}
        extra={<Space>
          <Button size="small" type="primary" icon={<PrinterOutlined />} onClick={printOrder}
            style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}>Print Order</Button>
          <Tooltip title="Copy this order into a new draft order">
            <Button size="small" icon={<CopyOutlined />} disabled={!lines.length} onClick={() => onCopy?.(order, lines)}
              style={lines.length ? { color: REDWOOD.info, borderColor: REDWOOD.info } : undefined}>Copy Order</Button>
          </Tooltip>
          <Tooltip title={selectedKeys.length ? `Return the ${selectedKeys.length} selected line(s)` : 'Return the whole order (select lines below to return only some)'}>
            <Button size="small" icon={<RollbackOutlined />} disabled={!lines.length} onClick={() => doReturn(selectedKeys.length === 0)}
              style={lines.length ? { color: '#B12A5B', borderColor: '#B12A5B' } : undefined}>
              {selectedKeys.length ? `Return ${selectedKeys.length} Line(s)` : 'Return Order'}
            </Button>
          </Tooltip>
          <Tooltip title={resvCount ? `${resvCount} reservation(s) exist for this order` : 'View stock reservations for this order'}>
            <Button size="small" icon={<SafetyCertificateOutlined />} onClick={() => setResvOpen(true)}
              style={resvCount ? { color: REDWOOD.success, borderColor: REDWOOD.success, fontWeight: 600 } : undefined}>
              Reservations{resvCount ? ` (${resvCount})` : ''}
            </Button>
          </Tooltip>
          {lines.some(l => /awaiting\s*shipping/i.test(`${pf(l, ['DisplayStatus', 'Status', 'FulfillLineStatus']) ?? ''} ${pf(l, ['StatusCode']) ?? ''}`)) &&
            <Tooltip title="Line(s) awaiting shipping — pick release, pick confirm and ship confirm">
              <Button size="small" icon={<CarOutlined />} onClick={() => setAutoShipOpen(true)}
                style={{ color: REDWOOD.success, borderColor: REDWOOD.success, fontWeight: 600 }}>Auto Shipconfirm</Button>
            </Tooltip>}
          {lines.some(l => /awaiting\s*billing/i.test(`${pf(l, ['DisplayStatus', 'Status', 'FulfillLineStatus']) ?? ''} ${pf(l, ['StatusCode']) ?? ''}`)) &&
            <Tooltip title="Line(s) awaiting billing — run Import AutoInvoice to push to AR">
              <Button size="small" icon={<DollarOutlined />} onClick={() => setArOpen(true)}
                style={{ color: REDWOOD.primary, borderColor: REDWOOD.primary, fontWeight: 600 }}>Push to AR</Button>
            </Tooltip>}
          <Button size="small" icon={<ProfileOutlined />} onClick={() => setHdrOpen(true)}>All fields</Button>
          <Tooltip title={<span style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}><b>GET</b> {fusionHref(linesHref || '(no order lines link)')}</span>}>
            <Button size="small" type="text" icon={<ApiOutlined />} style={{ color: REDWOOD.info }} />
          </Tooltip>
        </Space>}>
        <Row gutter={[16, 12]}>
          {/* Info fields — Current info + Additional info (header EFF) tabs */}
          <Col xs={24} lg={17}>
            <Tabs size="small" items={[
              {
                key: 'cur', label: <span><InfoCircleOutlined style={{ marginRight: 5 }} />Current Info</span>,
                children: (
                  <Row gutter={[12, 0]}>
                    <HInfo label="Order Number" value={<Text strong>{order.OrderNumber}</Text>} />
                    <HInfo label="Source Transaction #" value={<span>{order.SourceTransactionNumber ?? '—'}{order.SourceTransactionSystem ? <Tag style={{ marginLeft: 6, fontSize: 10 }}>{order.SourceTransactionSystem}</Tag> : null}</span>} />
                    <HInfo label="Order Key" value={order.OrderKey} />
                    <HInfo label="Transaction Type" value={order.TransactionType ? <Tag color="purple">{order.TransactionType}</Tag> : (order.TransactionTypeCode ?? '—')} />
                    <HInfo label="Business Unit" value={order.BusinessUnitName} />
                    <HInfo label="Customer" value={order.BuyingPartyName} />
                    <HInfo label="Customer #" value={order.BuyingPartyNumber} />
                    <HInfo label="Customer PO" value={order.CustomerPONumber} />
                    <HInfo label="Currency" value={order.TransactionalCurrencyCode ?? order.TransactionalCurrencyName ?? order.AppliedCurrencyCode} />
                    <HInfo label="Payment Terms" value={order.PaymentTerms ?? order.PaymentTermsCode} />
                    <HInfo label="Transaction On" value={fmtDateTime(order.TransactionOn)} />
                    <HInfo label="Requested Ship" value={fmtDate(order.RequestedShipDate)} />
                    <HInfo label="Requested Arrival" value={fmtDate(order.RequestedArrivalDate)} />
                    <HInfo label="Requesting BU" value={order.RequestingBusinessUnitName} />
                    <HInfo label="Legal Entity" value={order.RequestingLegalEntity} />
                    <HInfo label="Organization" value={orgList.length ? <Space size={4} wrap>{orgList.map(o => <Tooltip key={o} title={orgNameOf(o)}><Tag style={{ margin: 0 }}>{o}</Tag></Tooltip>)}</Space> : '—'} />
                    <HInfo label="Subinventory" value={subList.length ? <Space size={4} wrap>{subList.map(s => <Tag key={s} style={{ margin: 0 }}>{s}</Tag>)}</Space> : '—'} />
                    <HInfo label="Created" value={fmtDateTime(order.CreationDate)} />
                  </Row>
                ),
              },
              {
                key: 'addl', label: <span><ProfileOutlined style={{ marginRight: 5 }} />Additional Info</span>,
                children: <HeaderEffView order={order} />,
              },
            ]} />
          </Col>
          {/* Order total — inside the header */}
          <Col xs={24} lg={7}>
            <div style={{ borderLeft: `1px solid ${REDWOOD.neutral200}`, paddingLeft: 16, height: '100%' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <DollarOutlined style={{ color: REDWOOD.success }} />
                <Text strong style={{ fontSize: 12.5 }}>Order Total</Text>
                <span style={{ marginLeft: 'auto' }}>
                  <Tooltip title={<span style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}><b>GET</b> {totals.href}</span>}>
                    <Button size="small" type="text" icon={<ApiOutlined />} style={{ color: REDWOOD.info }} />
                  </Tooltip>
                  <Button size="small" type="text" icon={<ReloadOutlined />} loading={totals.loading} onClick={totals.load} />
                </span>
              </div>
              {totals.loading ? <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>
                : totals.error ? <div style={{ color: REDWOOD.error, fontSize: 12 }}><InfoCircleOutlined style={{ marginRight: 6 }} />{totals.error}</div>
                : <TotalsSummary items={totals.items} currency={order.TransactionalCurrencyCode ?? order.AppliedCurrencyCode ?? order.TransactionalCurrencyName} />}
            </div>
          </Col>
        </Row>
      </Card>

      {/* Lines + one tab per line-level child collection (lotSerials, …) */}
      <Card size="small" styles={{ body: { padding: '4px 10px 10px' } }} style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}`, marginTop: 12 }}>
        <Tabs size="small" items={[
          {
            key: 'lines',
            label: <span><UnorderedListOutlined style={{ marginRight: 5 }} />Lines{lines.length ? ` (${lines.length})` : ''}</span>,
            children: (
              <div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 8 }}>
                  <Tooltip title={<span style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}><b>GET</b> {linesHref}</span>}>
                    <Button size="small" type="text" icon={<ApiOutlined />} style={{ color: REDWOOD.info }} />
                  </Tooltip>
                  <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={loadLines}>Reload</Button>
                </div>
                {loading ? <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
                  : error ? <div style={{ color: REDWOOD.error, fontSize: 12, padding: 16 }}><InfoCircleOutlined style={{ marginRight: 6 }} />{error}</div>
                  : lines.length === 0 ? <Empty description="No lines" style={{ padding: 30 }} />
                  : <Table size="small" columns={lineCols} dataSource={lines} rowKey={lineKey}
                      rowSelection={{ selectedRowKeys: selectedKeys, onChange: setSelectedKeys, columnWidth: 40, fixed: true }}
                      pagination={lines.length > 25 ? { pageSize: 25, size: 'small' } : false} scroll={{ x: 'max-content', y: 420 }}
                      summary={(data) => {
                        const ordCcy = order.TransactionalCurrencyCode ?? order.AppliedCurrencyCode ?? order.TransactionalCurrencyName;
                        const totQty = data.reduce((s, r) => s + num(r.OrderedQuantity), 0);
                        const totAmt = data.reduce((s, r) => s + num(r.OrderedQuantity) * num(r.UnitSellingPrice), 0);
                        return (
                          <Table.Summary fixed>
                            <Table.Summary.Row style={{ background: REDWOOD.neutral100 }}>
                              <Table.Summary.Cell index={0} />
                              <Table.Summary.Cell index={1} colSpan={3}><Text strong>Total ({data.length} line{data.length !== 1 ? 's' : ''})</Text></Table.Summary.Cell>
                              <Table.Summary.Cell index={4} align="right"><Text strong>{fmtQty(totQty)}</Text></Table.Summary.Cell>
                              <Table.Summary.Cell index={5} />
                              <Table.Summary.Cell index={6} />
                              <Table.Summary.Cell index={7} align="right"><Text strong style={{ color: REDWOOD.primary, fontVariantNumeric: 'tabular-nums' }}>{fmtAmount(totAmt, ordCcy)}</Text></Table.Summary.Cell>
                              <Table.Summary.Cell index={8} colSpan={Math.max(1, lineCols.length - 7)} />
                            </Table.Summary.Row>
                          </Table.Summary>
                        );
                      }} />}
              </div>
            ),
          },
          {
            key: 'actualCosting',
            label: <span><DollarOutlined style={{ marginRight: 5 }} />Actual Costing</span>,
            children: lines.length === 0
              ? <Empty description="No lines" style={{ padding: 30 }} />
              : <ActualCostingTab lines={lines} currency={order.TransactionalCurrencyCode ?? order.AppliedCurrencyCode ?? order.TransactionalCurrencyName} />,
          },
          {
            key: 'lineAddl',
            label: <span><ProfileOutlined style={{ marginRight: 5 }} />Additional Info</span>,
            children: lines.length === 0 ? <Empty description="No lines" style={{ padding: 30 }} /> : <LineEffView lines={lines} />,
          },
          ...childTabItems,
        ]} />
      </Card>

      {/* Print preview */}
      <Modal open={!!pdfUrl} onCancel={closePdf} maskClosable={false} width={920} style={{ top: 20 }}
        title={<Space><PrinterOutlined style={{ color: REDWOOD.primary }} /> Order {order.OrderNumber} — Print Preview</Space>}
        footer={<Space>
          <Button icon={<DownloadOutlined />} onClick={() => { if (!pdfUrl) return; const a = document.createElement('a'); a.href = pdfUrl; a.download = `SalesOrder_${order.OrderNumber}.pdf`; a.click(); }}>Download</Button>
          <Button onClick={closePdf}>Close</Button>
        </Space>}>
        {pdfUrl && <iframe src={pdfUrl} title="order-pdf" style={{ width: '100%', height: '72vh', border: 'none' }} />}
      </Modal>

      <AllFieldsModal title={`Order ${order.OrderNumber} — header`} row={hdrOpen ? order : null} onClose={() => setHdrOpen(false)} />
      <AllFieldsModal title={`Line ${lineDetail?.DisplayLineNumber ?? ''} — ${lineDetail?.ProductNumber ?? ''}`} row={lineDetail} onClose={() => setLineDetail(null)} />
      <ARInvoiceDialog txn={arTxn} onClose={() => setArTxn(null)} />
      <ReservationsView orderNo={sourceNo} items={lineItems} open={resvOpen} onClose={() => setResvOpen(false)} />
      <AutoInvoiceModal orderNo={sourceNo} buId={order.BusinessUnitId} open={arOpen} onClose={() => setArOpen(false)} />
      <AutoShipConfirmModal orderNo={sourceNo} open={autoShipOpen} onClose={() => setAutoShipOpen(false)} />
    </div>
  );
};

// ── Search tab ───────────────────────────────────────────────────────────────
interface Filters {
  dateFrom?: Dayjs | null; dateTo?: Dayjs | null;
  businessUnit?: string; businessUnitId?: string; customer?: string; customerNumber?: string;
  statusCode?: string; orderKey?: string; orderType?: string;
}

const STATUS_CODES = [
  { value: 'DOO_DRAFT', label: 'Draft (DOO_DRAFT)' },
  { value: 'DOO_OPEN', label: 'Open (DOO_OPEN)' },
  { value: 'DOO_SUBMITTED', label: 'Submitted (DOO_SUBMITTED)' },
  { value: 'DOO_PROCESSING', label: 'Processing (DOO_PROCESSING)' },
  { value: 'DOO_SCHEDULED', label: 'Scheduled (DOO_SCHEDULED)' },
  { value: 'DOO_SHIPPED', label: 'Shipped (DOO_SHIPPED)' },
  { value: 'DOO_CLOSED', label: 'Closed (DOO_CLOSED)' },
  { value: 'DOO_CANCELED', label: 'Canceled (DOO_CANCELED)' },
];

const SearchTab: React.FC<{ onOpen: (order: any) => void; onEdit: (order: any) => void }> = ({ onOpen, onEdit }) => {
  const auth = useAuth();
  const [form] = Form.useForm();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');
  const [apiOpen, setApiOpen] = useState(false);
  const [apiRun, setApiRun] = useState<{ running: boolean; status?: string; body?: string; ok?: boolean } | null>(null);
  const [filterText, setFilterText] = useState('');
  const [searchTab, setSearchTab] = useState<'orders' | 'lines' | 'analytics'>('orders');
  const [linesFilterText, setLinesFilterText] = useState('');
  const [analyticsView, setAnalyticsView] = useState<'date' | 'month' | 'item' | 'customer' | 'type'>('month');
  const [analyticsFilters, setAnalyticsFilters] = useState<{ customer?: string; product?: string; type?: string }>({});
  const [showAnalyticsChart, setShowAnalyticsChart] = useState(false);
  const [chartType, setChartType] = useState<'bar' | 'line' | 'pie'>('bar');
  const [analyticsLoadLimit, setAnalyticsLoadLimit] = useState(50);

  // Execute an API URL straight from the dialog — shows HTTP status, timing and
  // the raw response (or the error) so an unreachable POD is easy to diagnose.
  const runApi = async (url: string) => {
    setApiRun({ running: true });
    const started = Date.now();
    try {
      const r = await fetchWithTimeout(url, { headers: getHeaders() });
      const text = await r.text();
      setApiRun({ running: false, ok: r.ok, status: `HTTP ${r.status} ${r.statusText} · ${text.length} bytes · ${Date.now() - started}ms`, body: text.slice(0, 4000) });
    } catch (e: any) {
      setApiRun({ running: false, ok: false, status: `Failed after ${Date.now() - started}ms`, body: e?.message || String(e) });
    }
  };
  const [showDooRef, setShowDooRef] = useState(false);
  const [detail, setDetail] = useState<any | null>(null);
  const [totalsOrder, setTotalsOrder] = useState<any | null>(null);
  const [pageOffset, setPageOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busUnits, setBusUnits] = useState<any[]>([]);
  const [busUnitsLoading, setBusUnitsLoading] = useState(false);
  const [orderTypeOpts, setOrderTypeOpts] = useState<any[]>([]);
  const [orderTypeLookup, setOrderTypeLookup] = useState<Map<string, any>>(new Map());

  const [filters, setFilters] = useState<Filters>({
    dateFrom: dayjs().subtract(1, 'month'), dateTo: dayjs().add(1, 'day'),
  });

  // Load business units from payablesOptions API on mount
  useEffect(() => {
    const loadBusinessUnits = async () => {
      setBusUnitsLoading(true);
      try {
        const url = `${FUSION_BASE}/payablesOptions?onlyData=true&limit=500&fields=businessUnitId,businessUnitName,paymentCurrency,ledgerCurrency`;
        const r = await fetchWithTimeout(url, { headers: getHeaders() });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = await r.json();
        const items = d.items ?? [];
        // Deduplicate by businessUnitName
        const seen = new Set<string>();
        const deduped = items.filter((bu: any) => {
          const name = bu.businessUnitName;
          if (seen.has(name)) return false;
          seen.add(name);
          return true;
        });
        setBusUnits(deduped);
      } catch (e: any) {
        console.error('Error loading business units:', e);
        setBusUnits([]);
      } finally {
        setBusUnitsLoading(false);
      }
    };
    loadBusinessUnits();
  }, []);

  // Load order types from standardLookups
  useEffect(() => {
    fetch(`${FUSION_BASE}/standardLookups?q=LookupType LIKE 'ORA_DOO_ORDER_TYPES%'&expand=lookupCodes&onlyData=true&limit=500`, { headers: getHeaders() })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => {
        const items = d.items ?? [];
        const lookup = new Map<string, any>();
        const opts: any[] = [];
        items.forEach((lookupType: any) => {
          (lookupType.lookupCodes ?? []).forEach((code: any) => {
            lookup.set(code.LookupCode, code);
            opts.push({ value: code.LookupCode, label: `${code.LookupCode} — ${code.Meaning}` });
          });
        });
        setOrderTypeLookup(lookup);
        setOrderTypeOpts(opts);
      })
      .catch(e => console.error('Error loading order types:', e));
  }, []);

  // Dates unquoted (TransactionOn>2026-01-16); text uses SQL LIKE; codes exact.
  const buildQ = useCallback((f: Filters) => {
    const parts: string[] = [];
    if (f.dateFrom) parts.push(`TransactionOn>${dayjs(f.dateFrom).format('YYYY-MM-DD')}`);
    if (f.dateTo) parts.push(`TransactionOn<${dayjs(f.dateTo).format('YYYY-MM-DD')}`);
    if (f.businessUnitId) parts.push(`RequestingBusinessUnitId=${String(f.businessUnitId)}`);
    if (f.orderType) parts.push(`TransactionTypeCode='${f.orderType}'`);
    if (f.customer?.trim()) parts.push(`BuyingPartyName LIKE '%${f.customer.trim()}%'`);
    if (f.customerNumber?.trim()) parts.push(`BuyingPartyNumber='${f.customerNumber.trim()}'`);
    if (f.statusCode) parts.push(`StatusCode='${f.statusCode}'`);
    if (f.orderKey?.trim()) parts.push(`OrderKey='${f.orderKey.trim()}'`);
    return parts.join(';');
  }, []);

  const searchUrl = useMemo(() => {
    const q = buildQ(filters);
    const qs = q ? `q=${encodeURIComponent(q)}&` : '';
    return `${FUSION_BASE}/salesOrdersForOrderHub?${qs}orderBy=TransactionOn:desc&expand=lines`;
  }, [filters, buildQ]);

  // Fetch one page of 50 at a time (no deep paging) so the search stays fast on
  // large PODs. "Load next 50" pulls the following page and appends it.
  const SEARCH_LIMIT = 50;
  const fetchPage = useCallback(async (off: number, append: boolean) => {
    if (append) setLoadingMore(true); else { setLoading(true); setError(''); setSearched(true); }
    try {
      const stripped = searchUrl.replace(/[?&]limit=\d+/gi, '').replace(/[?&]offset=\d+/gi, '').replace(/\?&/, '?').replace(/&&/g, '&');
      const sep = stripped.includes('?') ? '&' : '?';
      const r = await fetchWithTimeout(`${stripped}${sep}limit=${SEARCH_LIMIT}&offset=${off}`, { headers: getHeaders() });
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);
      const d = await r.json();
      const items: any[] = Array.isArray(d) ? d : (d.items ?? []);
      setRows(prev => append ? [...prev, ...items] : items);
      setPageOffset(off);
      setHasMore(!!d.hasMore && items.length === SEARCH_LIMIT);
      if (!append && items.length === 0) setError('No sales orders matched.');
    } catch (e: any) {
      if (append) message.error(e.message); else { setError(e.message); setRows([]); }
    } finally {
      if (append) setLoadingMore(false); else setLoading(false);
    }
  }, [searchUrl]);
  const runSearch = useCallback(() => {
    if (!filters.businessUnitId) {
      message.error('Please select a Business Unit to search');
      return;
    }
    fetchPage(0, false);
  }, [fetchPage, filters.businessUnitId]);
  const loadMore = useCallback(() => fetchPage(pageOffset + SEARCH_LIMIT, true), [fetchPage, pageOffset]);

  const filtered = useMemo(() => {
    let base = rows;
    // Hide reference/skeleton orders (StatusCode DOO_REFERENCE) unless opted in.
    if (!showDooRef) base = base.filter(r => String(r.StatusCode ?? '').toUpperCase() !== 'DOO_REFERENCE');
    const t = filterText.trim().toLowerCase();
    if (t) base = base.filter(r => JSON.stringify(r).toLowerCase().includes(t));
    // Sort by Order Date descending (most recent first)
    base = base.sort((a, b) => new Date(b.TransactionOn ?? '').getTime() - new Date(a.TransactionOn ?? '').getTime());
    return base;
  }, [rows, filterText, showDooRef]);

  const columns = useMemo<ColumnsType<any>>(() => ([
    { title: 'Source Txn #', dataIndex: 'SourceTransactionNumber', width: 185, fixed: 'left',
      sorter: (a, b) => String(a.SourceTransactionNumber ?? '').localeCompare(String(b.SourceTransactionNumber ?? '')),
      render: (v, r) => (
        <Space size={2} style={{ maxWidth: '100%' }}>
          <Button type="link" style={{ padding: 0, fontWeight: 700, color: REDWOOD.info, fontSize: 12, maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis' }}
            title={v ?? r.OrderNumber} onClick={() => onOpen(r)}>{v ?? r.OrderNumber ?? '—'}</Button>
          <Tooltip title="View order"><Button size="small" type="text" icon={<EyeOutlined />} style={{ color: REDWOOD.info }} onClick={() => onOpen(r)} /></Tooltip>
          <Tooltip title="Edit order (change order)"><Button size="small" type="text" icon={<EditOutlined />} style={{ color: '#B07700' }} onClick={() => onEdit(r)} /></Tooltip>
        </Space>
      ) },
    { title: 'Order', dataIndex: 'OrderNumber', width: 100,
      sorter: (a, b) => String(a.OrderNumber ?? '').localeCompare(String(b.OrderNumber ?? '')),
      render: v => <Text strong style={{ fontSize: 12 }}>{v ?? '—'}</Text> },
    { title: 'Order Date', dataIndex: 'TransactionOn', width: 130, render: fmtDate,
      sorter: (a, b) => new Date(b.TransactionOn ?? '').getTime() - new Date(a.TransactionOn ?? '').getTime(),
      defaultSortOrder: 'descend' as const },
    { title: 'Transaction Type', dataIndex: 'TransactionType', width: 140,
      sorter: (a, b) => String(a.TransactionType ?? '').localeCompare(String(b.TransactionType ?? '')),
      render: (v, r) => v ? <Tag color="purple" style={{ fontSize: 11 }}>{v}</Tag> : (r.TransactionTypeCode ? <Tag style={{ fontSize: 11 }}>{r.TransactionTypeCode}</Tag> : '—') },
    { title: 'Currency', dataIndex: 'TransactionalCurrencyCode', width: 90, align: 'center',
      sorter: (a, b) => String(a.TransactionalCurrencyCode ?? '').localeCompare(String(b.TransactionalCurrencyCode ?? '')),
      render: (v, r) => <Tag style={{ fontSize: 11 }}>{v ?? r.AppliedCurrencyCode ?? '—'}</Tag> },
    { title: 'Payment Terms', dataIndex: 'PaymentTerms', width: 150, ellipsis: true,
      sorter: (a, b) => String(a.PaymentTerms ?? '').localeCompare(String(b.PaymentTerms ?? '')),
      render: (v, r) => <Text style={{ fontSize: 12 }}>{v ?? r.PaymentTermsCode ?? '—'}</Text> },
    { title: 'Status', dataIndex: 'Status', width: 160,
      sorter: (a, b) => String(a.Status ?? '').localeCompare(String(b.Status ?? '')),
      render: (v, r) => (
        <Space size={4} wrap>
          {statusTag(v, r.StatusCode)}
          {r.StatusCode && <Tag style={{ fontSize: 10, margin: 0 }}>{r.StatusCode}</Tag>}
        </Space>
      ) },
    { title: 'Business Unit', dataIndex: 'BusinessUnitName', width: 220, ellipsis: true,
      sorter: (a, b) => String(a.BusinessUnitName ?? '').localeCompare(String(b.BusinessUnitName ?? '')),
      render: v => <Text style={{ fontSize: 12 }}>{v ?? '—'}</Text> },
    { title: 'Customer', dataIndex: 'BuyingPartyName', width: 220, ellipsis: true,
      sorter: (a, b) => String(a.BuyingPartyName ?? '').localeCompare(String(b.BuyingPartyName ?? '')),
      render: v => <Text strong style={{ fontSize: 12 }}>{v ?? '—'}</Text> },
    { title: 'Customer #', dataIndex: 'BuyingPartyNumber', width: 110,
      sorter: (a, b) => String(a.BuyingPartyNumber ?? '').localeCompare(String(b.BuyingPartyNumber ?? '')),
      render: v => v ?? '—' },
    { title: 'Customer PO', dataIndex: 'CustomerPONumber', width: 120,
      sorter: (a, b) => String(a.CustomerPONumber ?? '').localeCompare(String(b.CustomerPONumber ?? '')),
      render: v => v ?? '—' },
    { title: 'Requested Ship', dataIndex: 'RequestedShipDate', width: 130,
      sorter: (a, b) => String(a.RequestedShipDate ?? '').localeCompare(String(b.RequestedShipDate ?? '')),
      render: fmtDate },
    { title: 'Source System', dataIndex: 'SourceTransactionSystem', width: 110,
      sorter: (a, b) => String(a.SourceTransactionSystem ?? '').localeCompare(String(b.SourceTransactionSystem ?? '')),
      render: v => v ? <Tag style={{ fontSize: 11 }}>{v}</Tag> : '—' },
    { title: 'Order Key', dataIndex: 'OrderKey', width: 200, ellipsis: true,
      sorter: (a, b) => String(a.OrderKey ?? '').localeCompare(String(b.OrderKey ?? '')),
      render: v => <Text style={{ fontSize: 11, fontFamily: 'monospace' }}>{v ?? '—'}</Text> },
    { title: 'Created', dataIndex: 'CreationDate', width: 130,
      sorter: (a, b) => String(a.CreationDate ?? '').localeCompare(String(b.CreationDate ?? '')),
      render: fmtDateTime },
    { title: '', key: 'totals', width: 44, fixed: 'right', align: 'center',
      render: (_, r) => (
        <Tooltip title="Order totals">
          <Button size="small" type="text" icon={<DollarOutlined />} style={{ color: REDWOOD.success }} onClick={() => setTotalsOrder(r)} />
        </Tooltip>
      ) },
    { title: '', key: 'more', width: 46, fixed: 'right', align: 'center',
      render: (_, r) => (
        <Tooltip title="All fields (null & id hidden)">
          <Button size="small" type="text" icon={<ProfileOutlined />} style={{ color: REDWOOD.info }} onClick={() => setDetail(r)} />
        </Tooltip>
      ) },
  ]), [onOpen, onEdit]);

  // Columns for the Search Lines tab
  const lineColumns = useMemo(() => [
    { title: '', key: 'action', width: 44, fixed: 'left' as const, align: 'center' as const,
      render: (_, r: any) => (
        <Tooltip title="View order">
          <Button size="small" type="text" icon={<ExportOutlined />} style={{ color: REDWOOD.info }} onClick={() => onOpen(r._headerInfo._order)} />
        </Tooltip>
      ) },
    { title: 'Source Transaction #', dataIndex: 'SourceTransactionNumber', width: 160, fixed: 'left' as const, ellipsis: true,
      sorter: (a, b) => String(a.SourceTransactionNumber ?? '').localeCompare(String(b.SourceTransactionNumber ?? '')),
      render: (v, r: any) => (
        <Button type="link" style={{ padding: 0, fontWeight: 700, color: REDWOOD.info, fontSize: 12, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis' }}
          title={v ?? r._headerInfo?.OrderNumber} onClick={() => onOpen(r._headerInfo._order)}>{v ?? '—'}</Button>
      ) },
    { title: 'Transaction Type', dataIndex: ['_headerInfo', 'TransactionTypeCode'], width: 160, ellipsis: true,
      sorter: (a, b) => String(a._headerInfo?.TransactionTypeCode ?? '').localeCompare(String(b._headerInfo?.TransactionTypeCode ?? '')),
      render: (v: any) => v ? <Tag color="purple" style={{ fontSize: 11, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }} title={v}>{v}</Tag> : '—' },
    { title: 'Transaction Date', dataIndex: ['_headerInfo', 'TransactionOn'], width: 130,
      sorter: (a, b) => String(a._headerInfo?.TransactionOn ?? '').localeCompare(String(b._headerInfo?.TransactionOn ?? '')),
      render: fmtDateTime },
    { title: 'Customer', dataIndex: ['_headerInfo', 'BuyingPartyName'], width: 220, ellipsis: true,
      sorter: (a, b) => String(a._headerInfo?.BuyingPartyName ?? '').localeCompare(String(b._headerInfo?.BuyingPartyName ?? '')),
      render: (v: any) => <Text strong style={{ fontSize: 12 }}>{v ?? '—'}</Text> },
    { title: 'Order #', dataIndex: ['_headerInfo', 'OrderNumber'], width: 100,
      sorter: (a, b) => String(a._headerInfo?.OrderNumber ?? '').localeCompare(String(b._headerInfo?.OrderNumber ?? '')),
      render: (v: any, r: any) => (
        <Button type="link" style={{ padding: 0, fontWeight: 700, color: REDWOOD.info, fontSize: 12 }}
          onClick={() => onOpen(r._headerInfo._order)}>{v ?? '—'}</Button>
      ) },
    { title: 'Product #', dataIndex: 'ProductNumber', width: 120,
      sorter: (a, b) => String(a.ProductNumber ?? '').localeCompare(String(b.ProductNumber ?? '')),
      render: v => v ?? '—' },
    { title: 'Product Description', dataIndex: 'ProductDescription', width: 250, ellipsis: true,
      sorter: (a, b) => String(a.ProductDescription ?? '').localeCompare(String(b.ProductDescription ?? '')),
      render: v => <Text style={{ fontSize: 12 }}>{v ?? '—'}</Text> },
    { title: 'Qty', dataIndex: 'OrderedQuantity', width: 80, align: 'right' as const,
      sorter: (a, b) => (a.OrderedQuantity ?? 0) - (b.OrderedQuantity ?? 0),
      render: v => typeof v === 'number' ? Number(v).toFixed(2) : v ?? '—' },
    { title: 'Unit Price', dataIndex: 'UnitSellingPrice', width: 110, align: 'right' as const,
      sorter: (a, b) => (a.UnitSellingPrice ?? 0) - (b.UnitSellingPrice ?? 0),
      render: v => typeof v === 'number' ? Number(v).toFixed(2) : v ?? '—' },
    { title: 'Extended Amount', dataIndex: 'ExtendedAmount', width: 130, align: 'right' as const,
      sorter: (a, b) => (a.ExtendedAmount ?? 0) - (b.ExtendedAmount ?? 0),
      render: v => typeof v === 'number' ? Number(v).toFixed(2) : v ?? '—' },
    { title: 'Currency', dataIndex: ['_headerInfo', 'TransactionalCurrencyCode'], width: 90, align: 'center' as const,
      sorter: (a, b) => String(a._headerInfo?.TransactionalCurrencyCode ?? '').localeCompare(String(b._headerInfo?.TransactionalCurrencyCode ?? '')),
      render: (v: any) => <Tag style={{ fontSize: 11 }}>{v ?? '—'}</Tag> },
    { title: 'Status', dataIndex: 'Status', width: 140,
      sorter: (a, b) => String(a.Status ?? '').localeCompare(String(b.Status ?? '')),
      render: (v: any, r: any) => (
        <Space size={4} wrap>
          {statusTag(v, r.StatusCode)}
          {r.StatusCode && <Tag style={{ fontSize: 10, margin: 0 }}>{r.StatusCode}</Tag>}
        </Space>
      ) },
    { title: 'Org Code', dataIndex: 'RequestedFulfillmentOrganizationCode', width: 120,
      sorter: (a, b) => String(a.RequestedFulfillmentOrganizationCode ?? '').localeCompare(String(b.RequestedFulfillmentOrganizationCode ?? '')),
      render: v => v ?? '—' },
    { title: 'Org Name', dataIndex: 'RequestedFulfillmentOrganizationName', width: 200, ellipsis: true,
      sorter: (a, b) => String(a.RequestedFulfillmentOrganizationName ?? '').localeCompare(String(b.RequestedFulfillmentOrganizationName ?? '')),
      render: v => <Text style={{ fontSize: 12 }}>{v ?? '—'}</Text> },
    { title: '', key: 'totals', width: 44, fixed: 'right' as const, align: 'center' as const,
      render: (_, r) => (
        <Tooltip title="Line totals">
          <Button size="small" type="text" icon={<DollarOutlined />} style={{ color: REDWOOD.success }} onClick={() => setTotalsOrder(r._headerInfo?._order)} />
        </Tooltip>
      ) },
  ], [onOpen]);

  // Extract all lines from rows for the Search Lines tab
  const allLines = useMemo(() => {
    if (!rows || rows.length === 0) return [];
    const lines: any[] = [];
    rows.forEach(order => {
      if (order.lines && Array.isArray(order.lines)) {
        order.lines.forEach((line: any) => {
          lines.push({
            ...line,
            _headerInfo: {
              BuyingPartyName: order.BuyingPartyName,
              OrderNumber: order.OrderNumber,
              TransactionalCurrencyCode: order.TransactionalCurrencyCode,
              TransactionTypeCode: order.TransactionTypeCode,
              TransactionOn: order.TransactionOn,
              _order: order,
            },
            key: `${order.HeaderId}-${line.LineId}`,
          });
        });
      }
    });
    return lines;
  }, [rows]);

  // Filter lines based on search text
  const filteredLines = useMemo(() => {
    if (!linesFilterText.trim()) return allLines;
    const search = linesFilterText.toLowerCase();
    return allLines.filter(line => {
      const searchableFields = [
        line._headerInfo?.BuyingPartyName,
        line._headerInfo?.OrderNumber,
        line.SourceTransactionNumber,
        line.ProductNumber,
        line.ProductDescription,
        line.RequestedFulfillmentOrganizationCode,
        line.RequestedFulfillmentOrganizationName,
        line.Status,
        line.StatusCode,
        line._headerInfo?.TransactionTypeCode,
      ];
      return searchableFields.some(field => String(field ?? '').toLowerCase().includes(search));
    });
  }, [allLines, linesFilterText]);

  // Analytics aggregation functions
  const getAnalyticsData = useMemo(() => {
    let data = filteredLines;
    if (analyticsFilters.customer) data = data.filter(l => String(l._headerInfo?.BuyingPartyName ?? '').includes(analyticsFilters.customer));
    if (analyticsFilters.product) data = data.filter(l => String(l.ProductNumber ?? '').includes(analyticsFilters.product));
    if (analyticsFilters.type) data = data.filter(l => String(l._headerInfo?.TransactionTypeCode ?? '') === analyticsFilters.type);

    const result: Record<string, any> = {};
    data.forEach(line => {
      let key = '';
      if (analyticsView === 'date') {
        key = dayjs(line._headerInfo?.TransactionOn).format('YYYY-MM-DD');
      } else if (analyticsView === 'month') {
        key = dayjs(line._headerInfo?.TransactionOn).format('YYYY-MM');
      } else if (analyticsView === 'item') {
        key = line.ProductNumber || 'Unknown';
      } else if (analyticsView === 'customer') {
        key = line._headerInfo?.BuyingPartyName || 'Unknown';
      } else if (analyticsView === 'type') {
        key = line._headerInfo?.TransactionTypeCode || 'Unknown';
      }

      if (!result[key]) {
        result[key] = { key, quantity: 0, amount: 0, count: 0, avgPrice: 0, description: line.ProductDescription || line._headerInfo?.BuyingPartyName || '' };
      }
      result[key].quantity += line.OrderedQuantity || 0;
      result[key].amount += line.ExtendedAmount || 0;
      result[key].count += 1;
    });

    return Object.values(result).map(r => ({
      ...r,
      avgPrice: r.count > 0 ? r.amount / r.quantity : 0,
    })).sort((a, b) => b.amount - a.amount);
  }, [filteredLines, analyticsView, analyticsFilters]);

  // Get unique values for analytics filters
  const analyticsFilterOptions = useMemo(() => {
    const customers = [...new Set(filteredLines.map(l => l._headerInfo?.BuyingPartyName).filter(Boolean))].sort();
    const products = [...new Set(filteredLines.map(l => l.ProductNumber).filter(Boolean))].sort();
    const types = [...new Set(filteredLines.map(l => l._headerInfo?.TransactionTypeCode).filter(Boolean))].sort();
    return { customers, products, types };
  }, [filteredLines]);

  // Export orders to Excel
  const exportOrdersToExcel = async () => {
    if (filtered.length === 0) { message.warning('No orders to export'); return; }
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Orders');

    // Title
    const titleCell = worksheet.addRow(['Sales Orders']);
    titleCell.font = { bold: true, size: 14, color: { argb: 'FFC74634' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'center' };
    worksheet.mergeCells('A1:M1');
    worksheet.getRow(1).height = 24;

    // Summary info
    worksheet.addRow(['']);
    const summaryRow = worksheet.addRow([
      `Date: ${dayjs().format('YYYY-MM-DD HH:mm')}`,
      `Total Orders: ${filtered.length}`,
    ]);
    summaryRow.font = { size: 10 };
    worksheet.addRow(['']);

    // Headers
    const headers = ['Order Number', 'Customer', 'Order Date', 'Status', 'Currency', 'Ordered Qty', 'Ordered Amount', 'Freight', 'Tax', 'Total', 'Business Unit', 'Type', 'Buyer'];
    const headerRow = worksheet.addRow(headers);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC74634' } };
    headerRow.alignment = { horizontal: 'center', vertical: 'center' };

    // Data rows
    filtered.forEach((row: any) => {
      const dataRow = worksheet.addRow([
        row.OrderNumber,
        row.BuyingPartyName ?? '—',
        fmtDate(row.TransactionOn),
        row.StatusCode ?? row.Status,
        row.AppliedCurrencyCode ?? row.CurrencyCode ?? 'AED',
        row.OrderedQuantity ?? 0,
        row.OrderedAmount ?? 0,
        row.FreightAmount ?? 0,
        row.TaxAmount ?? 0,
        row.GrandTotalAmount ?? row.OrderAmount ?? 0,
        row.BusinessUnitName ?? '—',
        row.TransactionTypeCode ?? row.TransactionType ?? '—',
        row.BuyerName ?? '—',
      ]);
      dataRow.font = { size: 10 };
      dataRow.alignment = { horizontal: 'right', vertical: 'center' };
    });

    // Format columns
    worksheet.columns = [
      { width: 18 },
      { width: 25 },
      { width: 15 },
      { width: 15 },
      { width: 10 },
      { width: 15 },
      { width: 15 },
      { width: 12 },
      { width: 12 },
      { width: 15 },
      { width: 18 },
      { width: 15 },
      { width: 18 },
    ];

    // Save
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `SalesOrders_${dayjs().format('YYYY-MM-DD_HHmmss')}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
    message.success(`Exported ${filtered.length} orders`);
  };

  // Export lines to Excel
  const exportLinesToExcel = async () => {
    if (filteredLines.length === 0) { message.warning('No lines to export'); return; }
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Lines');

    // Title
    const titleCell = worksheet.addRow(['Sales Order Lines']);
    titleCell.font = { bold: true, size: 14, color: { argb: 'FFC74634' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'center' };
    worksheet.mergeCells('A1:J1');
    worksheet.getRow(1).height = 24;

    // Summary info
    worksheet.addRow(['']);
    const summaryRow = worksheet.addRow([
      `Date: ${dayjs().format('YYYY-MM-DD HH:mm')}`,
      `Total Lines: ${filteredLines.length}`,
      `Total Quantity: ${filteredLines.reduce((sum, r) => sum + (r.OrderedQuantity ?? 0), 0)}`,
      `Total Amount: ${filteredLines.reduce((sum, r) => sum + (r.ExtendedAmount ?? 0), 0)}`,
    ]);
    summaryRow.font = { size: 10 };
    worksheet.addRow(['']);

    // Headers
    const headers = ['Order', 'Line #', 'Product', 'Description', 'Qty', 'UOM', 'Unit Price', 'Extended Amount', 'Status', 'Customer'];
    const headerRow = worksheet.addRow(headers);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC74634' } };
    headerRow.alignment = { horizontal: 'center', vertical: 'center' };

    // Data rows
    filteredLines.forEach((row: any) => {
      const dataRow = worksheet.addRow([
        row.OrderNumber ?? '—',
        row.LineNumber ?? row.DisplayLineNumber ?? '—',
        row.ProductNumber ?? '—',
        row.ProductDescription ?? '—',
        row.OrderedQuantity ?? 0,
        row.OrderedUOM ?? '—',
        row.UnitSellingPrice ?? 0,
        row.ExtendedAmount ?? 0,
        row.StatusCode ?? row.Status ?? '—',
        row.BuyingPartyName ?? '—',
      ]);
      dataRow.font = { size: 10 };
      dataRow.alignment = { horizontal: 'right', vertical: 'center' };
    });

    // Format columns
    worksheet.columns = [
      { width: 18 },
      { width: 10 },
      { width: 18 },
      { width: 30 },
      { width: 10 },
      { width: 8 },
      { width: 12 },
      { width: 15 },
      { width: 15 },
      { width: 25 },
    ];

    // Save
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `SalesOrderLines_${dayjs().format('YYYY-MM-DD_HHmmss')}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
    message.success(`Exported ${filteredLines.length} lines`);
  };

  // Export analytics to Excel
  const exportAnalyticsToExcel = async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Analytics');

    // Title
    const titleCell = worksheet.addRow([`Sales Orders Analytics - ${analyticsView.toUpperCase()}`]);
    titleCell.font = { bold: true, size: 14, color: { argb: 'FF1D7B4D' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'center' };
    worksheet.mergeCells('A1:F1');
    worksheet.getRow(1).height = 24;

    // Summary info
    worksheet.addRow(['']);
    const summaryRow = worksheet.addRow([
      `Date: ${dayjs().format('YYYY-MM-DD HH:mm')}`,
      `View: ${analyticsView}`,
      `Total Orders: ${getAnalyticsData.length}`,
      `Total Quantity: ${getAnalyticsData.reduce((s, r) => s + r.quantity, 0)}`,
      `Total Amount: $${fmt(getAnalyticsData.reduce((s, r) => s + r.amount, 0))}`,
    ]);
    summaryRow.font = { size: 10 };
    worksheet.addRow(['']);

    // Headers
    const headers = analyticsView === 'date' || analyticsView === 'month' ? ['Date', 'Quantity', 'Amount', 'Order Count'] :
                    analyticsView === 'item' ? ['Product #', 'Description', 'Quantity', 'Amount', 'Avg Price', 'Count'] :
                    analyticsView === 'customer' ? ['Customer', 'Quantity', 'Amount', 'Order Count', 'Avg Price'] :
                    ['Type', 'Quantity', 'Amount', 'Order Count', 'Avg Price'];

    const headerRow = worksheet.addRow(headers);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D7B4D' } };
    headerRow.alignment = { horizontal: 'center', vertical: 'center' };

    // Data rows
    getAnalyticsData.forEach((row: any) => {
      const cells = analyticsView === 'date' || analyticsView === 'month' ?
        [row.key, row.quantity, row.amount, row.count] :
        analyticsView === 'item' ?
        [row.key, row.description, row.quantity, row.amount, row.avgPrice, row.count] :
        [row.key, row.quantity, row.amount, row.count, row.avgPrice];

      const dataRow = worksheet.addRow(cells);
      dataRow.font = { size: 10 };
      dataRow.alignment = { horizontal: 'right', vertical: 'center' };
    });

    // Format columns
    worksheet.columns = [
      { width: 20 },
      { width: 30 },
      { width: 15 },
      { width: 15 },
      { width: 15 },
      { width: 15 },
    ];

    // Save
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Analytics_${analyticsView}_${dayjs().format('YYYY-MM-DD_HHmmss')}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
    message.success('Analytics exported to Excel');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Card styles={{ body: { padding: '14px 18px' } }} style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}` }}>
        <Form form={form} layout="vertical" size="small">
          <Row gutter={[8, 0]}>
            <Col xs={24} sm={12} md={6}>
              <Form.Item label={<Text style={{ fontSize: 11, fontWeight: 600 }}>Order Date (from → to)</Text>} style={{ marginBottom: 6 }}>
                <Space.Compact style={{ width: '100%' }}>
                  <DatePicker style={{ width: '100%' }} placeholder="From" value={filters.dateFrom} onChange={d => setFilters(f => ({ ...f, dateFrom: d }))} />
                  <DatePicker style={{ width: '100%' }} placeholder="To" value={filters.dateTo} onChange={d => setFilters(f => ({ ...f, dateTo: d }))} />
                </Space.Compact>
              </Form.Item>
            </Col>
            <Col xs={12} sm={8} md={5}>
              <Form.Item label={<Text style={{ fontSize: 11, fontWeight: 600 }}>Business Unit <span style={{ color: 'red' }}>*</span></Text>} style={{ marginBottom: 6 }} required>
                <Select
                  allowClear
                  showSearch
                  placeholder="Select business unit"
                  value={filters.businessUnitId || undefined}
                  onChange={v => {
                    const selected = busUnits.find(bu => bu.businessUnitId === v);
                    setFilters(f => ({ ...f, businessUnitId: v, businessUnit: selected?.businessUnitName }));
                  }}
                  optionFilterProp="label"
                  loading={busUnitsLoading}
                  options={busUnits.map(bu => ({
                    value: bu.businessUnitId,
                    label: bu.businessUnitName,
                  }))}
                />
              </Form.Item>
            </Col>
            <Col xs={12} sm={8} md={5}>
              <Form.Item label={<Text style={{ fontSize: 11, fontWeight: 600 }}>Order Type</Text>} style={{ marginBottom: 6 }}>
                <Select
                  allowClear
                  showSearch
                  placeholder="Any order type"
                  value={filters.orderType || undefined}
                  onChange={v => setFilters(f => ({ ...f, orderType: v }))}
                  optionFilterProp="label"
                  options={orderTypeOpts}
                />
              </Form.Item>
            </Col>
            <Col xs={12} sm={8} md={5}>
              <Form.Item label={<Text style={{ fontSize: 11, fontWeight: 600 }}>Customer</Text>} style={{ marginBottom: 6 }}>
                <Input placeholder="Buying party name" allowClear value={filters.customer}
                  onChange={e => setFilters(f => ({ ...f, customer: e.target.value }))} onPressEnter={runSearch} />
              </Form.Item>
            </Col>
            <Col xs={12} sm={8} md={4}>
              <Form.Item label={<Text style={{ fontSize: 11, fontWeight: 600 }}>Customer #</Text>} style={{ marginBottom: 6 }}>
                <Input placeholder="e.g. DCLG0030" allowClear value={filters.customerNumber}
                  onChange={e => setFilters(f => ({ ...f, customerNumber: e.target.value }))} onPressEnter={runSearch} />
              </Form.Item>
            </Col>
            <Col xs={12} sm={8} md={4}>
              <Form.Item label={<Text style={{ fontSize: 11, fontWeight: 600 }}>Status</Text>} style={{ marginBottom: 6 }}>
                <Select allowClear showSearch placeholder="Any" value={filters.statusCode}
                  onChange={v => setFilters(f => ({ ...f, statusCode: v }))}
                  options={STATUS_CODES} optionFilterProp="label" />
              </Form.Item>
            </Col>
            <Col xs={12} sm={8} md={5}>
              <Form.Item label={<Text style={{ fontSize: 11, fontWeight: 600 }}>Order Key</Text>} style={{ marginBottom: 6 }}>
                <Input placeholder="e.g. OPS:300000010754319" allowClear value={filters.orderKey}
                  onChange={e => setFilters(f => ({ ...f, orderKey: e.target.value }))} onPressEnter={runSearch} />
              </Form.Item>
            </Col>
          </Row>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Button type="primary" size="small" icon={<SearchOutlined />} loading={loading} onClick={runSearch}
              style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}>Search</Button>
            <Button size="small" icon={<ClearOutlined />} onClick={() => setFilters({ dateFrom: dayjs().subtract(1, 'month'), dateTo: dayjs().add(1, 'day') })}>Reset</Button>
            <Tooltip title="API Inspector — salesOrdersForOrderHub">
              <Button size="small" icon={<ApiOutlined />} style={{ marginLeft: 'auto', borderColor: REDWOOD.info, color: REDWOOD.info }}
                onClick={() => setApiOpen(true)}>API</Button>
            </Tooltip>
          </div>
        </Form>
      </Card>

      <Card styles={{ body: { padding: 0 } }} style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}` }}>
        <Tabs activeKey={searchTab} onChange={(key) => setSearchTab(key as 'orders' | 'lines')} style={{ paddingTop: 12 }}>
          <Tabs.TabPane tab={<Space><ShoppingOutlined style={{ color: REDWOOD.primary }} /><Text strong>Orders</Text>
            {rows.length > 0 && <Tag>{filtered.length}{filtered.length !== rows.length ? ` of ${rows.length}` : ''}</Tag>}</Space>} key="orders">
            <div style={{ padding: '0 18px 18px' }}>
              <Space style={{ marginBottom: 12 }}>
                <Tooltip title="Include reference/skeleton orders with StatusCode DOO_REFERENCE">
                  <Checkbox checked={showDooRef} onChange={e => setShowDooRef(e.target.checked)} style={{ fontSize: 12 }}>DOO_REFERENCE</Checkbox>
                </Tooltip>
                <Input placeholder="Filter any column…" allowClear size="small" prefix={<SearchOutlined style={{ color: REDWOOD.neutral300 }} />}
                  value={filterText} onChange={e => setFilterText(e.target.value)} style={{ width: 220 }} />
                <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={runSearch}>Refresh</Button>
                <Button size="small" icon={<DownloadOutlined />} onClick={exportOrdersToExcel} disabled={filtered.length === 0}
                  style={{ marginLeft: 'auto', borderColor: REDWOOD.success, color: REDWOOD.success, fontWeight: 600 }}>
                  Export Orders
                </Button>
              </Space>
              {loading ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Spin size="large" tip="Loading…" /></div>
              ) : error && rows.length === 0 ? (
                <div style={{ padding: 24, color: REDWOOD.error, background: REDWOOD.error + '10', borderRadius: 6 }}>
                  <InfoCircleOutlined style={{ marginRight: 8 }} />{error}
                </div>
              ) : !searched ? (
                <Empty description="Run a search" style={{ padding: 60 }} />
              ) : filtered.length === 0 ? (
                <Empty description="No sales orders" style={{ padding: 60 }} />
              ) : (
                <>
                  <Table columns={columns} dataSource={filtered} rowKey={(r, i) => `${r.HeaderId ?? r.OrderKey ?? i}`} size="small"
                    scroll={{ x: 2249 }} pagination={{ pageSize: 25, size: 'small', showSizeChanger: true, showTotal: t => `${t} orders` }} />
                  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, padding: '12px 0 4px' }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>{rows.length} loaded</Text>
                    {hasMore ? (
                      <Button size="small" icon={<ReloadOutlined />} loading={loadingMore} onClick={loadMore}
                        style={{ color: REDWOOD.info, borderColor: REDWOOD.info }}>Load next {SEARCH_LIMIT}</Button>
                    ) : (
                      <Text type="secondary" style={{ fontSize: 12 }}>— no more —</Text>
                    )}
                  </div>
                </>
              )}
            </div>
          </Tabs.TabPane>
          <Tabs.TabPane tab={<Space><FileTextOutlined style={{ color: REDWOOD.primary }} /><Text strong>Lines</Text>
            {filteredLines.length > 0 && <Tag>{filteredLines.length}{filteredLines.length !== allLines.length ? ` of ${allLines.length}` : ''}</Tag>}</Space>} key="lines">
            <div style={{ padding: '0 18px 18px' }}>
              <Space style={{ marginBottom: 12 }}>
                <Input placeholder="Filter any column…" allowClear size="small" prefix={<SearchOutlined style={{ color: REDWOOD.neutral300 }} />}
                  value={linesFilterText} onChange={e => setLinesFilterText(e.target.value)} style={{ width: 300 }} />
                <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={runSearch}>Refresh</Button>
                <Button size="small" icon={<DownloadOutlined />} onClick={exportLinesToExcel} disabled={filteredLines.length === 0}
                  style={{ marginLeft: 'auto', borderColor: REDWOOD.success, color: REDWOOD.success, fontWeight: 600 }}>
                  Export Lines
                </Button>
              </Space>
              {loading ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Spin size="large" tip="Loading…" /></div>
              ) : !searched ? (
                <Empty description="Run a search" style={{ padding: 60 }} />
              ) : allLines.length === 0 ? (
                <Empty description="No lines found" style={{ padding: 60 }} />
              ) : filteredLines.length === 0 ? (
                <Empty description="No lines match filter" style={{ padding: 60 }} />
              ) : (
                <Table columns={lineColumns} dataSource={filteredLines} rowKey={(r, i) => r.key ?? `${i}`} size="small"
                  scroll={{ x: 2400 }} pagination={{ pageSize: 50, size: 'small', showSizeChanger: true, showTotal: t => `${t} lines` }}
                  summary={() => (
                    <Table.Summary fixed>
                      <Table.Summary.Row style={{ background: REDWOOD.neutral100, fontWeight: 'bold' }}>
                        <Table.Summary.Cell index={0} colSpan={7}>Total</Table.Summary.Cell>
                        <Table.Summary.Cell index={7} align="right" style={{ fontWeight: 'bold' }}>
                          {Number(filteredLines.reduce((sum, r) => sum + (r.OrderedQuantity ?? 0), 0)).toFixed(2)}
                        </Table.Summary.Cell>
                        <Table.Summary.Cell index={8} align="right" style={{ fontWeight: 'bold' }}>
                          {Number(filteredLines.reduce((sum, r) => sum + (r.UnitSellingPrice ?? 0), 0)).toFixed(2)}
                        </Table.Summary.Cell>
                        <Table.Summary.Cell index={9} align="right" style={{ fontWeight: 'bold' }}>
                          {Number(filteredLines.reduce((sum, r) => sum + (r.ExtendedAmount ?? 0), 0)).toFixed(2)}
                        </Table.Summary.Cell>
                        <Table.Summary.Cell index={10} colSpan={4} />
                      </Table.Summary.Row>
                    </Table.Summary>
                  )}
                />
              )}
            </div>
          </Tabs.TabPane>
          <Tabs.TabPane tab={<Space><RiseOutlined style={{ color: REDWOOD.primary }} /><Text strong>Analytics</Text>
            {getAnalyticsData.length > 0 && <Tag>{getAnalyticsData.length}</Tag>}</Space>} key="analytics">
            <div style={{ padding: '0 18px 18px' }}>
              {!searched ? (
                <Empty description="Run a search to see analytics" style={{ padding: 60 }} />
              ) : allLines.length === 0 ? (
                <Empty description="No data for analytics" style={{ padding: 60 }} />
              ) : (
                <>
                  {/* View Selection and Filters */}
                  <Card style={{ marginBottom: 16, borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}` }}>
                    <Space wrap style={{ marginBottom: 16 }}>
                      <Text strong>View:</Text>
                      <Segmented value={analyticsView} onChange={(v) => setAnalyticsView(v as any)}
                        options={[
                          { label: '📅 By Date', value: 'date' },
                          { label: '📆 By Month', value: 'month' },
                          { label: '📦 By Item', value: 'item' },
                          { label: '👤 By Customer', value: 'customer' },
                          { label: '🏷️ By Type', value: 'type' },
                        ]} />
                      <Button type="primary" icon={<FileExcelOutlined />} onClick={exportAnalyticsToExcel} style={{ marginLeft: 'auto', background: REDWOOD.success, borderColor: REDWOOD.success }}>
                        Export to Excel
                      </Button>
                    </Space>

                    {/* Filters */}
                    <Row gutter={[12, 12]}>
                      <Col xs={24} sm={12} md={6}>
                        <Text style={{ fontSize: 11, fontWeight: 600 }}>Customer:</Text>
                        <Select allowClear showSearch placeholder="All customers" size="small"
                          value={analyticsFilters.customer || undefined}
                          onChange={v => setAnalyticsFilters(f => ({ ...f, customer: v }))}
                          options={analyticsFilterOptions.customers.map(c => ({ label: c, value: c }))}
                          style={{ marginTop: 4 }} />
                      </Col>
                      <Col xs={24} sm={12} md={6}>
                        <Text style={{ fontSize: 11, fontWeight: 600 }}>Product #:</Text>
                        <Select allowClear showSearch placeholder="All products" size="small"
                          value={analyticsFilters.product || undefined}
                          onChange={v => setAnalyticsFilters(f => ({ ...f, product: v }))}
                          options={analyticsFilterOptions.products.map(p => ({ label: p, value: p }))}
                          style={{ marginTop: 4 }} />
                      </Col>
                      <Col xs={24} sm={12} md={6}>
                        <Text style={{ fontSize: 11, fontWeight: 600 }}>Type:</Text>
                        <Select allowClear showSearch placeholder="All types" size="small"
                          value={analyticsFilters.type || undefined}
                          onChange={v => setAnalyticsFilters(f => ({ ...f, type: v }))}
                          options={analyticsFilterOptions.types.map(t => ({ label: t, value: t }))}
                          style={{ marginTop: 4 }} />
                      </Col>
                      <Col xs={24} sm={12} md={6}>
                        <Text style={{ fontSize: 11, fontWeight: 600 }}>Load Records:</Text>
                        <InputNumber min={1} max={200} value={analyticsLoadLimit} onChange={(v) => setAnalyticsLoadLimit(v || 50)} size="small" style={{ width: '100%', marginTop: 4 }} placeholder="Max 200" />
                      </Col>
                    </Row>
                  </Card>

                  {/* Chart */}
                  <Card style={{ marginBottom: 16, borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}` }}>
                    <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
                      <Checkbox checked={showAnalyticsChart} onChange={e => setShowAnalyticsChart(e.target.checked)}>
                        Show Chart
                      </Checkbox>
                      {showAnalyticsChart && (
                        <Segmented value={chartType} onChange={(v) => setChartType(v as 'bar' | 'line' | 'pie')}
                          options={[
                            { label: 'Bar Chart', value: 'bar' },
                            { label: 'Line Chart', value: 'line' },
                            { label: 'Pie Chart', value: 'pie' },
                          ]} />
                      )}
                    </Space>
                    {showAnalyticsChart && (
                      <ResponsiveContainer width="100%" height={450} margin={{ top: 20, right: 30, left: 0, bottom: 100 }}>
                        {chartType === 'bar' && (
                          <BarChart data={getAnalyticsData} margin={{ top: 20, right: 30, left: 0, bottom: 100 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke={REDWOOD.neutral300} />
                            <XAxis dataKey="key" angle={-45} textAnchor="end" height={100} tick={{ fontSize: 12 }} />
                            <YAxis tick={{ fontSize: 12 }} />
                            <RechartsTooltip
                              formatter={(value) => typeof value === 'number' ? fmt(value) : value}
                              labelFormatter={(label) => `${label}`}
                              contentStyle={{ backgroundColor: '#fff', border: `1px solid ${REDWOOD.neutral300}`, borderRadius: 4, padding: '8px' }}
                            />
                            <Legend wrapperStyle={{ paddingTop: '20px', fontSize: 12 }} />
                            <Bar dataKey="amount" fill={REDWOOD.success} name="Amount ($)" />
                            <Bar dataKey="quantity" fill={REDWOOD.info} name="Quantity" />
                          </BarChart>
                        )}
                        {chartType === 'line' && (
                          <LineChart data={getAnalyticsData} margin={{ top: 20, right: 30, left: 0, bottom: 100 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke={REDWOOD.neutral300} />
                            <XAxis dataKey="key" angle={-45} textAnchor="end" height={100} tick={{ fontSize: 12 }} />
                            <YAxis tick={{ fontSize: 12 }} />
                            <RechartsTooltip
                              formatter={(value) => typeof value === 'number' ? fmt(value) : value}
                              labelFormatter={(label) => `${label}`}
                              contentStyle={{ backgroundColor: '#fff', border: `1px solid ${REDWOOD.neutral300}`, borderRadius: 4, padding: '8px' }}
                            />
                            <Legend wrapperStyle={{ paddingTop: '20px', fontSize: 12 }} />
                            <Line type="monotone" dataKey="amount" stroke={REDWOOD.success} name="Amount ($)" strokeWidth={2} />
                            <Line type="monotone" dataKey="quantity" stroke={REDWOOD.info} name="Quantity" strokeWidth={2} />
                          </LineChart>
                        )}
                        {chartType === 'pie' && (
                          <PieChart>
                            <Pie dataKey="amount" data={getAnalyticsData} cx="50%" cy="50%" labelLine={false} label={(entry) => `${entry.key}`} outerRadius={120}>
                              {getAnalyticsData.map((_, index) => (
                                <Cell key={`cell-${index}`} fill={[REDWOOD.primary, REDWOOD.success, REDWOOD.warning, REDWOOD.info, REDWOOD.error, REDWOOD.teal][index % 6]} />
                              ))}
                            </Pie>
                            <RechartsTooltip
                              formatter={(value) => typeof value === 'number' ? fmt(value) : value}
                              labelFormatter={(label) => `${label}`}
                              contentStyle={{ backgroundColor: '#fff', border: `1px solid ${REDWOOD.neutral300}`, borderRadius: 4, padding: '8px' }}
                            />
                          </PieChart>
                        )}
                      </ResponsiveContainer>
                    )}
                  </Card>

                  {/* Summary */}
                  <Card style={{ marginBottom: 16, borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}` }}>
                    <Row gutter={16}>
                      <Col xs={24} sm={12} md={6}>
                        <div style={{ textAlign: 'center', padding: 12, background: REDWOOD.neutral100, borderRadius: 6 }}>
                          <Text style={{ fontSize: 12, color: REDWOOD.textLight }}>Total Orders</Text>
                          <div style={{ fontSize: 24, fontWeight: 'bold', color: REDWOOD.primary, marginTop: 8 }}>
                            {getAnalyticsData.length}
                          </div>
                        </div>
                      </Col>
                      <Col xs={24} sm={12} md={6}>
                        <div style={{ textAlign: 'center', padding: 12, background: REDWOOD.neutral100, borderRadius: 6 }}>
                          <Text style={{ fontSize: 12, color: REDWOOD.textLight }}>Total Quantity</Text>
                          <div style={{ fontSize: 24, fontWeight: 'bold', color: REDWOOD.success, marginTop: 8 }}>
                            {fmt(getAnalyticsData.reduce((s, r) => s + r.quantity, 0))}
                          </div>
                        </div>
                      </Col>
                      <Col xs={24} sm={12} md={6}>
                        <div style={{ textAlign: 'center', padding: 12, background: REDWOOD.neutral100, borderRadius: 6 }}>
                          <Text style={{ fontSize: 12, color: REDWOOD.textLight }}>Total Amount</Text>
                          <div style={{ fontSize: 24, fontWeight: 'bold', color: REDWOOD.error, marginTop: 8 }}>
                            ${fmt(getAnalyticsData.reduce((s, r) => s + r.amount, 0))}
                          </div>
                        </div>
                      </Col>
                      <Col xs={24} sm={12} md={6}>
                        <div style={{ textAlign: 'center', padding: 12, background: REDWOOD.neutral100, borderRadius: 6 }}>
                          <Text style={{ fontSize: 12, color: REDWOOD.textLight }}>Avg Amount</Text>
                          <div style={{ fontSize: 24, fontWeight: 'bold', color: REDWOOD.orange, marginTop: 8 }}>
                            ${fmt(getAnalyticsData.length > 0 ? getAnalyticsData.reduce((s, r) => s + r.amount, 0) / getAnalyticsData.length : 0)}
                          </div>
                        </div>
                      </Col>
                    </Row>
                  </Card>

                  {/* Data Table */}
                  <Card style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}` }}>
                    <Table
                      columns={[
                        {
                          title: analyticsView === 'date' ? 'Date' : analyticsView === 'month' ? 'Month' : analyticsView === 'item' ? 'Product #' : analyticsView === 'customer' ? 'Customer' : 'Type',
                          dataIndex: 'key',
                          width: 200,
                          render: (v) => <Text strong>{v}</Text>,
                          sorter: (a, b) => String(a.key).localeCompare(String(b.key)),
                        },
                        analyticsView === 'item' && { title: 'Description', dataIndex: 'description', width: 250, ellipsis: true, sorter: (a, b) => String(a.description).localeCompare(String(b.description)) },
                        { title: 'Quantity', dataIndex: 'quantity', width: 120, align: 'right' as const, render: (v) => fmt(v), sorter: (a, b) => a.quantity - b.quantity },
                        { title: 'Amount ($)', dataIndex: 'amount', width: 130, align: 'right' as const, render: (v) => fmt(v), sorter: (a, b) => a.amount - b.amount },
                        { title: 'Avg Price', dataIndex: 'avgPrice', width: 120, align: 'right' as const, render: (v) => fmt(v), sorter: (a, b) => a.avgPrice - b.avgPrice },
                        { title: 'Count', dataIndex: 'count', width: 100, align: 'right' as const, render: (v) => v, sorter: (a, b) => a.count - b.count },
                      ].filter(Boolean) as ColumnsType<any>}
                      dataSource={getAnalyticsData.slice(0, analyticsLoadLimit)}
                      rowKey="key"
                      pagination={{ pageSize: analyticsLoadLimit, size: 'small', showTotal: (t) => `${t} of ${getAnalyticsData.length} records` }}
                      size="small"
                    />
                  </Card>
                </>
              )}
            </div>
          </Tabs.TabPane>
        </Tabs>
      </Card>

      <Modal title={<Space><ApiOutlined style={{ color: REDWOOD.info }} /> Sales Orders API</Space>}
        open={apiOpen} onCancel={() => setApiOpen(false)} maskClosable={false} width={880}
        footer={<Button onClick={() => setApiOpen(false)}>Close</Button>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[
            { lbl: 'Search sales orders', url: decodeURIComponent(searchUrl), runUrl: searchUrl },
            { lbl: 'Order lines (per order)', url: `${FUSION_BASE}/salesOrdersForOrderHub/{OrderKey}/child/lines`, runUrl: '' },
          ].map(({ lbl, url, runUrl }) => (
            <div key={lbl}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Text style={{ fontSize: 11, fontWeight: 700, color: REDWOOD.neutral600, textTransform: 'uppercase' }}>{lbl}</Text>
                {runUrl && (
                  <Button size="small" type="primary" icon={<ThunderboltOutlined />} style={{ marginLeft: 'auto', background: REDWOOD.success, borderColor: REDWOOD.success }}
                    loading={apiRun?.running} onClick={() => runApi(runUrl)}>Run</Button>
                )}
                <Button size="small" type="text" icon={<CopyOutlined />} style={{ marginLeft: runUrl ? 0 : 'auto' }}
                  onClick={() => { navigator.clipboard.writeText(url); message.success('Copied'); }}>Copy</Button>
              </div>
              <div style={{ marginTop: 4, padding: '8px 12px', borderRadius: 6, background: REDWOOD.neutral100, border: `1px solid ${REDWOOD.neutral200}`, fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all', color: REDWOOD.info }}>
                <Tag color="blue">GET</Tag>{url}
              </div>
            </div>
          ))}
          {apiRun && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <Text style={{ fontSize: 11, fontWeight: 700, color: REDWOOD.neutral600, textTransform: 'uppercase' }}>Response</Text>
                {apiRun.status && <Tag color={apiRun.ok ? 'green' : 'red'}>{apiRun.status}</Tag>}
              </div>
              <div style={{ padding: '8px 12px', borderRadius: 6, background: '#1e1e1e', color: '#d4d4d4', fontFamily: 'monospace', fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 260, overflow: 'auto' }}>
                {apiRun.running ? 'Running…' : (apiRun.body || '(empty response)')}
              </div>
            </div>
          )}
          <Text type="secondary" style={{ fontSize: 11 }}>
            Instance: <b>{getFusionInstanceUrl() || getFusionInstance().host}</b> · Auth: Basic [{auth.user?.username}:{localStorage.getItem('fusion_password') ? '***' : '(no password)'}]
            Dates unquoted; text uses SQL LIKE; codes exact ('value').
          </Text>
        </div>
      </Modal>

      <AllFieldsModal title={`Order ${detail?.OrderNumber ?? ''} — all fields`} row={detail} onClose={() => setDetail(null)} />
      <TotalsModal order={totalsOrder} onClose={() => setTotalsOrder(null)} />
    </div>
  );
};

// ── Page (Search tab + one tab per opened order) ─────────────────────────────
// ── Create New Order ─────────────────────────────────────────────────────────
const SO_CREATE_URL = `${FUSION_BASE}/salesOrdersForOrderHub`;
const CURRENCIES = ['AED', 'USD', 'RWF', 'EUR', 'GBP', 'INR', 'SAR', 'KES', 'TZS', 'UGX', 'ZAR', 'XOF'];
const PAYMENT_TERMS = ['Immediate', '30 Net', '45 Net', '60 Net', 'CR7D', 'CR30D', 'CR45D'];

// Custom ORDS lookups (customers, payment terms, salespersons).
// Electron goes direct; the browser build routes via the /ords-mitsu proxy to avoid CORS.
const ORDS_AR = _isElectron
  ? buildApexUrl('test/FUSIONCLIENTERP/ar')
  : '/ords-mitsu/ar';
const PAYMENT_TERMS_URL = `${ORDS_AR}/paymentterms`;
const SALESREPS_URL = `${ORDS_AR}/salesperson`;

// Pick a display label from an ORDS row (candidate keys, else first non-id string).
const ordsLabel = (row: any, keys: string[]): string | undefined => {
  const v = pf(row, keys);
  if (v != null && v !== '') return String(v);
  const e = Object.entries(row ?? {}).find(([k, val]) => typeof val === 'string' && String(val).trim() && !/id$/i.test(k) && k !== 'links');
  return e ? String(e[1]) : undefined;
};
// Fetch an ORDS list → distinct {value,label} options (empty on failure).
const useOrdsOptions = (url: string, keys: string[], fallback: string[] = []): { value: string; label: string }[] => {
  const [opts, setOpts] = useState<{ value: string; label: string }[]>([]);
  useEffect(() => {
    let live = true;
    fetch(url, { headers: { Accept: 'application/json' } })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => {
        if (!live) return;
        const rows = d.items ?? (Array.isArray(d) ? d : []);
        const seen = new Set<string>(); const list: { value: string; label: string }[] = [];
        rows.forEach((row: any) => { const lbl = ordsLabel(row, keys); if (lbl && !seen.has(lbl)) { seen.add(lbl); list.push({ value: lbl, label: lbl }); } });
        setOpts(list.length ? list : fallback.map(f => ({ value: f, label: f })));
      })
      .catch(() => { if (live) setOpts(fallback.map(f => ({ value: f, label: f }))); });
    return () => { live = false; };
  }, [url]); // eslint-disable-line react-hooks/exhaustive-deps
  return opts;
};
const PAY_TERM_KEYS = ['name', 'Name', 'payment_terms', 'paymentterms', 'term_name', 'termname', 'payment_term', 'value', 'description'];
const SALESREP_KEYS = ['salesrep_name', 'salerep_code', 'name', 'Name', 'salesperson', 'salesperson_name', 'salespersonname', 'resource_name', 'full_name', 'value'];
const SALESREP_ID_KEYS = ['resource_id', 'resourceid', 'salesrep_id', 'salesrepid', 'salesperson_id', 'salespersonid', 'resource_salesrep_id', 'party_id', 'partyid', 'person_id', 'personid'];

// Salesperson options that also carry the resource id (SalespersonId) so the
// sales-credit payload can send a deterministic id, not just a name.
export interface SalesRepOpt { value: string; label: string; id?: number }
const useSalesReps = (): SalesRepOpt[] => {
  const [opts, setOpts] = useState<SalesRepOpt[]>([]);
  useEffect(() => {
    let live = true;
    fetch(SALESREPS_URL, { headers: { Accept: 'application/json' } })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => {
        if (!live) return;
        const rows = d.items ?? (Array.isArray(d) ? d : []);
        const seen = new Set<string>(); const list: SalesRepOpt[] = [];
        rows.forEach((row: any) => {
          const lbl = ordsLabel(row, SALESREP_KEYS);
          if (!lbl || seen.has(lbl)) return;
          seen.add(lbl);
          const idRaw = pf(row, SALESREP_ID_KEYS);
          const id = idRaw != null && idRaw !== '' && !Number.isNaN(Number(idRaw)) ? Number(idRaw) : undefined;
          list.push({ value: lbl, label: lbl, id });
        });
        setOpts(list);
      })
      .catch(() => { if (live) setOpts([]); });
    return () => { live = false; };
  }, []);
  return opts;
};

// Tax codes for a business unit (ORDS: FUSION_TAX_CODES where BUSINESS_UNIT = :P_BUSINESS_UNIT).
export interface TaxCode { code: string; pct: number }
const TAXCODES_URL = `${ORDS_AR}/taxcodes`;
const useTaxCodes = (bu?: string): TaxCode[] => {
  const [rows, setRows] = useState<TaxCode[]>([]);
  useEffect(() => {
    if (!bu) { setRows([]); return; }
    let live = true;
    const qs = new URLSearchParams({ P_BUSINESS_UNIT: bu, business_unit: bu }).toString();
    fetch(`${TAXCODES_URL}?${qs}`, { headers: { Accept: 'application/json' } })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => {
        if (!live) return;
        const items = d.items ?? (Array.isArray(d) ? d : []);
        const seen = new Set<string>(); const list: TaxCode[] = [];
        items.forEach((x: any) => {
          const code = String(pf(x, ['tax_code', 'TAX_CODE', 'code', 'name']) ?? '').trim();
          if (code && !seen.has(code)) { seen.add(code); list.push({ code, pct: num(pf(x, ['tax_code_per', 'TAX_CODE_PER', 'rate', 'pct', 'percentage'])) }); }
        });
        setRows(list);
      })
      .catch(() => { if (live) setRows([]); });
    return () => { live = false; };
  }, [bu]);
  return rows;
};
const round2 = (v: number) => Math.round((num(v) + Number.EPSILON) * 100) / 100;

const CUSTOMERS_URL = `${ORDS_AR}/customers`;
// Fetch all customer rows (paged) from the ORDS customers endpoint.
const useCustomers = (): any[] => {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const all: any[] = []; let offset = 0;
        for (let i = 0; i < 20; i++) {
          const r = await fetch(`${CUSTOMERS_URL}?limit=500&offset=${offset}`, { headers: { Accept: 'application/json' } });
          if (!r.ok) break;
          const d = await r.json(); const items = d.items ?? (Array.isArray(d) ? d : []);
          all.push(...items);
          if (!d.hasMore || items.length === 0) break;
          offset += 500;
        }
        if (live) setRows(all);
      } catch { /* ignore */ }
    })();
    return () => { live = false; };
  }, []);
  return rows;
};
const custAcct = (c: any) => pf(c, ['account_number', 'ACCOUNT_NUMBER', 'AccountNumber']);
const custName = (c: any) => pf(c, ['account_name', 'ACCOUNT_NAME', 'AccountName']);
const custOptionList = (customers: any[]) => {
  const seen = new Set<string>();
  return customers.map(c => ({ value: String(custName(c) ?? ''), label: `${custName(c) ?? ''}${custAcct(c) ? ` (${custAcct(c)})` : ''}`, _c: c }))
    .filter(o => o.value && !seen.has(o.value) && seen.add(o.value));
};
// Field values to set when a customer is picked (fills sites + addresses).
const customerFill = (row: any) => {
  const join = (...ks: string[][]) => ks.map(k => pf(row, k)).filter(Boolean).join(', ');
  const idStr = (k: string[]) => { const v = pf(row, k); return v == null || v === '' ? undefined : String(v); };
  return {
    customerName: custName(row), accountNumber: custAcct(row),
    billToSite: idStr(['bill_to_site_use_id', 'BILL_TO_SITE_USE_ID']),
    shipToSite: idStr(['ship_to_party_site_id', 'SHIP_TO_PARTY_SITE_ID']),
    billToAddress: join(['bill_to_address1', 'BILL_TO_ADDRESS1'], ['bill_to_address2', 'BILL_TO_ADDRESS2'], ['bill_to_city', 'BILL_TO_CITY']),
    shipToAddress: join(['ship_to_address1', 'SHIP_TO_ADDRESS1'], ['ship_to_address2', 'SHIP_TO_ADDRESS2'], ['ship_to_city', 'SHIP_TO_CITY'], ['ship_to_country', 'SHIP_TO_COUNTRY']),
    custAccountId: idStr(['cust_account_id', 'CUST_ACCOUNT_ID']),
    partyId: idStr(['party_id', 'PARTY_ID']),
  };
};

interface OrderHeader {
  businessUnit?: string; businessUnitId?: number | string; buCode?: string; baseCurrency?: string; txnCurrency?: string; rate?: number;
  orderType?: string; orderDate?: Dayjs | null; customerName?: string; accountNumber?: string;
  billToSite?: string; shipToSite?: string; billToAddress?: string; shipToAddress?: string;
  paymentTerms?: string; salesRep?: string; warehouse?: string; subinventory?: string; remarks?: string;
  custAccountId?: string; partyId?: string; creditLimit?: number;
  // Currency conversion details
  currencyRateType?: string; currencyDate?: Dayjs | null;
  // Branch Sales order details
  branchBU?: string;
  // Header EFF (Additional Information) segment values, keyed by segment API name.
  effVals?: Record<string, string>;
}
interface NewLine { key: string; itemNumber: string; description?: string; uom?: string; qty: number; unitPrice: number; costUnit?: number; taxCode?: string; taxPct?: number; taxAmount?: number; lot?: string; lots?: string[]; qoh?: number; ohLoading?: boolean; status?: string; statusCode?: string;
  // Edit mode: original DOO source line keys (preserved so a change order maps
  // onto the existing fulfillment line) + a cancel marker (there is no DELETE).
  srcLineId?: string; srcLineNumber?: string | number; srcScheduleNumber?: string | number; existing?: boolean; canceled?: boolean;
  // Fusion system ids captured on edit load (to target PATCH/DELETE on the line).
  fulfillLineId?: string | number; lineHref?: string; origQty?: number; origUnitPrice?: number; cancelSaved?: boolean;
  // Amounts as STORED in Fusion at load time (frozen charge totals). Kept so the
  // grid can show the figure as-is and flag when qty×price disagrees with it.
  loadedExt?: number; loadedTax?: number;
  // Child-collection hrefs captured on load → drill into charges / lot-serials.
  chargesHref?: string; lotSerialsHref?: string;
  // Sum of extra (non-sale) charges on the line — freight/handling/etc.
  chargeAmount?: number;
  // Fulfillment org + subinventory as stored on the line (shown in Fulfillment tab).
  orgCode?: string; subinventory?: string;
  // lotSerials rows fetched from Fusion (shown in the Lot Details tab).
  lineLots?: any[];
  // Selected lot and serials for InventoryTransactionFlag allocation (direct inventory transactions).
  selectedLot?: string; selectedSerials?: string[];
  // Return (RMA) line: references the original order line being returned.
  returnLine?: boolean; returnReason?: string; maxQty?: number;
  refHeaderId?: string | number; refLineId?: string | number; refFulfillLineId?: string | number;
  refOrderNumber?: string; refLineNumber?: string | number;
  // Original shipped lot/serial pulled from completed inventory transactions —
  // sent back on the return line's lotSerials child (one serial per entry).
  retLots?: { lot?: string; serial?: string; qty: number }[];
  // User-entered line EFF (Additional Information) segment values → uploaded as
  // the line's additionalInformation child. Keyed by segment API name.
  effVals?: Record<string, string>;
  error?: string }

const INV_ORGS_URL = `${FUSION_BASE}/inventoryOrganizations?onlyData=true&limit=500`;

// Business units (+ currency) from payablesOptions, deduped by name.
const usePayablesBUs = (): any[] => {
  const [bUnits, setBUnits] = useState<any[]>([]);
  useEffect(() => {
    fetch(`${FUSION_BASE}/payablesOptions?onlyData=true&limit=500&fields=businessUnitId,businessUnitName,paymentCurrency,ledgerCurrency`, { headers: getHeaders() })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => { const seen = new Set<string>(); setBUnits((d.items ?? []).filter((b: any) => { const n = b.businessUnitName; if (!n || seen.has(n)) return false; seen.add(n); return true; })); })
      .catch(() => { /* manual */ });
  }, []);
  return bUnits;
};
// All inventory organizations (full rows so a BU field is available for filtering).
const useInvOrgs = (): any[] => {
  const [orgRows, setOrgRows] = useState<any[]>([]);
  useEffect(() => {
    fetch(INV_ORGS_URL, { headers: getHeaders() })
      .then(r => r.ok ? r.json() : Promise.reject()).then(d => setOrgRows(d.items ?? [])).catch(() => { /* manual */ });
  }, []);
  return orgRows;
};
// Warehouse options filtered to the selected BU (falls back to all if no BU link on the org rows).
const orgOptionsForBU = (orgs: any[], buRow: any) => {
  const id = buRow?.businessUnitId; const name = buRow?.businessUnitName;
  const match = orgs.filter(o => {
    if (id == null && !name) return true;
    const oid = pf(o, ['BusinessUnitId', 'ManagementBusinessUnitId', 'ProfitCenterBusinessUnitId']);
    const oname = pf(o, ['BusinessUnitName', 'ManagementBusinessUnitName', 'ProfitCenterBusinessUnitName']);
    return (oid != null && String(oid) === String(id)) || (!!oname && !!name && oname === name);
  });
  return (match.length ? match : orgs).map(o => ({ value: o.OrganizationCode, label: `${o.OrganizationCode}${o.OrganizationName ? ' — ' + o.OrganizationName : ''}` }));
};
const WarehouseLabel: React.FC = () => (
  <Space size={4}>Warehouse
    <Tooltip title={<span style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}><b>GET</b> {INV_ORGS_URL}<br />filtered by the selected BU (BusinessUnitId / Name on the org)</span>}>
      <ApiOutlined style={{ color: REDWOOD.info }} />
    </Tooltip>
  </Space>
);

// Reusable card-like form section with an icon header.
const OrderSection: React.FC<{ icon: React.ReactNode; title: string; color: string; children: React.ReactNode }> = ({ icon, title, color, children }) => (
  <div style={{ border: `1px solid ${REDWOOD.neutral200}`, borderRadius: 10, padding: '12px 16px 2px', marginBottom: 12, background: REDWOOD.surface }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
      <span style={{ width: 24, height: 24, borderRadius: 7, background: color + '18', color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>{icon}</span>
      <Text strong style={{ fontSize: 12, color: REDWOOD.neutral900, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{title}</Text>
      <div style={{ flex: 1, height: 1, background: `linear-gradient(90deg, ${color}33, transparent)` }} />
    </div>
    <Row gutter={14}>{children}</Row>
  </div>
);
// A read-only labelled value (for the Address / totals panes).
const ROField: React.FC<{ label: string; value?: React.ReactNode; span?: number; mono?: boolean }> = ({ label, value, span = 6, mono }) => (
  <Col xs={12} md={span as any}>
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, color: REDWOOD.neutral600, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 12.5, color: REDWOOD.neutral900, fontFamily: mono ? 'monospace' : undefined, wordBreak: 'break-word', minHeight: 20 }}>{value ?? '—'}</div>
    </div>
  </Col>
);
// Vertical section (a full-height column card) — fields stack inside it.
const VSection: React.FC<{ icon: React.ReactNode; title: string; color: string; children: React.ReactNode }> = ({ icon, title, color, children }) => (
  <div style={{ border: `1px solid ${REDWOOD.neutral200}`, borderTop: `3px solid ${color}`, borderRadius: 10, padding: '7px 12px 2px', background: REDWOOD.surface, height: '100%' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
      <span style={{ width: 24, height: 24, borderRadius: 7, background: color + '18', color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>{icon}</span>
      <Text strong style={{ fontSize: 12, color: REDWOOD.neutral900, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{title}</Text>
    </div>
    {children}
  </div>
);
// A compact label:value row for the Totals column.
const TotalLine: React.FC<{ label: string; value: React.ReactNode; strong?: boolean; color?: string; onClick?: () => void }> = ({ label, value, strong, color, onClick }) => (
  <div onClick={onClick} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, padding: '2px 0', borderBottom: `1px dashed ${REDWOOD.neutral200}`, cursor: onClick ? 'pointer' : undefined }}>
    <span style={{ fontSize: 12, color: onClick ? REDWOOD.info : REDWOOD.neutral600, fontWeight: strong ? 700 : 400 }}>{label}{onClick && <ApiOutlined style={{ marginLeft: 5, fontSize: 11 }} />}</span>
    <span style={{ fontSize: strong ? 15 : 13, fontWeight: strong ? 800 : 600, color: color ?? REDWOOD.neutral900, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
  </div>
);

// itemCosts lives on the "latest" resource version; org is inside ValuationUnit
// "COSTORG-INVORG-SUBINV-LOT" (not directly filterable), so match client-side.
const LATEST_URL = `${getFusionHost()}/fscmRestApi/resources/latest`;
const COST_FIELDS = ['TotalUnitCost', 'UnitCost', 'ItemCost', 'UnitAverageCost', 'AverageUnitCost'];
const QTY_FIELDS = ['Quantity', 'OnhandQuantity', 'OnHandQuantity', 'TotalQuantity', 'ItemQuantity', 'CostQuantity'];
const parseVU = (vu?: string) => { const p = String(vu ?? '').split('-'); return { costOrg: p[0], invOrg: p[1], subinv: p[2], lot: p[3] }; };
const rowOrgMatches = (row: any, org?: string) => { if (!org) return true; const p = parseVU(row.ValuationUnit); return p.invOrg === org || p.costOrg === org; };
// Fusion child-resource links come back as absolute URLs to the serving POD;
// call them directly (no proxy rewrite).
const fusionHref = (href: string) => href;
const onhQtyOf = (x: any) => num(pf(x, ['PrimaryQuantity', 'QuantityOnhand', 'OnhandQuantity', 'Quantity']));

// Look up a customer in the ORDS customer master by account number and map the
// same fields the create flow uses (custAccountId / partyId / bill+ship sites).
const custMasterRefs = async (accountNumber?: string): Promise<Partial<OrderHeader>> => {
  if (!accountNumber) return {};
  try {
    for (let offset = 0; offset < 4000; offset += 500) {
      const r = await fetch(`${CUSTOMERS_URL}?limit=500&offset=${offset}`, { headers: { Accept: 'application/json' } });
      if (!r.ok) break;
      const d = await r.json();
      const items: any[] = d.items ?? [];
      const row = items.find(c => String(custAcct(c) ?? '') === String(accountNumber));
      if (row) { const f = customerFill(row); return { custAccountId: f.custAccountId, partyId: f.partyId, billToSite: f.billToSite, shipToSite: f.shipToSite }; }
      if (d.hasMore === false || items.length < 500) break;
    }
  } catch { /* ignore */ }
  return {};
};

// Read the bill-to / ship-to ids off an existing order so a Copy / Edit / Return
// can repopulate the header (Cust Account Id, Party Id, Bill-To / Ship-To sites)
// and the create payload's billToCustomer / shipToCustomer. These values live in
// the LINE-level billToCustomer / shipToCustomer child collections, not the header.
const fetchOrderCustomerRefs = async (order: any, providedLines?: any[]): Promise<Partial<OrderHeader>> => {
  let lines = providedLines;
  if (!lines || !lines.length) {
    const linesHref = order?.links?.find((l: any) => l.name === 'lines')?.href
      ?? (order?.OrderKey ? `${FUSION_BASE}/salesOrdersForOrderHub/${encodeURIComponent(order.OrderKey)}/child/lines` : '');
    if (linesHref) { try { lines = await fetchAllPages(fusionHref(linesHref)); } catch { lines = []; } }
  }
  const first = (lines ?? [])[0];
  const out: Partial<OrderHeader> = {};
  if (!first) return out;
  const childHref = (match: string) => {
    const link = (first.links ?? []).find((x: any) => x.rel === 'child' && norm(String(x.name)) === match);
    return link?.href ? fusionHref(link.href) : '';
  };
  const getFirstRow = async (match: string) => {
    const h = childHref(match);
    if (!h) return null;
    try {
      const url = h + (h.includes('?') ? '&' : '?') + 'onlyData=true&limit=1';
      const r = await fetch(url, { headers: getHeaders() });
      if (!r.ok) return null;
      const d = await r.json();
      return (d.items && d.items[0]) ?? null;
    } catch { return null; }
  };
  const [bill, ship] = await Promise.all([getFirstRow('billtocustomer'), getFirstRow('shiptocustomer')]);
  const acct   = pf(bill ?? {}, ['CustomerAccountId', 'AccountId', 'BillToCustomerId']) ?? pf(first, ['SoldToCustomerId', 'BillToCustomerId', 'CustomerAccountId']);
  const bSite  = pf(bill ?? {}, ['SiteUseId', 'CustomerAccountSiteUseId', 'BillToSiteUseId']) ?? pf(first, ['BillToCustomerUseId', 'BillToSiteUseId']);
  const sParty = pf(ship ?? {}, ['PartyId', 'ShipToPartyId']) ?? pf(first, ['ShipToPartyId', 'PartyId']);
  const sSite  = pf(ship ?? {}, ['SiteId', 'PartySiteId', 'ShipToPartySiteId', 'SiteUseId']) ?? pf(first, ['ShipToPartySiteId', 'ShipToPartySiteUseId']);
  if (acct != null) out.custAccountId = String(acct);
  if (bSite != null) out.billToSite = String(bSite);
  if (sParty != null) out.partyId = String(sParty);
  if (sSite != null) out.shipToSite = String(sSite);
  // Fill any gaps from the customer master (same source the create flow uses),
  // matched by the order's account number.
  if (out.custAccountId == null || out.partyId == null || out.billToSite == null || out.shipToSite == null) {
    const acctNo = pf(order ?? {}, ['BuyingPartyNumber', 'SoldToPartyNumber']) ?? pf(first, ['BuyingPartyNumber', 'SoldToPartyNumber']);
    const m = await custMasterRefs(acctNo != null ? String(acctNo) : undefined);
    if (out.custAccountId == null && m.custAccountId != null) out.custAccountId = m.custAccountId;
    if (out.partyId == null && m.partyId != null) out.partyId = m.partyId;
    if (out.billToSite == null && m.billToSite != null) out.billToSite = m.billToSite;
    if (out.shipToSite == null && m.shipToSite != null) out.shipToSite = m.shipToSite;
  }
  return out;
};

// Shared Fusion lookups (used by the picker modal and inline new-line search).
// Small page size + offset so itemCosts stays fast on large PODs (was limit=500,
// which crawled). The lot dialog offers a "next 25" to page further.
const LOT_PAGE = 25;
export const itemCostsUrlFor = (item: string, offset = 0) =>
  `${LATEST_URL}/itemCosts?q=${encodeURIComponent(`ItemNumber=${item}`)}&onlyData=true&limit=${LOT_PAGE}&offset=${offset}`;
async function fetchItemCostRows(item: string, org?: string, offset = 0): Promise<{ rows: any[]; hasMore: boolean }> {
  const r = await fetch(itemCostsUrlFor(item, offset), { headers: getHeaders() });
  const d = await r.json();
  const rows = ((d.items ?? []) as any[]).filter(x => rowOrgMatches(x, org));
  return { rows, hasMore: !!d.hasMore };
}
async function fetchOnhand(item: string, invOrg: string, subinv?: string, lot?: string): Promise<{ qty: number; lots: string[] }> {
  let q = `OrganizationCode=${invOrg};ItemNumber=${item}`; if (subinv) q += `;SubinventoryCode=${subinv}`;
  const r = await fetch(`${FUSION_BASE}/inventoryOnhandBalances?q=${encodeURIComponent(q)}&limit=${LOT_PAGE}`, { headers: getHeaders() });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const d = await r.json();
  const lotRows: any[] = [];
  for (const b of (d.items ?? [])) {
    if (pf(b, ['LotNumber']) != null) { lotRows.push(b); continue; }
    const child = (b.links ?? []).find((l: any) => l.rel === 'child' && /lot/i.test(l.href || l.name || ''));
    if (child?.href) {
      try { const cr = await fetch(`${fusionHref(child.href)}${child.href.includes('?') ? '&' : '?'}limit=500`, { headers: getHeaders() }); const cd = await cr.json(); (cd.items ?? []).forEach((x: any) => lotRows.push(x)); }
      catch { /* skip this balance's lot detail */ }
    } else { lotRows.push(b); }
  }
  const lots = Array.from(new Set(lotRows.map(x => pf(x, ['LotNumber'])).filter(Boolean))) as string[];
  const matched = lot ? lotRows.filter(x => String(pf(x, ['LotNumber']) ?? '') === String(lot)) : lotRows;
  const qty = (matched.length ? matched : lotRows).reduce((s, x) => s + onhQtyOf(x), 0);
  return { qty, lots };
}
// Resolve the numeric ids + lot / subinventory / serials for a reservation from
// on-hand balances (falls back to itemsV2 for the item id when there's no stock).
interface ReserveOpt { lot?: string; subinventory?: string; qty: number }
async function fetchReserveOptions(item: string, invOrg: string, subinv?: string): Promise<{ inventoryItemId?: any; organizationId?: any; lotControlled: boolean; options: ReserveOpt[] }> {
  const res: { inventoryItemId?: any; organizationId?: any; lotControlled: boolean; options: ReserveOpt[] } = { lotControlled: false, options: [] };
  const push = (lot: any, sub: any, qty: number) => {
    const key = `${lot ?? ''}|${sub ?? ''}`;
    const ex = res.options.find(o => `${o.lot ?? ''}|${o.subinventory ?? ''}` === key);
    if (ex) { ex.qty += qty; return; }
    res.options.push({ lot: lot != null && lot !== '' ? String(lot) : undefined, subinventory: sub != null && sub !== '' ? String(sub) : undefined, qty });
    if (lot != null && lot !== '') res.lotControlled = true;
  };
  let q = `OrganizationCode=${invOrg};ItemNumber=${item}`; if (subinv) q += `;SubinventoryCode=${subinv}`;
  try {
    const r = await fetch(`${FUSION_BASE}/inventoryOnhandBalances?q=${encodeURIComponent(q)}&limit=${LOT_PAGE}`, { headers: getHeaders() });
    if (r.ok) {
      const d = await r.json();
      for (const b of (d.items ?? [])) {
        if (res.inventoryItemId == null) res.inventoryItemId = pf(b, ['InventoryItemId']);
        if (res.organizationId == null) res.organizationId = pf(b, ['OrganizationId']);
        const sub = pf(b, ['SubinventoryCode']);
        const lotTop = pf(b, ['LotNumber']);
        if (lotTop != null) { push(lotTop, sub, onhQtyOf(b)); continue; }
        const child = (b.links ?? []).find((l: any) => l.rel === 'child' && /lot/i.test(l.href || l.name || ''));
        if (child?.href) {
          try {
            const cr = await fetch(`${fusionHref(child.href)}${child.href.includes('?') ? '&' : '?'}limit=500`, { headers: getHeaders() });
            const cd = await cr.json();
            const lrows: any[] = cd.items ?? [];
            if (lrows.length) lrows.forEach(x => push(pf(x, ['LotNumber']), pf(x, ['SubinventoryCode']) ?? sub, onhQtyOf(x)));
            else push(undefined, sub, onhQtyOf(b));
          } catch { push(undefined, sub, onhQtyOf(b)); }
        } else { push(undefined, sub, onhQtyOf(b)); }
      }
    }
  } catch { /* fall through to itemsV2 for the id */ }
  if (res.inventoryItemId == null) {
    try {
      const items = await searchItems(item, invOrg);
      const m = items.find(x => x.ItemNumber === item) ?? items[0];
      if (m) { res.inventoryItemId = pf(m, ['InventoryItemId', 'ItemId']); if (res.organizationId == null) res.organizationId = pf(m, ['OrganizationId']); }
    } catch { /* ignore */ }
  }
  // Prefer lots with stock first.
  res.options.sort((a, b) => (b.qty || 0) - (a.qty || 0));
  return res;
}
// Expand a serial range (e.g. SNA0001..SNA0003) into individual serials.
function expandSerialRange(from?: any, to?: any): string[] {
  if (from == null || from === '') return [];
  const f = String(from); const t = to != null && to !== '' ? String(to) : f;
  if (f === t) return [f];
  const m1 = f.match(/^(.*?)(\d+)$/); const m2 = t.match(/^(.*?)(\d+)$/);
  if (m1 && m2 && m1[1] === m2[1]) {
    const start = parseInt(m1[2], 10), end = parseInt(m2[2], 10), width = m1[2].length;
    if (end >= start && end - start < 5000) {
      const arr: string[] = [];
      for (let n = start; n <= end; n++) arr.push(m1[1] + String(n).padStart(width, '0'));
      return arr;
    }
  }
  return [f, t];
}
// Pull the lot/serial numbers actually shipped for a sales-order line from
// completed inventory transactions (TransactionType "Sales order issue"), tied
// back by order number + item + org. Returns one entry per serial (qty 1), or
// one per lot (with its qty) for lot-only items.
async function fetchShippedLotSerials(item: string, org: string, orderNumbers: (string | undefined)[]): Promise<{ lot?: string; serial?: string; qty: number }[]> {
  const out: { lot?: string; serial?: string; qty: number }[] = [];
  const seen = new Set<string>();
  const add = (lot?: any, serial?: any, qty?: number) => {
    const k = `${lot ?? ''}|${serial ?? ''}`;
    if (seen.has(k)) return; seen.add(k);
    out.push({ lot: lot != null && lot !== '' ? String(lot) : undefined, serial: serial != null && serial !== '' ? String(serial) : undefined, qty: qty ?? 1 });
  };
  const tryQuery = async (srcName: string) => {
    if (!org || !item) return;
    const q = `OrganizationCode=${org};ItemNumber=${item};TransactionType=Sales order issue;TransactionSourceName=${srcName}`;
    const url = `${FUSION_BASE}/inventoryCompletedTransactions?q=${encodeURIComponent(q)}&expand=lots,lots.lotSerials,serials&onlyData=true&limit=200`;
    try {
      const r = await fetch(url, { headers: getHeaders() });
      if (!r.ok) return;
      const d = await r.json();
      for (const t of (d.items ?? [])) {
        const lots: any[] = t.lots ?? [];
        const serialsTop: any[] = t.serials ?? [];
        if (lots.length) {
          for (const lt of lots) {
            const lotNo = pf(lt, ['LotNumber']);
            const ls: any[] = lt.lotSerials ?? [];
            if (ls.length) ls.forEach(s => expandSerialRange(pf(s, ['FmSerialNumber', 'SerialNumber']), pf(s, ['ToSerialNumber'])).forEach(sn => add(lotNo, sn, 1)));
            else add(lotNo, undefined, Math.abs(num(pf(lt, ['TransactionQuantity']))) || 1);
          }
        } else if (serialsTop.length) {
          serialsTop.forEach(s => expandSerialRange(pf(s, ['FmSerialNumber', 'SerialNumber']), pf(s, ['ToSerialNumber'])).forEach(sn => add(undefined, sn, 1)));
        }
      }
    } catch { /* ignore this source name */ }
  };
  for (const n of orderNumbers) { if (n && out.length === 0) await tryQuery(String(n)); }
  return out;
}
// Type-ahead item search by code OR description (merged, deduped by ItemNumber).
async function searchItems(text: string, org?: string): Promise<any[]> {
  const t = text.trim(); if (!t) return [];
  const esc = t.replace(/'/g, "''");
  const one = async (q: string) => { try { const r = await fetch(`${FUSION_BASE}/itemsV2?q=${encodeURIComponent(q)}&limit=25&onlyData=true`, { headers: getHeaders() }); const d = await r.json(); return (d.items ?? []) as any[]; } catch { return []; } };
  const orgQ = org ? `;OrganizationCode=${org}` : '';
  const [a, b] = await Promise.all([one(`ItemNumber LIKE '${esc}%'${orgQ}`), one(`ItemDescription LIKE '%${esc}%'${orgQ}`)]);
  const map = new Map<string, any>();
  [...a, ...b].forEach(x => { if (!map.has(x.ItemNumber)) map.set(x.ItemNumber, x); });
  return Array.from(map.values()).slice(0, 40);
}

// ── Multi-line import (PDF / Excel / CSV / paste / price list) ───────────────
interface ImpRow { key: string; itemNumber: string; description?: string; uom?: string; qty: number; price: number; valid?: boolean; note?: string }
let _impSeq = 0;
const impKey = () => `imp-${++_impSeq}`;

// Resolve a batch of item numbers against itemsV2 (validity + description + UOM).
async function resolveItems(numbers: string[], org?: string, source: 'itemsV2' | 'itemCost' | 'priceList' = 'itemCost'): Promise<Record<string, { ItemDescription?: string; uom?: string; exists: boolean }>> {
  const out: Record<string, { ItemDescription?: string; uom?: string; exists: boolean }> = {};
  const uniq = Array.from(new Set(numbers.map(n => String(n ?? '').trim()).filter(Boolean)));

  if (source === 'itemsV2') {
    for (let i = 0; i < uniq.length; i += 20) {
      const chunk = uniq.slice(i, i + 20);
      const inList = chunk.map(n => `'${n.replace(/'/g, "''")}'`).join(',');
      let q = `ItemNumber in (${inList})`; if (org) q += `;OrganizationCode=${org}`;
      try {
        const items = await fetchAllPages(`${FUSION_BASE}/itemsV2?q=${encodeURIComponent(q)}&limit=200&onlyData=true`);
        items.forEach((it: any) => { out[String(it.ItemNumber)] = { ItemDescription: it.ItemDescription, uom: pf(it, ['PrimaryUOMValue', 'PrimaryUOMCode', 'UOMCode']), exists: true }; });
      } catch { /* leave unresolved */ }
    }
  } else if (source === 'itemCost') {
    for (const item of uniq) {
      try {
        const items = await fetchAllPages(`${LATEST_URL}/itemCosts?q=${encodeURIComponent(`ItemNumber=${item}`)}&onlyData=true&limit=1`);
        if (items.length > 0) {
          const it = items[0];
          out[item] = { ItemDescription: pf(it, ['ItemDescription', 'item', 'Item', 'ItemNumber']), uom: pf(it, ['PrimaryUOMCode', 'UOMCode', 'UOM']), exists: true };
        }
      } catch { /* leave unresolved */ }
    }
  } else if (source === 'priceList') {
    // Price list validation is simpler - just check if item exists
    for (const item of uniq) {
      try {
        const items = await fetchAllPages(`${FUSION_BASE}/priceLists?onlyData=true&limit=1`);
        if (items.length > 0) {
          // Try to find item in first price list
          const plId = pf(items[0], ['PriceListId']);
          const plItems = await fetchAllPages(`${FUSION_BASE}/priceLists/${encodeURIComponent(plId)}/child/items?q=${encodeURIComponent(`ProductNumber=${item}`)}&onlyData=true&limit=1`);
          if (plItems.length > 0) {
            const it = plItems[0];
            out[item] = { ItemDescription: pf(it, ['ProductDescription', 'ItemDescription']), uom: pf(it, ['PrimaryUOMCode', 'UOMCode']), exists: true };
          }
        }
      } catch { /* leave unresolved */ }
    }
  }

  uniq.forEach(n => { if (!out[n]) out[n] = { exists: false }; });
  return out;
}

// Shared preview/validate/add grid for every import source. Takes parsed rows,
// lets the user tweak qty/price, validates the items, shows totals, then adds.
const StagedPreview: React.FC<{ rows: ImpRow[]; org?: string; ccy?: string; onAdd: (items: any[]) => void; onReset: () => void }> = ({ rows, org, ccy, onAdd, onReset }) => {
  const [data, setData] = useState<ImpRow[]>(rows);
  const [validating, setValidating] = useState(false);
  const [validated, setValidated] = useState(false);
  const [validationSource, setValidationSource] = useState<'itemsV2' | 'itemCost' | 'priceList'>('itemCost');
  useEffect(() => { setData(rows); setValidated(false); }, [rows]);
  const upd = (key: string, patch: Partial<ImpRow>) => setData(p => p.map(r => r.key === key ? { ...r, ...patch } : r));
  const remove = (key: string) => setData(p => p.filter(r => r.key !== key));
  const validate = async () => {
    setValidating(true);
    try {
      const res = await resolveItems(data.map(r => r.itemNumber), org, validationSource);
      setData(p => p.map(r => { const m = res[r.itemNumber.trim()]; return { ...r, valid: !!m?.exists, description: r.description || m?.ItemDescription, uom: r.uom || m?.uom, note: m?.exists ? undefined : 'Item not found' }; }));
      setValidated(true);
      const bad = data.filter(r => !res[r.itemNumber.trim()]?.exists).length;
      if (bad === 0) message.success('All items valid'); else message.warning(`${bad} item(s) not found — fix or remove them`);
    } finally { setValidating(false); }
  };
  const totQty = data.reduce((s, r) => s + num(r.qty), 0);
  const totAmt = data.reduce((s, r) => s + num(r.qty) * num(r.price), 0);
  const badN = data.filter(r => r.valid === false).length;
  const cols: ColumnsType<ImpRow> = [
    { title: '#', width: 40, align: 'center', render: (_, __, i) => <Tag color="blue">{i + 1}</Tag> },
    { title: 'Item', dataIndex: 'itemNumber', width: 180, render: (v, r) => <Space size={4}><Input size="small" value={v} style={{ width: 130 }} onChange={e => upd(r.key, { itemNumber: e.target.value, valid: undefined })} />
        {r.valid === true && <CheckCircleTwoTone twoToneColor={REDWOOD.success} />}{r.valid === false && <Tooltip title={r.note}><CloseCircleTwoTone twoToneColor={REDWOOD.error} /></Tooltip>}</Space> },
    { title: 'Description', dataIndex: 'description', ellipsis: true, render: v => <Text style={{ fontSize: 12 }}>{v ?? '—'}</Text> },
    { title: 'UOM', dataIndex: 'uom', width: 70, render: v => v ?? '—' },
    { title: 'Qty', dataIndex: 'qty', width: 90, align: 'right', render: (v, r) => <InputNumber size="small" min={0} value={v} onChange={n => upd(r.key, { qty: Number(n) || 0 })} style={{ width: 78 }} /> },
    { title: 'Unit Price', dataIndex: 'price', width: 110, align: 'right', render: (v, r) => <InputNumber size="small" min={0} value={v} onChange={n => upd(r.key, { price: Number(n) || 0 })} style={{ width: 96 }} /> },
    { title: 'Total', width: 110, align: 'right', render: (_, r) => <Text strong style={{ color: REDWOOD.primary, fontVariantNumeric: 'tabular-nums' }}>{fmtAmount(num(r.qty) * num(r.price), ccy)}</Text> },
    { title: '', width: 44, align: 'center', render: (_, r) => <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => remove(r.key)} /> },
  ];
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <Space size={8}>
          <span style={{ fontSize: 12, color: REDWOOD.neutral600 }}>Validate with:</span>
          <Radio.Group value={validationSource} onChange={e => { setValidationSource(e.target.value); setValidated(false); }} size="small">
            <Radio.Button value="itemCost">Item Cost</Radio.Button>
            <Radio.Button value="itemsV2">ItemsV2</Radio.Button>
            <Radio.Button value="priceList">Price List</Radio.Button>
          </Radio.Group>
        </Space>
        <Button icon={<SearchOutlined />} loading={validating} onClick={validate} type="primary" style={{ background: REDWOOD.info, borderColor: REDWOOD.info }}>Validate items</Button>
        <Button icon={<RollbackOutlined />} onClick={onReset}>Start over</Button>
        <Text type="secondary" style={{ fontSize: 12 }}>{data.length} row(s){validated ? ` · ${badN} invalid` : ''}</Text>
        <span style={{ marginLeft: 'auto' }}><Text strong>Total: {fmtQty(totQty)} unit(s) · {fmtAmount(totAmt, ccy)}</Text></span>
      </div>
      <Table size="small" columns={cols} dataSource={data} rowKey="key" pagination={data.length > 50 ? { pageSize: 50 } : false} scroll={{ y: 360 }}
        rowClassName={r => r.valid === false ? 'imp-bad' : ''} />
      <div style={{ marginTop: 10, textAlign: 'right' }}>
        <Button type="primary" icon={<PlusOutlined />} disabled={!validated || badN > 0 || !data.length} style={{ background: REDWOOD.success, borderColor: REDWOOD.success }}
          onClick={() => {
            const picked = data.filter(r => r.itemNumber.trim()).map(r => ({ ItemNumber: r.itemNumber.trim(), ItemDescription: r.description, PrimaryUOMValue: r.uom, _qty: num(r.qty), _price: num(r.price) }));
            if (!picked.length) { message.warning('Nothing to add'); return; }
            onAdd(picked); message.success(`Added ${picked.length} line(s) to the order`);
          }}>Add {data.length} line(s) to order</Button>
      </div>
    </div>
  );
};

// Guess a column index from a set of header keywords.
const guessCol = (headers: string[], keys: string[]) => headers.findIndex(h => keys.some(k => norm(String(h)).includes(k)));
// Parse a table (array-of-arrays) into ImpRows using column indices.
const tableToRows = (grid: any[][], map: { item: number; qty: number; price: number; desc: number }, headerRow: number): ImpRow[] => {
  const out: ImpRow[] = [];
  for (let i = headerRow + 1; i < grid.length; i++) {
    const row = grid[i] ?? [];
    const item = map.item >= 0 ? String(row[map.item] ?? '').trim() : '';
    if (!item) continue;
    const qty = map.qty >= 0 ? num(String(row[map.qty] ?? '').replace(/,/g, '')) : 0;
    const price = map.price >= 0 ? num(String(row[map.price] ?? '').replace(/[^0-9.\-]/g, '')) : 0;
    const desc = map.desc >= 0 ? String(row[map.desc] ?? '').trim() : undefined;
    out.push({ key: impKey(), itemNumber: item, description: desc, qty: qty || 1, price });
  }
  return out;
};

// Column-mapping bar shared by the Excel and Paste panels.
const MapBar: React.FC<{ headers: string[]; map: any; setMap: (m: any) => void; headerRow: number; setHeaderRow: (n: number) => void; maxHeader: number }> = ({ headers, map, setMap, headerRow, setHeaderRow, maxHeader }) => {
  const opts = headers.map((h, i) => ({ value: i, label: `${i + 1}: ${String(h ?? '').slice(0, 24) || '(empty)'}` }));
  const none = [{ value: -1, label: '— none —' }];
  const field = (label: string, k: string, required?: boolean) => (
    <span style={{ fontSize: 12 }}>{label}{required ? ' *' : ''}:
      <Select size="small" style={{ width: 150, marginLeft: 4 }} value={map[k]} popupMatchSelectWidth={false}
        options={(required ? [] : none).concat(opts)} onChange={v => setMap({ ...map, [k]: v })} /></span>
  );
  return (
    <Space wrap style={{ marginBottom: 10 }}>
      <span style={{ fontSize: 12 }}>Header row:
        <InputNumber size="small" min={1} max={maxHeader} value={headerRow + 1} style={{ width: 64, marginLeft: 4 }} onChange={v => setHeaderRow((Number(v) || 1) - 1)} /></span>
      {field('Item', 'item', true)}{field('Qty', 'qty')}{field('Price', 'price')}{field('Description', 'desc')}
    </Space>
  );
};

// From Excel / CSV
const ExcelPanel: React.FC<{ org?: string; ccy?: string; onAdd: (items: any[]) => void }> = ({ org, ccy, onAdd }) => {
  const [grid, setGrid] = useState<any[][] | null>(null);
  const [fileName, setFileName] = useState('');
  const [headerRow, setHeaderRow] = useState(0);
  const [map, setMap] = useState({ item: -1, qty: -1, price: -1, desc: -1 });
  const [rows, setRows] = useState<ImpRow[] | null>(null);
  const readFile = async (f: File) => {
    try {
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const g = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, blankrows: false, defval: '' });
      setGrid(g); setFileName(f.name); setRows(null);
      const hdr = (g[0] ?? []).map(String);
      setHeaderRow(0);
      setMap({ item: guessCol(hdr, ['item', 'sku', 'product', 'partno', 'code']), qty: guessCol(hdr, ['qty', 'quantity', 'ordered']), price: guessCol(hdr, ['price', 'rate', 'unitprice', 'amount']), desc: guessCol(hdr, ['desc', 'name', 'particular']) });
    } catch (e: any) { message.error(`Read failed: ${e.message}`); }
    return false;
  };
  if (rows) return <StagedPreview rows={rows} org={org} ccy={ccy} onAdd={onAdd} onReset={() => setRows(null)} />;
  const headers = (grid?.[headerRow] ?? []).map(String);
  return (
    <div>
      <Upload accept=".xlsx,.xls,.csv" showUploadList={false} beforeUpload={readFile}>
        <Button icon={<FileExcelOutlined />} type="primary" ghost>Select Excel / CSV file</Button>
      </Upload>
      {fileName && <Tag style={{ marginLeft: 8 }}>{fileName}</Tag>}
      {grid && <div style={{ marginTop: 12 }}>
        <MapBar headers={headers} map={map} setMap={setMap} headerRow={headerRow} setHeaderRow={setHeaderRow} maxHeader={grid.length} />
        <div style={{ maxHeight: 240, overflow: 'auto', border: `1px solid ${REDWOOD.neutral200}`, borderRadius: 6 }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 11.5, width: '100%' }}>
            <tbody>
              {grid.slice(0, 30).map((r, ri) => (
                <tr key={ri} style={{ background: ri === headerRow ? REDWOOD.neutral100 : undefined, fontWeight: ri === headerRow ? 700 : 400 }}>
                  <td style={{ padding: '2px 6px', color: REDWOOD.neutral600, borderBottom: `1px solid ${REDWOOD.neutral200}` }}>{ri + 1}</td>
                  {(r ?? []).map((c: any, ci: number) => <td key={ci} style={{ padding: '2px 8px', borderBottom: `1px solid ${REDWOOD.neutral200}`, whiteSpace: 'nowrap' }}>{String(c ?? '')}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 10, textAlign: 'right' }}>
          <Button type="primary" icon={<ImportOutlined />} disabled={map.item < 0} style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}
            onClick={() => { const rs = tableToRows(grid, map, headerRow); if (!rs.length) { message.warning('No item rows found — check the column mapping'); return; } setRows(rs); }}>Build preview ({Math.max(0, grid.length - headerRow - 1)} rows)</Button>
        </div>
      </div>}
    </div>
  );
};

// From copy-paste (tab / comma / multi-space separated)
const PastePanel: React.FC<{ org?: string; ccy?: string; onAdd: (items: any[]) => void }> = ({ org, ccy, onAdd }) => {
  const [text, setText] = useState('');
  const [grid, setGrid] = useState<any[][] | null>(null);
  const [headerRow, setHeaderRow] = useState(0);
  const [hasHeader, setHasHeader] = useState(true);
  const [map, setMap] = useState({ item: 0, qty: 1, price: 2, desc: -1 });
  const [rows, setRows] = useState<ImpRow[] | null>(null);
  const parse = () => {
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (!lines.length) { message.warning('Paste some rows first'); return; }
    const delim = lines[0].includes('\t') ? /\t/ : (lines[0].includes(',') ? /,/ : /\s{2,}|\s+/);
    const g = lines.map(l => l.split(delim).map(s => s.trim()));
    setGrid(g); setRows(null);
    const hdr = (g[0] ?? []).map(String);
    const looksHeader = hdr.some(h => /item|qty|price|desc|product|sku/i.test(h));
    setHasHeader(looksHeader); setHeaderRow(0);
    setMap({ item: Math.max(0, guessCol(hdr, ['item', 'sku', 'product', 'code'])), qty: guessCol(hdr, ['qty', 'quantity']) < 0 ? 1 : guessCol(hdr, ['qty', 'quantity']), price: guessCol(hdr, ['price', 'rate', 'amount']) < 0 ? 2 : guessCol(hdr, ['price', 'rate', 'amount']), desc: guessCol(hdr, ['desc', 'name']) });
  };

  // Auto-build preview when grid and map are ready
  useEffect(() => {
    if (!grid || map.item < 0) return;
    const rs = tableToRows(grid, map, hasHeader ? headerRow : -1);
    if (rs.length) setRows(rs);
  }, [grid, map, hasHeader, headerRow]);

  if (rows) return <StagedPreview rows={rows} org={org} ccy={ccy} onAdd={onAdd} onReset={() => setRows(null)} />;
  const headers = grid ? (hasHeader ? grid[headerRow] : grid[headerRow].map((_, i) => `Col ${i + 1}`)).map(String) : [];
  return (
    <div>
      <Input.TextArea rows={6} value={text} onChange={e => setText(e.target.value)}
        placeholder={'Paste rows — tab, comma or space separated. e.g.\nItem\tQty\tPrice\nSM-A057FZKGAFB\t2\t95.22'} />
      <div style={{ marginTop: 8 }}>
        <Button type="primary" icon={<SnippetsOutlined />} onClick={parse} style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}>Parse</Button>
      </div>
      {grid && <div style={{ marginTop: 12 }}>
        <Space style={{ marginBottom: 8 }}><Checkbox checked={hasHeader} onChange={e => setHasHeader(e.target.checked)}>First row is a header</Checkbox></Space>
        <MapBar headers={headers} map={map} setMap={setMap} headerRow={hasHeader ? headerRow : -1 + 0} setHeaderRow={setHeaderRow} maxHeader={grid.length} />
      </div>}
    </div>
  );
};

// ── PDF marking templates (saved to localStorage + exportable JSON) ──────────
type PdfField = 'item' | 'qty' | 'price' | 'desc' | 'customer';
interface PdfMark { field: PdfField; xMin: number; xMax: number; yMin: number; yMax: number; page: number } // all normalized 0..1
interface PdfTpl { name: string; signature: string[]; marks: PdfMark[] }
const PDF_TPL_KEY = 'reacterp.pdfLineTemplates';
const loadPdfTpls = (): PdfTpl[] => { try { return JSON.parse(localStorage.getItem(PDF_TPL_KEY) || '[]'); } catch { return []; } };
const savePdfTpls = (t: PdfTpl[]) => { try { localStorage.setItem(PDF_TPL_KEY, JSON.stringify(t)); } catch { /* ignore quota */ } };
const pdfTokens = (s: string) => (s.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 2 && !/^\d+$/.test(t)));
const jaccard = (a: string[], b: string[]) => { const A = new Set(a), B = new Set(b); if (!A.size || !B.size) return 0; let inter = 0; A.forEach(x => { if (B.has(x)) inter++; }); return inter / new Set([...a, ...b]).size; };
const PDF_FIELDS: { field: PdfField; label: string; color: string }[] = [
  { field: 'item', label: 'Item', color: '#C74634' }, { field: 'qty', label: 'Qty', color: '#1D7B4D' },
  { field: 'price', label: 'Price', color: '#0572CE' }, { field: 'desc', label: 'Description', color: '#6B21A8' },
  { field: 'customer', label: 'Customer', color: '#B07700' },
];
const numTok = (s: string) => { const n = Number(String(s).replace(/,/g, '')); return /^[\d,]+(\.\d+)?$/.test(String(s).trim()) && !Number.isNaN(n) ? n : null; };

// From PDF — render pages, mark columns/customer by drawing boxes, save/auto-detect
// a template, then extract order lines by column. Falls back to a no-mapping parse.
interface PdfPage { page: number; img: string; w: number; h: number; items: { str: string; nx: number; ny: number }[] }
const PdfPanel: React.FC<{ org?: string; ccy?: string; onAdd: (items: any[]) => void }> = ({ org, ccy, onAdd }) => {
  const [pages, setPages] = useState<PdfPage[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState(0);
  const [marks, setMarks] = useState<PdfMark[]>([]);
  const [drawField, setDrawField] = useState<PdfField>('item');
  const [draft, setDraft] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [tpls, setTpls] = useState<PdfTpl[]>(loadPdfTpls());
  const [tplName, setTplName] = useState('');
  const [rows, setRows] = useState<ImpRow[] | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);

  const signatureOf = (pd: PdfPage[]): string[] => {
    const p0 = pd[0]; if (!p0) return [];
    const head = p0.items.filter(it => it.ny < 0.28).map(it => it.str).join(' ');
    return Array.from(new Set(pdfTokens(head)));
  };
  const applyTpl = (t: PdfTpl) => { setMarks(t.marks); message.success(`Applied template “${t.name}”`); };

  const readPdf = async (f: File) => {
    setLoading(true); setPages(null); setRows(null); setMarks([]); setView(0);
    try {
      const pdfjsLib: any = await import('pdfjs-dist');
      const ver: string = pdfjsLib.version;
      const ext = ver.startsWith('3.') || ver.startsWith('2.') ? 'min.js' : 'min.mjs';
      pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${ver}/build/pdf.worker.${ext}`;
      const buf = await f.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: buf, useSystemFonts: true }).promise;
      const out: PdfPage[] = [];
      for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p);
        const scale = Math.min(1.5, 900 / page.getViewport({ scale: 1 }).width);
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width; canvas.height = viewport.height;
        const ctx = canvas.getContext('2d')!;
        await page.render({ canvasContext: ctx, viewport }).promise;
        const content = await page.getTextContent();
        const items = content.items.filter((it: any) => 'str' in it && it.str.trim()).map((it: any) => {
          const tx = pdfjsLib.Util.transform(viewport.transform, it.transform);
          const w = (it.width || 0) * scale;
          return { str: it.str.trim(), nx: (tx[4] + w / 2) / viewport.width, ny: tx[5] / viewport.height };
        });
        out.push({ page: p, img: canvas.toDataURL('image/png'), w: viewport.width, h: viewport.height, items });
      }
      setPages(out); setFileName(f.name);
      // Auto-detect a saved template by header signature.
      const sig = signatureOf(out);
      let best: { t: PdfTpl; s: number } | null = null;
      loadPdfTpls().forEach(t => { const s = jaccard(sig, t.signature); if (!best || s > best.s) best = { t, s }; });
      if (best && best.s >= 0.5) applyTpl(best.t);
      else message.info('No matching template — draw column boxes to create one, or use “Extract all rows”.');
    } catch (e: any) { message.error(`PDF read failed: ${e.message}`); }
    finally { setLoading(false); }
  };

  // Mouse → normalized coords within the current page overlay.
  const toNorm = (e: React.MouseEvent) => { const r = overlayRef.current!.getBoundingClientRect(); return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }; };
  const onDown = (e: React.MouseEvent) => { const p = toNorm(e); dragStart.current = p; setDraft({ x0: p.x, y0: p.y, x1: p.x, y1: p.y }); };
  const onMove = (e: React.MouseEvent) => { if (!dragStart.current) return; const p = toNorm(e); const s = dragStart.current; setDraft({ x0: Math.min(s.x, p.x), y0: Math.min(s.y, p.y), x1: Math.max(s.x, p.x), y1: Math.max(s.y, p.y) }); };
  const onUp = () => {
    if (draft && (draft.x1 - draft.x0 > 0.01)) {
      const m: PdfMark = { field: drawField, xMin: draft.x0, xMax: draft.x1, yMin: draft.y0, yMax: draft.y1, page: view };
      setMarks(prev => [...prev.filter(x => x.field !== drawField), m]); // one box per field
    }
    dragStart.current = null; setDraft(null);
  };

  const colFor = (nx: number) => marks.find(m => m.field !== 'customer' && nx >= m.xMin && nx <= m.xMax);
  const getMark = (f: PdfField) => marks.find(m => m.field === f);

  // Extract order lines using the column marks (x-ranges applied to every page).
  const extractByColumns = (): ImpRow[] => {
    const itemCol = getMark('item'); if (!itemCol) return [];
    const out: ImpRow[] = [];
    (pages ?? []).forEach(pg => {
      const rowMap = new Map<number, { str: string; nx: number }[]>();
      pg.items.forEach(it => { const k = Math.round(it.ny * 250); if (!rowMap.has(k)) rowMap.set(k, []); rowMap.get(k)!.push(it); });
      [...rowMap.values()].forEach(cells => {
        const bucket: Record<string, string[]> = {};
        cells.sort((a, b) => a.nx - b.nx).forEach(c => { const col = colFor(c.nx); if (col) (bucket[col.field] ??= []).push(c.str); });
        const item = (bucket.item ?? []).join('').trim();
        if (!item || !/\d/.test(item) || item.length < 3) return;
        const priceToks = (bucket.price ?? []).map(numTok).filter((n): n is number => n != null);
        const qtyToks = (bucket.qty ?? []).map(numTok).filter((n): n is number => n != null);
        out.push({ key: impKey(), itemNumber: item, description: (bucket.desc ?? []).join(' ') || undefined, qty: qtyToks[0] || 1, price: priceToks.length ? priceToks[priceToks.length - 1] : 0 });
      });
    });
    return out;
  };
  // No-mapping fallback: parse every row heuristically (item = first alnum token,
  // price = last number, qty = the number before it).
  const extractAll = (): ImpRow[] => {
    const out: ImpRow[] = [];
    (pages ?? []).forEach(pg => {
      const rowMap = new Map<number, { str: string; nx: number }[]>();
      pg.items.forEach(it => { const k = Math.round(it.ny * 250); if (!rowMap.has(k)) rowMap.set(k, []); rowMap.get(k)!.push(it); });
      [...rowMap.values()].forEach(cells => {
        const toks = cells.sort((a, b) => a.nx - b.nx).map(c => c.str);
        const item = toks.find(t => /[A-Za-z]/.test(t) && /\d/.test(t) && t.length >= 4) ?? toks.find(t => /^\d{4,}$/.test(t));
        if (!item) return;
        const nums = toks.map(numTok).filter((n): n is number => n != null);
        out.push({ key: impKey(), itemNumber: item, description: toks.filter(t => t !== item && numTok(t) == null).join(' ') || undefined, qty: nums.length >= 2 ? nums[nums.length - 2] : 1, price: nums.length ? nums[nums.length - 1] : 0 });
      });
    });
    return out;
  };

  const customerText = useMemo(() => {
    const c = getMark('customer'); if (!c || !pages) return '';
    const pg = pages[c.page]; if (!pg) return '';
    return pg.items.filter(it => it.nx >= c.xMin && it.nx <= c.xMax && it.ny >= c.yMin && it.ny <= c.yMax).map(it => it.str).join(' ');
  }, [marks, pages]);

  const saveTemplate = () => {
    if (!tplName.trim()) { message.warning('Enter a template name'); return; }
    if (!getMark('item')) { message.warning('Mark at least the Item column'); return; }
    const t: PdfTpl = { name: tplName.trim(), signature: signatureOf(pages ?? []), marks };
    const next = [...tpls.filter(x => x.name !== t.name), t];
    setTpls(next); savePdfTpls(next); setTplName('');
    message.success(`Template “${t.name}” saved`);
  };
  const exportTemplate = () => {
    if (!getMark('item')) { message.warning('Mark the Item column first'); return; }
    downloadJson({ __type: 'reacterp.pdfLineTemplate', version: 1, name: tplName.trim() || fileName.replace(/\.pdf$/i, ''), signature: signatureOf(pages ?? []), marks }, `${(tplName.trim() || 'pdf-template')}.json`);
  };
  const importTemplate = async (f: File) => {
    try {
      const raw = await readJsonFile(f);
      if (!Array.isArray(raw.marks)) { message.error('Not a PDF marking template'); return false; }
      const t: PdfTpl = { name: raw.name || f.name.replace(/\.json$/i, ''), signature: raw.signature ?? [], marks: raw.marks };
      const next = [...tpls.filter(x => x.name !== t.name), t];
      setTpls(next); savePdfTpls(next); applyTpl(t);
    } catch (e: any) { message.error(`Load failed: ${e.message}`); }
    return false;
  };

  if (rows) return <StagedPreview rows={rows} org={org} ccy={ccy} onAdd={onAdd} onReset={() => setRows(null)} />;
  const pg = pages?.[view];
  const fieldColor = (f: PdfField) => PDF_FIELDS.find(x => x.field === f)!.color;
  const boxStyle = (m: { xMin: number; yMin: number; xMax: number; yMax: number }, color: string): React.CSSProperties => ({ position: 'absolute', left: `${m.xMin * 100}%`, top: `${m.yMin * 100}%`, width: `${(m.xMax - m.xMin) * 100}%`, height: `${(m.yMax - m.yMin) * 100}%`, border: `2px solid ${color}`, background: `${color}22`, pointerEvents: 'none' });

  return (
    <div>
      <Space wrap style={{ marginBottom: 10 }}>
        <Upload accept=".pdf" showUploadList={false} beforeUpload={readPdf}>
          <Button icon={<FilePdfOutlined />} type="primary" ghost loading={loading}>Select PDF file</Button>
        </Upload>
        {fileName && <Tag>{fileName}</Tag>}
        {pages && <>
          <Select size="small" style={{ width: 200 }} placeholder="Apply saved template" popupMatchSelectWidth={false}
            value={undefined} options={tpls.map(t => ({ value: t.name, label: t.name }))}
            onChange={(v) => { const t = tpls.find(x => x.name === v); if (t) applyTpl(t); }} notFoundContent="No templates yet" />
          <Upload accept=".json,application/json" showUploadList={false} beforeUpload={importTemplate}>
            <Button size="small" icon={<CloudUploadOutlined />}>Load template JSON</Button>
          </Upload>
        </>}
      </Space>

      {pg && <>
        {/* Field palette + template save */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>Draw a box for:</Text>
          {PDF_FIELDS.map(f => (
            <Button key={f.field} size="small" onClick={() => setDrawField(f.field)}
              style={{ borderColor: f.color, color: drawField === f.field ? '#fff' : f.color, background: drawField === f.field ? f.color : '#fff', fontWeight: 600 }}>
              {f.label}{getMark(f.field) ? ' ✓' : ''}
            </Button>
          ))}
          <Button size="small" icon={<DeleteOutlined />} onClick={() => setMarks([])} disabled={!marks.length}>Clear marks</Button>
          <span style={{ marginLeft: 'auto' }} />
          <Input size="small" style={{ width: 150 }} placeholder="Template name" value={tplName} onChange={e => setTplName(e.target.value)} />
          <Button size="small" icon={<SaveOutlined />} onClick={saveTemplate}>Save</Button>
          <Button size="small" icon={<DownloadOutlined />} onClick={exportTemplate}>Export JSON</Button>
        </div>
        {customerText && <div style={{ marginBottom: 8 }}><Tag color="gold">Customer (marked)</Tag><Text style={{ fontSize: 12 }}>{customerText}</Text></div>}

        {/* Page pager */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <Button size="small" disabled={view === 0} onClick={() => setView(v => v - 1)}>‹ Prev</Button>
          <Text style={{ fontSize: 12 }}>Page {view + 1} / {pages!.length}</Text>
          <Button size="small" disabled={view >= pages!.length - 1} onClick={() => setView(v => v + 1)}>Next ›</Button>
          <Text type="secondary" style={{ fontSize: 11.5, marginLeft: 8 }}>Drag on the page to mark a column (Item/Qty/Price/Description) or the Customer block. Column x-ranges apply to every page.</Text>
        </div>

        {/* Rendered page + marking overlay */}
        <div style={{ maxHeight: 460, overflow: 'auto', border: `1px solid ${REDWOOD.neutral200}`, borderRadius: 6, background: REDWOOD.neutral100 }}>
          <div style={{ position: 'relative', width: '100%' }}>
            <img src={pg.img} alt={`page ${view + 1}`} style={{ width: '100%', display: 'block' }} draggable={false} />
            <div ref={overlayRef} onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}
              style={{ position: 'absolute', inset: 0, cursor: 'crosshair' }}>
              {marks.filter(m => m.field === 'customer' ? m.page === view : true).map((m, i) => (
                <div key={i} style={boxStyle(m, fieldColor(m.field))}>
                  <span style={{ position: 'absolute', top: -16, left: 0, fontSize: 10, fontWeight: 700, color: fieldColor(m.field), background: '#fff', padding: '0 3px' }}>{m.field}</span>
                </div>
              ))}
              {draft && <div style={boxStyle({ xMin: draft.x0, yMin: draft.y0, xMax: draft.x1, yMax: draft.y1 }, fieldColor(drawField))} />}
            </div>
          </div>
        </div>

        <div style={{ marginTop: 10, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button icon={<ImportOutlined />} onClick={() => { const rs = extractAll(); if (!rs.length) { message.warning('No item-like rows found'); return; } setRows(rs); }}>Extract all rows (no mapping)</Button>
          <Button type="primary" icon={<TableOutlined />} disabled={!getMark('item')} style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}
            onClick={() => { const rs = extractByColumns(); if (!rs.length) { message.warning('No lines matched the columns — check the Item/Price boxes'); return; } setRows(rs); }}>Extract with columns</Button>
        </div>
      </>}
    </div>
  );
};

// Item picker (itemsV2) — single-line editable grid: cost, on-hand, qty, price,
// total, margin, tax and net; select rows and add them as order lines.
const ItemCostSearch: React.FC<{ org?: string; subinv?: string; taxOptions?: { value: string; label: string; pct: number }[]; onAdd: (items: any[]) => void }> = ({ org, subinv, taxOptions = [], onAdd }) => {
  const [byDesc, setByDesc] = useState(false);
  const [term, setTerm] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sel, setSel] = useState<React.Key[]>([]);
  const [costs, setCosts] = useState<Record<string, { cost?: number; ccy?: string; onhand?: number; n: number; rows: any[] }>>({});
  const [costLoading, setCostLoading] = useState(false);
  const [draft, setDraft] = useState<Record<string, { qty: number; price: number; taxCode?: string; taxPct?: number; tax: number }>>({});
  const [onh, setOnh] = useState<Record<string, { loading?: boolean; qty?: number; lots?: string[]; err?: string }>>({});
  const [apiOpen, setApiOpen] = useState(false);

  const url = useMemo(() => {
    const t = term.trim(); if (!t) return '';
    const field = byDesc ? 'ItemDescription' : 'ItemNumber';
    const pattern = byDesc ? `%${t}%` : `${t}%`;
    let q = `${field} LIKE '${pattern}'`;
    if (org) q += `;OrganizationCode=${org}`;
    return `${FUSION_BASE}/itemsV2?q=${encodeURIComponent(q)}&limit=100&onlyData=true`;
  }, [term, byDesc, org]);

  const loadCosts = useCallback(async (items: any[]) => {
    if (!items.length) return;
    setCostLoading(true);
    const map: Record<string, { cost?: number; ccy?: string; onhand?: number; n: number; rows: any[] }> = {};
    await mapLimit(items, 5, async (it) => {
      const item = it.ItemNumber;
      try {
        // itemCosts is queryable directly by ItemNumber; org lives in ValuationUnit.
        const r = await fetch(`${LATEST_URL}/itemCosts?q=${encodeURIComponent(`ItemNumber=${item}`)}&onlyData=true&limit=500`, { headers: getHeaders() });
        const d = await r.json();
        const matched = (d.items ?? []).filter((x: any) => rowOrgMatches(x, org));
        const row = matched[0];
        map[item] = { cost: row ? num(pf(row, COST_FIELDS)) : undefined, ccy: row?.CurrencyCode, onhand: row ? num(pf(row, ['QuantityOnhand', ...QTY_FIELDS])) : undefined, n: matched.length, rows: matched };
      } catch { map[item] = { n: 0, rows: [] }; }
    });
    setCosts(map); setCostLoading(false);
  }, [org]);

  const search = useCallback(async () => {
    if (!url) { message.warning('Enter a search term'); return; }
    setLoading(true); setError(''); setSel([]); setCosts({}); setDraft({}); setOnh({});
    try { const items = await fetchAllPages(url); setRows(items); loadCosts(items); }
    catch (e: any) { setError(e.message); setRows([]); }
    finally { setLoading(false); }
  }, [url, loadCosts]);

  const dget = (item: string) => draft[item] ?? { qty: 0, price: num(costs[item]?.cost), tax: 0, taxCode: undefined as string | undefined, taxPct: undefined as number | undefined };
  const dset = (item: string, patch: Partial<{ qty: number; price: number; taxCode?: string; taxPct?: number; tax: number }>) =>
    // Re-derive tax from the chosen tax_code_per whenever qty/price/tax code change.
    setDraft(p => { const base = p[item] ?? { qty: 0, price: num(costs[item]?.cost), tax: 0 }; const m = { ...base, ...patch }; if (m.taxPct != null) m.tax = round2(m.qty * m.price * m.taxPct / 100); return { ...p, [item]: m }; });
  const vuOf = (item: string) => parseVU(costs[item]?.rows?.[0]?.ValuationUnit);
  const costQtyOf = (item: string) => num(pf(costs[item]?.rows?.[0], QTY_FIELDS));
  const costOnhandOf = (item: string) => costs[item]?.onhand;
  const num2 = (v: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
  const onhQty = (x: any) => num(pf(x, ['PrimaryQuantity', 'QuantityOnhand', 'OnhandQuantity', 'Quantity']));

  // On-hand: query the org+item (+subinventory) balances, follow each balance's
  // lot child link to read per-lot quantities, then match the cost row's lot.
  const checkOnhand = async (item: string, invOrg?: string, subinv?: string, lot?: string) => {
    if (!invOrg) { message.warning('No inventory org on the cost row'); return; }
    setOnh(p => ({ ...p, [item]: { loading: true } }));
    try {
      let q = `OrganizationCode=${invOrg};ItemNumber=${item}`; if (subinv) q += `;SubinventoryCode=${subinv}`;
      const r = await fetch(`${FUSION_BASE}/inventoryOnhandBalances?q=${encodeURIComponent(q)}&limit=500`, { headers: getHeaders() });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      const balances: any[] = d.items ?? [];
      // Collect lot-level rows: use LotNumber when present on the balance itself,
      // otherwise follow the balance's lot child link to fetch per-lot detail.
      const lotRows: any[] = [];
      for (const b of balances) {
        if (pf(b, ['LotNumber']) != null) { lotRows.push(b); continue; }
        const child = (b.links ?? []).find((l: any) => l.rel === 'child' && /lot/i.test(l.href || l.name || ''));
        if (child?.href) {
          try {
            const cr = await fetch(`${fusionHref(child.href)}${child.href.includes('?') ? '&' : '?'}limit=500`, { headers: getHeaders() });
            const cd = await cr.json();
            (cd.items ?? []).forEach((x: any) => lotRows.push(x));
          } catch { /* skip this balance's lot detail */ }
        } else { lotRows.push(b); }
      }
      const lots = Array.from(new Set(lotRows.map(x => pf(x, ['LotNumber'])).filter(Boolean))) as string[];
      const matched = lot ? lotRows.filter(x => String(pf(x, ['LotNumber']) ?? '') === String(lot)) : lotRows;
      const qty = (matched.length ? matched : lotRows).reduce((s, x) => s + onhQty(x), 0);
      setOnh(p => ({ ...p, [item]: { qty, lots } }));
    } catch (e: any) { setOnh(p => ({ ...p, [item]: { err: e.message } })); }
  };

  // Changing Ord Qty auto-selects the row so it will be added on "Add".
  const maxQohOf = (item: string) => onh[item]?.qty ?? costs[item]?.onhand;
  const setQty = (item: string, v: number) => {
    const cap = maxQohOf(item);
    if (cap != null && v > cap) { v = cap; message.warning(`Cannot order more than on-hand (${fmtQty(cap)})`); }
    dset(item, { qty: v }); if (v > 0) setSel(s => s.includes(item) ? s : [...s, item]);
  };

  const cols: ColumnsType<any> = [
    { title: 'Item', dataIndex: 'ItemNumber', width: 140, fixed: 'left', render: v => <Text strong style={{ color: REDWOOD.info, fontSize: 12 }}>{v}</Text> },
    { title: 'Description', dataIndex: 'ItemDescription', width: 200, ellipsis: true, render: v => <Text style={{ fontSize: 12 }}>{v ?? '—'}</Text> },
    { title: 'UOM', width: 60, render: (_, r) => pf(r, ['PrimaryUOMValue', 'PrimaryUOMCode', 'PrimaryUnitOfMeasure', 'UOMCode']) ?? '—' },
    { title: 'Lot', width: 120, ellipsis: true, render: (_, r) => { const l = vuOf(r.ItemNumber).lot; return l ? <Tag color="geekblue" style={{ fontSize: 10 }}>{l}</Tag> : '—'; } },
    { title: 'Item Cost', width: 95, align: 'right', render: (_, r) => { const c = costs[r.ItemNumber]; if (costLoading && !c) return <Spin size="small" />; return (c?.cost == null) ? <Text type="secondary" style={{ fontSize: 11 }}>—</Text> : <Text strong style={{ fontSize: 11.5, color: REDWOOD.primary, fontVariantNumeric: 'tabular-nums' }}>{num2(c.cost)}</Text>; } },
    { title: 'O/H (Cost)', width: 82, align: 'right', render: (_, r) => { const c = costs[r.ItemNumber]; if (costLoading && !c) return <Spin size="small" />; return (c?.onhand == null) ? <Text type="secondary" style={{ fontSize: 11 }}>—</Text> : <Text style={{ fontSize: 11, color: REDWOOD.info, fontVariantNumeric: 'tabular-nums' }}>{fmtQty(c.onhand)}</Text>; } },
    { title: 'On-hand', width: 150, render: (_, r) => {
        const item = r.ItemNumber; const p = vuOf(item); const st = onh[item]; const base = costOnhandOf(item);
        const invOrg = org || p.invOrg; const sub = subinv || p.subinv; // prefer the header warehouse/subinventory
        return <Space size={4}>
          <Tooltip title={<span>On-hand — org <b>{invOrg}</b>, item <b>{item}</b>{sub ? <>, subinv <b>{sub}</b></> : null}{p.lot ? <>, lot <b>{p.lot}</b></> : null}</span>}>
            <Button size="small" type="text" icon={<DatabaseOutlined />} style={{ color: REDWOOD.info }} loading={st?.loading} onClick={() => checkOnhand(item, invOrg, sub, p.lot)} /></Tooltip>
          {st?.qty != null && <>
            <Tooltip title={st.lots?.length ? <span>Lots: {st.lots.join(', ')}</span> : 'No lot detail'}><Text style={{ fontSize: 11 }}>{fmtQty(st.qty)}</Text></Tooltip>
            {base != null && (Math.abs(st.qty - base) < 0.001 ? <CheckCircleTwoTone twoToneColor={REDWOOD.success} /> : <CloseCircleTwoTone twoToneColor={REDWOOD.error} />)}
          </>}
          {st?.err && <Tooltip title={st.err}><Text type="danger" style={{ fontSize: 10 }}>err</Text></Tooltip>}
        </Space>;
      } },
    { title: 'Ord Qty', width: 88, render: (_, r) => { const cap = maxQohOf(r.ItemNumber); return <InputNumber size="small" min={0} max={cap != null ? cap : undefined} value={dget(r.ItemNumber).qty} onChange={v => setQty(r.ItemNumber, Number(v) || 0)} style={{ width: 76 }} />; } },
    { title: 'Unit Price', width: 98, render: (_, r) => <InputNumber size="small" min={0} value={dget(r.ItemNumber).price} onChange={v => dset(r.ItemNumber, { price: Number(v) || 0 })} style={{ width: 86 }} /> },
    { title: 'Total', width: 98, align: 'right', render: (_, r) => { const d = dget(r.ItemNumber); return <Text style={{ fontSize: 11.5, fontVariantNumeric: 'tabular-nums' }}>{num2(d.qty * d.price)}</Text>; } },
    { title: 'Margin', width: 98, align: 'right', render: (_, r) => { const d = dget(r.ItemNumber); const m = (d.price - num(costs[r.ItemNumber]?.cost)) * d.qty; return <Text strong style={{ fontSize: 11.5, color: m < 0 ? REDWOOD.error : REDWOOD.success, fontVariantNumeric: 'tabular-nums' }}>{num2(m)}</Text>; } },
    { title: 'Margin %', width: 78, align: 'right', render: (_, r) => { const d = dget(r.ItemNumber); const t = d.qty * d.price; const m = (d.price - num(costs[r.ItemNumber]?.cost)) * d.qty; const pct = t ? (m / t) * 100 : 0; return <Text style={{ fontSize: 11, color: pct < 0 ? REDWOOD.error : REDWOOD.success }}>{t ? pct.toFixed(1) + '%' : '—'}</Text>; } },
    { title: 'Tax Code', width: 130, render: (_, r) => <Select size="small" showSearch allowClear style={{ width: 118 }} popupMatchSelectWidth={false} value={dget(r.ItemNumber).taxCode || undefined} placeholder="—"
        options={taxOptions} optionFilterProp="value" notFoundContent={taxOptions.length ? undefined : 'No tax codes'}
        onChange={val => { const opt = taxOptions.find(o => o.value === val); dset(r.ItemNumber, { taxCode: val, taxPct: opt ? opt.pct : undefined }); }} /> },
    { title: 'Tax Amt', width: 108, align: 'right', render: (_, r) => { const d = dget(r.ItemNumber); return <Space size={4}>{d.taxPct != null && <Tag color="gold" style={{ margin: 0, fontSize: 10 }}>{d.taxPct}%</Tag>}<Text style={{ fontSize: 11.5, fontVariantNumeric: 'tabular-nums' }}>{num2(num(d.tax))}</Text></Space>; } },
    { title: 'Net', width: 108, align: 'right', render: (_, r) => { const d = dget(r.ItemNumber); return <Text strong style={{ fontSize: 12, color: REDWOOD.primary, fontVariantNumeric: 'tabular-nums' }}>{num2(d.qty * d.price + num(d.tax))}</Text>; } },
    { title: 'Cost Org', width: 105, render: (_, r) => <Text style={{ fontSize: 11 }}>{vuOf(r.ItemNumber).costOrg || '—'}</Text> },
    { title: 'Inv Org', width: 95, render: (_, r) => <Text style={{ fontSize: 11 }}>{vuOf(r.ItemNumber).invOrg || '—'}</Text> },
    { title: 'Subinv', width: 85, render: (_, r) => { const s = vuOf(r.ItemNumber).subinv; return s ? <Tag color="cyan" style={{ fontSize: 10 }}>{s}</Tag> : '—'; } },
  ];

  const searchUrlPretty = url ? decodeURIComponent(url) : `${FUSION_BASE}/itemsV2?q=ItemNumber LIKE 'x%';OrganizationCode=${org ?? '<org>'}`;

  const addSelected = () => {
    const picked = rows.filter(r => sel.includes(r.ItemNumber)).map(r => { const d = dget(r.ItemNumber); const p = vuOf(r.ItemNumber); return { ...r, _cost: costs[r.ItemNumber]?.cost, _qty: d.qty, _price: d.price, _taxCode: d.taxCode, _taxPct: d.taxPct, _tax: d.tax, _lot: p.lot, _lots: onh[r.ItemNumber]?.lots, _costOrg: p.costOrg, _invOrg: p.invOrg, _subinv: p.subinv, _qoh: maxQohOf(r.ItemNumber) }; });
    if (!picked.length) { message.warning('Select at least one item'); return; }
    onAdd(picked);
    message.success(`Added ${picked.length} line(s) to the order`);
    setSel([]);
  };
  return (
    <div>
      <Space.Compact style={{ width: '100%', marginBottom: 10 }}>
        <Select value={byDesc ? 'desc' : 'num'} style={{ width: 130 }} onChange={v => setByDesc(v === 'desc')}
          options={[{ value: 'num', label: 'Item Number' }, { value: 'desc', label: 'Description' }]} />
        <Input placeholder={byDesc ? 'e.g. TONER' : 'e.g. SM-A057'} value={term} onChange={e => setTerm(e.target.value)} onPressEnter={search} allowClear />
        <Button type="primary" icon={<SearchOutlined />} loading={loading} onClick={search} style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}>Search</Button>
        <Tooltip title="Web services used"><Button icon={<ApiOutlined />} onClick={() => setApiOpen(true)} /></Tooltip>
      </Space.Compact>
      {error ? <div style={{ color: REDWOOD.error, fontSize: 12, marginBottom: 8 }}><InfoCircleOutlined style={{ marginRight: 6 }} />{error}</div> : null}
      <Table size="small" columns={cols} dataSource={rows} rowKey="ItemNumber" loading={loading}
        rowSelection={{ selectedRowKeys: sel, onChange: setSel }}
        pagination={rows.length > 12 ? { pageSize: 12, size: 'small' } : false} scroll={{ x: 1980, y: 340 }}
        locale={{ emptyText: 'Search for items to add' }} />
      <div style={{ marginTop: 10, display: 'flex', alignItems: 'center' }}>
        <Text type="secondary" style={{ fontSize: 12 }}>{sel.length} selected</Text>
        <Button type="primary" disabled={sel.length === 0} icon={<PlusOutlined />} style={{ marginLeft: 'auto', background: REDWOOD.success, borderColor: REDWOOD.success }}
          onClick={addSelected}>Add {sel.length || ''} line(s) to order</Button>
      </div>

      <Modal open={apiOpen} onCancel={() => setApiOpen(false)} maskClosable={false} width={880}
        title={<Space><ApiOutlined style={{ color: REDWOOD.info }} /> Web services used</Space>}
        footer={<Button onClick={() => setApiOpen(false)}>Close</Button>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[
            { lbl: 'Item search (itemsV2)', u: searchUrlPretty },
            { lbl: 'Item cost — direct by ItemNumber, org via ValuationUnit (itemCosts)', u: `${LATEST_URL}/itemCosts?q=ItemNumber=<item>` },
            { lbl: 'On-hand by subinventory (inventoryOnhandBalances)', u: `${FUSION_BASE}/inventoryOnhandBalances?q=OrganizationCode=${org ?? '<org>'};ItemNumber=<item>;SubinventoryCode=<subinv>` },
            { lbl: 'On-hand lot detail — followed from each balance’s child link', u: '<inventoryOnhandBalance href>/child/... (lot rows)' },
            { lbl: 'Tax codes by business unit (ORDS FUSION_TAX_CODES)', u: `${TAXCODES_URL}?P_BUSINESS_UNIT=<business unit>` },
          ].map(({ lbl, u }) => (
            <div key={lbl}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Text style={{ fontSize: 11, fontWeight: 700, color: REDWOOD.neutral600, textTransform: 'uppercase' }}>{lbl}</Text>
                <Button size="small" type="text" icon={<CopyOutlined />} style={{ marginLeft: 'auto' }} onClick={() => { navigator.clipboard.writeText(u); message.success('Copied'); }}>Copy</Button>
              </div>
              <div style={{ marginTop: 4, padding: '8px 12px', borderRadius: 6, background: REDWOOD.neutral100, border: `1px solid ${REDWOOD.neutral200}`, fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all', color: REDWOOD.info }}>
                <Tag color="blue">GET</Tag>{u}
              </div>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
};

// From Price List — list Fusion price lists (priceLists), load the chosen list's
// items with their BasePrice (priceLists/{id}/child/items?expand=charges), then
// select items + qty and stage them for the order.
const plItemNumber = (it: any) => pf(it, ['Item', 'ItemNumber', 'ProductNumber']);
const plBasePrice = (it: any) => {
  const charges: any[] = it.charges ?? it.Charges ?? [];
  const withPrice = charges.find(c => pf(c, ['BasePrice', 'CalculationAmount', 'ListPrice']) != null) ?? charges[0];
  return num(pf(withPrice ?? {}, ['BasePrice', 'CalculationAmount', 'ListPrice']));
};
const PriceListPanel: React.FC<{ org?: string; ccy?: string; onAdd: (items: any[]) => void }> = ({ org, ccy, onAdd }) => {
  const [priceLists, setPriceLists] = useState<any[]>([]);
  const [plLoading, setPlLoading] = useState(false);
  const [plId, setPlId] = useState<string | undefined>();
  const [items, setItems] = useState<any[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [filter, setFilter] = useState('');
  const [sel, setSel] = useState<React.Key[]>([]);
  const [qtys, setQtys] = useState<Record<string, number>>({});
  const [rows, setRows] = useState<ImpRow[] | null>(null);
  const [searchType, setSearchType] = useState<'number' | 'description'>('number');
  const [searchText, setSearchText] = useState('');
  const [apiDrawerOpen, setApiDrawerOpen] = useState(false);
  const [apiDetails, setApiDetails] = useState<{ priceListsUrl?: string; itemsUrl?: string }>({});
  const pl = priceLists.find(p => String(pf(p, ['PriceListId'])) === plId);
  const plCcy = pf(pl ?? {}, ['CurrencyCode', 'Currency']) ?? ccy;

  const searchPriceLists = async () => {
    if (!searchText.trim()) { message.warning('Enter a search term'); return; }
    setPlLoading(true);
    try {
      let q = '';
      if (searchType === 'number') {
        q = `PriceListNumber=${searchText.trim()}`;
      } else {
        q = `Name=${searchText.trim()}`;
      }
      const priceListsUrl = `${FUSION_BASE}/priceLists?q=${encodeURIComponent(q)}&onlyData=true&limit=500`;
      setApiDetails({ priceListsUrl });

      const r = await fetch(priceListsUrl, { headers: getHeaders() });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setPriceLists(d.items ?? []);
      if (!d.items?.length) message.info('No price lists found');
    } catch (e: any) { message.error(`Price lists search: ${e.message}`); }
    finally { setPlLoading(false); }
  };

  const loadItems = async (id: string) => {
    setItemsLoading(true); setItems([]); setSel([]); setQtys({});
    try {
      const itemsUrl = `${FUSION_BASE}/priceLists/${encodeURIComponent(id)}/child/items?expand=charges&onlyData=true&limit=100`;
      setApiDetails(prev => ({ ...prev, itemsUrl }));

      const all: any[] = []; let offset = 0;
      for (let i = 0; i < 15; i++) {
        const r = await fetch(`${FUSION_BASE}/priceLists/${encodeURIComponent(id)}/child/items?expand=charges&onlyData=true&limit=100&offset=${offset}`, { headers: getHeaders() });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = await r.json(); all.push(...(d.items ?? []));
        if (!d.hasMore) break; offset += 100;
      }
      setItems(all);
      if (!all.length) message.info('This price list has no items');
      else if (all.length >= 1500) message.info('Showing the first 1500 items — use the filter');
    } catch (e: any) { message.error(`Items: ${e.message}`); }
    finally { setItemsLoading(false); }
  };
  const onPickList = (id: string) => { setPlId(id); setRows(null); if (id) loadItems(id); };
  const setQty = (item: string, v: number) => { setQtys(q => ({ ...q, [item]: v })); if (v > 0) setSel(s => s.includes(item) ? s : [...s, item]); };
  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase(); if (!f) return items;
    return items.filter(it => String(plItemNumber(it) ?? '').toLowerCase().includes(f) || String(pf(it, ['Description', 'ItemDescription']) ?? '').toLowerCase().includes(f));
  }, [items, filter]);
  if (rows) return <StagedPreview rows={rows} org={org} ccy={plCcy} onAdd={onAdd} onReset={() => setRows(null)} />;
  const cols: ColumnsType<any> = [
    { title: 'Item', width: 170, render: (_, r) => <Text strong style={{ color: REDWOOD.info, fontSize: 12 }}>{plItemNumber(r) ?? '—'}</Text> },
    { title: 'Description', ellipsis: true, render: (_, r) => <Text style={{ fontSize: 12 }}>{pf(r, ['Description', 'ItemDescription']) ?? '—'}</Text> },
    { title: 'Line Type', width: 90, render: (_, r) => { const t = pf(r, ['LineType']); return t ? <Tag style={{ fontSize: 10 }}>{t}</Tag> : '—'; } },
    { title: 'List Price', width: 120, align: 'right', render: (_, r) => { const p = plBasePrice(r); return p ? <Text strong style={{ color: REDWOOD.primary, fontVariantNumeric: 'tabular-nums' }}>{fmtAmount(p, plCcy)}</Text> : <Text type="secondary" style={{ fontSize: 11 }}>—</Text>; } },
    { title: 'Order Qty', width: 100, render: (_, r) => { const it = plItemNumber(r); return <InputNumber size="small" min={0} value={qtys[it] ?? 0} onChange={v => setQty(it, Number(v) || 0)} style={{ width: 84 }} />; } },
  ];
  return (
    <div>
      {/* Search Type Toggle */}
      <div style={{ marginBottom: '16px' }}>
        <Segmented
          value={searchType}
          onChange={(value) => setSearchType(value as 'number' | 'description')}
          options={[
            { label: 'Price List Number', value: 'number' },
            { label: 'Price List Description', value: 'description' },
          ]}
          size="large"
        />
      </div>

      {/* Search Input with Button and API Icon */}
      <div style={{ marginBottom: '16px', display: 'flex', gap: '12px', alignItems: 'center' }}>
        <Input
          placeholder={searchType === 'number' ? 'Enter price list number...' : 'Enter price list description...'}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          onPressEnter={searchPriceLists}
          prefix={<SearchOutlined style={{ color: '#1890ff' }} />}
          size="large"
          allowClear
          style={{ flex: 1 }}
          disabled={plLoading}
        />
        <Button
          type="primary"
          size="large"
          icon={<SearchOutlined />}
          onClick={searchPriceLists}
          loading={plLoading}
          style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}
        >
          Search
        </Button>
        {(apiDetails.priceListsUrl || apiDetails.itemsUrl) && (
          <Button
            type="text"
            size="large"
            icon={<ApiOutlined style={{ color: '#1890ff' }} />}
            onClick={() => setApiDrawerOpen(true)}
            title="View API Details"
          />
        )}
      </div>

      {/* Price List Dropdown */}
      {priceLists.length > 0 && (
        <div style={{ marginBottom: '16px' }}>
          <Select showSearch style={{ width: '100%' }} loading={plLoading} placeholder="Select a price list" optionFilterProp="label"
            value={plId} onChange={onPickList}
            options={priceLists.map(p => ({ value: String(pf(p, ['PriceListId'])), label: `${pf(p, ['Name', 'PriceListName']) ?? pf(p, ['PriceListId'])}${pf(p, ['CurrencyCode', 'Currency']) ? ` — ${pf(p, ['CurrencyCode', 'Currency'])}` : ''}${pf(p, ['StatusCode', 'Status']) ? ` · ${pf(p, ['StatusCode', 'Status'])}` : ''}` }))}
            notFoundContent={plLoading ? <Spin size="small" /> : 'No price lists'} />
        </div>
      )}

      {/* Item Filter */}
      {pl && <div style={{ marginBottom: '16px' }}><Input allowClear placeholder="Filter items…" prefix={<SearchOutlined />} style={{ width: 220 }} value={filter} onChange={e => setFilter(e.target.value)} /></div>}
      {plCcy && pl && <div style={{ marginBottom: '16px' }}><Tag color="blue">{plCcy}</Tag></div>}

      {/* Space */}
      <Space wrap style={{ marginBottom: 10 }}>
      </Space>
      <Table size="small" columns={cols} dataSource={filtered} rowKey={r => String(plItemNumber(r))} loading={itemsLoading}
        rowSelection={{ selectedRowKeys: sel, onChange: setSel }} pagination={filtered.length > 20 ? { pageSize: 20, size: 'small' } : false} scroll={{ y: 330 }}
        locale={{ emptyText: plId ? 'No items' : 'Select a price list to see its items' }} />
      <div style={{ marginTop: 10, display: 'flex', alignItems: 'center' }}>
        <Text type="secondary" style={{ fontSize: 12 }}>{sel.length} selected · {items.length} item(s) in list</Text>
        <Button type="primary" disabled={!sel.length} icon={<ImportOutlined />} style={{ marginLeft: 'auto', background: REDWOOD.primary, borderColor: REDWOOD.primary }}
          onClick={() => setRows(items.filter(r => sel.includes(String(plItemNumber(r)))).map(r => { const item = String(plItemNumber(r)); return { key: impKey(), itemNumber: item, description: pf(r, ['Description', 'ItemDescription']), qty: qtys[item] || 1, price: plBasePrice(r), valid: true }; }))}>Stage {sel.length || ''} for preview</Button>
      </div>

      {/* API Details Drawer */}
      <Drawer
        title="API Details - Price Lists"
        placement="right"
        onClose={() => setApiDrawerOpen(false)}
        open={apiDrawerOpen}
        width={600}
        bodyStyle={{ padding: '24px' }}
      >
        <Space direction="vertical" style={{ width: '100%' }} size="large">
          {/* Price Lists Search URL */}
          <div>
            <div style={{ fontSize: '14px', fontWeight: '700', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <ApiOutlined />
              Price Lists Search
            </div>
            <div style={{ fontSize: '12px', color: '#666', marginBottom: '8px' }}>
              Searches for price lists by {searchType === 'number' ? 'number' : 'description'}
            </div>
            <div style={{
              backgroundColor: '#f5f5f5',
              padding: '12px',
              borderRadius: '6px',
              fontFamily: 'monospace',
              fontSize: '11px',
              wordBreak: 'break-all',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: '8px'
            }}>
              <span style={{ flex: 1 }}>{apiDetails.priceListsUrl || 'N/A'}</span>
              <Button
                type="text"
                size="small"
                icon={<CopyOutlined />}
                onClick={() => {
                  navigator.clipboard.writeText(apiDetails.priceListsUrl || '');
                  message.success('Copied to clipboard');
                }}
              />
            </div>
          </div>

          <Divider style={{ margin: '16px 0' }} />

          {/* Price List Items URL */}
          {apiDetails.itemsUrl && (
            <>
              <div>
                <div style={{ fontSize: '14px', fontWeight: '700', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <ApiOutlined />
                  Price List Items
                </div>
                <div style={{ fontSize: '12px', color: '#666', marginBottom: '8px' }}>
                  Fetches items from the selected price list
                </div>
                <div style={{
                  backgroundColor: '#f5f5f5',
                  padding: '12px',
                  borderRadius: '6px',
                  fontFamily: 'monospace',
                  fontSize: '11px',
                  wordBreak: 'break-all',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  gap: '8px'
                }}>
                  <span style={{ flex: 1 }}>{apiDetails.itemsUrl}</span>
                  <Button
                    type="text"
                    size="small"
                    icon={<CopyOutlined />}
                    onClick={() => {
                      navigator.clipboard.writeText(apiDetails.itemsUrl || '');
                      message.success('Copied to clipboard');
                    }}
                  />
                </div>
              </div>

              <Divider style={{ margin: '16px 0' }} />
            </>
          )}

          {/* Service Information */}
          <div>
            <div style={{ fontSize: '14px', fontWeight: '700', marginBottom: '8px' }}>Service Information</div>
            <div style={{ fontSize: '12px', color: '#666', lineHeight: '1.8' }}>
              <div><strong>Service:</strong> Oracle Fusion REST API</div>
              <div><strong>Search Type:</strong> {searchType === 'number' ? 'Price List Number' : 'Price List Description'}</div>
              <div><strong>Search Term:</strong> {searchText || 'N/A'}</div>
            </div>
          </div>
        </Space>
      </Drawer>
    </div>
  );
};

// OnhandPanel — fetch all items with on-hand quantities in selected org/subinventory.
const OnhandPanel: React.FC<{ org?: string; subinv?: string; ccy?: string; onAdd: (items: any[]) => void }> = ({ org, subinv, ccy, onAdd }) => {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState<React.Key[]>([]);
  const [qtys, setQtys] = useState<Record<string, number>>({});
  const [rows, setRows] = useState<ImpRow[] | null>(null);
  const [uomMap, setUomMap] = useState<Record<string, { uom?: string; desc?: string }>>({});
  const [searchType, setSearchType] = useState<'itemNumber' | 'description'>('itemNumber');
  const [searchText, setSearchText] = useState('');
  const [filterText, setFilterText] = useState('');
  const [apiDrawerOpen, setApiDrawerOpen] = useState(false);
  const [apiUrl, setApiUrl] = useState('');

  const loadOnhand = useCallback(async (type: 'itemNumber' | 'description', query: string) => {
    if (!org) { message.warning('Select an organization first'); return; }
    if (!query.trim()) { message.warning('Enter a search term'); return; }

    setLoading(true);
    try {
      let q = `OrganizationCode=${org}${subinv ? `;SubinventoryCode=${subinv}` : ''}`;
      const balances: any[] = [];
      let offset = 0;
      let capturedUrl = '';

      if (type === 'itemNumber') {
        q += `;ItemNumber=${query.trim()}`;
        capturedUrl = `${FUSION_BASE}/inventoryOnhandBalances?q=${encodeURIComponent(q)}&onlyData=true&limit=100`;
      } else {
        // For description search, we'll fetch items by description from itemCosts first
        const itemRes = await fetch(`${LATEST_URL}/itemCosts?q=${encodeURIComponent(`ItemDescription=${query.trim()}`)}&onlyData=true&limit=100`, { headers: getHeaders() });
        if (!itemRes.ok) throw new Error(`HTTP ${itemRes.status} searching items`);
        const itemData = await itemRes.json();
        const itemNumbers = (itemData.items ?? []).map((i: any) => pf(i, ['ItemNumber', 'Item'])).filter(Boolean);

        if (itemNumbers.length === 0) {
          setItems([]);
          setUomMap({});
          setSel([]);
          setQtys({});
          return;
        }

        // Capture URL for first item search
        if (itemNumbers.length > 0) {
          const qry = `OrganizationCode=${org}${subinv ? `;SubinventoryCode=${subinv}` : ''};ItemNumber=${itemNumbers[0]}`;
          capturedUrl = `${FUSION_BASE}/inventoryOnhandBalances?q=${encodeURIComponent(qry)}&onlyData=true&limit=100`;
        }

        // Search on-hand for each item number
        await Promise.all(itemNumbers.map(async (itemNum: string) => {
          for (let i = 0; i < 5; i++) {
            const qry = `OrganizationCode=${org}${subinv ? `;SubinventoryCode=${subinv}` : ''};ItemNumber=${itemNum}`;
            const r = await fetch(`${FUSION_BASE}/inventoryOnhandBalances?q=${encodeURIComponent(qry)}&onlyData=true&limit=100&offset=${i * 100}`, { headers: getHeaders() });
            if (!r.ok) return;
            const d = await r.json();
            balances.push(...(d.items ?? []));
            if (!d.hasMore) break;
          }
        }));
      }

      if (type === 'itemNumber') {
        for (let i = 0; i < 5; i++) {
          const r = await fetch(`${FUSION_BASE}/inventoryOnhandBalances?q=${encodeURIComponent(q)}&onlyData=true&limit=100&offset=${i * 100}`, { headers: getHeaders() });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const d = await r.json();
          balances.push(...(d.items ?? []));
          if (!d.hasMore) break;
        }
      }

      // Store captured URL for API drawer
      if (capturedUrl) setApiUrl(capturedUrl);

      // Deduplicate by item number and sum quantities
      const itemMap: Record<string, { item: string; qty: number; subinv?: string }> = {};
      balances.forEach((b: any) => {
        const item = pf(b, ['ItemNumber', 'Item']);
        const qty = num(pf(b, ['PrimaryQuantity', 'QuantityOnhand', 'OnhandQuantity', 'Quantity']));
        const sub = pf(b, ['SubinventoryCode']);
        const key = `${item}:${sub || ''}`;
        if (!itemMap[key]) itemMap[key] = { item: item || '', qty: 0, subinv: sub };
        itemMap[key].qty += qty;
      });

      // Fetch UOM and description for each item from itemCosts
      const itemsArray = Object.values(itemMap);
      const uomData: Record<string, { uom?: string; desc?: string }> = {};
      await Promise.all(itemsArray.map(async (item) => {
        try {
          const r = await fetch(`${LATEST_URL}/itemCosts?q=${encodeURIComponent(`ItemNumber=${item.item}`)}&onlyData=true&limit=1`, { headers: getHeaders() });
          if (r.ok) {
            const d = await r.json();
            const row = d.items?.[0];
            if (row) {
              uomData[item.item] = {
                uom: pf(row, ['UOMName', 'UOMCode']),
                desc: pf(row, ['ItemDescription'])
              };
            }
          }
        } catch { /* skip */ }
      }));

      setItems(itemsArray);
      setUomMap(uomData);
      setSel([]);
      setQtys({});
    } catch (e: any) { message.error(`Failed to load on-hand: ${e.message}`); }
    finally { setLoading(false); }
  }, [org, subinv]);

  const setQty = (item: string, v: number) => { setQtys(q => ({ ...q, [item]: v })); if (v > 0) setSel(s => s.includes(item) ? s : [...s, item]); };

  const filteredItems = useMemo(() => {
    if (!filterText.trim()) return items;
    const lower = filterText.toLowerCase();
    return items.filter(i =>
      i.item.toLowerCase().includes(lower) ||
      uomMap[i.item]?.desc?.toLowerCase().includes(lower) ||
      i.subinv?.toLowerCase().includes(lower)
    );
  }, [items, filterText, uomMap]);

  const cols: ColumnsType<any> = [
    { title: 'Item', width: 110, render: (_, r) => <Text strong style={{ color: REDWOOD.info, fontSize: 12 }}>{r.item}</Text> },
    { title: 'Description', width: 200, ellipsis: true, render: (_, r) => <Text style={{ fontSize: 12 }}>{uomMap[r.item]?.desc || '—'}</Text> },
    { title: 'UOM', width: 70, render: (_, r) => <Text style={{ fontSize: 12 }}>{uomMap[r.item]?.uom || '—'}</Text> },
    { title: 'Subinventory', width: 100, render: (_, r) => <Text style={{ fontSize: 12 }}>{r.subinv || '—'}</Text> },
    { title: 'On-hand Qty', width: 110, align: 'right', render: (_, r) => <Text style={{ fontVariantNumeric: 'tabular-nums' }}>{r.qty}</Text> },
    { title: 'Order Qty', width: 90, render: (_, r) => { const it = r.item; return <InputNumber size="small" min={0} value={qtys[it] ?? 0} onChange={v => setQty(it, Number(v) || 0)} style={{ width: 76 }} />; } },
  ];

  if (rows) return <StagedPreview rows={rows} org={org} ccy={ccy} onAdd={onAdd} onReset={() => setRows(null)} />;
  return (
    <div>
      {/* Search Type Toggle */}
      <div style={{ marginBottom: '16px' }}>
        <Segmented
          value={searchType}
          onChange={(value) => setSearchType(value as 'itemNumber' | 'description')}
          options={[
            { label: 'Item Number', value: 'itemNumber' },
            { label: 'Item Description', value: 'description' },
          ]}
          size="large"
        />
      </div>

      {/* Search Input with Button */}
      <div style={{ marginBottom: '16px', display: 'flex', gap: '12px' }}>
        <Input
          placeholder={searchType === 'itemNumber' ? 'Enter item number...' : 'Enter item description...'}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          onPressEnter={() => loadOnhand(searchType, searchText)}
          prefix={<SearchOutlined style={{ color: '#1890ff' }} />}
          size="large"
          allowClear
          style={{ flex: 1 }}
          disabled={loading}
        />
        <Button
          type="primary"
          size="large"
          icon={<SearchOutlined />}
          onClick={() => loadOnhand(searchType, searchText)}
          loading={loading}
          style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}
        >
          Search
        </Button>
        {apiUrl && (
          <Button
            type="text"
            size="large"
            icon={<ApiOutlined style={{ color: '#1890ff' }} />}
            onClick={() => setApiDrawerOpen(true)}
            title="View API Details"
            style={{ marginLeft: '0px' }}
          />
        )}
      </div>

      {/* Filter Input */}
      {items.length > 0 && (
        <div style={{ marginBottom: '12px' }}>
          <Input
            placeholder="Filter results..."
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            prefix={<SearchOutlined style={{ color: '#1890ff' }} />}
            size="small"
            allowClear
            style={{ maxWidth: '300px' }}
          />
          <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
            Showing {filteredItems.length} of {items.length} items
          </div>
        </div>
      )}

      <Space wrap style={{ marginBottom: 10 }}>
        {items.length > 0 && <Tag color="blue">{items.length} items</Tag>}
      </Space>
      <Table size="small" columns={cols} dataSource={filteredItems} rowKey={r => r.item} loading={loading}
        rowSelection={{ selectedRowKeys: sel, onChange: setSel }} pagination={filteredItems.length > 20 ? { pageSize: 20, size: 'small' } : false} scroll={{ y: 330 }}
        locale={{ emptyText: org ? 'No on-hand items' : 'Select an organization first' }} />
      <div style={{ marginTop: 10, display: 'flex', alignItems: 'center' }}>
        <Text type="secondary" style={{ fontSize: 12 }}>{sel.length} selected · {items.length} item(s)</Text>
        <Button type="primary" disabled={!sel.length} icon={<ImportOutlined />} style={{ marginLeft: 'auto', background: REDWOOD.primary, borderColor: REDWOOD.primary }}
          onClick={() => setRows(items.filter(r => sel.includes(r.item)).map(r => ({ key: impKey(), itemNumber: r.item, description: uomMap[r.item]?.desc || '', UOMCode: uomMap[r.item]?.uom || '', qty: qtys[r.item] || 1, price: 0, valid: true })))}>Stage {sel.length || ''} for preview</Button>
      </div>

      {/* API Details Drawer */}
      <Drawer
        title="API Details"
        placement="right"
        onClose={() => setApiDrawerOpen(false)}
        open={apiDrawerOpen}
        width={600}
        bodyStyle={{ padding: '24px' }}
      >
        {apiUrl ? (
          <Space direction="vertical" style={{ width: '100%' }} size="large">
            {/* On-hand Inventory URL */}
            <div>
              <div style={{ fontSize: '14px', fontWeight: '700', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <ApiOutlined />
                Inventory On-hand Balances
              </div>
              <div style={{
                backgroundColor: '#f5f5f5',
                padding: '12px',
                borderRadius: '6px',
                fontFamily: 'monospace',
                fontSize: '11px',
                wordBreak: 'break-all',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: '8px'
              }}>
                <span style={{ flex: 1 }}>{apiUrl}</span>
                <Button
                  type="text"
                  size="small"
                  icon={<CopyOutlined />}
                  onClick={() => {
                    navigator.clipboard.writeText(apiUrl);
                    message.success('Copied to clipboard');
                  }}
                />
              </div>
            </div>

            <Divider style={{ margin: '16px 0' }} />

            {/* Service Information */}
            <div>
              <div style={{ fontSize: '14px', fontWeight: '700', marginBottom: '8px' }}>Service Information</div>
              <div style={{ fontSize: '12px', color: '#666', lineHeight: '1.8' }}>
                <div><strong>Service:</strong> Oracle Fusion REST API</div>
                <div><strong>Endpoint:</strong> inventoryOnhandBalances</div>
                <div><strong>Search Type:</strong> {searchType === 'itemNumber' ? 'Item Number' : 'Item Description'}</div>
                <div><strong>Search Term:</strong> {searchText || 'N/A'}</div>
                {org && <div><strong>Organization:</strong> {org}</div>}
                {subinv && <div><strong>Subinventory:</strong> {subinv}</div>}
              </div>
            </div>
          </Space>
        ) : (
          <Empty description="No API call made yet. Search for items to view API details." />
        )}
      </Drawer>
    </div>
  );
};

// Add Multiple Lines — tabbed importer (item cost · price list · PDF · Excel/CSV · paste).
const ItemSearchModal: React.FC<{ open: boolean; org?: string; subinv?: string; ccy?: string; taxOptions?: { value: string; label: string; pct: number }[]; onClose: () => void; onAdd: (items: any[]) => void }> = ({ open, org, subinv, ccy, taxOptions = [], onClose, onAdd }) => {
  const [fileSrc, setFileSrc] = useState<'pdf' | 'excel'>('pdf');
  return (
    <Modal open={open} onCancel={onClose} maskClosable={false} width={1280} style={{ top: 14 }}
      title={<Space><ImportOutlined style={{ color: REDWOOD.primary }} /> Add Multiple Lines{org ? <Tag>{org}</Tag> : null}</Space>}
      footer={<Button onClick={onClose}>Close</Button>}>
      <Tabs size="small" defaultActiveKey="cost" items={[
        { key: 'onhand', label: <span><AppstoreOutlined /> On-hand</span>, children: <OnhandPanel open={open} org={org} subinv={subinv} ccy={ccy} onAdd={onAdd} /> },
        { key: 'cost', label: <span><DollarOutlined /> From Item Cost</span>, children: <ItemCostSearch org={org} subinv={subinv} taxOptions={taxOptions} onAdd={onAdd} /> },
        { key: 'price', label: <span><TableOutlined /> From Price List</span>, children: <PriceListPanel org={org} ccy={ccy} onAdd={onAdd} /> },
        { key: 'file', label: <span><FilePdfOutlined /> From PDF / Excel / CSV</span>, children: (
          <div>
            <Space style={{ marginBottom: 12 }}>
              <Button type={fileSrc === 'pdf' ? 'primary' : 'default'} icon={<FilePdfOutlined />} onClick={() => setFileSrc('pdf')} style={fileSrc === 'pdf' ? { background: REDWOOD.primary, borderColor: REDWOOD.primary } : undefined}>PDF</Button>
              <Button type={fileSrc === 'excel' ? 'primary' : 'default'} icon={<FileExcelOutlined />} onClick={() => setFileSrc('excel')} style={fileSrc === 'excel' ? { background: REDWOOD.primary, borderColor: REDWOOD.primary } : undefined}>Excel / CSV</Button>
            </Space>
            {fileSrc === 'pdf' ? <PdfPanel org={org} ccy={ccy} onAdd={onAdd} /> : <ExcelPanel org={org} ccy={ccy} onAdd={onAdd} />}
          </div>
        ) },
        { key: 'paste', label: <span><SnippetsOutlined /> From Copy-Paste</span>, children: <PastePanel org={org} ccy={ccy} onAdd={onAdd} /> },
      ]} />
    </Modal>
  );
};

// Register New Order dialog (collects the header, then opens the creation tab).
const RegisterOrderModal: React.FC<{ open: boolean; onClose: () => void; onProceed: (h: OrderHeader) => void }> = ({ open, onClose, onProceed }) => {
  const auth = useAuth();
  const [form] = Form.useForm();
  const bUnits = usePayablesBUs();
  const orgRows = useInvOrgs();
  const customers = useCustomers();
  const payTermOpts = useOrdsOptions(PAYMENT_TERMS_URL, PAY_TERM_KEYS, PAYMENT_TERMS);
  const salesRepOpts = useOrdsOptions(SALESREPS_URL, SALESREP_KEYS);
  const custOptions = useMemo(() => custOptionList(customers), [customers]);
  const [subs, setSubs] = useState<string[]>([]);
  const [orderTypeOpts, setOrderTypeOpts] = useState<any[]>([]);
  const [orderTypeLookup, setOrderTypeLookup] = useState<Map<string, any>>(new Map());
  const [isBranchSales, setIsBranchSales] = useState(false);
  const [inventoryTransactionFlag, setInventoryTransactionFlag] = useState(true);
  const [branchSalesModalOpen, setBranchSalesModalOpen] = useState(false);
  const [branchForm] = Form.useForm();
  const [custSearchModalOpen, setCustSearchModalOpen] = useState(false);
  const [apiInspectorOpen, setApiInspectorOpen] = useState(false);
  const [apiCalls, setApiCalls] = useState<Array<{ name: string; url: string; timestamp: string }>>([]);
  const instance = getFusionInstance();

  const trackApiCall = (name: string, url: string) => {
    setApiCalls(prev => [...prev, { name, url, timestamp: new Date().toLocaleTimeString() }]);
  };

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    // Start with all fields disabled until Business Unit is selected
    form.setFieldsValue({ orderType: 'LSO01', rate: 1, orderDate: dayjs() });
    setSubs([]);
    setIsBranchSales(false);
    setInventoryTransactionFlag(false);

    // Track webservices that were loaded for this modal
    if (bUnits.length > 0) trackApiCall(`Payables Options (${bUnits.length} BUs)`, `${FUSION_BASE}/payablesOptions`);
    if (orgRows.length > 0) trackApiCall(`Inventory Organizations (${orgRows.length} orgs)`, INV_ORGS_URL);
    if (customers.length > 0) trackApiCall(`Customers (${customers.length} customers)`, `Fusion salesOrders/customers`);
    if (payTermOpts.length > 0) trackApiCall(`Payment Terms (${payTermOpts.length} terms)`, PAYMENT_TERMS_URL);
    if (salesRepOpts.length > 0) trackApiCall(`Sales Reps (${salesRepOpts.length} reps)`, SALESREPS_URL);
  }, [open, form, bUnits.length, orgRows.length, customers.length, payTermOpts.length, salesRepOpts.length]);

  const fetchBranchPoCode = async (lookupCode: string) => {
    const url = `${FUSION_BASE}/standardLookups/ORA_DOO_ORDER_TYPES/child/lookupCodes/${lookupCode}/child/lookupsDFF`;
    trackApiCall(`Branch PO Code (${lookupCode})`, url);
    try {
      const res = await fetch(url, { headers: getHeaders() });
      if (res.ok) {
        const data = await res.json();
        return data.items?.[0]?.branchPoCode || '';
      }
      return '';
    } catch (err) {
      console.warn(`Failed to fetch branch PO code for ${lookupCode}:`, err);
      return '';
    }
  };

  const fetchOrderTypes = () => {
    setOrderTypeOpts([]);
    const url = `${FUSION_BASE}/standardLookups?q=LookupType LIKE 'ORA_DOO_ORDER_TYPES%'&expand=lookupCodes&onlyData=true&limit=500`;
    trackApiCall('Order Types (standardLookups)', url);
    fetch(url, { headers: getHeaders() })
      .then(r => {
        if (!r.ok) {
          return r.text().then(text => {
            throw new Error(`HTTP ${r.status}: ${text.substring(0, 200)}`);
          });
        }
        return r.json();
      })
      .then(async (d) => {
        const items = d.items ?? [];
        if (items.length > 0 && items[0].lookupCodes) {
          const lookupMap = new Map<string, any>();
          const opts = items[0].lookupCodes
            .filter((lc: any) => lc.EnabledFlag === 'Y')
            .map((lc: any) => {
              lookupMap.set(lc.LookupCode, lc);
              const isBranch = lc.Tag === 'BRANCH SALES';
              return {
                value: lc.LookupCode,
                sortKey: lc.Meaning,
                label: isBranch ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>{lc.Meaning}</span>
                    <Tag color="orange" style={{ fontSize: '11px', margin: 0 }}>BRANCH SALES</Tag>
                  </div>
                ) : lc.Meaning
              };
            })
            .sort((a: any, b: any) => (a.sortKey || '').localeCompare(b.sortKey || ''))
            .map(({ sortKey, ...rest }: any) => rest);

          // Fetch branch PO codes for BRANCH SALES order types
          for (const lc of items[0].lookupCodes) {
            if (lc.EnabledFlag === 'Y' && lc.Tag === 'BRANCH SALES') {
              const branchPoCode = await fetchBranchPoCode(lc.LookupCode);
              if (branchPoCode) {
                lookupMap.get(lc.LookupCode)!.branchPoCode = branchPoCode;
              }
            }
          }

          setOrderTypeOpts(opts);
          setOrderTypeLookup(lookupMap);
          message.success('✓ Order types refreshed');
        }
      })
      .catch(err => {
        console.error('Error fetching order types:', err);
        message.error(`Failed to fetch order types: ${err.message}`);
        setOrderTypeOpts([]);
      });
  };

  useEffect(() => {
    if (!open) return;
    fetchOrderTypes();
  }, [open]);

  const onCustomer = (name: string, opt: any) => {
    const row = opt?._c ?? customers.find(c => custName(c) === name);
    if (row) form.setFieldsValue(customerFill(row));
  };

  const onCustomerBipSelect = (customer: CustomerSearchResult) => {
    const fill = convertBipCustomerToFill(customer);
    form.setFieldsValue(fill);
  };

  const buName = Form.useWatch('businessUnit', form);
  const buRow = useMemo(() => bUnits.find(b => b.businessUnitName === buName), [bUnits, buName]);
  const whOptions = useMemo(() => orgOptionsForBU(orgRows, buRow), [orgRows, buRow]);

  const onBU = (name: string) => {
    const row = bUnits.find(b => b.businessUnitName === name);
    const cur = pf(row, ['paymentCurrency', 'ledgerCurrency', 'invoiceCurrency']);
    form.setFieldsValue({ baseCurrency: cur, txnCurrency: form.getFieldValue('txnCurrency') || cur, warehouse: undefined, subinventory: undefined });
    setSubs([]);
  };
  const onWarehouse = (code: string) => {
    form.setFieldsValue({ subinventory: undefined }); setSubs([]);
    const url = `${FUSION_BASE}/subinventories?q=OrganizationCode=${encodeURIComponent(code)}&onlyData=true&limit=500`;
    trackApiCall(`Subinventories (${code})`, url);
    fetch(url, { headers: getHeaders() })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => setSubs(Array.from(new Set((d.items ?? []).map((s: any) => s.SecondaryInventoryName).filter(Boolean))).sort() as string[])).catch(() => setSubs([]));
  };
  const onTxnCurrencyChange = async (frm: any) => {
    const baseCcy = frm.getFieldValue('baseCurrency');
    const txnCcy = frm.getFieldValue('txnCurrency');
    const orderDate = frm.getFieldValue('orderDate');

    // Set default rate type and date
    frm.setFieldsValue({
      currencyRateType: 'User',
      currencyDate: orderDate || dayjs()
    });

    // If same currency, set rate to 1
    if (!baseCcy || !txnCcy || baseCcy === txnCcy) {
      frm.setFieldsValue({ rate: 1 });
      return;
    }

    // Fetch conversion rate from daily rates webservice (txn → base)
    try {
      const params = new URLSearchParams({ from_currency: txnCcy, to_currency: baseCcy });
      const url = `${buildCurrencyUrl('currencies/dailyrates')}?${params}`;
      trackApiCall(`Currency Conversion (${txnCcy} → ${baseCcy})`, url);
      const res = await fetch(url);

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = (await res.text()).replace(/:\s*(-?)\.(\d)/g, ': $10.$2');
      const json = JSON.parse(raw);
      const items: any[] = json.items ?? json.data ?? (Array.isArray(json) ? json : []);

      if (items.length === 0) {
        message.info(`No rate found for ${txnCcy} → ${baseCcy}, please enter manually`);
        return;
      }

      // Pick the most recent date
      const latest = items.reduce((a: any, b: any) =>
        (a.rateDate ?? a.rate_date ?? '') > (b.rateDate ?? b.rate_date ?? '') ? a : b
      );
      const rate = Number(latest.rate ?? latest.RATE ?? 0);
      if (rate > 0) {
        frm.setFieldsValue({ rate });
        message.success(`✓ Conversion rate fetched: 1 ${txnCcy} = ${rate} ${baseCcy}`);
      } else {
        message.info(`Could not get valid rate for ${txnCcy} → ${baseCcy}, please enter manually`);
      }
    } catch (err) {
      console.error('Error fetching conversion rate:', err);
      message.warning('Could not fetch conversion rate automatically, please enter manually');
    }
  };

  const onOrderTypeChange = (orderTypeCode: string) => {
    const lookupDetail = orderTypeLookup.get(orderTypeCode);
    const isBranch = lookupDetail && lookupDetail.Tag === 'BRANCH SALES';
    setIsBranchSales(isBranch);
    if (isBranch) {
      const branchPoCode = lookupDetail?.branchPoCode || '';
      const msg = branchPoCode
        ? `⚠️ Branch Sales order (PO Prefix: ${branchPoCode}). Additional branch details will be required after saving.`
        : '⚠️ This is a Branch Sales order. Additional branch details will be required after saving.';
      message.info(msg);
    }
  };

  const submit = () => form.validateFields().then(() => {
    // Validate subinventory is required when inventoryTransactionFlag is true
    const all = form.getFieldsValue(true);
    if (inventoryTransactionFlag && isBranchSales && !all.subinventory) {
      message.error('Subinventory is required for inventory transactions');
      return;
    }
    // getFieldsValue(true) keeps values set via setFieldsValue that have no
    // Form.Item (customer ids, sites, addresses); add the BU id from its row.
    const bu = bUnits.find(b => b.businessUnitName === all.businessUnit);
    onProceed({ ...all, businessUnitId: bu?.businessUnitId, inventoryTransactionFlag });
    onClose();
  }).catch(() => { /* show errors */ });

  const req = (msg: string) => [{ required: true, message: msg }];
  const Section: React.FC<{ icon: React.ReactNode; title: string; color: string; children: React.ReactNode }> = ({ icon, title, color, children }) => (
    <div style={{ border: `1px solid ${REDWOOD.neutral200}`, borderRadius: 10, padding: '10px 14px 0px', marginBottom: 10, background: REDWOOD.surface }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ width: 24, height: 24, borderRadius: 6, background: color + '18', color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>{icon}</span>
        <Text strong style={{ fontSize: 11, color: REDWOOD.neutral900, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{title}</Text>
        <div style={{ flex: 1, height: 1, background: `linear-gradient(90deg, ${color}33, transparent)` }} />
      </div>
      <Row gutter={12}>{children}</Row>
    </div>
  );
  return (
    <>
      <Modal open={open} onCancel={onClose} maskClosable={false} width={960} styles={{ body: { background: REDWOOD.neutral100, padding: 12, maxHeight: 'calc(100vh - 140px)', overflowY: 'auto' } }}
      title={<div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 38, height: 38, borderRadius: 10, background: `linear-gradient(135deg, ${REDWOOD.primary}, ${REDWOOD.primary}bb)`, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, boxShadow: `0 3px 10px ${REDWOOD.primary}40` }}><PlusOutlined /></span>
          <div><div style={{ fontSize: 16, fontWeight: 700, color: REDWOOD.neutral900 }}>Register New Order</div>
            <div style={{ fontSize: 12, color: REDWOOD.neutral600, fontWeight: 400 }}>Set the order header, then proceed to add lines</div></div>
        </div>
        <Button type="text" size="small" icon={<ApiOutlined />} onClick={() => setApiInspectorOpen(true)} title="View API calls" style={{ color: REDWOOD.info }} />
      </div>}
      footer={<Space><Button onClick={onClose}>Cancel</Button>
        <Button type="primary" icon={<ExportOutlined />} style={{ background: REDWOOD.info, borderColor: REDWOOD.info }} onClick={submit}>Proceed to Lines</Button></Space>}>
      <Form form={form} layout="vertical" size="small" requiredMark colon={false}>
        {isBranchSales && (() => {
          const selectedOrderType = form.getFieldValue('orderType');
          const orderTypeDetail = orderTypeLookup.get(selectedOrderType);
          const branchPoCode = orderTypeDetail?.branchPoCode || '—';
          const orderTypeName = orderTypeDetail?.Meaning || selectedOrderType;
          return (
            <div style={{
              background: '#fff7e6',
              border: `2px solid ${REDWOOD.warning}`,
              borderRadius: 8,
              padding: '12px 16px',
              marginBottom: 16,
              display: 'flex',
              alignItems: 'center',
              gap: 12
            }}>
              <ShoppingOutlined style={{ fontSize: 20, color: REDWOOD.warning }} />
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: REDWOOD.warning }}>🔖 BRANCH SALES ORDER ({orderTypeName})</div>
                <div style={{ fontSize: 12, color: REDWOOD.neutral600, marginTop: 2 }}>After saving, you'll be prompted to create a linked Purchase Order with <strong>{branchPoCode}</strong>- prefix</div>
              </div>
            </div>
          );
        })()}
        <Section icon={<BankOutlined />} title="Order Details" color={REDWOOD.primary}>
          <Col xs={24} md={15}><Form.Item label="Business Unit" name="businessUnit" rules={req('Select business unit')} style={{ marginBottom: 8 }}>
            <Select showSearch placeholder="Select" size="small" onChange={onBU} optionFilterProp="label"
              options={bUnits.map(b => ({ value: b.businessUnitName, label: `${b.businessUnitName}${b.paymentCurrency ? ` — ${b.paymentCurrency}` : ''}` }))} /></Form.Item></Col>
          <Col xs={12} md={5}><Form.Item label="Base Ccy" name="baseCurrency" rules={req('Base currency')} style={{ marginBottom: 8 }}><Input placeholder="AED" readOnly size="small" /></Form.Item></Col>
          <Col xs={12} md={5}><Form.Item label="Txn Ccy" name="txnCurrency" rules={req('Currency')} style={{ marginBottom: 8 }}>
            <Select showSearch disabled={!buName} placeholder="Currency" size="small" onChange={() => onTxnCurrencyChange(form)} options={CURRENCIES.map(c => ({ value: c, label: c }))} /></Form.Item></Col>
          <Col xs={12} md={5}><Form.Item label="Rate" name="rate" style={{ marginBottom: 8 }}><InputNumber disabled={!buName} style={{ width: '100%' }} size="small" min={0} placeholder="Auto-populated" /></Form.Item></Col>
          <Col xs={12} md={5}><Form.Item label="Rate Type" name="currencyRateType" style={{ marginBottom: 8 }}>
            <Select disabled={!buName} placeholder="Rate type" size="small" options={[{ value: 'Corporate', label: 'Corporate' }, { value: 'Spot', label: 'Spot' }, { value: 'User', label: 'User' }]} /></Form.Item></Col>
          <Col xs={12} md={5}><Form.Item label="Currency Date" name="currencyDate" style={{ marginBottom: 8 }}><DatePicker disabled={!buName} style={{ width: '100%' }} size="small" /></Form.Item></Col>
          <Col xs={12} md={7}><Form.Item label={<div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}><span>Order Type</span><Button type="text" size="small" icon={<ReloadOutlined />} onClick={fetchOrderTypes} title="Refresh order types" style={{ padding: '2px 4px', height: 'auto' }} /></div>} name="orderType" rules={req('Order type')} style={{ marginBottom: 8 }}>
            <Select showSearch disabled={!buName} placeholder="Select order type" size="small" loading={orderTypeOpts.length === 0} onChange={onOrderTypeChange} options={orderTypeOpts} /></Form.Item></Col>
          <Col xs={12} md={5}><Form.Item label="Order Date" name="orderDate" rules={req('Order date')} style={{ marginBottom: 8 }}><DatePicker disabled={!buName} style={{ width: '100%' }} size="small" /></Form.Item></Col>
          {isBranchSales && (
            <Col xs={12} md={12}><Form.Item label="Branch Business Unit" name="branchBU" rules={req('Branch BU')} style={{ marginBottom: 0 }}>
              <Select showSearch disabled={!buName} placeholder="Select Branch BU" size="small" optionFilterProp="label"
                options={bUnits.map(b => ({ value: b.businessUnitName, label: `${b.businessUnitName}${b.paymentCurrency ? ` — ${b.paymentCurrency}` : ''}` }))} /></Form.Item></Col>
          )}
        </Section>

        <Section icon={<ProfileOutlined />} title="Customer" color={REDWOOD.info}>
          <Col xs={24} md={16}><Form.Item label="Customer Name" name="customerName" rules={req('Customer')} style={{ marginBottom: 8, display: 'flex', alignItems: 'flex-end', gap: 8 }}>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, opacity: !buName ? 0.5 : 1, pointerEvents: !buName ? 'none' : 'auto' }}>
              <Input placeholder={buName ? "Select a customer..." : "Select BU first"} value={form.getFieldValue('customerName')} readOnly style={{ flex: 1, fontSize: '14px', fontWeight: '500' }} disabled={!buName} />
              <Button type="primary" icon={<SearchOutlined />} onClick={() => setCustSearchModalOpen(true)} disabled={!buName} title={buName ? "Search Customer" : "Select BU first"} />
            </div>
          </Form.Item></Col>
          <Col xs={24} md={8}><Form.Item label="Account #" name="accountNumber" style={{ marginBottom: 8 }}><Input placeholder="—" readOnly size="small" /></Form.Item></Col>
          <input type="hidden" name="billToSite" value={form.getFieldValue('billToSite')} />
          <input type="hidden" name="shipToSite" value={form.getFieldValue('shipToSite')} />
          <Col xs={24} md={12}><Form.Item label="Bill To Address" name="billToAddress" style={{ marginBottom: 8 }}><Input.TextArea rows={1} readOnly size="small" style={{ fontSize: '12px' }} /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item label="Ship To Address" name="shipToAddress" style={{ marginBottom: 0 }}><Input.TextArea rows={1} readOnly size="small" style={{ fontSize: '12px' }} /></Form.Item></Col>
        </Section>

        <Section icon={<ShoppingOutlined />} title="Terms & Fulfillment" color={REDWOOD.purple}>
          <Col xs={12} md={6}><Form.Item label="Payment Terms" name="paymentTerms" rules={req('Payment terms')} style={{ marginBottom: 8 }}>
            <Select showSearch disabled={!buName} placeholder="Terms" size="small" optionFilterProp="label" options={payTermOpts} /></Form.Item></Col>
          <Col xs={12} md={6}><Form.Item label="Sales Rep" name="salesRep" style={{ marginBottom: 8 }}>
            <Select showSearch disabled={!buName} allowClear placeholder="Salesperson" size="small" optionFilterProp="label" options={salesRepOpts} notFoundContent={salesRepOpts.length ? 'No match' : 'Loading…'} /></Form.Item></Col>
          <Col xs={12} md={6}><Form.Item label={<WarehouseLabel />} name="warehouse" rules={req('Warehouse')} style={{ marginBottom: 8 }}>
            <Select showSearch disabled={!buName} placeholder={buName ? 'Organization' : 'Select BU first'} size="small" onChange={onWarehouse} options={whOptions} optionFilterProp="label" /></Form.Item></Col>
          <Col xs={12} md={6}><Form.Item label="Sub Inventory" name="subinventory" rules={inventoryTransactionFlag && isBranchSales ? req('Subinventory required for inventory transactions') : undefined} style={{ marginBottom: 8 }}>
            <Select showSearch disabled={!buName} placeholder="Subinventory" size="small" notFoundContent="Pick a warehouse" options={subs.map(s => ({ value: s, label: s }))} /></Form.Item></Col>
          <Col xs={12} md={6}><Form.Item label={<Tooltip title="Enable only if your Fusion instance is configured for direct inventory transactions with appropriate orchestration tasks"><span>Inventory Transaction</span></Tooltip>} name="inventoryTransactionFlag" style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={inventoryTransactionFlag} onChange={(e) => setInventoryTransactionFlag(e.target.checked)} style={{ cursor: 'pointer' }} />
              <span style={{ fontSize: 12, color: inventoryTransactionFlag ? REDWOOD.primary : REDWOOD.neutral600 }}>{inventoryTransactionFlag ? 'Direct inventory transaction' : 'Standard fulfillment (recommended)'}</span>
            </div>
          </Form.Item></Col>
          <Col xs={24}><Form.Item label="Remarks" name="remarks" style={{ marginBottom: 0 }}><Input.TextArea disabled={!buName} rows={1} placeholder="Optional notes…" size="small" /></Form.Item></Col>
        </Section>
      </Form>
    </Modal>

    {/* API Inspector Modal */}
    <Modal
      title={<Space><ApiOutlined style={{ color: REDWOOD.info }} /><span>API Inspector — Register New Order</span></Space>}
      open={apiInspectorOpen}
      onCancel={() => setApiInspectorOpen(false)}
      footer={null}
      width={800}
      bodyStyle={{ maxHeight: 'calc(100vh - 200px)', overflowY: 'auto' }}
    >
      {apiCalls.length === 0 ? (
        <Empty description="No API calls tracked yet" style={{ marginTop: 20 }} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {apiCalls.map((call, idx) => (
            <Card key={idx} size="small" style={{ background: REDWOOD.neutral100 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: REDWOOD.neutral900, marginBottom: 6 }}>{call.name}</div>
                  <div style={{ fontSize: 11, fontFamily: 'monospace', color: REDWOOD.neutral600, wordBreak: 'break-all', marginBottom: 6 }}>{call.url}</div>
                  <div style={{ fontSize: 10, color: REDWOOD.neutral500 }}>📍 {call.timestamp}</div>
                </div>
                <Button
                  type="text"
                  size="small"
                  icon={<CopyOutlined />}
                  onClick={() => {
                    navigator.clipboard.writeText(call.url);
                    message.success('URL copied');
                  }}
                />
              </div>
            </Card>
          ))}
        </div>
      )}
    </Modal>

    <CustomerSearchBipModal
      open={custSearchModalOpen}
      onClose={() => setCustSearchModalOpen(false)}
      onSelect={onCustomerBipSelect}
      businessUnitId={buRow?.businessUnitId?.toString()}
      businessUnitName={buName}
      soapBaseUrl={`${getFusionInstanceUrl() || getFusionInstance().host}/xmlpserver/services/v2/ReportService`}
      username={auth.user?.username}
      password={localStorage.getItem('fusion_password')}
    />
  </>
  );
};

// New order creation tab — header summary + editable lines + save.
// ── Sales-order draft: Save/Load the full on-screen state as JSON ────────────
// Captures the header plus every line (item, qty, price, cost, lots, on-hand,
// tax) so a draft round-trips exactly. Tolerant loader accepts a bare
// { header, lines } too.
const SO_DRAFT_TYPE = 'reacterp.salesOrderDraft';
interface SoDraft { header: OrderHeader; lines: NewLine[]; discAmt?: number; expAmt?: number; defaultTaxCode?: string }
const downloadJson = (obj: any, filename: string) => {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
const readJsonFile = (file: File): Promise<any> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => { try { resolve(JSON.parse(String(reader.result))); } catch { reject(new Error('Not valid JSON')); } };
  reader.onerror = () => reject(new Error('Could not read file'));
  reader.readAsText(file);
});
// Save the create-order response (success or failure) to a local folder instead
// of showing the raw JSON on screen. Electron-only; a no-op in the browser.
const ORDER_LOG_FOLDER = 'c:/fusionclient/orderloading';
const saveOrderLog = async (filename: string, content: string): Promise<string | null> => {
  const api = (window as any).electronAPI;
  if (!api?.saveFileToFolder) return null;
  try {
    const bytes = new TextEncoder().encode(content);
    const res = await api.saveFileToFolder(bytes, ORDER_LOG_FOLDER, filename);
    return res?.success ? (res.filePath ?? `${ORDER_LOG_FOLDER}/${filename}`) : null;
  } catch { return null; }
};
// Collect individual error lines from a DOO response (title, o:errorDetails,
// or the raw text on a hard failure), split into one message per line.
const collectOrderErrors = (data: any, text: string, includeRawText: boolean): string[] => {
  const out: string[] = [];
  if (data && typeof data === 'object') {
    if (data.title) out.push(String(data.title));
    if (data.detail && data.detail !== data.title) out.push(String(data.detail));
    const details = data['o:errorDetails'] ?? data.errorDetails;
    if (Array.isArray(details)) details.forEach((d: any) => { const m = d?.detail ?? d?.title; if (m) out.push(String(m)); });
  }
  if (!out.length && includeRawText && text) out.push(text.trim());
  return out.flatMap(s => s.split('\n')).map(s => s.trim()).filter(Boolean);
};
// Split error messages into per-line (keyed by NewLine.key) and general buckets,
// matching on "SourceTransactionLineNumber N" (which Fusion embeds in messages).
const mapErrorsToLines = (msgs: string[], lines: NewLine[]): { byKey: Record<string, string[]>; general: string[] } => {
  const byKey: Record<string, string[]> = {};
  const general: string[] = [];
  msgs.forEach(msg => {
    const m = msg.match(/SourceTransactionLineNumber\s+["']?(\w+)/i);
    const lineNo = m ? m[1] : null;
    const target = lineNo ? lines.find((l, i) => String(l.srcLineNumber ?? (i + 1)) === lineNo) : undefined;
    if (target) (byKey[target.key] ??= []).push(msg);
    else general.push(msg);
  });
  return { byKey, general };
};

// Pull a readable error message out of a DOO error response.
const extractOrderError = (data: any, status: number, text: string): string => {
  if (data && typeof data === 'object') {
    const parts: string[] = [];
    if (data.title) parts.push(String(data.title));
    if (data.detail && data.detail !== data.title) parts.push(String(data.detail));
    const details = data['o:errorDetails'] ?? data.errorDetails;
    if (Array.isArray(details)) details.forEach((d: any) => { const m = d?.detail ?? d?.title; if (m) parts.push(String(m)); });
    if (parts.length) return parts.join('\n');
  }
  return (text || '').trim().slice(0, 3000) || `HTTP ${status}`;
};

const toSoDraft = (raw: any): SoDraft | null => {
  if (!raw || typeof raw !== 'object') return null;
  const header = raw.header ?? raw.Header ?? raw.hdr;
  const lines = raw.lines ?? raw.Lines;
  if (!header && !Array.isArray(lines)) return null;
  return {
    header: (header ?? {}) as OrderHeader,
    lines: Array.isArray(lines) ? lines : [],
    discAmt: Number(raw.discAmt) || 0,
    expAmt: Number(raw.expAmt) || 0,
  };
};

// Return reasons (Fusion DOO_RETURN_REASON lookup — loaded live at runtime;
// this is the fallback list). ORA_QTY_CHANGE is a confirmed seeded code.
const RETURN_REASONS = [
  { value: 'ORA_QTY_CHANGE', label: 'Quantity change' },
  { value: 'ORA_DAMAGED', label: 'Damaged item' },
  { value: 'ORA_DEFECTIVE', label: 'Defective item' },
  { value: 'ORA_WRONG_ITEM', label: 'Wrong item shipped' },
  { value: 'ORA_NOT_REQUIRED', label: 'No longer required' },
];
const DEFAULT_RETURN_REASON = 'ORA_QTY_CHANGE';
const RETURN_REASON_LOV = `${FUSION_BASE}/standardLookupsLOV?finder=LookupTypeFinder;LookupType=DOO_RETURN_REASON&onlyData=true&limit=200`;

// Map a Fusion order line (…/child/lines) to a NewLine for copy or return.
const orderLineToNewLine = (l: any, i: number, opts: { asReturn?: boolean; refOrderNumber?: string; refHeaderId?: any } = {}): NewLine => {
  const qty = num(l.OrderedQuantity);
  const price = num(l.UnitSellingPrice ?? l.UnitListPrice ?? l.UnitPrice);
  const base: NewLine = {
    key: `${opts.asReturn ? 'r' : 'c'}${i}-${Math.random().toString(36).slice(2, 8)}`,
    itemNumber: l.ProductNumber ?? l.ItemNumber ?? '',
    description: l.ProductDescription ?? l.ItemDescription ?? l.ProductDescriptionText,
    uom: l.OrderedUOMCode ?? l.OrderedUOM,
    qty, unitPrice: price,
  };
  if (!opts.asReturn) return base;
  return {
    ...base,
    returnLine: true, maxQty: qty, returnReason: DEFAULT_RETURN_REASON,
    refOrderNumber: opts.refOrderNumber,
    refHeaderId: opts.refHeaderId ?? l.HeaderId,
    refLineId: l.LineId ?? l.SourceTransactionLineId,
    refFulfillLineId: l.FulfillLineId,
    refLineNumber: l.DisplayLineNumber ?? l.LineNumber ?? (i + 1),
  };
};

// ── Sales credits (order salesCredits child) — shared by the header salesperson
//    display and the Sales Credits tab so both stay in sync.
type ScEdit = { href?: string; salesRep?: string; percent: number } | null;
const scSelfHref = (o: any) => { const h = (o?.links ?? []).find((x: any) => x.rel === 'self' || x.name === 'self')?.href; return h ? fusionHref(h) : ''; };
const scName = (r: any) => pf(r, ['Salesperson', 'SalespersonName']) ?? (pf(r, ['SalespersonId']) != null ? `#${pf(r, ['SalespersonId'])}` : '—');
const useSalesCredits = (orderKey?: string) => {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const reload = useCallback(async () => {
    if (!orderKey) { setRows([]); return; }
    setLoading(true);
    try {
      const r = await fetch(`${FUSION_BASE}/salesOrdersForOrderHub/${encodeURIComponent(orderKey)}/child/salesCredits?limit=100`, { headers: getHeaders() });
      const d = await r.json().catch(() => ({} as any));
      setRows(d.items ?? []);
    } catch { setRows([]); } finally { setLoading(false); }
  }, [orderKey]);
  useEffect(() => { reload(); }, [reload]);
  return { rows, loading, reload };
};

// The Add / Edit Sales Credit dialog (POST or PATCH salesCredits). Shared.
const SalesCreditEditModal: React.FC<{ editing: ScEdit; orderKey: string; salesRepOpts: SalesRepOpt[]; onClose: () => void; onSaved: () => void }> = ({ editing, orderKey, salesRepOpts, onClose, onSaved }) => {
  const base = `${FUSION_BASE}/salesOrdersForOrderHub/${encodeURIComponent(orderKey)}/child/salesCredits`;
  const [local, setLocal] = useState<ScEdit>(editing);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { setLocal(editing); setErr(''); }, [editing]);
  const save = async () => {
    if (!local) return;
    const rid = salesRepOpts.find(o => o.value === local.salesRep)?.id;
    const edit = !!local.href;
    const body: any = edit
      ? { ...(local.salesRep ? { Salesperson: local.salesRep } : {}), ...(rid != null ? { SalespersonId: rid } : {}), Percent: num(local.percent) }
      : { SourceTransactionSalesCreditIdentifier: `SC-${orderKey}-1`, ...(rid != null ? { SalespersonId: rid } : {}), Salesperson: local.salesRep, SalesCreditTypeId: 1, Percent: num(local.percent) };
    const url = edit ? local.href! : base;
    setBusy(true); setErr('');
    try {
      const r = await fetch(url, { method: edit ? 'PATCH' : 'POST', headers: { ...getHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const t = await r.text();
      if (!r.ok) throw new Error([`${edit ? 'PATCH' : 'POST'} ${url}`, `HTTP ${r.status}`, ...collectOrderErrors(null, t, true)].join('\n'));
      message.success(edit ? 'Sales credit updated' : 'Sales credit added'); onSaved();
    } catch (e: any) { setErr(e?.message || 'Save failed'); message.error('Sales credit save failed'); } finally { setBusy(false); }
  };
  return (
    <Modal open={!!editing} onCancel={() => !busy && onClose()} width={480}
      title={<Space><TagsOutlined style={{ color: REDWOOD.primary }} />{local?.href ? 'Edit' : 'Add'} Sales Credit</Space>}
      footer={<Space><Button onClick={onClose} disabled={busy}>Cancel</Button><Button type="primary" loading={busy} icon={<SaveOutlined />} onClick={save} disabled={!local?.salesRep}>Save</Button></Space>}>
      {local && <div>
        <div style={{ marginBottom: 6, fontSize: 12, color: REDWOOD.neutral600 }}>Salesperson</div>
        <Select showSearch allowClear style={{ width: '100%', marginBottom: 12 }} placeholder="Select salesperson" optionFilterProp="label"
          value={local.salesRep} options={salesRepOpts} onChange={v => setLocal({ ...local, salesRep: v })} notFoundContent={salesRepOpts.length ? 'No match' : 'Loading…'} />
        <div style={{ marginBottom: 6, fontSize: 12, color: REDWOOD.neutral600 }}>Percent</div>
        <InputNumber min={0} max={100} style={{ width: '100%' }} value={local.percent} onChange={v => setLocal({ ...local, percent: Number(v) || 0 })} addonAfter="%" />
        {err && <div style={{ marginTop: 10, fontSize: 11, color: REDWOOD.error, whiteSpace: 'pre-wrap', background: '#FFF1F0', border: '1px solid #FFCCC7', borderRadius: 6, padding: '8px 10px', maxHeight: 160, overflow: 'auto' }}>{err}</div>}
      </div>}
    </Modal>
  );
};

// Presentational Sales Credits tab — data + actions come from the parent.
const SalesCreditsPanel: React.FC<{ rows: any[]; loading: boolean; onReload: () => void; onAdd: () => void; onEdit: (row: any) => void; onDelete: (row: any) => void }> = ({ rows, loading, onReload, onAdd, onEdit, onDelete }) => {
  const total = rows.reduce((s, r) => s + num(pf(r, ['Percent'])), 0);
  return (
    <div style={{ padding: '6px 4px' }}>
      <Space style={{ marginBottom: 10 }}>
        <Button size="small" type="primary" icon={<PlusOutlined />} onClick={onAdd}>Add Sales Credit</Button>
        <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={onReload}>Refresh</Button>
        <Tag color={round2(total) === 100 ? 'green' : 'orange'}>Total {total}%</Tag>
        {round2(total) !== 100 && rows.length > 0 && <Text type="warning" style={{ fontSize: 12 }}>Quota credits should total 100%</Text>}
      </Space>
      <Table size="small" rowKey={(r) => String(pf(r, ['SalesCreditId']) ?? Math.random())} pagination={false} loading={loading} dataSource={rows}
        locale={{ emptyText: 'No sales credits on this order' }}
        columns={[
          { title: 'Salesperson', render: (_: any, r: any) => <Text strong style={{ fontSize: 12 }}>{scName(r)}</Text> },
          { title: 'Type', width: 160, render: (_: any, r: any) => <Text style={{ fontSize: 12 }}>{pf(r, ['SalesCreditType']) ?? (num(pf(r, ['SalesCreditTypeId'])) === 1 ? 'Quota Sales Credit' : pf(r, ['SalesCreditTypeId'])) ?? '—'}</Text> },
          { title: 'Percent', width: 100, align: 'right', render: (_: any, r: any) => <Text strong style={{ fontVariantNumeric: 'tabular-nums' }}>{num(pf(r, ['Percent']))}%</Text> },
          { title: '', width: 90, align: 'center', render: (_: any, r: any) => <Space size={0}>
              <Button size="small" type="text" icon={<EditOutlined />} style={{ color: REDWOOD.info }} onClick={() => onEdit(r)} />
              <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => onDelete(r)} />
            </Space> },
        ] as any} />
    </div>
  );
};

// ── Notes & Attachments panel (edit mode) — CRUD on the order's notes + attachments ──
const NotesAttachmentsPanel: React.FC<{ orderKey: string }> = ({ orderKey }) => {
  const base = `${FUSION_BASE}/salesOrdersForOrderHub/${encodeURIComponent(orderKey)}`;
  const NOTES = `${base}/child/notes`, ATTS = `${base}/child/attachments`;
  const selfHref = (o: any) => { const h = (o?.links ?? []).find((x: any) => x.rel === 'self' || x.name === 'self')?.href; return h ? fusionHref(h) : ''; };
  const enclosureHref = (o: any, name: string) => { const h = (o?.links ?? []).find((x: any) => x.rel === 'enclosure' && x.name === name)?.href; return h ? fusionHref(h) : ''; };

  // Notes state
  const [notes, setNotes] = useState<any[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [noteEdit, setNoteEdit] = useState<{ href?: string; text: string; visibility: string } | null>(null);
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteErr, setNoteErr] = useState('');
  // The exact request the note editor will run — shown via the API icon.
  const noteReq = noteEdit
    ? { method: noteEdit.href ? 'PATCH' : 'POST', url: noteEdit.href || NOTES,
        body: noteEdit.href ? { NoteTxt: noteEdit.text, VisibilityCode: noteEdit.visibility }
          : { NoteTxt: noteEdit.text, NoteTypeCode: 'GENERAL', VisibilityCode: noteEdit.visibility } }
    : null;
  const loadNotes = useCallback(async () => {
    setNotesLoading(true);
    try { const r = await fetch(`${NOTES}?limit=100`, { headers: getHeaders() }); const d = await r.json().catch(() => ({} as any)); setNotes(d.items ?? []); }
    catch { setNotes([]); } finally { setNotesLoading(false); }
  }, [NOTES]);
  const saveNote = async () => {
    if (!noteReq) return; setNoteBusy(true); setNoteErr('');
    try {
      const r = await fetch(noteReq.url, { method: noteReq.method, headers: { ...getHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(noteReq.body) });
      const t = await r.text();
      if (!r.ok) throw new Error([`${noteReq.method} ${noteReq.url}`, `HTTP ${r.status}`, ...collectOrderErrors(null, t, true)].join('\n'));
      message.success(noteReq.method === 'PATCH' ? 'Note updated' : 'Note added'); setNoteEdit(null); loadNotes();
    } catch (e: any) { setNoteErr(e?.message || 'Save failed'); message.error('Note save failed — see the details in the dialog'); } finally { setNoteBusy(false); }
  };
  const delNote = (row: any) => Modal.confirm({
    title: 'Delete this note?', okText: 'Delete', okButtonProps: { danger: true },
    onOk: async () => {
      try {
        const r = await fetch(selfHref(row), { method: 'DELETE', headers: getHeaders() });
        if (!r.ok && r.status !== 204) throw new Error(`HTTP ${r.status}`);
        message.success('Note deleted'); loadNotes();
      } catch (e: any) { message.error(e?.message || 'Delete failed'); }
    },
  });

  // Attachments state
  const [atts, setAtts] = useState<any[]>([]);
  const [attLoading, setAttLoading] = useState(false);
  const [attAdd, setAttAdd] = useState<{ type: 'FILE' | 'TEXT' | 'WEB_PAGE'; title: string; text?: string; url?: string; file?: File } | null>(null);
  const [attBusy, setAttBusy] = useState(false);
  const [preview, setPreview] = useState<{ title: string; kind: 'image' | 'pdf' | 'text' | 'other'; src?: string; text?: string } | null>(null);
  const loadAtts = useCallback(async () => {
    setAttLoading(true);
    try { const r = await fetch(`${ATTS}?limit=100`, { headers: getHeaders() }); const d = await r.json().catch(() => ({} as any)); setAtts(d.items ?? []); }
    catch { setAtts([]); } finally { setAttLoading(false); }
  }, [ATTS]);
  useEffect(() => { loadNotes(); loadAtts(); }, [loadNotes, loadAtts]);

  const toBase64 = (file: File) => new Promise<string>((res, rej) => { const rd = new FileReader(); rd.onload = () => res(String(rd.result).split(',')[1] || ''); rd.onerror = rej; rd.readAsDataURL(file); });
  const saveAtt = async () => {
    if (!attAdd) return; setAttBusy(true);
    try {
      let body: any;
      if (attAdd.type === 'FILE') {
        if (!attAdd.file) throw new Error('Choose a file');
        const b64 = await toBase64(attAdd.file);
        body = { DatatypeCode: 'FILE', FileName: attAdd.file.name, UploadedFileName: attAdd.file.name, UploadedFileContentType: attAdd.file.type || 'application/octet-stream', Title: attAdd.title || attAdd.file.name, CategoryName: 'MISC', FileContents: b64 };
      } else if (attAdd.type === 'TEXT') {
        body = { DatatypeCode: 'TEXT', Title: attAdd.title || 'Text', CategoryName: 'MISC', UploadedText: attAdd.text || '' };
      } else {
        body = { DatatypeCode: 'WEB_PAGE', Title: attAdd.title || attAdd.url, CategoryName: 'MISC', Url: attAdd.url };
      }
      const r = await fetch(ATTS, { method: 'POST', headers: { ...getHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) { const t = await r.text(); throw new Error(collectOrderErrors(null, t, true)[0] || `HTTP ${r.status}`); }
      message.success('Attachment added'); setAttAdd(null); loadAtts();
    } catch (e: any) { message.error(e?.message || 'Upload failed'); } finally { setAttBusy(false); }
  };
  const delAtt = (row: any) => Modal.confirm({
    title: 'Delete this attachment?', okText: 'Delete', okButtonProps: { danger: true },
    onOk: async () => {
      try {
        const r = await fetch(selfHref(row), { method: 'DELETE', headers: getHeaders() });
        if (!r.ok && r.status !== 204) throw new Error(`HTTP ${r.status}`);
        message.success('Attachment deleted'); loadAtts();
      } catch (e: any) { message.error(e?.message || 'Delete failed'); }
    },
  });

  const openPreview = async (row: any) => {
    const dtype = pf(row, ['DatatypeCode']);
    const title = pf(row, ['Title', 'FileName', 'UploadedFileName']) ?? 'Attachment';
    if (dtype === 'WEB_PAGE') { const u = pf(row, ['Url']); if (u) window.open(u, '_blank'); return; }
    if (dtype === 'TEXT') { setPreview({ title, kind: 'text', text: pf(row, ['UploadedText', 'Description']) ?? '' }); return; }
    // FILE → fetch the enclosure bytes with auth, show as a blob URL.
    const ctype = String(pf(row, ['UploadedFileContentType', 'ContentType']) ?? '');
    const fname = String(pf(row, ['FileName', 'UploadedFileName']) ?? '');
    const href = enclosureHref(row, 'FileContents') || pf(row, ['FileUrl']);
    if (!href) { message.warning('No file content link'); return; }
    const isImg = /image\//i.test(ctype) || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(fname);
    const isPdf = /pdf/i.test(ctype) || /\.pdf$/i.test(fname);
    try {
      const r = await fetch(href, { headers: getHeaders() });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const blob = await r.blob();
      const src = URL.createObjectURL(blob);
      if (isImg) setPreview({ title, kind: 'image', src });
      else if (isPdf) setPreview({ title, kind: 'pdf', src });
      else { const a = document.createElement('a'); a.href = src; a.download = fname || title; a.click(); }
    } catch (e: any) { message.error(e?.message || 'Preview failed'); }
  };
  const attIcon = (row: any) => {
    const dtype = pf(row, ['DatatypeCode']); const fname = String(pf(row, ['FileName', 'UploadedFileName']) ?? '');
    if (dtype === 'WEB_PAGE') return <LinkOutlined style={{ color: REDWOOD.info }} />;
    if (dtype === 'TEXT') return <FileTextOutlined style={{ color: REDWOOD.neutral600 }} />;
    if (/\.pdf$/i.test(fname)) return <FilePdfOutlined style={{ color: REDWOOD.error }} />;
    if (/\.(xlsx?|csv)$/i.test(fname)) return <FileExcelOutlined style={{ color: REDWOOD.success }} />;
    if (/\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(fname)) return <FileImageOutlined style={{ color: REDWOOD.primary }} />;
    return <FileOutlined style={{ color: REDWOOD.neutral600 }} />;
  };

  return (
    <div style={{ padding: '4px 2px' }}>
      <Row gutter={16}>
        {/* Notes */}
        <Col xs={24} lg={12}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
            <ProfileOutlined style={{ color: REDWOOD.primary, marginRight: 6 }} />
            <Text strong>Order Notes</Text>
            <Tag style={{ marginLeft: 8 }}>{notes.length}</Tag>
            <Space style={{ marginLeft: 'auto' }}>
              <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => { setNoteErr(''); setNoteEdit({ text: '', visibility: 'INTERNAL' }); }}>New Note</Button>
              <Button size="small" icon={<ReloadOutlined />} loading={notesLoading} onClick={loadNotes} />
            </Space>
          </div>
          {notes.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No notes" />
            : notes.map((n, i) => (
              <div key={i} style={{ border: `1px solid ${REDWOOD.neutral200}`, borderRadius: 8, padding: '8px 10px', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                  <Tag color={pf(n, ['VisibilityCode']) === 'EXTERNAL' ? 'blue' : 'default'} style={{ fontSize: 10 }}>{pf(n, ['VisibilityCode']) ?? 'INTERNAL'}</Tag>
                  <Text type="secondary" style={{ fontSize: 11 }}>{pf(n, ['NoteTypeCode']) ?? 'GENERAL'}{pf(n, ['CreationDate']) ? ` · ${String(pf(n, ['CreationDate'])).slice(0, 10)}` : ''}</Text>
                  <Space size={0} style={{ marginLeft: 'auto' }}>
                    <Button size="small" type="text" icon={<EditOutlined />} style={{ color: REDWOOD.info }} onClick={() => { setNoteErr(''); setNoteEdit({ href: selfHref(n), text: pf(n, ['NoteTxt']) ?? '', visibility: pf(n, ['VisibilityCode']) ?? 'INTERNAL' }); }} />
                    <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => delNote(n)} />
                  </Space>
                </div>
                <Text style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{pf(n, ['NoteTxt']) ?? '—'}</Text>
              </div>
            ))}
        </Col>

        {/* Attachments */}
        <Col xs={24} lg={12}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
            <PaperClipOutlined style={{ color: REDWOOD.primary, marginRight: 6 }} />
            <Text strong>Attachments</Text>
            <Tag style={{ marginLeft: 8 }}>{atts.length}</Tag>
            <Space style={{ marginLeft: 'auto' }}>
              <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => setAttAdd({ type: 'FILE', title: '' })}>Add</Button>
              <Button size="small" icon={<ReloadOutlined />} loading={attLoading} onClick={loadAtts} />
            </Space>
          </div>
          {atts.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No attachments" />
            : atts.map((a, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', border: `1px solid ${REDWOOD.neutral200}`, borderRadius: 8, padding: '8px 10px', marginBottom: 8 }}>
                <span style={{ fontSize: 18, marginRight: 10 }}>{attIcon(a)}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div><Text strong style={{ fontSize: 12 }} ellipsis>{pf(a, ['Title', 'FileName', 'UploadedFileName']) ?? '—'}</Text></div>
                  <Text type="secondary" style={{ fontSize: 11 }}>{pf(a, ['DatatypeCode'])}{pf(a, ['FileName']) && pf(a, ['DatatypeCode']) === 'FILE' ? ` · ${pf(a, ['FileName'])}` : ''}</Text>
                </div>
                <Space size={0}>
                  <Tooltip title={pf(a, ['DatatypeCode']) === 'WEB_PAGE' ? 'Open link' : 'Preview / download'}><Button size="small" type="text" icon={<EyeOutlined />} style={{ color: REDWOOD.info }} onClick={() => openPreview(a)} /></Tooltip>
                  <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => delAtt(a)} />
                </Space>
              </div>
            ))}
        </Col>
      </Row>

      {/* Note editor */}
      <Modal open={!!noteEdit} onCancel={() => !noteBusy && setNoteEdit(null)} width={560}
        title={<Space><ProfileOutlined style={{ color: REDWOOD.primary }} />{noteEdit?.href ? 'Edit Note' : 'New Note'}</Space>}
        footer={<Space><Button onClick={() => setNoteEdit(null)} disabled={noteBusy}>Cancel</Button><Button type="primary" loading={noteBusy} icon={<SaveOutlined />} onClick={saveNote} disabled={!noteEdit?.text?.trim()}>Save</Button></Space>}>
        {noteEdit && <div>
          <div style={{ marginBottom: 6, fontSize: 12, color: REDWOOD.neutral600 }}>Visibility</div>
          <Select style={{ width: 200, marginBottom: 12 }} value={noteEdit.visibility} onChange={v => setNoteEdit({ ...noteEdit, visibility: v })}
            options={[{ value: 'INTERNAL', label: 'Internal' }, { value: 'EXTERNAL', label: 'External' }]} />
          <div style={{ marginBottom: 6, fontSize: 12, color: REDWOOD.neutral600 }}>Note text</div>
          <Input.TextArea rows={5} value={noteEdit.text} onChange={e => setNoteEdit({ ...noteEdit, text: e.target.value })} placeholder="Type the note…" />
          {/* API request preview — the exact call Save will run */}
          {noteReq && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, color: REDWOOD.neutral600, marginBottom: 4 }}><ApiOutlined style={{ marginRight: 4 }} />REST request</div>
              <div style={{ fontSize: 11, fontFamily: 'monospace', wordBreak: 'break-all', background: REDWOOD.neutral100, border: `1px solid ${REDWOOD.neutral200}`, borderRadius: 6, padding: '8px 10px' }}>
                <div><b style={{ color: REDWOOD.primary }}>{noteReq.method}</b> {noteReq.url}</div>
                <div style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{JSON.stringify(noteReq.body, null, 2)}</div>
              </div>
            </div>
          )}
          {noteErr && (
            <div style={{ marginTop: 10, fontSize: 12, color: REDWOOD.error, whiteSpace: 'pre-wrap', background: '#FFF1F0', border: '1px solid #FFCCC7', borderRadius: 6, padding: '8px 10px', maxHeight: 200, overflow: 'auto' }}>{noteErr}</div>
          )}
        </div>}
      </Modal>

      {/* Attachment add */}
      <Modal open={!!attAdd} onCancel={() => !attBusy && setAttAdd(null)} width={520}
        title={<Space><PaperClipOutlined style={{ color: REDWOOD.primary }} />Add Attachment</Space>}
        footer={<Space><Button onClick={() => setAttAdd(null)} disabled={attBusy}>Cancel</Button><Button type="primary" loading={attBusy} icon={<CloudUploadOutlined />} onClick={saveAtt}>Add</Button></Space>}>
        {attAdd && <div>
          <Segmented block value={attAdd.type} onChange={(v: any) => setAttAdd({ ...attAdd, type: v })}
            options={[{ value: 'FILE', label: 'File', icon: <FileOutlined /> }, { value: 'TEXT', label: 'Text', icon: <FileTextOutlined /> }, { value: 'WEB_PAGE', label: 'URL', icon: <LinkOutlined /> }]} style={{ marginBottom: 14 }} />
          <div style={{ marginBottom: 6, fontSize: 12, color: REDWOOD.neutral600 }}>Title</div>
          <Input value={attAdd.title} onChange={e => setAttAdd({ ...attAdd, title: e.target.value })} placeholder="Display title" style={{ marginBottom: 12 }} />
          {attAdd.type === 'FILE' && (
            <Upload.Dragger beforeUpload={(f) => { setAttAdd({ ...attAdd, file: f, title: attAdd.title || f.name }); return false; }} maxCount={1} onRemove={() => setAttAdd({ ...attAdd, file: undefined })}
              fileList={attAdd.file ? [{ uid: '1', name: attAdd.file.name } as any] : []}>
              <p style={{ margin: 0 }}><InboxOutlined style={{ fontSize: 28, color: REDWOOD.primary }} /></p>
              <p style={{ margin: '6px 0 0', fontSize: 12 }}>Click or drag a file to upload</p>
            </Upload.Dragger>
          )}
          {attAdd.type === 'TEXT' && <Input.TextArea rows={5} value={attAdd.text} onChange={e => setAttAdd({ ...attAdd, text: e.target.value })} placeholder="Text content" />}
          {attAdd.type === 'WEB_PAGE' && <Input value={attAdd.url} onChange={e => setAttAdd({ ...attAdd, url: e.target.value })} placeholder="https://…" prefix={<LinkOutlined />} />}
        </div>}
      </Modal>

      {/* Preview */}
      <Modal open={!!preview} onCancel={() => { if (preview?.src) URL.revokeObjectURL(preview.src); setPreview(null); }} width={preview?.kind === 'pdf' ? 900 : 680} style={{ top: 20 }}
        title={<Space><EyeOutlined style={{ color: REDWOOD.primary }} />{preview?.title}</Space>}
        footer={<Button onClick={() => { if (preview?.src) URL.revokeObjectURL(preview.src); setPreview(null); }}>Close</Button>}>
        {preview?.kind === 'image' && <img src={preview.src} alt={preview.title} style={{ maxWidth: '100%', display: 'block', margin: '0 auto' }} />}
        {preview?.kind === 'pdf' && <iframe title={preview.title} src={preview.src} style={{ width: '100%', height: '70vh', border: 0 }} />}
        {preview?.kind === 'text' && <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, maxHeight: '60vh', overflow: 'auto' }}>{preview.text || '— empty —'}</div>}
      </Modal>
    </div>
  );
};

// ── Manual Charges dialog — add an extra charge (freight/handling/…) to a line's
//    charges child. A charge carries its own amount, so it applies on a frozen
//    order without repricing. Codes are pricing-setup-specific → all editable.
const CHARGE_PRESETS: { key: string; label: string; def: string; sub: string; applyTo: string; typeCode: string }[] = [
  { key: 'Freight',    label: 'Freight',    def: 'QP_SHIP_FREIGHT',      sub: 'Price', applyTo: 'SHIPPING', typeCode: 'ORA_SHIPPING_FREIGHT' },
  { key: 'Handling',   label: 'Handling',   def: 'QP_SHIP_HANDLING',     sub: 'Price', applyTo: 'SHIPPING', typeCode: 'ORA_SHIPPING_HANDLING' },
  { key: 'Restocking', label: 'Restocking', def: 'QP_RESTOCKING_CHARGE', sub: 'Price', applyTo: 'RETURN',   typeCode: 'ORA_RESTOCKING' },
  { key: 'Custom',     label: 'Custom',     def: '',                     sub: 'Price', applyTo: 'PRICE',    typeCode: '' },
];
const ChargesModal: React.FC<{ open: boolean; onClose: () => void; orderKey: string; lines: NewLine[]; ccy?: string; onChanged?: () => void }> = ({ open, onClose, orderKey, lines, ccy, onChanged }) => {
  const eligible = lines.filter(l => !l.canceled && (l.fulfillLineId != null || l.lineHref));
  const [lineKey, setLineKey] = useState<string | undefined>();
  const line = eligible.find(l => l.key === lineKey) ?? eligible[0];
  const [scope, setScope] = useState<'line' | 'all'>('line');
  const [preset, setPreset] = useState('Freight');
  const [def, setDef] = useState('QP_SHIP_FREIGHT');
  const [sub, setSub] = useState('Price');
  const [applyTo, setApplyTo] = useState('SHIPPING');
  const [chTypeCode, setChTypeCode] = useState('ORA_SHIPPING_FREIGHT');
  const [amount, setAmount] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [existing, setExisting] = useState<any[]>([]);
  const [exLoading, setExLoading] = useState(false);
  const selfHref = (o: any) => { const h = (o?.links ?? []).find((x: any) => x.rel === 'self' || x.name === 'self')?.href; return h ? fusionHref(h) : ''; };
  const chargesUrl = (l?: NewLine) => l?.chargesHref
    ?? (l?.lineHref ? `${fusionHref(l.lineHref)}/child/charges` : (l?.fulfillLineId != null ? `${FUSION_BASE}/salesOrdersForOrderHub/${encodeURIComponent(orderKey)}/child/lines/${l.fulfillLineId}/child/charges` : ''));

  useEffect(() => { if (open && eligible.length && !lineKey) setLineKey(eligible[0].key); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const loadExisting = useCallback(async () => {
    const url = chargesUrl(line); if (!url) { setExisting([]); return; }
    setExLoading(true);
    try { const r = await fetch(`${url}${url.includes('?') ? '&' : '?'}expand=chargeComponents&limit=50`, { headers: getHeaders() }); const d = await r.json().catch(() => ({} as any)); setExisting(d.items ?? []); }
    catch { setExisting([]); } finally { setExLoading(false); }
  }, [line?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (open && line) loadExisting(); }, [open, line?.key, loadExisting]);

  const applyPreset = (k: string) => { const p = CHARGE_PRESETS.find(x => x.key === k)!; setPreset(k); if (k !== 'Custom') { setDef(p.def); setSub(p.sub); setApplyTo(p.applyTo); setChTypeCode(p.typeCode); } };
  // Build a charge body for a line + amount. SourceChargeId/SourceChargeComponentId
  // are REQUIRED. PrimaryFlag is true unless the charge applies to PRICE (so it
  // never collides with the item's Sale price charge).
  const makeBody = (l: NewLine | undefined, amt: number, seq: number) => {
    const src = `MC-${l?.fulfillLineId ?? l?.srcLineId ?? 'x'}-${seq}`;
    const a = round2(amt);
    return {
      SourceChargeId: src, ApplyToCode: applyTo, PriceType: 'One time',
      ...(chTypeCode ? { ChargeTypeCode: chTypeCode } : {}), ChargeSubType: sub,
      ...(ccy ? { ChargeCurrencyCode: ccy } : {}), SequenceNumber: seq,
      ChargeDefinitionCode: def, PrimaryFlag: applyTo.toUpperCase() !== 'PRICE', RollupFlag: false,
      chargeComponents: [
        { SourceChargeComponentId: `${src}-SCC1`, PriceElementCode: 'QP_LIST_PRICE', PriceElementUsageCode: 'LIST_PRICE', HeaderCurrencyUnitPrice: a, HeaderCurrencyExtendedAmount: a, RollupFlag: false, SequenceNumber: 1 },
        { SourceChargeComponentId: `${src}-SCC2`, PriceElementCode: 'QP_NET_PRICE', PriceElementUsageCode: 'NET_PRICE', HeaderCurrencyUnitPrice: a, HeaderCurrencyExtendedAmount: a, RollupFlag: false, SequenceNumber: 2 },
      ],
    };
  };
  // Split a global charge across every line, prorated by line value (last line
  // absorbs the rounding remainder).
  const lineBase = (l: NewLine) => l.loadedExt != null ? l.loadedExt : round2(num(l.qty) * num(l.unitPrice));
  const totalBase = eligible.reduce((s, l) => s + lineBase(l), 0);
  const splitShares = () => { let alloc = 0; return eligible.map((l, i) => {
    const share = i === eligible.length - 1 ? round2(num(amount) - alloc) : round2(num(amount) * (totalBase > 0 ? lineBase(l) / totalBase : 1 / eligible.length));
    if (i < eligible.length - 1) alloc = round2(alloc + share);
    return { line: l, share };
  }); };
  const body = makeBody(line, num(amount), (existing.length || 0) + 1);
  const url = chargesUrl(line);
  const add = async () => {
    setBusy(true); setErr('');
    try {
      if (scope === 'all') {
        const shares = splitShares().filter(s => s.share > 0);
        if (!shares.length) throw new Error('Enter an amount to split across the lines');
        const fails: string[] = [];
        for (const { line: l, share } of shares) {
          const u = chargesUrl(l); const b = makeBody(l, share, 1);
          try { const r = await fetch(u, { method: 'POST', headers: { ...getHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); if (!r.ok) { const t = await r.text(); fails.push(`${l.itemNumber}: ${collectOrderErrors(null, t, true)[0] || 'HTTP ' + r.status}`); } }
          catch (e: any) { fails.push(`${l.itemNumber}: ${e?.message}`); }
        }
        if (fails.length) { setErr(fails.join('\n')); message.error(`${fails.length} of ${shares.length} charges failed`); }
        else { message.success(`Charge of ${fmtAmount(num(amount), ccy)} split across ${shares.length} line(s)`); setAmount(0); loadExisting(); onChanged?.(); }
      } else {
        if (!url) { message.error('No line selected'); return; }
        const r = await fetch(url, { method: 'POST', headers: { ...getHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const t = await r.text();
        if (!r.ok) throw new Error([`POST ${url}`, `HTTP ${r.status}`, ...collectOrderErrors(null, t, true)].join('\n'));
        message.success(`Charge of ${fmtAmount(num(amount), ccy)} added`); setAmount(0); loadExisting(); onChanged?.();
      }
    } catch (e: any) { setErr(e?.message || 'Add failed'); message.error('Charge add failed'); } finally { setBusy(false); }
  };
  const delCharge = (row: any) => Modal.confirm({
    title: 'Delete this charge?', okText: 'Delete', okButtonProps: { danger: true },
    content: <div style={{ fontSize: 12, fontFamily: 'monospace', wordBreak: 'break-all' }}>DELETE {selfHref(row)}</div>,
    onOk: async () => { try { const r = await fetch(selfHref(row), { method: 'DELETE', headers: getHeaders() }); if (!r.ok && r.status !== 204) throw new Error(`HTTP ${r.status}`); message.success('Charge deleted'); loadExisting(); onChanged?.(); } catch (e: any) { message.error(e?.message || 'Delete failed'); } },
  });
  const chargeAmt = (c: any) => { const comps = c.chargeComponents?.items ?? c.chargeComponents ?? []; const net = comps.find((x: any) => x.PriceElementCode === 'QP_NET_PRICE') ?? comps.find((x: any) => x.PriceElementCode === 'QP_LIST_PRICE'); return num(pf(net ?? {}, ['HeaderCurrencyExtendedAmount', 'HeaderCurrencyUnitPrice'])) || num(pf(c, ['GSAUnitPrice'])); };

  return (
    <Modal open={open} onCancel={() => !busy && onClose()} width={720} style={{ top: 20 }}
      title={<Space><DollarOutlined style={{ color: REDWOOD.primary }} />Charges</Space>}
      footer={<Space><Button onClick={onClose} disabled={busy}>Close</Button><Button type="primary" loading={busy} icon={<PlusOutlined />} onClick={add} disabled={!def || !num(amount) || (scope === 'line' && !url)}>{scope === 'all' ? 'Split Charge Across Lines' : 'Add Charge'}</Button></Space>}>
      {/* Scope — a single line, or a global charge split across all lines */}
      <Segmented block value={scope} onChange={(v: any) => setScope(v)} style={{ marginBottom: 14 }}
        options={[{ value: 'line', label: 'Specific line' }, { value: 'all', label: `Global — split across ${eligible.length} lines` }]} />

      {scope === 'line' ? <>
        <div style={{ marginBottom: 6, fontSize: 12, color: REDWOOD.neutral600 }}>Line</div>
        <Select style={{ width: '100%', marginBottom: 14 }} value={line?.key} onChange={setLineKey}
          options={eligible.map((l, i) => ({ value: l.key, label: `${l.srcLineNumber ?? i + 1} · ${l.itemNumber}${l.description ? ` — ${l.description}` : ''}` }))} />
        {/* Existing charges on the line */}
        <div style={{ fontSize: 12, color: REDWOOD.neutral600, marginBottom: 4 }}>Existing charges {exLoading && <Spin size="small" />}</div>
        <Table size="small" rowKey={(_, i) => String(i)} pagination={false} dataSource={existing} style={{ marginBottom: 16 }}
          locale={{ emptyText: 'No charges' }}
          columns={[
            { title: 'Charge', render: (_: any, c: any) => <Text style={{ fontSize: 12 }}>{pf(c, ['ChargeType', 'ChargeTypeCode', 'ChargeDefinitionCode']) ?? '—'}{String(c.PrimaryFlag) === 'true' ? ' (Sale)' : ''}</Text> },
            { title: 'Definition', width: 160, render: (_: any, c: any) => <Text type="secondary" style={{ fontSize: 11 }}>{pf(c, ['ChargeDefinitionCode'])}</Text> },
            { title: 'Amount', width: 120, align: 'right', render: (_: any, c: any) => <Text strong style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtAmount(chargeAmt(c), ccy)}</Text> },
            { title: '', width: 44, align: 'center', render: (_: any, c: any) => String(c.PrimaryFlag) === 'true' ? <Text type="secondary">—</Text> : <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => delCharge(c)} /> },
          ] as any} />
      </> : (
        <div style={{ marginBottom: 14, fontSize: 12, color: REDWOOD.neutral600 }}>
          The total amount is prorated across all {eligible.length} line(s) by line value, and one charge is POSTed per line.
        </div>
      )}

      {/* Add a charge */}
      <div style={{ border: `1px solid ${REDWOOD.neutral200}`, borderRadius: 8, padding: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>{scope === 'all' ? 'Global charge' : 'Add charge'}</div>
        <Segmented block value={preset} onChange={(v: any) => applyPreset(v)} options={CHARGE_PRESETS.map(p => ({ value: p.key, label: p.label }))} style={{ marginBottom: 12 }} />
        <Row gutter={10}>
          <Col span={8}><div style={{ fontSize: 11, color: REDWOOD.neutral600, marginBottom: 2 }}>Charge Definition Code</div><Input value={def} onChange={e => setDef(e.target.value)} placeholder="QP_SHIP_FREIGHT" /></Col>
          <Col span={8}><div style={{ fontSize: 11, color: REDWOOD.neutral600, marginBottom: 2 }}>Charge Type Code</div><Input value={chTypeCode} onChange={e => setChTypeCode(e.target.value)} placeholder="ORA_SHIPPING_FREIGHT" /></Col>
          <Col span={8}><div style={{ fontSize: 11, color: REDWOOD.neutral600, marginBottom: 2 }}>Sub Type</div><Input value={sub} onChange={e => setSub(e.target.value)} placeholder="Price" /></Col>
          <Col span={8} style={{ marginTop: 10 }}><div style={{ fontSize: 11, color: REDWOOD.neutral600, marginBottom: 2 }}>Apply To Code</div>
            <Select style={{ width: '100%' }} value={applyTo} onChange={setApplyTo} options={['PRICE', 'SHIPPING', 'RETURN'].map(v => ({ value: v, label: v }))} /></Col>
          <Col span={8} style={{ marginTop: 10 }}><div style={{ fontSize: 11, color: REDWOOD.neutral600, marginBottom: 2 }}>{scope === 'all' ? 'Total amount' : 'Amount'}</div>
            <InputNumber min={0} style={{ width: '100%' }} value={amount} onChange={v => setAmount(Number(v) || 0)} addonAfter={ccy} /></Col>
        </Row>
        {scope === 'all' && num(amount) > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 11, color: REDWOOD.neutral600, marginBottom: 4 }}>Split preview</div>
            <Table size="small" rowKey={(_, i) => String(i)} pagination={false} dataSource={splitShares()}
              columns={[
                { title: 'Line', render: (_: any, s: any) => <Text style={{ fontSize: 12 }}>{s.line.itemNumber}</Text> },
                { title: 'Line value', width: 120, align: 'right', render: (_: any, s: any) => <Text type="secondary" style={{ fontSize: 11.5 }}>{fmtAmount(lineBase(s.line), ccy)}</Text> },
                { title: 'Charge share', width: 130, align: 'right', render: (_: any, s: any) => <Text strong style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtAmount(s.share, ccy)}</Text> },
              ] as any} />
          </div>
        )}
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11, color: REDWOOD.neutral600, marginBottom: 4 }}><ApiOutlined style={{ marginRight: 4 }} />REST request{scope === 'all' ? ' (per line)' : ''}</div>
          <div style={{ fontSize: 10.5, fontFamily: 'monospace', wordBreak: 'break-all', background: REDWOOD.neutral100, border: `1px solid ${REDWOOD.neutral200}`, borderRadius: 6, padding: '8px 10px', maxHeight: 160, overflow: 'auto' }}>
            <div><b style={{ color: REDWOOD.primary }}>POST</b> {scope === 'all' ? '…/lines/{id}/child/charges' : (url || '(no line)')}</div>
            <div style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{JSON.stringify(body, null, 2)}</div>
          </div>
        </div>
        {err && <div style={{ marginTop: 10, fontSize: 11, color: REDWOOD.error, whiteSpace: 'pre-wrap', background: '#FFF1F0', border: '1px solid #FFCCC7', borderRadius: 6, padding: '8px 10px', maxHeight: 160, overflow: 'auto' }}>{err}</div>}
      </div>
    </Modal>
  );
};

// Credit Check Panel — displays customer balance with aging
const CreditCheckPanel: React.FC<{ hdr: OrderHeader; loading: boolean; error: string | null; data: any; onFetch: () => void; apiUrl?: string; apiResponse?: string; lines?: any[] }> = ({ hdr, loading, error, data, onFetch, apiUrl = '', apiResponse = '', lines = [] }) => {
  const [apiDrawerOpen, setApiDrawerOpen] = React.useState(false);
  const [showOpenInvoices, setShowOpenInvoices] = React.useState(false);

  // Get currency symbol from header
  const currencyCode = hdr.txnCurrency || 'USD';
  const getCurrencySymbol = (code: string): string => {
    const symbols: { [key: string]: string } = {
      'USD': '$', 'EUR': '€', 'GBP': '£', 'JPY': '¥', 'AED': 'د.إ', 'SAR': '﷼', 'INR': '₹',
      'CAD': 'C$', 'AUD': 'A$', 'CHF': 'CHF', 'CNY': '¥', 'MXN': '$'
    };
    return symbols[code] || code + ' ';
  };
  const currencySymbol = getCurrencySymbol(currencyCode);

  const computeAging = (schedules: any[]): { current: number; over30: number; over60: number; over90: number } => {
    const today = dayjs();
    const aging = { current: 0, over30: 0, over60: 0, over90: 0 };

    if (!schedules || schedules.length === 0) {
      console.warn('No transaction schedules to compute aging');
      return aging;
    }

    schedules.forEach((schedule: any, idx: number) => {
      // Try multiple field name combinations (TotalBalanceAmount from actual API is first)
      const amount = num(
        schedule.TotalBalanceAmount ??
        schedule.ScheduleAmount ??
        schedule.Amount ??
        schedule.InstallmentAmount ??
        schedule.RemainingAmount ??
        0
      );

      if (!amount) {
        console.debug(`Schedule ${idx} has no amount:`, { fields: Object.keys(schedule), amount });
        return;
      }

      // Try multiple date field names (PaymentScheduleDueDate from actual API is first)
      const dateStr =
        schedule.PaymentScheduleDueDate ??
        schedule.ScheduledPaymentDate ??
        schedule.DueDate ??
        schedule.ScheduleDate ??
        schedule.PaymentDate;

      if (!dateStr) {
        console.debug(`Schedule ${idx} has no date field`);
        return;
      }

      const dueDate = dayjs(dateStr);
      if (!dueDate.isValid()) {
        console.debug(`Schedule ${idx} has invalid date: ${dateStr}`);
        return;
      }

      // Use PaymentDaysLate if available, otherwise calculate
      const days = num(schedule.PaymentDaysLate ?? today.diff(dueDate, 'day'));
      console.debug(`Schedule ${idx}: amount=${amount}, daysOverdue=${days}`);

      if (days <= 0) aging.current += amount;
      else if (days <= 30) aging.current += amount;
      else if (days <= 60) aging.over30 += amount;
      else if (days <= 90) aging.over60 += amount;
      else aging.over90 += amount;
    });

    console.log('Computed aging:', aging);
    return aging;
  };

  const totalBalance = data?.items?.[0]?.TotalOpenReceivablesForSite ?? 0;
  const aging = data?.transactionSchedules && data.transactionSchedules.length > 0
    ? computeAging(data.transactionSchedules)
    : { current: 0, over30: 0, over60: 0, over90: 0 };

  return (
    <div style={{ padding: 16 }}>
      <Space style={{ marginBottom: 16 }} size="large" align="center">
        <Button type="primary" icon={<ReconciliationOutlined />} loading={loading} onClick={onFetch} disabled={!hdr.accountNumber}>
          Get Customer Balance
        </Button>
        {hdr.accountNumber && <Text type="secondary" style={{ fontSize: 12 }}>Account: <strong>{hdr.accountNumber}</strong></Text>}
        {data?.transactionSchedules && data.transactionSchedules.length > 0 && (
          <Button
            type="default"
            size="small"
            onClick={() => setShowOpenInvoices(!showOpenInvoices)}
            style={{ fontSize: 12 }}
          >
            {showOpenInvoices ? 'Hide' : 'Show'} Open Invoices ({data.transactionSchedules.length})
          </Button>
        )}
        {apiUrl && (
          <Button
            type="text"
            size="small"
            icon={<ApiOutlined style={{ color: REDWOOD.info }} />}
            onClick={() => setApiDrawerOpen(true)}
            title="View API Details"
            style={{ color: REDWOOD.info }}
          />
        )}
      </Space>

      {error && (
        <div style={{ marginBottom: 16, padding: 12, background: '#FFF1F0', border: '1px solid #FFCCC7', borderRadius: 6, color: REDWOOD.error }}>
          <Text strong>Error:</Text> {error}
        </div>
      )}

      <Modal
        title={`Open Invoices for Aging Calculation (${data?.transactionSchedules?.length ?? 0})`}
        open={showOpenInvoices}
        onCancel={() => setShowOpenInvoices(false)}
        width={900}
        footer={null}
        bodyStyle={{ padding: '24px' }}
      >
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: `2px solid ${REDWOOD.neutral300}` }}>
                <th style={{ textAlign: 'left', padding: '12px', fontWeight: 600, background: REDWOOD.neutral100 }}>Amount</th>
                <th style={{ textAlign: 'left', padding: '12px', fontWeight: 600, background: REDWOOD.neutral100 }}>Due Date</th>
                <th style={{ textAlign: 'center', padding: '12px', fontWeight: 600, background: REDWOOD.neutral100 }}>Days Overdue</th>
                <th style={{ textAlign: 'left', padding: '12px', fontWeight: 600, background: REDWOOD.neutral100 }}>Aging Bucket</th>
              </tr>
            </thead>
            <tbody>
              {data?.transactionSchedules?.map((schedule: any, idx: number) => {
                const amount = num(
                  schedule.TotalBalanceAmount ??
                  schedule.ScheduleAmount ??
                  schedule.Amount ??
                  schedule.InstallmentAmount ??
                  schedule.RemainingAmount ??
                  0
                );
                const dateStr =
                  schedule.PaymentScheduleDueDate ??
                  schedule.ScheduledPaymentDate ??
                  schedule.DueDate ??
                  schedule.ScheduleDate ??
                  schedule.PaymentDate;
                const dueDate = dateStr ? dayjs(dateStr) : null;
                const days = dueDate && dueDate.isValid()
                  ? dayjs().diff(dueDate, 'day')
                  : num(schedule.PaymentDaysLate ?? null);

                let agingBucket = 'N/A';
                let bucketColor = REDWOOD.neutral600;
                if (days !== null) {
                  if (days <= 0) { agingBucket = 'Current'; bucketColor = '#1890ff'; }
                  else if (days <= 30) { agingBucket = 'Current'; bucketColor = '#1890ff'; }
                  else if (days <= 60) { agingBucket = 'Over 30'; bucketColor = '#FAAD14'; }
                  else if (days <= 90) { agingBucket = 'Over 60'; bucketColor = '#FF4D4F'; }
                  else { agingBucket = 'Over 90'; bucketColor = '#FF7875'; }
                }

                return (
                  <tr key={idx} style={{ borderBottom: `1px solid ${REDWOOD.neutral200}` }}>
                    <td style={{ textAlign: 'left', padding: '12px', color: REDWOOD.primary, fontWeight: 600 }}>
                      {currencySymbol}{amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td style={{ textAlign: 'left', padding: '12px', color: REDWOOD.neutral800 }}>
                      {dueDate && dueDate.isValid() ? dueDate.format('YYYY-MM-DD') : 'N/A'}
                    </td>
                    <td style={{ textAlign: 'center', padding: '12px', color: REDWOOD.neutral800 }}>
                      {days !== null ? days : 'N/A'}
                    </td>
                    <td style={{ textAlign: 'left', padding: '12px', color: bucketColor, fontWeight: 600 }}>
                      {agingBucket}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Modal>

      {data && (
        <>
          {/* Calculate order total and credit metrics */}
          {(() => {
            const orderTotal = lines.reduce((sum: number, line: any) => sum + num(line.lineTotal ?? 0), 0);
            const creditLimit = num(hdr.creditLimit ?? 0);
            const balance = num(data.items?.[0]?.TotalOpenReceivablesForSite ?? 0);
            const availableCredit = creditLimit - balance;
            const creditPassed = orderTotal <= availableCredit;

            return (
              <Card style={{ marginBottom: 24, border: `2px solid ${creditPassed ? '#52c41a' : REDWOOD.error}` }}>
                <div style={{ padding: '8px 0' }}>
                  {/* Top Row: Balance, Credit Limit, Order Total */}
                  <Row gutter={24} style={{ marginBottom: 16 }}>
                    <Col xs={24} sm={6}>
                      <div style={{ padding: '8px 12px', background: REDWOOD.neutral100, borderRadius: 4 }}>
                        <div style={{ fontSize: 11, color: REDWOOD.neutral600, marginBottom: 2 }}>Open Balance</div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: REDWOOD.primary }}>
                          {currencySymbol}{balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                      </div>
                    </Col>
                    <Col xs={24} sm={6}>
                      <div style={{ padding: '8px 12px', background: '#E6F7FF', borderRadius: 4 }}>
                        <div style={{ fontSize: 11, color: '#1890ff', marginBottom: 2 }}>Credit Limit</div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#1890ff' }}>
                          {currencySymbol}{creditLimit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                      </div>
                    </Col>
                    <Col xs={24} sm={6}>
                      <div style={{ padding: '8px 12px', background: '#FFF7E6', borderRadius: 4 }}>
                        <div style={{ fontSize: 11, color: '#FAAD14', marginBottom: 2 }}>Order Total</div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#FAAD14' }}>
                          {currencySymbol}{orderTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                      </div>
                    </Col>
                    <Col xs={24} sm={6}>
                      <div style={{ padding: '8px 12px', background: creditPassed ? '#F6FFED' : '#FFF1F0', borderRadius: 4 }}>
                        <div style={{ fontSize: 11, color: creditPassed ? '#52c41a' : REDWOOD.error, marginBottom: 2 }}>
                          {creditPassed ? '✓ PASS' : '✗ FAIL'}
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: creditPassed ? '#52c41a' : REDWOOD.error }}>
                          {currencySymbol}{availableCredit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                        <div style={{ fontSize: 10, color: REDWOOD.neutral600 }}>Available</div>
                      </div>
                    </Col>
                  </Row>

                  {/* Aging Breakdown */}
                  <Divider style={{ margin: '12px 0' }} />
                  <div style={{ fontSize: 11, fontWeight: 600, color: REDWOOD.neutral800, marginBottom: 8 }}>Aging Breakdown</div>
                  <Row gutter={12}>
                    <Col xs={12} sm={6}>
                      <div style={{ fontSize: 10, color: '#1890ff', marginBottom: 2 }}>Current (≤30d)</div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#1890ff' }}>
                        {currencySymbol}{aging.current.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                    </Col>
                    <Col xs={12} sm={6}>
                      <div style={{ fontSize: 10, color: '#FAAD14', marginBottom: 2 }}>Over 30 Days</div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#FAAD14' }}>
                        {currencySymbol}{aging.over30.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                    </Col>
                    <Col xs={12} sm={6}>
                      <div style={{ fontSize: 10, color: '#FF4D4F', marginBottom: 2 }}>Over 60 Days</div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#FF4D4F' }}>
                        {currencySymbol}{aging.over60.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                    </Col>
                    <Col xs={12} sm={6}>
                      <div style={{ fontSize: 10, color: '#FF7875', marginBottom: 2 }}>Over 90 Days</div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#FF7875' }}>
                        {currencySymbol}{aging.over90.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                    </Col>
                  </Row>
                </div>
              </Card>
            );
          })()}
        </>
      )}

      {!data && !error && (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Click 'Get Customer Balance' to fetch customer activities and credit information" style={{ marginTop: 24 }} />
      )}

      {/* API Inspector Drawer */}
      <Drawer
        title="API Details — Customer Balance"
        placement="right"
        onClose={() => setApiDrawerOpen(false)}
        open={apiDrawerOpen}
        width={700}
        bodyStyle={{ padding: '24px', overflowY: 'auto', maxHeight: 'calc(100vh - 100px)' }}
      >
        <Space direction="vertical" style={{ width: '100%' }} size="large">
          {/* Customer Account API URL */}
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <ApiOutlined />
              GET Endpoint #1: Customer Account Balance
            </div>
            <div style={{
              backgroundColor: '#f5f5f5',
              padding: '12px',
              borderRadius: '6px',
              fontFamily: 'monospace',
              fontSize: '12px',
              wordBreak: 'break-all',
              border: `1px solid ${REDWOOD.neutral300}`,
              maxHeight: 200,
              overflow: 'auto'
            }}>
              {apiUrl || 'N/A'}
            </div>
          </div>

          <Divider />

          {/* Open Invoices API URL */}
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <ApiOutlined style={{ color: '#FAAD14' }} />
              GET Endpoint #2: Open Invoices (for Aging)
            </div>
            <div style={{
              backgroundColor: '#FFFBE6',
              padding: '12px',
              borderRadius: '6px',
              fontFamily: 'monospace',
              fontSize: '12px',
              wordBreak: 'break-all',
              border: `2px solid #FAAD14`,
              maxHeight: 200,
              overflow: 'auto',
              color: '#8B6914'
            }}>
              {data?.items?.[0]?.BillToSiteUseId
                ? `${FUSION_BASE}/receivablesCustomerAccountSiteActivities/${data.items[0].BillToSiteUseId}/child/transactionPaymentSchedules?limit=500&offset=0&q=InstallmentStatus='Open'`
                : 'N/A (fetch customer balance first)'}
            </div>
            <div style={{ fontSize: 11, color: REDWOOD.neutral600, marginTop: 6 }}>
              ✓ Filters for <Text strong>InstallmentStatus='Open'</Text> to get only unpaid invoices for aging calculation
            </div>
          </div>

          <Divider />

          {/* API Response */}
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>📦</span>
              Response Data
            </div>
            <div style={{
              backgroundColor: '#f5f5f5',
              padding: '12px',
              borderRadius: '6px',
              fontFamily: 'monospace',
              fontSize: '11px',
              wordBreak: 'break-word',
              border: `1px solid ${REDWOOD.neutral300}`,
              maxHeight: 400,
              overflow: 'auto',
              whiteSpace: 'pre-wrap'
            }}>
              {apiResponse || 'No response yet'}
            </div>
          </div>

          <div style={{ fontSize: 12, color: REDWOOD.neutral600, padding: '12px', backgroundColor: '#f5f5f5', borderRadius: 6 }}>
            <Text strong>Troubleshooting Tips:</Text>
            <ul style={{ marginTop: 8, marginBottom: 0, paddingLeft: 20 }}>
              <li>Check if the account number ({hdr.accountNumber}) is correct</li>
              <li>Verify API credentials and permissions</li>
              <li>Ensure the customer exists in Fusion with transactions</li>
              <li>Check browser console for detailed error messages</li>
            </ul>
          </div>
        </Space>
      </Drawer>
    </div>
  );
};

const NewOrderTab: React.FC<{ header: OrderHeader; initialDraft?: SoDraft; editOrder?: any; returnMode?: boolean; onCopy?: (order: any, lines: any[]) => void }> = ({ header, initialDraft, editOrder, returnMode, onCopy }) => {
  const auth = useAuth();
  const editMode = !!editOrder;
  const [form] = Form.useForm();
  const [hdr, setHdr] = useState<OrderHeader>(initialDraft?.header ?? header);
  const bUnits = usePayablesBUs();
  const orgRows = useInvOrgs();
  const customers = useCustomers();
  const payTermOpts = useOrdsOptions(PAYMENT_TERMS_URL, PAY_TERM_KEYS, PAYMENT_TERMS);
  const salesRepOpts = useSalesReps();
  const custOptions = useMemo(() => custOptionList(customers), [customers]);
  const taxCodes = useTaxCodes(hdr.businessUnit);
  const taxOptions = useMemo(() => taxCodes.map(t => ({ value: t.code, label: `${t.code} (${t.pct}%)`, pct: t.pct })), [taxCodes]);
  const [subs, setSubs] = useState<string[]>([]);
  const [lines, setLines] = useState<NewLine[]>(initialDraft?.lines ?? []);
  const [pickOpen, setPickOpen] = useState(false);
  const [preview, setPreview] = useState(false);
  const [posting, setPosting] = useState(false);
  // Bumped by the header Refresh button to re-pull the whole order from Fusion.
  const [reloadKey, setReloadKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  // Error message from the last save (drives the result dialog's error state).
  const [saveError, setSaveError] = useState<string | null>(null);
  // Per-save error breakdown: general (order-level) messages + a click-to-view modal.
  const [orderErrors, setOrderErrors] = useState<string[]>([]);
  const [errModal, setErrModal] = useState<{ title: string; msg: string } | null>(null);
  // Full raw response of the last save/update (shown via the "Show Response" button).
  const [lastResponse, setLastResponse] = useState<string>('');
  const [respOpen, setRespOpen] = useState(false);
  // Per-line update dialog (edit mode): existing lines are locked; edit via this.
  const [updTarget, setUpdTarget] = useState<NewLine | null>(null);
  const [updQty, setUpdQty] = useState<number>(0);
  const [updBusy, setUpdBusy] = useState(false);
  // Update Line dialog — full reprice fields (qty / price / tax / lot).
  const [updPrice, setUpdPrice] = useState<number>(0);
  const [updTaxCode, setUpdTaxCode] = useState<string | undefined>();
  const [updTaxPct, setUpdTaxPct] = useState<number | undefined>();
  const [updLot, setUpdLot] = useState<string | undefined>();
  const [updLots, setUpdLots] = useState<{ lot?: string; subinventory?: string; qty: number }[]>([]);
  // On-hand / lot API inspector for the update-line dialog.
  const [lotApi, setLotApi] = useState<{ open: boolean; url: string; running?: boolean; status?: string; body?: string; ok?: boolean }>({ open: false, url: '' });
  const runLotApi = async () => {
    if (!lotApi.url) return;
    setLotApi(s => ({ ...s, running: true, status: undefined, body: undefined }));
    const started = Date.now();
    try {
      const r = await fetchWithTimeout(lotApi.url, { headers: getHeaders() });
      const text = await r.text();
      setLotApi(s => ({ ...s, running: false, ok: r.ok, status: `HTTP ${r.status} ${r.statusText} · ${text.length} bytes · ${Date.now() - started}ms`, body: text.slice(0, 4000) }));
    } catch (e: any) {
      setLotApi(s => ({ ...s, running: false, ok: false, status: `Failed after ${Date.now() - started}ms`, body: e?.message || String(e) }));
    }
  };
  // Line-Total drill → charges/chargeComponents fetched live from Fusion.
  const [chargeDrill, setChargeDrill] = useState<{ line: NewLine; loading: boolean; url: string; charges: any[]; error?: string } | null>(null);
  const [chargesOpen, setChargesOpen] = useState(false);
  // Order totals drill — GET {OrderKey}/child/totals when a Net total is clicked.
  const [totals, setTotals] = useState<{ open: boolean; loading: boolean; url: string; rows: any[]; error?: string }>({ open: false, loading: false, url: '', rows: [] });
  // Success celebration + created-order tracking (line status refresh).
  const [confetti, setConfetti] = useState<{ id: number; x: number; color: string; delay: number; size: number }[]>([]);
  const [successInfo, setSuccessInfo] = useState<{ orderNumber: string; status: string } | null>(null);
  const [successOpen, setSuccessOpen] = useState(false);
  const [createdOrderKey, setCreatedOrderKey] = useState<string | null>(null);
  const [createdOrderNumber, setCreatedOrderNumber] = useState<string | null>(editOrder?.OrderNumber ? String(editOrder.OrderNumber) : null);
  const [statusLoading, setStatusLoading] = useState(false);
  // Draft workflow (Save→Confirm→Reserve/Unreserve): busy flag + last action result.
  const [workBusy, setWorkBusy] = useState<null | 'confirm' | 'reserve' | 'unreserve'>(null);
  const [confirmed, setConfirmed] = useState(false);
  // Credit check data
  const [creditCheckData, setCreditCheckData] = useState<any>(null);
  const [creditCheckLoading, setCreditCheckLoading] = useState(false);
  const [creditCheckError, setCreditCheckError] = useState<string | null>(null);
  const [creditCheckApiUrl, setCreditCheckApiUrl] = useState('');
  const [creditCheckApiResponse, setCreditCheckApiResponse] = useState('');
  const [resvReloadKey, setResvReloadKey] = useState(0);
  const [autoShipOpen, setAutoShipOpen] = useState(false);
  const [autoInvoiceOpen, setAutoInvoiceOpen] = useState(false);
  const [branchSalesModalOpen, setBranchSalesModalOpen] = useState(false);
  const [branchSalesForm] = Form.useForm();
  const [custSearchModalOpen, setCustSearchModalOpen] = useState(false);
  const [savedOrderNumber, setSavedOrderNumber] = useState<string | null>(null);
  const [createdPONumber, setCreatedPONumber] = useState<string | null>(null);
  const [creatingBranchPO, setCreatingBranchPO] = useState(false);
  const [isBranchSales, setIsBranchSales] = useState(false);
  // Allocation modal for lot/serial selection (InventoryTransactionFlag)
  const [allocationModalOpen, setAllocationModalOpen] = useState(false);
  const [allocationLine, setAllocationLine] = useState<NewLine | null>(null);
  const [branchSuppliers, setBranchSuppliers] = useState<any[]>([]);
  const [branchShipToOrgs, setBranchShipToOrgs] = useState<any[]>([]);
  const [branchBUData, setBranchBUData] = useState<{ baseCurrency?: string; conversionRate?: number }>({});
  const [branchPoPayload, setBranchPoPayload] = useState<string>('');
  const [branchApiDrawerOpen, setBranchApiDrawerOpen] = useState(false);
  const [branchSupplierSearchOpen, setBranchSupplierSearchOpen] = useState(false);
  const [branchSupplierSearchTerm, setBranchSupplierSearchTerm] = useState('');
  const [branchSupplierSearchLoading, setBranchSupplierSearchLoading] = useState(false);
  const [selectedSupplierWithSites, setSelectedSupplierWithSites] = useState<any>(null);
  const [branchSupplierSitesModalOpen, setBranchSupplierSitesModalOpen] = useState(false);
  const [branchPoNeedByDate, setBranchPoNeedByDate] = useState<any>(dayjs().add(7, 'days'));
  const [orderTypeOpts, setOrderTypeOpts] = useState<any[]>([]);
  const [orderTypeLookup, setOrderTypeLookup] = useState<Map<string, any>>(new Map());
  const [inventoryTransactionFlag, setInventoryTransactionFlag] = useState<boolean>(false);

  // Build Branch PO payload when form values or lines change
  useEffect(() => {
    if (!branchApiDrawerOpen) return; // Only build payload when drawer is open
    try {
      const branchBU = branchSalesForm.getFieldValue('branchBusinessUnit');
      const branchSupplier = branchSalesForm.getFieldValue('branchSupplierName');
      const branchSupplierSite = branchSalesForm.getFieldValue('branchSupplierSite');
      const shipToLoc = branchSalesForm.getFieldValue('shipToLocation');
      const currency = branchSalesForm.getFieldValue('currency');
      const needByDate = branchSalesForm.getFieldValue('needByDate');

      if (!branchBU || !branchSupplier || !branchSupplierSite || !shipToLoc) {
        setBranchPoPayload('');
        return;
      }

      const buRow = bUnits.find((b: any) => b.businessUnitName === branchBU);
      const procBUId = buRow?.businessUnitId;

      if (!procBUId) {
        setBranchPoPayload('');
        return;
      }

      const poLines = lines
        .filter((l: any) => l.itemNumber && num(l.qty) > 0)
        .map((l: any, idx: number) => {
          const orgObj = orgRows.find((o: any) => pf(o, ['OrganizationCode']) === shipToLoc);
          return {
            LineNumber: idx + 1,
            LineType: 'Goods',
            Item: l.itemNumber,
            Description: l.description,
            Quantity: num(l.qty),
            Price: num(l.unitPrice),
            UOM: l.uom || 'EA',
            schedules: [{
              ScheduleNumber: 1,
              Quantity: num(l.qty),
              ShipToLocation: shipToLoc,
              ShipToOrganizationCode: shipToLoc,
              ShipToOrganization: pf(orgObj, ['OrganizationName']),
              RequestedDeliveryDate: (needByDate || branchPoNeedByDate)?.format('YYYY-MM-DD'),
              ReceiptCloseTolerancePercent: 0,
              InvoiceMatchOptionCode: 'P',
              InvoiceMatchOption: 'Order',
              EarlyReceiptToleranceDays: 0,
              InvoiceCloseTolerancePercent: 0,
              LateReceiptToleranceDays: 0,
              AccrueAtReceiptFlag: true,
              InspectionRequiredFlag: true,
              ReceiptRequiredFlag: false,
              ReceiptRoutingId: 3,
              ReceiptRouting: 'Direct delivery',
              DestinationTypeCode: 'INVENTORY',
              MatchApprovalLevelCode: '3-Way',
              MatchApprovalLevel: '3 Way',
              distributions: [{
                DistributionNumber: 1,
                DeliverToLocation: shipToLoc,
                DeliverToLocationCode: shipToLoc,
                Quantity: num(l.qty),
              }],
            }],
          };
        });

      const currencyNames: Record<string, string> = { USD: 'US Dollar', AED: 'United Arab Emirates Dirham', KES: 'Kenyan Shilling', EUR: 'Euro', GBP: 'British Pound' };

      const poPayload = {
        ProcurementBUId: procBUId,
        OrderNumber: `BLPO${savedOrderNumber?.replace(/^BCSO/, '') || ''}`,
        RequiredAcknowledgment: 'None',
        CurrencyCode: currency,
        Currency: currencyNames[currency] || currency,
        ConversionRateTypeCode: hdr.rate && hdr.rate !== 1 ? (hdr.currencyRateType || 'Corporate') : null,
        ConversionRateType: hdr.rate && hdr.rate !== 1 ? (hdr.currencyRateType || 'Corporate') : null,
        ConversionRateDate: hdr.currencyDate?.format('YYYY-MM-DD'),
        ConversionRate: hdr.rate && hdr.rate !== 1 ? num(hdr.rate) : null,
        Buyer: 'emp, arun',
        PayOnReceiptFlag: 'Y',
        RequisitioningBUId: procBUId,
        Supplier: branchSupplier,
        SupplierSite: branchSupplierSite,
        BillToLocation: branchBU,
        DefaultShipToLocation: shipToLoc,
        ModeOfTransportCode: null,
        BuyerManagedTransportFlag: false,
        SupplierEmailAddress: null,
        lines: poLines,
      };

      setBranchPoPayload(JSON.stringify(poPayload, null, 2));
    } catch (e) {
      console.error('Error building branch PO payload:', e);
      setBranchPoPayload('');
    }
  }, [branchApiDrawerOpen, branchSalesForm, bUnits, lines, hdr, branchPoNeedByDate, savedOrderNumber, orgRows]);
  const [arTxn, setArTxn] = useState<string | null>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);
  // Edit mode: the raw Fusion order lines (with child links) for the Billing /
  // Actual Costing tabs (the grid uses a simplified NewLine shape).
  const [rawLines, setRawLines] = useState<any[]>([]);
  useEffect(() => {
    if (!editMode) return;
    const key = editOrder?.OrderKey ?? editOrder?.HeaderId;
    if (key == null) return;
    fetchAllPages(`${FUSION_BASE}/salesOrdersForOrderHub/${encodeURIComponent(String(key))}/child/lines`)
      .then(setRawLines).catch(() => setRawLines([]));
  }, [editMode, editOrder, reloadKey]);
  const billingChildName = useMemo(() => {
    const names = new Set<string>();
    rawLines.forEach(l => (l.links ?? []).forEach((x: any) => { if (x.rel === 'child' && x.name) names.add(x.name); }));
    return Array.from(names).find(n => ['linedetails', 'linedetail'].includes(norm(n)));
  }, [rawLines]);
  // Whether any line is at a given status (checks the grid + the raw Fusion lines).
  const anyLineStatus = (re: RegExp) =>
    lines.some(l => re.test(`${l.status ?? ''} ${l.statusCode ?? ''}`)) ||
    rawLines.some(l => re.test(`${pf(l, ['DisplayStatus', 'Status', 'FulfillLineStatus']) ?? ''} ${pf(l, ['StatusCode']) ?? ''}`));
  const anyAwaitingShipping = anyLineStatus(/awaiting\s*shipping/i);
  const anyAwaitingBilling = anyLineStatus(/awaiting\s*billing/i);
  // Current order status — reservations are only allowed while it's still a draft.
  const [orderStatus, setOrderStatus] = useState<string>(String(editOrder?.StatusCode ?? ''));
  // Confirm pre-check — existing reservations shown before submitting the order.
  const [confirmResvOpen, setConfirmResvOpen] = useState(false);
  const [confirmResvList, setConfirmResvList] = useState<any[]>([]);
  const isDraftStatus = !orderStatus || /draft/i.test(orderStatus);
  // Reserve dialog — inventoryReservations (User Defined demand keyed by the
  // order number). Shows the exact endpoint + per-line JSON body before running.
  const RESERVE_URL = `${FUSION_BASE}/inventoryReservations`;
  const [reserveOpen, setReserveOpen] = useState(false);
  const [resvTab, setResvTab] = useState<'create' | 'view'>('view');
  const [resvList, setResvList] = useState<any[]>([]);
  const [resvListLoading, setResvListLoading] = useState(false);
  const [resvCount, setResvCount] = useState<number | null>(null);
  const [reserveRows, setReserveRows] = useState<{
    key: string; item: string; uom?: string; inventoryItemId?: any; organizationId?: any;
    lotControlled: boolean; options: ReserveOpt[]; lot?: string; subinventory?: string; qty: number;
    status?: number; ok?: boolean; errors?: string[]; response?: string;
  }[]>([]);
  // Return lot/serial viewer-editor (which shipped lots/serials to send back).
  const [retLsKey, setRetLsKey] = useState<string | null>(null);
  // Return (RMA) mode: live DOO_RETURN_REASON codes (fallback = static list).
  const [returnReasonOpts, setReturnReasonOpts] = useState(RETURN_REASONS);
  useEffect(() => {
    if (!returnMode) return;
    fetch(RETURN_REASON_LOV, { headers: getHeaders() })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(d => {
        const opts = (d.items ?? []).map((it: any) => ({ value: it.LookupCode, label: it.Meaning ?? it.LookupCode })).filter((o: any) => o.value);
        if (opts.length) setReturnReasonOpts(opts);
      })
      .catch(() => { /* keep fallback list */ });
  }, [returnMode]);
  // ── Extensible Flexfields (Additional Information) ────────────────────────
  // Discovered line EFF for the lot/cost auto-map (kept for backward compat),
  // plus the general header + line EFF contexts (all segments) so the user can
  // fill and upload additional information for the header and each line.
  const [effMeta, setEffMeta] = useState<EffMeta | null>(null);
  const [hdrEffCtxs, setHdrEffCtxs] = useState<EffCtx[]>([]);
  const [lineEffCtxs, setLineEffCtxs] = useState<EffCtx[]>([]);
  const [effDescribe, setEffDescribe] = useState<{ header?: any; line?: any }>({});
  // Selected header context (voName) + its segment values.
  const [hdrEffCtxSel, setHdrEffCtxSel] = useState<string | undefined>();
  const [hdrEffVals, setHdrEffVals] = useState<Record<string, string>>(initialDraft?.header?.effVals ?? {});
  // Existing EFF row hrefs captured on edit → used to PATCH the saved EFF in place.
  const [hdrEffVoHref, setHdrEffVoHref] = useState('');   // nested EffB VO row (PATCH target)
  const [hdrEffAiHref, setHdrEffAiHref] = useState('');   // parent additionalInformation row
  const [hdrEffSaving, setHdrEffSaving] = useState(false);
  const [isBranchBUDisabled, setIsBranchBUDisabled] = useState(false);  // disable branchBU field if it has a stored value
  useEffect(() => {
    const desc = (poly: string) => `${FUSION_BASE}/salesOrdersForOrderHub/describe?polymorphicType=${encodeURIComponent(poly)}`;
    fetch(desc('salesOrdersForOrderHub.lines.additionalInformation:DOO_FULFILL_LINES_ADD_INFO'), { headers: getHeaders() })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(d => { setEffDescribe(p => ({ ...p, line: d })); const ctx = parseEffContexts(d, 'DOO_FULFILL_LINES_ADD_INFO'); setEffMeta(parseEffDescribe(d) ?? FALLBACK_LINE_EFF_META); setLineEffCtxs(ctx.length ? ctx : FALLBACK_LINE_EFF); })
      .catch(() => { setEffMeta(FALLBACK_LINE_EFF_META); setLineEffCtxs(FALLBACK_LINE_EFF); });
    fetch(desc('salesOrdersForOrderHub.additionalInformation:DOO_HEADERS_ADD_INFO'), { headers: getHeaders() })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(d => { setEffDescribe(p => ({ ...p, header: d })); const ctx = parseEffContexts(d, 'DOO_HEADERS_ADD_INFO'); const use = ctx.length ? ctx : FALLBACK_HDR_EFF; setHdrEffCtxs(use); setHdrEffCtxSel(prev => prev ?? use[0]?.voName); })
      .catch(() => { setHdrEffCtxs(FALLBACK_HDR_EFF); setHdrEffCtxSel(prev => prev ?? FALLBACK_HDR_EFF[0]?.voName); });
  }, []);

  // Populate creditLimit in hdrEffVals when header.creditLimit is provided
  useEffect(() => {
    if (hdr.creditLimit !== undefined && hdr.creditLimit !== null) {
      setHdrEffVals(prev => ({
        ...prev,
        creditlimit: String(hdr.creditLimit)
      }));
    }
  }, [hdr.creditLimit]);

  const hdrEffActive = hdrEffCtxs.find(c => c.voName === hdrEffCtxSel);
  // Build the header additionalInformation child from the filled segments.
  const effHeaderChild = () => {
    if (!hdrEffActive) return null;
    const seg: Record<string, any> = { ContextCode: effContextFor(hdrEffActive) };
    hdrEffActive.segs.forEach(s => { const v = hdrEffVals[s.name]; if (v != null && v !== '') seg[s.name] = v; });
    if (Object.keys(seg).length <= 1) return null;
    return { Category: effCategoryFor(hdrEffActive), [hdrEffActive.voName]: [seg] };
  };
  // Save the header EFF against an existing order (edit mode) — PATCH the saved
  // segment row in place, else create the additionalInformation + nested VO.
  const saveHeaderEff = async () => {
    if (!hdrEffActive) { message.warning('No EFF context'); return; }
    const base = orderSelfHref(editOrder);
    const segVals: Record<string, any> = {};
    hdrEffActive.segs.forEach(s => { const v = hdrEffVals[s.name]; if (v != null && v !== '') segVals[s.name] = v; });
    if (Object.keys(segVals).length === 0) { message.warning('Enter at least one value'); return; }
    setHdrEffSaving(true);
    try {
      let r: Response;
      if (hdrEffVoHref) {
        // Update the existing segment row in place.
        r = await fetch(hdrEffVoHref, { method: 'PATCH', headers: { ...getHeaders(), 'Content-Type': 'application/vnd.oracle.adf.resourceitem+json' }, body: JSON.stringify(segVals) });
      } else if (hdrEffAiHref) {
        // Category row exists but no segment row yet — create the nested VO row.
        r = await fetch(`${hdrEffAiHref}/child/${hdrEffActive.voName}`, { method: 'POST', headers: { ...getHeaders(), 'Content-Type': 'application/vnd.oracle.adf.resourceitem+json' }, body: JSON.stringify({ ContextCode: effContextFor(hdrEffActive), ...segVals }) });
      } else if (base) {
        // Nothing yet — create the category row with the nested segment row inline.
        r = await fetch(`${base}/child/additionalInformation`, { method: 'POST', headers: { ...getHeaders(), 'Content-Type': 'application/vnd.oracle.adf.resourceitem+json' }, body: JSON.stringify({ Category: effCategoryFor(hdrEffActive), [hdrEffActive.voName]: [{ ContextCode: effContextFor(hdrEffActive), ...segVals }] }) });
      } else { message.error('No order reference to save against'); setHdrEffSaving(false); return; }
      const txt = await r.text();
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${txt.slice(0, 300)}`);
      // Capture hrefs from the response so a subsequent save PATCHes in place.
      try {
        const rd = JSON.parse(txt);
        const voSelf = (rd.links ?? []).find((x: any) => x.rel === 'self')?.href;
        if (voSelf && !hdrEffVoHref) setHdrEffVoHref(fusionHref(voSelf));
      } catch { /* non-JSON ok */ }
      message.success('Additional information saved');
    } catch (e: any) { message.error(`Save failed: ${e?.message ?? e}`); }
    finally { setHdrEffSaving(false); }
  };
  // Build one additionalInformation EFF entry for a line: auto lot/cost segments
  // plus any user-entered segment values (l.effVals). null when nothing to send.
  const effLineChild = (l: NewLine) => {
    const ctx = lineEffCtxs.find(c => c.voName === effMeta?.voName) ?? lineEffCtxs[0];
    const voName = effMeta?.voName ?? ctx?.voName;
    const flexCat = effMeta?.category ?? ctx?.category ?? 'DOO_FULFILL_LINES_ADD_INFO';
    const category = effCategoryFor({ category: flexCat });
    const contextCode = effContextFor({ category: flexCat, contextCode: effMeta?.contextCode ?? ctx?.contextCode ?? '' });
    if (!voName) return null;
    const seg: Record<string, any> = { ContextCode: contextCode };
    if (effMeta?.lotSeg && l.lot) seg[effMeta.lotSeg] = l.lot;
    // Cost rounded to 3 decimals to fit the numeric flexfield value set.
    if (effMeta?.costSeg && l.costUnit != null) seg[effMeta.costSeg] = Math.round(num(l.costUnit) * 1000) / 1000;
    // Auto-map ordered qty → the lot-quantity segment (lotqty) when present.
    const qtySeg = (ctx?.segs ?? effMeta?.segs ?? []).find(s => /lot.?qty|qty/i.test(s.name))?.name;
    if (qtySeg && l.qty != null && seg[qtySeg] == null) seg[qtySeg] = l.qty;
    if (l.effVals) for (const [k, v] of Object.entries(l.effVals)) { if (v != null && v !== '') seg[k] = v; }
    if (Object.keys(seg).length <= 1) return null; // only ContextCode → nothing to send
    return { Category: category, [voName]: [seg] };
  };
  // Active line EFF context (segments shown/edited per line).
  const lineEffActive = lineEffCtxs.find(c => c.voName === effMeta?.voName) ?? lineEffCtxs[0];
  const [lineEffSaving, setLineEffSaving] = useState<string>('');   // line key currently saving
  // Save every saved line's EFF in one action.
  const saveAllLineEff = async () => {
    if (!lineEffActive) { message.warning('No line EFF context'); return; }
    const targets = lines.filter(l => l.lineHref && !l.canceled);
    if (!targets.length) { message.warning('Save the order first, then update line additional info'); return; }
    setLineEffSaving('__all__');
    let ok = 0; const fails: string[] = [];
    for (const l of targets) {
      const vals: Record<string, any> = {};
      lineEffActive.segs.forEach(s => {
        let v: any = l.effVals?.[s.name];
        if (v == null || v === '') {
          if (s.name === effMeta?.lotSeg) v = l.lot;
          else if (s.name === effMeta?.costSeg) v = l.costUnit;
          else if (/lot.?qty|qty/i.test(s.name)) v = l.qty;
        }
        // Round the cost segment to 3 decimals to satisfy the numeric value set.
        if (s.name === effMeta?.costSeg && v != null && v !== '' && !isNaN(Number(v))) v = Math.round(Number(v) * 1000) / 1000;
        if (v != null && v !== '') vals[s.name] = v;
      });
      if (Object.keys(vals).length === 0) continue;
      try { await writeEffToRecord(fusionHref(l.lineHref!), lineEffActive, vals); ok++; }
      catch (e: any) { fails.push(`${l.itemNumber}: ${e?.message ?? e}`); }
    }
    setLineEffSaving('');
    if (fails.length) message.error(`Saved ${ok}, ${fails.length} failed — ${fails[0]}`);
    else message.success(`Additional info saved for ${ok} line(s)`);
  };
  // Inspector — show the EFF describe URLs and raw metadata (the "check").
  const showEffDescribe = () => {
    const key = editMode ? (editOrder?.OrderKey ?? `${editOrder?.SourceTransactionSystem ?? 'OPS'}:${editOrder?.SourceTransactionId ?? ''}`) : '{OrderKey}';
    Modal.info({
      title: 'Additional Information (EFF) — web services', width: 760,
      content: <div style={{ fontSize: 12 }}>
        <div style={{ marginBottom: 8 }}><b>Header EFF rows (GET):</b><br /><code style={{ wordBreak: 'break-all' }}>{`${FUSION_BASE}/salesOrdersForOrderHub/${encodeURIComponent(key)}/child/additionalInformation`}</code></div>
        <div style={{ marginBottom: 8 }}><b>Header EFF segments (GET):</b><br /><code style={{ wordBreak: 'break-all' }}>{`${FUSION_BASE}/salesOrdersForOrderHub/${encodeURIComponent(key)}/child/additionalInformation/{rowId}/child/${hdrEffActive?.voName ?? 'HeaderEffB<Context>privateVO'}`}</code></div>
        <div style={{ marginBottom: 8 }}><b>Header describe:</b> {hdrEffCtxs.length ? `${hdrEffCtxs.length} context(s): ${hdrEffCtxs.map(c => c.voName).join(', ')}` : 'none detected'}</div>
        <div style={{ marginBottom: 8 }}><b>Line describe:</b> {lineEffCtxs.length ? `${lineEffCtxs.length} context(s): ${lineEffCtxs.map(c => c.voName).join(', ')}` : 'none detected'}</div>
        <details><summary style={{ cursor: 'pointer' }}>Raw describe JSON</summary>
          <pre style={{ maxHeight: 320, overflow: 'auto', background: REDWOOD.neutral100, padding: 8, borderRadius: 6, fontSize: 10.5 }}>{JSON.stringify(effDescribe, null, 2).slice(0, 20000)}</pre></details>
      </div>,
    });
  };
  // Header-level default tax code — applied to every line when picked, and
  // inherited by new lines. New lines also default to it automatically.
  const [defaultTaxCode, setDefaultTaxCode] = useState<string | undefined>(initialDraft?.defaultTaxCode);
  const applyDefaultTax = (code?: string) => {
    setDefaultTaxCode(code);
    const opt = taxOptions.find(o => o.value === code);
    setLines(prev => prev.map(l => l.canceled ? l : {
      ...l, taxCode: code || undefined, taxPct: opt ? opt.pct : undefined,
      taxAmount: opt ? round2(num(l.qty) * num(l.unitPrice) * opt.pct / 100) : 0,
    }));
  };

  // Fetch currency conversion rate (txn → base, e.g. USD → AED)
  const onTxnCurrencyChange = async (frm: any) => {
    const baseCcy = frm.getFieldValue('baseCurrency');
    const txnCcy = frm.getFieldValue('txnCurrency');
    const orderDate = frm.getFieldValue('orderDate');

    // Set default rate type and date
    frm.setFieldsValue({
      currencyRateType: 'User',
      currencyDate: orderDate || dayjs()
    });

    // If same currency, set rate to 1
    if (!baseCcy || !txnCcy || baseCcy === txnCcy) {
      frm.setFieldsValue({ rate: 1 });
      setHdr(prev => ({ ...prev, rate: 1 }));
      return;
    }

    // Fetch conversion rate from daily rates webservice (txn → base)
    try {
      const params = new URLSearchParams({ from_currency: txnCcy, to_currency: baseCcy });
      const url = `${buildCurrencyUrl('currencies/dailyrates')}?${params}`;
      const res = await fetch(url);

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = (await res.text()).replace(/:\s*(-?)\.(\d)/g, ': $10.$2');
      const json = JSON.parse(raw);
      const items: any[] = json.items ?? json.data ?? (Array.isArray(json) ? json : []);

      if (items.length === 0) {
        message.info(`No rate found for ${txnCcy} → ${baseCcy}, please enter manually`);
        return;
      }

      // Pick the most recent date
      const latest = items.reduce((a: any, b: any) =>
        (a.rateDate ?? a.rate_date ?? '') > (b.rateDate ?? b.rate_date ?? '') ? a : b
      );
      const rate = Number(latest.rate ?? latest.RATE ?? 0);
      if (rate > 0) {
        frm.setFieldsValue({ rate });
        setHdr(prev => ({ ...prev, rate }));
        message.success(`✓ Conversion rate fetched: 1 ${txnCcy} = ${rate} ${baseCcy}`);
      } else {
        message.info(`Could not get valid rate for ${txnCcy} → ${baseCcy}, please enter manually`);
      }
    } catch (err) {
      console.error('Error fetching conversion rate:', err);
      message.warning('Could not fetch conversion rate automatically, please enter manually');
    }
  };

  const [discAmt, setDiscAmt] = useState(initialDraft?.discAmt ?? 0);
  const [expAmt, setExpAmt] = useState(initialDraft?.expAmt ?? 0);
  const [lineSearch, setLineSearch] = useState<Record<string, { loading?: boolean; tooShort?: boolean; opts: any[] }>>({});
  const [lotPick, setLotPick] = useState<{ key: string; item: string; rows: any[]; onh: Record<string, { loading?: boolean; qty?: number }>; qtyLoading?: boolean; hasMore?: boolean; offset?: number; loadingMore?: boolean } | null>(null);
  // Open the lot picker and fetch on-hand quantity per lot (shown in a Qty column).
  const openLotPick = (key: string, item: string, rows: any[], hasMore = false) => {
    setLotPick({ key, item, rows, onh: {}, qtyLoading: true, hasMore, offset: 0 });
    (async () => {
      try {
        const opt = await fetchReserveOptions(item, hdr.warehouse ?? '', undefined);
        const map: Record<string, { qty?: number }> = {};
        opt.options.forEach(o => { if (o.lot) map[o.lot] = { qty: (map[o.lot]?.qty ?? 0) + (o.qty || 0) }; });
        setLotPick(prev => (prev && prev.key === key && prev.item === item) ? { ...prev, onh: map, qtyLoading: false } : prev);
      } catch { setLotPick(prev => (prev && prev.key === key && prev.item === item) ? { ...prev, qtyLoading: false } : prev); }
    })();
  };
  const [itemModal, setItemModal] = useState<{ key: string; term: string; rows: any[] } | null>(null);
  const [itemFilter, setItemFilter] = useState('');
  const [ohLoading, setOhLoading] = useState(false);
  const searchTimer = useRef<Record<string, any>>({});
  const ccy = hdr.txnCurrency;
  // Order sequence (stands in for the APEX id) — generated once per new-order tab.
  const [orderSeq] = useState(() => Math.floor(Date.now() / 1000) % 100000);
  // Order number: {orderType}{YYYY}{MM}{seq} e.g. LSO01 → LSO012026071428.
  const orderNumber = useMemo(() => {
    // Editing an existing order → keep its own number, never regenerate one.
    if (editMode) return String(editOrder?.SourceTransactionNumber ?? editOrder?.OrderNumber ?? '');
    const d = hdr.orderDate ? dayjs(hdr.orderDate) : dayjs();
    return `${hdr.orderType || 'SO'}${d.format('YYYYMM')}${orderSeq}`;
  }, [hdr.orderType, hdr.orderDate, orderSeq, editMode, editOrder]);

  // Set default CustomerPONumber to Order No if not already set
  useEffect(() => {
    if (orderNumber && !hdr.customerPONumber) {
      form.setFieldsValue({ customerPONumber: orderNumber });
      setHdr(prev => ({ ...prev, customerPONumber: orderNumber }));
    }
  }, [orderNumber]);

  useEffect(() => {
    try {
      const h = initialDraft?.header ?? header;
      console.log('NewOrderTab: Initializing form with header:', h);
      if (!h) {
        console.error('NewOrderTab: Header is missing!', { initialDraft, header });
        return;
      }
      form.setFieldsValue(h as any);
      setHdr(h);
      console.log('NewOrderTab: Form initialized successfully');
      /* init once */
    } catch (e) {
      console.error('NewOrderTab: Form initialization error:', e);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-populate form when bUnits load (for initial header value set)
  const formInitRef = useRef(false);
  useEffect(() => {
    try {
      console.log('NewOrderTab: bUnits loaded, count:', bUnits.length);
      if (bUnits.length > 0 && !formInitRef.current) {
        const h = initialDraft?.header ?? header;
        if (h && h.businessUnit) {
          console.log('NewOrderTab: Setting businessUnit field to:', h.businessUnit);
          form.setFieldsValue({ businessUnit: h.businessUnit });
        }
        // Populate branchBU if editing a branch sales order
        if (h && h.branchBU && isBranchSales) {
          console.log('NewOrderTab: Populating branchBU for edit mode:', h.branchBU);
          form.setFieldsValue({ branchBU: h.branchBU });
          formInitRef.current = true;
        }
      }
    } catch (e) {
      console.error('NewOrderTab: Error re-populating form:', e);
    }
  }, [bUnits.length, isBranchSales]);

  // Update isBranchSales based on order type (initial load or change)
  useEffect(() => {
    if (hdr.orderType && orderTypeLookup.size > 0) {
      const lookupDetail = orderTypeLookup.get(hdr.orderType);
      const isBranch = lookupDetail && lookupDetail.Tag === 'BRANCH SALES';
      setIsBranchSales(isBranch);
    }
  }, [hdr.orderType, orderTypeLookup]);

  // Update inventoryTransactionFlag when isBranchSales changes (default true for branch sales)
  useEffect(() => {
    if (isBranchSales) {
      setInventoryTransactionFlag(true);
    }
  }, [isBranchSales]);

  // When editing a branch sales order, if branchBusinessUnit has a stored value in EFF or hdr.branchBU, disable the field
  const branchBUInitRef = useRef(false);
  useEffect(() => {
    if (editOrder && isBranchSales && !branchBUInitRef.current) {
      // Check if branchBU has a value from EFF or current form state
      const branchBuValue = hdrEffVals?.['branchBusinessUnit'] || hdr.branchBU;
      if (branchBuValue) {
        console.log('NewOrderTab: Disabling branchBU - already has value:', branchBuValue);
        if (hdrEffVals?.['branchBusinessUnit']) {
          form.setFieldsValue({ branchBU: hdrEffVals['branchBusinessUnit'] });
        }
        setIsBranchBUDisabled(true);
        branchBUInitRef.current = true;
      } else {
        setIsBranchBUDisabled(false);
      }
    } else if (!editOrder || !isBranchSales) {
      // Reset disabled state when not editing or not a branch sales order
      setIsBranchBUDisabled(false);
      branchBUInitRef.current = false;
    }
  }, [editOrder, isBranchSales, hdrEffVals, hdr.branchBU]);

  // Populate Branch BU and Branch Sales Order in EFF when values are selected
  const effSyncRef = useRef<string>('');
  useEffect(() => {
    if (hdrEffCtxs.length > 0) {
      const active = hdrEffCtxs.find(c => c.voName === hdrEffCtxSel);
      if (active) {
        const updates: Record<string, string> = {};

        // Sync Branch BU value
        if (hdr.branchBU) {
          const branchBuField = active.segs.find(s =>
            s.name.toLowerCase().includes('branch') && s.name.toLowerCase().includes('business')
          );
          if (branchBuField) {
            console.log('Syncing Branch BU to EFF:', { fieldName: branchBuField.name, value: hdr.branchBU });
            updates[branchBuField.name] = hdr.branchBU;
          }
        }

        // Sync Order number to branchsalesorder field
        if (orderNumber) {
          const branchSalesOrderField = active.segs.find(s =>
            s.name.toLowerCase().includes('branchsalesorder') || s.name.toLowerCase().includes('order')
          );
          if (branchSalesOrderField) {
            console.log('Syncing Branch Sales Order to EFF:', { fieldName: branchSalesOrderField.name, value: orderNumber });
            updates[branchSalesOrderField.name] = orderNumber;
          }
        }

        // Only update if values have changed
        const syncKey = JSON.stringify(updates);
        if (syncKey !== effSyncRef.current && Object.keys(updates).length > 0) {
          effSyncRef.current = syncKey;
          setHdrEffVals(v => ({ ...v, ...updates }));
        }
      }
    }
  }, [hdr.branchBU, orderNumber, hdrEffCtxs, hdrEffCtxSel]);

  // Fetch order types from standardLookups
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${FUSION_BASE}/standardLookups?q=LookupType LIKE 'ORA_DOO_ORDER_TYPES%'&expand=lookupCodes&onlyData=true&limit=500`, { headers: getHeaders() });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = await r.json();
        const items = d.items ?? [];
        if (items.length > 0 && items[0].lookupCodes) {
          const lookupMap = new Map<string, any>();
          const opts = items[0].lookupCodes
            .filter((lc: any) => lc.EnabledFlag === 'Y')
            .map((lc: any) => {
              lookupMap.set(lc.LookupCode, lc);
              return { value: lc.LookupCode, label: lc.Meaning };
            })
            .sort((a: any, b: any) => a.label.localeCompare(b.label));

          // Fetch branch PO codes for BRANCH SALES order types
          for (const lc of items[0].lookupCodes) {
            if (lc.EnabledFlag === 'Y' && lc.Tag === 'BRANCH SALES') {
              try {
                const url = `${FUSION_BASE}/standardLookups/ORA_DOO_ORDER_TYPES/child/lookupCodes/${lc.LookupCode}/child/lookupsDFF`;
                const res = await fetch(url, { headers: getHeaders() });
                if (res.ok) {
                  const data = await res.json();
                  const branchPoCode = data.items?.[0]?.branchPoCode;
                  if (branchPoCode) {
                    lookupMap.get(lc.LookupCode)!.branchPoCode = branchPoCode;
                  }
                }
              } catch (err) {
                console.warn(`Failed to fetch branch PO code for ${lc.LookupCode}:`, err);
              }
            }
          }

          setOrderTypeOpts(opts);
          setOrderTypeLookup(lookupMap);
        }
      } catch (err) {
        console.error('Error fetching order types:', err);
        setOrderTypeOpts([]);
      }
    })();
  }, []);

  // On edit: retrieve the saved header Additional Information (EFF) and prefill
  // the segment inputs so the change order re-sends / updates them.
  useEffect(() => {
    if (!editOrder) return;
    const base = orderSelfHref(editOrder);
    if (!base) return;
    (async () => {
      try {
        const r = await fetch(`${base}/child/additionalInformation?onlyData=false&limit=200`, { headers: getHeaders() });
        if (!r.ok) return;
        const d = await r.json();
        const items: any[] = Array.isArray(d) ? d : (d.items ?? []);
        for (const it of items) {
          const link = (it.links ?? []).find((x: any) => /EffB.+privateVO$/i.test(x.name || x.rel || ''));
          if (!link?.href) continue;
          const aiSelf = (it.links ?? []).find((x: any) => x.rel === 'self')?.href;
          if (aiSelf) setHdrEffAiHref(fusionHref(aiSelf));
          learnEff('DOO_HEADERS_ADD_INFO', it.Category ?? it.CategoryCode);   // real discriminator for writes
          const cr = await fetch(`${fusionHref(link.href)}?onlyData=false&limit=200`, { headers: getHeaders() });
          if (!cr.ok) continue;
          const cd = await cr.json();
          const seg = (Array.isArray(cd) ? cd : (cd.items ?? []))[0];
          if (!seg) continue;
          const voSelf = (seg.links ?? []).find((x: any) => x.rel === 'self')?.href;
          if (voSelf) setHdrEffVoHref(fusionHref(voSelf));
          learnEff('DOO_HEADERS_ADD_INFO', it.Category ?? it.CategoryCode, seg.ContextCode);
          const voName = (link.name || '').match(/EffB.+privateVO$/i)?.[0];
          const vals: Record<string, string> = {};
          for (const [k, v] of Object.entries(seg)) {
            if (!isEffSegment(k) || v == null || v === '') continue;
            vals[k] = String(v);
          }
          setHdrEffVals(prev => ({ ...vals, ...prev }));
          if (voName) setHdrEffCtxSel(prev => prev ?? voName);
          break; // first EFF row is the header context
        }
      } catch { /* no header EFF or not accessible */ }
    })();
  }, [editOrder]);

  // Edit mode: pull the existing order's lines and map them into the grid,
  // preserving each line's DOO source keys (for the change-order re-POST).
  useEffect(() => {
    if (!editOrder) return;
    const key = editOrder.OrderKey ?? editOrder.HeaderId;
    if (key != null) setCreatedOrderKey(String(key));
    const linesHref = editOrder?.links?.find((l: any) => l.name === 'lines')?.href
      ?? (key != null ? `${FUSION_BASE}/salesOrdersForOrderHub/${encodeURIComponent(key)}/child/lines` : '');
    if (!linesHref) return;
    // Expand charges (frozen tax lives in QP_EXCLUSIVE_TAX) and lotSerials (shown in
    // Lot Details) so opening the order surfaces tax + lots in one round-trip.
    const href = `${linesHref}${linesHref.includes('?') ? '&' : '?'}expand=charges.chargeComponents,lotSerials`;
    (async () => {
      try {
        const rows = await fetchAllPages(href);
        setLines(rows.map((l: any, i: number): NewLine => {
          const q = num(pf(l, ['OrderedQuantity']));
          const price = num(pf(l, ['UnitSellingPrice', 'UnitListPrice']));
          const linkOf = (name: string) => { const h = (l.links ?? []).find((x: any) => x.name === name && x.rel === 'child')?.href; return h ? fusionHref(h) : undefined; };
          const selfHref = (l.links ?? []).find((x: any) => x.rel === 'self')?.href;
          // The item's price + frozen tax live in the SALE charge (QP_SALE_PRICE /
          // ApplyTo PRICE). Freight/handling are separate charges rolled up as chargeAmount.
          const charges = l.charges?.items ?? l.charges ?? [];
          const compsOf = (c: any) => c ? (c.chargeComponents?.items ?? c.chargeComponents ?? []) : [];
          const netExtOf = (c: any) => { const cc = compsOf(c); const nc = cc.find((x: any) => x.PriceElementCode === 'QP_NET_PRICE') ?? cc.find((x: any) => x.PriceElementCode === 'QP_LIST_PRICE'); return num(pf(nc ?? {}, ['HeaderCurrencyExtendedAmount', 'ChargeCurrencyExtendedAmount'])) || num(pf(c, ['GSAUnitPrice'])); };
          const saleCharge = charges.find((c: any) => String(pf(c, ['ChargeDefinitionCode'])) === 'QP_SALE_PRICE')
            ?? charges.find((c: any) => String(pf(c, ['ApplyToCode', 'ApplyTo']) ?? '').toUpperCase() === 'PRICE')
            ?? charges.find((c: any) => String(c.PrimaryFlag) === 'true') ?? charges[0];
          const comps = compsOf(saleCharge);
          const taxComp = comps.find((c: any) => c.PriceElementCode === 'QP_EXCLUSIVE_TAX');
          const taxAmt = round2(taxComp ? num(pf(taxComp, ['HeaderCurrencyExtendedAmount', 'ChargeCurrencyExtendedAmount'])) : num(pf(l, ['TaxAmount', 'TotalTax'])));
          // Loaded net line amount AS STORED (QP_NET_PRICE ext → else line ExtendedAmount).
          const netComp = comps.find((c: any) => c.PriceElementCode === 'QP_NET_PRICE') ?? comps.find((c: any) => c.PriceElementCode === 'QP_LIST_PRICE');
          const loadedExtRaw = netComp ? num(pf(netComp, ['HeaderCurrencyExtendedAmount', 'ChargeCurrencyExtendedAmount'])) : num(pf(l, ['ExtendedAmount']));
          const loadedExt = loadedExtRaw ? round2(loadedExtRaw) : undefined;
          const basis = loadedExt ?? round2(price * q);          // derive tax % off the stored net
          // Sum of extra (non-sale) charges = freight/handling/etc.
          const chargeAmt = round2(charges.filter((c: any) => c !== saleCharge).reduce((s: number, c: any) => s + netExtOf(c), 0));
          // Tax classification code (often null even when tax applies) → fall back to
          // the tax rate name carried on the QP_EXCLUSIVE_TAX component.
          const taxCode = pf(l, ['TaxClassificationCode', 'TaxClassification', 'TaxCode'])
            ?? (taxComp ? pf(taxComp, ['TaxRateName', 'TaxClassificationCode', 'TaxCode']) : undefined);
          const taxPct = (basis && taxAmt) ? round2((taxAmt / basis) * 100) : undefined;
          const lotSerials = l.lotSerials?.items ?? l.lotSerials ?? [];
          return {
            key: `edit-${pf(l, ['FulfillLineId']) ?? pf(l, ['SourceTransactionLineId']) ?? i}`,
            itemNumber: String(pf(l, ['ProductNumber', 'Product', 'ItemNumber']) ?? ''),
            description: pf(l, ['ProductDescription', 'ItemDescription']),
            uom: pf(l, ['OrderedUOMCode', 'OrderedUOM']),
            qty: q, unitPrice: price, origQty: q, origUnitPrice: price,
            taxCode, taxPct, taxAmount: taxAmt || undefined,
            loadedExt, loadedTax: taxAmt || undefined, chargeAmount: chargeAmt || undefined,
            status: pf(l, ['DisplayStatus', 'Status']),
            statusCode: pf(l, ['StatusCode']),
            srcLineId: pf(l, ['SourceTransactionLineId']) != null ? String(pf(l, ['SourceTransactionLineId'])) : undefined,
            srcLineNumber: pf(l, ['SourceTransactionLineNumber']),
            srcScheduleNumber: pf(l, ['SourceScheduleNumber', 'SourceTransactionScheduleId']),
            fulfillLineId: pf(l, ['FulfillLineId']),
            lineHref: selfHref,
            chargesHref: linkOf('charges'), lotSerialsHref: linkOf('lotSerials'),
            lineLots: Array.isArray(lotSerials) ? lotSerials : [],
            orgCode: pf(l, ['RequestedFulfillmentOrganizationCode', 'FulfillmentOrganizationCode', 'OrganizationCode']),
            // Subinventory can echo back under several attribute names — scan for any
            // *subinventory* key with a value rather than guessing one.
            subinventory: (() => {
              const k = Object.keys(l).find(k => /subinventory/i.test(k) && l[k] != null && l[k] !== '');
              return k ? String(l[k]) : (pf(l, ['SubinventoryCode', 'Subinventory']) as string | undefined);
            })(),
            existing: true,
          };
        }));
        // Subinventory is stored per line; bring the saved value into the header
        // field on edit (mirrors what create sent). Scan for any *subinventory* key.
        const subOf = (l: any) => { const k = Object.keys(l).find(k => /subinventory/i.test(k) && l[k] != null && l[k] !== ''); return k ? String(l[k]) : undefined; };
        const savedSub = rows.map(subOf).find(Boolean);
        if (savedSub) { form.setFieldsValue({ subinventory: savedSub }); setHdr(prev => ({ ...prev, subinventory: String(savedSub) })); }
      } catch (e: any) { message.error(`Failed to load order lines: ${e.message}`); }
      finally { setRefreshing(false); }
    })();
  }, [editOrder, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // On edit: retrieve each saved line's Additional Information (EFF) and prefill
  // the per-line segment inputs (lines → additionalInformation → FulfillLineEffB VO).
  // Guarded on effVals == null so it runs once per (re)load, not on every keystroke.
  const lineEffLoadRef = useRef(false);
  useEffect(() => {
    if (!editMode || lineEffLoadRef.current) return;
    const todo = lines.filter(l => l.lineHref && l.existing && l.effVals == null);
    if (!todo.length) {
      lineEffLoadRef.current = true;
      return;
    }
    (async () => {
      for (const l of todo) {
        const vals: Record<string, string> = {};
        try {
          const effRows = await fetchEffRows(fusionHref(l.lineHref!));
          const first = effRows.find(r => r.segs.length);
          if (first) first.segs.forEach(s => { vals[s.k] = typeof s.v === 'object' ? JSON.stringify(s.v) : String(s.v); });
        } catch { /* line has no EFF */ }
        // Mark effVals (even if empty {}) so this line isn't re-fetched next render.
        setLines(prev => prev.map(x => x.key === l.key && x.effVals == null ? { ...x, effVals: vals } : x));
      }
      lineEffLoadRef.current = true;
    })();
  }, [editMode]);

  // Tax code often comes back null on the line even when tax applies. Once the BU's
  // tax codes load, back-fill any line that has a derived tax % but no recognised
  // code by matching the rate — unambiguous only when a single code carries that %.
  useEffect(() => {
    if (!taxOptions.length) return;
    setLines(prev => {
      let changed = false;
      const next = prev.map(l => {
        if (l.taxPct == null || l.taxPct === 0) return l;
        if (l.taxCode && taxOptions.some(o => o.value === l.taxCode)) return l; // already valid
        const hits = taxOptions.filter(o => round2(o.pct) === round2(num(l.taxPct)));
        if (hits.length === 1) { changed = true; return { ...l, taxCode: hits[0].value }; }
        return l;
      });
      return changed ? next : prev;
    });
  }, [taxOptions]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Save / Load the full draft (header + all lines) as JSON ──
  const saveDraftJson = () => {
    const draft = { __type: SO_DRAFT_TYPE, version: 1, orderNumber, header: hdr, lines, discAmt, expAmt };
    downloadJson(draft, `sales-order-${orderNumber || 'draft'}.json`);
    message.success('Order saved to JSON');
  };
  const loadDraftJson = async (file: File) => {
    try {
      const draft = toSoDraft(await readJsonFile(file));
      if (!draft) { message.error('Not a sales-order JSON (missing header/lines)'); return; }
      setHdr(draft.header);
      form.setFieldsValue(draft.header as any);
      setLines(draft.lines);
      setDiscAmt(draft.discAmt ?? 0);
      setExpAmt(draft.expAmt ?? 0);
      message.success(`Loaded ${draft.lines.length} line(s) from JSON`);
    } catch (e: any) { message.error(`Load failed: ${e.message}`); }
  };

  const syncHdr = () => setHdr(prev => ({ ...prev, ...form.getFieldsValue() }));
  const loadSubs = useCallback((org?: string) => {
    if (!org) { setSubs([]); return; }
    fetch(`${FUSION_BASE}/subinventories?q=OrganizationCode=${encodeURIComponent(org)}&onlyData=true&limit=500`, { headers: getHeaders() })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => setSubs(Array.from(new Set((d.items ?? []).map((s: any) => s.SecondaryInventoryName).filter(Boolean))).sort() as string[])).catch(() => setSubs([]));
  }, []);
  useEffect(() => { loadSubs(header.warehouse); }, [header.warehouse, loadSubs]);

  const buName = (Form.useWatch('businessUnit', form) as string) ?? hdr.businessUnit;
  const buRow = useMemo(() => bUnits.find(b => b.businessUnitName === buName), [bUnits, buName]);
  const whOptions = useMemo(() => orgOptionsForBU(orgRows, buRow), [orgRows, buRow]);

  const onBU = (name: string) => {
    const row = bUnits.find(b => b.businessUnitName === name);
    const cur = pf(row, ['paymentCurrency', 'ledgerCurrency', 'invoiceCurrency']);
    form.setFieldsValue({ baseCurrency: cur, txnCurrency: form.getFieldValue('txnCurrency') || cur, warehouse: undefined, subinventory: undefined });
    setSubs([]); setHdr(prev => ({ ...prev, ...form.getFieldsValue(), businessUnitId: row?.businessUnitId }));
  };
  const onWh = (code: string) => { form.setFieldsValue({ subinventory: undefined }); loadSubs(code); syncHdr(); };
  const onCustomer = (name: string, opt: any) => { const row = opt?._c ?? customers.find(c => custName(c) === name); if (row) { const fill = customerFill(row); form.setFieldsValue(fill); setHdr(prev => ({ ...prev, ...fill })); } };
  const onCustomerBipSelect = (customer: CustomerSearchResult) => {
    const fill = convertBipCustomerToFill(customer);
    form.setFieldsValue(fill);
    setHdr(prev => ({ ...prev, ...fill }));
  };

  const onBranchBUChange = useCallback((buName: string) => {
    const bu = bUnits.find(b => b.businessUnitName === buName);
    if (bu) {
      const baseCcy = pf(bu, ['paymentCurrency', 'ledgerCurrency', 'invoiceCurrency']);
      const txnCcy = hdr.txnCurrency || branchSalesForm.getFieldValue('currency');
      const conversionRate = (txnCcy === baseCcy) ? 1 : hdr.rate || 1;
      setBranchBUData({ baseCurrency: baseCcy, conversionRate });

      const filterQuery = `ManagementBusinessUnitName=${buName}`;
      const url = `${FUSION_BASE}/inventoryOrganizations?q=${filterQuery}&onlyData=true&limit=500`;

      console.log('Fetching inventory organizations:', { buName, url, headers: getHeaders() });
      fetch(url, { headers: getHeaders() })
        .then(r => {
          console.log('Ship-To Locations Response Status:', r.status, r.statusText);
          return r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}: ${r.statusText}`));
        })
        .then(d => {
          console.log('Ship-To Locations Raw Response:', d);
          const orgs = d.items ?? d ?? [];
          console.log('Branch BU Change - Ship-To Locations:', { buName, bu, orgsCount: orgs.length, orgs });
          setBranchShipToOrgs(orgs);
        })
        .catch(err => {
          console.error('Failed to fetch ship-to locations:', { err: err.message, url, buName });
          const filteredOrgs = orgRows.filter((o: any) => {
            const orgBuName = pf(o, ['BusinessUnitName', 'business_unit_name']);
            return orgBuName === buName;
          });
          console.log('Using fallback - filtered local orgs:', filteredOrgs);
          setBranchShipToOrgs(filteredOrgs);
        });

      setBranchPoNeedByDate(dayjs().add(7, 'days'));
    }
  }, [bUnits, hdr.txnCurrency, hdr.rate, branchSalesForm, orgRows]);

  const fetchCustomerBalance = useCallback(async () => {
    if (!hdr.accountNumber) {
      message.warning('Please select a customer first');
      return;
    }
    setCreditCheckLoading(true);
    setCreditCheckError(null);
    setCreditCheckApiUrl('');
    setCreditCheckApiResponse('');
    try {
      const url = `${FUSION_BASE}/receivablesCustomerAccountSiteActivities?limit=50&q=AccountNumber=${encodeURIComponent(hdr.accountNumber)}`;
      console.log('Fetching customer balance from:', url);
      setCreditCheckApiUrl(url);
      const r = await fetch(url, { headers: getHeaders() });
      if (r.ok) {
        const data = await r.json();
        console.log('Customer balance data:', data);

        // Extract BillToSiteUseId from first item to fetch transaction payment schedules
        if (data.items && data.items.length > 0) {
          const billToSiteUseId = data.items[0].BillToSiteUseId;
          if (billToSiteUseId) {
            try {
              const txnUrl = `${FUSION_BASE}/receivablesCustomerAccountSiteActivities/${billToSiteUseId}/child/transactionPaymentSchedules?limit=500&offset=0&q=InstallmentStatus='Open'`;
              console.log('Fetching transaction payment schedules from:', txnUrl);
              const txnR = await fetch(txnUrl, { headers: getHeaders() });
              if (txnR.ok) {
                const txnData = await txnR.json();
                console.log('Transaction payment schedules:', txnData);
                // Merge transaction data with site data for aging calculation
                data.transactionSchedules = txnData.items ?? [];
              } else {
                console.warn('Failed to fetch transaction schedules:', txnR.status);
              }
            } catch (txnErr) {
              console.warn('Error fetching transaction schedules:', txnErr);
            }
          }
        }

        setCreditCheckApiResponse(JSON.stringify(data, null, 2));
        setCreditCheckData(data);
      } else {
        const errText = await r.text();
        const errMsg = `HTTP ${r.status}: ${r.statusText}`;
        setCreditCheckApiResponse(`Error: ${errMsg}\n\n${errText.slice(0, 1000)}`);
        console.error('Credit check failed:', errMsg, errText.slice(0, 500));
        setCreditCheckError(errMsg);
        message.error(`Failed to fetch customer balance: ${errMsg}`);
      }
    } catch (e: any) {
      const errMsg = e?.message || String(e);
      setCreditCheckApiResponse(`Exception: ${errMsg}`);
      console.error('Error fetching customer balance:', errMsg);
      setCreditCheckError(errMsg);
      message.error(`Error fetching customer balance: ${errMsg}`);
    } finally {
      setCreditCheckLoading(false);
    }
  }, [hdr.accountNumber]);

  const fetchBranchSuppliers = useCallback(async (term: string) => {
    if (!term || term.length < 2) {
      setBranchSuppliers([]);
      return;
    }
    try {
      const url = `${FUSION_BASE}/suppliers?q=Supplier LIKE '*${term}*' OR SupplierNumber LIKE '*${term}*'&limit=20&expand=sites&onlyData=true`;
      console.log('Fetching suppliers with URL:', url);
      const r = await fetch(url, { headers: getHeaders() });
      if (r.ok) {
        const data = await r.json();
        console.log('Supplier search response:', data);
        setBranchSuppliers(data.items ?? []);
      } else {
        console.error('Supplier search failed:', r.status, r.statusText);
        const text = await r.text();
        console.error('Response:', text.slice(0, 500));
        message.error(`Supplier search failed: HTTP ${r.status} ${r.statusText}`);
      }
    } catch (e) {
      console.error('Failed to fetch suppliers:', e);
      message.error(`Error fetching suppliers: ${e}`);
    }
  }, []);

  const onOrderTypeChange = (orderTypeCode: string) => {
    const lookupDetail = orderTypeLookup.get(orderTypeCode);
    const isBranch = lookupDetail && lookupDetail.Tag === 'BRANCH SALES';
    setIsBranchSales(isBranch);
    if (isBranch) {
      message.info('⚠️ This is a Branch Sales order. Additional branch details will be required after saving.');
    }
  };

  const addItems = (items: any[]) => {
    setLines(prev => {
      const existing = new Set(prev.map(l => l.itemNumber));
      const add = items.filter(it => !existing.has(it.ItemNumber)).map((it, i) => ({
        key: `${it.ItemNumber}-${prev.length + i}`, itemNumber: it.ItemNumber,
        description: it.ItemDescription, uom: pf(it, ['PrimaryUOMValue', 'PrimaryUOMCode', 'UOMCode']),
        // Unit price only from a price-list price (_price) — never defaulted to cost.
        qty: num(it._qty), unitPrice: it._price != null ? num(it._price) : 0,
        costUnit: num(it._cost),
        // Prefer the item's own tax; fall back to the header default tax code.
        taxCode: it._taxCode ?? defaultTaxCode,
        taxPct: it._taxPct != null ? num(it._taxPct) : (it._taxCode ? undefined : taxOptions.find(o => o.value === defaultTaxCode)?.pct),
        taxAmount: num(it._tax),
        lot: it._lot, lots: (it._lots && it._lots.length) ? it._lots : (it._lot ? [it._lot] : []),
        qoh: it._qoh != null ? num(it._qoh) : undefined,
      }));
      return [...prev, ...add];
    });
  };
  const upd = (key: string, patch: Partial<NewLine>) => setLines(prev => prev.map(l => l.key === key ? { ...l, ...patch } : l));
  // Like upd, but re-derives tax from tax_code_per whenever qty/price/tax code change.
  const updLine = (key: string, patch: Partial<NewLine>) => setLines(prev => prev.map(l => {
    if (l.key !== key) return l;
    const m = { ...l, ...patch };
    if (m.taxPct != null) m.taxAmount = round2(num(m.qty) * num(m.unitPrice) * num(m.taxPct) / 100);
    return m;
  }));
  // The exact REST request used to remove a line. Line-level DELETE is not enabled
  // on the order hub, so a DRAFT line is removed with a header PATCH that zeroes its
  // ordered quantity (change-order style); a processing line is canceled via
  // PATCH { CanceledFlag } on the line. Returned so the confirm dialog can show it.
  const lineRemoveRequest = (l: NewLine) => {
    const orderKey = editOrder?.OrderKey ?? editOrder?.HeaderId;
    const headerUrl = `${FUSION_BASE}/salesOrdersForOrderHub/${encodeURIComponent(String(orderKey))}`;
    const draft = isDraftStatus;
    if (draft) {
      const body = { lines: [{
        SourceTransactionLineId: String(l.srcLineId ?? l.fulfillLineId ?? ''),
        SourceTransactionScheduleId: String(l.srcScheduleNumber ?? l.srcLineId ?? ''),
        OrderedQuantity: 0,
      }] };
      return { href: headerUrl, draft, method: 'PATCH', body, hasKeys: !!(l.srcLineId ?? l.fulfillLineId) };
    }
    const lineHref = l.lineHref ? fusionHref(l.lineHref)
      : (l.fulfillLineId != null ? `${headerUrl}/child/lines/${l.fulfillLineId}` : '');
    return { href: lineHref, draft, method: 'PATCH', body: { CanceledFlag: true, CancelReasonCode: 'CUSTOMER_REQUEST' }, hasKeys: !!lineHref };
  };

  // Remove an EXISTING line immediately (after confirmation).
  const removeExistingLine = async (l: NewLine) => {
    const { href, draft, method, body } = lineRemoveRequest(l);
    if (!href) { message.error('No line id available to remove'); return; }
    try {
      const r = await fetch(href, { method, headers: { ...getHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const text = await r.text(); let data: any = null, pretty = text;
      try { data = JSON.parse(text); pretty = JSON.stringify(data, null, 2); } catch { /* raw */ }
      setLastResponse(`${method} ${href}\n${JSON.stringify(body)}\nHTTP ${r.status}\n\n${pretty}`);
      if (r.ok) {
        // Draft: the line is zeroed (still present in Fusion at qty 0) → drop it from
        // the grid. Processing: it stays as a canceled line.
        if (draft) { setLines(prev => prev.filter(x => x.key !== l.key)); message.success(`Line ${l.itemNumber} removed (qty set to 0)`); }
        else { upd(l.key, { canceled: true, cancelSaved: true, status: 'Canceled', statusCode: data?.StatusCode, error: undefined }); message.success(`Line ${l.itemNumber} canceled`); }
      } else {
        const msgs = collectOrderErrors(data, text, true);
        upd(l.key, { error: [`${method} ${href}`, JSON.stringify(body), `HTTP ${r.status}`, ...(msgs.length ? msgs : [])].join('\n\n') });
        message.error(`${draft ? 'Remove' : 'Cancel'} failed — see the red ✗ / Errors tab`);
      }
    } catch (e: any) { upd(l.key, { error: [`${method} ${href}`, e?.message].filter(Boolean).join('\n\n') }); message.error(e?.message || 'Request failed'); }
  };

  // Trash-icon handler: confirm first (showing the exact URL + payload), then run
  // the web service. Unsaved (new / create-mode) lines just drop locally.
  const confirmRemoveLine = (l: NewLine) => {
    if (!editMode || !l.existing) {
      Modal.confirm({ title: 'Remove this line?', content: `${l.itemNumber || 'This line'} will be removed from the order.`, okText: 'Remove', okButtonProps: { danger: true }, onOk: () => setLines(prev => prev.filter(x => x.key !== l.key)) });
      return;
    }
    const { href, draft, method, body, hasKeys } = lineRemoveRequest(l);
    Modal.confirm({
      title: draft ? 'Remove this line?' : 'Cancel this line?',
      width: 660, icon: <ApiOutlined style={{ color: draft ? REDWOOD.error : REDWOOD.primary }} />,
      content: (
        <div>
          <div style={{ marginBottom: 10 }}>
            {draft
              ? <span>Line <b>{l.itemNumber}</b> will be removed by setting its ordered quantity to <b>0</b> (line-level delete isn’t supported on the order hub).</span>
              : <span>Line <b>{l.itemNumber}</b> will be canceled and stays on the order as a canceled line.</span>}
          </div>
          <div style={{ fontSize: 11, fontFamily: 'monospace', wordBreak: 'break-all', background: REDWOOD.neutral100, border: `1px solid ${REDWOOD.neutral200}`, borderRadius: 6, padding: '8px 10px' }}>
            <div><b style={{ color: draft ? REDWOOD.error : REDWOOD.primary }}>{method}</b> {href || '(no order key)'}</div>
            <div style={{ marginTop: 4 }}>{JSON.stringify(body)}</div>
          </div>
          {!hasKeys && <div style={{ marginTop: 8, color: REDWOOD.error, fontSize: 12 }}>Missing source line keys — reload the order before removing.</div>}
        </div>
      ),
      okText: draft ? 'Remove line' : 'Cancel line', okButtonProps: { danger: true, disabled: !hasKeys }, cancelText: 'Keep',
      onOk: () => removeExistingLine(l),
    });
  };

  // Line-Total drill → GET the line's charges child (with components) live from Fusion.
  const openChargeDrill = async (l: NewLine) => {
    const base = l.chargesHref ?? (l.lineHref ? `${fusionHref(l.lineHref)}/child/charges` : undefined);
    if (!base) { message.warning('No charges link on this line — save the order first'); return; }
    const url = `${base}${base.includes('?') ? '&' : '?'}expand=chargeComponents`;
    setChargeDrill({ line: l, loading: true, url, charges: [] });
    try {
      const r = await fetch(url, { headers: getHeaders() });
      const d = await r.json().catch(() => ({} as any));
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setChargeDrill({ line: l, loading: false, url, charges: d.items ?? [] });
    } catch (e: any) { setChargeDrill({ line: l, loading: false, url, charges: [], error: e?.message }); }
  };

  // Order key for order-level children (sales credits, notes, attachments, header PATCH).
  const childOrderKey = String((editMode ? (editOrder?.OrderKey ?? editOrder?.HeaderId) : createdOrderKey) ?? '');
  // Re-fetch each existing line's charges and recompute its non-sale charge total
  // (used after adding/deleting charges so the grid + totals reflect them).
  const refreshLineCharges = async () => {
    const netExtOf = (c: any) => { const cc = c.chargeComponents?.items ?? c.chargeComponents ?? []; const nc = cc.find((x: any) => x.PriceElementCode === 'QP_NET_PRICE') ?? cc.find((x: any) => x.PriceElementCode === 'QP_LIST_PRICE'); return num(pf(nc ?? {}, ['HeaderCurrencyExtendedAmount', 'HeaderCurrencyUnitPrice'])) || num(pf(c, ['GSAUnitPrice'])); };
    const updated = await Promise.all(lines.map(async (l) => {
      if (!l.existing) return null;
      const url = l.chargesHref ?? (l.lineHref ? `${fusionHref(l.lineHref)}/child/charges` : (l.fulfillLineId != null ? `${FUSION_BASE}/salesOrdersForOrderHub/${encodeURIComponent(childOrderKey)}/child/lines/${l.fulfillLineId}/child/charges` : ''));
      if (!url) return null;
      try {
        const r = await fetch(`${url}${url.includes('?') ? '&' : '?'}expand=chargeComponents&limit=50`, { headers: getHeaders() });
        const d = await r.json().catch(() => ({} as any));
        const charges = d.items ?? [];
        const saleCharge = charges.find((c: any) => String(pf(c, ['ChargeDefinitionCode'])) === 'QP_SALE_PRICE')
          ?? charges.find((c: any) => String(pf(c, ['ApplyToCode', 'ApplyTo']) ?? '').toUpperCase() === 'PRICE')
          ?? charges.find((c: any) => String(c.PrimaryFlag) === 'true') ?? charges[0];
        return { key: l.key, chargeAmount: round2(charges.filter((c: any) => c !== saleCharge).reduce((s: number, c: any) => s + netExtOf(c), 0)) || undefined };
      } catch { return null; }
    }));
    setLines(prev => prev.map(l => { const u = updated.find(x => x && x.key === l.key); return u ? { ...l, chargeAmount: u.chargeAmount } : l; }));
  };
  // Header Refresh — re-pull the whole order (lines + charges + tax + lots + raw
  // lines + sales credits) from Fusion; the load effects clear the busy flag.
  const refreshOrder = () => {
    if (!editMode) { message.warning('Nothing to refresh yet'); return; }
    setRefreshing(true);
    setReloadKey(k => k + 1);
    salesCredits.reload();
    setResvReloadKey(k => k + 1);
    message.success('Refreshing order…');
  };
  const openOrderTotals = async () => {
    if (!childOrderKey) { message.warning('Save the order first to see Fusion totals'); return; }
    const url = `${FUSION_BASE}/salesOrdersForOrderHub/${encodeURIComponent(childOrderKey)}/child/totals?limit=200`;
    setTotals({ open: true, loading: true, url, rows: [] });
    try {
      const r = await fetch(url, { headers: getHeaders() });
      const d = await r.json().catch(() => ({} as any));
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setTotals({ open: true, loading: false, url, rows: d.items ?? [] });
    } catch (e: any) { setTotals({ open: true, loading: false, url, rows: [], error: e?.message }); }
  };
  // Sales credits — shown read-only in the header + editable on the Sales Credits tab.
  const salesCredits = useSalesCredits(childOrderKey || undefined);
  const [scEdit, setScEdit] = useState<ScEdit>(null);
  const scTotal = salesCredits.rows.reduce((s, r) => s + num(pf(r, ['Percent'])), 0);
  const addSalesCredit = () => setScEdit({ percent: round2(Math.max(0, 100 - scTotal)) });
  const editSalesCredit = (row: any) => setScEdit({ href: scSelfHref(row), salesRep: pf(row, ['Salesperson', 'SalespersonName']), percent: num(pf(row, ['Percent'])) });
  const deleteSalesCredit = (row: any) => Modal.confirm({
    title: 'Delete this sales credit?', okText: 'Delete', okButtonProps: { danger: true },
    content: <div style={{ fontSize: 12, fontFamily: 'monospace', wordBreak: 'break-all' }}>DELETE {scSelfHref(row)}</div>,
    onOk: async () => {
      try { const r = await fetch(scSelfHref(row), { method: 'DELETE', headers: getHeaders() }); if (!r.ok && r.status !== 204) throw new Error(`HTTP ${r.status}`); message.success('Sales credit deleted'); salesCredits.reload(); }
      catch (e: any) { message.error(e?.message || 'Delete failed'); }
    },
  });

  // Header edit lock — in edit mode everything is read-only until the pencil is
  // clicked; only Order Date and Order Type ever become editable.
  const [hdrUnlocked, setHdrUnlocked] = useState(false);
  const [hdrSaving, setHdrSaving] = useState(false);
  const saveHeaderFields = async () => {
    if (!childOrderKey) return;
    setHdrSaving(true);
    const cur = form.getFieldsValue();
    const iso = cur.orderDate ? dayjs(cur.orderDate).format('YYYY-MM-DD[T]00:00:00[Z]') : undefined;
    const body: any = {
      ...(cur.orderType ? { TransactionTypeCode: cur.orderType, TransactionType: cur.orderType } : {}),
      ...(iso ? { TransactionOn: iso, RequestedShipDate: iso } : {}),
    };
    const url = `${FUSION_BASE}/salesOrdersForOrderHub/${encodeURIComponent(childOrderKey)}`;
    try {
      const r = await fetch(url, { method: 'PATCH', headers: { ...getHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const t = await r.text(); let data: any = null; try { data = JSON.parse(t); } catch { /* raw */ }
      setLastResponse(`PATCH ${url}\n${JSON.stringify(body)}\nHTTP ${r.status}\n\n${t}`);
      if (!r.ok) throw new Error(collectOrderErrors(data, t, true)[0] || `HTTP ${r.status}`);
      message.success('Order header updated'); setHdrUnlocked(false);
    } catch (e: any) { message.error(e?.message || 'Header update failed'); }
    finally { setHdrSaving(false); }
  };

  // Shipping & packing instructions — PATCHed onto the order header.
  const [shipPack, setShipPack] = useState({
    packing: editOrder?.PackingInstructions ?? '', shipping: editOrder?.ShippingInstructions ?? '', fob: editOrder?.FOBPointCode ?? editOrder?.FOBPoint ?? undefined as string | undefined,
  });
  const [shipPackSaving, setShipPackSaving] = useState(false);

  // Auto-include Branch BU in packing instructions for branch sales orders
  useEffect(() => {
    if (isBranchSales && hdr.branchBU && editMode) {
      // For existing orders in edit mode, prepend Branch BU to packing instructions if not already there
      const packingText = shipPack.packing || '';
      if (!packingText.includes(hdr.branchBU)) {
        const branchBuPrefix = `Branch BU: ${hdr.branchBU}\n`;
        const updatedPacking = branchBuPrefix + packingText;
        setShipPack(s => ({ ...s, packing: updatedPacking }));
      }
    }
  }, [isBranchSales, hdr.branchBU, editMode]);

  const saveShipPack = async () => {
    if (!childOrderKey) { message.warning('Save the order first'); return; }
    setShipPackSaving(true);
    const body = { PackingInstructions: shipPack.packing || null, ShippingInstructions: shipPack.shipping || null, FOBPointCode: shipPack.fob || null };
    const url = `${FUSION_BASE}/salesOrdersForOrderHub/${encodeURIComponent(childOrderKey)}`;
    try {
      const r = await fetch(url, { method: 'PATCH', headers: { ...getHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const t = await r.text(); let data: any = null; try { data = JSON.parse(t); } catch { /* raw */ }
      setLastResponse(`PATCH ${url}\n${JSON.stringify(body)}\nHTTP ${r.status}\n\n${t}`);
      if (!r.ok) throw new Error(collectOrderErrors(data, t, true)[0] || `HTTP ${r.status}`);
      message.success('Shipping & packing instructions saved');
    } catch (e: any) { message.error(e?.message || 'Save failed'); }
    finally { setShipPackSaving(false); }
  };

  // Order Actions — Cancel Order (cancel every line) / Discard Draft (delete order).
  const [orderActionBusy, setOrderActionBusy] = useState(false);
  const discardDraft = () => Modal.confirm({
    title: 'Discard this draft order?', okText: 'Discard order', okButtonProps: { danger: true }, cancelText: 'Keep',
    icon: <ApiOutlined style={{ color: REDWOOD.error }} />,
    content: <div><div style={{ marginBottom: 8 }}>The entire draft order will be <b>permanently deleted</b> from Fusion.</div>
      <div style={{ fontSize: 11, fontFamily: 'monospace', wordBreak: 'break-all', background: REDWOOD.neutral100, borderRadius: 6, padding: '8px 10px' }}><b style={{ color: REDWOOD.error }}>DELETE</b> …/salesOrdersForOrderHub/{childOrderKey}</div></div>,
    onOk: async () => {
      setOrderActionBusy(true);
      const url = `${FUSION_BASE}/salesOrdersForOrderHub/${encodeURIComponent(childOrderKey)}`;
      try {
        const r = await fetch(url, { method: 'DELETE', headers: getHeaders() });
        setLastResponse(`DELETE ${url}\nHTTP ${r.status}`);
        if (!r.ok && r.status !== 204) { const t = await r.text(); throw new Error(collectOrderErrors(null, t, true)[0] || `HTTP ${r.status}`); }
        message.success('Draft order discarded'); setLines([]); setConfirmed(false);
      } catch (e: any) { message.error(e?.message || 'Discard failed'); }
      finally { setOrderActionBusy(false); }
    },
  });
  const cancelOrder = () => {
    const orderKey = editOrder?.OrderKey ?? editOrder?.HeaderId ?? createdOrderKey;
    const targets = lines.filter(l => l.existing && !l.canceled);
    Modal.confirm({
      title: 'Cancel this order?', okText: 'Cancel order', okButtonProps: { danger: true }, cancelText: 'Keep',
      icon: <StopOutlined style={{ color: REDWOOD.error }} />,
      content: <div>Every line ({targets.length}) will be canceled via <Text code style={{ fontSize: 11 }}>PATCH …/child/lines/{'{id}'} {'{ CanceledFlag: true }'}</Text>.</div>,
      onOk: async () => {
        setOrderActionBusy(true);
        let failed = 0;
        for (const l of targets) {
          const href = l.lineHref ? fusionHref(l.lineHref) : (l.fulfillLineId != null ? `${FUSION_BASE}/salesOrdersForOrderHub/${encodeURIComponent(String(orderKey))}/child/lines/${l.fulfillLineId}` : '');
          if (!href) { failed++; continue; }
          try {
            const r = await fetch(href, { method: 'PATCH', headers: { ...getHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ CanceledFlag: true, CancelReasonCode: 'CUSTOMER_REQUEST' }) });
            if (r.ok) upd(l.key, { canceled: true, cancelSaved: true, status: 'Canceled' }); else failed++;
          } catch { failed++; }
        }
        setOrderActionBusy(false);
        if (failed) message.error(`${failed} line(s) failed to cancel`); else message.success('Order canceled');
      },
    });
  };

  // "New Line" — append a blank, editable line the user fills via inline search.
  const addBlankLine = () => { const opt = taxOptions.find(o => o.value === defaultTaxCode); setLines(prev => [...prev, { key: `new-${Date.now()}-${prev.length}`, itemNumber: '', qty: 0, unitPrice: 0, ...(defaultTaxCode ? { taxCode: defaultTaxCode, taxPct: opt?.pct } : {}) }]); };

  // Debounced type-ahead for a blank line's item cell (by code or description).
  // Query only after 3 chars; when many rows come back, open a filter popup.
  const MANY_ITEMS = 12;
  const onLineSearch = (key: string, text: string) => {
    clearTimeout(searchTimer.current[key]);
    const t = text.trim();
    if (t.length < 3) { setLineSearch(p => ({ ...p, [key]: { opts: [], tooShort: true } })); return; }
    setLineSearch(p => ({ ...p, [key]: { loading: true, opts: p[key]?.opts ?? [] } }));
    searchTimer.current[key] = setTimeout(async () => {
      const items = await searchItems(t, hdr.warehouse);
      if (items.length > MANY_ITEMS) {
        setLineSearch(p => ({ ...p, [key]: { loading: false, opts: [] } }));
        setItemModal({ key, term: t, rows: items }); setItemFilter('');
      } else {
        setLineSearch(p => ({ ...p, [key]: { loading: false, opts: items } }));
      }
    }, 350);
  };

  // Apply the chosen item + a specific lot to the line: cost, price, on-hand.
  const applyItemToLine = async (key: string, item: any, costRows: any[], lot?: string) => {
    const row = lot ? costRows.find(c => parseVU(c.ValuationUnit).lot === lot) : costRows[0];
    const vu = parseVU(row?.ValuationUnit);
    const cost = row ? num(pf(row, COST_FIELDS)) : undefined;
    const uom = pf(item, ['PrimaryUOMValue', 'PrimaryUOMCode', 'UOMCode']);
    // Bring the cost only — leave Unit Price alone (user-entered or from a price list).
    upd(key, { itemNumber: item.ItemNumber, ...(item.ItemDescription ? { description: item.ItemDescription } : {}), ...(uom ? { uom } : {}), costUnit: cost, lot, ohLoading: true });
    try {
      const oh = await fetchOnhand(item.ItemNumber, hdr.warehouse || vu.invOrg || '', hdr.subinventory || vu.subinv, lot);
      upd(key, { qoh: oh.qty, lots: oh.lots.length ? oh.lots : (lot ? [lot] : []), ohLoading: false });
    } catch { upd(key, { ohLoading: false }); }
  };

  // User picked an item from the inline search — fetch cost rows, then either
  // apply directly or prompt for a lot when several lots exist.
  const pickInlineItem = async (key: string, itemNumber: string, itemRow?: any) => {
    const item = itemRow ?? (lineSearch[key]?.opts ?? []).find(o => o.ItemNumber === itemNumber) ?? { ItemNumber: itemNumber };
    upd(key, { itemNumber, description: item.ItemDescription, uom: pf(item, ['PrimaryUOMValue', 'PrimaryUOMCode', 'UOMCode']), ohLoading: true });
    setLineSearch(p => ({ ...p, [key]: { opts: [] } }));
    let res: { rows: any[]; hasMore: boolean } = { rows: [], hasMore: false };
    try { res = await fetchItemCostRows(itemNumber, hdr.warehouse); } catch { /* none */ }
    const lots = Array.from(new Set(res.rows.map(c => parseVU(c.ValuationUnit).lot).filter(Boolean))) as string[];
    if (lots.length > 1 || (res.hasMore && lots.length >= 1)) { upd(key, { ohLoading: false }); openLotPick(key, itemNumber, res.rows, res.hasMore); }
    else { await applyItemToLine(key, item, res.rows, lots[0]); }
  };

  // Re-open the "Select a lot" popup for a line that already has an item.
  // Always opens (even with no lots) so the dialog + API inspector are reachable.
  const reopenLotPick = async (l: NewLine) => {
    if (!l.itemNumber) { message.warning('Pick an item first'); return; }
    upd(l.key, { ohLoading: true });
    let res: { rows: any[]; hasMore: boolean } = { rows: [], hasMore: false };
    try { res = await fetchItemCostRows(l.itemNumber, hdr.warehouse); } catch { /* none */ }
    upd(l.key, { ohLoading: false });
    openLotPick(l.key, l.itemNumber, res.rows, res.hasMore);
  };
  const loadMoreLots = async () => {
    if (!lotPick) return;
    const nextOffset = (lotPick.offset ?? 0) + LOT_PAGE;
    const item = lotPick.item;
    setLotPick(p => p ? { ...p, loadingMore: true } : p);
    try {
      const res = await fetchItemCostRows(item, hdr.warehouse, nextOffset);
      setLotPick(p => (p && p.item === item) ? { ...p, rows: [...p.rows, ...res.rows], hasMore: res.hasMore, offset: nextOffset, loadingMore: false } : p);
    } catch { setLotPick(p => p ? { ...p, loadingMore: false } : p); }
  };

  // An existing line can be updated unless it's already Awaiting Billing / Closed
  // (or canceled). Checks both the display status and the status code.
  const lineLocked = (l: NewLine) => /billing|close/.test(`${l.status ?? ''} ${l.statusCode ?? ''}`.toLowerCase());
  const canUpdateLine = (l: NewLine) => !!l.existing && !l.canceled && !lineLocked(l);

  const openUpdateLine = (l: NewLine) => {
    setUpdTarget(l); setUpdQty(num(l.qty)); setUpdPrice(num(l.unitPrice));
    setUpdTaxCode(l.taxCode); setUpdTaxPct(l.taxPct); setUpdLot(l.lot);
    setUpdLots((l.lots ?? []).map(lot => ({ lot, qty: 0 })));
    // Capture the exact on-hand URL used to load the lots (for the API inspector).
    const lotUrl = (hdr.warehouse && l.itemNumber)
      ? `${FUSION_BASE}/inventoryOnhandBalances?q=${encodeURIComponent(`OrganizationCode=${hdr.warehouse};ItemNumber=${l.itemNumber}${hdr.subinventory ? `;SubinventoryCode=${hdr.subinventory}` : ''}`)}&limit=${LOT_PAGE}`
      : '';
    setLotApi({ open: false, url: lotUrl });
    // Fetch available on-hand lots for the item so the user can pick one.
    if (hdr.warehouse && l.itemNumber) {
      fetchReserveOptions(l.itemNumber, hdr.warehouse, hdr.subinventory)
        .then(d => { if (d.options.length) setUpdLots(d.options.filter(o => o.lot)); })
        .catch(() => { /* keep the line's own lots */ });
    }
  };
  const updTax = num(updQty) * num(updPrice) * num(updTaxPct) / 100;
  // Reprice an existing FROZEN-price line. The price/totals live in the line's
  // charges (FreezePriceFlag='true' → Fusion does NOT recompute), so we PATCH the
  // primary charge + its price-element components with mutually-consistent unit
  // AND extended amounts — the same shape the add-line payload builds. Sending
  // UnitSellingPrice on the line does nothing on a frozen order.
  const doUpdateLine = async () => {
    const l = updTarget; if (!l) return;
    const orderKey = editOrder?.OrderKey ?? editOrder?.HeaderId;
    const href = l.lineHref ? fusionHref(l.lineHref)
      : (l.fulfillLineId != null ? `${FUSION_BASE}/salesOrdersForOrderHub/${encodeURIComponent(String(orderKey))}/child/lines/${l.fulfillLineId}` : '');
    if (!href) { message.error('No line id available to update'); return; }
    setUpdBusy(true);

    const q = num(updQty), price = num(updPrice), taxPct = num(updTaxPct);
    const ext = round2(price * q);                     // line extended (net) amount
    const taxUnit = round2(price * taxPct / 100);      // per-unit tax
    const taxAmt = round2(ext * taxPct / 100);         // extended tax
    const qtyChanged = round2(q) !== round2(num(l.qty));
    const priceChanged = round2(price) !== round2(num(l.unitPrice));
    const taxChanged = round2(taxPct) !== round2(num(l.taxPct)) || (updTaxCode ?? '') !== (l.taxCode ?? '');
    const logs: string[] = [];
    const doPatch = async (url: string, body: any) => {
      const r = await fetch(url, { method: 'PATCH', headers: { ...getHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const text = await r.text(); let data: any = null;
      try { data = JSON.parse(text); } catch { /* raw */ }
      logs.push(`PATCH ${url}\n${JSON.stringify(body)}\nHTTP ${r.status}`);
      return { ok: r.ok, data, text, status: r.status };
    };
    const selfHref = (o: any) => { const h = (o?.links ?? []).find((x: any) => x.rel === 'self' || x.name === 'self')?.href; return h ? fusionHref(h) : ''; };

    try {
      // 1. Quantity on the line itself (the one attribute the line still owns).
      const lineRes = await doPatch(href, { OrderedQuantity: q });
      if (!lineRes.ok) {
        setLastResponse(logs.join('\n\n'));
        const msgs = collectOrderErrors(lineRes.data, lineRes.text, true);
        upd(l.key, { error: (msgs.length ? msgs : [`HTTP ${lineRes.status}`]).join('\n\n') });
        message.error('Line update failed — see the red ✗ / Errors tab');
        setUpdTarget(null); setUpdBusy(false); return;
      }

      // 1b. Tax classification code (best-effort — never block the reprice on it).
      if ((updTaxCode ?? '') !== (l.taxCode ?? '')) {
        try { await doPatch(href, { TaxClassificationCode: updTaxCode || null }); } catch { /* non-fatal */ }
      }

      // 2. Reprice via charges whenever qty, price, or tax moved (extended amounts
      //    depend on qty, so a qty change alone still rewrites the totals).
      if (qtyChanged || priceChanged || taxChanged) {
        const chRes = await fetch(`${href}/child/charges?expand=chargeComponents&limit=50`, { headers: getHeaders() });
        const chJson = await chRes.json().catch(() => ({} as any));
        const charges = chJson.items ?? [];
        const primary = charges.find((c: any) => String(c.PrimaryFlag) === 'true') ?? charges[0];
        if (primary) {
          const chargeHref = selfHref(primary);
          if (chargeHref) {
            await doPatch(chargeHref, {
              GSAUnitPrice: price, PricedQuantity: q,
              ChargeCurrencyUnitPrice: price, ChargeCurrencyExtendedAmount: ext,
              HeaderCurrencyUnitPrice: price, HeaderCurrencyExtendedAmount: ext,
            });
          }
          const comps = primary.chargeComponents?.items ?? primary.chargeComponents ?? [];
          const compVals: Record<string, [number, number]> = {
            QP_LIST_PRICE: [price, ext],
            QP_NET_PRICE: [price, ext],
            QP_EXCLUSIVE_TAX: [taxUnit, taxAmt],
            QP_NET_PRICE_PLUS_TAX: [round2(price + taxUnit), round2(ext + taxAmt)],
          };
          for (const comp of comps) {
            const vals = compVals[comp.PriceElementCode]; const cHref = selfHref(comp);
            if (!vals || !cHref) continue;
            await doPatch(cHref, { HeaderCurrencyUnitPrice: vals[0], HeaderCurrencyExtendedAmount: vals[1], ChargeCurrencyUnitPrice: vals[0], ChargeCurrencyExtendedAmount: vals[1] });
          }
        }
      }

      setLastResponse(logs.join('\n\n'));
      upd(l.key, {
        qty: q, origQty: q,
        unitPrice: price, origUnitPrice: price,
        taxCode: updTaxCode, taxPct: updTaxPct, taxAmount: taxAmt, lot: updLot,
        // We just wrote consistent charge totals → stored amount now equals qty×price.
        loadedExt: ext, loadedTax: taxAmt,
        lots: updLot ? [updLot] : l.lots,
        status: lineRes.data?.DisplayStatus ?? lineRes.data?.Status ?? l.status,
        statusCode: lineRes.data?.StatusCode ?? l.statusCode, error: undefined,
      });
      message.success(`Line ${l.itemNumber} updated${(priceChanged || taxChanged) ? ' (repriced)' : ''}`);
      setUpdTarget(null);
    } catch (e: any) { setLastResponse(logs.join('\n\n')); upd(l.key, { error: e?.message }); message.error(e?.message || 'Update failed'); setUpdTarget(null); }
    finally { setUpdBusy(false); }
  };

  // "Check On-Hand" — refresh QoH for every populated line from Fusion.
  const checkAllOnhand = async () => {
    const withItems = lines.filter(l => l.itemNumber);
    if (!withItems.length) { message.warning('No lines to check'); return; }
    if (!hdr.warehouse) { message.warning('No warehouse selected on the header'); return; }
    setOhLoading(true);
    setLines(prev => prev.map(l => l.itemNumber ? { ...l, ohLoading: true } : l));
    try {
      await mapLimit(withItems, 4, async (l) => {
        try { const oh = await fetchOnhand(l.itemNumber, hdr.warehouse!, hdr.subinventory, l.lot); upd(l.key, { qoh: oh.qty, lots: oh.lots.length ? oh.lots : l.lots, ohLoading: false }); }
        catch { upd(l.key, { ohLoading: false }); }
      });
      message.success('On-hand updated from Fusion');
    } finally { setOhLoading(false); }
  };

  // DOO order-import payload matching the target JSON (billTo/shipTo, salesCredits, per-line charges).
  const buildPayload = () => {
    const dateIso = (hdr.orderDate ? dayjs(hdr.orderDate) : dayjs()).format('YYYY-MM-DD[T]00:00:00[Z]');
    const numOrStr = (v: any) => { const n = Number(v); return v != null && v !== '' && !Number.isNaN(n) ? n : v; };
    // Edit = DOO change order: reuse the original source keys + bump the revision
    // so Fusion updates the existing order instead of creating a new one.
    const srcNumber = editMode ? editOrder.SourceTransactionNumber : orderNumber;
    const srcSystem = editMode ? (editOrder.SourceTransactionSystem ?? 'OPS') : 'OPS';
    const srcId     = editMode ? editOrder.SourceTransactionId : `APEX:${orderSeq}`;
    const revision  = editMode ? (Number(editOrder.SourceTransactionRevisionNumber) || 1) + 1 : undefined;
    return {
      SourceTransactionNumber: srcNumber,
      SourceTransactionSystem: srcSystem,
      SourceTransactionId: srcId,
      ...(revision != null ? { SourceTransactionRevisionNumber: revision } : {}),
      TransactionalCurrencyCode: hdr.txnCurrency,
      ...(hdr.rate != null ? {
        CurrencyConversionRate: Number(hdr.rate),
        CurrencyConversionType: hdr.currencyRateType || 'User',
        CurrencyConversionDate: hdr.currencyDate ? hdr.currencyDate.format('YYYY-MM-DD[T]00:00:00[Z]') : dateIso
      } : {}),
      ...(hdr.businessUnitId != null ? { BusinessUnitId: numOrStr(hdr.businessUnitId) } : {}),
      ...(hdr.accountNumber ? { BuyingPartyNumber: hdr.accountNumber } : {}),
      RequestedShipDate: dateIso,
      TransactionOn: dateIso,
      ...(hdr.orderType ? { TransactionTypeCode: hdr.orderType, TransactionType: hdr.orderType } : {}),
      SubmittedFlag: 'false',   // save as DRAFT; Confirm later submits it
      FreezePriceFlag: 'true',
      FreezeShippingChargeFlag: 'true',
      FreezeTaxFlag: 'true',
      ...(hdr.businessUnitId != null ? { RequestingBusinessUnitId: numOrStr(hdr.businessUnitId) } : {}),
      ...(hdr.paymentTerms ? { PaymentTerms: hdr.paymentTerms } : {}),
      ...(hdr.warehouse ? { RequestedFulfillmentOrganizationCode: hdr.warehouse } : {}),
      ...(hdr.customerPONumber ? { CustomerPONumber: hdr.customerPONumber } : {}),
      billToCustomer: [{
        ...(hdr.custAccountId != null ? { CustomerAccountId: numOrStr(hdr.custAccountId) } : {}),
        ...(hdr.billToSite != null ? { SiteUseId: numOrStr(hdr.billToSite) } : {}),
      }],
      shipToCustomer: [{
        ...(hdr.partyId != null ? { PartyId: String(hdr.partyId) } : {}),
        ...(hdr.shipToSite != null ? { SiteId: numOrStr(hdr.shipToSite) } : {}),
      }],
      // Sales credit — only when a rep is chosen. Send a numeric SalespersonId when
      // we can resolve it (name-only credits get dropped during import if ambiguous),
      // a stable identifier so a change-order revision UPDATES rather than duplicates,
      // and numeric Percent / quota credit type (1 = Quota Sales Credit).
      ...(hdr.salesRep ? { salesCredits: [{
        SourceTransactionSalesCreditIdentifier: `SC-${srcNumber}-1`,
        ...(salesRepOpts.find(o => o.value === hdr.salesRep)?.id != null ? { SalespersonId: salesRepOpts.find(o => o.value === hdr.salesRep)!.id } : {}),
        Salesperson: hdr.salesRep,
        SalesCreditTypeId: 1,
        Percent: 100,
      }] } : {}),
      // Header Additional Information (Extensible Flexfield) — uploaded when filled.
      ...(effHeaderChild() ? { additionalInformation: [effHeaderChild()] } : {}),
      lines: lines.map((l, i) => (editMode && l.canceled) ? buildCancelLine(l, i) : buildFullLine(l, i)),
    };
  };

  // A full order line (with charges) — used for the create payload and for
  // adding a line to an existing order (POST base + { OrderKey, lines:[...] }).
  const buildFullLine = (l: NewLine, i: number) => {
    const qty = num(l.qty), price = num(l.unitPrice), tax = num(l.taxAmount);
    const ext = round2(price * qty), taxUnit = qty ? round2(tax / qty) : 0;
    // Preserve the original source line id for existing lines; mint one for added.
    const lineId = l.srcLineId ?? (editMode ? `N${i + 1}` : String(orderSeq * 100 + (i + 1)));
    const lineNum = l.srcLineNumber ?? (i + 1);
    const schedNum = l.srcScheduleNumber ?? lineId;
    return {
      SourceTransactionLineId: String(lineId),
      SourceTransactionLineNumber: lineNum,
      SourceTransactionScheduleId: schedNum,
      SourceScheduleNumber: schedNum,
      ...(l.uom ? { OrderedUOMCode: l.uom } : {}),
      OrderedQuantity: qty,
      ProductNumber: l.itemNumber,
      ...(hdr.subinventory && !(returnMode && l.returnLine) ? { SubinventoryCode: hdr.subinventory } : {}),
      ...(hdr.paymentTerms ? { PaymentTerms: hdr.paymentTerms } : {}),
      InventoryTransactionFlag: inventoryTransactionFlag,
      TransactionCategoryCode: (returnMode && l.returnLine) ? 'RETURN' : 'ORDER',
      // Return (RMA) line — LineCategoryCode RETURN + reference the original
      // fulfillment line via the originalOrderReference child (referenced return;
      // Oracle derives price from the reference, so no charges are sent).
      ...((returnMode && l.returnLine) ? {
        LineCategoryCode: 'RETURN',
        ReturnReasonCode: l.returnReason || DEFAULT_RETURN_REASON,
        ...(l.refFulfillLineId != null ? { originalOrderReference: [{ OriginalFulfillLineId: num(l.refFulfillLineId) }] } : {}),
        // Lot/serial being returned (from the original shipment) — one entry per
        // serial (Quantity 1, From==To); lot-only items carry LotNumber + Quantity.
        ...((l.retLots && l.retLots.length) ? {
          lotSerials: l.retLots.map((x, xi) => ({
            SourceLotSerialId: `LS${i + 1}-${xi + 1}`,
            ...(x.lot ? { LotNumber: x.lot } : {}),
            ...(x.serial ? { ItemSerialNumberFrom: x.serial, ItemSerialNumberTo: x.serial } : {}),
            Quantity: x.serial ? 1 : (x.qty || 1),
          })),
        } : {}),
      } : {}),
      // For direct inventory transactions (InventoryTransactionFlag=true): include lotSerials allocation.
      // For regular outbound lines (InventoryTransactionFlag=false): lot goes to the EFF (FOM-4515328).
      ...(!returnMode && inventoryTransactionFlag && (l.selectedLot || l.selectedSerials?.length) ? {
        lotSerials: l.selectedSerials && l.selectedSerials.length ? l.selectedSerials.map((s, si) => ({
          SourceLotSerialId: `LS${i + 1}-${si + 1}`,
          ...(l.selectedLot ? { LotNumber: l.selectedLot } : {}),
          ItemSerialNumberFrom: s,
          ItemSerialNumberTo: s,
          Quantity: 1,
        })) : l.selectedLot ? [{ SourceLotSerialId: `LS${i + 1}-1`, LotNumber: l.selectedLot, Quantity: qty }] : [],
      } : {}),
      ...(effLineChild(l) ? { additionalInformation: [effLineChild(l)] } : {}),
      ...((returnMode && l.returnLine) ? {} : { charges: [{
        SourceChargeId: `C${i + 1}`,
        ApplyTo: 'Price',
        PricedQuantity: qty,
        GSAUnitPrice: price,
        PriceType: 'One time',
        ChargeType: 'Sale',
        ChargeSubType: 'Price',
        ChargeCurrencyCode: hdr.txnCurrency,
        SequenceNumber: 1,
        ChargeDefinitionCode: 'QP_SALE_PRICE',
        PrimaryFlag: 'true',
        RollupFlag: 'false',
        chargeComponents: [
          { SourceChargeComponentId: `C${i + 1}-CC1`, PriceElementCode: 'QP_LIST_PRICE', PriceElementUsageCode: 'LIST_PRICE', HeaderCurrencyUnitPrice: price, HeaderCurrencyExtendedAmount: ext, RollupFlag: 'false', SequenceNumber: 1 },
          { SourceChargeComponentId: `C${i + 1}-CC2`, PriceElementCode: 'QP_NET_PRICE', PriceElementUsageCode: 'NET_PRICE', HeaderCurrencyUnitPrice: price, HeaderCurrencyExtendedAmount: ext, RollupFlag: 'false', SequenceNumber: 2 },
          { SourceChargeComponentId: `C${i + 1}-CC3`, PriceElementCode: 'QP_EXCLUSIVE_TAX', PriceElementUsageCode: 'EXCLUSIVE_TAX', HeaderCurrencyUnitPrice: taxUnit, HeaderCurrencyExtendedAmount: tax, RollupFlag: 'false', SequenceNumber: 3 },
          { SourceChargeComponentId: `C${i + 1}-CC4`, PriceElementCode: 'QP_NET_PRICE_PLUS_TAX', PriceElementUsageCode: 'NET_PRICE_PLUS_TAX', HeaderCurrencyUnitPrice: round2(price + taxUnit), HeaderCurrencyExtendedAmount: round2(ext + tax), RollupFlag: 'false', SequenceNumber: 4 },
        ],
      }] }),
    };
  };
  // Minimal change-order entry that cancels an existing line.
  const buildCancelLine = (l: NewLine, i: number) => {
    const lineId = l.srcLineId ?? `N${i + 1}`;
    return {
      SourceTransactionLineId: String(lineId),
      SourceTransactionLineNumber: String(l.srcLineNumber ?? (i + 1)),
      SourceScheduleNumber: String(l.srcScheduleNumber ?? lineId),
      ProductNumber: l.itemNumber,
      OrderedQuantity: 0,
      CanceledFlag: true,
      CancelReasonCode: 'CUSTOMER_REQUEST',
    };
  };
  const payloadStr = useMemo(() => JSON.stringify(buildPayload(), null, 2), [lines, hdr, orderNumber, orderSeq, effMeta, editOrder]); // eslint-disable-line react-hooks/exhaustive-deps

  // Edit mode: build the exact per-line REST operations against the live order.
  //   update qty  → PATCH  {OrderKey}/child/lines/{linesUniqID}  { OrderedQuantity }
  //   add line    → POST   {OrderKey}/child/lines                 { Product, Qty, ... }
  //   remove line → line-level DELETE is NOT enabled on the order hub, so:
  //     DRAFT order      → PATCH {OrderKey} { lines:[{ SourceTransactionLineId, SourceTransactionScheduleId, OrderedQuantity: 0 }] }
  //     processing order → PATCH {OrderKey}/child/lines/{id} { CanceledFlag: true }
  interface EditOp { kind: 'update' | 'add' | 'cancel' | 'delete'; method: string; url: string; body: any; lineKey: string; label: string; srcLineNumber: any }
  const editOps: EditOp[] = useMemo(() => {
    if (!editMode) return [];
    const orderKey = editOrder.OrderKey ?? editOrder.HeaderId;
    const headerUrl = `${FUSION_BASE}/salesOrdersForOrderHub/${encodeURIComponent(String(orderKey))}`;
    const childBase = `${headerUrl}/child/lines`;
    const ops: EditOp[] = [];
    lines.forEach((l, i) => {
      const label = `${l.itemNumber || '(item)'}${l.srcLineNumber != null ? ` · line ${l.srcLineNumber}` : ''}`;
      if (l.existing) {
        const href = l.lineHref ? fusionHref(l.lineHref) : (l.fulfillLineId != null ? `${childBase}/${l.fulfillLineId}` : '');
        if (!href) return;
        // Only fire once: skip already-saved removals; only PATCH when qty changed.
        if (l.canceled) {
          if (!l.cancelSaved) {
            if (isDraftStatus) ops.push({ kind: 'cancel', method: 'PATCH', url: headerUrl, body: { lines: [{ SourceTransactionLineId: String(l.srcLineId ?? l.fulfillLineId ?? ''), SourceTransactionScheduleId: String(l.srcScheduleNumber ?? l.srcLineId ?? ''), OrderedQuantity: 0 }] }, lineKey: l.key, label, srcLineNumber: l.srcLineNumber });
            else ops.push({ kind: 'cancel', method: 'PATCH', url: href, body: { CanceledFlag: true, CancelReasonCode: 'CUSTOMER_REQUEST' }, lineKey: l.key, label, srcLineNumber: l.srcLineNumber });
          }
        }
        else if (num(l.qty) !== num(l.origQty)) ops.push({ kind: 'update', method: 'PATCH', url: href, body: { OrderedQuantity: num(l.qty) }, lineKey: l.key, label, srcLineNumber: l.srcLineNumber });
      } else {
        // Add a line = POST the order's lines child with the full line object.
        ops.push({ kind: 'add', method: 'POST', url: `${childBase}`,
          body: buildFullLine(l, i),
          lineKey: l.key, label, srcLineNumber: i + 1 });
      }
    });
    return ops;
  }, [editMode, editOrder, lines, hdr, effMeta, isDraftStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  // What the Payload button shows: the ops list in edit mode, else the create body.
  const previewStr = editMode
    ? JSON.stringify(editOps.map(o => ({ operation: o.kind, method: o.method, url: o.url, body: o.body })), null, 2)
    : payloadStr;

  // Pull the created order's lines from Fusion and stamp each grid line's status.
  // Match by SourceTransactionLineNumber (what we sent), then fall back to item.
  const refreshLineStatuses = async (orderKey?: string) => {
    const key = orderKey ?? createdOrderKey;
    if (!key) { message.warning('Save the order first, then refresh statuses'); return; }
    setStatusLoading(true);
    try {
      const url = `${FUSION_BASE}/salesOrdersForOrderHub/${encodeURIComponent(key)}/child/lines?onlyData=true&limit=500`;
      const r = await fetch(url, { headers: getHeaders() });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      const items: any[] = d.items ?? [];
      setLines(prev => prev.map((l, i) => {
        const match =
          items.find(it => String(pf(it, ['SourceTransactionLineNumber']) ?? '') === String(l.srcLineNumber ?? i + 1)) ??
          items.find(it => String(pf(it, ['ProductNumber', 'Product', 'ItemNumber']) ?? '') === String(l.itemNumber));
        if (!match) return l;
        const self = (match.links ?? []).find((x: any) => x.rel === 'self')?.href;
        return {
          ...l, existing: true,
          status: pf(match, ['Status', 'DisplayStatus', 'FulfillLineStatus']), statusCode: pf(match, ['StatusCode']),
          fulfillLineId: pf(match, ['FulfillLineId']) ?? l.fulfillLineId,
          lineHref: self ?? l.lineHref,
          srcLineNumber: l.srcLineNumber ?? pf(match, ['SourceTransactionLineNumber']),
          srcLineId: l.srcLineId ?? (pf(match, ['SourceTransactionLineId']) != null ? String(pf(match, ['SourceTransactionLineId'])) : undefined),
          uom: l.uom ?? pf(match, ['OrderedUOMCode', 'OrderedUOM']),
        };
      }));
      message.success('Line statuses refreshed from Fusion');
    } catch (e: any) { message.error(`Refresh failed: ${e.message}`); }
    finally { setStatusLoading(false); }
  };

  // Strip all EFF additionalInformation from a payload — used to retry a save when
  // Fusion rejects the flexfield category, so the order itself still goes through.
  const stripEff = (p: any) => { const c = JSON.parse(JSON.stringify(p)); delete c.additionalInformation; (c.lines ?? []).forEach((l: any) => { delete l.additionalInformation; }); return c; };
  const isEffCategoryError = (t: string) => /category\s*code|invalid\s*category|additionalinformation|is\s*category/i.test(t || '');

  const save = async () => {
    if (lines.length === 0) { message.warning('Add at least one line'); return; }
    if (inventoryTransactionFlag && isBranchSales && !hdr.subinventory) { message.error('Subinventory is required for inventory transactions'); return; }
    setPosting(true); setSaveError(null); setOrderErrors([]);
    setLines(prev => prev.map(l => l.error ? { ...l, error: undefined } : l));
    const stamp = String(Date.now());
    // Map response errors onto lines (red ✗) + the Errors tab.
    const applyErrors = (data: any, text: string, includeRaw: boolean) => {
      const msgs = collectOrderErrors(data, text, includeRaw);
      const { byKey } = mapErrorsToLines(msgs, lines);
      setLines(prev => prev.map(l => ({ ...l, error: byKey[l.key]?.join('\n\n') })));
      setOrderErrors(msgs);
    };
    let effSkipped = false;
    try {
      const doPost = async (body: string) => {
        const rr = await fetch(SO_CREATE_URL, { method: 'POST', headers: { ...getHeaders(), 'Content-Type': 'application/json' }, body });
        const t = await rr.text(); let dd: any = null, pp = t;
        try { dd = JSON.parse(t); pp = JSON.stringify(dd, null, 2); } catch { /* raw */ }
        return { r: rr, text: t, data: dd, pretty: pp };
      };
      let res = await doPost(payloadStr);
      // If the flexfield category was rejected, retry once without EFF so the order saves.
      if ((!res.r.ok || !res.data?.OrderNumber) && isEffCategoryError(res.text) && /additionalInformation/.test(payloadStr)) {
        const retry = await doPost(JSON.stringify(stripEff(buildPayload())));
        if (retry.r.ok && retry.data?.OrderNumber) { res = retry; effSkipped = true; }
      }
      const { r, text, data, pretty } = res;
      setLastResponse(`HTTP ${r.status}\n\n${pretty}`);

      if (r.ok && data?.OrderNumber) {
        // Success — write the response to the order-loading folder (no on-screen log).
        applyErrors(data, '', false); // surface any per-line warnings the create still returned
        saveOrderLog(`order-${data.OrderNumber}-${stamp}.json`, pretty);
        const pieces = Array.from({ length: 60 }, (_, i) => ({
          id: i, x: Math.random() * 100,
          color: ['#C74634', '#1D7B4D', '#0572CE', '#D4A800', '#00918A', '#6B21A8', '#FF6B35', '#4ECDC4'][Math.floor(Math.random() * 8)],
          delay: Math.random() * 1.2, size: 6 + Math.random() * 8,
        }));
        setConfetti(pieces);
        setSuccessInfo({ orderNumber: data.OrderNumber, status: data.StatusCode ?? data.Status ?? (editMode ? 'Updated' : 'Created') });
        setSaveError(null);
        setSuccessOpen(true);
        const orderKey = data.OrderKey ?? data.HeaderId ?? null;
        setCreatedOrderKey(orderKey != null ? String(orderKey) : null);
        setCreatedOrderNumber(String(data.OrderNumber));
        setOrderStatus(String(data.StatusCode ?? 'DOO_DRAFT'));
        setConfirmed(String(data.StatusCode ?? '').toUpperCase() !== 'DOO_DRAFT' && String(data.SubmittedFlag) === 'true');
        message.success(`Sales order ${data.OrderNumber} saved as draft`);
        if (effSkipped) message.warning('Additional Information (EFF) was skipped — Fusion rejected the flexfield category. Open an existing order\'s Additional Info once (so the correct category code is learned), then use “Save Additional Info” to add it.', 8);
        if (orderKey != null) refreshLineStatuses(String(orderKey));

        // Check if this is a branch sales order type
        if (hdr.orderType && orderTypeLookup.get(hdr.orderType)?.Tag === 'BRANCH SALES' && !editMode) {
          setSavedOrderNumber(String(data.OrderNumber));
          branchSalesForm.resetFields();
          const needByDate = dayjs().add(7, 'days');
          const branchBU = form.getFieldValue('branchBU');
          branchSalesForm.setFieldsValue({
            salesOrderNumber: String(data.OrderNumber),
            currency: hdr.txnCurrency,
            needByDate,
            branchBusinessUnit: branchBU
          });
          if (branchBU) {
            onBranchBUChange(branchBU);
          }
          setBranchPoNeedByDate(needByDate);
          setBranchSalesModalOpen(true);
        }
      } else {
        // Failure — map errors onto lines + Errors tab, write the log, show the dialog.
        applyErrors(data, text, true);
        const msg = extractOrderError(data, r.status, text);
        saveOrderLog(`order-ERROR-${orderNumber || 'draft'}-${stamp}.json`,
          `HTTP ${r.status}\n\n=== RESPONSE ===\n${pretty}\n\n=== REQUEST PAYLOAD ===\n${payloadStr}`);
        setConfetti([]);
        setSaveError(msg);
        setSuccessOpen(true);
        message.error('Sales order creation failed');
      }
    } catch (e: any) {
      saveOrderLog(`order-ERROR-${orderNumber || 'draft'}-${stamp}.json`, `NETWORK ERROR: ${e?.message}\n\n=== REQUEST PAYLOAD ===\n${payloadStr}`);
      setConfetti([]);
      setLastResponse(`NETWORK ERROR: ${e?.message}`);
      setSaveError(e?.message || 'Network error');
      setOrderErrors([e?.message || 'Network error']);
      setSuccessOpen(true);
      message.error('Sales order creation failed');
    } finally { setPosting(false); }
  };

  // Edit mode: run each per-line operation (PATCH update / POST add / PATCH cancel)
  // against the live order and collect per-line results.
  const updateOrder = async () => {
    const orderKey = editOrder.OrderKey ?? editOrder.HeaderId;
    if (editOps.length === 0) { message.warning('No changes to save'); return; }
    setPosting(true); setSaveError(null); setOrderErrors([]);
    setLines(prev => prev.map(l => l.error ? { ...l, error: undefined } : l));
    const stamp = String(Date.now());
    const results: any[] = [];
    const errByKey: Record<string, string[]> = {};
    const general: string[] = [];
    // "Settle" succeeded ops so the SAME change is never resent on the next save:
    //   add   → the line becomes existing (with its new Fusion ids)
    //   update→ its original qty/price advance to the saved values
    //   cancel→ marked cancelSaved so it won't re-cancel
    const settle: Record<string, Partial<NewLine>> = {};
    const deletedKeys = new Set<string>();     // draft lines hard-DELETEd → drop from the grid
    for (const op of editOps) {
      try {
        // DELETE carries no body; PATCH/POST send JSON.
        const init: RequestInit = op.method === 'DELETE'
          ? { method: 'DELETE', headers: { ...getHeaders() } }
          : { method: op.method, headers: { ...getHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(op.body) };
        const r = await fetch(op.url, init);
        const text = await r.text(); let data: any = null, pretty = text;
        try { data = JSON.parse(text); pretty = JSON.stringify(data, null, 2); } catch { /* raw */ }
        results.push({ operation: op.kind, method: op.method, url: op.url, status: r.status, ok: r.ok, request: op.body, response: pretty });
        const cur = lines.find(x => x.key === op.lineKey);
        if (r.ok) {
          if (op.kind === 'delete') {
            deletedKeys.add(op.lineKey);
          } else if (op.kind === 'add') {
            settle[op.lineKey] = {
              existing: true, origQty: num(cur?.qty), origUnitPrice: num(cur?.unitPrice),
              srcLineId: data?.SourceTransactionLineId != null ? String(data.SourceTransactionLineId) : op.body?.SourceTransactionLineId,
              srcLineNumber: data?.SourceTransactionLineNumber ?? op.body?.SourceTransactionLineNumber,
              srcScheduleNumber: data?.SourceScheduleNumber ?? op.body?.SourceScheduleNumber,
              fulfillLineId: data?.FulfillLineId,
              lineHref: (data?.links ?? []).find((x: any) => x.rel === 'self')?.href,
              status: data?.DisplayStatus ?? data?.Status ?? 'Created', statusCode: data?.StatusCode,
            };
          } else if (op.kind === 'update') {
            settle[op.lineKey] = { origQty: num(cur?.qty), origUnitPrice: num(cur?.unitPrice), status: data?.DisplayStatus ?? data?.Status ?? 'Updated', statusCode: data?.StatusCode };
          } else if (op.kind === 'cancel') {
            settle[op.lineKey] = { cancelSaved: true, status: 'Canceled', statusCode: data?.StatusCode };
          }
        } else {
          const msgs = collectOrderErrors(data, text, true);
          const use = msgs.length ? msgs : [`HTTP ${r.status}`];
          (errByKey[op.lineKey] ??= []).push(...use); general.push(...use);
        }
      } catch (e: any) {
        results.push({ operation: op.kind, method: op.method, url: op.url, status: 0, ok: false, request: op.body, response: e?.message });
        (errByKey[op.lineKey] ??= []).push(e?.message ?? 'Network error'); general.push(e?.message ?? 'Network error');
      }
    }
    saveOrderLog(`order-EDIT-${editOrder.OrderNumber ?? orderKey}-${stamp}.json`, JSON.stringify({ operations: editOps, results }, null, 2));
    setLastResponse(JSON.stringify(results, null, 2));
    // Apply settle + errors together so succeeded lines can't be resent; drop any
    // draft lines that were hard-DELETEd from Fusion.
    setLines(prev => prev.filter(l => !deletedKeys.has(l.key)).map(l => ({ ...l, ...(settle[l.key] ?? {}), error: errByKey[l.key]?.join('\n\n') })));
    setOrderErrors(general);
    const failed = results.filter(r => !r.ok).length;
    if (failed === 0) {
      const pieces = Array.from({ length: 60 }, (_, i) => ({
        id: i, x: Math.random() * 100,
        color: ['#C74634', '#1D7B4D', '#0572CE', '#D4A800', '#00918A', '#6B21A8', '#FF6B35', '#4ECDC4'][Math.floor(Math.random() * 8)],
        delay: Math.random() * 1.2, size: 6 + Math.random() * 8,
      }));
      setConfetti(pieces);
      setSuccessInfo({ orderNumber: editOrder.OrderNumber ?? String(orderKey), status: `${results.length} change(s) applied` });
      setSaveError(null); setSuccessOpen(true);
      message.success(`Order updated — ${results.length} change(s)`);
      refreshLineStatuses(String(orderKey));
    } else {
      setSaveError(`${failed} of ${results.length} change(s) failed. See the Errors tab / red ✗ on the lines.`);
      setSuccessOpen(true);
      message.error(`${failed} change(s) failed`);
    }
    setPosting(false);
  };

  // Create a Purchase Order from the Branch Sales order
  const createBranchPO = async () => {
    if (!savedOrderNumber) return;
    const branchBU = branchSalesForm.getFieldValue('branchBusinessUnit');
    const branchSupplier = branchSalesForm.getFieldValue('branchSupplierName');
    const branchSupplierSite = branchSalesForm.getFieldValue('branchSupplierSite');
    const shipToLoc = branchSalesForm.getFieldValue('shipToLocation');
    const currency = branchSalesForm.getFieldValue('currency');
    const needByDate = branchSalesForm.getFieldValue('needByDate');

    console.log('Branch PO Create - Field Values:', { branchBU, branchSupplier, branchSupplierSite, shipToLoc, currency, needByDate });

    if (!branchBU || !branchSupplier || !branchSupplierSite || !shipToLoc) {
      const missing = [];
      if (!branchBU) missing.push('Branch Business Unit (required)');
      if (!branchSupplier) missing.push('Branch Supplier - Click search icon 🔍 to select');
      if (!branchSupplierSite) missing.push('Supplier Site (required)');
      if (!shipToLoc) missing.push('Ship-To Location');
      const msg = `Required fields not filled:\n\n${missing.join('\n')}`;
      message.error(msg);
      console.error('Missing fields:', missing);
      return;
    }

    setCreatingBranchPO(true);
    try {
      // Get Business Unit ID for the selected branch BU
      const buRow = bUnits.find(b => b.businessUnitName === branchBU);
      const procBUId = buRow?.businessUnitId;
      if (!procBUId) {
        message.error('Could not find Business Unit ID for selected branch');
        return;
      }

      // Build PO line items with proper Fusion structure
      const poLines = lines
        .filter(l => l.itemNumber && num(l.qty) > 0)
        .map((l, idx) => {
          const orgObj = orgRows.find(o => pf(o, ['OrganizationCode']) === shipToLoc);
          return {
            LineNumber: idx + 1,
            LineType: 'Goods',
            Item: l.itemNumber,
            Description: l.description,
            Quantity: num(l.qty),
            Price: num(l.unitPrice),
            UOM: l.uom || 'EA',
            schedules: [{
              ScheduleNumber: 1,
              Quantity: num(l.qty),
              ShipToLocation: shipToLoc,
              ShipToOrganizationCode: shipToLoc,
              ShipToOrganization: pf(orgObj, ['OrganizationName']),
              RequestedDeliveryDate: (needByDate || branchPoNeedByDate).format('YYYY-MM-DD'),
              ReceiptCloseTolerancePercent: 0,
              InvoiceMatchOptionCode: 'P',
              InvoiceMatchOption: 'Order',
              EarlyReceiptToleranceDays: 0,
              InvoiceCloseTolerancePercent: 0,
              LateReceiptToleranceDays: 0,
              AccrueAtReceiptFlag: true,
              InspectionRequiredFlag: true,
              ReceiptRequiredFlag: false,
              ReceiptRoutingId: 3,
              ReceiptRouting: 'Direct delivery',
              DestinationTypeCode: 'INVENTORY',
              MatchApprovalLevelCode: '3-Way',
              MatchApprovalLevel: '3 Way',
              distributions: [{
                DistributionNumber: 1,
                DeliverToLocation: shipToLoc,
                DeliverToLocationCode: shipToLoc,
                Quantity: num(l.qty),
              }],
            }],
          };
        });

      // Build PO header payload with correct Fusion structure (must match API Inspector)
      const currencyNames: Record<string, string> = { USD: 'US Dollar', AED: 'United Arab Emirates Dirham', KES: 'Kenyan Shilling', EUR: 'Euro', GBP: 'British Pound' };

      const poPayload = {
        ProcurementBUId: procBUId,
        OrderNumber: `BLPO${savedOrderNumber?.replace(/^BCSO/, '') || ''}`,
        RequiredAcknowledgment: 'None',
        CurrencyCode: currency,
        Currency: currencyNames[currency] || currency,
        ConversionRateTypeCode: hdr.rate && hdr.rate !== 1 ? (hdr.currencyRateType || 'Corporate') : null,
        ConversionRateType: hdr.rate && hdr.rate !== 1 ? (hdr.currencyRateType || 'Corporate') : null,
        ConversionRateDate: hdr.currencyDate ? hdr.currencyDate.format('YYYY-MM-DD') : null,
        ConversionRate: hdr.rate && hdr.rate !== 1 ? num(hdr.rate) : null,
        Buyer: 'emp, arun',
        PayOnReceiptFlag: 'Y',
        RequisitioningBUId: procBUId,
        Supplier: branchSupplier,
        SupplierSite: branchSupplierSite,
        BillToLocation: branchBU,
        DefaultShipToLocation: shipToLoc,
        ModeOfTransportCode: null,
        BuyerManagedTransportFlag: false,
        SupplierEmailAddress: null,
        lines: poLines,
      };

      setBranchPoPayload(JSON.stringify(poPayload, null, 2));

      // POST to draft purchase order creation endpoint
      const url = `${FUSION_BASE}/draftPurchaseOrders`;
      const r = await fetch(url, {
        method: 'POST',
        headers: { ...getHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(poPayload),
      });

      const text = await r.text();
      let data: any = null;
      try { data = JSON.parse(text); } catch { /* raw */ }

      if (r.ok && data) {
        const poNum = data.OrderNumber || data.PurchaseOrderNumber || `BLPO${savedOrderNumber?.replace(/^BCSO/, '') || ''}`;
        setCreatedPONumber(poNum);
        message.success(`Branch Purchase Order ${poNum} created successfully`);
        setBranchSalesModalOpen(false);
        branchSalesForm.resetFields();
        setSavedOrderNumber(null);
      } else {
        const err = collectOrderErrors(data, text, true) || [`HTTP ${r.status}`];
        message.error(`Failed to create Branch PO: ${err.join(', ')}`);
      }
    } catch (e: any) {
      message.error(`Network error: ${e?.message || 'Failed to create Branch PO'}`);
    } finally {
      setCreatingBranchPO(false);
    }
  };

  // ── Draft workflow: Confirm (submit the draft), Reserve / Unreserve stock ──
  // The key/number of the live order — from the create response or the edited order.
  const liveOrderKey = () => createdOrderKey ?? (editOrder ? String(editOrder.OrderKey ?? editOrder.HeaderId ?? '') : '');
  const liveOrderNumber = () => createdOrderNumber ?? (editOrder ? String(editOrder.OrderNumber ?? orderNumber) : orderNumber);

  // The actual submit: PATCH SubmittedFlag → order leaves DOO_DRAFT.
  const doConfirm = async () => {
    const key = liveOrderKey();
    if (!key) { message.warning('Save the order first'); return; }
    setWorkBusy('confirm');
    try {
      const url = `${FUSION_BASE}/salesOrdersForOrderHub/${encodeURIComponent(key)}`;
      const r = await fetch(url, { method: 'PATCH', headers: { ...getHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ SubmittedFlag: 'true' }) });
      const text = await r.text(); let data: any = null, pretty = text;
      try { data = JSON.parse(text); pretty = JSON.stringify(data, null, 2); } catch { /* raw */ }
      setLastResponse(`PATCH ${url}\nHTTP ${r.status}\n\n${pretty}`);
      saveOrderLog(`order-CONFIRM-${liveOrderNumber()}-${Date.now()}.json`, `HTTP ${r.status}\n\n${pretty}`);
      if (r.ok) {
        setConfirmed(true);
        setOrderStatus('DOO_SUBMITTED');
        message.success(`Order ${liveOrderNumber()} confirmed / submitted`);
        refreshLineStatuses(key);
      } else {
        Modal.error({ title: 'Confirm failed', width: 640, content: <pre style={{ maxHeight: 380, overflow: 'auto', fontSize: 12 }}>{(collectOrderErrors(data, text, true).join('\n\n')) || `HTTP ${r.status}`}</pre> });
      }
    } catch (e: any) { message.error(e?.message || 'Confirm failed'); }
    finally { setWorkBusy(null); }
  };
  // Confirm the draft — first check existing (manual) reservations. If any, warn
  // that confirming will unreserve them (the order re-reserves for shipping).
  const confirmOrder = async () => {
    const key = liveOrderKey();
    if (!key) { message.warning('Save the order first'); return; }
    setWorkBusy('confirm');
    const resv = await fetchReservations(orderNumber, lines.map(l => l.itemNumber));
    setWorkBusy(null);
    if (resv.length) { setConfirmResvList(resv); setConfirmResvOpen(true); return; }
    doConfirm();
  };
  // Proceed: drop the manual reservations, then submit the order.
  const proceedConfirm = async () => {
    setConfirmResvOpen(false);
    setWorkBusy('confirm');
    try { await deleteReservationsFor(orderNumber); setResvReloadKey(k => k + 1); } catch { /* continue to confirm */ }
    await doConfirm();
  };

  // Resolve the org id for the header warehouse from the loaded org list.
  const warehouseOrgId = () => {
    const o = orgRows.find((x: any) => pf(x, ['OrganizationCode']) === hdr.warehouse);
    return o ? pf(o, ['OrganizationId']) : undefined;
  };
  const updReserveRow = (key: string, patch: Partial<typeof reserveRows[number]>) =>
    setReserveRows(prev => prev.map(r => r.key === key ? { ...r, ...patch } : r));

  // The inventoryReservations POST body for a dialog row (User Defined demand,
  // keyed by the order number). Lot-controlled items require LotNumber + Sub.
  const reserveRowBody = (row: typeof reserveRows[number], orderNo: string) => ({
    ...(row.inventoryItemId != null ? { InventoryItemId: row.inventoryItemId } : {}),
    ...(row.organizationId != null ? { OrganizationId: row.organizationId } : {}),
    DemandSourceType: 'User Defined',
    DemandSourceName: String(orderNo),
    SupplySourceType: 'On hand',
    ...(row.uom ? { ReservationUOMCode: row.uom } : {}),
    ...(row.subinventory ? { SubinventoryCode: row.subinventory } : {}),
    ReservationQuantity: num(row.qty),
    ...(row.lot ? { LotNumber: row.lot } : {}),
  });

  // Open the Reserve dialog — resolve each line's InventoryItemId / OrganizationId
  // and the AVAILABLE on-hand lots (+ their subinventory + qty) so the user can
  // pick the lot to reserve (required for lot-controlled items — INV-2416216).
  // Build the Create-Reservation rows (resolve item/org ids + on-hand lots).
  const buildReserveRows = async () => {
    const key = liveOrderKey(); const org = hdr.warehouse;
    if (!key || !org) return;
    setWorkBusy('reserve');
    const orgId = warehouseOrgId();
    try {
      const targets = lines.filter(l => l.itemNumber && !l.canceled && num(l.qty) > 0);
      const rows = await mapLimit(targets, 4, async (l) => {
        const d = await fetchReserveOptions(l.itemNumber, org, hdr.subinventory);
        const chosen = (l.lot ? d.options.find(o => o.lot === l.lot) : undefined) ?? d.options[0];
        return {
          key: l.key, item: l.itemNumber, uom: l.uom,
          inventoryItemId: d.inventoryItemId, organizationId: d.organizationId ?? orgId,
          lotControlled: d.lotControlled, options: d.options,
          lot: chosen?.lot ?? l.lot, subinventory: chosen?.subinventory ?? hdr.subinventory,
          qty: num(l.qty),
        };
      });
      setReserveRows(rows);
    } finally { setWorkBusy(null); }
  };
  // Load the existing reservations list (item + source txn number) + count.
  const loadResvList = async () => {
    setResvListLoading(true);
    try { const l = await fetchReservations(orderNumber, lines.map(x => x.itemNumber)); setResvList(l); setResvCount(l.length); }
    finally { setResvListLoading(false); }
  };
  // Open the single Reservations hub (tabs: Create / View). Default to whichever
  // is more useful — View when reservations already exist, else Create.
  const openReservationsHub = () => {
    const key = liveOrderKey();
    if (!key) { message.warning('Save the order first'); return; }
    setReserveOpen(true);
    setResvTab((resvCount ?? 0) > 0 ? 'view' : 'create');
    buildReserveRows();
    loadResvList();
  };
  // Reservation count on the toolbar button — auto-run once the order's lines are
  // loaded (e.g. opening a draft order to edit) and after any reserve/unreserve.
  useEffect(() => {
    if (!liveOrderKey() || !lines.length) return;
    fetchReservations(orderNumber, lines.map(x => x.itemNumber)).then(l => setResvCount(l.length)).catch(() => {});
  }, [createdOrderKey, resvReloadKey, lines.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  // Run the reservations shown in the dialog (one POST per line), recording
  // each line's HTTP status + errors inline.
  const runReserve = async () => {
    // Reservations are keyed by the SOURCE transaction number (e.g. LSO…), not
    // the Fusion order number — so View/Unreserve can find them by item + name.
    const orderNo = orderNumber;
    // Guard: lot-controlled lines must have a lot + subinventory selected.
    const missing = reserveRows.filter(r => r.lotControlled && (!r.lot || !r.subinventory));
    if (missing.length) { message.warning(`Select a lot & subinventory for: ${missing.map(m => m.item).join(', ')}`); return; }
    setWorkBusy('reserve');
    const out: typeof reserveRows = [];
    for (const row of reserveRows) {
      const body = reserveRowBody(row, orderNo);
      try {
        const r = await fetch(RESERVE_URL, { method: 'POST', headers: { ...getHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const text = await r.text(); let data: any = null, pretty = text;
        try { data = JSON.parse(text); pretty = JSON.stringify(data, null, 2); } catch { /* raw */ }
        out.push({ ...row, status: r.status, ok: r.ok, response: pretty,
          errors: r.ok ? [] : (collectOrderErrors(data, text, true).length ? collectOrderErrors(data, text, true) : [`HTTP ${r.status}`]) });
      } catch (e: any) { out.push({ ...row, status: 0, ok: false, response: e?.message, errors: [e?.message ?? 'Network error'] }); }
    }
    setReserveRows(out);
    setLastResponse(JSON.stringify(out.map(o => ({ item: o.item, request: reserveRowBody(o, orderNo), status: o.status, ok: o.ok, response: o.response })), null, 2));
    saveOrderLog(`order-RESERVE-${orderNo}-${Date.now()}.json`, JSON.stringify(out.map(o => ({ item: o.item, request: reserveRowBody(o, orderNo), status: o.status, ok: o.ok, errors: o.errors })), null, 2));
    const okN = out.filter(x => x.ok).length, bad = out.length - okN;
    if (bad === 0) message.success(`Reserved ${okN} line(s) for order ${orderNo}`);
    else message.error(`${bad} of ${out.length} reservation(s) failed — see the dialog`);
    setWorkBusy(null);
  };

  // Unreserve — find the reservations created for this order (DemandSourceName =
  // order number) and delete each.
  // Delete every reservation for the order (found by item + source txn number).
  const deleteReservationsFor = async (demandName: string) => {
    const reservations = await fetchReservations(demandName, lines.map(l => l.itemNumber));
    const results: any[] = [];
    for (const it of reservations) {
      const rid = pf(it, ['ReservationId']);
      if (rid == null) continue;
      try {
        const dr = await fetch(`${RESERVE_URL}/${encodeURIComponent(String(rid))}`, { method: 'DELETE', headers: getHeaders() });
        results.push({ reservationId: rid, item: pf(it, ['ItemNumber']), status: dr.status, ok: dr.ok });
      } catch (e: any) { results.push({ reservationId: rid, status: 0, ok: false, error: e?.message }); }
    }
    const okN = results.filter(x => x.ok).length;
    return { count: reservations.length, okN, bad: results.length - okN, results };
  };
  const unreserveStock = async () => {
    const orderNo = orderNumber;
    if (!orderNo) { message.warning('Save the order first'); return; }
    setWorkBusy('unreserve');
    try {
      const { count, okN, bad, results } = await deleteReservationsFor(orderNo);
      if (!count) { message.info(`No reservations found for order ${orderNo}`); return; }
      setLastResponse(JSON.stringify(results, null, 2));
      saveOrderLog(`order-UNRESERVE-${orderNo}-${Date.now()}.json`, JSON.stringify(results, null, 2));
      setResvReloadKey(k => k + 1);
      if (bad === 0) message.success(`Unreserved ${okN} reservation(s) for order ${orderNo}`);
      else Modal.error({ title: `Unreserve: ${okN} ok, ${bad} failed`, width: 620, content: <pre style={{ maxHeight: 300, overflow: 'auto', fontSize: 12 }}>{JSON.stringify(results, null, 2)}</pre> });
    } catch (e: any) { message.error(e?.message || 'Unreserve failed'); }
    finally { setWorkBusy(null); }
  };

  const totQty = lines.reduce((s, l) => s + num(l.qty), 0);
  const totAmt = lines.reduce((s, l) => s + num(l.qty) * num(l.unitPrice), 0);
  const lineTax = lines.reduce((s, l) => s + num(l.taxAmount), 0);
  const totCharge = lines.reduce((s, l) => s + num(l.chargeAmount), 0);

  const cols: ColumnsType<NewLine> = [
    { title: 'Line', width: 50, align: 'center', fixed: 'left', render: (_, __, i) => <Tag color="blue">{i + 1}</Tag> },
    { title: 'Item', dataIndex: 'itemNumber', width: 210, fixed: 'left', render: (v, r) => v
        ? <Space size={4}>
            <Text strong style={{ color: REDWOOD.info, fontSize: 12 }}>{v}</Text>
            <Tooltip title="Select / change lot"><Button size="small" type="text" icon={<TagsOutlined />} style={{ color: REDWOOD.info }} onClick={() => reopenLotPick(r)} /></Tooltip>
            {inventoryTransactionFlag && <Tooltip title="Allocate lot & serial"><Button size="small" type="text" icon={<TagsOutlined />} style={{ color: REDWOOD.success }} onClick={() => { setAllocationLine(r); setAllocationModalOpen(true); }} /></Tooltip>}
          </Space>
        : <Select showSearch size="small" style={{ width: 196 }} placeholder="Type 3+ chars — code / desc" value={undefined}
            filterOption={false} loading={lineSearch[r.key]?.loading} onSearch={t => onLineSearch(r.key, t)} onChange={val => pickInlineItem(r.key, val)}
            notFoundContent={lineSearch[r.key]?.loading ? <Spin size="small" /> : (lineSearch[r.key]?.tooShort ? 'Type at least 3 characters' : 'No match')}
            options={(lineSearch[r.key]?.opts ?? []).map(o => ({ value: o.ItemNumber, label: <span><Text strong style={{ fontSize: 11 }}>{o.ItemNumber}</Text>{o.ItemDescription ? <Text type="secondary" style={{ fontSize: 11 }}> — {o.ItemDescription}</Text> : null}</span> }))} /> },
    { title: 'Description', dataIndex: 'description', width: 240, ellipsis: true, render: (v, r) => r.ohLoading && v == null ? <Spin size="small" /> : <Text style={{ fontSize: 12 }}>{v ?? '—'}</Text> },
    { title: 'UOM', dataIndex: 'uom', width: 70, render: v => v ?? '—' },
    { title: 'Cost', dataIndex: 'costUnit', width: 90, align: 'right', render: v => v == null ? '—' : <Text type="secondary" style={{ fontSize: 11 }}>{fmtAmount(v, ccy)}</Text> },
    { title: 'QoH', dataIndex: 'qoh', width: 80, align: 'right', render: (v, r) => r.ohLoading ? <Spin size="small" /> : (v == null ? <Text type="secondary" style={{ fontSize: 11 }}>—</Text> : <Text style={{ fontSize: 11.5, color: REDWOOD.info, fontVariantNumeric: 'tabular-nums' }}>{fmtQty(num(v))}</Text>) },
    { title: returnMode ? 'Return Qty' : 'Qty', dataIndex: 'qty', width: returnMode ? 100 : 90, align: 'left', render: (v, r) => <InputNumber size="small" min={0} max={returnMode && r.maxQty != null ? r.maxQty : (r.qoh != null ? r.qoh : undefined)} value={v} disabled={!!r.canceled || (editMode && !!r.existing) || (returnMode && !!r.retLots?.length)}
        onChange={n => { let q = Number(n) || 0; if (returnMode && r.maxQty != null && q > r.maxQty) { q = r.maxQty; message.warning(`Cannot return more than ordered (${fmtQty(r.maxQty)})`); } else if (!returnMode && r.qoh != null && q > r.qoh) { q = r.qoh; message.warning(`Cannot order more than on-hand (${fmtQty(r.qoh)})`); } updLine(r.key, { qty: q }); }} style={{ width: returnMode ? 88 : 78 }} /> },
    ...(returnMode ? [{ title: 'Return Reason', dataIndex: 'returnReason', width: 190, render: (v: any, r: NewLine) => <Select size="small" showSearch style={{ width: 178 }} value={v || undefined} placeholder="Reason" popupMatchSelectWidth={false}
        options={returnReasonOpts} optionFilterProp="label" onChange={val => updLine(r.key, { returnReason: val })} /> } as any] : []),
    ...(returnMode ? [{ title: 'Lot / Serial', dataIndex: 'retLots', width: 150, render: (_: any, r: NewLine) => {
        const n = r.retLots?.length ?? 0;
        const lots = Array.from(new Set((r.retLots ?? []).map(x => x.lot).filter(Boolean)));
        const serN = (r.retLots ?? []).filter(x => x.serial).length;
        return n
          ? <Button size="small" type="link" style={{ padding: 0 }} icon={<TagsOutlined />} onClick={() => setRetLsKey(r.key)}>
              {serN ? `${serN} serial${serN !== 1 ? 's' : ''}` : `${lots.length} lot${lots.length !== 1 ? 's' : ''}`}
            </Button>
          : <Text type="secondary" style={{ fontSize: 11 }}>— none —</Text>;
      } } as any] : []),
    { title: 'Unit Price', dataIndex: 'unitPrice', width: 100, align: 'left', render: (v, r) => <InputNumber size="small" min={0} value={v} disabled={!!r.canceled || (editMode && !!r.existing) || returnMode} onChange={n => updLine(r.key, { unitPrice: Number(n) || 0 })} style={{ width: 88 }} /> },
    { title: 'Line Total', width: 118, align: 'right', render: (_, r) => {
        const calc = round2(num(r.qty) * num(r.unitPrice));
        // Show the amount AS LOADED from Fusion; flag when it disagrees with qty×price.
        const shown = r.loadedExt != null ? r.loadedExt : calc;
        const mismatch = r.loadedExt != null && round2(r.loadedExt) !== calc;
        const canDrill = !!(r.chargesHref || r.lineHref);   // existing line → drill to charges
        return <Space size={4}>
          {mismatch && <Tooltip title={`Stored amount ${fmtAmount(r.loadedExt, ccy)} ≠ Qty×Price ${fmtAmount(calc, ccy)} — line total is inconsistent in Fusion`}><WarningFilled style={{ color: REDWOOD.error }} /></Tooltip>}
          {canDrill
            ? <Tooltip title="View charges & price components"><a onClick={() => openChargeDrill(r)} style={{ color: mismatch ? REDWOOD.error : REDWOOD.primary, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmtAmount(shown, ccy)}</a></Tooltip>
            : <Text strong style={{ color: mismatch ? REDWOOD.error : REDWOOD.primary, fontVariantNumeric: 'tabular-nums' }}>{fmtAmount(shown, ccy)}</Text>}
        </Space>;
      } },
    { title: 'Margin', width: 100, align: 'right', render: (_, r) => { const m = (num(r.unitPrice) - num(r.costUnit)) * num(r.qty); return <Text style={{ fontSize: 11.5, color: m < 0 ? REDWOOD.error : REDWOOD.success, fontVariantNumeric: 'tabular-nums' }}>{fmtAmount(m, ccy)}</Text>; } },
    { title: 'Tax Code', dataIndex: 'taxCode', width: 140, render: (v, r) => <Select size="small" showSearch allowClear style={{ width: 128 }} popupMatchSelectWidth={false} value={v || undefined} placeholder="—"
        options={taxOptions} optionFilterProp="value"
        notFoundContent={taxOptions.length ? undefined : (hdr.businessUnit ? 'No tax codes' : 'Select a business unit')}
        onChange={val => { const opt = taxOptions.find(o => o.value === val); updLine(r.key, { taxCode: val, taxPct: opt ? opt.pct : undefined }); }} /> },
    { title: 'Tax', dataIndex: 'taxAmount', width: 120, align: 'right', render: (v, r) => <Space size={4}>{r.taxPct != null && <Tag color="gold" style={{ margin: 0, fontSize: 10 }}>{r.taxPct}%</Tag>}<Text style={{ fontSize: 11.5, fontVariantNumeric: 'tabular-nums' }}>{fmtAmount(num(v), ccy)}</Text></Space> },
    { title: 'Charge', dataIndex: 'chargeAmount', width: 100, align: 'right', render: (v, r) => {
        const canDrill = !!(r.chargesHref || r.lineHref);
        const el = <Text style={{ fontSize: 11.5, color: num(v) ? REDWOOD.primary : REDWOOD.neutral600, fontVariantNumeric: 'tabular-nums' }}>{num(v) ? fmtAmount(num(v), ccy) : '—'}</Text>;
        return canDrill ? <Tooltip title="View charges"><a onClick={() => openChargeDrill(r)}>{el}</a></Tooltip> : el;
      } },
    { title: 'Net', width: 116, align: 'right', fixed: 'right', render: (_, r) => {
        const base = r.loadedExt != null ? r.loadedExt : round2(num(r.qty) * num(r.unitPrice));
        const net = base + num(r.taxAmount) + num(r.chargeAmount);
        const canDrill = !!(r.chargesHref || r.lineHref);
        const el = <Text strong style={{ color: REDWOOD.success, fontVariantNumeric: 'tabular-nums' }}>{fmtAmount(net, ccy)}</Text>;
        return canDrill ? <Tooltip title="View charges & price components"><a onClick={() => openChargeDrill(r)} style={{ color: REDWOOD.success, fontWeight: 600 }}>{fmtAmount(net, ccy)}</a></Tooltip> : el;
      } },
    { title: 'Status', dataIndex: 'status', width: 130, fixed: 'right', render: (v, r, i) => r.error
        ? <Tooltip title="Click to view the error"><Button size="small" type="text" danger style={{ padding: '0 4px' }}
            icon={<CloseCircleTwoTone twoToneColor={REDWOOD.error} />}
            onClick={() => setErrModal({ title: `Line ${r.srcLineNumber ?? i + 1}${r.itemNumber ? ` · ${r.itemNumber}` : ''}`, msg: r.error! })}>Error</Button></Tooltip>
        : r.canceled
          ? <Tag color="error" style={{ fontSize: 11 }}>Canceled</Tag>
          : (v || r.statusCode ? statusTag(v, r.statusCode) : <Text type="secondary" style={{ fontSize: 11 }}>—</Text>) },
    { title: '', width: 76, align: 'center', fixed: 'right', render: (_, r) => r.canceled
        ? <Text type="secondary" style={{ fontSize: 11 }}>—</Text>
        : (editMode && r.existing)
        ? <Space size={0}>
            <Tooltip title={canUpdateLine(r) ? 'Update line' : 'Locked — Awaiting Billing / Closed'}>
              <Button size="small" type="text" icon={<EditOutlined />} disabled={!canUpdateLine(r)}
                style={{ color: canUpdateLine(r) ? REDWOOD.info : undefined }} onClick={() => openUpdateLine(r)} />
            </Tooltip>
            <Tooltip title={isDraftStatus ? 'Delete line' : 'Cancel line'}>
              <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => confirmRemoveLine(r)} />
            </Tooltip>
          </Space>
        : <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => confirmRemoveLine(r)} /> },
  ];

  // Margin tab — item code / description plus margin figures.
  const marginCols: ColumnsType<NewLine> = [
    { title: 'Item', dataIndex: 'itemNumber', width: 150, render: v => <Text strong style={{ color: REDWOOD.info, fontSize: 12 }}>{v}</Text> },
    { title: 'Description', dataIndex: 'description', width: 260, ellipsis: true, render: v => <Text style={{ fontSize: 12 }}>{v ?? '—'}</Text> },
    { title: 'Qty', dataIndex: 'qty', width: 80, align: 'right', render: v => fmtQty(num(v)) },
    { title: 'Cost', dataIndex: 'costUnit', width: 100, align: 'right', render: v => v == null ? '—' : <Text type="secondary" style={{ fontSize: 11 }}>{fmtAmount(num(v), ccy)}</Text> },
    { title: 'Unit Price', dataIndex: 'unitPrice', width: 100, align: 'right', render: v => fmtAmount(num(v), ccy) },
    { title: 'Margin', width: 120, align: 'right', render: (_, r) => { const m = (num(r.unitPrice) - num(r.costUnit)) * num(r.qty); return <Text strong style={{ color: m < 0 ? REDWOOD.error : REDWOOD.success, fontVariantNumeric: 'tabular-nums' }}>{fmtAmount(m, ccy)}</Text>; } },
    { title: 'Margin %', width: 90, align: 'right', render: (_, r) => { const t = num(r.qty) * num(r.unitPrice); const m = (num(r.unitPrice) - num(r.costUnit)) * num(r.qty); const pct = t ? (m / t) * 100 : 0; return <Text style={{ fontSize: 11.5, color: pct < 0 ? REDWOOD.error : REDWOOD.success }}>{t ? pct.toFixed(1) + '%' : '—'}</Text>; } },
  ];

  // Lot Details tab — one row per lotSerial fetched from the line's lotSerials child
  // (falls back to the locally-selected lot(s) for create-mode / not-yet-saved lines).
  const lotRows = useMemo(() => lines.flatMap(l => {
    const fusionLots = l.lineLots ?? [];
    if (fusionLots.length) {
      return fusionLots.map((ls: any, i: number) => ({
        key: `${l.key}-ls-${i}`, itemNumber: l.itemNumber, description: l.description,
        lot: pf(ls, ['LotNumber', 'Lot']),
        serialFrom: pf(ls, ['ItemSerialNumberFrom', 'FromSerialNumber']),
        serialTo: pf(ls, ['ItemSerialNumberTo', 'ToSerialNumber']),
        subinventory: pf(ls, ['SubinventoryCode', 'Subinventory']),
        qty: num(pf(ls, ['Quantity', 'LotQuantity'])) || l.qty,
        source: 'fusion' as const,
      }));
    }
    // Selected allocations (from modal) take priority over manually entered lots
    if (l.selectedLot || l.selectedSerials?.length) {
      const rows: any[] = [];
      if (l.selectedSerials && l.selectedSerials.length) {
        l.selectedSerials.forEach((serial, i) => {
          rows.push({
            key: `${l.key}-sel-${i}`, itemNumber: l.itemNumber, description: l.description,
            lot: l.selectedLot, serialFrom: serial, serialTo: serial, qty: 1, source: 'selected' as const,
          });
        });
      } else if (l.selectedLot) {
        rows.push({
          key: `${l.key}-sel-lot`, itemNumber: l.itemNumber, description: l.description,
          lot: l.selectedLot, qty: l.qty, source: 'selected' as const,
        });
      }
      return rows.length ? rows : [{ key: `${l.key}-nolot`, itemNumber: l.itemNumber, description: l.description, lot: undefined as string | undefined, qty: l.qty, source: 'local' as const }];
    }
    const ls = (l.lots && l.lots.length) ? l.lots : (l.lot ? [l.lot] : []);
    return ls.length
      ? ls.map((lot, i) => ({ key: `${l.key}-lot-${i}`, itemNumber: l.itemNumber, description: l.description, lot, qty: l.qty, source: 'local' as const }))
      : [{ key: `${l.key}-nolot`, itemNumber: l.itemNumber, description: l.description, lot: undefined as string | undefined, qty: l.qty, source: 'local' as const }];
  }), [lines]);
  const lotCols: ColumnsType<any> = [
    { title: 'Item', dataIndex: 'itemNumber', width: 150, render: v => <Text strong style={{ color: REDWOOD.info, fontSize: 12 }}>{v}</Text> },
    { title: 'Description', dataIndex: 'description', width: 240, ellipsis: true, render: v => <Text style={{ fontSize: 12 }}>{v ?? '—'}</Text> },
    { title: 'Lot', dataIndex: 'lot', width: 180, render: (v, r) => v ? <Space size={4}><Tag color={r.source === 'selected' ? 'green' : 'geekblue'}>{v}</Tag>{r.source === 'selected' && <Tag color="cyan" style={{ fontSize: 10 }}>allocated</Tag>}</Space> : <Text type="secondary">— no lot —</Text> },
    { title: 'Serial', width: 160, render: (_, r) => r.serialFrom ? <Text style={{ fontSize: 11.5 }}>{r.serialFrom}{r.serialTo && r.serialTo !== r.serialFrom ? ` → ${r.serialTo}` : ''}</Text> : <Text type="secondary" style={{ fontSize: 11 }}>—</Text> },
    { title: 'Subinventory', dataIndex: 'subinventory', width: 130, render: v => v ? <Text style={{ fontSize: 11.5 }}>{v}</Text> : <Text type="secondary" style={{ fontSize: 11 }}>—</Text> },
    { title: 'Qty', dataIndex: 'qty', width: 90, align: 'right', render: v => fmtQty(num(v)) },
    {
      title: 'Action',
      width: 110,
      fixed: 'right',
      render: (_, r) => {
        const line = lines.find(l => l.key === r.key.split('-')[0]);
        if (!line) return null;
        const isFirstRow = lotRows.findIndex(lr => lr.key.startsWith(r.key.split('-')[0])) === lotRows.indexOf(r);
        return isFirstRow && inventoryTransactionFlag ? (
          <Button size="small" type="primary" icon={<TagsOutlined />} onClick={() => { setAllocationLine(line); setAllocationModalOpen(true); }} style={{ background: REDWOOD.info, borderColor: REDWOOD.info }}>
            Allocate
          </Button>
        ) : null;
      },
    },
  ];

  // Fulfillment tab — item + warehouse (org) + subinventory per line.
  const fulfillCols: ColumnsType<NewLine> = [
    { title: 'Item', dataIndex: 'itemNumber', width: 160, render: v => <Text strong style={{ color: REDWOOD.info, fontSize: 12 }}>{v}</Text> },
    { title: 'Description', dataIndex: 'description', width: 300, ellipsis: true, render: v => <Text style={{ fontSize: 12 }}>{v ?? '—'}</Text> },
    { title: 'Warehouse', width: 170, render: (_, r) => { const o = r.orgCode ?? hdr.warehouse; return o ? <Tag color="geekblue">{o}</Tag> : <Text type="secondary">—</Text>; } },
    { title: 'Subinventory', width: 150, render: (_, r) => { const s = r.subinventory ?? hdr.subinventory; return s ? <Tag color="cyan">{s}</Tag> : <Text type="secondary">—</Text>; } },
    { title: 'Lot', width: 160, render: (_, r) => { const lot = r.lot ?? (r.lots && r.lots[0]); return lot ? <Tag color="geekblue">{lot}</Tag> : <Text type="secondary">—</Text>; } },
    { title: 'Qty', dataIndex: 'qty', width: 80, align: 'right', render: v => fmtQty(num(v)) },
  ];

  // Errors tab — per-line errors + general order-level errors from the last save.
  const errorRows = useMemo(() => {
    const rows: { key: string; scope: string; item?: string; msg: string }[] = [];
    lines.forEach((l, i) => {
      if (l.error) l.error.split('\n\n').forEach((m, j) => rows.push({ key: `${l.key}-e${j}`, scope: `Line ${l.srcLineNumber ?? i + 1}`, item: l.itemNumber, msg: m }));
    });
    orderErrors.filter(m => !lines.some(l => l.error?.includes(m))).forEach((m, j) => rows.push({ key: `gen-${j}`, scope: 'Order', msg: m }));
    return rows;
  }, [lines, orderErrors]);

  // System IDs tab (edit mode) — the Fusion keys we use to target each line.
  const sysIdRows = useMemo(() => lines.map((l, i) => ({
    key: l.key, lineNo: l.srcLineNumber ?? i + 1, item: l.itemNumber,
    fulfillLineId: l.fulfillLineId, srcLineId: l.srcLineId,
    linesUniqID: l.lineHref ? l.lineHref.split('/child/lines/')[1]?.split(/[?#]/)[0] : undefined,
    state: !l.existing ? 'New' : (l.canceled ? (isDraftStatus ? 'Delete' : 'Cancel') : (num(l.qty) !== num(l.origQty) ? 'Update' : 'Unchanged')),
  })), [lines]);

  // Vertical icon-rail tab label (Fusion-style): a colourful icon only; the tab
  // name — and its count when there is one — appear in the tooltip on hover.
  const vTab = (icon: React.ReactNode, title: string, color: string, count?: number) => (
    <Tooltip title={count != null ? `${title} (${count})` : title} placement="right">
      <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 46, padding: '9px 0' }}>
        <span style={{ fontSize: 20, color, lineHeight: 1 }}>{icon}</span>
      </span>
    </Tooltip>
  );

  // Allocation Modal — select lots and serials for InventoryTransactionFlag
  const AllocationModalComponent = () => {
    if (!allocationLine) return null;
    const [balances, setBalances] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [selLot, setSelLot] = useState<string | undefined>(allocationLine.selectedLot);
    const [selSerials, setSelSerials] = useState<string[]>(allocationLine.selectedSerials ?? []);

    const url = useMemo(() => {
      const org = hdr.warehouse;
      const item = allocationLine.itemNumber;
      const subinv = allocationLine.subinventory || hdr.subinventory;
      if (!org || !item) return '';
      const q = `OrganizationCode=${org};ItemNumber=${item}` + (subinv ? `;SubinventoryCode=${subinv}` : '');
      return `${FUSION_BASE}/inventoryOnhandBalances?q=${encodeURIComponent(q)}&expand=lots.lotSerials,serials&onlyData=true&limit=500`;
    }, [allocationLine, hdr.warehouse, hdr.subinventory]);

    const load = useCallback(async () => {
      if (!url) return;
      setLoading(true);
      setError('');
      setSelLot(allocationLine.selectedLot);
      setSelSerials(allocationLine.selectedSerials ?? []);
      try {
        setBalances(await fetchAllPages(url));
      } catch (e: any) {
        setError(e.message);
        setBalances([]);
      } finally {
        setLoading(false);
      }
    }, [url]);

    useEffect(() => {
      if (allocationModalOpen) load();
    }, [allocationModalOpen, load]);

    const lots = useMemo(() => {
      const map: Record<string, { lot: string; qty: number; serials: string[] }> = {};
      balances.forEach(b => (b.lots ?? []).forEach((lot: any) => {
        const ln = pf(lot, ['LotNumber', 'Lot']);
        if (!ln) return;
        if (!map[ln]) map[ln] = { lot: ln, qty: 0, serials: [] };
        map[ln].qty += num(pf(lot, ['OnhandQuantity', 'PrimaryQuantity', 'Quantity', 'LotQuantity']));
        (lot.lotSerials ?? []).forEach((s: any) => {
          const sn = pf(s, ['SerialNumber', 'FmSerialNumber']);
          if (sn) map[ln].serials.push(sn);
        });
      }));
      return Object.values(map).sort((a, b) => a.lot.localeCompare(b.lot));
    }, [balances]);

    const serialOnly = useMemo(() =>
      Array.from(new Set(balances.flatMap(b => (b.serials ?? []).map((s: any) => pf(s, ['SerialNumber', 'FmSerialNumber'])).filter(Boolean)))),
      [balances]
    );

    const availSerials: string[] = useMemo(() => {
      if (selLot) return lots.find(l => l.lot === selLot)?.serials ?? [];
      return serialOnly as string[];
    }, [selLot, lots, serialOnly]);

    // Auto-select serials when lot is selected (based on line quantity)
    useEffect(() => {
      if (selLot && availSerials.length > 0 && selSerials.length === 0) {
        const reqQty = num(allocationLine.qty);
        const autoSelected = availSerials.slice(0, Math.min(reqQty, availSerials.length));
        setSelSerials(autoSelected);
      }
    }, [selLot]);

    const isLotControlled = lots.length > 0;

    const handleApply = () => {
      upd(allocationLine.key, { selectedLot: selLot, selectedSerials: selSerials });
      message.success(`Allocated ${selLot ? `lot ${selLot}` : 'serial'}${selSerials.length ? ` with ${selSerials.length} serial(s)` : ''}`);
      setAllocationModalOpen(false);
      setAllocationLine(null);
    };

    return (
      <Modal
        open={allocationModalOpen && !!allocationLine}
        onCancel={() => {
          setAllocationModalOpen(false);
          setAllocationLine(null);
        }}
        maskClosable={false}
        width={720}
        title={<Space><ProfileOutlined style={{ color: REDWOOD.primary }} /> Allocate Lot/Serial — <Text strong>{allocationLine.itemNumber}</Text></Space>}
        footer={<Space>
          <Text type={selSerials.length === 0 ? 'warning' : undefined} style={{ marginRight: 'auto', fontSize: 12 }}>
            Allocated <b>{selSerials.length}</b> serial(s){selLot ? ` from lot ${selLot}` : ''}
          </Text>
          <Button onClick={() => { setAllocationModalOpen(false); setAllocationLine(null); }}>Cancel</Button>
          <Button type="primary" disabled={!isLotControlled && serialOnly.length === 0} style={{ background: REDWOOD.success, borderColor: REDWOOD.success }} onClick={handleApply}>
            Apply Allocation
          </Button>
        </Space>}
      >
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 12, fontSize: 12 }}>
          <span><Text type="secondary">Org: </Text><Tag>{hdr.warehouse}</Tag></span>
          <span><Text type="secondary">Item: </Text><Tag color="geekblue">{allocationLine.itemNumber}</Tag></span>
          {(allocationLine.subinventory || hdr.subinventory) && <span><Text type="secondary">Subinventory: </Text>{allocationLine.subinventory || hdr.subinventory}</span>}
          <Tooltip title={<span style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}><b>GET</b> {url}</span>}>
            <Button size="small" type="text" icon={<ApiOutlined />} style={{ color: REDWOOD.info, marginLeft: 'auto' }} />
          </Tooltip>
          <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={load}>Reload</Button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <Spin />
          </div>
        ) : error ? (
          <div style={{ color: REDWOOD.error, fontSize: 12 }}>
            <InfoCircleOutlined style={{ marginRight: 6 }} />
            {error}
          </div>
        ) : (
          <>
            {isLotControlled && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                  Lot <span style={{ color: REDWOOD.error }}>*</span> <Text type="secondary" style={{ fontWeight: 400 }}>(change lot for this line)</Text>
                </div>
                <Select showSearch style={{ width: '100%' }} placeholder="Select a lot from on-hand" value={selLot} onChange={v => { setSelLot(v); setSelSerials([]); }} options={lots.map(l => ({ value: l.lot, label: `${l.lot} — on-hand ${fmtQty(l.qty)}${l.serials.length ? ` · ${l.serials.length} serial(s)` : ''}` }))} notFoundContent="No lots on hand" />
              </div>
            )}
            {!isLotControlled && serialOnly.length === 0 ? (
              <Empty description="No lots or serials on hand for this item / subinventory" style={{ padding: 24 }} />
            ) : (
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                  Available Serial Numbers {selLot ? <Text type="secondary" style={{ fontWeight: 400 }}>for lot {selLot}</Text> : ''}
                  {availSerials.length > 0 && <Tag style={{ marginLeft: 6 }}>{availSerials.length}</Tag>}
                </div>
                {isLotControlled && !selLot ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Select a lot to see its serials" style={{ padding: 20 }} />
                ) : availSerials.length === 0 ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No serials on hand" style={{ padding: 20 }} />
                ) : (
                  <Table size="small" scroll={{ y: 300 }} pagination={false} dataSource={availSerials.map((s, i) => ({ key: `${s}-${i}`, SerialNumber: s }))} rowKey="SerialNumber" rowSelection={{ selectedRowKeys: selSerials, onChange: (keys) => setSelSerials(keys as string[]) }} columns={[{ title: 'Serial Number', dataIndex: 'SerialNumber', render: v => <Text strong style={{ fontSize: 12 }}>{v}</Text> }]} />
                )}
              </div>
            )}
          </>
        )}
      </Modal>
    );
  };

  return (
    <div style={{ padding: '4px 2px' }}>
      <Card size="small" style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}`, marginBottom: 12 }}
        styles={{ body: { paddingTop: 4 } }}
        title={<Space><span style={{ width: 30, height: 30, borderRadius: 8, background: editMode ? 'linear-gradient(135deg, #B07700, #8a5e00)' : returnMode ? 'linear-gradient(135deg, #B12A5B, #7d1c3f)' : `linear-gradient(135deg, ${REDWOOD.primary}, ${REDWOOD.primary}bb)`, color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 15 }}>{editMode ? <EditOutlined /> : returnMode ? <RollbackOutlined /> : <BankOutlined />}</span>
          <Text strong style={{ fontSize: 15 }}>{editMode ? 'Edit Sales Order' : returnMode ? 'Return Order (RMA)' : 'New Sales Order'}</Text>
          {editMode && <Tag color="warning" style={{ fontWeight: 700 }}>EDIT MODE · rev {(Number(editOrder?.SourceTransactionRevisionNumber) || 1) + 1}</Tag>}
          {returnMode && <Tag color="magenta" style={{ fontWeight: 700 }}>RETURN · ref {lines[0]?.refOrderNumber ?? '—'}</Tag>}
          <Tag color="geekblue" style={{ fontVariantNumeric: 'tabular-nums' }}>{editMode ? (editOrder?.OrderNumber ?? orderNumber) : orderNumber}</Tag>
          {editMode
            ? (() => { const s = String(orderStatus || pf(editOrder, ['StatusCode', 'Status']) || 'DOO_DRAFT').replace(/^DOO_/, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()); return <Tag color={isDraftStatus ? 'gold' : 'green'} style={{ fontWeight: 600 }}>Status: {s}</Tag>; })()
            : <><Tag color="purple">{hdr.orderType}</Tag><Tag>{hdr.txnCurrency}</Tag>{isBranchSales && hdr.branchBU && <Tag color="orange">{hdr.businessUnit} → {hdr.branchBU}</Tag>}</> }</Space>}
        extra={<Space>
          {/* Refresh — re-pull the whole order (lines, charges, tax, totals) from Fusion */}
          {editMode && <Button icon={<ReloadOutlined />} loading={refreshing} onClick={refreshOrder} style={{ color: REDWOOD.info, borderColor: REDWOOD.info }}>Refresh</Button>}
          {/* JSON Actions — save/load the full on-screen draft + payload preview */}
          <Dropdown menu={{ items: [
            { key: 'save', icon: <DownloadOutlined />, label: 'Save JSON', onClick: saveDraftJson },
            { key: 'load', icon: <CloudUploadOutlined />, label: 'Load JSON', onClick: () => jsonInputRef.current?.click() },
            { type: 'divider' },
            { key: 'payload', icon: <ProfileOutlined />, label: 'Payload', onClick: () => setPreview(true) },
          ] }}>
            <Button icon={<DatabaseOutlined />}><Space size={4}>JSON Actions<DownOutlined style={{ fontSize: 10 }} /></Space></Button>
          </Dropdown>
          <input ref={jsonInputRef} type="file" accept=".json,application/json" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) loadDraftJson(f); e.target.value = ''; }} />
          <Button type="primary" icon={<SaveOutlined />} loading={posting} onClick={editMode ? updateOrder : save}
            style={{ background: editMode ? '#B07700' : REDWOOD.success, borderColor: editMode ? '#B07700' : REDWOOD.success }}>
            {editMode ? `Update Order${editOps.length ? ` (${editOps.length})` : ''}` : returnMode ? 'Save Return (Draft)' : 'Save (Draft)'}
          </Button>
          {/* Draft workflow — enabled once the order exists (saved or being edited) */}
          {(!!createdOrderKey || editMode) && <Space>
            {/* Confirm only while the order is still a draft — hidden once submitted (OPEN/processing). */}
            {isDraftStatus && <Button icon={<SendOutlined />} loading={workBusy === 'confirm'} disabled={confirmed} onClick={confirmOrder}
              style={confirmed ? undefined : { background: REDWOOD.primary, borderColor: REDWOOD.primary, color: '#fff' }}>
              {confirmed ? 'Confirmed' : 'Confirm Order'}
            </Button>}
            {!returnMode && <Button icon={<SafetyCertificateOutlined />} loading={workBusy === 'reserve' || workBusy === 'unreserve'} onClick={openReservationsHub}
              style={resvCount ? { color: REDWOOD.success, borderColor: REDWOOD.success, fontWeight: 600 } : undefined}>
              Reservations{resvCount ? ` (${resvCount})` : ''}
            </Button>}
            {!returnMode && anyAwaitingShipping && <Button icon={<CarOutlined />} onClick={() => setAutoShipOpen(true)}
              style={{ borderColor: REDWOOD.success, color: REDWOOD.success }}>Auto Shipconfirm</Button>}
            {!returnMode && anyAwaitingBilling && <Button icon={<DollarOutlined />} onClick={() => setAutoInvoiceOpen(true)}
              style={{ borderColor: REDWOOD.primary, color: REDWOOD.primary }}>Create AR Invoice</Button>}
            {isBranchSales && <Button icon={<ShoppingOutlined />} onClick={() => {
              const displayOrderNo = editMode ? (editOrder?.SourceTransactionNumber ?? orderNumber) : (createdOrderNumber || orderNumber);
              setSavedOrderNumber(displayOrderNo);
              const poNumber = 'BLPO' + displayOrderNo.replace(/^BCSO/, '');
              const branchBU = form.getFieldValue('branchBU') || hdr.branchBU;
              branchSalesForm.resetFields();
              branchSalesForm.setFieldsValue({
                salesOrderNumber: displayOrderNo,
                poNumber: poNumber,
                currency: hdr.txnCurrency,
                branchBusinessUnit: branchBU,
                needByDate: dayjs().add(7, 'days')
              });
              if (branchBU) {
                onBranchBUChange(branchBU);
              }
              setBranchSalesModalOpen(true);
            }}
              style={{ borderColor: REDWOOD.teal, color: REDWOOD.teal }}>Create Branch PO</Button>}
            {/* Order Actions — Discard Draft (draft only) / Cancel Order (processing) */}
            {(editMode || !!createdOrderKey) && (
              <Dropdown trigger={['click']} disabled={orderActionBusy} menu={{ items: [
                ...(editMode && onCopy && rawLines.length ? [{ key: 'copy', icon: <CopyOutlined />, label: 'Copy to New Order', onClick: () => onCopy(editOrder, rawLines) }] : []),
                ...(isDraftStatus ? [{ key: 'discard', danger: true, icon: <DeleteOutlined />, label: 'Discard Draft', onClick: discardDraft }] : []),
                ...(!isDraftStatus ? [{ key: 'cancel', danger: true, icon: <StopOutlined />, label: 'Cancel Order', onClick: cancelOrder }] : []),
                ...(isDraftStatus ? [{ key: 'cancelDraft', danger: true, icon: <StopOutlined />, label: 'Cancel Order (cancel all lines)', onClick: cancelOrder }] : []),
              ] }}>
                <Button danger loading={orderActionBusy}><Space size={4}>Order Actions<DownOutlined style={{ fontSize: 10 }} /></Space></Button>
              </Dropdown>
            )}
          </Space>}
        </Space>}>
        <Form form={form} layout="horizontal" size="small" labelAlign="left" colon labelWrap
          labelCol={{ flex: '0 0 104px' }} wrapperCol={{ flex: '1 1 auto' }}
          onValuesChange={(_c, all) => setHdr(prev => ({ ...prev, ...all }))}>
          <Tabs size="small" items={[
            {
              key: 'header', label: <span><BankOutlined style={{ marginRight: 5 }} />Header</span>,
              children: (
                <Row gutter={[12, 12]} align="stretch">
                  {/* S1 — Order. In edit mode everything is locked; the pencil (draft
                      only) unlocks just Order Date + Order Type, saved via header PATCH. */}
                  <Col xs={24} sm={12} md={8}><VSection icon={<BankOutlined />} title="Order" color={REDWOOD.primary}>
                    {editMode && (
                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
                        {!isDraftStatus
                          ? <Tag color="default" style={{ fontSize: 10 }}>Locked — not a draft</Tag>
                          : hdrUnlocked
                            ? <Space size={4}>
                                <Button size="small" type="primary" icon={<SaveOutlined />} loading={hdrSaving} onClick={saveHeaderFields}>Save</Button>
                                <Button size="small" onClick={() => { form.setFieldsValue({ orderType: hdr.orderType, orderDate: hdr.orderDate ? dayjs(hdr.orderDate) : undefined }); setHdrUnlocked(false); }}>Cancel</Button>
                              </Space>
                            : <Button size="small" icon={<EditOutlined />} style={{ color: REDWOOD.info }} onClick={() => setHdrUnlocked(true)}>Edit</Button>}
                      </div>
                    )}
                    <Form.Item label="Order No" style={{ marginBottom: 10 }}>
                      <Text strong style={{ color: REDWOOD.primary, fontVariantNumeric: 'tabular-nums' }}>{orderNumber}</Text></Form.Item>
                    <Form.Item label="Business Unit" name="businessUnit" style={{ marginBottom: 10 }}>
                      <Select showSearch placeholder="Select" onChange={onBU} optionFilterProp="label" disabled={editMode || !isDraftStatus}
                        options={bUnits.map(b => ({ value: b.businessUnitName, label: `${b.businessUnitName}${b.paymentCurrency ? ` — ${b.paymentCurrency}` : ''}` }))} /></Form.Item>
                    <Form.Item label="Order Date" name="orderDate" style={{ marginBottom: 10 }}><DatePicker style={{ width: '100%' }} disabled={(editMode && !hdrUnlocked) || !isDraftStatus} /></Form.Item>
                    <Form.Item label="Order Type" name="orderType" style={{ marginBottom: 10 }}>
                      <Select
                        showSearch
                        placeholder="Select order type"
                        disabled={(editMode && !hdrUnlocked) || !isDraftStatus}
                        onChange={onOrderTypeChange}
                        optionFilterProp="label"
                        options={orderTypeOpts}
                      />
                    </Form.Item>
                    <Form.Item label="Customer PO" name="customerPONumber" style={{ marginBottom: 10 }}><Input placeholder="Customer PO number" disabled={(editMode && !hdrUnlocked) || !isDraftStatus} /></Form.Item>
                    {isBranchSales && (() => {
                      const orderTypeDetail = orderTypeLookup.get(hdr.orderType);
                      const branchPoCode = orderTypeDetail?.branchPoCode || '—';
                      const orderTypeName = orderTypeDetail?.Meaning || hdr.orderType;
                      return (
                        <>
                          <Form.Item label="Branch BU" name="branchBU" rules={[{ required: true, message: 'Select a branch BU' }]} style={{ marginBottom: 10, marginTop: 10 }}>
                            <Select
                              showSearch
                              disabled={editMode && hdr.branchBU}
                              placeholder="Select Branch Business Unit"
                              optionFilterProp="label"
                              options={bUnits.map(b => ({ value: b.businessUnitName, label: `${b.businessUnitName}${b.paymentCurrency ? ` — ${b.paymentCurrency}` : ''}` }))}
                            />
                          </Form.Item>
                          <div style={{ fontSize: 12, color: REDWOOD.warning, fontWeight: 500, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                            <ShoppingOutlined style={{ fontSize: 14 }} />
                            <span>🔖 Branch Sales ({orderTypeName}) — will create linked PO with <strong>{branchPoCode}</strong>- prefix</span>
                          </div>
                        </>
                      );
                    })()}
                  </VSection></Col>

                  {/* S2 — Customer Information. Customer is locked in edit mode (a DOO
                      order's buying party can't be changed via REST). */}
                  <Col xs={24} sm={12} md={5}><VSection icon={<ProfileOutlined />} title="Customer Information" color={REDWOOD.info}>
                    <Form.Item label="Customer Name" name="customerName" layout="vertical" labelCol={{ span: 24 }} wrapperCol={{ span: 24 }} style={{ marginBottom: 10 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                        <Input readOnly placeholder="Select a customer" value={hdr.customerName || ''} style={{ flex: 1 }} />
                        <Button type="primary" icon={<SearchOutlined />} onClick={() => setCustSearchModalOpen(true)} disabled={!hdr.businessUnit || (editMode && hdr.customerName)} title={editMode && hdr.customerName ? "Customer cannot be changed in edit mode" : (hdr.businessUnit ? "Search Customer (BIP)" : "Select Business Unit first")} style={{ background: REDWOOD.info, borderColor: REDWOOD.info }} />
                      </div>
                    </Form.Item>
                    <Form.Item label="Cust Number" name="accountNumber" style={{ marginBottom: 10 }}><Input readOnly placeholder="—" /></Form.Item>
                    <Form.Item label="Payment Terms" name="paymentTerms" style={{ marginBottom: 10 }}>
                      <Select showSearch optionFilterProp="label" options={payTermOpts} disabled={editMode} /></Form.Item>
                    {editMode ? (
                      // Salesperson comes from the order's sales credits (read-only here);
                      // the pencil opens the Add/Edit Sales Credit dialog.
                      <Form.Item label="Salesperson" style={{ marginBottom: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ flex: 1, minWidth: 0, fontSize: 12 }}>
                            {salesCredits.rows.length ? salesCredits.rows.map(scName).join(', ') : <Text type="secondary">— no sales credit —</Text>}
                          </span>
                          <Tooltip title={salesCredits.rows.length ? 'Edit sales credit' : 'Add sales credit'}>
                            <Button size="small" icon={<EditOutlined />} style={{ color: REDWOOD.info }}
                              onClick={() => salesCredits.rows.length ? editSalesCredit(salesCredits.rows[0]) : addSalesCredit()} />
                          </Tooltip>
                        </div>
                      </Form.Item>
                    ) : (
                      <Form.Item label="Salesperson" name="salesRep" style={{ marginBottom: 10 }}>
                        <Select showSearch allowClear optionFilterProp="label" options={salesRepOpts} notFoundContent={salesRepOpts.length ? 'No match' : 'Loading…'} /></Form.Item>
                    )}
                  </VSection></Col>

                  {/* S3 — Warehouse */}
                  <Col xs={24} sm={12} md={5}><VSection icon={<ShoppingOutlined />} title="Warehouse" color={REDWOOD.teal}>
                    <Form.Item label={<WarehouseLabel />} name="warehouse" style={{ marginBottom: 10 }}>
                      <Select showSearch placeholder={buName ? 'Organization' : 'Select BU first'} onChange={onWh} options={whOptions} optionFilterProp="label" /></Form.Item>
                    <Form.Item label="Sub Inventory" name="subinventory" rules={inventoryTransactionFlag && isBranchSales ? [{ required: true, message: 'Subinventory required for inventory transactions' }] : undefined} style={{ marginBottom: 10 }}>
                      <Select showSearch notFoundContent="Pick a warehouse" options={subs.map(s => ({ value: s, label: s }))} /></Form.Item>
                    <div style={{ fontSize: 12, color: REDWOOD.neutral600, marginBottom: 8 }}><Tooltip title="Enable only if your Fusion instance is configured for direct inventory transactions with appropriate orchestration tasks">Inventory Transaction</Tooltip></div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                      <input type="checkbox" checked={inventoryTransactionFlag} onChange={(e) => setInventoryTransactionFlag(e.target.checked)} style={{ cursor: 'pointer' }} />
                      <span style={{ fontSize: 12, color: inventoryTransactionFlag ? REDWOOD.primary : REDWOOD.neutral600 }}>{inventoryTransactionFlag ? 'Direct inventory transaction' : 'Standard fulfillment (recommended)'}</span>
                    </div>
                    <Form.Item label="Base Currency" name="baseCurrency" style={{ marginBottom: 10 }}><Input readOnly placeholder="—" /></Form.Item>
                    <div style={{ fontSize: 12, color: REDWOOD.neutral600, marginBottom: 2 }}>Default Tax Code</div>
                    <Select size="small" showSearch allowClear style={{ width: '100%' }} value={defaultTaxCode} placeholder={taxOptions.length ? 'Apply to all lines' : 'Select a BU first'}
                      options={taxOptions} optionFilterProp="value" popupMatchSelectWidth={false} onChange={applyDefaultTax}
                      notFoundContent={taxOptions.length ? undefined : 'No tax codes'} />
                  </VSection></Col>

                  {/* S4 — Totals */}
                  <Col xs={24} sm={12} md={6}><VSection icon={<DollarOutlined />} title="Totals" color={REDWOOD.success}>
                    <Row gutter={8} style={{ marginBottom: 4 }}>
                      <Col span={14}><Form.Item label="Txn Currency" name="txnCurrency" layout="vertical" labelCol={{ span: 24 }} wrapperCol={{ span: 24 }} style={{ marginBottom: 2 }}>
                        <Select showSearch onChange={() => onTxnCurrencyChange(form)} options={CURRENCIES.map(c => ({ value: c, label: c }))} /></Form.Item></Col>
                      <Col span={10}><Form.Item label="Rate" name="rate" layout="vertical" labelCol={{ span: 24 }} wrapperCol={{ span: 24 }} style={{ marginBottom: 2 }}><InputNumber min={0} placeholder="Auto" style={{ width: '100%' }} /></Form.Item></Col>
                    </Row>
                    <Row gutter={8} style={{ marginBottom: 4 }}>
                      <Col span={14}><Form.Item label="Rate Type" name="currencyRateType" layout="vertical" labelCol={{ span: 24 }} wrapperCol={{ span: 24 }} style={{ marginBottom: 2 }}>
                        <Select options={[{ value: 'Corporate', label: 'Corporate' }, { value: 'Spot', label: 'Spot' }, { value: 'User', label: 'User' }]} /></Form.Item></Col>
                      <Col span={10}><Form.Item label="Currency Date" name="currencyDate" layout="vertical" labelCol={{ span: 24 }} wrapperCol={{ span: 24 }} style={{ marginBottom: 2 }}><DatePicker style={{ width: '100%' }} /></Form.Item></Col>
                    </Row>
                    <TotalLine label="Gross" value={fmtAmount(totAmt, ccy)} />
                    <TotalLine label="Tax (from lines)" value={fmtAmount(lineTax, ccy)} />
                    {totCharge > 0 && <TotalLine label="Charges" color={REDWOOD.primary} onClick={childOrderKey ? openOrderTotals : undefined} value={fmtAmount(totCharge, ccy)} />}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 0', borderBottom: `1px dashed ${REDWOOD.neutral200}` }}>
                      <span style={{ fontSize: 12, color: REDWOOD.neutral600 }}>Discount</span><InputNumber size="small" min={0} value={discAmt} onChange={v => setDiscAmt(Number(v) || 0)} style={{ width: 120 }} /></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 0', borderBottom: `1px dashed ${REDWOOD.neutral200}` }}>
                      <span style={{ fontSize: 12, color: REDWOOD.neutral600 }}>Expense</span><InputNumber size="small" min={0} value={expAmt} onChange={v => setExpAmt(Number(v) || 0)} style={{ width: 120 }} /></div>
                    <TotalLine label="Net (Trx Currency)" strong color={REDWOOD.primary} onClick={childOrderKey ? openOrderTotals : undefined} value={fmtAmount(totAmt + lineTax + totCharge + num(expAmt) - num(discAmt), ccy)} />
                    <TotalLine label="Net (Base Currency)" strong color={REDWOOD.success} onClick={childOrderKey ? openOrderTotals : undefined} value={fmtAmount((totAmt + lineTax + totCharge + num(expAmt) - num(discAmt)) * (num(hdr.rate) || 1), hdr.baseCurrency ?? ccy)} />
                  </VSection></Col>
                </Row>
              ),
            },
            {
              key: 'address', label: <span><ProfileOutlined style={{ marginRight: 5 }} />Customer Address</span>,
              children: (
                <OrderSection icon={<ProfileOutlined />} title="Bill-To / Ship-To" color={REDWOOD.info}>
                  <ROField label="Cust Account Id" value={hdr.custAccountId} mono span={6} />
                  <ROField label="Party Id" value={hdr.partyId} mono span={6} />
                  <ROField label="Bill To Site Use Id" value={hdr.billToSite} mono span={6} />
                  <ROField label="Ship To Party Site Id" value={hdr.shipToSite} mono span={6} />
                  <ROField label="Account Number" value={hdr.accountNumber} span={6} />
                  <ROField label="Customer" value={hdr.customerName} span={18} />
                  <ROField label="Bill To Address" value={hdr.billToAddress} span={12} />
                  <ROField label="Ship To Address" value={hdr.shipToAddress} span={12} />
                </OrderSection>
              ),
            },
            { key: 'additional', label: <span><ProfileOutlined style={{ marginRight: 5 }} />Additional Info</span>,
              children: <>
                {/* Header Extensible Flexfields (additionalInformation) — uploaded with the order */}
                <OrderSection icon={<ProfileOutlined />} title={<span>Additional Information (EFF) <Button size="small" type="text" icon={<ApiOutlined />} onClick={showEffDescribe} style={{ color: REDWOOD.info }} /></span> as any} color={REDWOOD.warning}>
                  <Col xs={24}>
                    {hdrEffCtxs.length === 0
                      ? <Text type="secondary" style={{ fontSize: 12 }}>No header extensible flexfield context was detected from Fusion. Enable/configure it in Setup, then re-open. <Button size="small" type="link" onClick={showEffDescribe}>Inspect describe</Button></Text>
                      : <>
                          {hdrEffCtxs.length > 1 && <div style={{ marginBottom: 12, maxWidth: 340 }}>
                            <div style={{ fontSize: 12, color: REDWOOD.neutral600, marginBottom: 4 }}>Context</div>
                            <Select style={{ width: '100%' }} value={hdrEffCtxSel} onChange={setHdrEffCtxSel}
                              options={hdrEffCtxs.map(c => ({ value: c.voName, label: c.contextCode || c.voName }))} />
                          </div>}
                          <Row gutter={12}>
                            {hdrEffActive?.segs.map(s => (
                              <Col xs={24} md={8} key={s.name}>
                                <div style={{ fontSize: 12, color: REDWOOD.neutral600, marginBottom: 4 }}>{s.label}</div>
                                <Input value={hdrEffVals[s.name] ?? ''} onChange={e => setHdrEffVals(v => ({ ...v, [s.name]: e.target.value }))} placeholder={s.name} style={{ marginBottom: 12 }} />
                              </Col>
                            ))}
                          </Row>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                            {editMode && <Button type="primary" icon={<SaveOutlined />} loading={hdrEffSaving} onClick={saveHeaderEff}
                              style={{ background: REDWOOD.warning, borderColor: REDWOOD.warning }}>
                              {hdrEffVoHref ? 'Update Additional Info' : 'Save Additional Info'}
                            </Button>}
                            <Text type="secondary" style={{ fontSize: 11 }}>
                              {editMode ? 'Saved directly to the order' : 'Uploaded with the order on create'} as <code>additionalInformation</code> · context <b>{hdrEffActive?.contextCode || hdrEffActive?.voName}</b> ({hdrEffActive?.category}).
                            </Text>
                          </div>
                        </>}
                  </Col>
                </OrderSection>
                {/* Shipping & Packing — PATCHed onto the order header */}
                <OrderSection icon={<CarOutlined />} title="Shipping & Packing Instructions" color={REDWOOD.teal}>
                  <Col xs={24} md={12}>
                    <div style={{ fontSize: 12, color: REDWOOD.neutral600, marginBottom: 4 }}>Packing Instructions</div>
                    <Input.TextArea rows={2} value={shipPack.packing} onChange={e => setShipPack(s => ({ ...s, packing: e.target.value }))} placeholder="Packing instructions" style={{ marginBottom: 12 }} />
                  </Col>
                  <Col xs={24} md={12}>
                    <div style={{ fontSize: 12, color: REDWOOD.neutral600, marginBottom: 4 }}>Shipping Instructions</div>
                    <Input.TextArea rows={2} value={shipPack.shipping} onChange={e => setShipPack(s => ({ ...s, shipping: e.target.value }))} placeholder="Shipping instructions" style={{ marginBottom: 12 }} />
                  </Col>
                  <Col xs={24} md={8}>
                    <div style={{ fontSize: 12, color: REDWOOD.neutral600, marginBottom: 4 }}>FOB Point</div>
                    <Select style={{ width: '100%', marginBottom: 12 }} allowClear placeholder="—" value={shipPack.fob} onChange={v => setShipPack(s => ({ ...s, fob: v }))}
                      options={[{ value: 'Destination', label: 'Destination' }, { value: 'Origin', label: 'Origin' }]} />
                  </Col>
                  <Col xs={24}>
                    <Button type="primary" icon={<SaveOutlined />} loading={shipPackSaving} onClick={saveShipPack} disabled={!childOrderKey}
                      style={childOrderKey ? { background: REDWOOD.teal, borderColor: REDWOOD.teal } : undefined}>Save Instructions</Button>
                    {!childOrderKey && <Text type="secondary" style={{ marginLeft: 10, fontSize: 12 }}>Save the order first to enable</Text>}
                  </Col>
                </OrderSection>
              </> },
            ...((editMode ? (editOrder?.OrderKey ?? editOrder?.HeaderId) : createdOrderKey) != null ? [{
              key: 'notesAtt', label: <span><PaperClipOutlined style={{ marginRight: 5 }} />Notes &amp; Attachments</span>,
              children: <div style={{ padding: 8 }}><NotesAttachmentsPanel orderKey={String(editMode ? (editOrder?.OrderKey ?? editOrder?.HeaderId) : createdOrderKey)} /></div>,
            }] : []),
            { key: 'credit', label: <span><ReconciliationOutlined style={{ marginRight: 5 }} />Customer Credit Check</span>,
              children: <CreditCheckPanel hdr={hdr} loading={creditCheckLoading} error={creditCheckError} data={creditCheckData} onFetch={fetchCustomerBalance} apiUrl={creditCheckApiUrl} apiResponse={creditCheckApiResponse} lines={lines} /> },
            { key: 'validations', label: <span><InfoCircleOutlined style={{ marginRight: 5 }} />Order Validations</span>,
              children: <div style={{ padding: 8 }}><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Order validations — item, warehouse and customer checks will appear here before submission." style={{ padding: 24 }} /></div> },
          ]} />
        </Form>
      </Card>

      <Card size="small" styles={{ body: { padding: 0 } }} style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}` }}
        title={<Space><UnorderedListOutlined style={{ color: REDWOOD.primary }} /><Text strong>Lines</Text>{lines.length > 0 && <Tag>{lines.length}</Tag>}
          {effMeta
            ? <Tooltip title={`Line EFF context "${effMeta.contextCode}" — lot → ${effMeta.lotSeg ?? '(none)'}, cost → ${effMeta.costSeg ?? '(none)'}`}>
                <Tag color="purple" style={{ fontSize: 10 }}>EFF: lot {effMeta.lotSeg ? '✓' : '—'} · cost {effMeta.costSeg ? '✓' : '—'}</Tag>
              </Tooltip>
            : <Tooltip title="No line extensible flexfield context with lot/cost segments was auto-detected, so lot number and item cost are kept in the grid only (not sent to Fusion). Lot/serial on a standard sales order is assigned at pick/ship confirm. Send me your EFF context code + segment API names to save them.">
                <Tag color="default" style={{ fontSize: 10 }}>EFF: not detected</Tag>
              </Tooltip>}</Space>}
        extra={<Space size={6} wrap>
          <Button size="small" icon={<PlusOutlined />} onClick={addBlankLine}>New Line</Button>
          <Button size="small" icon={<DatabaseOutlined />} loading={ohLoading} onClick={checkAllOnhand} style={{ color: REDWOOD.info, borderColor: REDWOOD.info }}>Check On-Hand</Button>
          <Button size="small" icon={<ReloadOutlined />} loading={statusLoading} disabled={!createdOrderKey} onClick={() => refreshLineStatuses()} style={createdOrderKey ? { color: REDWOOD.success, borderColor: REDWOOD.success } : undefined}>Refresh Status</Button>
          {!!childOrderKey && lines.some(l => l.existing) && <Button size="small" icon={<DollarOutlined />} onClick={() => setChargesOpen(true)} style={{ color: REDWOOD.primary, borderColor: REDWOOD.primary }}>Charges</Button>}
          <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => setPickOpen(true)} style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}>Add Multiple Lines</Button>
        </Space>}>
        <style>{`
          .so-lines-vtabs .ant-tabs-nav { padding: 6px 4px; background: ${REDWOOD.neutral100}; border-right: 1px solid ${REDWOOD.neutral200}; }
          .so-lines-vtabs .ant-tabs-tab { padding: 0 !important; margin: 3px 0 !important; border-radius: 10px; justify-content: center; transition: background .15s; }
          .so-lines-vtabs .ant-tabs-tab:hover { background: #fff; }
          .so-lines-vtabs .ant-tabs-tab-active { background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
          .so-lines-vtabs .ant-tabs-ink-bar { width: 3px; border-radius: 3px; }
          .so-lines-vtabs .ant-tabs-content-holder { padding-left: 4px; }
        `}</style>
        {<Tabs size="small" tabPosition="left" className="so-lines-vtabs" tabBarStyle={{ minWidth: 60, marginBottom: 0 }} items={[
              {
                key: 'lines', label: vTab(<UnorderedListOutlined />, 'Lines', REDWOOD.primary, lines.length),
                children: <Table size="small" columns={cols} dataSource={lines} rowKey="key" pagination={false} scroll={{ x: 1990, y: 360 }}
                  locale={{ emptyText: 'No lines — use “Add Multiple Lines” or “New Line”' }}
                  summary={() => lines.length === 0 ? null : (() => {
                    const totMargin = lines.reduce((s, l) => s + (num(l.unitPrice) - num(l.costUnit)) * num(l.qty), 0);
                    const totCharge = lines.reduce((s, l) => s + num(l.chargeAmount), 0);
                    return (
                      <Table.Summary fixed>
                        <Table.Summary.Row style={{ background: REDWOOD.neutral100 }}>
                          <Table.Summary.Cell index={0} colSpan={6} align="right"><Text strong>Total</Text></Table.Summary.Cell>
                          <Table.Summary.Cell index={6} align="right"><Text strong>{fmtQty(totQty)}</Text></Table.Summary.Cell>
                          <Table.Summary.Cell index={7} />
                          <Table.Summary.Cell index={8} align="right"><Text strong style={{ color: REDWOOD.primary }}>{fmtAmount(totAmt, ccy)}</Text></Table.Summary.Cell>
                          <Table.Summary.Cell index={9} align="right"><Text strong style={{ color: totMargin < 0 ? REDWOOD.error : REDWOOD.success }}>{fmtAmount(totMargin, ccy)}</Text></Table.Summary.Cell>
                          <Table.Summary.Cell index={10} />
                          <Table.Summary.Cell index={11} align="right"><Text strong>{fmtAmount(lineTax, ccy)}</Text></Table.Summary.Cell>
                          <Table.Summary.Cell index={12} align="right"><Text strong style={{ color: REDWOOD.primary }}>{fmtAmount(totCharge, ccy)}</Text></Table.Summary.Cell>
                          <Table.Summary.Cell index={13} align="right"><Text strong style={{ color: REDWOOD.success }}>{fmtAmount(totAmt + lineTax + totCharge, ccy)}</Text></Table.Summary.Cell>
                          <Table.Summary.Cell index={14} />
                          <Table.Summary.Cell index={15} />
                        </Table.Summary.Row>
                      </Table.Summary>
                    );
                  })() } />,
              },
              {
                key: 'margin', label: vTab(<RiseOutlined />, 'Margin', REDWOOD.success),
                children: <Table size="small" columns={marginCols} dataSource={lines} rowKey="key" pagination={false} scroll={{ x: 900, y: 360 }}
                  summary={() => {
                    const totMargin = lines.reduce((s, l) => s + (num(l.unitPrice) - num(l.costUnit)) * num(l.qty), 0);
                    const pct = totAmt ? (totMargin / totAmt) * 100 : 0;
                    return (
                      <Table.Summary fixed>
                        <Table.Summary.Row style={{ background: REDWOOD.neutral100 }}>
                          <Table.Summary.Cell index={0} colSpan={5} align="right"><Text strong>Total Margin</Text></Table.Summary.Cell>
                          <Table.Summary.Cell index={5} align="right"><Text strong style={{ color: totMargin < 0 ? REDWOOD.error : REDWOOD.success }}>{fmtAmount(totMargin, ccy)}</Text></Table.Summary.Cell>
                          <Table.Summary.Cell index={6} align="right"><Text strong style={{ color: pct < 0 ? REDWOOD.error : REDWOOD.success }}>{totAmt ? pct.toFixed(1) + '%' : '—'}</Text></Table.Summary.Cell>
                        </Table.Summary.Row>
                      </Table.Summary>
                    );
                  }} />,
              },
              {
                key: 'lots', label: vTab(<TagsOutlined />, 'Lot Details', REDWOOD.info, lotRows.length),
                children: <div>
                  {inventoryTransactionFlag && (
                    <div style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', background: REDWOOD.neutral100, borderBottom: `1px solid ${REDWOOD.neutral200}`, marginBottom: 12 }}>
                      <Text type="secondary" style={{ fontSize: 11 }}>📦 Direct Inventory Transaction — Select lots & serials:</Text>
                      {lines.length > 0 && (
                        <Button size="small" type="primary" icon={<TagsOutlined />} onClick={() => {
                          const firstLine = lines[0];
                          setAllocationLine(firstLine);
                          setAllocationModalOpen(true);
                        }} style={{ background: REDWOOD.info, borderColor: REDWOOD.info, marginLeft: 'auto' }}>
                          Allocate Lots/Serials
                        </Button>
                      )}
                    </div>
                  )}
                  <Table size="small" columns={lotCols} dataSource={lotRows} rowKey="key" pagination={false} scroll={{ x: 750, y: 360 }}
                    locale={{ emptyText: 'No lot details on the selected items' }} />
                </div>,
              },
              {
                key: 'fulfillment', label: vTab(<CarOutlined />, 'Fulfillment', REDWOOD.teal ?? '#00918A'),
                children: <Table size="small" columns={fulfillCols} dataSource={lines} rowKey="key" pagination={false} scroll={{ x: 780, y: 360 }}
                  locale={{ emptyText: 'No lines' }} />,
              },
              {
                key: 'lineAddl', label: vTab(<ProfileOutlined />, 'Additional Info', REDWOOD.warning),
                children: !lineEffActive
                  ? <div style={{ padding: 12 }}><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No line EFF context detected." /></div>
                  : <div>
                      <div style={{ padding: '6px 8px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 11.5, color: REDWOOD.neutral600 }}>
                          Context <b>{lineEffActive.contextCode || lineEffActive.voName}</b> ({lineEffActive.category}). Uploaded with each line on create; use Save to update saved lines.
                        </span>
                        <Button size="small" type="primary" icon={<SaveOutlined />} loading={lineEffSaving === '__all__'}
                          disabled={!lines.some(l => l.lineHref)} onClick={saveAllLineEff}
                          style={{ marginLeft: 'auto', background: REDWOOD.warning, borderColor: REDWOOD.warning }}>Save Additional Info</Button>
                      </div>
                      <Table size="small" dataSource={lines} rowKey="key" pagination={false} scroll={{ x: 760, y: 340 }}
                        locale={{ emptyText: 'No lines' }}
                        columns={[
                          { title: 'Item', dataIndex: 'itemNumber', width: 150, fixed: 'left', render: (v: string) => <Text strong style={{ fontSize: 12 }}>{v || '—'}</Text> },
                          ...lineEffActive.segs.map(s => ({
                            title: s.label, dataIndex: ['effVals', s.name], width: 150,
                            render: (_: any, l: NewLine) => {
                              const auto = s.name === effMeta?.lotSeg ? l.lot : s.name === effMeta?.costSeg ? (l.costUnit != null ? String(l.costUnit) : '') : /lot.?qty|qty/i.test(s.name) ? (l.qty != null ? String(l.qty) : '') : '';
                              return <Input size="small" value={l.effVals?.[s.name] ?? ''} placeholder={auto ? `auto: ${auto}` : s.name}
                                onChange={e => upd(l.key, { effVals: { ...l.effVals, [s.name]: e.target.value } })} />;
                            },
                          })),
                        ]} />
                    </div>,
              },
              {
                key: 'errors', label: vTab(<CloseCircleTwoTone twoToneColor={errorRows.length ? REDWOOD.error : '#bbb'} />, 'Errors', REDWOOD.error, errorRows.length, REDWOOD.error),
                children: <Table size="small" rowKey="key" pagination={false} scroll={{ x: 700, y: 360 }}
                  dataSource={errorRows}
                  locale={{ emptyText: 'No errors from the last save' }}
                  columns={[
                    { title: 'Where', dataIndex: 'scope', width: 110, render: (v: string) => <Tag color={v === 'Order' ? 'volcano' : 'red'} style={{ fontSize: 11 }}>{v}</Tag> },
                    { title: 'Item', dataIndex: 'item', width: 150, render: (v: string) => v ? <Text style={{ fontSize: 12 }}>{v}</Text> : <Text type="secondary">—</Text> },
                    { title: 'Error', dataIndex: 'msg', render: (v: string) => <Text style={{ fontSize: 12, color: REDWOOD.error }}>{v}</Text> },
                  ]} />,
              },
              ...(editMode ? [{
                key: 'sysids', label: vTab(<DatabaseOutlined />, 'System IDs', REDWOOD.purple ?? '#6B21A8'),
                children: <>
                  <div style={{ padding: '6px 8px', fontSize: 12 }}>
                    <Text type="secondary">Order Key </Text><Text code>{editOrder?.OrderKey ?? '—'}</Text>
                    <Text type="secondary"> · Header Id </Text><Text code>{editOrder?.HeaderId ?? '—'}</Text>
                    <Text type="secondary"> · Order # </Text><Text code>{editOrder?.OrderNumber ?? '—'}</Text>
                  </div>
                  <Table size="small" rowKey="key" pagination={false} scroll={{ x: 900, y: 320 }} dataSource={sysIdRows}
                    columns={[
                      { title: 'Line', dataIndex: 'lineNo', width: 60, align: 'center' as const },
                      { title: 'Item', dataIndex: 'item', width: 150, render: (v: string) => <Text strong style={{ fontSize: 12, color: REDWOOD.info }}>{v || '—'}</Text> },
                      { title: 'Action', dataIndex: 'state', width: 100, render: (v: string) => <Tag color={v === 'New' ? 'green' : v === 'Cancel' ? 'red' : v === 'Update' ? 'blue' : 'default'} style={{ fontSize: 11 }}>{v}</Tag> },
                      { title: 'FulfillLineId', dataIndex: 'fulfillLineId', width: 170, render: (v: any) => v != null ? <Text code style={{ fontSize: 11 }}>{v}</Text> : <Text type="secondary">— new —</Text> },
                      { title: 'Source Line Id', dataIndex: 'srcLineId', width: 140, render: (v: any) => v != null ? <Text style={{ fontSize: 11, fontFamily: 'monospace' }}>{v}</Text> : <Text type="secondary">—</Text> },
                      { title: 'linesUniqID (PATCH key)', dataIndex: 'linesUniqID', ellipsis: true, render: (v: any) => v ? <Text style={{ fontSize: 11, fontFamily: 'monospace' }}>{v}</Text> : <Text type="secondary">—</Text> },
                    ]} />
                </>,
              }] : []),
              // Edit mode: Actual Costing + Billing tabs from the live Fusion lines.
              ...(editMode && rawLines.length ? [{
                key: 'actualCosting', label: vTab(<DollarOutlined />, 'Actual Costing', '#D4A800'),
                children: <ActualCostingTab lines={rawLines} currency={ccy} />,
              }] : []),
              ...(editMode && rawLines.length && billingChildName ? [{
                key: 'billing', label: vTab(<ProfileOutlined />, 'Billing', REDWOOD.teal ?? '#00918A'),
                children: <MergedLineChildTab lines={rawLines} name={billingChildName} overrides={[{
                  match: ['billingtransactionnumber', 'billingtrxnumber', 'billingtransactionnum'],
                  render: (v: any) => v
                    ? <Tooltip title="Open AR invoice"><Button type="link" style={{ padding: 0, fontWeight: 700, color: REDWOOD.info, fontSize: 12 }} onClick={() => setArTxn(String(v))}>{v}</Button></Tooltip>
                    : '—'
                }]} />,
              }] : []),
              // Edit mode: Sales Credits + Notes & Attachments (order-level children).
              ...(editMode && (editOrder?.OrderKey ?? editOrder?.HeaderId) != null ? [{
                key: 'salesCredits', label: vTab(<ReconciliationOutlined />, 'Sales Credits', '#0572CE'),
                children: <SalesCreditsPanel rows={salesCredits.rows} loading={salesCredits.loading} onReload={salesCredits.reload} onAdd={addSalesCredit} onEdit={editSalesCredit} onDelete={deleteSalesCredit} />,
              }] : []),
            ]} />}
      </Card>

      <ItemSearchModal open={pickOpen} org={hdr.warehouse} subinv={hdr.subinventory} ccy={ccy} taxOptions={taxOptions} onClose={() => setPickOpen(false)} onAdd={addItems} />

      {/* Update Line dialog (edit mode) — full reprice PATCH of the line */}
      <Modal open={!!updTarget} onCancel={() => !updBusy && setUpdTarget(null)} width={560}
        title={<Space><EditOutlined style={{ color: REDWOOD.info }} /> Update / Reprice Line</Space>}
        footer={<Space>
          <Button disabled={updBusy} onClick={() => setUpdTarget(null)}>Cancel</Button>
          <Button type="primary" loading={updBusy} icon={<SaveOutlined />} onClick={doUpdateLine}
            style={{ background: REDWOOD.info, borderColor: REDWOOD.info }}>Update (PATCH)</Button>
        </Space>}>
        {updTarget && (() => {
          const cost = num(updTarget.costUnit);
          const lineTotal = num(updQty) * num(updPrice);
          const margin = (num(updPrice) - cost) * num(updQty);
          const marginPct = lineTotal ? (margin / lineTotal) * 100 : 0;
          const lotOpts = Array.from(new Set(updLots.map(o => o.lot).filter(Boolean))).map(lot => {
            const q = updLots.filter(o => o.lot === lot).reduce((s, o) => s + (o.qty || 0), 0);
            return { value: lot as string, label: q ? `${lot} — ${fmtQty(q)}` : (lot as string) };
          });
          return (
          <div style={{ fontSize: 13 }}>
            <Row gutter={[10, 10]}>
              <Col span={12}><Text type="secondary" style={{ fontSize: 11 }}>Item</Text><div><Text strong style={{ color: REDWOOD.info }}>{updTarget.itemNumber}</Text></div></Col>
              <Col span={12}><Text type="secondary" style={{ fontSize: 11 }}>Status</Text><div>{updTarget.status || updTarget.statusCode ? statusTag(updTarget.status, updTarget.statusCode) : '—'}</div></Col>
              <Col span={8}><Text type="secondary" style={{ fontSize: 11 }}>Current Qty</Text><div><Text>{fmtQty(num(updTarget.origQty ?? updTarget.qty))}</Text></div></Col>
              <Col span={8}>
                <Text type="secondary" style={{ fontSize: 11 }}>New Qty</Text>
                <InputNumber min={0} value={updQty} onChange={v => setUpdQty(Number(v) || 0)} style={{ width: '100%' }} />
              </Col>
              <Col span={8}>
                <Text type="secondary" style={{ fontSize: 11 }}>Unit Price</Text>
                <InputNumber min={0} value={updPrice} onChange={v => setUpdPrice(Number(v) || 0)} style={{ width: '100%' }} />
              </Col>
              <Col span={12}>
                <Text type="secondary" style={{ fontSize: 11 }}>Tax Code</Text>
                <Select size="middle" showSearch allowClear style={{ width: '100%' }} popupMatchSelectWidth={false}
                  value={updTaxCode || undefined} placeholder="—" options={taxOptions} optionFilterProp="value"
                  onChange={val => { const opt = taxOptions.find(o => o.value === val); setUpdTaxCode(val); setUpdTaxPct(opt ? opt.pct : undefined); }} />
              </Col>
              <Col span={12}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Text type="secondary" style={{ fontSize: 11 }}>Lot</Text>
                  <Tooltip title="Inspect the on-hand / lot web service URL">
                    <Button size="small" type="text" icon={<ApiOutlined />} disabled={!lotApi.url}
                      style={{ color: REDWOOD.info, height: 16, padding: 0 }}
                      onClick={() => setLotApi(s => ({ ...s, open: true }))} />
                  </Tooltip>
                  {lotOpts.length === 0 && <Text type="secondary" style={{ fontSize: 10, color: REDWOOD.warning }}>no lots on hand</Text>}
                </div>
                <Select size="middle" showSearch allowClear style={{ width: '100%' }} popupMatchSelectWidth={false}
                  value={updLot || undefined} placeholder={lotOpts.length ? 'Select lot' : 'no lots on hand'}
                  options={lotOpts} onChange={v => setUpdLot(v || undefined)} />
              </Col>
            </Row>
            {/* Flag when the amount stored in Fusion is inconsistent with qty×price. */}
            {updTarget.loadedExt != null && round2(updTarget.loadedExt) !== round2(num(updTarget.origQty ?? updTarget.qty) * num(updTarget.origUnitPrice ?? updTarget.unitPrice)) && (
              <div style={{ marginTop: 10, padding: '6px 10px', background: '#FFF1F0', border: `1px solid ${REDWOOD.error}`, borderRadius: 6, fontSize: 12 }}>
                <WarningFilled style={{ color: REDWOOD.error, marginRight: 6 }} />
                Stored amount <Text strong>{fmtAmount(updTarget.loadedExt, ccy)}</Text> ≠ Qty×Price <Text strong>{fmtAmount(round2(num(updTarget.origQty ?? updTarget.qty) * num(updTarget.origUnitPrice ?? updTarget.unitPrice)), ccy)}</Text>. Saving reprices the charge to <Text strong>{fmtAmount(round2(num(updQty) * num(updPrice)), ccy)}</Text>.
              </div>
            )}
            {/* Reprice summary — cost, tax, total, margin */}
            <div style={{ marginTop: 12, padding: 10, background: REDWOOD.neutral100, borderRadius: 6 }}>
              <Row gutter={[10, 6]}>
                <Col span={8}><Text type="secondary" style={{ fontSize: 11 }}>Cost</Text><div>{cost ? fmtAmount(cost, ccy) : <Text type="secondary">—</Text>}</div></Col>
                <Col span={8}><Text type="secondary" style={{ fontSize: 11 }}>Tax{updTaxPct != null ? ` (${updTaxPct}%)` : ''}</Text><div>{fmtAmount(round2(updTax), ccy)}</div></Col>
                <Col span={8}><Text type="secondary" style={{ fontSize: 11 }}>Line Total</Text><div><Text strong style={{ color: REDWOOD.primary }}>{fmtAmount(lineTotal, ccy)}</Text></div></Col>
                <Col span={8}><Text type="secondary" style={{ fontSize: 11 }}>Margin</Text><div><Text strong style={{ color: margin < 0 ? REDWOOD.error : REDWOOD.success }}>{fmtAmount(margin, ccy)}</Text></div></Col>
                <Col span={8}><Text type="secondary" style={{ fontSize: 11 }}>Margin %</Text><div><Text style={{ color: marginPct < 0 ? REDWOOD.error : REDWOOD.success }}>{lineTotal ? marginPct.toFixed(1) + '%' : '—'}</Text></div></Col>
                <Col span={8}><Text type="secondary" style={{ fontSize: 11 }}>Net</Text><div><Text strong style={{ color: REDWOOD.success }}>{fmtAmount(lineTotal + round2(updTax), ccy)}</Text></div></Col>
              </Row>
            </div>
            <div style={{ marginTop: 10, fontSize: 11, color: REDWOOD.neutral600 }}>
              {(round2(num(updPrice)) !== round2(num(updTarget.unitPrice)) || round2(num(updQty)) !== round2(num(updTarget.qty)) || round2(num(updTaxPct)) !== round2(num(updTarget.taxPct)))
                ? <>Frozen price → PATCHes <Text code style={{ fontSize: 11 }}>lines/{'{id}'}</Text> {'{ OrderedQuantity }'}, then reprices <Text code style={{ fontSize: 11 }}>charges/{'{id}'}</Text> and its <Text code style={{ fontSize: 11 }}>chargeComponents</Text> (QP_LIST_PRICE / QP_NET_PRICE / QP_EXCLUSIVE_TAX / QP_NET_PRICE_PLUS_TAX) with unit&nbsp;{fmtAmount(round2(num(updPrice)), ccy)} · ext&nbsp;{fmtAmount(round2(num(updQty) * num(updPrice)), ccy)}.</>
                : <>Sends <Text code style={{ fontSize: 11 }}>PATCH …/child/lines/{'{linesUniqID}'}</Text> with <Text code style={{ fontSize: 11 }}>{'{ OrderedQuantity }'}</Text>.</>}
            </div>
          </div>
          );
        })()}
      </Modal>

      {/* On-hand / lot API inspector — shows the exact inventoryOnhandBalances URL */}
      <Modal title={<Space><ApiOutlined style={{ color: REDWOOD.info }} /> Lot / On-hand API</Space>}
        open={lotApi.open} onCancel={() => setLotApi(s => ({ ...s, open: false }))} maskClosable={false} width={860}
        footer={<Button onClick={() => setLotApi(s => ({ ...s, open: false }))}>Close</Button>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Text style={{ fontSize: 11, fontWeight: 700, color: REDWOOD.neutral600, textTransform: 'uppercase' }}>On-hand lots (inventoryOnhandBalances)</Text>
              <Button size="small" type="primary" icon={<ThunderboltOutlined />} style={{ marginLeft: 'auto', background: REDWOOD.success, borderColor: REDWOOD.success }}
                loading={lotApi.running} onClick={runLotApi}>Run</Button>
              <Button size="small" type="text" icon={<CopyOutlined />}
                onClick={() => { navigator.clipboard.writeText(lotApi.url); message.success('Copied'); }}>Copy</Button>
            </div>
            <div style={{ marginTop: 4, padding: '8px 12px', borderRadius: 6, background: REDWOOD.neutral100, border: `1px solid ${REDWOOD.neutral200}`, fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all', color: REDWOOD.info }}>
              <Tag color="blue">GET</Tag>{lotApi.url ? decodeURIComponent(lotApi.url) : '(no warehouse/item — open from a line with an item and header warehouse)'}
            </div>
          </div>
          {(lotApi.status || lotApi.running) && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <Text style={{ fontSize: 11, fontWeight: 700, color: REDWOOD.neutral600, textTransform: 'uppercase' }}>Response</Text>
                {lotApi.status && <Tag color={lotApi.ok ? 'green' : 'red'}>{lotApi.status}</Tag>}
              </div>
              <div style={{ padding: '8px 12px', borderRadius: 6, background: '#1e1e1e', color: '#d4d4d4', fontFamily: 'monospace', fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 260, overflow: 'auto' }}>
                {lotApi.running ? 'Running…' : (lotApi.body || '(empty response)')}
              </div>
            </div>
          )}
          <Text type="secondary" style={{ fontSize: 11 }}>
            Instance: <b>{getFusionInstance().label}</b> ({getFusionInstance().host.replace(/^https?:\/\//, '')}) · Auth: Basic [{getFusionInstance().username}] · Warehouse (OrganizationCode) &amp; Item drive the query; empty results = no on-hand for that org/subinventory.
          </Text>
        </div>
      </Modal>

      {/* Line-Total drill → the line's charges + price components, straight from Fusion */}
      {/* Add / Edit Sales Credit — shared by the header pencil and the Sales Credits tab */}
      {childOrderKey && <SalesCreditEditModal editing={scEdit} orderKey={childOrderKey} salesRepOpts={salesRepOpts}
        onClose={() => setScEdit(null)} onSaved={() => { setScEdit(null); salesCredits.reload(); }} />}

      {/* Manual charges — add freight/handling/… to a line's charges child */}
      {childOrderKey && <ChargesModal open={chargesOpen} onClose={() => setChargesOpen(false)} orderKey={childOrderKey} lines={lines} ccy={ccy} onChanged={refreshLineCharges} />}

      {/* Order totals — GET {OrderKey}/child/totals */}
      <Modal open={totals.open} onCancel={() => setTotals(t => ({ ...t, open: false }))} width={620}
        title={<Space><DollarOutlined style={{ color: REDWOOD.success }} />Order Totals</Space>}
        footer={<Space><Button icon={<ReloadOutlined />} loading={totals.loading} onClick={openOrderTotals}>Refresh</Button><Button onClick={() => setTotals(t => ({ ...t, open: false }))}>Close</Button></Space>}>
        <div style={{ fontSize: 11, fontFamily: 'monospace', color: REDWOOD.neutral600, wordBreak: 'break-all', marginBottom: 10 }}><b>GET</b> {totals.url}</div>
        {totals.loading ? <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>
          : totals.error ? <div style={{ color: REDWOOD.error, fontSize: 12 }}>{totals.error}</div>
          : <Table size="small" rowKey={(_, i) => String(i)} pagination={false} dataSource={totals.rows}
              locale={{ emptyText: 'No totals returned' }}
              columns={[
                { title: 'Total', render: (_: any, r: any) => <Text strong style={{ fontSize: 12 }}>{pf(r, ['TotalName', 'TotalCode', 'TotalTypeCode', 'Total']) ?? '—'}</Text> },
                { title: 'Code', width: 150, render: (_: any, r: any) => <Text type="secondary" style={{ fontSize: 11 }}>{pf(r, ['TotalCode', 'TotalTypeCode']) ?? '—'}</Text> },
                { title: 'Amount', width: 150, align: 'right', render: (_: any, r: any) => <Text strong style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtAmount(num(pf(r, ['TotalAmount', 'Amount', 'Value'])), pf(r, ['CurrencyCode', 'Currency']) ?? ccy)}</Text> },
              ] as any} />}
      </Modal>

      <Modal open={!!chargeDrill} onCancel={() => setChargeDrill(null)} width={760} style={{ top: 24 }}
        title={<Space><DollarOutlined style={{ color: REDWOOD.primary }} /> Charges — {chargeDrill?.line.itemNumber}</Space>}
        footer={<Button onClick={() => setChargeDrill(null)}>Close</Button>}>
        {chargeDrill && (
          <div>
            <div style={{ fontSize: 11, fontFamily: 'monospace', color: REDWOOD.neutral600, wordBreak: 'break-all', marginBottom: 10 }}>
              <b>GET</b> {chargeDrill.url}
            </div>
            {chargeDrill.loading ? <div style={{ textAlign: 'center', padding: 30 }}><Spin /></div>
              : chargeDrill.error ? <div style={{ color: REDWOOD.error, fontSize: 12 }}>{chargeDrill.error}</div>
              : chargeDrill.charges.length === 0 ? <Empty description="No charges on this line" />
              : chargeDrill.charges.map((c: any, ci: number) => {
                  const comps = c.chargeComponents?.items ?? c.chargeComponents ?? [];
                  return (
                    <div key={ci} style={{ marginBottom: 14, border: `1px solid ${REDWOOD.neutral200}`, borderRadius: 8, overflow: 'hidden' }}>
                      <div style={{ background: REDWOOD.neutral100, padding: '6px 10px', fontSize: 12 }}>
                        <Space size={12} wrap>
                          <Text strong>{pf(c, ['ChargeDefinitionCode', 'ChargeName']) ?? 'Charge'}</Text>
                          {String(c.PrimaryFlag) === 'true' && <Tag color="blue" style={{ margin: 0 }}>Primary</Tag>}
                          <Text type="secondary" style={{ fontSize: 11 }}>Unit {fmtAmount(num(pf(c, ['ChargeCurrencyUnitPrice', 'GSAUnitPrice', 'HeaderCurrencyUnitPrice'])), ccy)}</Text>
                          <Text type="secondary" style={{ fontSize: 11 }}>Ext {fmtAmount(num(pf(c, ['ChargeCurrencyExtendedAmount', 'HeaderCurrencyExtendedAmount'])), ccy)}</Text>
                          <Text type="secondary" style={{ fontSize: 11 }}>Priced Qty {fmtQty(num(pf(c, ['PricedQuantity'])))}</Text>
                        </Space>
                      </div>
                      <Table size="small" rowKey={(_, i) => String(i)} pagination={false}
                        dataSource={comps} columns={[
                          { title: 'Price Element', dataIndex: 'PriceElementCode', width: 200, render: (v: any) => <Text style={{ fontSize: 11.5 }}>{v}</Text> },
                          { title: 'Unit Price', width: 130, align: 'right', render: (_: any, cc: any) => <Text style={{ fontSize: 11.5, fontVariantNumeric: 'tabular-nums' }}>{fmtAmount(num(pf(cc, ['HeaderCurrencyUnitPrice', 'ChargeCurrencyUnitPrice'])), ccy)}</Text> },
                          { title: 'Extended', width: 130, align: 'right', render: (_: any, cc: any) => <Text strong style={{ fontSize: 11.5, fontVariantNumeric: 'tabular-nums' }}>{fmtAmount(num(pf(cc, ['HeaderCurrencyExtendedAmount', 'ChargeCurrencyExtendedAmount'])), ccy)}</Text> },
                        ] as any} />
                    </div>
                  );
                })}
          </div>
        )}
      </Modal>

      {/* Allocation Modal — lot/serial selection for InventoryTransactionFlag */}
      <AllocationModalComponent />

      {/* Line error detail (opened from the red ✗ in the Status column) */}
      <Modal open={!!errModal} onCancel={() => setErrModal(null)} width={640}
        title={<Space><CloseCircleTwoTone twoToneColor={REDWOOD.error} /> Error — {errModal?.title}</Space>}
        footer={<Button onClick={() => setErrModal(null)}>Close</Button>}>
        <div style={{ fontSize: 12, color: REDWOOD.error, whiteSpace: 'pre-wrap', background: '#FFF1F0', border: '1px solid #FFCCC7', borderRadius: 6, padding: '10px 12px', maxHeight: 360, overflow: 'auto' }}>
          {errModal?.msg}
        </div>
      </Modal>

      {/* Full response of the last save/update (opened from "Show Response") */}
      <Modal open={respOpen} onCancel={() => setRespOpen(false)} width={760}
        title={<Space><CopyOutlined style={{ color: REDWOOD.info }} /> Response</Space>}
        footer={<Space>
          <Button size="small" type="text" icon={<CopyOutlined />} onClick={() => { navigator.clipboard.writeText(lastResponse); message.success('Copied'); }}>Copy</Button>
          <Button onClick={() => setRespOpen(false)}>Close</Button>
        </Space>}>
        <pre style={{ margin: 0, fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 460, overflow: 'auto', background: REDWOOD.neutral100, border: `1px solid ${REDWOOD.neutral200}`, borderRadius: 6, padding: 12 }}>{lastResponse || '—'}</pre>
      </Modal>

      {/* ── Save result dialog — celebration on success, error state on failure ── */}
      <Modal
        open={successOpen}
        title={null}
        closable={!!saveError}
        centered
        width={480}
        onCancel={() => { setSuccessOpen(false); setConfetti([]); }}
        footer={
          saveError
            ? <Space style={{ justifyContent: 'center', width: '100%' }} wrap>
                <Button size="large" icon={<DownloadOutlined />} onClick={saveDraftJson}>Save Order to JSON</Button>
                <Button size="large" icon={<CopyOutlined />} disabled={!lastResponse} onClick={() => setRespOpen(true)}>Show Response</Button>
                <Button danger type="primary" size="large" onClick={() => setSuccessOpen(false)}>Close</Button>
              </Space>
            : <Space style={{ justifyContent: 'center', width: '100%' }} wrap>
                <Button size="large" icon={<ReloadOutlined />} loading={statusLoading} onClick={() => refreshLineStatuses()}>
                  Refresh Line Status
                </Button>
                <Button size="large" icon={<CopyOutlined />} disabled={!lastResponse} onClick={() => setRespOpen(true)}>Show Response</Button>
                <Button type="primary" size="large" icon={<CheckCircleOutlined />}
                  style={{ background: REDWOOD.success, borderColor: REDWOOD.success, fontWeight: 700 }}
                  onClick={() => { setSuccessOpen(false); setConfetti([]); }}>
                  Done
                </Button>
              </Space>
        }
      >
        <style>{`
          @keyframes so-confetti-fall { 0% { transform: translateY(-20px) rotate(0deg); opacity: 1; } 100% { transform: translateY(110vh) rotate(720deg); opacity: 0; } }
          @keyframes so-success-pop { 0% { transform: scale(0.4); opacity: 0; } 60% { transform: scale(1.12); } 100% { transform: scale(1); opacity: 1; } }
        `}</style>
        {!saveError && confetti.map(p => (
          <div key={p.id} style={{
            position: 'fixed', top: 0, left: `${p.x}%`, width: p.size, height: p.size * 0.6,
            background: p.color, borderRadius: 2, pointerEvents: 'none', zIndex: 99999,
            animation: `so-confetti-fall ${1.8 + (p.id % 5) * 0.24}s ease-in forwards`, animationDelay: `${p.delay}s`,
          }} />
        ))}
        {saveError
          ? (
            <div style={{ textAlign: 'center', padding: '28px 16px 8px' }}>
              <CloseCircleTwoTone twoToneColor={REDWOOD.error} style={{ fontSize: 52, marginBottom: 12 }} />
              <div style={{ fontSize: 16, fontWeight: 700, color: REDWOOD.neutral900, marginBottom: 4 }}>Sales Order creation failed</div>
              <Tag color="error" style={{ fontWeight: 700, marginBottom: 12 }}>ERROR</Tag>
              <div style={{ fontSize: 12, color: REDWOOD.error, whiteSpace: 'pre-wrap', textAlign: 'left', background: '#FFF1F0', border: '1px solid #FFCCC7', borderRadius: 6, padding: '10px 12px', maxHeight: 260, overflow: 'auto' }}>
                {saveError}
              </div>
              <div style={{ fontSize: 11, color: REDWOOD.neutral600, marginTop: 10 }}>
                The full response &amp; payload were saved to <Text code style={{ fontSize: 11 }}>{ORDER_LOG_FOLDER}</Text>.
              </div>
            </div>
          )
          : (
            <div style={{ textAlign: 'center', padding: '32px 16px 16px', animation: 'so-success-pop 0.5s ease-out' }}>
              <div style={{ fontSize: 64, lineHeight: 1, marginBottom: 12 }}>🎉</div>
              <CheckCircleOutlined style={{ fontSize: 48, color: REDWOOD.success, marginBottom: 10 }} />
              <div style={{ fontSize: 15, color: REDWOOD.neutral600, marginBottom: 6 }}>
                Sales Order {editMode ? 'updated' : 'created'} successfully in Oracle Fusion
              </div>
              <div style={{ fontSize: 28, fontWeight: 800, color: REDWOOD.info, letterSpacing: '0.04em', fontFamily: 'monospace', marginBottom: 10 }}>
                {successInfo?.orderNumber}
              </div>
              {successInfo?.status && (
                <Tag color="green" style={{ fontWeight: 700, fontSize: 13, padding: '2px 14px' }}>{successInfo.status}</Tag>
              )}
              <div style={{ marginTop: 16, padding: '10px 16px', background: '#F0FFF4', borderRadius: 8, border: '1px solid #b7ebc8' }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {lines.length} line{lines.length !== 1 ? 's' : ''} &nbsp;·&nbsp; Total:&nbsp;
                </Text>
                <Text strong style={{ color: REDWOOD.teal, fontSize: 13 }}>{fmtAmount(totAmt + lineTax, ccy)}</Text>
              </div>
            </div>
          )}
      </Modal>

      <Modal open={!!itemModal} onCancel={() => setItemModal(null)} maskClosable={false} width={760} style={{ top: 24 }}
        footer={<Button onClick={() => setItemModal(null)}>Cancel</Button>}
        title={<Space><SearchOutlined style={{ color: REDWOOD.primary }} /> Select item{itemModal ? <Tag color="blue">“{itemModal.term}”</Tag> : null}<Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>{itemModal?.rows.length ?? 0} matches — filter to narrow</Text></Space>}>
        <Input allowClear autoFocus prefix={<SearchOutlined />} placeholder="Filter by code or description" value={itemFilter} onChange={e => setItemFilter(e.target.value)} style={{ marginBottom: 10 }} />
        {itemModal && (() => {
          const f = itemFilter.trim().toLowerCase();
          const rows = f ? itemModal.rows.filter(r => String(r.ItemNumber ?? '').toLowerCase().includes(f) || String(r.ItemDescription ?? '').toLowerCase().includes(f)) : itemModal.rows;
          return <Table size="small" rowKey="ItemNumber" dataSource={rows} pagination={rows.length > 10 ? { pageSize: 10, size: 'small' } : false} scroll={{ y: 340 }}
            locale={{ emptyText: 'No items match the filter' }}
            onRow={rec => ({ style: { cursor: 'pointer' }, onClick: () => { const mk = itemModal.key; setItemModal(null); pickInlineItem(mk, rec.ItemNumber, rec); } })}
            columns={[
              { title: 'Item', dataIndex: 'ItemNumber', width: 160, render: v => <Text strong style={{ color: REDWOOD.info, fontSize: 12 }}>{v}</Text> },
              { title: 'Description', dataIndex: 'ItemDescription', ellipsis: true, render: v => <Text style={{ fontSize: 12 }}>{v ?? '—'}</Text> },
              { title: 'UOM', width: 70, render: (_, r: any) => pf(r, ['PrimaryUOMValue', 'PrimaryUOMCode', 'PrimaryUnitOfMeasure', 'UOMCode']) ?? '—' },
              { title: '', width: 70, align: 'right', render: (_, r: any) => <Button size="small" type="primary" style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }} onClick={e => { e.stopPropagation(); const mk = itemModal.key; setItemModal(null); pickInlineItem(mk, r.ItemNumber, r); }}>Select</Button> },
            ]} />;
        })()}
      </Modal>

      <Modal open={!!lotPick} onCancel={() => setLotPick(null)} maskClosable={false} width={620}
        footer={<Space>
          {lotPick?.hasMore && <Button icon={<ReloadOutlined />} loading={lotPick?.loadingMore} onClick={loadMoreLots}
            style={{ color: REDWOOD.info, borderColor: REDWOOD.info }}>Load next {LOT_PAGE}</Button>}
          <Button onClick={() => setLotPick(null)}>Cancel</Button>
        </Space>}
        title={<Space><TagsOutlined style={{ color: REDWOOD.info }} /> Select a lot{lotPick ? <Tag color="blue">{lotPick.item}</Tag> : null}
          <Tooltip title="Inspect the itemCosts web service URL used to load lots">
            <Button size="small" type="text" icon={<ApiOutlined />} style={{ color: REDWOOD.info }}
              onClick={() => setLotApi({ open: true, url: lotPick ? itemCostsUrlFor(lotPick.item, lotPick.offset ?? 0) : '' })} />
          </Tooltip>
        </Space>}>
        {(() => {
          const lots = lotPick ? new Set(lotPick.rows.map(r => parseVU(r.ValuationUnit).lot).filter(Boolean)) : new Set();
          const hasLots = lots.size > 0;
          const hasOnhand = lotPick?.rows.length ?? 0 > 0;
          return hasLots
            ? <Text type="secondary" style={{ fontSize: 12 }}>This item has multiple lots — pick one to bring its cost and on-hand.</Text>
            : hasOnhand
            ? <Text type="secondary" style={{ fontSize: 12, color: REDWOOD.info }}>This item is tracked by valuation unit (no lots). On-hand quantity is shown below.</Text>
            : <Text type="secondary" style={{ fontSize: 12, color: REDWOOD.warning }}>No data returned for this item on <b>{getFusionInstance().label}</b>. Use the <ApiOutlined /> icon above to inspect and Run the itemCosts query and see what the POD returns.</Text>;
        })()}
        <Table size="small" style={{ marginTop: 10 }} pagination={false} rowKey={(_, i) => `lp-${i}`}
          dataSource={lotPick ? (() => {
            const lots = new Set(lotPick.rows.map(r => parseVU(r.ValuationUnit).lot).filter(Boolean));
            if (lots.size > 0) {
              return Array.from(lots).map(lot => {
                const row = lotPick.rows.find(r => parseVU(r.ValuationUnit).lot === lot);
                return { lot, cost: row ? num(pf(row, COST_FIELDS)) : undefined, subinv: parseVU(row?.ValuationUnit).subinv, invOrg: parseVU(row?.ValuationUnit).invOrg };
              });
            } else {
              return lotPick.rows.map((row, idx) => {
                const vu = parseVU(row.ValuationUnit);
                return { lot: `${vu.invOrg}/${vu.subinv || '—'}`, cost: num(pf(row, COST_FIELDS)), subinv: vu.subinv, invOrg: vu.invOrg, _idx: idx, _row: row };
              });
            }
          })() : []}
          columns={[
            { title: 'Lot', dataIndex: 'lot', render: v => <Tag color="geekblue">{v}</Tag> },
            { title: 'Inv Org', dataIndex: 'invOrg', render: v => v || '—' },
            { title: 'Subinv', dataIndex: 'subinv', render: v => v ? <Tag color="cyan">{v}</Tag> : '—' },
            { title: 'On-Hand Qty', dataIndex: 'lot', align: 'right', render: (lot: string) => {
                const q = lotPick?.onh?.[lot]?.qty;
                if (q != null) return <Text strong style={{ color: q > 0 ? REDWOOD.success : REDWOOD.neutral600, fontVariantNumeric: 'tabular-nums' }}>{fmtQty(q)}</Text>;
                return lotPick?.qtyLoading ? <Spin size="small" /> : <Text type="secondary">—</Text>;
              } },
            { title: 'Cost', dataIndex: 'cost', align: 'right', render: v => v == null ? '—' : fmtAmount(num(v), ccy) },
            { title: '', align: 'right', render: (_, r: any) => <Button size="small" type="primary" style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}
                onClick={() => { const lp = lotPick!; setLotPick(null); const lot = r._row ? parseVU(r._row.ValuationUnit).lot || null : r.lot; applyItemToLine(lp.key, { ItemNumber: lp.item }, lp.rows, lot); }}>Select</Button> },
          ]}
          summary={(rows) => {
            const total = rows.reduce((s: number, r: any) => s + (lotPick?.onh?.[r.lot]?.qty ?? 0), 0);
            return (
              <Table.Summary.Row style={{ background: REDWOOD.neutral100 }}>
                <Table.Summary.Cell index={0} colSpan={3}><Text strong>Total on-hand ({rows.length} lot{rows.length !== 1 ? 's' : ''})</Text></Table.Summary.Cell>
                <Table.Summary.Cell index={3} align="right"><Text strong style={{ color: REDWOOD.success, fontVariantNumeric: 'tabular-nums' }}>{lotPick?.qtyLoading ? <Spin size="small" /> : fmtQty(total)}</Text></Table.Summary.Cell>
                <Table.Summary.Cell index={4} />
                <Table.Summary.Cell index={5} />
              </Table.Summary.Row>
            );
          }} />
      </Modal>

      <Modal open={preview} onCancel={() => setPreview(false)} maskClosable={false} width={760}
        title={<Space><CloudUploadOutlined style={{ color: REDWOOD.primary }} /> {editMode ? `Update operations (${editOps.length})` : 'Create Order payload'}</Space>}
        footer={<Space>
          <Button size="small" type="text" icon={<CopyOutlined />} onClick={() => { navigator.clipboard.writeText(previewStr); message.success('Copied'); }}>Copy</Button>
          <Button onClick={() => setPreview(false)}>Close</Button>
        </Space>}>
        <div style={{ fontSize: 12, marginBottom: 8 }}>
          {editMode
            ? <Text type="secondary" style={{ fontSize: 12 }}>Each change runs as its own request: <Tag color="blue">PATCH</Tag> update qty · <Tag color="green">POST</Tag> add line · <Tag color="volcano">PATCH CanceledFlag</Tag> remove line.</Text>
            : <><Tag color="green">POST</Tag><Text style={{ fontFamily: 'monospace', fontSize: 11, color: REDWOOD.info, wordBreak: 'break-all' }}>{SO_CREATE_URL}</Text></>}
        </div>
        <div style={{ maxHeight: 360, overflow: 'auto', background: REDWOOD.neutral100, border: `1px solid ${REDWOOD.neutral200}`, borderRadius: 6, padding: 12 }}>
          <pre style={{ margin: 0, fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{previewStr}</pre>
        </div>
      </Modal>

      {/* Reservations hub — Create + View (with Unreserve) in one tabbed dialog */}
      <Modal open={reserveOpen} onCancel={() => setReserveOpen(false)} maskClosable={false} width={880}
        title={<Space><SafetyCertificateOutlined style={{ color: REDWOOD.primary }} /> Reservations — order {orderNumber}{resvList.length ? <Tag color="green">{resvList.length}</Tag> : null}</Space>}
        footer={resvTab === 'create'
          ? <Space>
              <Button size="small" type="text" icon={<CopyOutlined />} onClick={() => { navigator.clipboard.writeText(reserveRows.map(r => `POST ${RESERVE_URL}\n${JSON.stringify(reserveRowBody(r, orderNumber), null, 2)}`).join('\n\n')); message.success('Copied'); }}>Copy all</Button>
              <Button onClick={() => setReserveOpen(false)}>Close</Button>
              <Tooltip title={isDraftStatus ? undefined : 'Reservations are only allowed while the order is a draft'}>
                <Button type="primary" icon={<SafetyCertificateOutlined />} loading={workBusy === 'reserve'} disabled={!reserveRows.length || !isDraftStatus}
                  onClick={async () => { await runReserve(); await loadResvList(); setResvTab('view'); }}
                  style={{ background: REDWOOD.success, borderColor: REDWOOD.success }}>Run Reservation ({reserveRows.length})</Button>
              </Tooltip>
            </Space>
          : <Space>
              <Button icon={<ReloadOutlined />} loading={resvListLoading} onClick={loadResvList}>Refresh</Button>
              <Button onClick={() => setReserveOpen(false)}>Close</Button>
              <Tooltip title={isDraftStatus ? undefined : 'Reservations are only allowed while the order is a draft'}>
                <Button danger icon={<StopOutlined />} loading={workBusy === 'unreserve'} disabled={!resvList.length || !isDraftStatus}
                  onClick={async () => { await unreserveStock(); await loadResvList(); }}>Unreserve all ({resvList.length})</Button>
              </Tooltip>
            </Space>}>
        <Tabs size="small" activeKey={resvTab} onChange={k => setResvTab(k as 'create' | 'view')} items={[
        {
          key: 'create', label: <Space size={5}><SafetyCertificateOutlined />Create Reservation</Space>,
          children: <>
        <div style={{ fontSize: 12, marginBottom: 10 }}>
          <Tag color="green">POST</Tag><Text style={{ fontFamily: 'monospace', fontSize: 11.5, color: REDWOOD.info, wordBreak: 'break-all' }}>{RESERVE_URL}</Text>
          <div style={{ marginTop: 6 }}><Text type="secondary" style={{ fontSize: 11.5 }}>One POST per line · <b>DemandSourceType</b> <Tag style={{ marginInline: 3 }}>User Defined</Tag> · <b>DemandSourceName</b> = <Tag style={{ marginInline: 3 }}>{orderNumber}</Tag> (source txn #). Lot-controlled items require a <b>Lot</b> + <b>Subinventory</b> (INV-2416216).</Text></div>
        </div>
        {reserveRows.length === 0
          ? <Empty description={workBusy === 'reserve' ? 'Loading lines…' : 'No reservable lines'} style={{ padding: 20 }} />
          : <div style={{ maxHeight: 420, overflow: 'auto' }}>
              {reserveRows.map((r, i) => {
                const body = reserveRowBody(r, orderNumber);
                const needLot = r.lotControlled && !r.lot;
                const needSub = !r.subinventory;
                const optOf = (lot?: string, sub?: string) => r.options.find(o => (o.lot ?? '') === (lot ?? '') && (o.subinventory ?? '') === (sub ?? ''));
                return (
                <div key={r.key} style={{ marginBottom: 12, border: `1px solid ${r.ok === false ? REDWOOD.error : r.ok ? REDWOOD.success : REDWOOD.neutral200}`, borderRadius: 6, overflow: 'hidden' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 10px', background: REDWOOD.neutral100 }}>
                    <Tag color="blue">{i + 1}</Tag><Text strong style={{ fontSize: 12, color: REDWOOD.info }}>{r.item}</Text>
                    {r.inventoryItemId == null && <Tag color="warning" style={{ fontSize: 10 }}>no on-hand / item id</Tag>}
                    {r.lotControlled && <Tag color="geekblue" style={{ fontSize: 10 }}>lot controlled</Tag>}
                    <span style={{ marginLeft: 'auto' }}>
                      {r.ok === true && <Tag color="success">HTTP {r.status} · reserved</Tag>}
                      {r.ok === false && <Tag color="error">HTTP {r.status || '—'} · failed</Tag>}
                    </span>
                  </div>
                  {/* Lot / Subinventory / Qty pickers */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', padding: '8px 10px' }}>
                    <span style={{ fontSize: 11.5 }}>Lot{r.lotControlled ? ' *' : ''}:
                      <Select size="small" showSearch allowClear style={{ width: 200, marginLeft: 6 }} status={needLot ? 'error' : undefined}
                        value={r.lot} placeholder={r.options.some(o => o.lot) ? 'Select lot' : 'no lots on hand'} popupMatchSelectWidth={false}
                        options={Array.from(new Set(r.options.map(o => o.lot).filter(Boolean))).map(lot => {
                          const q = r.options.filter(o => o.lot === lot).reduce((s, o) => s + (o.qty || 0), 0);
                          return { value: lot as string, label: `${lot} — ${fmtQty(q)}` };
                        })}
                        onChange={(lot) => { const opt = r.options.find(o => o.lot === lot); updReserveRow(r.key, { lot: lot || undefined, subinventory: opt?.subinventory ?? r.subinventory, qty: opt ? Math.min(r.qty, opt.qty || r.qty) : r.qty }); }} />
                    </span>
                    <span style={{ fontSize: 11.5 }}>Subinv{r.lotControlled ? ' *' : ''}:
                      <Select size="small" showSearch allowClear style={{ width: 150, marginLeft: 6 }} status={r.lotControlled && needSub ? 'error' : undefined}
                        value={r.subinventory} placeholder="Subinventory" popupMatchSelectWidth={false}
                        options={Array.from(new Set(r.options.filter(o => !r.lot || o.lot === r.lot).map(o => o.subinventory).filter(Boolean))).map(s => ({ value: s as string, label: s as string }))}
                        onChange={(s) => updReserveRow(r.key, { subinventory: s || undefined })} />
                    </span>
                    <span style={{ fontSize: 11.5 }}>Qty:
                      <InputNumber size="small" min={0} style={{ width: 90, marginLeft: 6 }} value={r.qty}
                        max={(() => { const o = optOf(r.lot, r.subinventory); return o ? o.qty : undefined; })()}
                        onChange={(v) => updReserveRow(r.key, { qty: Number(v) || 0 })} />
                    </span>
                  </div>
                  <pre style={{ margin: 0, fontSize: 11, padding: 10, whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: REDWOOD.neutral100 }}>{JSON.stringify(body, null, 2)}</pre>
                  {r.errors && r.errors.length > 0 && <div style={{ padding: '6px 10px', background: '#fff1f0', borderTop: `1px solid ${REDWOOD.error}` }}>
                    {r.errors.map((e, j) => <div key={j} style={{ fontSize: 11.5, color: REDWOOD.error }}>• {e}</div>)}
                  </div>}
                </div>
                );
              })}
            </div>}
          </>,
        },
        {
          key: 'view', label: <Space size={5}><TableOutlined />View Reservations{resvList.length ? <Tag color="green" style={{ marginInlineEnd: 0 }}>{resvList.length}</Tag> : null}</Space>,
          children: <>
            <div style={{ fontSize: 11.5, marginBottom: 8 }}>
              <Tag color="green">GET</Tag><Text style={{ fontFamily: 'monospace', fontSize: 11, color: REDWOOD.info, wordBreak: 'break-all' }}>{reservationsQueryUrl(orderNumber, lines[0]?.itemNumber)}</Text>
              <div><Text type="secondary" style={{ fontSize: 11 }}>One call per line item · DemandSourceName = source transaction number.</Text></div>
            </div>
            <Table size="small" loading={resvListLoading} dataSource={resvList} rowKey={(r, i) => String(pf(r, ['ReservationId']) ?? i)}
              pagination={resvList.length > 20 ? { pageSize: 20 } : false} scroll={{ x: 'max-content', y: 340 }}
              locale={{ emptyText: 'No reservations for this order' }}
              columns={[
                { title: 'Item', width: 150, render: (_: any, r: any) => <Text strong style={{ color: REDWOOD.info, fontSize: 12 }}>{pf(r, ['ItemNumber']) ?? '—'}</Text> },
                { title: 'Lot', width: 130, render: (_: any, r: any) => { const l = pf(r, ['LotNumber']); return l ? <Tag color="geekblue">{l}</Tag> : <Text type="secondary">—</Text>; } },
                { title: 'Subinv', width: 100, render: (_: any, r: any) => { const s = pf(r, ['SubinventoryCode']); return s ? <Tag color="cyan">{s}</Tag> : '—'; } },
                { title: 'Org', width: 80, render: (_: any, r: any) => pf(r, ['OrganizationCode']) ?? '—' },
                { title: 'Qty', width: 90, align: 'right' as const, render: (_: any, r: any) => <Text strong style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtQty(num(pf(r, ['ReservationQuantity'])))}{pf(r, ['ReservationUOMCode']) ? ` ${pf(r, ['ReservationUOMCode'])}` : ''}</Text> },
                { title: 'Reservation Id', width: 150, render: (_: any, r: any) => <Text code style={{ fontSize: 11 }}>{pf(r, ['ReservationId']) ?? '—'}</Text> },
              ]} />
          </>,
        },
        ]} />
      </Modal>

      {/* Auto Ship Confirm — pick release → pick confirm → ship confirm workflow */}
      {/* shipmentLines are keyed by the SOURCE transaction number (e.g. LSO…), not the Fusion order number */}
      <AutoShipConfirmModal orderNo={orderNumber} org={hdr.warehouse} open={autoShipOpen} onClose={() => setAutoShipOpen(false)} />

      {/* Push to AR — Import AutoInvoice ESS job, filtered to this order number */}
      <AutoInvoiceModal orderNo={orderNumber} buId={hdr.businessUnitId} open={autoInvoiceOpen} onClose={() => setAutoInvoiceOpen(false)} />

      {/* Confirm pre-check — existing reservations will be dropped on confirm */}
      <Modal open={confirmResvOpen} onCancel={() => setConfirmResvOpen(false)} width={820}
        title={<Space><SendOutlined style={{ color: REDWOOD.primary }} /> Confirm order {liveOrderNumber()}</Space>}
        footer={<Space>
          <Button onClick={() => setConfirmResvOpen(false)}>Cancel</Button>
          <Button type="primary" icon={<SendOutlined />} loading={workBusy === 'confirm'} onClick={proceedConfirm}
            style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}>Proceed (unreserve &amp; confirm)</Button>
        </Space>}>
        <div style={{ background: '#fff7e6', border: '1px solid #ffd591', borderRadius: 6, padding: '10px 12px', marginBottom: 12 }}>
          <Text><InfoCircleOutlined style={{ color: '#d46b08', marginRight: 6 }} />This order has <b>{confirmResvList.length}</b> reservation(s). Confirming will <b>unreserve</b> them — the order re-reserves stock for shipping once submitted.</Text>
        </div>
        <Table size="small" columns={[
          { title: 'Item', width: 150, render: (_: any, r: any) => <Text strong style={{ color: REDWOOD.info, fontSize: 12 }}>{pf(r, ['ItemNumber']) ?? '—'}</Text> },
          { title: 'Lot', width: 130, render: (_: any, r: any) => { const l = pf(r, ['LotNumber']); return l ? <Tag color="geekblue">{l}</Tag> : '—'; } },
          { title: 'Subinv', width: 100, render: (_: any, r: any) => pf(r, ['SubinventoryCode']) ?? '—' },
          { title: 'Qty', width: 90, align: 'right', render: (_: any, r: any) => fmtQty(num(pf(r, ['ReservationQuantity']))) },
          { title: 'Reservation Id', render: (_: any, r: any) => <Text code style={{ fontSize: 11 }}>{pf(r, ['ReservationId']) ?? '—'}</Text> },
        ]} dataSource={confirmResvList} rowKey={(r, i) => String(pf(r, ['ReservationId']) ?? i)} pagination={false} scroll={{ y: 300 }} />
      </Modal>

      {/* Return lot/serial editor — the shipped lots/serials to send back on this line */}
      {(() => {
        const rl = lines.find(l => l.key === retLsKey);
        if (!rl) return null;
        const rows = (rl.retLots ?? []).map((x, i) => ({ ...x, _i: i, key: `${x.lot ?? ''}-${x.serial ?? ''}-${i}` }));
        const removeAt = (i: number) => {
          const next = (rl.retLots ?? []).filter((_, j) => j !== i);
          updLine(rl.key, { retLots: next, qty: next.reduce((s, x) => s + (x.qty || 0), 0) });
        };
        return (
          <Modal open onCancel={() => setRetLsKey(null)} width={600} footer={<Button onClick={() => setRetLsKey(null)}>Close</Button>}
            title={<Space><TagsOutlined style={{ color: REDWOOD.info }} /> Lot / Serial to return <Tag color="blue">{rl.itemNumber}</Tag></Space>}>
            <div style={{ fontSize: 12, marginBottom: 8 }}><Text type="secondary">Pulled from the original shipment (completed inventory transactions). Remove any you are not returning — the return quantity follows this list.</Text></div>
            <Table size="small" rowKey="key" dataSource={rows} pagination={rows.length > 12 ? { pageSize: 12 } : false}
              columns={[
                { title: '#', width: 44, align: 'center', render: (_: any, __: any, i: number) => <Tag color="blue">{i + 1}</Tag> },
                { title: 'Lot', dataIndex: 'lot', render: (v: any) => v ? <Tag color="geekblue">{v}</Tag> : <Text type="secondary">—</Text> },
                { title: 'Serial', dataIndex: 'serial', render: (v: any) => v ? <Text code style={{ fontSize: 11 }}>{v}</Text> : <Text type="secondary">—</Text> },
                { title: 'Qty', dataIndex: 'qty', width: 70, align: 'right', render: (v: any) => fmtQty(num(v)) },
                { title: '', width: 50, align: 'center', render: (_: any, row: any) => <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => removeAt(row._i)} /> },
              ]} />
            <div style={{ marginTop: 8, textAlign: 'right' }}><Text strong>Return quantity: {fmtQty(rows.reduce((s, x) => s + (x.qty || 0), 0))}</Text></div>
          </Modal>
        );
      })()}

      {/* Branch Sales Modal — capture branch details and create PO */}
      <Modal open={branchSalesModalOpen} onCancel={() => { setBranchSalesModalOpen(false); branchSalesForm.resetFields(); setSavedOrderNumber(null); }}
        maskClosable={false} width={900} style={{ maxHeight: '90vh' }} title={(() => {
          const orderTypeDetail = orderTypeLookup.get(hdr.orderType);
          const branchPoCode = orderTypeDetail?.branchPoCode || 'BRNS';
          return <Space><ShoppingOutlined style={{ color: REDWOOD.primary }} /> Create Branch Purchase Order ({branchPoCode}) — Sales Order <span style={{ color: REDWOOD.info, fontWeight: 'bold' }}>{createdOrderNumber || orderNumber}</span></Space>;
        })()}
        footer={<Space>
          <Button icon={<ApiOutlined />} onClick={() => setBranchApiDrawerOpen(true)}>View API</Button>
          <Button onClick={() => { setBranchSalesModalOpen(false); branchSalesForm.resetFields(); setSavedOrderNumber(null); }}>Cancel</Button>
          <Button type="primary" loading={creatingBranchPO} onClick={createBranchPO} style={{ background: REDWOOD.success, borderColor: REDWOOD.success }}>
            Create Branch PO
          </Button>
        </Space>}>
        <div style={{ marginBottom: 12, padding: '8px 12px', background: '#E6F7FF', borderRadius: 6, border: `1px solid ${REDWOOD.info}` }}>
          <Text style={{ fontSize: 11, color: REDWOOD.info }}>
            {(() => {
              const orderTypeDetail = orderTypeLookup.get(hdr.orderType);
              const branchPoCode = orderTypeDetail?.branchPoCode || 'BRNS';
              const orderTypeName = orderTypeDetail?.Meaning || hdr.orderType;
              return (
                <>
                  Sales Order <Text code strong>{savedOrderNumber}</Text> is a Branch Sales order ({orderTypeName}). Auto-create a Purchase Order with the <strong>{branchPoCode}</strong> prefix below.
                </>
              );
            })()}
          </Text>
        </div>
        <Form form={branchSalesForm} layout="vertical" size="small">
          <Row gutter={8}>
            <Col span={12}>
              <Form.Item label="Sales Order Number" name="salesOrderNumber" style={{ marginBottom: 8 }}>
                <Input readOnly size="small" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="PO Number" name="poNumber" style={{ marginBottom: 8 }}>
                <Input placeholder="Auto-generated with BLPO prefix" readOnly size="small" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={8}>
            <Col span={12}>
              <Form.Item label="Branch Business Unit" name="branchBusinessUnit" rules={[{ required: true, message: 'Select a business unit' }]} style={{ marginBottom: 8 }}>
                <Select showSearch size="small" placeholder="Select Branch Business Unit" optionFilterProp="label"
                  onChange={(buName) => onBranchBUChange(buName)}
                  options={bUnits.map(b => ({ value: b.businessUnitName, label: `${b.businessUnitName}${b.paymentCurrency ? ` — ${b.paymentCurrency}` : ''}` }))} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Base Currency" style={{ marginBottom: 8 }}>
                <Input readOnly size="small" value={branchBUData.baseCurrency || '—'} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={8}>
            <Col span={12}>
              <Form.Item label="Transaction Currency" name="currency" style={{ marginBottom: 8 }}>
                <Input readOnly size="small" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Conversion Rate (Trx → Base)" style={{ marginBottom: 8 }}>
                <Input readOnly size="small" value={branchBUData.conversionRate ? `1 ${hdr.txnCurrency} = ${branchBUData.conversionRate} ${branchBUData.baseCurrency}` : '—'} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label={<span>Branch Supplier <SearchOutlined style={{ color: REDWOOD.info, marginLeft: 4 }} /></span>} name="branchSupplierName" rules={[{ required: true, message: 'Select a supplier' }]} style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', gap: 4 }}>
              <Input placeholder="Search supplier by name..." size="small" readOnly value={branchSalesForm.getFieldValue('branchSupplierName') ?? ''} disabled style={{ flex: 1 }} />
              <Button size="small" icon={<SearchOutlined />} onClick={() => setBranchSupplierSearchOpen(true)} style={{ background: REDWOOD.info, borderColor: REDWOOD.info, color: '#fff' }} />
            </div>
          </Form.Item>
          <Form.Item label="Supplier Site" name="branchSupplierSite" rules={[{ required: true, message: 'Enter supplier site code' }]} style={{ marginBottom: 8 }}>
            <Input placeholder="e.g., VIS0005-S" size="small" />
          </Form.Item>
          <Form.Item label={<span>Ship-To Location (Inventory Org) <Tooltip title={(() => {
            const buName = branchSalesForm.getFieldValue('branchBusinessUnit');
            const filterQuery = buName ? `ManagementBusinessUnitName=${buName}` : 'N/A';
            const fullUrl = `${FUSION_BASE}/inventoryOrganizations?q=${filterQuery}&onlyData=true&limit=500`;
            return <span style={{ fontFamily: 'monospace', fontSize: '11px', wordBreak: 'break-all' }}><b>GET</b><br />{fullUrl}</span>;
          })()}><ApiOutlined style={{ color: REDWOOD.info, marginLeft: 4, cursor: 'pointer' }} /></Tooltip> <ReloadOutlined style={{ color: REDWOOD.success, marginLeft: 4, cursor: 'pointer' }} onClick={() => {
            const buName = branchSalesForm.getFieldValue('branchBusinessUnit');
            if (buName) {
              onBranchBUChange(buName);
            }
          }} title="Refresh inventory organizations" /></span>} name="shipToLocation" rules={[{ required: true, message: 'Select a location' }]} style={{ marginBottom: 8 }}>
            <Select showSearch size="small" placeholder="Select Ship-To Location" optionFilterProp="label" allowClear
              options={branchShipToOrgs.map((o: any) => ({ value: pf(o, ['OrganizationCode']), label: `${pf(o, ['OrganizationCode'])}${pf(o, ['OrganizationName']) ? ' — ' + pf(o, ['OrganizationName']) : ''}` }))} />
          </Form.Item>
          <Form.Item label="Need-By Date" name="needByDate" rules={[{ required: true, message: 'Select need-by date' }]} style={{ marginBottom: 8 }}>
            <DatePicker size="small" value={branchPoNeedByDate} onChange={(date) => setBranchPoNeedByDate(date)} />
          </Form.Item>

          <Divider style={{ margin: '8px 0' }}>Line Items from Sales Order</Divider>

          <div style={{ marginBottom: 12, maxHeight: '200px', overflowY: 'auto' }}>
            <Table
              size="small"
              rowKey="key"
              dataSource={lines.filter(l => l.itemNumber && num(l.qty) > 0)}
              pagination={false}
              columns={[
                { title: 'Item', dataIndex: 'itemNumber', width: 80 },
                { title: 'Description', dataIndex: 'description', ellipsis: true },
                { title: 'Qty', dataIndex: 'qty', width: 60, align: 'right', render: (v: any) => fmtQty(num(v)) },
                { title: 'UOM', dataIndex: 'uom', width: 50 },
                { title: 'Unit Price', dataIndex: 'unitPrice', width: 90, align: 'right', render: (v: any) => fmtAmount(num(v), hdr.txnCurrency) },
                {
                  title: 'Line Total',
                  width: 110,
                  align: 'right',
                  render: (_: any, record: any) => {
                    const lineTot = num(record.qty) * num(record.unitPrice);
                    return fmtAmount(lineTot, hdr.txnCurrency);
                  }
                },
              ]}
            />
          </div>

          <Row gutter={8} style={{ background: REDWOOD.neutral100, padding: '8px', borderRadius: '6px', marginBottom: 0 }}>
            <Col span={12}>
              <div>
                <Text style={{ fontSize: '11px', color: REDWOOD.neutral600 }}>Transaction Currency Total</Text>
                <div style={{ fontSize: '14px', fontWeight: '700', color: REDWOOD.primary }}>
                  {fmtAmount(lines.filter(l => l.itemNumber && num(l.qty) > 0).reduce((s, l) => s + (num(l.qty) * num(l.unitPrice)), 0), hdr.txnCurrency)}
                </div>
              </div>
            </Col>
            <Col span={12}>
              <div>
                <Text style={{ fontSize: '11px', color: REDWOOD.neutral600 }}>Base Currency (Conversion Rate: {num(hdr.rate).toFixed(4)})</Text>
                <div style={{ fontSize: '14px', fontWeight: '700', color: REDWOOD.success }}>
                  {fmtAmount(
                    lines.filter(l => l.itemNumber && num(l.qty) > 0).reduce((s, l) => s + (num(l.qty) * num(l.unitPrice)), 0) * (num(hdr.rate) || 1),
                    branchBUData.baseCurrency || hdr.baseCurrency
                  )}
                </div>
              </div>
            </Col>
          </Row>
        </Form>
      </Modal>

      {/* Branch PO API Drawer */}
      <Drawer
        title="API Inspector - Branch Purchase Order"
        placement="right"
        onClose={() => setBranchApiDrawerOpen(false)}
        open={branchApiDrawerOpen}
        width={600}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div>
            <Typography.Paragraph>
              <Text strong>PO Payload (will be sent on Create):</Text>
            </Typography.Paragraph>
            {!branchPoPayload ? (
              <div style={{ background: '#f5f5f5', padding: '12px', borderRadius: '4px', color: '#999' }}>
                Fill in all required fields (Branch Business Unit, Supplier, Ship-To Location) to preview PO payload
              </div>
            ) : (
              <pre
                style={{
                  background: '#f5f5f5',
                  padding: '12px',
                  borderRadius: '4px',
                  maxHeight: '400px',
                  overflow: 'auto',
                  fontSize: '11px',
                  fontFamily: 'monospace',
                  lineHeight: '1.4',
                }}
              >
                {branchPoPayload}
              </pre>
            )}
            {branchPoPayload && (
              <Button
                size="small"
                icon={<CopyOutlined />}
                onClick={() => {
                  navigator.clipboard.writeText(branchPoPayload);
                  message.success('Payload copied to clipboard');
                }}
                style={{ marginTop: '8px' }}
              >
                Copy Payload
              </Button>
            )}
          </div>

          <Divider />

          <div>
            <Typography.Paragraph>
              <Text strong>Endpoint:</Text>
            </Typography.Paragraph>
            <div style={{ background: '#f5f5f5', padding: '8px', borderRadius: '4px', wordBreak: 'break-all', fontFamily: 'monospace', fontSize: '12px' }}>
              POST {FUSION_BASE}/draftPurchaseOrders
            </div>
          </div>

          <Divider />

          <div style={{ display: 'flex', gap: '8px' }}>
            <Button
              type="primary"
              icon={<ApiOutlined />}
              onClick={async () => {
                if (!branchPoPayload) {
                  message.error('Fill in all required fields to test payload');
                  return;
                }
                try {
                  const payload = JSON.parse(branchPoPayload);
                  const r = await fetch(`${FUSION_BASE}/draftPurchaseOrders`, {
                    method: 'POST',
                    headers: { ...getHeaders(), 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                  });
                  const data = await r.json();
                  if (r.ok) {
                    Modal.success({
                      title: 'Test Successful',
                      content: `Draft PO created successfully\nPO Number: ${data.OrderNumber || data.PurchaseOrderNumber || 'N/A'}`,
                      okText: 'Close',
                    });
                  } else {
                    const errorMsg = data.message || data.error || JSON.stringify(data, null, 2);
                    Modal.error({
                      title: 'Test Failed',
                      content: <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '12px', maxHeight: '400px', overflow: 'auto' }}>
                        {errorMsg}
                      </div>,
                      okText: 'Close',
                      width: 600,
                    });
                  }
                } catch (e: any) {
                  Modal.error({
                    title: 'Test Error',
                    content: String(e),
                    okText: 'Close',
                  });
                }
              }}
              loading={creatingBranchPO}
            >
              Test Payload
            </Button>
            <Button onClick={() => setBranchApiDrawerOpen(false)}>Close</Button>
          </div>
        </div>
      </Drawer>

      {/* Branch Supplier Search Dialog */}
      <Modal
        open={branchSupplierSearchOpen}
        onCancel={() => {
          setBranchSupplierSearchOpen(false);
          setBranchSupplierSearchTerm('');
        }}
        width={700}
        title={<Space><SearchOutlined style={{ color: REDWOOD.info }} /> Search Suppliers</Space>}
        footer={null}
      >
        <div style={{ marginBottom: 16, padding: '12px', background: REDWOOD.neutral100, borderRadius: 4, fontSize: 11, color: REDWOOD.neutral600, wordBreak: 'break-all' }}>
          <div style={{ marginBottom: 8, fontWeight: 500 }}>API URL:</div>
          <Text code>{`${FUSION_BASE}/suppliers?q=Supplier LIKE '*${branchSupplierSearchTerm}*' OR SupplierNumber LIKE '*${branchSupplierSearchTerm}*'&limit=20`}</Text>
        </div>
        <div style={{ marginBottom: 16 }}>
          <Input.Search
            placeholder="Search by supplier name or number..."
            value={branchSupplierSearchTerm}
            onChange={(e) => setBranchSupplierSearchTerm(e.target.value)}
            onSearch={(term) => {
              if (term.length >= 2) {
                setBranchSupplierSearchLoading(true);
                fetchBranchSuppliers(term).finally(() => setBranchSupplierSearchLoading(false));
              }
            }}
            enterButton="Search"
            loading={branchSupplierSearchLoading}
            size="large"
          />
        </div>
        <Table
          size="small"
          loading={branchSupplierSearchLoading}
          columns={[
            { title: 'Supplier #', dataIndex: 'SupplierNumber', width: 100 },
            { title: 'Supplier Name', dataIndex: 'SupplierName', render: (v: any) => v || 'Unknown' },
            { title: 'Status', dataIndex: 'SupplierStatus', width: 80, render: (v: any) => v ? <Tag color="green">{v}</Tag> : <Tag>—</Tag> },
          ]}
          dataSource={branchSuppliers.map((s, i) => ({
            key: i,
            SupplierNumber: s.SupplierNumber,
            SupplierName: s.SupplierName || s.Supplier,
            SupplierStatus: s.SupplierStatus,
            _source: s,
          }))}
          pagination={false}
          onRow={(record) => ({
            onClick: () => {
              const branchBU = branchSalesForm.getFieldValue('branchBusinessUnit');
              const supplier = record._source;

              if (!branchBU) {
                message.error('Please select Branch Business Unit first');
                return;
              }

              // Filter sites by the selected business unit
              const filteredSites = (supplier.sites ?? []).filter((site: any) =>
                site.ProcurementBU === branchBU
              );

              console.log('Supplier sites filtered:', { supplier: supplier.SupplierName || supplier.Supplier, branchBU, total: supplier.sites?.length, filtered: filteredSites.length, filteredSites });

              if (filteredSites.length === 0) {
                message.error(`No sites found for ${branchBU}. Please select a different business unit.`);
                return;
              }

              // If only one site, auto-select it
              if (filteredSites.length === 1) {
                const site = filteredSites[0];
                const siteCode = pf(site, ['SupplierSite', 'VendorSiteCode', 'SiteCode']);
                branchSalesForm.setFieldsValue({
                  branchSupplierName: supplier.SupplierName || supplier.Supplier,
                  branchSupplierSite: siteCode,
                });
                setBranchSupplierSearchOpen(false);
                setBranchSupplierSearchTerm('');
                message.success(`Selected site: ${siteCode}`);
                return;
              }

              // If multiple sites, show modal to select
              setSelectedSupplierWithSites({ ...supplier, sites: filteredSites });
              setBranchSupplierSitesModalOpen(true);
            },
            style: { cursor: 'pointer' },
          })}
          locale={{ emptyText: branchSupplierSearchTerm.length < 2 ? 'Type at least 2 characters to search' : 'No suppliers found' }}
        />
      </Modal>

      {/* Supplier Sites Selection Modal */}
      <Modal
        open={branchSupplierSitesModalOpen}
        onCancel={() => {
          setBranchSupplierSitesModalOpen(false);
          setSelectedSupplierWithSites(null);
        }}
        title={<Space><BankOutlined style={{ color: REDWOOD.info }} /> Select Supplier Site</Space>}
        footer={null}
        width={600}
      >
        <div style={{ marginBottom: 16, padding: '12px', background: REDWOOD.neutral100, borderRadius: 4 }}>
          <div><Text strong>Supplier:</Text> {selectedSupplierWithSites?.SupplierName || selectedSupplierWithSites?.Supplier}</div>
          <div style={{ marginTop: 4 }}><Text strong>Supplier #:</Text> {selectedSupplierWithSites?.SupplierNumber}</div>
        </div>
        {selectedSupplierWithSites?.sites && selectedSupplierWithSites.sites.length > 0 ? (
          <Table
            size="small"
            columns={[
              { title: 'Site Code', dataIndex: 'SiteCode', width: 120 },
              { title: 'Site Name', dataIndex: 'SiteName', render: (v: any) => v || '—' },
              { title: 'Status', dataIndex: 'Status', width: 100, render: (v: any) => <Tag color={v === 'Active' ? 'green' : 'red'}>{v || '—'}</Tag> },
            ]}
            dataSource={(selectedSupplierWithSites.sites ?? []).map((site: any, i: number) => ({
              key: i,
              SiteCode: pf(site, ['SupplierSite', 'VendorSiteCode', 'SiteCode']),
              SiteName: pf(site, ['SupplierAddressName', 'VendorSiteName', 'SiteName']),
              Status: site.InactiveDate ? 'Inactive' : 'Active',
              _site: site,
            }))}
            pagination={false}
            onRow={(record) => ({
              onClick: () => {
                const siteCode = pf(record._site, ['SupplierSite', 'VendorSiteCode', 'SiteCode']);
                branchSalesForm.setFieldsValue({
                  branchSupplierName: selectedSupplierWithSites.SupplierName || selectedSupplierWithSites.Supplier,
                  branchSupplierSite: siteCode,
                });
                setBranchSupplierSearchOpen(false);
                setBranchSupplierSitesModalOpen(false);
                setSelectedSupplierWithSites(null);
                setBranchSupplierSearchTerm('');
                message.success(`Selected site: ${siteCode}`);
              },
              style: { cursor: 'pointer' },
            })}
          />
        ) : (
          <Empty description="No sites available for this supplier" />
        )}
      </Modal>

      <CustomerSearchBipModal
        open={custSearchModalOpen}
        onClose={() => setCustSearchModalOpen(false)}
        onSelect={onCustomerBipSelect}
        businessUnitId={hdr.businessUnitId?.toString()}
        businessUnitName={hdr.businessUnit}
        soapBaseUrl={`${getFusionInstanceUrl() || getFusionInstance().host}/xmlpserver/services/v2/ReportService`}
        username={auth.user?.username}
        password={localStorage.getItem('fusion_password')}
      />
      <ARInvoiceDialog txn={arTxn} onClose={() => setArTxn(null)} />
    </div>
  );
};

const SalesOrders: React.FC = () => {
  console.log('SalesOrders component rendering...');
  const [openTabs, setOpenTabs] = useState<{ key: string; order: any }[]>([]);
  const [newTabs, setNewTabs] = useState<{ key: string; header: OrderHeader; draft?: SoDraft; editOrder?: any; returnMode?: boolean }[]>([]);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [activeKey, setActiveKey] = useState('search');
  console.log('SalesOrders: State initialized');

  const openOrder = useCallback((order: any) => {
    const key = String(order.OrderKey ?? order.HeaderId ?? order.OrderNumber);
    setOpenTabs(prev => (prev.some(t => t.key === key) ? prev : [...prev, { key, order }]));
    setActiveKey(key);
  }, []);

  // Open an existing order in the create page as an editable change order.
  const openEdit = useCallback(async (order: any) => {
    const key = `edit-${order.OrderKey ?? order.HeaderId ?? order.OrderNumber}`;
    setActiveKey(key);
    if (newTabs.some(t => t.key === key)) return;
    const header: OrderHeader = {
      businessUnit: order.BusinessUnitName ?? undefined,
      businessUnitId: order.BusinessUnitId ?? undefined,
      txnCurrency: order.TransactionalCurrencyCode ?? order.AppliedCurrencyCode ?? order.CurrencyCode ?? order.TransactionalCurrencyName ?? 'AED',
      baseCurrency: order.TransactionalCurrencyCode ?? order.AppliedCurrencyCode ?? order.CurrencyCode ?? 'AED',
      orderType: order.TransactionTypeCode ?? order.TransactionType ?? undefined,
      orderDate: order.TransactionOn ? dayjs(order.TransactionOn) : dayjs(),
      customerName: order.BuyingPartyName ?? undefined,
      accountNumber: order.BuyingPartyNumber ?? undefined,
      paymentTerms: order.PaymentTerms ?? order.PaymentTermsCode ?? undefined,
      warehouse: order.RequestedFulfillmentOrganizationCode ?? undefined,
      rate: order.CurrencyConversionRate != null ? Number(order.CurrencyConversionRate) : 1,
      currencyRateType: order.CurrencyConversionType ?? 'Corporate',
      currencyDate: order.CurrencyConversionDate ? dayjs(order.CurrencyConversionDate) : dayjs(),
    };
    const hide = message.loading('Loading customer details…', 0);
    const refs = await fetchOrderCustomerRefs(order);
    hide();
    setNewTabs(prev => (prev.some(t => t.key === key) ? prev : [...prev, { key, header: { ...header, ...refs }, editOrder: order }]));
    setActiveKey(key);
  }, [newTabs]);

  // Header carried over from an existing order (for copy / return).
  const headerFromOrder = (order: any): OrderHeader => ({
    businessUnit: order.BusinessUnitName ?? undefined,
    businessUnitId: order.BusinessUnitId ?? undefined,
    txnCurrency: order.TransactionalCurrencyCode ?? order.AppliedCurrencyCode ?? 'AED',
    baseCurrency: order.TransactionalCurrencyCode ?? 'AED',
    orderType: order.TransactionTypeCode ?? order.TransactionType ?? undefined,
    orderDate: dayjs(),
    customerName: order.BuyingPartyName ?? undefined,
    accountNumber: order.BuyingPartyNumber ?? undefined,
    paymentTerms: order.PaymentTerms ?? order.PaymentTermsCode ?? undefined,
    warehouse: order.RequestedFulfillmentOrganizationCode ?? undefined,
    rate: order.CurrencyConversionRate != null ? Number(order.CurrencyConversionRate) : 1,
    currencyRateType: order.CurrencyConversionType ?? 'Corporate',
    currencyDate: order.CurrencyConversionDate ? dayjs(order.CurrencyConversionDate) : dayjs(),
  });

  // Copy an order → a brand-new draft order pre-filled with the same lines.
  const openCopy = useCallback(async (order: any, lines: any[]) => {
    const key = `copy-${order.OrderKey ?? order.HeaderId ?? order.OrderNumber}-${Date.now()}`;
    const hide = message.loading('Copying order…', 0);
    const refs = await fetchOrderCustomerRefs(order, lines);
    hide();
    const subinv = (lines ?? []).map(l => l.SubinventoryCode).find(Boolean);
    const draft: SoDraft = { header: { ...headerFromOrder(order), ...refs, ...(subinv ? { subinventory: subinv } : {}) }, lines: (lines ?? []).map((l, i) => orderLineToNewLine(l, i)) };
    setNewTabs(prev => [...prev, { key, header: draft.header, draft }]);
    setActiveKey(key);
    message.success(`Copied ${draft.lines.length} line(s) into a new order`);
  }, []);

  // Return an order (or selected lines) → a new RMA order referencing the original.
  // For each line, pull the lot/serial numbers that were actually shipped from
  // completed inventory transactions so the return carries them back.
  const openReturn = useCallback(async (order: any, lines: any[]) => {
    const key = `return-${order.OrderKey ?? order.HeaderId ?? order.OrderNumber}-${Date.now()}`;
    const hide = message.loading('Creating return (fetching shipped lot/serial)…', 0);
    const refs = await fetchOrderCustomerRefs(order, lines);
    const orderNos = [order.OrderNumber, order.SourceTransactionNumber];
    const idxLines = (lines ?? []).map((l, i) => ({ l, i }));
    const retLines = await mapLimit(idxLines, 4, async ({ l, i }) => {
      const nl = orderLineToNewLine(l, i, {
        asReturn: true, refOrderNumber: String(order.OrderNumber ?? order.SourceTransactionNumber ?? ''), refHeaderId: order.HeaderId ?? order.OrderKey,
      });
      const org = l.RequestedFulfillmentOrganizationCode ?? order.RequestedFulfillmentOrganizationCode ?? '';
      try {
        const ls = await fetchShippedLotSerials(nl.itemNumber, org, orderNos);
        if (ls.length) {
          nl.retLots = ls;
          const lots = Array.from(new Set(ls.map(x => x.lot).filter(Boolean))) as string[];
          if (lots.length) { nl.lot = lots[0]; nl.lots = lots; }
          const total = ls.reduce((s, x) => s + (x.qty || 0), 0);
          if (total > 0) nl.qty = total; // return exactly what was shipped
        }
      } catch { /* no shipped lot/serial found */ }
      return nl;
    });
    hide();
    const subinv = (lines ?? []).map(l => l.SubinventoryCode).find(Boolean);
    const draft: SoDraft = { header: { ...headerFromOrder(order), ...refs, ...(subinv ? { subinventory: subinv } : {}) }, lines: retLines };
    setNewTabs(prev => [...prev, { key, header: draft.header, draft, returnMode: true }]);
    setActiveKey(key);
    const withLs = retLines.filter(l => l.retLots && l.retLots.length).length;
    message.success(`Return created for ${draft.lines.length} line(s)${withLs ? ` — lot/serial pulled for ${withLs}` : ''}`);
  }, []);

  const removeTab = (key: string) => {
    setOpenTabs(prev => prev.filter(t => t.key !== key));
    setNewTabs(prev => prev.filter(t => t.key !== key));
    setActiveKey(cur => (cur === key ? 'search' : cur));
  };

  const proceedNewOrder = (header: OrderHeader) => {
    const key = `new-${Date.now()}`;
    setNewTabs(prev => [...prev, { key, header }]);
    setActiveKey(key);
  };

  // Open a new-order tab pre-populated from a saved draft JSON.
  const loadNewOrderFromJson = async (file: File) => {
    try {
      const draft = toSoDraft(await readJsonFile(file));
      if (!draft) { message.error('Not a sales-order JSON (missing header/lines)'); return false; }
      const key = `new-${Date.now()}`;
      setNewTabs(prev => [...prev, { key, header: draft.header, draft }]);
      setActiveKey(key);
      message.success(`Loaded ${draft.lines.length} line(s) from JSON`);
    } catch (e: any) { message.error(`Load failed: ${e.message}`); }
    return false;
  };

  const items = [
    {
      key: 'search',
      label: <span><SearchOutlined style={{ marginRight: 5 }} />Search</span>,
      closable: false,
      children: <SearchTab onOpen={openOrder} onEdit={openEdit} />,
    },
    ...newTabs.map((t, i) => ({
      key: t.key,
      label: t.editOrder
        ? <span><EditOutlined style={{ marginRight: 5, color: '#B07700' }} />Edit {t.editOrder.OrderNumber ?? ''}</span>
        : t.returnMode
        ? <span><RollbackOutlined style={{ marginRight: 5, color: '#B12A5B' }} />Return {t.draft?.lines?.[0]?.refOrderNumber ?? ''}</span>
        : t.key.startsWith('copy-')
        ? <span><CopyOutlined style={{ marginRight: 5, color: REDWOOD.info }} />Copy Order</span>
        : <span><PlusOutlined style={{ marginRight: 5 }} />New Order{newTabs.filter(x => !x.editOrder && !x.returnMode && !x.key.startsWith('copy-')).length > 1 ? ` ${i + 1}` : ''}</span>,
      closable: true,
      children: <NewOrderTab header={t.header} initialDraft={t.draft} editOrder={t.editOrder} returnMode={t.returnMode} onCopy={openCopy} />,
    })),
    ...openTabs.map(t => ({
      key: t.key,
      label: <span><ShoppingOutlined style={{ marginRight: 5 }} />{t.order.SourceTransactionNumber ?? t.order.OrderNumber}</span>,
      closable: true,
      children: <OrderView order={t.order} onCopy={openCopy} onReturn={openReturn} />,
    })),
  ];

  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
      <Content>
        <div style={{ padding: '12px 24px', background: REDWOOD.surface, borderBottom: `1px solid ${REDWOOD.neutral200}` }}>
          <Breadcrumb items={[
            { title: <Link to="/home"><HomeOutlined /> Home</Link> },
            { title: <Link to="/procurement">Fusion Supply Chain</Link> },
            { title: 'Sales Orders' },
          ]} />
          <Title level={4} style={{ margin: '8px 0 0', display: 'flex', alignItems: 'center', gap: 8 }}>
            <ShoppingOutlined style={{ color: REDWOOD.primary }} /> Sales Orders
            <Text type="secondary" style={{ fontSize: 13, fontWeight: 400 }}>— search & drill into sales orders (Fusion salesOrdersForOrderHub)</Text>
          </Title>
        </div>

        <div style={{ padding: '12px 20px' }}>
          <Tabs type="editable-card" hideAdd size="small" activeKey={activeKey}
            onChange={setActiveKey} onEdit={(key, action) => { if (action === 'remove') removeTab(key as string); }}
            tabBarExtraContent={<Space>
              <Upload accept=".json,application/json" showUploadList={false} beforeUpload={(f) => loadNewOrderFromJson(f)}>
                <Button icon={<CloudUploadOutlined />}>Load from JSON</Button>
              </Upload>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setRegisterOpen(true)}
                style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}>Create New Order</Button>
            </Space>}
            items={items} />
        </div>

        <RegisterOrderModal open={registerOpen} onClose={() => setRegisterOpen(false)} onProceed={proceedNewOrder} />
      </Content>
    </Layout>
  );
};

export default SalesOrders;
