import { buildApexUrl, buildCurrencyUrl } from '../../config/api.helper';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import type * as XLSX from 'xlsx';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import {
  Layout, Breadcrumb, Typography, Card, Table, Button, Form, Input, Select,
  DatePicker, Row, Col, Space, Modal, InputNumber, Tabs, Checkbox,
  Spin, Tooltip, Tag, Divider, Badge, Progress, Alert, Upload, Dropdown, Segmented,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { TableRowSelection } from 'antd/es/table/interface';
import {
  HomeOutlined, PlusOutlined, DeleteOutlined, EditOutlined,
  SaveOutlined, CloseOutlined, SearchOutlined, ApiOutlined,
  UserOutlined, CalendarOutlined, DollarOutlined, ShopOutlined,
  BuildOutlined, FileTextOutlined, CheckCircleOutlined,
  CloseCircleOutlined, UploadOutlined, MailOutlined, SyncOutlined,
  CodeOutlined, DownOutlined, DownloadOutlined, FolderOpenOutlined,
  CheckOutlined, ThunderboltOutlined, SwapOutlined,
} from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import { message } from 'antd';
import { FUSION_POD_HOST, FUSION_POD_AUTH } from '../../config/fusionInstance';

const { Content } = Layout;
const { Text, Title } = Typography;
const { Option } = Select;

const FUSION_BASE = `${FUSION_POD_HOST}/fscmRestApi/resources/11.13.18.05`;
const ORDS_DIRECT = buildApexUrl('test/FUSIONCLIENTERP');
// In dev (localhost) use Vite proxy to avoid CORS; in Electron/production use direct URL.
const ORDS_BASE   = window.location.hostname === 'localhost' ? '/ords-mitsu' : ORDS_DIRECT;
const GL_ORDS_BASE = buildApexUrl('');
const AUTH_HEADER = FUSION_POD_AUTH;
const FUSION_HDRS = { Authorization: AUTH_HEADER, Accept: 'application/json' };

const C = {
  red: '#C74634', redDark: '#A33B2C',
  green: '#1D7B4D', blue: '#0572CE',
  orange: '#D4A800', teal: '#00918A', purple: '#6B21A8',
  bg: '#F4F5F7', surface: '#FFFFFF',
  border: '#DFE1E6', borderDark: '#C1C7D0',
  text: '#333333', textMid: '#666666', textLight: '#999999',
  rowAlt: '#FAFBFC',
};

const fetchLOV = async (url: string, auth = true): Promise<any[]> => {
  const all: any[] = [];
  let offset = 0;
  while (true) {
    const sep = url.includes('?') ? '&' : '?';
    const r = await fetch(`${url}${sep}limit=500&offset=${offset}`, auth ? { headers: FUSION_HDRS } : {});
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      throw new Error(`HTTP ${r.status}${body ? ` — ${body.slice(0, 200)}` : ''}`);
    }
    const d = await r.json();
    // ORDS collection feeds return { items: [...], hasMore: bool }
    // Some ORDS handlers return { rows: [...] } or plain arrays
    const items: any[] = d.items ?? d.rows ?? (Array.isArray(d) ? d : []);
    all.push(...items);
    // hasMore can be boolean or string; stop if false/missing or fewer than 500 returned
    if (!d.hasMore || items.length < 500) break;
    offset += 500;
  }
  return all;
};

const generatePONumber = (docType: string): string => {
  const seq = parseInt(sessionStorage.getItem('po_seq') ?? '0', 10) + 1;
  sessionStorage.setItem('po_seq', String(seq));
  return `${docType}${dayjs().format('DDMMYYYY')}${String(seq).padStart(4, '0')}`;
};

const fmt = (v: number) =>
  new Intl.NumberFormat('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);

/* ─── Types ─────────────────────────────────────────── */
interface POHeader {
  poNumber: string; docType: string; orderDate: Dayjs;
  status: string; buyer: string;
  procurementBU: string; requisitioningBU: string; billToBU: string;
  currency: string; description: string;
  supplierId: string; supplierName: string; supplierSite: string;
  supplierContact: string; communicationMethod: string; communicationEmail: string;
  billToLocation: string; shipToLocation: string;
  shipToOrg: string; subinventory: string;
  paymentTerms: string; shippingMethod: string; freightTerms: string; fob: string;
  payOnReceipt: boolean; confirmingOrder: boolean;
  noteToSupplier: string; noteToReceiver: string;
}

interface POLine {
  key: string; lineNum: number;
  poLineId?: number;   // Fusion POLineId — present only for lines loaded from Fusion (edit mode)
  scheduleId?: number; // Fusion schedule id (LineLocationId) — for PATCHing need-by
  itemNumber: string; description: string; uom: string;
  qty: number; price: number; taxPct: number;
  needBy: Dayjs | null; promisedDate: Dayjs | null;
  lineTotal: number; taxAmount: number; netTotal: number;
  chargeAccount: string; destinationType: string;
  // Inventory-org assignment (itemsV2)
  assignOrg?: string;
  assignStatus?: 'idle' | 'pending' | 'success' | 'error';
  assignMsg?: string;
}

const computeLine = (line: Omit<POLine, 'lineTotal' | 'taxAmount' | 'netTotal'>): POLine => {
  const lineTotal = line.qty * line.price;
  const taxAmount = lineTotal * line.taxPct / 100;
  return { ...line, lineTotal, taxAmount, netTotal: lineTotal + taxAmount };
};

/* ─── Acquisition Cost types ────────────────────────── */
const ACQ_CHARGE_TYPES = [
  'Freight', 'Insurance', 'Customs Duty', 'Local Handling',
  'Port Charges', 'Inspection', 'Brokerage', 'Survey', 'Quarantine', 'Other',
];
const ACQ_APPORTION_OPTIONS = [
  { value: 'value', label: 'By Value' },
  { value: 'qty',   label: 'By Quantity' },
  { value: 'equal', label: 'Equal' },
  { value: 'manual', label: 'Manual' },
];

interface AcqCharge {
  key: string;
  chargeType: string;
  description: string;
  amount: number;
  currency: string;
  apportionBasis: 'value' | 'qty' | 'equal' | 'manual';
  manualAmounts: Record<string, number>; // lineKey → allocated amount
}

interface PastedItem {
  key: string;
  itemNumber: string;
  qty: number;
  price: number;
  status: 'pending' | 'valid' | 'invalid';
  matchedItem?: any;
}

// Parse Qty + Price from the cells after the item number.
// 3+ cells → [item, qty, price]; exactly 2 → [item, price] (qty defaults to 1).
const parseQtyPrice = (rest: any[]): { qty: number; price: number } => {
  // Strip thousands-commas so "10,000" → 10000 (not 10).
  const cells = rest.map(v => String(v ?? '').trim().replace(/,/g, ''));
  let qty = 1, price = 0;
  if (cells.length >= 2 && cells[1] !== '') {
    qty   = parseFloat(cells[0]) || 1;
    price = parseFloat(cells[1]) || 0;
  } else {
    price = parseFloat(cells[0] ?? '') || 0;   // legacy 2-column: item, price
  }
  if (!(qty > 0)) qty = 1;
  return { qty, price };
};

/* ─── Compact field pair (label : value on one row) ─── */
const FieldPair: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div style={{ display: 'flex', alignItems: 'center', marginBottom: 7, gap: 6, minHeight: 24 }}>
    <span style={{ fontSize: 11, color: C.textLight, minWidth: 110, flexShrink: 0 }}>{label}</span>
    <span style={{ fontSize: 13, color: C.text, flex: 1 }}>{value}</span>
  </div>
);

/* ─── Info tile (small label + value) ───────────────── */
const InfoTile: React.FC<{ label: string; value: React.ReactNode; icon?: React.ReactNode }> = ({ label, value, icon }) => (
  <div style={{ marginBottom: 14 }}>
    <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: C.textLight, marginBottom: 2 }}>
      {icon && <span style={{ marginRight: 4 }}>{icon}</span>}{label}
    </div>
    <div style={{ fontSize: 13, color: C.text, minHeight: 22 }}>{value ?? '—'}</div>
  </div>
);

/* ─── Inline editable field ─────────────────────────── */
const InlineEdit: React.FC<{ value: string; onChange: (v: string) => void; placeholder?: string }> = ({ value, onChange, placeholder }) => (
  <Input size="small" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder ?? '—'}
    variant="borderless"
    style={{ padding: 0, fontSize: 13, color: value ? C.text : C.textLight, width: '100%' }} />
);

/* ─── Section header inside card ────────────────────── */
const SectionHead: React.FC<{ title: string; icon?: React.ReactNode; color?: string }> = ({ title, icon, color = C.blue }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, paddingBottom: 8, borderBottom: `2px solid ${color}` }}>
    {icon && <span style={{ color, fontSize: 14 }}>{icon}</span>}
    <Text strong style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em', color: C.textMid }}>{title}</Text>
  </div>
);

/* ─── Test defaults (change here to switch environment) ─ */
const PO_DEFAULTS = {
  procurementBU:  'MITSUMI DISTRIBUTION FZCO',
  billTo:         'MITSUMI DISTRIBUTION FZCO',
  docType:        'LPON',
  currency:       'AED',
  shipToOrg:      'AMS',
  subinventory:   'AMB2BAFR',
};

/* ═══════════════════════════════════════════════════════ */
const _rawEAPI = (window as any).electronAPI;
const eAPI = _rawEAPI ? {
  openItemsFolder: typeof _rawEAPI.openItemsFolder === 'function' ? _rawEAPI.openItemsFolder.bind(_rawEAPI) : null,
  sendPoApproval:  typeof _rawEAPI.sendPoApproval  === 'function' ? _rawEAPI.sendPoApproval.bind(_rawEAPI)  : null,
  isElectron:      _rawEAPI.isElectron,
} : null;

// Item master cache via localStorage (works in both browser and Electron)
const ITEM_CACHE_KEY = (org: string) => `po_itemmaster_${org}`;
const saveItemmasterCache = (org: string, items: any[]) => {
  try {
    localStorage.setItem(ITEM_CACHE_KEY(org), JSON.stringify({ items, ts: new Date().toISOString() }));
  } catch { /* quota exceeded — ignore */ }
};
const loadItemmasterCache = (org: string): { items: any[]; ts: string } | null => {
  try {
    const raw = localStorage.getItem(ITEM_CACHE_KEY(org));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.items?.length > 0 ? parsed : null;
  } catch { return null; }
};

const CreatePurchaseOrder: React.FC<{ onExit?: () => void; initialPo?: any; editPoHeaderId?: number }> = ({ onExit, initialPo, editPoHeaderId }) => {
  const navigate = useNavigate();
  const exit = () => onExit ? onExit() : navigate('/procurement/purchase-orders');
  const [headerForm] = Form.useForm();

  // Edit mode: the PO already exists in Fusion (opened from Search Orders for an
  // Incomplete PO). Header + lines (with POLineId) are loaded from Fusion.
  const [editMode, setEditMode]       = useState(!!editPoHeaderId);
  const [editLoading, setEditLoading] = useState(false);
  const [savingEdit, setSavingEdit]   = useState(false);
  const [editJsonOpen, setEditJsonOpen] = useState(false);

  // When opened with a loaded PO snapshot or in edit mode, skip the "New Purchase Order" dialog.
  const [showInitModal, setShowInitModal] = useState(!initialPo && !editPoHeaderId);
  const [header, setHeader] = useState<POHeader | null>(null);
  const [lines, setLines] = useState<POLine[]>([]);
  const [defaultTaxPct, setDefaultTaxPct] = useState(0);
  const [needByAll, setNeedByAll] = useState<Dayjs | null>(null);
  const [addItemOpen, setAddItemOpen] = useState(false);
  const [addItemApiUrl, setAddItemApiUrl] = useState('');
  const [addItemTab, setAddItemTab] = useState<'browse' | 'import'>('browse');
  const [pastedRows, setPastedRows] = useState<PastedItem[]>([]);
  const [pasteText, setPasteText] = useState('');
  const [importValidating, setImportValidating] = useState(false);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);

  const [busUnits, setBusUnits] = useState<any[]>([]);
  const [selectedBuCompanyCode, setSelectedBuCompanyCode] = useState('');
  const [selectedBuBaseCurrency, setSelectedBuBaseCurrency] = useState('');
  const [currencies, setCurrencies] = useState<any[]>([]);
  const [currencyInput, setCurrencyInput] = useState('');
  const [fxRate, setFxRate] = useState<{ rate: number; inverseRate: number; rateDate: string; rateType: string } | null>(null);
  const [fxRateLoading, setFxRateLoading] = useState(false);
  const [inventoryOrgs, setInventoryOrgs] = useState<any[]>([]);
  const [filteredInventoryOrgs, setFilteredInventoryOrgs] = useState<any[]>([]);
  const [subinventories, setSubinventories] = useState<any[]>([]);
  const [allSubinventories, setAllSubinventories] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemCacheTs, setItemCacheTs] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');
  const [itemSearchType, setItemSearchType] = useState<'number' | 'description'>('number');
  const [itemSearchLoading, setItemSearchLoading] = useState(false);
  const [selectedItemKeys, setSelectedItemKeys] = useState<string[]>([]);
  const [lovLoading, setLovLoading] = useState(false);
  const [sitesLoading, setSitesLoading] = useState(false);
  const [initConfirmLoading, setInitConfirmLoading] = useState(false);

  // QOH (per-line)
  const [qohData, setQohData] = useState<Record<string, any>>({});
  const [qohLoading, setQohLoading] = useState(false);
  const [qohProgress, setQohProgress] = useState({ done: 0, total: 0 });

  // Org QOH
  const [orgQohRows, setOrgQohRows] = useState<any[]>([]);
  const [orgQohLoading, setOrgQohLoading] = useState(false);
  const [orgQohFetched, setOrgQohFetched] = useState(false);
  const [orgQohFilter, setOrgQohFilter] = useState('');
  const [orgQohApiUrl, setOrgQohApiUrl] = useState('');
  const [orgQohApiModalOpen, setOrgQohApiModalOpen] = useState(false);

  // Acquisition Cost
  const [acqCharges, setAcqCharges] = useState<AcqCharge[]>([]);
  const [acqFxRates, setAcqFxRates] = useState<Record<string, { rate: number; rateDate: string; rateType: string }>>({});
  const [acqFxLoading, setAcqFxLoading] = useState<Record<string, boolean>>({});
  const [acqViewAccounted, setAcqViewAccounted] = useState(false);

  const [supplierModalOpen, setSupplierModalOpen] = useState(false);
  const [supplierSearch, setSupplierSearch] = useState('');
  const [supplierSearchBy, setSupplierSearchBy] = useState<'name' | 'number'>('name');
  const [supplierResults, setSupplierResults] = useState<any[]>([]);
  const [suppliersLoading, setSuppliersLoading] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState<any>(null);
  const [supplierSites, setSupplierSites] = useState<any[]>([]);
  const [supplierApiUrl, setSupplierApiUrl] = useState('');
  const [supplierApiModalOpen, setSupplierApiModalOpen] = useState(false);

  // Fusion draft PO create
  const [fusionModalOpen, setFusionModalOpen]             = useState(false);
  const [fusionPreparedBody, setFusionPreparedBody]       = useState<Record<string, any> | null>(null);
  const [fusionPostLoading, setFusionPostLoading]         = useState(false);
  const [fusionTestLoading, setFusionTestLoading]         = useState(false);
  const [fusionPostResult, setFusionPostResult]           = useState<{
    success: boolean; status: number; data: any; rawText: string; networkError?: string;
  } | null>(null);

  // Next PO Number fetch
  const [nextPoLoading, setNextPoLoading] = useState(false);

  // Generate PO (direct submit to Fusion)
  const [generatePoLoading, setGeneratePoLoading]     = useState(false);
  const [generatePoSuccess, setGeneratePoSuccess]     = useState<{ orderNumber: string; status: string } | null>(null);
  const [generatePoModalOpen, setGeneratePoModalOpen] = useState(false);
  const [poHeaderId, setPoHeaderId]                   = useState<number | null>(null);
  const [approvingFusion, setApprovingFusion]         = useState(false);
  const [poActionLoading, setPoActionLoading]         = useState<string | null>(null);
  const [customActionOpen, setCustomActionOpen]       = useState(false);
  const [customActionName, setCustomActionName]       = useState('');
  const [customActionResource, setCustomActionResource] = useState('purchaseOrders');
  const [confettiPieces, setConfettiPieces]           = useState<{ id: number; x: number; color: string; delay: number; size: number }[]>([]);

  // Init modal API inspector
  const [initApiOpen, setInitApiOpen] = useState(false);

  // Approval
  const [approvalOpen, setApprovalOpen]     = useState(false);
  const [approverEmail, setApproverEmail]   = useState('');
  const [approvalCc, setApprovalCc]         = useState('');
  const [approvalNote, setApprovalNote]     = useState('');
  const [approvalSending, setApprovalSending] = useState(false);

  // Load LOVs when the init modal opens, or when opened via a loaded JSON PO
  // (which skips the init modal) — the detail page still needs the org list etc.
  useEffect(() => { if (showInitModal || initialPo || editPoHeaderId) loadInitLOVs(); }, [showInitModal]);

  const loadInitLOVs = async () => {
    setLovLoading(true);
    try {
      const [buRes, ccyRes, orgRes, subRes] = await Promise.allSettled([
        fetch(`${FUSION_BASE}/payablesOptions?onlyData=true&limit=500&fields=businessUnitId,businessUnitName,paymentCurrency,ledgerCurrency`, { headers: FUSION_HDRS })
          .then(r => r.json())
          .then(d => {
            // Deduplicate business units by name and map to expected format
            const seen = new Set<string>();
            return (d.items ?? [])
              .filter((b: any) => {
                const n = b.businessUnitName;
                if (!n || seen.has(n)) return false;
                seen.add(n);
                return true;
              })
              .map((b: any) => ({
                bu_name: b.businessUnitName,
                bu_id: b.businessUnitId,
                BusinessUnitName: b.businessUnitName,
                BusinessUnitId: b.businessUnitId,
                functional_currency: b.paymentCurrency,
                paymentCurrency: b.paymentCurrency,
                ledgerCurrency: b.ledgerCurrency,
              }));
          }),
        fetch(`${buildCurrencyUrl('currencies')}`).then(r => r.json()).then(d => d.items ?? d.data ?? (Array.isArray(d) ? d : [])),
        fetch(`${FUSION_BASE}/inventoryOrganizations?onlyData=true&limit=500`, { headers: FUSION_HDRS }).then(r => r.ok ? r.json() : Promise.reject()).then(d => d.items ?? []),
      ]);
      if (buRes.status === 'fulfilled') {
        setBusUnits(buRes.value);
        // Don't set defaults — let user select
      }
      if (ccyRes.status === 'fulfilled') setCurrencies(ccyRes.value);
      if (orgRes.status === 'fulfilled') setInventoryOrgs(orgRes.value);
    } finally { setLovLoading(false); }
  };

  const handleProcurementBuChange = (buName: string) => {
    const bu = busUnits.find((b: any) => (b.bu_name ?? b.BusinessUnitName ?? '') === buName);
    if (bu) {
      // Auto-populate Bill To BU with same value as Procurement BU
      headerForm.setFieldValue('billTo', buName);
      // Auto-populate currency from ledgerCurrency of the selected Business Unit
      const buCurrency = bu.ledgerCurrency || bu.functional_currency;
      if (buCurrency) {
        headerForm.setFieldValue('currency', buCurrency);
        console.log('Procurement BU Changed:', { buName, buCurrency, buData: { ledgerCurrency: bu.ledgerCurrency, functional_currency: bu.functional_currency } });
      } else {
        console.warn('No currency found for BU:', { buName, buData: bu });
      }
      setSelectedBuCompanyCode(bu.bu_id ? String(bu.bu_id) : '');
      setSelectedBuBaseCurrency(bu.ledgerCurrency || bu.functional_currency || '');

      // Filter inventory orgs based on the selected BU (BusinessUnitId or BusinessUnitName)
      if (inventoryOrgs.length > 0) {
        const buId = bu.businessUnitId || bu.bu_id;
        const buNameFromBU = bu.bu_name || bu.BusinessUnitName;

        const filtered = inventoryOrgs.filter((org: any) => {
          const orgBUId = org.BusinessUnitId || org.ManagementBusinessUnitId || org.ProfitCenterBusinessUnitId;
          const orgBUName = org.BusinessUnitName || org.ManagementBusinessUnitName || org.ProfitCenterBusinessUnitName;

          // Match by BU ID or BU Name
          return (buId != null && String(orgBUId) === String(buId)) ||
                 (buNameFromBU && orgBUName && orgBUName === buNameFromBU);
        });

        setFilteredInventoryOrgs(filtered.length > 0 ? filtered : inventoryOrgs);
      } else {
        setFilteredInventoryOrgs(inventoryOrgs);
      }

      // Clear shipToOrg and subinventory when BU changes
      headerForm.setFieldValue('shipToOrg', undefined);
      headerForm.setFieldValue('subinventory', undefined);
      setSubinventories([]);
    } else {
      setSelectedBuCompanyCode('');
      setFilteredInventoryOrgs([]);
    }
  };

  const fetchFxRate = async (currency: string) => {
    if (!currency || currency === 'AED') { setFxRate(null); return; }
    setFxRateLoading(true);
    try {
      // Get the most recent rate for this currency → AED
      const params = new URLSearchParams({ from_currency: currency, to_currency: 'AED' });
      const res = await fetch(`${buildCurrencyUrl('currencies/dailyrates')}?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = (await res.text()).replace(/:\s*(-?)\.(\d)/g, ': $10.$2');
      const json = JSON.parse(raw);
      const items: any[] = json.items ?? json.data ?? (Array.isArray(json) ? json : []);
      if (items.length === 0) { setFxRate(null); return; }
      // Pick the most recent date
      const latest = items.reduce((a: any, b: any) =>
        (a.rateDate ?? a.rate_date ?? '') > (b.rateDate ?? b.rate_date ?? '') ? a : b
      );
      setFxRate({
        rate:        Number(latest.rate        ?? latest.RATE        ?? 0),
        inverseRate: Number(latest.inverseRate ?? latest.inverse_rate ?? latest.INVERSE_RATE ?? 0),
        rateDate:    String(latest.rateDate    ?? latest.rate_date   ?? latest.RATE_DATE     ?? ''),
        rateType:    String(latest.rateType    ?? latest.rate_type   ?? latest.RATE_TYPE     ?? ''),
      });
    } catch { setFxRate(null); } finally { setFxRateLoading(false); }
  };

  const handleSupplierSearch = useCallback(async (term: string, by: 'name' | 'number' = 'name') => {
    if (!term || term.length < 2) return;
    // Search by supplier name (Supplier) or supplier number (SupplierNumber).
    const attr = by === 'number' ? 'SupplierNumber' : 'Supplier';
    const url = `${FUSION_BASE}/suppliers?q=${attr} LIKE '*${term}*'&limit=20`;
    setSupplierApiUrl(url);
    setSuppliersLoading(true);
    try {
      const r = await fetch(url, { headers: FUSION_HDRS });
      const d = await r.json();
      setSupplierResults(d.items ?? []);
    } catch { /* ignore */ } finally { setSuppliersLoading(false); }
  }, []);

  const loadSupplierSites = async (supplierId: string) => {
    headerForm.setFieldValue('supplierSite', undefined);
    setSupplierSites([]);
    if (!supplierId) return;
    setSitesLoading(true);
    try {
      const r = await fetch(`${FUSION_BASE}/suppliers/${supplierId}/child/sites?limit=100`, { headers: FUSION_HDRS });
      const d = await r.json();
      setSupplierSites(d.items ?? []);
    } catch { /* ignore */ } finally { setSitesLoading(false); }
  };

  const handleSelectSupplier = async (supplier: any) => {
    setSelectedSupplier(supplier);
    setSupplierModalOpen(false);
    // update header if PO already created (inline edit mode)
    if (header) {
      patch({ supplierId: String(supplier.SupplierId), supplierName: supplier.Supplier ?? '', supplierSite: '' });
    }
    await loadSupplierSites(String(supplier.SupplierId));
  };

  const handleShipToOrgChange = (orgCode: string) => {
    headerForm.setFieldValue('subinventory', undefined);
    setSubinventories([]);

    if (!orgCode) return;

    // Fetch subinventories for the selected organization from Fusion API
    fetch(`${FUSION_BASE}/subinventories?q=OrganizationCode=${encodeURIComponent(orgCode)}&onlyData=true&limit=500`, { headers: FUSION_HDRS })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => {
        const subs = Array.from(new Set((d.items ?? []).map((s: any) => s.SecondaryInventoryName).filter(Boolean))).sort() as string[];
        setSubinventories(subs.map(sub => ({ subinventory_code: sub, subinventory_name: sub })));
      })
      .catch(() => setSubinventories([]));
  };

  // Initialize filtered inventory orgs when inventoryOrgs are loaded
  useEffect(() => {
    if (inventoryOrgs.length > 0) {
      setFilteredInventoryOrgs(inventoryOrgs);
    }
  }, [inventoryOrgs]);

  // Keep the subinventory dropdown populated for the current ship-to org — needed
  // after loading a PO from JSON (header is set before/without the org's subinv
  // list being filtered, and the load may run before the LOVs finish fetching),
  // so the restored header.subinventory renders and saves back correctly.
  useEffect(() => {
    if (header?.shipToOrg && allSubinventories.length) {
      setSubinventories(allSubinventories.filter((s: any) => s.warehouse_code === header.shipToOrg));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allSubinventories, header?.shipToOrg]);

  const handleInitSubmit = async () => {
    if (!selectedSupplier) { message.error('Please select a supplier'); return; }
    setInitConfirmLoading(true);
    try {
      const v = await headerForm.validateFields();
      setHeader({
        poNumber: v.poNumber?.trim() || generatePONumber(v.docType),
        docType: v.docType, orderDate: v.orderDate,
        status: 'Incomplete', buyer: 'emp, arun',
        procurementBU: v.procurementBU, requisitioningBU: v.procurementBU, billToBU: v.billTo,
        currency: v.currency, description: '',
        supplierId: String(selectedSupplier.SupplierId), supplierName: selectedSupplier.Supplier ?? '',
        supplierSite: v.supplierSite ?? '', supplierContact: '',
        communicationMethod: 'E-Mail', communicationEmail: '',
        billToLocation: v.procurementBU, shipToLocation: v.shipToOrg,
        shipToOrg: v.shipToOrg, subinventory: v.subinventory ?? '',
        paymentTerms: '', shippingMethod: '', freightTerms: '', fob: '',
        payOnReceipt: false, confirmingOrder: false,
        noteToSupplier: v.noteToSupplier ?? '', noteToReceiver: '',
      });
      setShowInitModal(false);
    } catch { /* validation */ } finally { setInitConfirmLoading(false); }
  };

  const fetchNextPoNumber = async (applyToHeader = false) => {
    const docType: string = applyToHeader
      ? (header?.docType ?? '')
      : headerForm.getFieldValue('docType');
    if (!docType) { message.warning('Select a Document Type first'); return; }
    setNextPoLoading(true);
    try {
      const q = `OrderNumber LIKE '${docType}%'`;
      const url = `${FUSION_BASE}/purchaseOrders?q=${encodeURIComponent(q)}&orderBy=CreationDate:desc&limit=1`;
      const r = await fetch(url, { headers: FUSION_HDRS });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      const items: any[] = d.items ?? [];
      let nextNum: string;
      if (items.length === 0) {
        nextNum = `${docType}1000`;
        message.success(`No existing ${docType} orders — assigned ${nextNum}`);
      } else {
        const latest: string = items[0].OrderNumber;
        const match = latest.match(/^(.+?)(\d+)$/);
        if (match) {
          const numStr = match[2];
          const next = String(parseInt(numStr, 10) + 1).padStart(numStr.length, '0');
          nextNum = `${match[1]}${next}`;
          message.success(`Next: ${nextNum}  (last was ${latest})`);
        } else {
          message.warning(`Could not parse "${latest}" — please enter manually`);
          return;
        }
      }
      if (applyToHeader) {
        patch({ poNumber: nextNum });
      } else {
        headerForm.setFieldValue('poNumber', nextNum);
      }
    } catch (e: any) {
      message.error(`Failed to fetch: ${e.message}`);
    } finally {
      setNextPoLoading(false);
    }
  };

  const patch = (p: Partial<POHeader>) => setHeader(prev => prev ? { ...prev, ...p } : prev);

  const queryQOH = async () => {
    if (!header || lines.length === 0) return;
    setQohLoading(true);
    setQohData({});
    setQohProgress({ done: 0, total: lines.length });
    const result: Record<string, any> = {};
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      try {
        // Same format as ManageOnhandInventory — no quotes around values
        const qParts = [`OrganizationCode=${header.shipToOrg}`, `ItemNumber=${line.itemNumber}`];
        if (header.subinventory) qParts.push(`SubinventoryCode=${header.subinventory}`);
        const urlParams = new URLSearchParams({ q: qParts.join(';'), limit: '50' });
        const url = `${FUSION_BASE}/inventoryOnhandBalances?${urlParams}`;
        const r = await fetch(url, { headers: FUSION_HDRS });
        const d = await r.json();
        const items: any[] = d.items ?? [];
        // PrimaryQuantity is the correct field name (verified from ManageOnhandInventory)
        const onhand = items.reduce((s: number, it: any) =>
          s + (parseFloat(it.PrimaryQuantity ?? it.PrimaryOnhandQuantity ?? it.OnhandQuantity ?? 0) || 0), 0);
        result[line.itemNumber] = { onhand, items, url };
      } catch {
        result[line.itemNumber] = { onhand: null, items: [], error: true };
      }
      setQohProgress({ done: i + 1, total: lines.length });
      setQohData({ ...result });
    }
    setQohLoading(false);
  };

  const queryOrgQOH = async () => {
    if (!header?.shipToOrg) { message.warning('Set Ship-to Organization first'); return; }
    setOrgQohLoading(true);
    setOrgQohFetched(false);
    setOrgQohRows([]);
    try {
      // Same format as ManageOnhandInventory — no quotes around values
      const qParts = [`OrganizationCode=${header.shipToOrg}`];
      if (header.subinventory) qParts.push(`SubinventoryCode=${header.subinventory}`);
      const params = new URLSearchParams({ q: qParts.join(';'), limit: '500', totalResults: 'true' });
      const baseUrl = `${FUSION_BASE}/inventoryOnhandBalances?${params}`;
      setOrgQohApiUrl(baseUrl);
      const rows = await fetchLOV(baseUrl);
      setOrgQohRows(rows);
      setOrgQohFetched(true);
    } catch {
      message.error('Failed to fetch org on-hand balances');
    } finally {
      setOrgQohLoading(false);
    }
  };

  const handleNeedByAllChange = (date: Dayjs | null) => {
    setNeedByAll(date);
    setLines(prev => prev.map(l => computeLine({ ...l, needBy: date })));
  };

  const handleLineChange = (key: string, field: keyof POLine, value: any) =>
    setLines(prev => prev.map(l => l.key !== key ? l : computeLine({ ...l, [field]: value })));

  const removeLineLocal = (key: string) =>
    setLines(prev => prev.filter(l => l.key !== key).map((l, i) => ({ ...l, lineNum: i + 1 })));

  // Clear lines that were added locally but not yet saved to Fusion (no POLineId).
  // Saved/Fusion lines are left in place.
  const clearUnsavedLines = () => {
    const unsaved = lines.filter(l => l.poLineId == null);
    if (unsaved.length === 0) { message.info('No unsaved lines to clear.'); return; }
    Modal.confirm({
      title: `Clear ${unsaved.length} unsaved line(s)?`,
      okText: 'Clear unsaved', okButtonProps: { danger: true },
      content: 'Removes lines that were added but not yet saved to Fusion. Lines already saved in Fusion are kept.',
      onOk: () => setLines(prev => prev.filter(l => l.poLineId != null).map((l, i) => ({ ...l, lineNum: i + 1 }))),
    });
  };

  const handleDeleteLine = (key: string) => {
    const line = lines.find(l => l.key === key);
    // Edit mode + the line exists in Fusion → DELETE it from Fusion (confirm first).
    if (editMode && line?.poLineId != null && poHeaderId) {
      Modal.confirm({
        title: `Delete line ${line.lineNum} from Fusion?`,
        width: 560,
        okText: 'Delete from Fusion', okButtonProps: { danger: true },
        content: (
          <div style={{ fontSize: 12 }}>
            <p>This permanently removes item <b>{line.itemNumber}</b> (POLineId {line.poLineId}) from PO {header?.poNumber} in Oracle Fusion.</p>
            <pre style={{ fontSize: 11, background: '#f5f5f5', padding: 8, borderRadius: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
{`DELETE ${FUSION_BASE}/draftPurchaseOrders/${poHeaderId}/child/lines/${line.poLineId}`}
            </pre>
          </div>
        ),
        onOk: async () => {
          try {
            const r = await fetch(`${FUSION_BASE}/draftPurchaseOrders/${poHeaderId}/child/lines/${line.poLineId}`, { method: 'DELETE', headers: FUSION_HDRS });
            if (!r.ok && r.status !== 204) {
              const t = await r.text();
              Modal.error({ title: 'Delete line failed', width: 620, content: <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 260, overflow: 'auto' }}>{t}</pre> });
              return;
            }
            removeLineLocal(key);
            message.success(`Line ${line.lineNum} deleted from Fusion`);
          } catch (e: any) {
            Modal.error({ title: 'Delete line — network error', content: e.message });
          }
        },
      });
      return;
    }
    removeLineLocal(key);
  };

  /* ─── Assign PO line items to an inventory org (itemsV2) ─────────────
     POSTs the item into the target org, which is how Fusion records an
     item ↔ inventory-org assignment. Status is tracked per line. */
  const [bulkAssignOrg, setBulkAssignOrg] = useState<string | undefined>();
  const [bulkAssigning, setBulkAssigning] = useState(false);
  const [assignApiOpen, setAssignApiOpen]     = useState(false);
  const [assignApiLoading, setAssignApiLoading] = useState(false);
  const [assignApiTitle, setAssignApiTitle]   = useState('');
  const [assignApiBody, setAssignApiBody]     = useState<any>(null);
  const [assignApiMaster, setAssignApiMaster] = useState<any>(null);
  const [assignApiUpdate, setAssignApiUpdate] = useState(false);
  const [assignApiHref, setAssignApiHref]     = useState('');
  // Item detail dialog (click an item number in the lines table)
  const [itemDetailOpen, setItemDetailOpen]       = useState(false);
  const [itemDetailLoading, setItemDetailLoading] = useState(false);
  const [itemDetailNumber, setItemDetailNumber]   = useState('');
  const [itemDetailRows, setItemDetailRows]       = useState<any[]>([]);
  const [itemDetailErr, setItemDetailErr]         = useState('');
  const [itemDetailApiUrl, setItemDetailApiUrl]   = useState('');

  const showItemDetail = async (itemNumber: string) => {
    setItemDetailNumber(itemNumber);
    setItemDetailOpen(true);
    setItemDetailLoading(true);
    setItemDetailRows([]); setItemDetailErr('');
    try {
      // Scope the item to the header's Ship-to Organization so the shown
      // attributes are the org-specific definition, not the item master (AMS).
      const org = header?.shipToOrg;
      const q = `ItemNumber='${itemNumber}'${org ? `;OrganizationCode=${org}` : ''}`;
      const url = `${FUSION_BASE}/itemsV2?q=${encodeURIComponent(q)}&limit=50&onlyData=true`;
      setItemDetailApiUrl(`GET itemsV2?q=${q}`);
      const r = await fetch(url, { headers: FUSION_HDRS });
      const d = await r.json().catch(() => ({} as any));
      if (!r.ok) throw new Error(d?.detail ?? d?.message ?? `HTTP ${r.status}`);
      const items: any[] = d.items ?? [];
      setItemDetailRows(items);
      if (items.length === 0) setItemDetailErr(org ? `No item found for organization ${org}.` : 'No item found in the item master.');
    } catch (e: any) {
      setItemDetailErr(e?.message || 'Failed to load item details');
    } finally {
      setItemDetailLoading(false);
    }
  };

  const patchLine = (key: string, patch: Partial<POLine>) =>
    setLines(prev => prev.map(l => l.key === key ? { ...l, ...patch } : l));

  // Master-org item attributes to copy onto the child-org assignment. Sales
  // Account is the headline; the rest are safe org-level attributes/flags.
  const COPY_ITEM_ATTRS = [
    'SalesAccountId', 'SalesAccountValue', 'CostOfSaleAccountId', 'CostOfSaleAccountValue',
    'ExpenseAccountId', 'ExpenseAccountValue', 'EncumbranceAccountId', 'EncumbranceAccountValue',
    'ItemClass', 'PrimaryUOMValue', 'ItemStatusValue', 'LifecyclePhaseValue',
    'InventoryItemFlag', 'StockEnabledFlag', 'TransactionEnabledFlag', 'ReservableFlag',
    'PurchasingItemFlag', 'PurchasableFlag', 'CustomerOrderEnabledFlag', 'CustomerOrderFlag',
    'InternalOrderEnabledFlag', 'InternalOrderFlag', 'ShippableItemFlag', 'InvoiceEnabledFlag',
    'InvoicedFlag', 'InventoryAssetFlag', 'CostingEnabledFlag', 'IncludeInRollupFlag',
    'ListPrice', 'MarketPrice', 'UnitWeight', 'UnitVolume', 'AllowSubstituteReceiptsFlag',
  ];

  // Read the item's master definition (the row that carries the Sales Account).
  const fetchMasterItem = async (itemNumber: string): Promise<Record<string, any> | null> => {
    try {
      const url = `${FUSION_BASE}/itemsV2?q=ItemNumber='${encodeURIComponent(itemNumber)}'&limit=50&onlyData=true`;
      const r = await fetch(url, { headers: FUSION_HDRS });
      if (!r.ok) return null;
      const d = await r.json().catch(() => ({} as any));
      const items: any[] = d.items ?? [];
      if (items.length === 0) return null;
      // Prefer the AMS master row that carries the Sales Account (Value or Id).
      return items.find(i => i.SalesAccountValue != null && i.SalesAccountValue !== '')
        ?? items.find(i => i.SalesAccountId != null)
        ?? items.find(i => i.OrganizationCode === 'AMS')
        ?? items[0];
    } catch { return null; }
  };

  // Build the itemsV2 assignment body for a line, copying master-org attributes.
  const buildAssignBody = (org: string, line: POLine, master: Record<string, any> | null): Record<string, any> => {
    const copied: Record<string, any> = {};
    if (master) COPY_ITEM_ATTRS.forEach(a => { if (master[a] != null && master[a] !== '') copied[a] = master[a]; });
    return {
      OrganizationCode: org,
      ItemNumber: line.itemNumber,
      ItemDescription: master?.ItemDescription || line.description || line.itemNumber,
      ItemClass: master?.ItemClass || 'Root Item Class',
      ...copied,
    };
  };

  // Show the exact itemsV2 URL + JSON payload (POST to assign, or PATCH to update).
  const previewAssign = async (line: POLine) => {
    const org = line.assignOrg;
    if (!org) { message.warning(`Pick an inventory org for ${line.itemNumber} first`); return; }
    setAssignApiTitle(`${line.itemNumber} → ${org}`);
    setAssignApiOpen(true);
    setAssignApiLoading(true);
    setAssignApiBody(null); setAssignApiMaster(null); setAssignApiUpdate(false); setAssignApiHref('');
    const master = await fetchMasterItem(line.itemNumber);
    setAssignApiMaster(master);
    // Already assigned → PATCH /itemsV2/{UniqID} with attributes only; new → POST.
    const selfHref = await getItemSelfHref(line.itemNumber, org);
    if (selfHref) {
      const copied: Record<string, any> = {};
      if (master) COPY_ITEM_ATTRS.forEach(a => { if (master[a] != null && master[a] !== '') copied[a] = master[a]; });
      setAssignApiUpdate(true); setAssignApiHref(selfHref); setAssignApiBody(copied);
    } else {
      setAssignApiBody(buildAssignBody(org, line, master));
    }
    setAssignApiLoading(false);
  };

  // Self link of an item's org row (present when already assigned) — used to
  // PATCH attribute updates, since itemsV2 POST only creates the assignment.
  const getItemSelfHref = async (itemNumber: string, org: string): Promise<string | null> => {
    try {
      const url = `${FUSION_BASE}/itemsV2?q=ItemNumber='${itemNumber}';OrganizationCode=${org}&limit=1`;
      const r = await fetch(url, { headers: FUSION_HDRS });
      if (!r.ok) return null;
      const d = await r.json().catch(() => ({} as any));
      const row = d.items?.[0];
      return row?.links?.find((l: any) => l.rel === 'self')?.href ?? null;
    } catch { return null; }
  };

  const assignItemToOrg = async (line: POLine): Promise<boolean> => {
    const org = line.assignOrg;
    if (!org) { message.warning(`Pick an inventory org for ${line.itemNumber} first`); return false; }
    if (!line.itemNumber) { message.warning('Line has no item number'); return false; }
    patchLine(line.key, { assignStatus: 'pending', assignMsg: 'Reading master item…' });

    // Pull the master-org attributes (incl. Sales Account) to carry to the child org.
    const master = await fetchMasterItem(line.itemNumber);
    const copied: Record<string, any> = {};
    if (master) COPY_ITEM_ATTRS.forEach(a => { if (master[a] != null && master[a] !== '') copied[a] = master[a]; });

    // Already assigned → PATCH the item row (Update one item /itemsV2/{UniqID});
    // new → POST to assign. If PATCH is rejected (InvalidOperationUpdate…), fall
    // back to the Upsert-Mode POST which also creates-or-updates.
    patchLine(line.key, { assignStatus: 'pending', assignMsg: 'Checking existing assignment…' });
    const selfHref = await getItemSelfHref(line.itemNumber, org);
    const isUpdate = !!selfHref;
    if (isUpdate && Object.keys(copied).length === 0) {
      patchLine(line.key, { assignStatus: 'success', assignMsg: `Already in ${org} — no master attributes to update` });
      message.info(`Item ${line.itemNumber} is already assigned to ${org}; nothing to update`);
      return true;
    }
    const errOf = (data: any, r: Response) => data?.detail || data?.message || (Array.isArray(data?.['o:errorDetails']) ? data['o:errorDetails'][0]?.detail : '') || `HTTP ${r.status}`;
    const doPatch = () => fetch(selfHref!, { method: 'PATCH', headers: { ...FUSION_HDRS, 'Content-Type': 'application/json' }, body: JSON.stringify(copied) });
    const doUpsert = () => fetch(`${FUSION_BASE}/itemsV2`, { method: 'POST', headers: { ...FUSION_HDRS, 'Content-Type': 'application/json', 'Upsert-Mode': 'true' }, body: JSON.stringify(buildAssignBody(org, line, master)) });
    const doPost = () => fetch(`${FUSION_BASE}/itemsV2`, { method: 'POST', headers: { ...FUSION_HDRS, 'Content-Type': 'application/json' }, body: JSON.stringify(buildAssignBody(org, line, master)) });
    try {
      let r = await (isUpdate ? doPatch() : doPost());
      let data = await r.json().catch(() => ({} as any));
      // PATCH rejected as an invalid update? retry once via Upsert-Mode POST.
      if (!r.ok && isUpdate && /InvalidOperationUpdate/i.test(JSON.stringify(data))) {
        patchLine(line.key, { assignStatus: 'pending', assignMsg: 'PATCH rejected — retrying via Upsert-Mode…' });
        r = await doUpsert(); data = await r.json().catch(() => ({} as any));
      }
      if (!r.ok) {
        const msg = errOf(data, r);
        patchLine(line.key, { assignStatus: 'error', assignMsg: String(msg) });
        message.error(`${isUpdate ? 'Update' : 'Assign'} ${line.itemNumber} → ${org} failed: ${msg}`, 6);
        return false;
      }
      const sa = copied.SalesAccountValue ?? copied.SalesAccountId;
      const salesAcct = sa != null ? ` (Sales Acct ${sa})` : '';
      const verb = isUpdate ? 'Updated' : 'Assigned';
      patchLine(line.key, { assignStatus: 'success', assignMsg: `${verb} ${org}${salesAcct}` });
      message.success(`Item ${line.itemNumber} ${isUpdate ? 'updated in' : 'assigned to'} ${org}${master ? ` with ${Object.keys(copied).length} master attribute(s)` : ''}`);
      return true;
    } catch (e: any) {
      patchLine(line.key, { assignStatus: 'error', assignMsg: e.message });
      message.error(`${isUpdate ? 'Update' : 'Assign'} ${line.itemNumber} failed: ${e.message}`, 6);
      return false;
    }
  };

  const assignAllToOrg = async () => {
    if (!bulkAssignOrg) { message.warning('Pick an inventory org to assign all lines to'); return; }
    if (lines.length === 0) return;
    setBulkAssigning(true);
    setLines(prev => prev.map(l => ({ ...l, assignOrg: bulkAssignOrg })));
    let ok = 0;
    for (const l of lines) {
      const success = await assignItemToOrg({ ...l, assignOrg: bulkAssignOrg });
      if (success) ok += 1;
    }
    setBulkAssigning(false);
    message.info(`Assigned ${ok}/${lines.length} item(s) to ${bulkAssignOrg}`);
  };

  /* ─── PO number inline edit ─────────────────────────── */
  const [editingPoNum, setEditingPoNum] = useState(false);
  const [poNumDraft, setPoNumDraft]     = useState('');

  const startEditPoNum = () => { setPoNumDraft(header?.poNumber ?? ''); setEditingPoNum(true); };
  const commitPoNum = () => {
    const v = poNumDraft.trim();
    if (!v) { message.warning('Order number cannot be empty'); return; }
    patch({ poNumber: v });
    headerForm.setFieldValue('poNumber', v);
    setEditingPoNum(false);
    message.success(`Order number set to ${v}`);
  };

  /* ─── Save / Load the PO as JSON (header + lines + charges) ───────────
     Same data we push to Fusion, in a re-loadable container. Used both for
     the manual "JSON Actions" menu and the auto-backup on a failed save. */
  const jsonInputRef = useRef<HTMLInputElement>(null);

  const buildPoSnapshot = () => ({
    _reactErp: 'purchase-order',
    version: 1,
    savedAt: new Date().toISOString(),
    header: header ? { ...header, orderDate: header.orderDate ? dayjs(header.orderDate).toISOString() : null } : null,
    lines: lines.map(l => ({
      ...l,
      needBy:       l.needBy ? dayjs(l.needBy).toISOString() : null,
      promisedDate: l.promisedDate ? dayjs(l.promisedDate).toISOString() : null,
    })),
    acqCharges,
  });

  const downloadJson = (obj: any, filename: string) => {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const savePoJson = (reason?: string): string | undefined => {
    if (!header) { message.warning('Nothing to save yet'); return; }
    const stamp = dayjs().format('YYYYMMDD_HHmmss');
    const safe = (header.poNumber || 'PO').replace(/[^\w.-]+/g, '_');
    const name = `PO_${safe}${reason ? '_' + reason : ''}_${stamp}.json`;
    downloadJson(buildPoSnapshot(), name);
    return name;
  };

  const loadPoFromObject = (obj: any) => {
    if (!obj || obj._reactErp !== 'purchase-order' || !obj.header) {
      message.error('Not a valid ReactERP purchase-order JSON file'); return;
    }
    const h = obj.header;
    setHeader({ ...h, orderDate: h.orderDate ? dayjs(h.orderDate) : dayjs() });
    headerForm.setFieldsValue({ poNumber: h.poNumber, docType: h.docType });
    // Foreign currency (≠ functional AED) → auto-fetch the conversion rate so the
    // rate box populates and the order can be validated for a valid rate on save.
    if (h.currency && h.currency !== 'AED') fetchFxRate(h.currency);
    else setFxRate(null);
    const restored = (obj.lines ?? []).map((l: any, i: number) => computeLine({
      ...l,
      lineNum:      l.lineNum ?? i + 1,
      needBy:       l.needBy ? dayjs(l.needBy) : null,
      promisedDate: l.promisedDate ? dayjs(l.promisedDate) : null,
    }));
    setLines(restored);
    setAcqCharges(Array.isArray(obj.acqCharges) ? obj.acqCharges : []);
    setPoHeaderId(null);   // not yet created in Fusion — Save first, then approve
    message.success(`Loaded PO ${h.poNumber ?? ''} — ${restored.length} line(s)`);
  };

  // ── Edit mode: load an existing (Incomplete) PO straight from Fusion ────────
  // GET draftPurchaseOrders/{id}?expand=lines — hydrates header + lines with
  // their POLineId so lines can be PATCHed/DELETEd back in Fusion.
  const loadDraftFromFusion = async (id: number) => {
    setEditMode(true);
    setEditLoading(true);
    try {
      const url = `${FUSION_BASE}/draftPurchaseOrders/${id}`;
      const r = await fetch(url, { headers: FUSION_HDRS });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.title ?? d?.detail ?? `HTTP ${r.status}`);

      const orderNum = d.OrderNumber ?? '';
      setHeader({
        poNumber: orderNum,
        docType: String(orderNum).replace(/\d.*$/, '') || 'STD',
        orderDate: d.CreationDate ? dayjs(d.CreationDate) : dayjs(),
        status: d.DocumentStatus ?? d.StatusCode ?? 'Incomplete',
        buyer: d.Buyer ?? '',
        procurementBU: d.ProcurementBU ?? '', requisitioningBU: d.RequisitioningBU ?? d.ProcurementBU ?? '', billToBU: d.SoldToLegalEntity ?? '',
        currency: d.CurrencyCode ?? 'AED', description: d.Description ?? '',
        supplierId: String(d.SupplierId ?? ''), supplierName: d.Supplier ?? '', supplierSite: d.SupplierSite ?? '',
        supplierContact: '', communicationMethod: 'E-Mail', communicationEmail: d.SupplierEmailAddress ?? '',
        billToLocation: d.BillToLocation ?? '', shipToLocation: d.DefaultShipToLocation ?? '',
        shipToOrg: d.DefaultShipToLocation ?? '', subinventory: '',
        paymentTerms: d.PaymentTerms ?? '', shippingMethod: d.ModeOfTransportCode ?? '', freightTerms: d.FreightTerms ?? '', fob: d.FOB ?? '',
        payOnReceipt: d.PayOnReceiptFlag === 'Y', confirmingOrder: false,
        noteToSupplier: d.NoteToSupplier ?? '', noteToReceiver: '',
      });
      headerForm.setFieldsValue({ poNumber: orderNum, docType: String(orderNum).replace(/\d.*$/, '') || 'STD' });
      setPoHeaderId(Number(d.POHeaderId ?? id));

      // Lines come from the child collection which pages at 25 by default —
      // page through at 500/page until hasMore is false so ALL lines are loaded.
      const rawLines: any[] = [];
      let offset = 0;
      const PAGE = 500;
      for (let guard = 0; guard < 200; guard++) {
        const lr = await fetch(`${FUSION_BASE}/draftPurchaseOrders/${id}/child/lines?expand=schedules&limit=${PAGE}&offset=${offset}`, { headers: FUSION_HDRS });
        const ld = await lr.json();
        if (!lr.ok) throw new Error(ld?.title ?? ld?.detail ?? `HTTP ${lr.status}`);
        const items: any[] = ld?.items ?? [];
        rawLines.push(...items);
        if (!ld?.hasMore || items.length === 0) break;
        offset += items.length;
      }
      const restored = rawLines.map((l, i) => {
        const sch = l.schedules?.items?.[0] ?? (Array.isArray(l.schedules) ? l.schedules[0] : null);
        const needByRaw =
          sch?.RequestedDeliveryDate ?? sch?.RequestedShipDate ?? sch?.PromisedDeliveryDate ?? sch?.NeedByDate ??
          l.RequestedDeliveryDate ?? l.RequestedShipDate ?? l.PromisedDeliveryDate ?? null;
        return computeLine({
          key: `F${l.POLineId ?? i}`,
          poLineId: l.POLineId,
          scheduleId: sch?.LineLocationId ?? sch?.ScheduleId ?? undefined,
          lineNum: l.LineNumber ?? i + 1,
          itemNumber: l.Item ?? l.ItemNumber ?? '', description: l.Description ?? '', uom: l.UOM ?? '',
          qty: Number(l.Quantity ?? 0), price: Number(l.Price ?? l.UnitPrice ?? 0), taxPct: 0,
          needBy: needByRaw ? dayjs(needByRaw) : null, promisedDate: null,
          chargeAccount: '', destinationType: 'Inventory',
        });
      });
      setLines(restored);
      setAcqCharges([]);
      if (d.CurrencyCode && d.CurrencyCode !== 'AED') fetchFxRate(d.CurrencyCode); else setFxRate(null);
      message.success(`Loaded PO ${orderNum} from Fusion — ${restored.length} line(s)`);
    } catch (e: any) {
      Modal.error({ title: 'Failed to load PO from Fusion', content: e.message });
    } finally {
      setEditLoading(false);
    }
  };

  const handleLoadJsonFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try { loadPoFromObject(JSON.parse(String(reader.result))); }
      catch { message.error('Could not parse the selected JSON file'); }
    };
    reader.readAsText(file);
    e.target.value = '';   // allow re-picking the same file
  };

  // Opened from "Load PO from JSON" (hydrate from snapshot) or from Search Orders
  // Edit (hydrate the Incomplete PO straight from Fusion) — skip the setup dialog.
  useEffect(() => {
    if (initialPo) { loadPoFromObject(initialPo); setShowInitModal(false); }
    else if (editPoHeaderId) { loadDraftFromFusion(editPoHeaderId); setShowInitModal(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const subtotal   = lines.reduce((s, l) => s + l.lineTotal, 0);
  const totalTax   = lines.reduce((s, l) => s + l.taxAmount, 0);
  const grandTotal = lines.reduce((s, l) => s + l.netTotal,  0);

  // Get base currency from the selected procurement BU (ledgerCurrency)
  const baseCurrency = React.useMemo(() => {
    if (!header?.procurementBU || !busUnits.length) return 'AED';
    const procBU = busUnits.find(bu => (bu.bu_name ?? bu.BusinessUnitName) === header.procurementBU);
    return procBU?.ledgerCurrency || procBU?.functional_currency || 'AED';
  }, [header?.procurementBU, busUnits]);

  /* ─── Acquisition cost helpers ─────────────────────── */
  const addAcqCharge = () => {
    const key = `acq-${Date.now()}`;
    const currency = header?.currency ?? 'AED';
    setAcqCharges(prev => [...prev, {
      key, chargeType: 'Freight', description: '', amount: 0,
      currency, apportionBasis: 'value', manualAmounts: {},
    }]);
    fetchAcqFxRate(key, currency);
  };

  const fetchAcqFxRate = async (chargeKey: string, currency: string) => {
    if (!currency || currency === baseCurrency) {
      setAcqFxRates(prev => { const r = { ...prev }; delete r[chargeKey]; return r; });
      setAcqFxLoading(prev => { const r = { ...prev }; delete r[chargeKey]; return r; });
      return;
    }
    setAcqFxLoading(prev => ({ ...prev, [chargeKey]: true }));
    try {
      const params = new URLSearchParams({ from_currency: currency, to_currency: baseCurrency });
      const res = await fetch(`${buildCurrencyUrl('currencies/dailyrates')}?${params}`);
      if (!res.ok) return;
      const raw = (await res.text()).replace(/:\s*(-?)\.(\d)/g, ': $10.$2');
      const json = JSON.parse(raw);
      const items: any[] = json.items ?? json.data ?? [];
      if (!items.length) {
        // Mark as fetched (no rate found) — use rate=0 sentinel
        setAcqFxRates(prev => ({ ...prev, [chargeKey]: { rate: 0, rateDate: '', rateType: '' } }));
        return;
      }
      const latest = items.reduce((a: any, b: any) =>
        (a.rateDate ?? a.rate_date ?? '') > (b.rateDate ?? b.rate_date ?? '') ? a : b);
      setAcqFxRates(prev => ({
        ...prev,
        [chargeKey]: {
          rate:     Number(latest.rate     ?? latest.RATE     ?? 0),
          rateDate: String(latest.rateDate ?? latest.rate_date ?? ''),
          rateType: String(latest.rateType ?? latest.rate_type ?? ''),
        },
      }));
    } catch {
      setAcqFxRates(prev => ({ ...prev, [chargeKey]: { rate: 0, rateDate: '', rateType: '' } }));
    } finally {
      setAcqFxLoading(prev => { const r = { ...prev }; delete r[chargeKey]; return r; });
    }
  };

  const getAccounted = (c: AcqCharge): number => {
    if (!c.currency || c.currency === 'AED') return c.amount;
    const rate = acqFxRates[c.key]?.rate ?? 0;
    return rate > 0 ? c.amount * rate : 0;
  };

  const updateAcqCharge = (key: string, field: keyof AcqCharge, value: any) => {
    setAcqCharges(prev => prev.map(c => c.key === key ? { ...c, [field]: value } : c));
    if (field === 'currency') fetchAcqFxRate(key, value as string);
  };

  const deleteAcqCharge = (key: string) =>
    setAcqCharges(prev => prev.filter(c => c.key !== key));

  const updateManualAmount = (chargeKey: string, lineKey: string, amount: number) =>
    setAcqCharges(prev => prev.map(c => c.key === chargeKey
      ? { ...c, manualAmounts: { ...c.manualAmounts, [lineKey]: amount } }
      : c));

  /* ─── Apportion engine (always in AED) ────────────── */
  const totalV = subtotal;
  const totalQ = lines.reduce((s, l) => s + l.qty, 0);
  const acqResults = lines.map(line => {
    const chargeAmounts: Record<string, number> = {};   // AED accounted amounts
    acqCharges.forEach(c => {
      const accounted = getAccounted(c);
      if      (c.apportionBasis === 'manual') chargeAmounts[c.key] = c.manualAmounts[line.key] ?? 0;
      else if (c.apportionBasis === 'equal')  chargeAmounts[c.key] = lines.length > 0 ? accounted / lines.length : 0;
      else if (c.apportionBasis === 'value')  chargeAmounts[c.key] = totalV > 0 ? (line.lineTotal / totalV) * accounted : 0;
      else                                    chargeAmounts[c.key] = totalQ > 0 ? (line.qty      / totalQ) * accounted : 0;
    });
    const totalCharges    = Object.values(chargeAmounts).reduce((s, v) => s + v, 0);
    const landedCost      = line.lineTotal + totalCharges;
    const landedUnitPrice = line.qty > 0 ? landedCost / line.qty : 0;
    const pctChange       = line.price > 0 ? ((landedUnitPrice - line.price) / line.price) * 100 : 0;
    return { ...line, chargeAmounts, totalCharges, landedCost, landedUnitPrice, pctChange };
  });

  // Build one Fusion PO line body (with its schedule + distribution). Used for
  // the whole-PO create and for adding a single line to an existing draft.
  // includeLineNumber=false lets Fusion auto-number when appending to a draft.
  const buildLineBody = (l: POLine, lineNumber?: number): Record<string, any> => {
    const orgObj = inventoryOrgs.find(o => o.OrganizationCode === header?.shipToOrg);
    return {
      LineNumber:  lineNumber ?? l.lineNum,
      LineType:    'Goods',
      Item:        l.itemNumber,
      Description: l.description,
      Quantity:    l.qty,
      Price:       l.price,
      UOM:         l.uom,
      schedules: [{
        ScheduleNumber:                 1,
        Quantity:                       l.qty,
        ShipToLocation:                 header?.shipToOrg,
        ShipToOrganizationCode:         header?.shipToOrg,
        ShipToOrganization:             orgObj?.OrganizationName ?? null,
        ReceiptCloseTolerancePercent:   0,
        InvoiceMatchOptionCode:         'P',
        InvoiceMatchOption:             'Order',
        EarlyReceiptToleranceDays:      0,
        InvoiceCloseTolerancePercent:   0,
        LateReceiptToleranceDays:       0,
        AccrueAtReceiptFlag:            true,
        InspectionRequiredFlag:         true,
        ReceiptRequiredFlag:            false,
        ReceiptRoutingId:               3,
        ReceiptRouting:                 'Direct delivery',
        DestinationTypeCode:            l.destinationType === 'Expense' ? 'EXPENSE' : 'INVENTORY',
        MatchApprovalLevelCode:         '3-Way',
        MatchApprovalLevel:             '3 Way',
        RequestedDeliveryDate:          l.needBy ? l.needBy.format('YYYY-MM-DD') : null,
        distributions: [{
          DistributionNumber:             1,
          DeliverToLocation:              header?.shipToOrg,
          DeliverToLocationCode:          header?.shipToOrg,
          Quantity:                       l.qty,
        }],
      }],
    };
  };

  const buildFusionBody = (): Record<string, any> | null => {
    if (!header) return null;
    // ORDS returns snake_case: bu_name, business_unit_id
    const procBU = busUnits.find(bu => (bu.bu_name ?? bu.BusinessUnitName) === header.procurementBU);
    const reqBU  = busUnits.find(bu => (bu.bu_name ?? bu.BusinessUnitName) === header.requisitioningBU);
    const procBUId = procBU?.business_unit_id ?? procBU?.bu_id ?? procBU?.BusinessUnitId;
    const reqBUId  = reqBU?.business_unit_id  ?? reqBU?.bu_id  ?? reqBU?.BusinessUnitId;
    if (!procBUId) { message.error('Cannot resolve Procurement BU ID. Check that Business Units loaded correctly.'); return null; }
    if (!header.supplierName) { message.error('Supplier is required.'); return null; }

    const currencyObj = currencies.find(c => c.code === header.currency);

    // Conversion rate — only for a foreign currency (base currency is functional).
    // Pulled from the fxRate already shown on the page (rate/type/date).
    const isForeignCcy = !!header.currency && header.currency !== baseCurrency;
    const useFx = isForeignCcy && fxRate && fxRate.rate > 0;

    return {
      ProcurementBUId:           procBUId,
      OrderNumber:               header.poNumber,
      RequiredAcknowledgment:    'None',
      CurrencyCode:              header.currency,
      Currency:                  currencyObj?.name ?? null,
      ConversionRateTypeCode:    useFx ? (fxRate!.rateType || 'Corporate') : null,
      ConversionRateType:        useFx ? (fxRate!.rateType || 'Corporate') : null,
      ConversionRateDate:        useFx && fxRate!.rateDate ? dayjs(fxRate!.rateDate).format('YYYY-MM-DD') : null,
      ConversionRate:            useFx ? fxRate!.rate : null,
      Buyer:                     header.buyer || null,
      PayOnReceiptFlag:          header.payOnReceipt ? 'Y' : 'N',
      RequisitioningBUId:        reqBUId ?? null,
      Supplier:                  header.supplierName,
      SupplierSite:              header.supplierSite       || null,
      BillToLocation:            header.billToLocation     || null,
      DefaultShipToLocation:     header.shipToLocation     || null,
      ModeOfTransportCode:       header.shippingMethod     || null,
      BuyerManagedTransportFlag: false,
      SupplierEmailAddress:      header.communicationEmail || null,
      lines: lines.map(l => buildLineBody(l)),
    };
  };

  // Next free LineNumber for lines appended to an existing draft (max + 1…).
  const nextLineNumberBase = () =>
    lines.reduce((m, l) => Math.max(m, l.lineNum || 0), 0);

  const handleCreateInFusion = () => {
    const body = buildFusionBody();
    if (!body) return;
    setFusionPreparedBody(body);
    setFusionPostResult(null);
    setFusionModalOpen(true);
  };

  const handleRunFusionPost = async () => {
    if (!fusionPreparedBody) return;
    const fusionUrl = `${FUSION_BASE}/draftPurchaseOrders`;
    setFusionPostLoading(true);
    setFusionPostResult(null);
    try {
      const r = await fetch(fusionUrl, {
        method: 'POST',
        headers: { ...FUSION_HDRS, 'Content-Type': 'application/json' },
        body: JSON.stringify(fusionPreparedBody),
      });
      const rawText = await r.text();
      let data: any = null;
      try { data = JSON.parse(rawText); } catch { data = null; }
      setFusionPostResult({ success: r.ok, status: r.status, data, rawText });
    } catch (err: any) {
      setFusionPostResult({ success: false, status: 0, data: null, rawText: '', networkError: err.message });
    } finally {
      setFusionPostLoading(false);
    }
  };

  const handleTestFusion = async () => {
    const testUrl = `${FUSION_BASE}/draftPurchaseOrders?limit=1`;
    setFusionTestLoading(true);
    try {
      const r = await fetch(testUrl, { headers: FUSION_HDRS });
      const rawText = await r.text();
      let data: any = null;
      try { data = JSON.parse(rawText); } catch { data = null; }
      setFusionPreparedBody(null);
      setFusionPostResult({ success: r.ok, status: r.status, data, rawText });
      setFusionModalOpen(true);
    } catch (err: any) {
      setFusionPreparedBody(null);
      setFusionPostResult({ success: false, status: 0, data: null, rawText: '', networkError: err.message });
      setFusionModalOpen(true);
    } finally {
      setFusionTestLoading(false);
    }
  };

  const validatePOFields = (): string[] => {
    if (!header) return ['No header data found'];
    const errors: string[] = [];
    if (!header.procurementBU)  errors.push('Procurement Organization (BU) is required');
    if (!header.supplierName)   errors.push('Supplier is required');
    if (!header.shipToOrg)      errors.push('Ship-to Organization is required');
    // Subinventory is NOT part of the draftPurchaseOrders payload (it's only used
    // by the separate assign-item-to-org / itemsV2 flow, which guards on it), so
    // it must not block PO generation — e.g. after loading a JSON without one.
    if (!header.buyer)          errors.push('Buyer is required');
    // Foreign currency must have a conversion rate to AED before interfacing to
    // Fusion — if none was found (or still loading), don't allow the save.
    if (header.currency && header.currency !== baseCurrency) {
      if (fxRateLoading) errors.push(`Conversion rate for ${header.currency} → ${baseCurrency} is still loading — try again in a moment`);
      else if (!fxRate || !(fxRate.rate > 0)) errors.push(`Conversion rate for ${header.currency} → ${baseCurrency} is required — none found`);
    }
    if (lines.length === 0)     errors.push('At least one line item is required');
    const linesWithoutNeedBy = lines.filter(l => !l.needBy);
    if (linesWithoutNeedBy.length > 0)
      errors.push(`Need-by date missing on line${linesWithoutNeedBy.length > 1 ? 's' : ''}: ${linesWithoutNeedBy.map(l => l.lineNum).join(', ')}`);
    return errors;
  };


  const handleGeneratePO = async () => {
    if (!header) return;

    const errors = validatePOFields();
    if (errors.length > 0) {
      Modal.error({
        title: 'Cannot Generate Purchase Order',
        content: (
          <ul style={{ paddingLeft: 20, margin: 0 }}>
            {errors.map((e, i) => <li key={i} style={{ marginBottom: 4 }}>{e}</li>)}
          </ul>
        ),
      });
      return;
    }

    const body = buildFusionBody();
    if (!body) return;

    setGeneratePoLoading(true);
    try {
      const r = await fetch(`${FUSION_BASE}/draftPurchaseOrders`, {
        method: 'POST',
        headers: { ...FUSION_HDRS, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const rawText = await r.text();
      let data: any = null;
      try { data = JSON.parse(rawText); } catch { data = null; }

      if (r.ok && data?.OrderNumber) {
        // Launch confetti
        const pieces = Array.from({ length: 60 }, (_, i) => ({
          id: i,
          x: Math.random() * 100,
          color: ['#C74634', '#1D7B4D', '#0572CE', '#D4A800', '#00918A', '#6B21A8', '#FF6B35', '#4ECDC4'][Math.floor(Math.random() * 8)],
          delay: Math.random() * 1.2,
          size: 6 + Math.random() * 8,
        }));
        setConfettiPieces(pieces);
        setGeneratePoSuccess({ orderNumber: data.OrderNumber, status: data.Status ?? 'Draft' });
        setPoHeaderId(data.POHeaderId ?? null);
        if (data.OrderNumber) { patch({ poNumber: data.OrderNumber, status: data.Status ?? header.status }); }
        setGeneratePoModalOpen(true);
      } else {
        const backup = savePoJson('FAILED');
        Modal.error({
          title: `Failed to Generate PO (HTTP ${r.status})`,
          content: (
            <>
              <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 260, overflow: 'auto' }}>
                {rawText || '(empty response)'}
              </pre>
              {backup && <Alert type="info" showIcon style={{ marginTop: 10 }}
                message="Backup saved" description={<span>The order (header + lines) was saved to <Text code>{backup}</Text>. Use <Text strong>JSON Actions → Load</Text> to restore it.</span>} />}
            </>
          ),
          width: 600,
        });
      }
    } catch (err: any) {
      const backup = savePoJson('FAILED');
      Modal.error({
        title: 'Network Error',
        content: (
          <>
            <div>{err.message}</div>
            {backup && <Alert type="info" showIcon style={{ marginTop: 10 }}
              message="Backup saved" description={<span>The order was saved to <Text code>{backup}</Text>. Use <Text strong>JSON Actions → Load</Text> to restore it.</span>} />}
          </>
        ),
      });
    } finally {
      setGeneratePoLoading(false);
    }
  };

  /* ─── Submit the draft PO for approval (Fusion custom action) ─────────
     Invokes the `submit` action on draftPurchaseOrders/{POHeaderId}
     using the Oracle ADF action content type. Needs the PO to be saved
     first (that create call returns the POHeaderId we submit against). */
  const submitForApproval = async (idArg?: number | null) => {
    const id = idArg ?? poHeaderId;
    if (!id) {
      message.warning('Save the purchase order first — that creates the draft in Fusion and returns its ID to approve.');
      return;
    }
    setApprovingFusion(true);
    try {
      const r = await fetch(`${FUSION_BASE}/draftPurchaseOrders/${id}`, {
        method: 'POST',
        headers: { ...FUSION_HDRS, 'Content-Type': 'application/vnd.oracle.adf.action+json' },
        body: JSON.stringify({ name: 'submit', parameters: [] }),
      });
      const rawText = await r.text();
      let data: any = null; try { data = JSON.parse(rawText); } catch { /* non-json */ }
      if (!r.ok) {
        const msg = data?.title ?? data?.detail ?? data?.message ?? `HTTP ${r.status}`;
        Modal.error({
          title: `Approval failed (HTTP ${r.status})`,
          width: 600,
          content: <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 260, overflow: 'auto' }}>{rawText || String(msg)}</pre>,
        });
        return;
      }
      const newStatus = data?.result ?? data?.Status ?? data?.DocumentStatus ?? 'Pending approval';
      patch({ status: typeof newStatus === 'string' ? newStatus : 'Pending approval' });
      setGeneratePoSuccess(prev => prev ? { ...prev, status: typeof newStatus === 'string' ? newStatus : 'Pending approval' } : prev);
      message.success(`Purchase order submitted for approval${typeof newStatus === 'string' ? ` — ${newStatus}` : ''}`);
    } catch (err: any) {
      Modal.error({ title: 'Approval network error', content: err.message });
    } finally {
      setApprovingFusion(false);
    }
  };

  // ── Edit mode: save changes back to the existing Fusion draft PO ────────────
  // New lines (no POLineId) → POST child/lines; existing lines → PATCH qty/price/
  // description. Deletes are handled immediately in handleDeleteLine. After the
  // sync the PO is reloaded from Fusion so every line carries its POLineId.
  const saveEditChanges = async () => {
    if (!poHeaderId) { message.warning('No Fusion PO loaded.'); return; }
    // Need-by date is mandatory on every line.
    const missingNeedBy = lines.filter(l => !l.needBy);
    if (missingNeedBy.length > 0) {
      Modal.error({ title: 'Need-by date is required',
        content: `Set a Need-by date on line${missingNeedBy.length > 1 ? 's' : ''}: ${missingNeedBy.map(l => l.lineNum).join(', ')}` });
      return;
    }
    setSavingEdit(true);
    const errors: string[] = [];
    let added = 0, updated = 0;
    try {
      let nextNum = nextLineNumberBase();
      for (const l of lines.filter(x => x.poLineId == null)) {
        nextNum += 1;
        const body = buildLineBody(l, nextNum);   // full schedule + LineNumber
        const r = await fetch(`${FUSION_BASE}/draftPurchaseOrders/${poHeaderId}/child/lines`, {
          method: 'POST', headers: { ...FUSION_HDRS, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        if (r.ok) {
          added++;
          // Stamp the new POLineId so this line is now "saved" and won't re-POST.
          const rd = await r.json().catch(() => ({} as any));
          const newId = rd?.POLineId ?? rd?.LineId;
          if (newId != null) patchLine(l.key, { poLineId: Number(newId) });
        } else { const t = await r.text(); errors.push(`Add ${l.itemNumber}: ${t.slice(0, 300)}`); }
      }
      for (const l of lines.filter(x => x.poLineId != null)) {
        const body = { Quantity: l.qty, Price: l.price, Description: l.description };
        const r = await fetch(`${FUSION_BASE}/draftPurchaseOrders/${poHeaderId}/child/lines/${l.poLineId}`, {
          method: 'PATCH', headers: { ...FUSION_HDRS, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        if (r.ok) updated++; else { const t = await r.text(); errors.push(`Update line ${l.lineNum}: ${t.slice(0, 300)}`); }
        // Need-by lives on the schedule — PATCH it (and the schedule qty) so it saves.
        if (l.scheduleId != null && l.needBy) {
          const schBody = { RequestedDeliveryDate: l.needBy.format('YYYY-MM-DD'), Quantity: l.qty };
          const sr = await fetch(`${FUSION_BASE}/draftPurchaseOrders/${poHeaderId}/child/lines/${l.poLineId}/child/schedules/${l.scheduleId}`, {
            method: 'PATCH', headers: { ...FUSION_HDRS, 'Content-Type': 'application/json' }, body: JSON.stringify(schBody),
          });
          if (!sr.ok) { const t = await sr.text(); errors.push(`Need-by line ${l.lineNum}: ${t.slice(0, 200)}`); }
        }
      }
      if (errors.length) {
        // Keep the current lines on screen — successful adds now carry a POLineId,
        // failed ones stay unsaved so they can be fixed and re-saved. No reload.
        Modal.error({ title: `Saved with ${errors.length} error(s) — ${added} added, ${updated} updated`, width: 640,
          content: <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 300, overflow: 'auto' }}>{errors.join('\n\n')}</pre> });
      } else {
        message.success(`Saved to Fusion — ${added} line(s) added, ${updated} updated`);
        await loadDraftFromFusion(poHeaderId);   // clean reload only on full success
      }
    } catch (e: any) {
      Modal.error({ title: 'Save changes — network error', content: e.message });
    } finally {
      setSavingEdit(false);
    }
  };

  // The actual Fusion operations "Save Changes" will run, for the Show JSON dialog
  // in edit mode (POST for new lines, PATCH for existing ones).
  const buildEditOps = (): { method: string; url: string; body: any; lineKey: string }[] => {
    const ops: { method: string; url: string; body: any; lineKey: string }[] = [];
    let nextNum = nextLineNumberBase();
    lines.filter(l => l.poLineId == null).forEach(l => {
      nextNum += 1;
      ops.push({ method: 'POST', url: `${FUSION_BASE}/draftPurchaseOrders/${poHeaderId}/child/lines`, body: buildLineBody(l, nextNum), lineKey: l.key });
    });
    lines.filter(l => l.poLineId != null).forEach(l => {
      ops.push({
        method: 'PATCH', url: `${FUSION_BASE}/draftPurchaseOrders/${poHeaderId}/child/lines/${l.poLineId}`,
        body: { Quantity: l.qty, Price: l.price, Description: l.description }, lineKey: l.key,
      });
      if (l.scheduleId != null && l.needBy) ops.push({
        method: 'PATCH', url: `${FUSION_BASE}/draftPurchaseOrders/${poHeaderId}/child/lines/${l.poLineId}/child/schedules/${l.scheduleId}`,
        body: { RequestedDeliveryDate: l.needBy.format('YYYY-MM-DD'), Quantity: l.qty }, lineKey: l.key,
      });
    });
    return ops;
  };

  // Test-run of a single edit op from the Show JSON dialog. On a successful POST
  // the new POLineId is stamped onto the line so Save Changes won't re-create it.
  const [editOps, setEditOps] = useState<{ method: string; url: string; body: any; lineKey: string }[]>([]);
  const [editOpResults, setEditOpResults] = useState<Record<number, { loading: boolean; status: number; body: string }>>({});
  const runEditOp = async (idx: number) => {
    const op = editOps[idx];
    if (!op) return;
    setEditOpResults(prev => ({ ...prev, [idx]: { loading: true, status: 0, body: '' } }));
    try {
      const r = await fetch(op.url, { method: op.method, headers: { ...FUSION_HDRS, 'Content-Type': 'application/json' }, body: JSON.stringify(op.body) });
      const text = await r.text();
      let data: any = null, pretty = text;
      try { data = JSON.parse(text); pretty = JSON.stringify(data, null, 2); } catch { /* not json */ }
      if (op.method === 'POST' && r.ok) {
        const newId = data?.POLineId ?? data?.LineId;
        if (newId != null) patchLine(op.lineKey, { poLineId: Number(newId) });
      }
      setEditOpResults(prev => ({ ...prev, [idx]: { loading: false, status: r.status, body: pretty } }));
    } catch (e: any) {
      setEditOpResults(prev => ({ ...prev, [idx]: { loading: false, status: 0, body: e?.message ?? 'Network error' } }));
    }
  };

  // ── Delete the whole PO from Fusion (draft/Incomplete) ──────────────────────
  const deletePoFromFusion = () => {
    if (!poHeaderId) { message.warning('No Fusion PO loaded.'); return; }
    Modal.confirm({
      title: `Delete PO ${header?.poNumber} from Fusion?`,
      width: 560,
      okText: 'Delete Purchase Order', okButtonProps: { danger: true },
      content: (
        <div style={{ fontSize: 12 }}>
          <p>This permanently removes the entire purchase order (POHeaderId {poHeaderId}) from Oracle Fusion.</p>
          <pre style={{ fontSize: 11, background: '#f5f5f5', padding: 8, borderRadius: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
{`DELETE ${FUSION_BASE}/draftPurchaseOrders/${poHeaderId}`}
          </pre>
        </div>
      ),
      onOk: async () => {
        try {
          const r = await fetch(`${FUSION_BASE}/draftPurchaseOrders/${poHeaderId}`, { method: 'DELETE', headers: FUSION_HDRS });
          if (!r.ok && r.status !== 204) {
            const t = await r.text();
            Modal.error({ title: 'Delete PO failed', width: 620, content: <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 260, overflow: 'auto' }}>{t}</pre> });
            return;
          }
          message.success(`PO ${header?.poNumber} deleted from Fusion`);
          exit();
        } catch (e: any) {
          Modal.error({ title: 'Delete PO — network error', content: e.message });
        }
      },
    });
  };

  // ── Delete ALL lines (and their schedules/distributions) from Fusion ────────
  // Deleting a draft PO line cascades to its schedules + distributions, so
  // looping DELETE over every POLineId clears the whole set.
  const deleteAllLines = () => {
    if (!poHeaderId) { message.warning('No Fusion PO loaded.'); return; }
    const fusionLines = lines.filter(l => l.poLineId != null);
    if (fusionLines.length === 0) {
      setLines([]);
      message.info('No Fusion lines to delete — cleared local lines.');
      return;
    }
    Modal.confirm({
      title: `Delete ALL ${fusionLines.length} line(s) from Fusion?`,
      width: 580,
      okText: `Delete all ${fusionLines.length} lines`, okButtonProps: { danger: true },
      content: (
        <div style={{ fontSize: 12 }}>
          <p>This permanently removes <b>every line</b> — and each line's schedules and distributions — from PO {header?.poNumber} in Oracle Fusion. The PO header stays.</p>
          <pre style={{ fontSize: 11, background: '#f5f5f5', padding: 8, borderRadius: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
{`DELETE ${FUSION_BASE}/draftPurchaseOrders/${poHeaderId}/child/lines/{POLineId}   ×${fusionLines.length}`}
          </pre>
        </div>
      ),
      onOk: async () => {
        setSavingEdit(true);
        const errors: string[] = [];
        let deleted = 0;
        // Delete highest line number first so re-sequencing never clashes.
        for (const l of [...fusionLines].sort((a, b) => (b.lineNum ?? 0) - (a.lineNum ?? 0))) {
          try {
            const r = await fetch(`${FUSION_BASE}/draftPurchaseOrders/${poHeaderId}/child/lines/${l.poLineId}`, { method: 'DELETE', headers: FUSION_HDRS });
            if (r.ok || r.status === 204) deleted++;
            else { const t = await r.text(); errors.push(`Line ${l.lineNum} (${l.itemNumber}): ${t.slice(0, 200)}`); }
          } catch (e: any) { errors.push(`Line ${l.lineNum} (${l.itemNumber}): ${e.message}`); }
        }
        setSavingEdit(false);
        if (errors.length) {
          Modal.error({ title: `Deleted ${deleted}, ${errors.length} failed`, width: 640,
            content: <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 300, overflow: 'auto' }}>{errors.join('\n\n')}</pre> });
        } else {
          message.success(`All ${deleted} line(s) deleted from Fusion`);
        }
        await loadDraftFromFusion(poHeaderId);   // refresh from Fusion
      },
    });
  };

  // ── Fusion PO lifecycle actions (cancel / close / hold / reopen …) ──────────
  // Each is a custom action POSTed to the resource row with the adf.action
  // content type. Lifecycle actions live on `purchaseOrders`; `submit` is on
  // `draftPurchaseOrders`. Needs the PO to exist in Fusion (poHeaderId).
  const runPoAction = async (label: string, actionName: string, resource = 'purchaseOrders', params: any[] = []) => {
    if (!poHeaderId) { message.warning('Save the purchase order first — the action needs the Fusion PO id.'); return; }
    setPoActionLoading(actionName);
    try {
      const url = `${FUSION_BASE}/${resource}/${poHeaderId}`;
      const r = await fetch(url, {
        method: 'POST',
        headers: { ...FUSION_HDRS, 'Content-Type': 'application/vnd.oracle.adf.action+json' },
        body: JSON.stringify({ name: actionName, parameters: params }),
      });
      const rawText = await r.text();
      let data: any = null; try { data = JSON.parse(rawText); } catch { /* non-json */ }
      if (!r.ok) {
        const msg = data?.title ?? data?.detail ?? data?.message ?? `HTTP ${r.status}`;
        Modal.error({ title: `${label} failed (HTTP ${r.status})`, width: 620,
          content: <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 300, overflow: 'auto' }}>{rawText || String(msg)}</pre> });
        return;
      }
      const newStatus = data?.result ?? data?.Status ?? data?.DocumentStatus;
      if (typeof newStatus === 'string') patch({ status: newStatus });
      Modal.success({ title: `${label} — done`, width: 620,
        content: <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 300, overflow: 'auto' }}>{rawText || '(no content)'}</pre> });
    } catch (err: any) {
      Modal.error({ title: `${label} — network error`, content: err.message });
    } finally {
      setPoActionLoading(null);
    }
  };

  // Confirm first — shows the exact URL + adf.action body before running.
  const confirmPoAction = (label: string, actionName: string, resource = 'purchaseOrders') => {
    if (!poHeaderId) { message.warning('Save the purchase order first — the action needs the Fusion PO id.'); return; }
    Modal.confirm({
      title: `${label}?`,
      width: 600,
      icon: null,
      content: (
        <div style={{ fontSize: 12 }}>
          <p style={{ margin: '0 0 8px' }}>POST the Fusion custom action <b>{actionName}</b> to this purchase order.</p>
          <pre style={{ fontSize: 11, background: '#f5f5f5', padding: 10, borderRadius: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
{`POST ${FUSION_BASE}/${resource}/${poHeaderId}
Content-Type: application/vnd.oracle.adf.action+json

${JSON.stringify({ name: actionName, parameters: [] }, null, 2)}`}
          </pre>
        </div>
      ),
      okText: `Run ${label}`,
      okButtonProps: { danger: /cancel|finallyClose/i.test(actionName) },
      onOk: () => runPoAction(label, actionName, resource),
    });
  };

  const handleGeneratePDF = () => {
    if (!header) return;

    const lineRowsHtml = lines.map(l => `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:center">${l.lineNum}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;font-weight:600;color:#0572CE">${l.itemNumber}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${l.description}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:center">${l.uom}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${fmt(l.qty)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${fmt(l.price)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${fmt(l.lineTotal)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;font-weight:600;color:#C74634">${fmt(l.netTotal)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:center;color:#666;font-size:12px">${l.needBy ? l.needBy.format('D-MMM-YYYY') : '—'}</td>
      </tr>`).join('');

    const fxHtml = fxRate ? `<p style="font-size:12px;color:#0572CE;margin:8px 0">Conversion Rate: 1 ${header.currency} = ${fxRate.rate.toFixed(4)} ${baseCurrency} &nbsp;·&nbsp; ${fxRate.rateType} &nbsp;·&nbsp; ${fxRate.rateDate ? dayjs(fxRate.rateDate).format('D-MMM-YYYY') : ''}</p>` : '';

    const acqHtml = acqCharges.length > 0 ? `
      <h3 style="color:#D4A800;margin:24px 0 8px">Acquisition Costs</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="background:#FFF8F0">
          <th style="padding:8px 10px;text-align:left;border-bottom:2px solid #D4A800">Charge Type</th>
          <th style="padding:8px 10px;text-align:left;border-bottom:2px solid #D4A800">Description</th>
          <th style="padding:8px 10px;text-align:right;border-bottom:2px solid #D4A800">Amount (${header.currency})</th>
          <th style="padding:8px 10px;text-align:left;border-bottom:2px solid #D4A800">Apportion</th>
        </tr></thead>
        <tbody>${acqCharges.map(c => `<tr>
          <td style="padding:6px 10px;border-bottom:1px solid #eee">${c.chargeType}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee">${c.description || '—'}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${fmt(c.amount)}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee">${c.apportionBasis}</td>
        </tr>`).join('')}
        <tr style="background:#FFF8F0;font-weight:600">
          <td colspan="2" style="padding:8px 10px">Total</td>
          <td style="padding:8px 10px;text-align:right;color:#D4A800">${fmt(acqCharges.reduce((s, c) => s + c.amount, 0))}</td>
          <td></td>
        </tr></tbody>
      </table>` : '';

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>PO ${header.poNumber}</title>
  <style>
    @media print { body { margin: 0; } @page { size: A4 landscape; margin: 14mm; } }
    body { font-family: Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 0; }
  </style>
</head>
<body>
<div style="max-width:900px;margin:24px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.10)">
  <div style="background:linear-gradient(90deg,#2D2D2D,#3C3C3C);padding:24px 28px;display:flex;align-items:center;justify-content:space-between">
    <div>
      <div style="font-size:11px;color:rgba(255,255,255,0.5);text-transform:uppercase;letter-spacing:0.08em">Purchase Order</div>
      <div style="font-size:24px;font-weight:700;color:#fff;margin-top:4px;font-family:monospace">${header.poNumber}</div>
    </div>
    <div style="text-align:right">
      <div style="background:#D4A800;color:#fff;padding:4px 14px;border-radius:20px;font-size:12px;font-weight:700;display:inline-block">${header.status}</div>
      <div style="color:rgba(255,255,255,0.6);font-size:12px;margin-top:6px">${header.docType} &nbsp;·&nbsp; ${header.orderDate.format('D-MMM-YYYY')}</div>
      <div style="color:rgba(255,255,255,0.6);font-size:12px;margin-top:2px">Buyer: ${header.buyer}</div>
    </div>
  </div>
  <div style="padding:24px 28px">
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
      <tr>
        <td style="width:50%;vertical-align:top;padding-right:16px">
          <div style="background:#F7F7F7;border-radius:6px;padding:14px 16px">
            <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:#888;margin-bottom:10px">Supplier</div>
            <div style="font-size:15px;font-weight:700;color:#1a1a1a">${header.supplierName}</div>
            ${header.supplierSite ? `<div style="font-size:12px;color:#666;margin-top:2px">Site: ${header.supplierSite}</div>` : ''}
            ${header.communicationEmail ? `<div style="font-size:12px;color:#666;margin-top:2px">Email: ${header.communicationEmail}</div>` : ''}
          </div>
        </td>
        <td style="width:50%;vertical-align:top">
          <div style="background:#F7F7F7;border-radius:6px;padding:14px 16px">
            <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:#888;margin-bottom:10px">Organization</div>
            <div style="font-size:13px;color:#333">${header.procurementBU}</div>
            <div style="font-size:12px;color:#666;margin-top:4px">Ship To: <strong>${header.shipToOrg}</strong>${header.subinventory ? ` / ${header.subinventory}` : ''}</div>
            <div style="font-size:12px;color:#666">Buyer: ${header.buyer}</div>
            <div style="font-size:12px;color:#666">Currency: <strong>${header.currency}</strong></div>
            ${fxHtml}
          </div>
        </td>
      </tr>
    </table>
    <h3 style="color:#0572CE;margin:0 0 8px;font-size:14px">Purchase Order Lines (${lines.length})</h3>
    <table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead>
        <tr style="background:#E8F0FB">
          <th style="padding:8px 10px;text-align:center;border-bottom:2px solid #0572CE;width:32px">#</th>
          <th style="padding:8px 10px;text-align:left;border-bottom:2px solid #0572CE">Item</th>
          <th style="padding:8px 10px;text-align:left;border-bottom:2px solid #0572CE">Description</th>
          <th style="padding:8px 10px;text-align:center;border-bottom:2px solid #0572CE">UOM</th>
          <th style="padding:8px 10px;text-align:right;border-bottom:2px solid #0572CE">Qty</th>
          <th style="padding:8px 10px;text-align:right;border-bottom:2px solid #0572CE">Unit Price</th>
          <th style="padding:8px 10px;text-align:right;border-bottom:2px solid #0572CE">Amount</th>
          <th style="padding:8px 10px;text-align:right;border-bottom:2px solid #0572CE">Net Total</th>
          <th style="padding:8px 10px;text-align:center;border-bottom:2px solid #0572CE">Need By</th>
        </tr>
      </thead>
      <tbody>${lineRowsHtml}</tbody>
    </table>
    <table style="width:100%;border-collapse:collapse;margin-top:12px">
      <tr>
        <td style="width:55%"></td>
        <td style="width:45%">
          <div style="border:1px solid #e0e0e0;border-radius:6px;overflow:hidden">
            <div style="display:flex;justify-content:space-between;padding:8px 14px;border-bottom:1px solid #eee">
              <span style="color:#666;font-size:13px">Subtotal</span><span style="font-size:13px">${fmt(subtotal)} ${header.currency}</span>
            </div>
            <div style="display:flex;justify-content:space-between;padding:8px 14px;border-bottom:1px solid #eee">
              <span style="color:#666;font-size:13px">Total Tax</span><span style="font-size:13px;color:#D4A800">${fmt(totalTax)} ${header.currency}</span>
            </div>
            ${acqCharges.length > 0 ? `<div style="display:flex;justify-content:space-between;padding:8px 14px;border-bottom:1px solid #eee">
              <span style="color:#666;font-size:13px">Acquisition Charges</span><span style="font-size:13px;color:#D4A800">${fmt(acqCharges.reduce((s, c) => s + c.amount, 0))} ${header.currency}</span>
            </div>
            <div style="display:flex;justify-content:space-between;padding:10px 14px;background:#FFF5E6">
              <span style="font-weight:700;font-size:14px">Landed Total</span><span style="font-weight:700;font-size:16px;color:#D4A800">${fmt((acqResults as any[]).reduce((s, r) => s + r.landedCost, 0))} ${header.currency}</span>
            </div>` : ''}
            <div style="display:flex;justify-content:space-between;padding:10px 14px;background:#EBF0FA">
              <span style="font-weight:700;font-size:14px">Grand Total</span><span style="font-weight:700;font-size:18px;color:#C74634">${fmt(grandTotal)} ${header.currency}</span>
            </div>
          </div>
        </td>
      </tr>
    </table>
    ${acqHtml}
    ${header.noteToSupplier ? `<div style="margin-top:20px;background:#FFF8F0;border-left:4px solid #D4A800;padding:12px 16px;border-radius:0 6px 6px 0">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:#D4A800;margin-bottom:4px">Note to Supplier</div>
      <div style="font-size:13px;color:#333;white-space:pre-wrap">${header.noteToSupplier}</div>
    </div>` : ''}
  </div>
  <div style="background:#F7F7F7;padding:12px 28px;border-top:1px solid #eee;text-align:center">
    <span style="font-size:11px;color:#aaa">ReactERP · Purchase Order ${header.poNumber} · ${dayjs().format('D-MMM-YYYY HH:mm')}</span>
  </div>
</div>
<script>window.onload = function() { window.print(); }</script>
</body>
</html>`;

    const win = window.open('', '_blank');
    if (win) {
      win.document.write(html);
      win.document.close();
    } else {
      message.error('Pop-up blocked — please allow pop-ups for this site to generate PDF');
    }
  };

  const handleSendApproval = async () => {
    if (!header) return;
    const toList = approverEmail.split(',').map(s => s.trim()).filter(Boolean);
    const ccList = approvalCc.split(',').map(s => s.trim()).filter(Boolean);
    if (toList.length === 0) { message.error('Please enter at least one approver email'); return; }

    setApprovalSending(true);
    try {
      // ── Build Excel attachment ──────────────────────────────
      const XLSX = await import('xlsx');

      // Helpers: typed cells with Excel number formats
      const nCell = (v: number, fmt = '#,##0.00'): XLSX.CellObject => ({ t: 'n', v, z: fmt });
      const totalAcqAED = acqCharges.reduce((s, c) => s + getAccounted(c), 0);
      const totalLanded = (acqResults as any[]).reduce((s, r) => s + r.landedCost, 0);

      // ── Sheet 1: PO Summary ─────────────────────────────────
      const hdrRows: any[][] = [
        ['PURCHASE ORDER - PENDING APPROVAL', ''],
        ['', ''],
        ['PO Number',        header.poNumber],
        ['Status',           header.status],
        ['Document Type',    header.docType],
        ['Order Date',       header.orderDate.format('D-MMM-YYYY')],
        ['Buyer',            header.buyer],
        ['', ''],
        ['Procurement BU',   header.procurementBU],
        ['Bill-to BU',       header.billToBU],
        ['Ship-to Org',      header.shipToOrg],
        ['Subinventory',     header.subinventory],
        ['', ''],
        ['Supplier',         header.supplierName],
        ['Supplier Site',    header.supplierSite],
        ['', ''],
        ['Currency',         header.currency],
        ['Payment Terms',    header.paymentTerms],
        ['', ''],
        ['Note to Supplier', header.noteToSupplier || ''],
        ['', ''],
        ['FINANCIAL SUMMARY', ''],
      ];
      const finRow = hdrRows.length - 1;
      hdrRows.push(['Subtotal',  nCell(subtotal)]);
      hdrRows.push(['Total Tax', nCell(totalTax)]);
      if (acqCharges.length > 0) {
        hdrRows.push(['Acquisition Charges (AED)', nCell(totalAcqAED)]);
        hdrRows.push(['Landed Total (AED)',         nCell(totalLanded)]);
      }
      hdrRows.push(['Grand Total', nCell(grandTotal)]);
      if (fxRate) {
        hdrRows.push(['', '']);
        hdrRows.push([`Exchange Rate: 1 ${header.currency} = ${fxRate.rate.toFixed(4)} ${baseCurrency}`, `${fxRate.rateType} - ${fxRate.rateDate ? dayjs(fxRate.rateDate).format('D-MMM-YYYY') : ''}`]);
      }

      const wsHdr = XLSX.utils.aoa_to_sheet(hdrRows);
      wsHdr['!cols'] = [{ wch: 32 }, { wch: 50 }];
      wsHdr['!merges'] = [
        { s: { r: 0,      c: 0 }, e: { r: 0,      c: 1 } },
        { s: { r: finRow, c: 0 }, e: { r: finRow, c: 1 } },
      ];

      // ── Sheet 2: PO Lines ───────────────────────────────────
      const lineDataRows = lines.map(l => [
        l.lineNum,
        l.itemNumber,
        l.description,
        l.uom,
        nCell(l.qty,      '#,##0.0000'),
        nCell(l.price,    '#,##0.0000'),
        nCell(l.lineTotal),
        nCell(l.taxPct,   '0.00'),
        nCell(l.taxAmount),
        nCell(l.netTotal),
        l.needBy ? l.needBy.format('D-MMM-YYYY') : '',
      ]);

      const lineSheetRows: any[][] = [
        ['PO LINES', '', '', '', '', '', '', '', '', '', ''],
        ['', '', '', '', '', '', '', '', '', '', ''],
        ['#', 'Item Number', 'Description', 'UOM', 'Qty', 'Unit Price', 'Amount', 'Tax %', 'Tax Amount', 'Net Total', 'Need By'],
        ...lineDataRows,
        ['', '', '', '', '', '', '', '', '', '', ''],
        ['', '', '', '', '', 'Subtotal',   nCell(subtotal),   '', 'Total Tax', nCell(totalTax),   ''],
        ['', '', '', '', '', 'Grand Total','',                 '', '',          nCell(grandTotal),  ''],
      ];

      const wsLines = XLSX.utils.aoa_to_sheet(lineSheetRows);
      wsLines['!cols'] = [
        {wch:4},{wch:18},{wch:38},{wch:6},{wch:10},{wch:13},{wch:14},{wch:7},{wch:13},{wch:14},{wch:14},
      ];
      wsLines['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 10 } }];
      (wsLines as any)['!freeze'] = { xSplit: 0, ySplit: 3 };

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, wsHdr,   'PO Summary');
      XLSX.utils.book_append_sheet(wb, wsLines, 'PO Lines');

      // ── Sheet 3 & 4: Acquisition Costs (if any) ────────────
      if (acqCharges.length > 0) {
        // Sheet 3: Charges
        const apportionLabel: Record<string, string> = {
          value: 'By Value', qty: 'By Quantity', equal: 'Equal', manual: 'Manual',
        };
        const acqSheetRows: any[][] = [
          ['ACQUISITION COST CHARGES', '', '', '', '', ''],
          ['', '', '', '', '', ''],
          ['Charge Type', 'Description', 'Currency', 'Amount (Entered)', 'Accounted (AED)', 'Apportion By'],
          ...acqCharges.map(c => {
            const acc = getAccounted(c);
            const rInfo = acqFxRates[c.key];
            return [
              c.chargeType,
              c.description || '',
              c.currency,
              nCell(c.amount),
              nCell(acc),
              apportionLabel[c.apportionBasis] ?? c.apportionBasis,
            ];
          }),
          ['', '', '', '', '', ''],
          ['Total', '', '', '', nCell(totalAcqAED), ''],
        ];

        // Add FX rate note rows
        const fxNoteRows = acqCharges
          .filter(c => c.currency && c.currency !== 'AED' && acqFxRates[c.key]?.rate > 0)
          .map(c => {
            const r = acqFxRates[c.key];
            return ['', `1 ${c.currency} = ${r.rate.toFixed(4)} AED`, '', `${r.rateType}`, `${r.rateDate ? dayjs(r.rateDate).format('D-MMM-YYYY') : ''}`, ''];
          });
        if (fxNoteRows.length > 0) {
          acqSheetRows.push(['FX Rates Used', '', '', '', '', '']);
          acqSheetRows.push(...fxNoteRows);
        }

        const wsAcq = XLSX.utils.aoa_to_sheet(acqSheetRows);
        wsAcq['!cols'] = [{wch:18},{wch:30},{wch:10},{wch:16},{wch:16},{wch:14}];
        wsAcq['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 5 } }];
        (wsAcq as any)['!freeze'] = { xSplit: 0, ySplit: 3 };
        XLSX.utils.book_append_sheet(wb, wsAcq, 'Acquisition Cost');

        // Sheet 4: Landed Cost per Line (Entered + AED columns per charge)
        const chargeHeaders = acqCharges.flatMap(c => [
          `${c.chargeType} (${c.currency})`,
          `${c.chargeType} AED`,
        ]);
        const numChargeCols = acqCharges.length * 2;
        const totalLandedCols = 7 + numChargeCols + 4;

        const landedSheetRows: any[][] = [
          ['LANDED COST PER LINE', ...new Array(totalLandedCols - 1).fill('')],
          new Array(totalLandedCols).fill(''),
          ['#', 'Item Number', 'Description', 'UOM', 'Qty', 'Unit Price', 'Line Total',
           ...chargeHeaders,
           'Total Charges (AED)', 'Landed Cost (AED)', 'Landed Unit Price', '% Change'],
          ...(acqResults as any[]).map(r => [
            r.lineNum,
            r.itemNumber,
            r.description,
            r.uom,
            nCell(r.qty,   '#,##0.0000'),
            nCell(r.price, '#,##0.0000'),
            nCell(r.lineTotal),
            ...acqCharges.flatMap(c => {
              const aedAmt = r.chargeAmounts[c.key] ?? 0;
              const accTot = getAccounted(c);
              const entAmt = accTot > 0 ? (aedAmt / accTot) * c.amount : 0;
              return [nCell(entAmt), nCell(aedAmt)];
            }),
            nCell(r.totalCharges),
            nCell(r.landedCost),
            nCell(r.landedUnitPrice),
            nCell(r.pctChange / 100, '0.00%'),
          ]),
          new Array(totalLandedCols).fill(''),
          ['Totals', '', '', '', '', '',
            nCell(subtotal),
            ...acqCharges.flatMap(c => {
              const accTot = getAccounted(c);
              return [nCell(c.amount), nCell(accTot)];
            }),
            nCell(totalAcqAED),
            nCell(totalLanded),
            '',
            '',
          ],
        ];

        const wsLanded = XLSX.utils.aoa_to_sheet(landedSheetRows);
        wsLanded['!cols'] = [
          {wch:4},{wch:18},{wch:35},{wch:6},{wch:10},{wch:13},{wch:14},
          ...acqCharges.flatMap(() => [{wch:15},{wch:15}]),
          {wch:18},{wch:18},{wch:18},{wch:10},
        ];
        wsLanded['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: totalLandedCols - 1 } }];
        (wsLanded as any)['!freeze'] = { xSplit: 2, ySplit: 3 };
        XLSX.utils.book_append_sheet(wb, wsLanded, 'Landed Cost');
      }

      const attachmentBase64 = XLSX.write(wb, { bookType: 'xlsx', type: 'base64' }) as string;
      const attachmentName   = `PO_${header.poNumber}_Approval.xlsx`;

      // ── Approve / Reject mailto links ──────────────────────
      const approveMailto = `mailto:?subject=${encodeURIComponent(`APPROVE: PO ${header.poNumber}`)}&body=${encodeURIComponent(`I approve Purchase Order ${header.poNumber} from ${header.supplierName} for ${fmt(grandTotal)} ${header.currency}.\n\nApproval Date: ${dayjs().format('D-MMM-YYYY')}`)}`;
      const rejectMailto  = `mailto:?subject=${encodeURIComponent(`REJECT: PO ${header.poNumber}`)}&body=${encodeURIComponent(`I reject Purchase Order ${header.poNumber} from ${header.supplierName}.\n\nReason: `)}`;

      // ── Build HTML email body ───────────────────────────────
      const lineRowsHtml = lines.map(l => `
        <tr>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:center">${l.lineNum}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;font-weight:600;color:#0572CE">${l.itemNumber}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee">${l.description}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:center">${l.uom}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${fmt(l.qty)}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${fmt(l.price)}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${fmt(l.lineTotal)}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;color:#C74634;font-weight:600">${fmt(l.netTotal)}</td>
        </tr>`).join('');

      const acqHtml = acqCharges.length > 0 ? `
        <h3 style="color:#D4A800;margin:24px 0 8px">Acquisition Costs</h3>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead>
            <tr style="background:#FFF8F0">
              <th style="padding:8px 10px;text-align:left;border-bottom:2px solid #D4A800">Charge Type</th>
              <th style="padding:8px 10px;text-align:left;border-bottom:2px solid #D4A800">Description</th>
              <th style="padding:8px 10px;text-align:right;border-bottom:2px solid #D4A800">Amount (${header.currency})</th>
              <th style="padding:8px 10px;text-align:left;border-bottom:2px solid #D4A800">Apportion By</th>
            </tr>
          </thead>
          <tbody>
            ${acqCharges.map(c => `
            <tr>
              <td style="padding:6px 10px;border-bottom:1px solid #eee">${c.chargeType}</td>
              <td style="padding:6px 10px;border-bottom:1px solid #eee">${c.description || '—'}</td>
              <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${fmt(c.amount)}</td>
              <td style="padding:6px 10px;border-bottom:1px solid #eee">${c.apportionBasis}</td>
            </tr>`).join('')}
            <tr style="background:#FFF8F0;font-weight:600">
              <td colspan="2" style="padding:8px 10px">Total Charges</td>
              <td style="padding:8px 10px;text-align:right;color:#D4A800">${fmt(acqCharges.reduce((s,c) => s+c.amount,0))}</td>
              <td></td>
            </tr>
          </tbody>
        </table>
        <p style="font-size:12px;color:#888;margin-top:6px">See the "Landed Cost" sheet in the Excel attachment for per-line breakdown.</p>` : '';

      const fxHtml = fxRate ? `
        <p style="font-size:12px;color:#0572CE;margin:8px 0">
          Conversion Rate: 1 ${header.currency} = ${fxRate.rate.toFixed(4)} AED
          &nbsp;·&nbsp; ${fxRate.rateType} &nbsp;·&nbsp; ${fxRate.rateDate ? dayjs(fxRate.rateDate).format('D-MMM-YYYY') : ''}
        </p>` : '';

      const htmlBody = `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif">
<div style="max-width:780px;margin:24px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.10)">

  <!-- Header banner -->
  <div style="background:linear-gradient(90deg,#2D2D2D,#3C3C3C);padding:24px 28px;display:flex;align-items:center;justify-content:space-between">
    <div>
      <div style="font-size:11px;color:rgba(255,255,255,0.5);text-transform:uppercase;letter-spacing:0.08em">Purchase Order — Approval Required</div>
      <div style="font-size:22px;font-weight:700;color:#fff;margin-top:4px">${header.poNumber}</div>
    </div>
    <div style="text-align:right">
      <div style="background:#D4A800;color:#fff;padding:4px 14px;border-radius:20px;font-size:12px;font-weight:700">${header.status}</div>
      <div style="color:rgba(255,255,255,0.6);font-size:12px;margin-top:6px">${header.docType} &nbsp;·&nbsp; ${header.orderDate.format('D-MMM-YYYY')}</div>
    </div>
  </div>

  <div style="padding:24px 28px">

    <!-- Summary grid -->
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
      <tr>
        <td style="width:50%;vertical-align:top;padding-right:16px">
          <div style="background:#F7F7F7;border-radius:6px;padding:14px 16px">
            <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:#888;margin-bottom:10px">Supplier</div>
            <div style="font-size:15px;font-weight:700;color:#1a1a1a">${header.supplierName}</div>
            ${header.supplierSite ? `<div style="font-size:12px;color:#666;margin-top:2px">Site: ${header.supplierSite}</div>` : ''}
          </div>
        </td>
        <td style="width:50%;vertical-align:top">
          <div style="background:#F7F7F7;border-radius:6px;padding:14px 16px">
            <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:#888;margin-bottom:10px">Organization</div>
            <div style="font-size:13px;color:#333">${header.procurementBU}</div>
            <div style="font-size:12px;color:#666;margin-top:4px">Ship To: <strong>${header.shipToOrg}</strong>${header.subinventory ? ` / ${header.subinventory}` : ''}</div>
            <div style="font-size:12px;color:#666">Buyer: ${header.buyer}</div>
            <div style="font-size:12px;color:#666">Currency: <strong>${header.currency}</strong></div>
            ${fxHtml}
          </div>
        </td>
      </tr>
    </table>

    <!-- PO Lines -->
    <h3 style="color:#0572CE;margin:0 0 8px;font-size:14px">Purchase Order Lines (${lines.length})</h3>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead>
        <tr style="background:#E8F0FB">
          <th style="padding:8px 10px;text-align:center;border-bottom:2px solid #0572CE;width:36px">#</th>
          <th style="padding:8px 10px;text-align:left;border-bottom:2px solid #0572CE">Item</th>
          <th style="padding:8px 10px;text-align:left;border-bottom:2px solid #0572CE">Description</th>
          <th style="padding:8px 10px;text-align:center;border-bottom:2px solid #0572CE">UOM</th>
          <th style="padding:8px 10px;text-align:right;border-bottom:2px solid #0572CE">Qty</th>
          <th style="padding:8px 10px;text-align:right;border-bottom:2px solid #0572CE">Unit Price</th>
          <th style="padding:8px 10px;text-align:right;border-bottom:2px solid #0572CE">Amount</th>
          <th style="padding:8px 10px;text-align:right;border-bottom:2px solid #0572CE">Net Total</th>
        </tr>
      </thead>
      <tbody>${lineRowsHtml}</tbody>
    </table>

    <!-- Totals -->
    <table style="width:100%;border-collapse:collapse;margin-top:12px">
      <tr>
        <td style="width:60%"></td>
        <td style="width:40%">
          <div style="border:1px solid #e0e0e0;border-radius:6px;overflow:hidden">
            <div style="display:flex;justify-content:space-between;padding:8px 14px;border-bottom:1px solid #eee">
              <span style="color:#666;font-size:13px">Subtotal</span>
              <span style="font-size:13px">${fmt(subtotal)} ${header.currency}</span>
            </div>
            <div style="display:flex;justify-content:space-between;padding:8px 14px;border-bottom:1px solid #eee">
              <span style="color:#666;font-size:13px">Total Tax</span>
              <span style="font-size:13px;color:#D4A800">${fmt(totalTax)} ${header.currency}</span>
            </div>
            ${acqCharges.length > 0 ? `
            <div style="display:flex;justify-content:space-between;padding:8px 14px;border-bottom:1px solid #eee">
              <span style="color:#666;font-size:13px">Acquisition Charges</span>
              <span style="font-size:13px;color:#D4A800">${fmt(acqCharges.reduce((s,c) => s+c.amount,0))} ${header.currency}</span>
            </div>
            <div style="display:flex;justify-content:space-between;padding:10px 14px;background:#FFF5E6">
              <span style="font-weight:700;font-size:14px">Landed Total</span>
              <span style="font-weight:700;font-size:16px;color:#D4A800">${fmt((acqResults as any[]).reduce((s,r) => s+r.landedCost,0))} ${header.currency}</span>
            </div>` : ''}
            <div style="display:flex;justify-content:space-between;padding:10px 14px;background:#EBF0FA">
              <span style="font-weight:700;font-size:14px">Grand Total</span>
              <span style="font-weight:700;font-size:18px;color:#C74634">${fmt(grandTotal)} ${header.currency}</span>
            </div>
          </div>
        </td>
      </tr>
    </table>

    ${acqHtml}

    ${approvalNote ? `
    <div style="margin-top:24px;background:#FFF8F0;border-left:4px solid #D4A800;padding:14px 16px;border-radius:0 6px 6px 0">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#D4A800;margin-bottom:6px">Note from Requester</div>
      <div style="font-size:13px;color:#333;white-space:pre-wrap">${approvalNote}</div>
    </div>` : ''}

    <!-- Action buttons: Approve / Reject -->
    <div style="margin-top:28px;background:#F0F7FF;border:1px solid rgba(5,114,206,0.25);border-radius:6px;padding:24px;text-align:center">
      <div style="font-size:14px;color:#0572CE;font-weight:600;margin-bottom:6px">Action Required</div>
      <div style="font-size:13px;color:#555;margin-bottom:22px">Review the details and attached Excel, then click your decision below:</div>
      <table style="border-collapse:collapse;margin:0 auto">
        <tr>
          <td style="padding:0 10px">
            <a href="${approveMailto}" style="display:inline-block;padding:13px 34px;background:#1D7B4D;color:#ffffff;border-radius:6px;text-decoration:none;font-weight:700;font-size:15px;letter-spacing:0.03em">&#10003;&nbsp; Approve</a>
          </td>
          <td style="padding:0 10px">
            <a href="${rejectMailto}" style="display:inline-block;padding:13px 34px;background:#C74634;color:#ffffff;border-radius:6px;text-decoration:none;font-weight:700;font-size:15px;letter-spacing:0.03em">&#10007;&nbsp; Reject</a>
          </td>
        </tr>
      </table>
      <div style="margin-top:14px;font-size:11px;color:#999">Clicking a button opens your email client with a pre-filled message. Add the requester&apos;s address in the To field and send.</div>
    </div>

  </div>

  <!-- Footer -->
  <div style="background:#F7F7F7;padding:14px 28px;border-top:1px solid #eee;text-align:center">
    <span style="font-size:11px;color:#aaa">ReactERP · Purchase Order ${header.poNumber} · ${dayjs().format('D-MMM-YYYY HH:mm')}</span>
  </div>

</div>
</body>
</html>`;

      const subject = `[Approval Required] Purchase Order ${header.poNumber} — ${header.supplierName} — ${fmt(grandTotal)} ${header.currency}`;

      const result = await eAPI?.sendPoApproval?.({
        toEmails: toList,
        ccEmails: ccList,
        subject,
        htmlBody,
        attachmentBase64,
        attachmentName,
      });

      if (result?.success) {
        message.success(`Approval email sent to ${toList.join(', ')}`);
        setApprovalOpen(false);
        setApproverEmail(''); setApprovalCc(''); setApprovalNote('');
      } else {
        message.error(`Failed to send: ${result?.error ?? 'Unknown error'}`);
      }
    } catch (err: any) {
      message.error(`Error: ${err.message}`);
    } finally {
      setApprovalSending(false);
    }
  };

  const openAddItem = () => {
    if (!header) return;
    setAddItemOpen(true);
    setSearchTerm('');
    setSelectedItemKeys([]);
    setAddItemTab('browse');
    setPastedRows([]);
    setPasteText('');
    setItems([]);
    setItemCacheTs('');
    setItemSearchType('number');
  };

  const searchItemsV2 = async () => {
    if (!header || !searchTerm.trim()) {
      message.warning('Please enter a search term');
      return;
    }

    setItemSearchLoading(true);
    try {
      const org = header.shipToOrg;
      if (!org) {
        message.warning('Select a Ship-to Organization first');
        setItemSearchLoading(false);
        return;
      }

      let query = '';
      if (itemSearchType === 'number') {
        query = `ItemNumber LIKE '%${encodeURIComponent(searchTerm.trim())}%';OrganizationCode=${org}`;
      } else {
        query = `ItemDescription LIKE '%${encodeURIComponent(searchTerm.trim())}%';OrganizationCode=${org}`;
      }

      const url = `${FUSION_BASE}/itemsV2?q=${encodeURIComponent(query)}&fields=ItemNumber,ItemDescription,PrimaryUOMValue,ItemStatusValue&limit=100&onlyData=true`;
      setAddItemApiUrl(`GET itemsV2?q=${query}&fields=ItemNumber,ItemDescription,PrimaryUOMValue,ItemStatusValue&limit=100&onlyData=true`);

      const res = await fetch(url, { headers: FUSION_HDRS });
      if (!res.ok) throw new Error(`API returned ${res.status}`);

      const data = await res.json();
      const results = data.items ?? data.data ?? [];

      if (results.length === 0) {
        message.info(`No items found matching "${searchTerm}" in organization ${org}`);
        setItems([]);
      } else {
        const mapped = results.map((item: any) => ({
          item_number: item.ItemNumber,
          description: item.ItemDescription,
          primary_uom_code: item.PrimaryUOMValue || item.PrimaryUnitOfMeasureCode,
          inventory_item_status_code: item.ItemStatusValue,
          ...item
        }));
        setItems(mapped);
        message.success(`Found ${results.length} item(s) in ${org}`);
      }
    } catch (e: any) {
      message.error(`Search failed: ${e?.message ?? 'Network error'}`);
      setItems([]);
    } finally {
      setItemSearchLoading(false);
    }
  };

  const refreshItems = async () => {
    if (items.length === 0 || !searchTerm.trim()) {
      message.info('Perform a search first, then use Refresh to get updated results');
      return;
    }
    await searchItemsV2();
  };

  const exportItemsExcel = () => {
    import('xlsx').then(XLSX => {
      const rows = items.map(it => ({
        'Item Number':  it.item_number  ?? '',
        'Description':  it.description  ?? '',
        'UOM':          it.primary_uom_code ?? it.uom ?? '',
        'Status':       it.inventory_item_status_code ?? '',
        'Brand':        it.attr1 ?? '',
        'Category':     it.attr5 ?? '',
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Items');
      XLSX.writeFile(wb, `itemmaster_${header?.shipToOrg ?? 'export'}_${dayjs().format('YYYYMMDD')}.xlsx`);
    });
  };

  const parsePasteText = (text: string): PastedItem[] => {
    return text.split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map((line, i) => {
        // Prefer tab-splitting so thousands-commas inside numbers (10,000) survive;
        // only fall back to comma when the line has no tab.
        const parts = line.includes('\t') ? line.split('\t') : line.split(',');
        const itemNumber = (parts[0] ?? '').trim().toUpperCase();
        const { qty, price } = parseQtyPrice(parts.slice(1));
        return { key: `paste-${i}-${itemNumber}`, itemNumber, qty, price, status: 'pending' as const };
      })
      .filter(r => r.itemNumber);
  };

  // Parse the pasted text — but if any row has a comma inside its Qty/Price
  // (e.g. "10,000"), list those rows and ask the user to confirm the fix
  // (strip the commas) before applying.
  const handleParseText = () => {
    const flagged: string[] = [];
    pasteText.split('\n').map(l => l.trim()).filter(Boolean).forEach(line => {
      const parts = line.includes('\t') ? line.split('\t') : line.split(',');
      const numCells = parts.slice(1);
      // A comma inside a numeric cell only survives tab-split lines; on comma-split
      // lines a stray comma shows up as extra numeric cells (>2 after the item).
      const hasInlineComma = line.includes('\t') && numCells.some(c => /\d,\d/.test(String(c)));
      const commaSplitExtra = !line.includes('\t') && numCells.length > 2;
      if (hasInlineComma || commaSplitExtra) flagged.push(line);
    });
    if (flagged.length > 0) {
      Modal.confirm({
        title: `${flagged.length} row(s) contain a comma in the numbers`,
        width: 620,
        okText: 'Remove commas & parse',
        content: (
          <div style={{ fontSize: 12 }}>
            <p>These rows have thousands-commas (e.g. <b>10,000</b>) that would be misread. Confirm to strip the commas and parse them as whole numbers.</p>
            <pre style={{ fontSize: 11, background: '#f5f5f5', padding: 8, borderRadius: 6, maxHeight: 220, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
{flagged.join('\n')}
            </pre>
          </div>
        ),
        onOk: () => setPastedRows(parsePasteText(pasteText)),
      });
      return;
    }
    setPastedRows(parsePasteText(pasteText));
  };

  const handleParseExcel = (file: File) => {
    import('xlsx').then(XLSX => {
      const reader = new FileReader();
      reader.onload = e => {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        const parsed: PastedItem[] = rows
          .slice(1)
          .filter((r: any[]) => r[0])
          .map((r: any[], i: number) => {
            const itemNumber = String(r[0] ?? '').trim().toUpperCase();
            const { qty, price } = parseQtyPrice(r.slice(1));
            return { key: `xl-${i}-${itemNumber}`, itemNumber, qty, price, status: 'pending' as const };
          })
          .filter(r => r.itemNumber);
        setPastedRows(parsed);
        setPasteText('');
      };
      reader.readAsArrayBuffer(file);
    });
    return false;
  };

  const handleValidatePasted = async () => {
    if (pastedRows.length === 0 || !header?.shipToOrg) return;
    setImportValidating(true);
    setAddItemApiUrl('Validating items using itemsV2…');

    const org = header.shipToOrg;
    const itemNumbers = Array.from(new Set(pastedRows.map(r => r.itemNumber)));
    const fusionMap = new Map<string, any>();

    // Validate all items using itemsV2 in parallel (up to 8 concurrent requests)
    let idx = 0;
    const worker = async () => {
      while (idx < itemNumbers.length) {
        const num = itemNumbers[idx++];
        const url = `${FUSION_BASE}/itemsV2?q=OrganizationCode=${org};ItemNumber=${encodeURIComponent(num)}&limit=1&onlyData=true`;
        setAddItemApiUrl(`GET itemsV2?q=OrganizationCode=${org};ItemNumber=${num}&limit=1&onlyData=true`);
        try {
          const r = await fetch(url, { headers: FUSION_HDRS });
          if (r.ok) {
            const d = await r.json();
            const it = (d.items ?? [])[0];
            if (it?.ItemNumber) {
              fusionMap.set(String(it.ItemNumber).toUpperCase(), it);
            }
          }
        } catch { /* ignore this item */ }
      }
    };

    await Promise.all(Array.from({ length: Math.min(8, itemNumbers.length) }, worker));

    // Update rows with validation results
    const rows = pastedRows.map(r => {
      const f = fusionMap.get(r.itemNumber.toUpperCase());
      if (!f) return { ...r, status: 'invalid' as PastedItem['status'] };

      // Normalize the Fusion item onto the item-master shape used downstream.
      const matchedItem = {
        item_number: f.ItemNumber,
        description: f.ItemDescription ?? '',
        primary_uom_code: f.PrimaryUOMValue ?? f.PrimaryUnitOfMeasure ?? '',
        uom: f.PrimaryUOMValue ?? f.PrimaryUnitOfMeasure ?? '',
        _source: 'fusion',
      };
      return { ...r, status: 'valid' as PastedItem['status'], matchedItem };
    });

    setPastedRows(rows);
    setImportValidating(false);
    setAddItemApiUrl('');
  };

  // Apply the pasted rows. overwrite=true updates qty/price on lines already on
  // the PO; either way, items not yet on the PO are appended.
  const applyPastedItems = (overwrite: boolean) => {
    const valid = pastedRows.filter(r => r.status === 'valid');
    if (valid.length === 0) return;
    const byNum = new Map(valid.map(r => [r.itemNumber, r]));
    const existing = new Set(lines.map(l => l.itemNumber));
    const added = valid.filter(r => !existing.has(r.itemNumber)).length;
    const updated = overwrite ? valid.length - added : 0;

    setLines(prev => {
      const patched = prev.map(l => {
        const r = byNum.get(l.itemNumber);
        if (!r || !overwrite) return l;
        return computeLine({ ...l, qty: r.qty > 0 ? r.qty : l.qty, price: r.price });
      });
      const onPo = new Set(prev.map(l => l.itemNumber));
      const appended = valid.filter(r => !onPo.has(r.itemNumber)).map((r, i) => computeLine({
        key: `${r.itemNumber}-${Date.now()}-${i}`,
        lineNum: 0,
        itemNumber: r.itemNumber,
        description: String(r.matchedItem?.description ?? ''),
        uom: String(r.matchedItem?.primary_uom_code ?? r.matchedItem?.uom ?? ''),
        qty: r.qty > 0 ? r.qty : 1, price: r.price, taxPct: defaultTaxPct,
        needBy: needByAll, promisedDate: null, chargeAccount: '', destinationType: 'Inventory',
      }));
      return [...patched, ...appended].map((l, i) => ({ ...l, lineNum: i + 1 }));
    });
    setAddItemOpen(false);
    message.success(`${added} item(s) added${updated ? `, ${updated} updated` : ''}`);
  };

  const handleAddPastedItems = () => {
    const valid = pastedRows.filter(r => r.status === 'valid');
    if (valid.length === 0) return;
    const dup = valid.filter(r => existingItemNumbers.has(r.itemNumber)).length;
    if (dup > 0) {
      Modal.confirm({
        title: 'Some items are already on this PO',
        content: `${dup} of the ${valid.length} pasted item(s) already exist on this purchase order. Overwrite their quantity & price with the pasted values, or add only the new items?`,
        okText: 'Overwrite existing',
        cancelText: 'Add new only',
        width: 460,
        onOk:     () => applyPastedItems(true),
        onCancel: () => applyPastedItems(false),
      });
    } else {
      applyPastedItems(true);
    }
  };

  const existingItemNumbers = new Set(lines.map(l => l.itemNumber));
  const filteredItems = items.filter(item => {
    if (!searchTerm) return true;
    const t = searchTerm.toLowerCase();
    return String(item.item_number ?? '').toLowerCase().includes(t) ||
      String(item.description ?? '').toLowerCase().includes(t);
  });

  const handleAddItems = () => {
    const toAdd = items.filter(item =>
      selectedItemKeys.includes(String(item.item_number)) &&
      !existingItemNumbers.has(String(item.item_number)));
    const base = lines.length;
    setLines(prev => [...prev, ...toAdd.map((item, i) => computeLine({
      key: `${item.item_number}-${Date.now()}-${i}`,
      lineNum: base + i + 1,
      itemNumber: String(item.item_number ?? ''), description: String(item.description ?? ''),
      uom: String(item.primary_uom_code ?? item.uom ?? ''),
      qty: 1, price: 0, taxPct: defaultTaxPct,
      needBy: needByAll, promisedDate: null, chargeAccount: '', destinationType: 'Inventory',
    }))]);
    setAddItemOpen(false);
  };

  /* ─── Column defs ─────────────────────────────────── */
  const itemTableCols: ColumnsType<any> = [
    { title: 'Item Number', dataIndex: 'item_number', width: 140, render: v => <Text style={{ fontSize: 12, fontWeight: 600, color: C.blue }}>{v ?? '—'}</Text> },
    {
      title: 'Description', dataIndex: 'description',
      render: v => (
        <Text style={{ fontSize: 12, whiteSpace: 'normal', wordBreak: 'break-word' }}>{v ?? '—'}</Text>
      ),
    },
    { title: 'UOM', dataIndex: 'primary_uom_code', width: 70, align: 'center' as const, render: v => v ?? '—' },
    { title: 'Status', dataIndex: 'inventory_item_status_code', width: 90, render: v => v ?? '—' },
    { title: 'Price', dataIndex: 'item_price', width: 100, align: 'right' as const, render: _v => <Text style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12, color: C.textLight }}>0.00</Text> },
    { title: 'Brand', dataIndex: 'attr1', width: 100, ellipsis: true, render: v => v ?? '—' },
    { title: 'Category', dataIndex: 'attr5', width: 100, ellipsis: true, render: v => v ?? '—' },
  ];

  const rowSel: TableRowSelection<any> = {
    selectedRowKeys: selectedItemKeys,
    onChange: keys => setSelectedItemKeys(keys as string[]),
    getCheckboxProps: r => ({ disabled: existingItemNumbers.has(String(r.item_number)) }),
  };

  const lineCols: ColumnsType<POLine> = [
    { title: '#', dataIndex: 'lineNum', width: 46, align: 'center' as const, render: v => <Text style={{ color: C.textMid, fontSize: 12 }}>{v}</Text> },
    { title: 'Item', dataIndex: 'itemNumber', width: 130, render: v => v
      ? <Tooltip title="View item details"><a style={{ fontWeight: 600, color: C.blue, fontSize: 12 }} onClick={() => showItemDetail(v)}>{v}</a></Tooltip>
      : <Text style={{ fontSize: 12 }}>—</Text> },
    { title: 'Description', dataIndex: 'description', ellipsis: true, render: v => <Text style={{ fontSize: 12 }}>{v}</Text> },
    { title: 'UOM', dataIndex: 'uom', width: 60, align: 'center' as const },
    { title: 'Qty', dataIndex: 'qty', width: 90, align: 'right' as const, render: (v, r) => <InputNumber size="small" value={v} min={0} precision={4} style={{ width: 80 }} onChange={val => handleLineChange(r.key, 'qty', val ?? 0)} /> },
    { title: 'Unit Price', dataIndex: 'price', width: 110, align: 'right' as const, render: (v, r) => <InputNumber size="small" value={v} min={0} precision={4} style={{ width: 100 }} onChange={val => handleLineChange(r.key, 'price', val ?? 0)} /> },
    { title: 'Amount', dataIndex: 'lineTotal', width: 110, align: 'right' as const, render: v => <Text style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>{fmt(v)}</Text> },
    { title: 'Tax %', dataIndex: 'taxPct', width: 80, align: 'right' as const, render: (v, r) => <InputNumber size="small" value={v} min={0} max={100} precision={2} style={{ width: 70 }} onChange={val => handleLineChange(r.key, 'taxPct', val ?? 0)} /> },
    { title: 'Tax Amt', dataIndex: 'taxAmount', width: 100, align: 'right' as const, render: v => <Text style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>{fmt(v)}</Text> },
    { title: 'Net Total', dataIndex: 'netTotal', width: 120, align: 'right' as const, render: v => <Text strong style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12, color: C.red }}>{fmt(v)}</Text> },
    { title: <span><span style={{ color: C.red, marginRight: 2 }}>*</span>Need By</span>, dataIndex: 'needBy', width: 135, render: (v, r) => <DatePicker size="small" value={v} status={v ? undefined : 'error'} onChange={d => handleLineChange(r.key, 'needBy', d)} style={{ width: 125 }} format="D-MMM-YYYY" /> },
    { title: 'Assign to Inventory Org', key: 'assignOrg', width: 250, render: (_: any, r: POLine) => (
      <Space size={4}>
        <Select size="small" style={{ width: 130 }} value={r.assignOrg} placeholder="Org" allowClear
          showSearch optionFilterProp="label"
          options={inventoryOrgs.map(o => ({ label: `${o.OrganizationCode}${o.OrganizationName ? ' — ' + o.OrganizationName : ''}`, value: o.OrganizationCode }))}
          onChange={val => patchLine(r.key, { assignOrg: val, assignStatus: 'idle', assignMsg: '' })} />
        <Button size="small" type="primary" ghost loading={r.assignStatus === 'pending'} disabled={!r.assignOrg}
          onClick={() => assignItemToOrg(r)}>Assign</Button>
        <Tooltip title="Show assignment JSON (itemsV2)">
          <Button size="small" type="text" icon={<ApiOutlined />} disabled={!r.assignOrg} onClick={() => previewAssign(r)} />
        </Tooltip>
        {r.assignStatus === 'success' && <Tooltip title={r.assignMsg}><CheckCircleOutlined style={{ color: C.green }} /></Tooltip>}
        {r.assignStatus === 'error'   && <Tooltip title={r.assignMsg}><CloseCircleOutlined style={{ color: C.red }} /></Tooltip>}
      </Space>
    ) },
    { title: '', key: 'del', width: 46, align: 'center' as const, render: (_: any, r: POLine) => <Tooltip title="Remove"><Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={() => handleDeleteLine(r.key)} /></Tooltip> },
  ];

  const scheduleCols: ColumnsType<POLine> = [
    { title: 'Line', dataIndex: 'lineNum', width: 46, align: 'center' as const,
      render: v => <Text style={{ color: C.textMid, fontSize: 12 }}>{v}</Text> },
    { title: 'Sch', width: 46, align: 'center' as const,
      render: () => <Tag color="blue" style={{ fontSize: 10, margin: 0 }}>1</Tag> },
    { title: 'Item', dataIndex: 'itemNumber', width: 120,
      render: v => <Text style={{ fontWeight: 600, fontSize: 12, color: C.blue }}>{v}</Text> },
    { title: 'Description', dataIndex: 'description', ellipsis: true,
      render: v => <Text style={{ fontSize: 12 }}>{v}</Text> },
    { title: 'Qty', dataIndex: 'qty', width: 75, align: 'right' as const,
      render: v => <Text style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>{fmt(v)}</Text> },
    { title: 'UOM', dataIndex: 'uom', width: 60, align: 'center' as const },
    { title: 'Ship To', width: 80, align: 'center' as const,
      render: () => <Tag color="cyan" style={{ fontSize: 10, margin: 0 }}>{header?.shipToOrg ?? '—'}</Tag> },
    { title: 'Ship To Org', width: 120,
      render: () => {
        const org = inventoryOrgs.find(o => o.OrganizationCode === header?.shipToOrg);
        return <Text style={{ fontSize: 11, color: C.textMid }}>{org?.OrganizationName ?? '—'}</Text>;
      } },
    { title: <span><span style={{ color: C.red, marginRight: 2 }}>*</span>Requested Delivery</span>, dataIndex: 'needBy', width: 155,
      render: (v, r) => <DatePicker size="small" value={v} status={v ? undefined : 'error'} onChange={d => handleLineChange(r.key, 'needBy', d)} style={{ width: 145 }} format="D-MMM-YYYY" /> },
    { title: 'Dest Type', dataIndex: 'destinationType', width: 100,
      render: v => <Tag color={v === 'Expense' ? 'orange' : 'green'} style={{ fontSize: 10 }}>
        {v === 'Expense' ? 'EXPENSE' : 'INVENTORY'}
      </Tag> },
    { title: 'Match', width: 80, align: 'center' as const,
      render: () => <Tag color="purple" style={{ fontSize: 10, margin: 0 }}>3 Way</Tag> },
    { title: 'Invoice Match', width: 90, align: 'center' as const,
      render: () => <Text style={{ fontSize: 11, color: C.textMid }}>Order</Text> },
    { title: 'Receipt Routing', width: 120,
      render: () => <Text style={{ fontSize: 11, color: C.textMid }}>Direct delivery</Text> },
    { title: 'Accrue', width: 60, align: 'center' as const,
      render: () => <Tag color="green" style={{ fontSize: 10, margin: 0 }}>Y</Tag> },
    { title: 'Inspect', width: 60, align: 'center' as const,
      render: () => <Tag color="green" style={{ fontSize: 10, margin: 0 }}>Y</Tag> },
  ];

  const distCols: ColumnsType<POLine> = [
    { title: 'Line', dataIndex: 'lineNum', width: 46, align: 'center' as const,
      render: v => <Text style={{ color: C.textMid, fontSize: 12 }}>{v}</Text> },
    { title: 'Sch', width: 46, align: 'center' as const,
      render: () => <Tag color="blue" style={{ fontSize: 10, margin: 0 }}>1</Tag> },
    { title: 'Dist', width: 46, align: 'center' as const,
      render: () => <Tag color="purple" style={{ fontSize: 10, margin: 0 }}>1</Tag> },
    { title: 'Item', dataIndex: 'itemNumber', width: 120,
      render: v => <Text style={{ fontWeight: 600, fontSize: 12, color: C.blue }}>{v}</Text> },
    { title: 'Description', dataIndex: 'description', ellipsis: true,
      render: v => <Text style={{ fontSize: 12 }}>{v}</Text> },
    { title: 'Destination Type', dataIndex: 'destinationType', width: 130,
      render: (v, r) => (
        <Select size="small" value={v} style={{ width: 120 }}
          onChange={val => handleLineChange(r.key, 'destinationType', val)}>
          <Option value="Inventory">Inventory</Option>
          <Option value="Expense">Expense</Option>
        </Select>
      ) },
    { title: 'Deliver-to Location', width: 120, align: 'center' as const,
      render: () => <Tag color="cyan" style={{ fontSize: 10, margin: 0 }}>{header?.shipToOrg ?? '—'}</Tag> },
    { title: 'Qty', dataIndex: 'qty', width: 75, align: 'right' as const,
      render: v => <Text style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>{fmt(v)}</Text> },
    { title: 'UOM', dataIndex: 'uom', width: 60, align: 'center' as const },
    { title: 'Ordered', dataIndex: 'lineTotal', width: 110, align: 'right' as const,
      render: v => <Text style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>{fmt(v)}</Text> },
    { title: 'PO Charge Account', dataIndex: 'chargeAccount', width: 200,
      render: (v, r) => <Input size="small" value={v} placeholder="e.g. 001-2050000-VLA-000"
        onChange={e => handleLineChange(r.key, 'chargeAccount', e.target.value)} /> },
  ];

  /* ─── Summary box component ─────────────────────── */

  /* ═══════════════════════════════════════════════════ */
  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: C.bg }}>
      <Content>

        {/* ── Init Modal ──────────────────────────────── */}
        <Modal open={showInitModal}
          title={
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingRight: 8 }}>
              <Text strong style={{ fontSize: 15 }}>New Purchase Order</Text>
              <Tooltip title="API Inspector — view web services called in this dialog">
                <Button size="small" icon={<ApiOutlined />}
                  style={{ borderColor: C.blue, color: C.blue, fontSize: 11, marginLeft: 12 }}
                  onClick={() => setInitApiOpen(true)}>
                  API
                </Button>
              </Tooltip>
            </div>
          }
          width={680} closable={false} maskClosable={false}
          styles={{ body: { padding: '12px 20px' } }}
          footer={
            <Space>
              <Button onClick={exit}>Cancel</Button>
              <Button type="primary" loading={initConfirmLoading} onClick={handleInitSubmit}
                style={{ background: C.red, borderColor: C.red, fontWeight: 600 }}>
                Create PO
              </Button>
            </Space>
          }>
          {lovLoading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}><Spin tip="Loading…" /></div>
          ) : (
            <Form form={headerForm} layout="vertical" size="small"
              initialValues={{ orderDate: dayjs() }}
              style={{ '--form-item-margin-bottom': '8px' } as React.CSSProperties}>
              <style>{`.ant-form-item { margin-bottom: 8px !important; }`}</style>
              <Tabs size="small" defaultActiveKey="header" items={[
                {
                  key: 'header',
                  label: 'Header',
                  children: (
                    <>
                      <Divider orientation={"left" as any} plain style={{ fontSize: 11, color: C.textMid, margin: '4px 0 8px' }}>Organization & Order</Divider>
              <Row gutter={[12, 0]}>
                <Col span={12}>
                  <Form.Item name="procurementBU" label="Procurement BU" rules={[{ required: true }]}>
                    <Select showSearch allowClear placeholder="Select Procurement BU" optionFilterProp="label"
                      onChange={handleProcurementBuChange}
                      options={busUnits.map(bu => ({
                        value: bu.bu_name ?? '',
                        label: bu.bu_name ?? '',
                        cc:  bu.bu_code ?? '',
                        ccy: bu.functional_currency ?? '',
                      }))}
                      optionRender={(opt) => (
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 500 }}>{opt.data.label}</div>
                          {(opt.data.cc || opt.data.ccy) && (
                            <div style={{ fontSize: 11, color: C.textLight, marginTop: 1 }}>
                              {opt.data.cc && <span>Code: <strong>{opt.data.cc}</strong></span>}
                              {opt.data.cc && opt.data.ccy && <span style={{ margin: '0 6px' }}>·</span>}
                              {opt.data.ccy && <span>CCY: <strong>{opt.data.ccy}</strong></span>}
                            </div>
                          )}
                        </div>
                      )}
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="billTo" label="Bill To BU" rules={[{ required: true }]}>
                    <Select showSearch allowClear placeholder="Select Bill To" optionFilterProp="label"
                      disabled={!selectedBuCompanyCode}
                      options={busUnits.map(bu => ({ value: bu.bu_name ?? '', label: bu.bu_name ?? '' }))}
                    />
                  </Form.Item>
                </Col>
                {selectedBuCompanyCode && (
                  <Col span={24}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, padding: '6px 10px', background: '#f0f5ff', borderRadius: 6, border: '1px solid #d6e4ff' }}>
                      <BuildOutlined style={{ color: C.blue, fontSize: 13 }} />
                      <Text style={{ fontSize: 12, color: C.textMid }}>Company Code:</Text>
                      <Text strong style={{ fontSize: 13, color: C.blue, fontFamily: 'monospace' }}>{selectedBuCompanyCode}</Text>
                    </div>
                  </Col>
                )}
                {selectedBuBaseCurrency && (
                  <Col span={12}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, padding: '6px 10px', background: '#f0f5ff', borderRadius: 6, border: '1px solid #d6e4ff' }}>
                      <DollarOutlined style={{ color: C.blue, fontSize: 13 }} />
                      <Text style={{ fontSize: 12, color: C.textMid }}>Base Currency:</Text>
                      <Text strong style={{ fontSize: 13, color: C.blue, fontFamily: 'monospace' }}>{selectedBuBaseCurrency}</Text>
                    </div>
                  </Col>
                )}
                {fxRate && headerForm.getFieldValue('currency') && headerForm.getFieldValue('currency') !== selectedBuBaseCurrency && (
                  <Col span={12}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, padding: '6px 10px', background: '#f0f5ff', borderRadius: 6, border: '1px solid #d6e4ff' }}>
                      <SwapOutlined style={{ color: C.blue, fontSize: 13 }} />
                      <Text style={{ fontSize: 12, color: C.textMid }}>Conversion Rate:</Text>
                      <Text strong style={{ fontSize: 13, color: C.blue, fontFamily: 'monospace' }}>1 {headerForm.getFieldValue('currency')} = {fxRate.rate.toFixed(4)} {selectedBuBaseCurrency}</Text>
                    </div>
                  </Col>
                )}
                <Col span={8}>
                  <Form.Item name="orderDate" label="Order Date" rules={[{ required: true }]}>
                    <DatePicker style={{ width: '100%' }} format="D-MMM-YYYY" disabled={!selectedBuCompanyCode} />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item name="docType" label="Document Type" rules={[{ required: true }]}>
                    <Select showSearch allowClear placeholder="Select type" optionFilterProp="children" disabled={!selectedBuCompanyCode}>
                      <Option value="LPON">LPON</Option>
                      <Option value="IPON">IPON</Option>
                      <Option value="STANDARD">STANDARD</Option>
                      <Option value="BLANKET">BLANKET</Option>
                    </Select>
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item name="currency" label="Currency" rules={[{ required: true }]}>
                    <Select showSearch allowClear placeholder="Select or type currency" filterOption={false}
                      disabled={!selectedBuCompanyCode}
                      onSearch={val => setCurrencyInput(val)} onBlur={() => setCurrencyInput('')}
                      onChange={v => { if (v) fetchFxRate(String(v)); else setFxRate(null); }}>
                      {currencyInput.trim() && !currencies.find(c => String(c.code ?? '').toLowerCase() === currencyInput.trim().toLowerCase()) && (
                        <Option key={`__custom__${currencyInput}`} value={currencyInput.trim().toUpperCase()}>
                          <span style={{ color: C.blue, fontStyle: 'italic' }}>Use: {currencyInput.trim().toUpperCase()}</span>
                        </Option>
                      )}
                      {currencies.filter(c => !currencyInput.trim() ||
                        String(c.code ?? '').toLowerCase().includes(currencyInput.toLowerCase()) ||
                        (c.name ?? '').toLowerCase().includes(currencyInput.toLowerCase())
                      ).map(c => <Option key={c.code} value={c.code}>{c.code}{c.name ? ` — ${c.name}` : ''}</Option>)}
                    </Select>
                  </Form.Item>
                </Col>
              </Row>
              <Row gutter={[12, 0]}>
                <Col span={24}>
                  <Form.Item label="Purchase Order Number" name="poNumber">
                    <Input
                      placeholder="Leave blank to auto-generate"
                      style={{ fontFamily: 'monospace', fontWeight: 600 }}
                      allowClear
                      disabled={!selectedBuCompanyCode}
                    />
                  </Form.Item>
                </Col>
              </Row>
              <Divider orientation={"left" as any} plain style={{ fontSize: 11, color: C.textMid, margin: '4px 0 8px' }}>Supplier</Divider>
              <Row gutter={[12, 0]}>
                <Col span={12}>
                  <Form.Item label="Supplier" required>
                    <Space>
                      <Button size="small" icon={<SearchOutlined />}
                        disabled={!selectedBuCompanyCode}
                        onClick={() => { setSupplierModalOpen(true); setSupplierSearch(''); setSupplierResults([]); }}>
                        Select Supplier
                      </Button>
                      {selectedSupplier && <Tag color="blue" style={{ fontSize: 12 }}>{selectedSupplier.Supplier}</Tag>}
                    </Space>
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="supplierSite" label="Supplier Site">
                    <Select showSearch allowClear placeholder="Select supplier site" loading={sitesLoading} optionFilterProp="children" disabled={!selectedBuCompanyCode}>
                      {supplierSites.map(ss => <Option key={ss.SupplierSiteId ?? ss.SupplierSite} value={ss.SupplierSite}>{ss.SupplierSite}</Option>)}
                    </Select>
                  </Form.Item>
                </Col>
              </Row>
              <Divider orientation={"left" as any} plain style={{ fontSize: 11, color: C.textMid, margin: '4px 0 8px' }}>Ship To</Divider>
              <Row gutter={[12, 0]}>
                <Col span={12}>
                  <Form.Item name="shipToOrg" label="Ship To Organization" rules={[{ required: true }]}>
                    <Select showSearch allowClear placeholder="Select organization" optionFilterProp="children" onChange={handleShipToOrgChange} disabled={!selectedBuCompanyCode}>
                      {filteredInventoryOrgs.map(org => <Option key={org.OrganizationCode} value={org.OrganizationCode}>{org.OrganizationCode}{org.OrganizationName ? ` — ${org.OrganizationName}` : ''}</Option>)}
                    </Select>
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="subinventory" label="Subinventory" rules={[{ required: true }]}>
                    <Select showSearch allowClear placeholder="Select subinventory" optionFilterProp="children" disabled={!selectedBuCompanyCode}>
                      {subinventories.map(sub => <Option key={sub.subinventory_code} value={sub.subinventory_code}>{sub.subinventory_code}{sub.subinventory_name ? ` — ${sub.subinventory_name}` : ''}</Option>)}
                    </Select>
                  </Form.Item>
                </Col>
              </Row>
                    </>
                  )
                },
                {
                  key: 'terms',
                  label: 'Terms',
                  children: (
                    <>
                      <Row gutter={[12, 0]}>
                        <Col span={12}>
                          <Form.Item name="paymentTerms" label="Payment Terms">
                            <Input placeholder="e.g. CR30D" disabled={!selectedBuCompanyCode} />
                          </Form.Item>
                        </Col>
                        <Col span={12}>
                          <Form.Item name="shippingMethod" label="Shipping Method">
                            <Input placeholder="e.g. FOB" disabled={!selectedBuCompanyCode} />
                          </Form.Item>
                        </Col>
                        <Col span={12}>
                          <Form.Item name="freightTerms" label="Freight Terms">
                            <Input placeholder="Optional" disabled={!selectedBuCompanyCode} />
                          </Form.Item>
                        </Col>
                        <Col span={12}>
                          <Form.Item name="fob" label="FOB">
                            <Input placeholder="Optional" disabled={!selectedBuCompanyCode} />
                          </Form.Item>
                        </Col>
                      </Row>
                    </>
                  )
                },
                {
                  key: 'notes',
                  label: 'Notes & Attachments',
                  children: (
                    <>
                      <Row gutter={[12, 0]}>
                        <Col span={24}>
                          <Form.Item name="noteToSupplier" label="Note to Supplier">
                            <Input.TextArea rows={3} placeholder="Optional note to supplier…" disabled={!selectedBuCompanyCode} />
                          </Form.Item>
                        </Col>
                      </Row>
                    </>
                  )
                },
              ]} />
            </Form>
          )}
        </Modal>

        {/* ── Init Modal API Inspector ─────────────────── */}
        <Modal
          open={initApiOpen}
          onCancel={() => setInitApiOpen(false)}
          footer={<Button onClick={() => setInitApiOpen(false)}>Close</Button>}
          width={760}
          title={<Space><ApiOutlined style={{ color: C.blue }} /><Text strong>New PO Dialog — Web Services</Text></Space>}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {[
              {
                label: 'Business Units (Procurement BU / Bill To BU)',
                method: 'GET', tag: 'blue',
                url: `${FUSION_BASE}/payablesOptions?onlyData=true&limit=500&fields=businessUnitId,businessUnitName,paymentCurrency,ledgerCurrency`,
                note: 'Oracle Fusion: list of business units with default Currency — used to populate BU dropdowns and auto-fill currency on selection',
                source: 'Oracle Fusion REST',
              },
              {
                label: 'Currencies',
                method: 'GET', tag: 'blue',
                url: `${GL_ORDS_BASE}/currencies?enabled=Y`,
                note: 'Re-ERP ORDS: active currencies for the currency dropdown',
                source: 'ORDS / Re-ERP',
              },
              {
                label: 'Inventory Organizations (Ship To Org)',
                method: 'GET', tag: 'blue',
                url: `${FUSION_BASE}/inventoryOrganizations?onlyData=true&limit=500`,
                note: 'Oracle Fusion: list of inventory organizations filtered by Procurement BU for ship-to selection',
                source: 'Oracle Fusion REST',
              },
              {
                label: 'Subinventories',
                method: 'GET', tag: 'blue',
                url: `${FUSION_BASE}/subinventories?q=OrganizationCode=<code>&onlyData=true&limit=500`,
                note: 'Oracle Fusion: warehouse sub-inventory codes, filtered by selected ship-to org',
                source: 'Oracle Fusion REST',
              },
            ].map((api, i) => (
              <div key={i} style={{ padding: '10px 14px', borderRadius: 8, border: `1px solid #e5e5e5`, background: '#fafafa' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <Tag color={api.tag} style={{ fontWeight: 700, fontSize: 11 }}>{api.method}</Tag>
                  <Text strong style={{ fontSize: 13 }}>{api.label}</Text>
                  <Tag style={{ marginLeft: 'auto', fontSize: 10 }}>{api.source}</Tag>
                </div>
                <div style={{ fontFamily: 'monospace', fontSize: 11, color: C.blue, wordBreak: 'break-all', padding: '6px 10px', background: '#f0f5ff', borderRadius: 5, marginBottom: 6 }}>
                  {api.url}
                </div>
                <Text style={{ fontSize: 12, color: C.textMid }}>{api.note}</Text>
              </div>
            ))}
            <div style={{ padding: '8px 14px', borderRadius: 8, border: `1px solid #e5e5e5`, background: '#fafafa' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <Tag color="orange" style={{ fontWeight: 700, fontSize: 11 }}>GET</Tag>
                <Text strong style={{ fontSize: 13 }}>Supplier Search (on-demand)</Text>
                <Tag style={{ marginLeft: 'auto', fontSize: 10 }}>Oracle Fusion REST</Tag>
              </div>
              <div style={{ fontFamily: 'monospace', fontSize: 11, color: C.blue, wordBreak: 'break-all', padding: '6px 10px', background: '#f0f5ff', borderRadius: 5, marginBottom: 6 }}>
                {`${FUSION_BASE}/suppliers?q=Supplier LIKE '*<term>*'&limit=20`}
              </div>
              <Text style={{ fontSize: 12, color: C.textMid }}>Fired when searching for a supplier — called live with the typed search term</Text>
            </div>
            <div style={{ padding: '8px 14px', borderRadius: 8, border: `1px solid #e5e5e5`, background: '#fafafa' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <Tag color="orange" style={{ fontWeight: 700, fontSize: 11 }}>GET</Tag>
                <Text strong style={{ fontSize: 13 }}>Supplier Sites (on-demand)</Text>
                <Tag style={{ marginLeft: 'auto', fontSize: 10 }}>Oracle Fusion REST</Tag>
              </div>
              <div style={{ fontFamily: 'monospace', fontSize: 11, color: C.blue, wordBreak: 'break-all', padding: '6px 10px', background: '#f0f5ff', borderRadius: 5, marginBottom: 6 }}>
                {`${FUSION_BASE}/suppliers/<supplierId>/child/sites?limit=100`}
              </div>
              <Text style={{ fontSize: 12, color: C.textMid }}>Fired after a supplier is selected — loads available sites for that supplier</Text>
            </div>
          </div>
        </Modal>

        {/* ── Main PO Page ─────────────────────────────── */}
        {header && (
          <>
            {/* Page header bar */}
            <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: '12px 24px' }}>
              <Breadcrumb style={{ marginBottom: 6 }} items={[
                { title: <Link to="/home"><HomeOutlined /> Home</Link> },
                { title: <Link to="/procurement">Fusion Supply Chain</Link> },
                { title: <Link to="/procurement/purchase-orders">Purchase Orders</Link> },
              ]} />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <Space align="center" size={10}>
                  <Title level={5} style={{ margin: 0, color: C.text }}>{header.poNumber}</Title>
                  <Tag color="orange" style={{ fontSize: 11, fontWeight: 600 }}>{header.status}</Tag>
                  <Tag color="geekblue" style={{ fontSize: 11 }}>{header.docType}</Tag>
                  {editMode && <Tag color="purple" style={{ fontSize: 11, fontWeight: 600 }} icon={<EditOutlined />}>
                    Editing from Fusion{editLoading ? ' — loading…' : ''}
                  </Tag>}
                </Space>
                <Space>
                  <input ref={jsonInputRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={handleLoadJsonFile} />
                  <Dropdown
                    menu={{ items: [
                      { key: 'save', icon: <DownloadOutlined />, label: 'Save to JSON', onClick: () => { const n = savePoJson(); if (n) message.success(`Saved ${n}`); } },
                      { key: 'load', icon: <FolderOpenOutlined />, label: 'Load from JSON…', onClick: () => jsonInputRef.current?.click() },
                    ] }}>
                    <Button icon={<CodeOutlined />}>JSON Actions <DownOutlined /></Button>
                  </Dropdown>
                  <Tooltip title={poHeaderId ? 'Oracle Fusion lifecycle actions on this PO' : 'Save the PO to Fusion first to enable these actions'}>
                    <Dropdown
                      disabled={!poHeaderId}
                      menu={{ items: [
                        { key: 'submit',  label: 'Submit for Approval', onClick: () => submitForApproval() },
                        { type: 'divider' },
                        { key: 'cancel',  danger: true, label: 'Cancel Document', onClick: () => confirmPoAction('Cancel Document', 'cancelDocument') },
                        { key: 'hold',    label: 'Hold', onClick: () => confirmPoAction('Hold', 'holdDocument') },
                        { key: 'release', label: 'Release Hold', onClick: () => confirmPoAction('Release Hold', 'releaseHoldDocument') },
                        { key: 'ack',     label: 'Acknowledge', onClick: () => confirmPoAction('Acknowledge', 'acknowledgeDocument') },
                        { type: 'divider' },
                        { key: 'close',      label: 'Close', onClick: () => confirmPoAction('Close', 'closeDocument') },
                        { key: 'closeInv',   label: 'Close for Invoicing', onClick: () => confirmPoAction('Close for Invoicing', 'closeForInvoicing') },
                        { key: 'closeRcv',   label: 'Close for Receiving', onClick: () => confirmPoAction('Close for Receiving', 'closeForReceiving') },
                        { key: 'finalClose', danger: true, label: 'Finally Close', onClick: () => confirmPoAction('Finally Close', 'finallyCloseDocument') },
                        { key: 'reopen',     label: 'Reopen', onClick: () => confirmPoAction('Reopen', 'reopenDocument') },
                        { type: 'divider' },
                        ...(editMode ? [{ key: 'deleteLines', danger: true, icon: <DeleteOutlined />, label: `Delete All Lines${lines.length ? ` (${lines.length})` : ''}`, onClick: () => deleteAllLines() }] : []),
                        { key: 'deletePo', danger: true, icon: <DeleteOutlined />, label: 'Delete Purchase Order', onClick: () => deletePoFromFusion() },
                        { key: 'custom', icon: <ApiOutlined />, label: 'Custom action…', onClick: () => { setCustomActionName(''); setCustomActionResource('purchaseOrders'); setCustomActionOpen(true); } },
                      ] }}>
                      <Button icon={<ThunderboltOutlined />} loading={!!poActionLoading}>PO Actions <DownOutlined /></Button>
                    </Dropdown>
                  </Tooltip>
                  <Button danger onClick={() => setDiscardConfirmOpen(true)}>Discard</Button>
                  <Tooltip title={editMode ? 'Show the Save Changes operations (POST/PATCH per line)' : 'Show JSON (Oracle Fusion create request body)'}>
                    <Button
                      icon={<CodeOutlined />}
                      onClick={editMode ? () => { setEditOps(buildEditOps()); setEditOpResults({}); setEditJsonOpen(true); } : handleCreateInFusion}
                      style={{ background: C.blue, borderColor: C.blue, color: '#fff', fontWeight: 600 }}
                    />
                  </Tooltip>
                  <Button
                    icon={<FileTextOutlined />}
                    disabled={lines.length === 0}
                    onClick={handleGeneratePDF}
                    style={{ background: C.purple, borderColor: C.purple, color: '#fff', fontWeight: 600 }}
                  >
                    Generate PDF
                  </Button>
                  {editMode ? (
                    <Button type="primary" icon={<SaveOutlined />} loading={savingEdit} onClick={saveEditChanges}
                      style={{ background: C.red, borderColor: C.red, fontWeight: 600 }}>
                      Save Changes
                    </Button>
                  ) : (
                    <Button type="primary" icon={<SaveOutlined />} loading={generatePoLoading} onClick={handleGeneratePO}
                      style={{ background: C.red, borderColor: C.red, fontWeight: 600 }}>
                      Save Purchase Order
                    </Button>
                  )}
                  <Tooltip title={poHeaderId ? 'Submit this draft for approval in Oracle Fusion' : 'Save the purchase order first — that creates the draft in Fusion and returns its ID to approve'}>
                    <Button icon={<CheckCircleOutlined />} loading={approvingFusion} disabled={!poHeaderId}
                      onClick={() => submitForApproval()}
                      style={{ background: poHeaderId ? C.green : undefined, borderColor: poHeaderId ? C.green : undefined, color: poHeaderId ? '#fff' : undefined, fontWeight: 600 }}>
                      Submit for Approval
                    </Button>
                  </Tooltip>
                  <Tooltip title="Close this tab">
                    <Button icon={<CloseOutlined />} onClick={exit}>Close</Button>
                  </Tooltip>
                </Space>
              </div>
            </div>

            <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>

              {/* ── Header card ─────────────────────────── */}
              <div style={{
                background: C.surface, borderRadius: 10,
                boxShadow: '0 1px 6px rgba(0,0,0,0.09)',
                overflow: 'hidden',
                border: `1px solid ${C.border}`,
              }}>
                {/* Document banner — top strip */}
                <div style={{
                  background: 'linear-gradient(90deg, #2D2D2D 0%, #3C3C3C 100%)',
                  padding: '14px 20px',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Purchase Order</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {editingPoNum ? (
                          <Space.Compact>
                            <Input
                              autoFocus
                              size="small"
                              value={poNumDraft}
                              onChange={e => setPoNumDraft(e.target.value)}
                              onPressEnter={commitPoNum}
                              placeholder="Paste / type order number"
                              style={{ width: 240, fontFamily: 'monospace' }}
                            />
                            <Tooltip title="Apply"><Button size="small" type="primary" icon={<CheckOutlined />} onClick={commitPoNum} /></Tooltip>
                            <Tooltip title="Cancel"><Button size="small" icon={<CloseOutlined />} onClick={() => setEditingPoNum(false)} /></Tooltip>
                          </Space.Compact>
                        ) : (
                          <>
                            <span style={{ fontSize: 18, fontWeight: 700, color: '#fff', letterSpacing: '0.02em', fontFamily: 'monospace' }}>{header.poNumber}</span>
                            <Tooltip title="Edit / paste order number">
                              <Button
                                type="text"
                                size="small"
                                icon={<EditOutlined />}
                                onClick={startEditPoNum}
                                style={{ color: 'rgba(255,255,255,0.65)', padding: '0 4px', height: 22, minWidth: 22 }}
                              />
                            </Tooltip>
                            <Tooltip title="Get next number from Oracle Fusion">
                              <Button
                                type="text"
                                size="small"
                                icon={<SyncOutlined spin={nextPoLoading} />}
                                loading={nextPoLoading}
                                onClick={() => fetchNextPoNumber(true)}
                                style={{ color: 'rgba(255,255,255,0.65)', padding: '0 4px', height: 22, minWidth: 22 }}
                              />
                            </Tooltip>
                          </>
                        )}
                      </div>
                    </div>
                    <div style={{ width: 1, height: 32, background: 'rgba(255,255,255,0.15)' }} />
                    <Tag color="orange" style={{ fontWeight: 700, fontSize: 11 }}>{header.status}</Tag>
                    <Tag style={{ fontWeight: 600, fontSize: 11, background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff' }}>{header.docType}</Tag>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'rgba(255,255,255,0.60)', fontSize: 12 }}>
                      <CalendarOutlined /> {header.orderDate.format('D-MMM-YYYY')}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'rgba(255,255,255,0.60)', fontSize: 12 }}>
                      <UserOutlined /> {header.buyer}
                    </div>
                    <Tag style={{ fontWeight: 700, fontSize: 12, background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff' }}>{header.currency}</Tag>
                  </div>
                  <Button
                    size="small"
                    icon={<SearchOutlined />}
                    loading={orgQohLoading}
                    onClick={() => { queryOrgQOH(); }}
                    style={{
                      background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.3)',
                      color: '#fff', fontWeight: 600, fontSize: 12,
                    }}
                  >
                    Org On Hand
                  </Button>
                </div>

                {/* Three zones */}
                <style>{`
                  .po-header-zone .ant-select-selection-item,
                  .po-header-zone .ant-select-selector,
                  .po-header-zone .ant-select-arrow,
                  .po-header-zone .ant-select-clear {
                    color: #333333 !important;
                  }
                  .po-header-zone .ant-btn-link {
                    color: #C74634 !important;
                  }
                `}</style>
                <div className="po-header-zone" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 280px' }}>

                  {/* Zone 1 — Organization */}
                  <div style={{ padding: '16px 20px', borderRight: `1px solid ${C.border}` }}>
                    <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: C.blue, marginBottom: 12 }}>
                      Organization
                    </div>
                    <FieldPair label="Procurement BU" value={
                      <Select size="small" variant="borderless" showSearch optionFilterProp="children"
                        value={header.procurementBU} style={{ width: '100%', marginLeft: -7, color: C.text }}
                        onChange={v => patch({ procurementBU: v, requisitioningBU: v })}>
                        {busUnits.map(bu => <Option key={bu.business_unit_id ?? bu.bu_id ?? bu.bu_name} value={bu.bu_name ?? bu.BusinessUnitName}>{bu.bu_name ?? bu.BusinessUnitName}</Option>)}
                      </Select>
                    } />
                    <FieldPair label="Requisitioning BU" value={
                      <Select size="small" variant="borderless" showSearch optionFilterProp="children"
                        value={header.requisitioningBU} style={{ width: '100%', marginLeft: -7, color: C.text }}
                        onChange={v => patch({ requisitioningBU: v })}>
                        {busUnits.map(bu => <Option key={`rq-${bu.business_unit_id ?? bu.bu_id ?? bu.bu_name}`} value={bu.bu_name ?? bu.BusinessUnitName}>{bu.bu_name ?? bu.BusinessUnitName}</Option>)}
                      </Select>
                    } />
                    <FieldPair label="Bill-to BU" value={
                      <Select size="small" variant="borderless" showSearch optionFilterProp="children"
                        value={header.billToBU} style={{ width: '100%', marginLeft: -7, color: C.text }}
                        onChange={v => patch({ billToBU: v })}>
                        {busUnits.map(bu => <Option key={`bt-${bu.business_unit_id ?? bu.bu_id ?? bu.bu_name}`} value={bu.bu_name ?? bu.BusinessUnitName}>{bu.bu_name ?? bu.BusinessUnitName}</Option>)}
                      </Select>
                    } />
                    <FieldPair label="Ship-to Org" value={
                      <Select size="small" variant="borderless" showSearch optionFilterProp="children"
                        value={header.shipToOrg} style={{ width: '100%', marginLeft: -7, color: C.text }}
                        onChange={v => {
                          patch({ shipToOrg: v, subinventory: '', shipToLocation: v });
                          setSubinventories(allSubinventories.filter((s: any) => s.warehouse_code === v));
                        }}>
                        {inventoryOrgs.map(org => <Option key={org.OrganizationCode} value={org.OrganizationCode}>{org.OrganizationCode}{org.OrganizationName ? ` — ${org.OrganizationName}` : ''}</Option>)}
                      </Select>
                    } />
                    <FieldPair label="Subinventory" value={
                      <Select size="small" variant="borderless" showSearch optionFilterProp="children" allowClear
                        value={header.subinventory || undefined} style={{ width: '100%', marginLeft: -7, color: C.text }}
                        onChange={v => patch({ subinventory: v ?? '' })}>
                        {subinventories.map(sub => <Option key={sub.subinventory_code} value={sub.subinventory_code}>{sub.subinventory_code}</Option>)}
                      </Select>
                    } />
                    <FieldPair label="Buyer"
                      value={<InlineEdit value={header.buyer === 'Current User' ? '' : header.buyer} onChange={v => patch({ buyer: v })} placeholder="e.g. emp, arun" />} />
                    <FieldPair label="Description"
                      value={<InlineEdit value={header.description} onChange={v => patch({ description: v })} placeholder="Enter description…" />} />
                  </div>

                  {/* Zone 2 — Supplier */}
                  <div style={{ padding: '16px 20px', borderRight: `1px solid ${C.border}` }}>
                    <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: C.teal, marginBottom: 12 }}>
                      Supplier
                    </div>
                    <FieldPair label="Supplier"
                      value={
                        <Space size={6}>
                          <Text strong style={{ color: C.text, fontSize: 13 }}>{header.supplierName}</Text>
                          <Button type="link" size="small" style={{ padding: 0, fontSize: 11, height: 'auto', color: C.red }}
                            onClick={() => { setSupplierModalOpen(true); setSupplierSearch(''); setSupplierResults([]); }}>
                            Change
                          </Button>
                        </Space>
                      } />
                    <FieldPair label="Site" value={
                      <Select size="small" variant="borderless" showSearch optionFilterProp="children" allowClear
                        value={header.supplierSite || undefined} loading={sitesLoading} style={{ width: '100%', marginLeft: -7, color: C.text }}
                        onChange={v => patch({ supplierSite: v ?? '' })}>
                        {supplierSites.map(ss => <Option key={ss.SupplierSiteId ?? ss.SupplierSite} value={ss.SupplierSite}>{ss.SupplierSite}</Option>)}
                      </Select>
                    } />
                    <FieldPair label="Contact"
                      value={<InlineEdit value={header.supplierContact} onChange={v => patch({ supplierContact: v })} placeholder="—" />} />
                    <FieldPair label="Comm. Method"
                      value={
                        <Select size="small" value={header.communicationMethod} style={{ width: 120, marginLeft: -7, color: C.text }} variant="borderless"
                          onChange={v => patch({ communicationMethod: v })}>
                          <Option value="E-Mail">E-Mail</Option>
                          <Option value="Fax">Fax</Option>
                          <Option value="Print">Print</Option>
                        </Select>
                      } />
                    <FieldPair label="Email"
                      value={<InlineEdit value={header.communicationEmail} onChange={v => patch({ communicationEmail: v })} placeholder="—" />} />
                    <FieldPair label="Bill-to Location"
                      value={<InlineEdit value={header.billToLocation} onChange={v => patch({ billToLocation: v })} />} />
                    <FieldPair label="Ship-to Location"
                      value={<InlineEdit value={header.shipToLocation} onChange={v => patch({ shipToLocation: v })} />} />
                  </div>

                  {/* Zone 3 — Financials */}
                  <div style={{ padding: '16px 20px', background: '#FAFBFF' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: C.red, marginBottom: 12 }}>
                      Order Totals
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text style={{ fontSize: 12, color: C.textMid }}>Ordered</Text>
                        <Text style={{ fontVariantNumeric: 'tabular-nums', fontSize: 13, fontWeight: 600 }}>{fmt(subtotal)}</Text>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text style={{ fontSize: 12, color: C.textMid }}>Total Tax</Text>
                        <Text style={{ fontVariantNumeric: 'tabular-nums', fontSize: 13, color: C.orange }}>{fmt(totalTax)}</Text>
                      </div>
                      <div style={{ borderTop: `2px solid ${C.border}`, paddingTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text strong style={{ fontSize: 13 }}>Total</Text>
                        <Text strong style={{ fontVariantNumeric: 'tabular-nums', fontSize: 18, color: C.red }}>{fmt(grandTotal)}</Text>
                      </div>
                      <Text style={{ fontSize: 11, color: C.textLight, textAlign: 'right', marginTop: -4 }}>{header.currency}</Text>
                    </div>
                    <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 12, paddingTop: 12 }}>
                      <FieldPair label="Currency" value={
                        <Select size="small" variant="borderless" showSearch allowClear filterOption={false}
                          value={header.currency} style={{ width: '100%', marginLeft: -7, color: C.text }}
                          onSearch={val => setCurrencyInput(val)} onBlur={() => setCurrencyInput('')}
                          onChange={v => { patch({ currency: v }); fetchFxRate(v ?? ''); }}>
                          {currencyInput.trim() && !currencies.find(c => String(c.code ?? '').toLowerCase() === currencyInput.trim().toLowerCase()) && (
                            <Option key={`__custom__${currencyInput}`} value={currencyInput.trim().toUpperCase()}>
                              <span style={{ color: C.blue, fontStyle: 'italic' }}>Use: {currencyInput.trim().toUpperCase()}</span>
                            </Option>
                          )}
                          {currencies.filter(c => !currencyInput.trim() ||
                            String(c.code ?? '').toLowerCase().includes(currencyInput.toLowerCase()) ||
                            (c.name ?? '').toLowerCase().includes(currencyInput.toLowerCase())
                          ).map(c => <Option key={c.code} value={c.code}>{c.code}{c.name ? ` — ${c.name}` : ''}</Option>)}
                        </Select>
                      } />
                      {baseCurrency && (
                        <div style={{ fontSize: 11, color: C.textMid, marginBottom: 8, paddingLeft: 7 }}>
                          <DollarOutlined style={{ color: C.blue, marginRight: 4 }} />
                          Base Currency: <Text strong style={{ color: C.blue, fontFamily: 'monospace' }}>{baseCurrency}</Text>
                        </div>
                      )}
                      {/* Conversion rate display */}
                      {fxRateLoading && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 7 }}>
                          <Spin size="small" />
                          <Text style={{ fontSize: 11, color: C.textLight }}>Fetching rate…</Text>
                        </div>
                      )}
                      {fxRate && !fxRateLoading && (
                        <div style={{
                          background: '#EBF5FF', border: `1px solid ${C.blue}40`,
                          borderRadius: 5, padding: '6px 10px', marginBottom: 8,
                        }}>
                          <div style={{ fontSize: 10, color: C.textLight, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>
                            Conversion Rate · {fxRate.rateType}
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Text strong style={{ fontSize: 13, color: C.blue, fontVariantNumeric: 'tabular-nums' }}>
                              1 {header.currency} = {fxRate.rate.toFixed(4)} {baseCurrency}
                            </Text>
                          </div>
                          <div style={{ fontSize: 10, color: C.textLight, marginTop: 2 }}>
                            Inverse: 1 {baseCurrency} = {fxRate.inverseRate > 0 ? fxRate.inverseRate.toFixed(6) : (1 / fxRate.rate).toFixed(6)} {header.currency}
                            &nbsp;·&nbsp;{fxRate.rateDate ? dayjs(fxRate.rateDate).format('D-MMM-YYYY') : ''}
                          </div>
                          {grandTotal > 0 && (
                            <div style={{ borderTop: `1px solid ${C.blue}30`, marginTop: 4, paddingTop: 4, fontSize: 11, color: C.textMid }}>
                              PO Total ≈ <Text strong style={{ color: C.teal }}>{fmt(grandTotal * fxRate.rate)} {baseCurrency}</Text>
                            </div>
                          )}
                        </div>
                      )}
                      {!fxRate && !fxRateLoading && header.currency && header.currency !== baseCurrency && (
                        <div style={{ fontSize: 11, color: C.orange, marginBottom: 6 }}>
                          No rate found for {header.currency} → {baseCurrency}
                        </div>
                      )}
                      <FieldPair label="Source Agreement"
                        value={<InlineEdit value="" onChange={() => {}} placeholder="—" />} />
                      <FieldPair label="Supplier Order"
                        value={<InlineEdit value="" onChange={() => {}} placeholder="—" />} />
                    </div>
                  </div>
                </div>
              </div>

              {/* ── Lines ───────────────────────────────── */}
              <Card size="small" style={{ borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}
                title={
                  <Space wrap>
                    <Button type="primary" size="small" icon={<PlusOutlined />} onClick={openAddItem}
                      style={{ background: C.green, borderColor: C.green }}>Add Item</Button>
                    {(() => { const n = lines.filter(l => l.poLineId == null).length; return (
                      <Tooltip title="Remove lines added but not yet saved to Fusion (saved lines are untouched)">
                        <Button size="small" danger icon={<DeleteOutlined />} disabled={n === 0} onClick={clearUnsavedLines}>
                          Clear Unsaved{n ? ` (${n})` : ''}
                        </Button>
                      </Tooltip>
                    ); })()}
                    <Divider type="vertical" />
                    <Text style={{ fontSize: 12, color: C.textMid }}>Need By for All:</Text>
                    <DatePicker size="small" value={needByAll} onChange={handleNeedByAllChange} format="D-MMM-YYYY" placeholder="Pick date" style={{ width: 130 }} />
                    <Text style={{ fontSize: 12, color: C.textMid }}>Default Tax %:</Text>
                    <InputNumber size="small" value={defaultTaxPct} min={0} max={100} precision={2} style={{ width: 72 }} onChange={val => setDefaultTaxPct(val ?? 0)} />
                    <Divider type="vertical" />
                    <Text style={{ fontSize: 12, color: C.textMid }}>Assign all to Inventory Org:</Text>
                    <Select size="small" value={bulkAssignOrg} onChange={setBulkAssignOrg} placeholder="Select org"
                      allowClear showSearch optionFilterProp="label" style={{ width: 190 }}
                      options={inventoryOrgs.map(o => ({ label: `${o.OrganizationCode}${o.OrganizationName ? ' — ' + o.OrganizationName : ''}`, value: o.OrganizationCode }))} />
                    <Button size="small" type="primary" ghost icon={<ApiOutlined />} loading={bulkAssigning}
                      disabled={!bulkAssignOrg || lines.length === 0} onClick={assignAllToOrg}>Assign All</Button>
                  </Space>
                }
              >
                <Tabs size="small" defaultActiveKey="lines"
                  items={[
                    {
                      key: 'lines',
                      label: <Badge count={lines.length} size="small" offset={[6, 0]} color={C.blue}><span style={{ paddingRight: 8 }}>Lines</span></Badge>,
                      children: (
                        <Table columns={lineCols} dataSource={lines} rowKey="key" size="small" bordered
                          pagination={false} scroll={{ x: 1350 }}
                          rowClassName={(_, i) => i % 2 !== 0 ? 'po-row-alt' : ''}
                          locale={{ emptyText: <div style={{ padding: 28, color: C.textLight, textAlign: 'center' }}>No lines yet. Click "Add Item" to begin.</div> }}
                          summary={() => lines.length > 0 ? (
                            <Table.Summary.Row style={{ background: '#EBF0FA', fontWeight: 600 }}>
                              <Table.Summary.Cell index={0} colSpan={6} />
                              <Table.Summary.Cell index={6} align="right"><Text strong style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(subtotal)}</Text></Table.Summary.Cell>
                              <Table.Summary.Cell index={7} />
                              <Table.Summary.Cell index={8} align="right"><Text strong style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(totalTax)}</Text></Table.Summary.Cell>
                              <Table.Summary.Cell index={9} align="right"><Text strong style={{ fontVariantNumeric: 'tabular-nums', color: C.red }}>{fmt(grandTotal)}</Text></Table.Summary.Cell>
                              <Table.Summary.Cell index={10} colSpan={3} />
                            </Table.Summary.Row>
                          ) : null}
                        />
                      ),
                    },
                    {
                      key: 'schedules', label: 'Schedules',
                      children: (
                        <Table columns={scheduleCols} dataSource={lines} rowKey="key" size="small" bordered
                          pagination={false} scroll={{ x: 900 }} rowClassName={(_, i) => i % 2 !== 0 ? 'po-row-alt' : ''}
                          locale={{ emptyText: <div style={{ padding: 28, color: C.textLight, textAlign: 'center' }}>No schedules yet.</div> }} />
                      ),
                    },
                    {
                      key: 'distributions', label: 'Distributions',
                      children: (
                        <Table columns={distCols} dataSource={lines} rowKey="key" size="small" bordered
                          pagination={false} scroll={{ x: 1000 }} rowClassName={(_, i) => i % 2 !== 0 ? 'po-row-alt' : ''}
                          locale={{ emptyText: <div style={{ padding: 28, color: C.textLight, textAlign: 'center' }}>No distributions yet.</div> }} />
                      ),
                    },
                    {
                      key: 'qoh',
                      label: 'Check On Hand',
                      children: (
                        <div>
                          {/* Toolbar */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
                            <Button
                              type="primary"
                              icon={<SearchOutlined />}
                              loading={qohLoading}
                              disabled={lines.length === 0}
                              onClick={queryQOH}
                              style={{ background: C.teal, borderColor: C.teal, fontWeight: 600 }}
                            >
                              Query QOH
                            </Button>
                            {header && (
                              <Text style={{ fontSize: 12, color: C.textMid }}>
                                Org: <Text strong>{header.shipToOrg}</Text>
                                {header.subinventory && <> · Sub: <Text strong>{header.subinventory}</Text></>}
                              </Text>
                            )}
                            {qohLoading && qohProgress.total > 0 && (
                              <div style={{ flex: 1, maxWidth: 300 }}>
                                <Progress
                                  percent={Math.round((qohProgress.done / qohProgress.total) * 100)}
                                  size="small"
                                  status="active"
                                  format={() => `${qohProgress.done} / ${qohProgress.total}`}
                                />
                              </div>
                            )}
                          </div>

                          {/* Results table */}
                          {lines.length === 0 ? (
                            <div style={{ padding: 28, textAlign: 'center', color: C.textLight }}>Add lines first, then click Query QOH.</div>
                          ) : (
                            <Table
                              size="small"
                              bordered
                              pagination={false}
                              rowKey="key"
                              dataSource={lines}
                              rowClassName={(r, i) => {
                                const q = qohData[r.itemNumber];
                                if (q && q.onhand !== null && q.onhand < r.qty) return 'qoh-low';
                                return i % 2 !== 0 ? 'po-row-alt' : '';
                              }}
                              columns={[
                                { title: '#', dataIndex: 'lineNum', width: 46, align: 'center' as const, render: v => <Text style={{ color: C.textMid, fontSize: 12 }}>{v}</Text> },
                                { title: 'Item Number', dataIndex: 'itemNumber', width: 150, render: v => <Text style={{ fontWeight: 600, fontSize: 12 }}>{v}</Text> },
                                { title: 'Description', dataIndex: 'description', ellipsis: true, render: v => <Text style={{ fontSize: 12 }}>{v}</Text> },
                                { title: 'UOM', dataIndex: 'uom', width: 65, align: 'center' as const },
                                {
                                  title: 'PO Qty', dataIndex: 'qty', width: 90, align: 'right' as const,
                                  render: v => <Text style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>{fmt(v)}</Text>,
                                },
                                {
                                  title: 'On Hand Qty', width: 130, align: 'right' as const,
                                  render: (_: any, r: POLine) => {
                                    const q = qohData[r.itemNumber];
                                    if (!q && !qohLoading) return <Text style={{ color: C.textLight, fontSize: 12 }}>—</Text>;
                                    if (!q && qohLoading) return <Spin size="small" />;
                                    if (q.error) return <Text style={{ color: C.red, fontSize: 12 }}>Error</Text>;
                                    return (
                                      <Text strong style={{
                                        fontVariantNumeric: 'tabular-nums', fontSize: 13,
                                        color: q.onhand === 0 ? C.red : q.onhand < r.qty ? C.orange : C.green,
                                      }}>
                                        {fmt(q.onhand)}
                                      </Text>
                                    );
                                  },
                                },
                                {
                                  title: 'Status', width: 110, align: 'center' as const,
                                  render: (_: any, r: POLine) => {
                                    const q = qohData[r.itemNumber];
                                    if (!q) return null;
                                    if (q.error) return <Tag color="error">API Error</Tag>;
                                    if (q.onhand === 0) return <Tag color="red">Out of Stock</Tag>;
                                    if (q.onhand < r.qty) return <Tag color="orange">Low Stock</Tag>;
                                    return <Tag color="green">Available</Tag>;
                                  },
                                },
                                {
                                  title: 'Difference', width: 110, align: 'right' as const,
                                  render: (_: any, r: POLine) => {
                                    const q = qohData[r.itemNumber];
                                    if (!q || q.onhand === null) return null;
                                    const diff = q.onhand - r.qty;
                                    return (
                                      <Text style={{
                                        fontVariantNumeric: 'tabular-nums', fontSize: 12,
                                        color: diff < 0 ? C.red : C.green, fontWeight: 600,
                                      }}>
                                        {diff >= 0 ? '+' : ''}{fmt(diff)}
                                      </Text>
                                    );
                                  },
                                },
                              ]}
                              summary={() => {
                                const queried = lines.filter(l => qohData[l.itemNumber] && !qohData[l.itemNumber].error);
                                if (queried.length === 0) return null;
                                const lowCount = queried.filter(l => qohData[l.itemNumber].onhand < l.qty).length;
                                const okCount = queried.filter(l => qohData[l.itemNumber].onhand >= l.qty).length;
                                return (
                                  <Table.Summary.Row style={{ background: '#F0F7FF' }}>
                                    <Table.Summary.Cell index={0} colSpan={4}>
                                      <Text style={{ fontSize: 11, color: C.textMid }}>
                                        {queried.length} item{queried.length !== 1 ? 's' : ''} queried
                                      </Text>
                                    </Table.Summary.Cell>
                                    <Table.Summary.Cell index={4} colSpan={4} align="right">
                                      <Space size={16}>
                                        <Text style={{ fontSize: 11, color: C.green }}>✓ {okCount} available</Text>
                                        {lowCount > 0 && <Text style={{ fontSize: 11, color: C.orange }}>⚠ {lowCount} low/out</Text>}
                                      </Space>
                                    </Table.Summary.Cell>
                                  </Table.Summary.Row>
                                );
                              }}
                            />
                          )}
                          <style>{`.qoh-low { background: #FFF8F0 !important; }`}</style>
                        </div>
                      ),
                    },
                    {
                      key: 'org-qoh',
                      label: 'Onhand in Organization',
                      children: (
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
                            <Button
                              type="primary"
                              icon={<SearchOutlined />}
                              loading={orgQohLoading}
                              onClick={queryOrgQOH}
                              style={{ background: C.purple, borderColor: C.purple, fontWeight: 600 }}
                            >
                              Fetch Org On Hand
                            </Button>
                            <Tooltip title={orgQohApiUrl ? 'Show API URL' : 'No API call yet'}>
                              <Button
                                size="small"
                                type="text"
                                icon={<ApiOutlined style={{ color: orgQohApiUrl ? C.blue : C.textLight, fontSize: 16 }} />}
                                onClick={() => orgQohApiUrl && setOrgQohApiModalOpen(true)}
                              />
                            </Tooltip>
                            {header && (
                              <Text style={{ fontSize: 12, color: C.textMid }}>
                                Org: <Text strong>{header.shipToOrg || '—'}</Text>
                                {header.subinventory && <> · Sub: <Text strong>{header.subinventory}</Text></>}
                              </Text>
                            )}
                            {orgQohFetched && (
                              <Text style={{ fontSize: 12, color: C.textMid }}>
                                {orgQohRows.length} record{orgQohRows.length !== 1 ? 's' : ''} found
                              </Text>
                            )}
                            {orgQohFetched && orgQohRows.length > 0 && (
                              <Input
                                size="small"
                                placeholder="Filter by item / subinventory…"
                                value={orgQohFilter}
                                onChange={e => setOrgQohFilter(e.target.value)}
                                allowClear
                                prefix={<SearchOutlined style={{ color: C.textLight }} />}
                                style={{ width: 240 }}
                              />
                            )}
                          </div>
                          {!orgQohFetched ? (
                            <div style={{ padding: 28, textAlign: 'center', color: C.textLight }}>
                              Click "Fetch Org On Hand" to load all balances for the selected organization.
                            </div>
                          ) : (() => {
                            const f = orgQohFilter.toLowerCase();
                            const displayRows = f
                              ? orgQohRows.filter(r =>
                                  String(r.ItemNumber ?? '').toLowerCase().includes(f) ||
                                  String(r.ItemDescription ?? '').toLowerCase().includes(f) ||
                                  String(r.SubinventoryCode ?? '').toLowerCase().includes(f) ||
                                  String(r.Locator ?? '').toLowerCase().includes(f)
                                )
                              : orgQohRows;
                            return (
                              <Table
                                size="small"
                                bordered
                                rowKey={(_, i) => String(i)}
                                dataSource={displayRows}
                                pagination={{ pageSize: 20, showSizeChanger: true, showTotal: t => `${t} records` }}
                                scroll={{ x: 1000 }}
                                rowClassName={(_, i) => i % 2 !== 0 ? 'po-row-alt' : ''}
                                columns={[
                                  {
                                    title: 'Item Number', dataIndex: 'ItemNumber', width: 160,
                                    render: v => <Text style={{ fontWeight: 700, fontSize: 12, fontFamily: 'monospace', color: C.blue }}>{v ?? '—'}</Text>,
                                  },
                                  {
                                    title: 'Description', dataIndex: 'ItemDescription', ellipsis: true,
                                    render: v => <Text style={{ fontSize: 12 }}>{v ?? '—'}</Text>,
                                  },
                                  {
                                    title: 'Subinventory', dataIndex: 'SubinventoryCode', width: 130,
                                    render: v => <Tag color="cyan" style={{ fontWeight: 600 }}>{v ?? '—'}</Tag>,
                                  },
                                  {
                                    title: 'Locator', dataIndex: 'Locator', width: 130, ellipsis: true,
                                    render: v => <Text style={{ fontSize: 11, color: C.textMid }}>{v ?? '—'}</Text>,
                                  },
                                  {
                                    title: 'On Hand Qty', dataIndex: 'PrimaryQuantity', width: 120, align: 'right' as const,
                                    sorter: (a: any, b: any) => (a.PrimaryQuantity ?? 0) - (b.PrimaryQuantity ?? 0),
                                    render: v => {
                                      const n = parseFloat(v ?? 0) || 0;
                                      return (
                                        <Tag color={n > 100 ? 'green' : n > 0 ? 'blue' : 'default'}
                                          style={{ fontWeight: 700, minWidth: 48, textAlign: 'center' }}>
                                          {n}
                                        </Tag>
                                      );
                                    },
                                  },
                                  {
                                    title: 'Consigned', dataIndex: 'ConsignedQuantity', width: 100, align: 'right' as const,
                                    render: v => <Text style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12, color: C.textMid }}>{v ?? 0}</Text>,
                                  },
                                  {
                                    title: 'UOM', dataIndex: 'PrimaryUOMCode', width: 65, align: 'center' as const,
                                    render: v => <Text style={{ fontSize: 11 }}>{v ?? '—'}</Text>,
                                  },
                                  {
                                    title: 'Status', dataIndex: 'MaterialStatus', width: 90,
                                    render: v => <Tag color={v === 'Active' ? 'green' : 'default'}>{v ?? '—'}</Tag>,
                                  },
                                ]}
                              />
                            );
                          })()}
                        </div>
                      ),
                    },
                    /* ── Acquisition Cost tab ────────────────── */
                    {
                      key: 'acq-cost',
                      label: (
                        <Badge count={acqCharges.length} size="small" offset={[6, 0]} color={C.orange}>
                          <span style={{ paddingRight: acqCharges.length ? 8 : 0 }}>Acquisition Cost</span>
                        </Badge>
                      ),
                      children: (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

                          {/* ── Charge entry ── */}
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                              <div>
                                <Text strong style={{ fontSize: 13 }}>Charges</Text>
                                <Text style={{ fontSize: 11, color: C.textLight, marginLeft: 8 }}>
                                  Add freight, insurance, customs duties and other charges
                                </Text>
                              </div>
                              <Button size="small" type="primary" icon={<PlusOutlined />}
                                style={{ background: C.orange, borderColor: C.orange, fontWeight: 600 }}
                                onClick={addAcqCharge}>
                                Add Charge
                              </Button>
                            </div>

                            {acqCharges.length === 0 ? (
                              <div style={{ padding: '24px 0', textAlign: 'center', color: C.textLight,
                                border: `1px dashed ${C.border}`, borderRadius: 8 }}>
                                No charges yet. Click "Add Charge" to add freight, insurance or other costs.
                              </div>
                            ) : (
                              <Table size="small" bordered dataSource={acqCharges} rowKey="key" pagination={false}
                                columns={[
                                  {
                                    title: 'Charge Type', dataIndex: 'chargeType', width: 160,
                                    render: (v, r: AcqCharge) => (
                                      <Select size="small" value={v} style={{ width: '100%' }}
                                        onChange={val => updateAcqCharge(r.key, 'chargeType', val)}>
                                        {ACQ_CHARGE_TYPES.map(t => <Option key={t} value={t}>{t}</Option>)}
                                      </Select>
                                    ),
                                  },
                                  {
                                    title: 'Description', dataIndex: 'description',
                                    render: (v, r: AcqCharge) => (
                                      <Input size="small" value={v} placeholder="Optional description"
                                        onChange={e => updateAcqCharge(r.key, 'description', e.target.value)} />
                                    ),
                                  },
                                  {
                                    title: 'Currency', dataIndex: 'currency', width: 110,
                                    render: (v, r: AcqCharge) => (
                                      <Select size="small" value={v} style={{ width: '100%' }}
                                        showSearch optionFilterProp="children"
                                        onChange={val => updateAcqCharge(r.key, 'currency', val)}>
                                        {currencies.map(c => (
                                          <Option key={c.code} value={c.code}>{c.code}</Option>
                                        ))}
                                      </Select>
                                    ),
                                  },
                                  {
                                    title: 'Amount', dataIndex: 'amount',
                                    width: 140, align: 'right' as const,
                                    render: (v, r: AcqCharge) => (
                                      <InputNumber size="small" value={v} min={0} precision={2}
                                        style={{ width: '100%' }}
                                        onChange={val => updateAcqCharge(r.key, 'amount', val ?? 0)} />
                                    ),
                                  },
                                  {
                                    title: 'Accounted (AED)', dataIndex: 'amount',
                                    width: 160, align: 'right' as const,
                                    render: (_v, r: AcqCharge) => {
                                      const isAED = !r.currency || r.currency === 'AED';
                                      const loading = !isAED && !!acqFxLoading[r.key];
                                      const rateInfo = !isAED ? acqFxRates[r.key] : null;
                                      const hasRate  = isAED || (rateInfo != null && rateInfo.rate > 0);
                                      const accounted = getAccounted(r);
                                      if (loading) {
                                        return <Spin size="small" />;
                                      }
                                      return (
                                        <div style={{ textAlign: 'right' }}>
                                          {hasRate ? (
                                            <Text strong style={{ fontVariantNumeric: 'tabular-nums', fontSize: 13, color: C.teal }}>
                                              {fmt(accounted)}
                                            </Text>
                                          ) : rateInfo !== undefined ? (
                                            <Text style={{ fontSize: 11, color: C.red }}>No rate found</Text>
                                          ) : (
                                            <Text style={{ fontSize: 11, color: C.textLight }}>—</Text>
                                          )}
                                          {!isAED && rateInfo && rateInfo.rate > 0 && (
                                            <div style={{ fontSize: 10, color: C.textLight, marginTop: 1 }}>
                                              1 {r.currency} = {rateInfo.rate.toFixed(4)} AED
                                            </div>
                                          )}
                                          {!isAED && rateInfo && rateInfo.rate > 0 && rateInfo.rateDate && (
                                            <div style={{ fontSize: 10, color: C.textLight }}>
                                              {rateInfo.rateType} · {dayjs(rateInfo.rateDate).format('D-MMM-YY')}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    },
                                  },
                                  {
                                    title: 'Apportion By', dataIndex: 'apportionBasis', width: 150,
                                    render: (v, r: AcqCharge) => (
                                      <Select size="small" value={v} style={{ width: '100%' }}
                                        onChange={val => updateAcqCharge(r.key, 'apportionBasis', val)}>
                                        {ACQ_APPORTION_OPTIONS.map(o => <Option key={o.value} value={o.value}>{o.label}</Option>)}
                                      </Select>
                                    ),
                                  },
                                  {
                                    title: '', key: 'del', width: 46, align: 'center' as const,
                                    render: (_: any, r: AcqCharge) => (
                                      <Tooltip title="Remove"><Button type="text" size="small" danger
                                        icon={<DeleteOutlined />} onClick={() => deleteAcqCharge(r.key)} /></Tooltip>
                                    ),
                                  },
                                ]}
                                summary={() => {
                                  const totalAccounted = acqCharges.reduce((s, c) => s + getAccounted(c), 0);
                                  return (
                                    <Table.Summary.Row style={{ background: '#FFF8F0', fontWeight: 600 }}>
                                      <Table.Summary.Cell index={0} colSpan={3}>
                                        <Text strong style={{ fontSize: 12 }}>Total Charges</Text>
                                      </Table.Summary.Cell>
                                      <Table.Summary.Cell index={3} />
                                      <Table.Summary.Cell index={4} align="right">
                                        <Text strong style={{ color: C.teal, fontVariantNumeric: 'tabular-nums', fontSize: 14 }}>
                                          {fmt(totalAccounted)} AED
                                        </Text>
                                      </Table.Summary.Cell>
                                      <Table.Summary.Cell index={5} colSpan={2} />
                                    </Table.Summary.Row>
                                  );
                                }}
                              />
                            )}
                          </div>

                          {/* ── Allocation results grid ── */}
                          {lines.length > 0 && acqCharges.length > 0 && (
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
                                <Text strong style={{ fontSize: 13 }}>Allocated Cost per Line</Text>
                                <Tag color="orange" style={{ fontSize: 11 }}>
                                  Total Accounted: {fmt(acqCharges.reduce((s, c) => s + getAccounted(c), 0))} AED
                                </Tag>
                                <Tag color="teal" style={{ fontSize: 11 }}>
                                  Total Landed: {fmt(acqResults.reduce((s: number, r: any) => s + r.landedCost, 0))} AED
                                </Tag>
                                <div style={{ marginLeft: 'auto', display: 'flex', gap: 0 }}>
                                  <Button
                                    size="small"
                                    type={!acqViewAccounted ? 'primary' : 'default'}
                                    onClick={() => setAcqViewAccounted(false)}
                                    style={{ borderRadius: '4px 0 0 4px', fontWeight: !acqViewAccounted ? 600 : 400 }}
                                  >
                                    Entered
                                  </Button>
                                  <Button
                                    size="small"
                                    type={acqViewAccounted ? 'primary' : 'default'}
                                    onClick={() => setAcqViewAccounted(true)}
                                    style={{ borderRadius: '0 4px 4px 0', fontWeight: acqViewAccounted ? 600 : 400, background: acqViewAccounted ? C.teal : undefined, borderColor: acqViewAccounted ? C.teal : undefined }}
                                  >
                                    Accounted (AED)
                                  </Button>
                                </div>
                              </div>
                              <Table
                                size="small" bordered
                                rowKey="key"
                                dataSource={acqResults}
                                pagination={false}
                                scroll={{ x: 'max-content' }}
                                rowClassName={(_, i) => i % 2 !== 0 ? 'po-row-alt' : ''}
                                columns={[
                                  {
                                    title: '#', dataIndex: 'lineNum', width: 46, align: 'center' as const,
                                    render: v => <Text style={{ color: C.textMid, fontSize: 12 }}>{v}</Text>,
                                    fixed: 'left' as const,
                                  },
                                  {
                                    title: 'Item', dataIndex: 'itemNumber', width: 140, fixed: 'left' as const,
                                    render: v => <Text style={{ fontWeight: 700, color: C.blue, fontSize: 12, fontFamily: 'monospace' }}>{v}</Text>,
                                  },
                                  {
                                    title: 'Description', dataIndex: 'description', width: 180, ellipsis: true,
                                    render: v => <Text style={{ fontSize: 12 }}>{v}</Text>,
                                  },
                                  { title: 'UOM', dataIndex: 'uom', width: 60, align: 'center' as const },
                                  {
                                    title: 'Qty', dataIndex: 'qty', width: 80, align: 'right' as const,
                                    render: v => <Text style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>{fmt(v)}</Text>,
                                  },
                                  {
                                    title: 'Unit Price', dataIndex: 'price', width: 110, align: 'right' as const,
                                    render: v => <Text style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>{fmt(v)}</Text>,
                                  },
                                  {
                                    title: 'Line Total', dataIndex: 'lineTotal', width: 120, align: 'right' as const,
                                    render: v => <Text style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>{fmt(v)}</Text>,
                                  },
                                  // Dynamic column per charge
                                  ...acqCharges.map(charge => {
                                    const chargeAccounted = getAccounted(charge);
                                    const dispCurrency = acqViewAccounted ? 'AED' : (charge.currency || 'AED');
                                    return {
                                      key: charge.key,
                                      width: 150,
                                      align: 'right' as const,
                                      title: (
                                        <div>
                                          <div style={{ fontWeight: 600, fontSize: 12 }}>{charge.chargeType}</div>
                                          <div style={{ fontSize: 10, color: C.textLight, fontWeight: 400 }}>
                                            {ACQ_APPORTION_OPTIONS.find(o => o.value === charge.apportionBasis)?.label}
                                            {charge.apportionBasis !== 'manual' && (
                                              <span style={{ marginLeft: 4, color: C.orange }}>
                                                ({acqViewAccounted ? fmt(chargeAccounted) : fmt(charge.amount)} {dispCurrency})
                                              </span>
                                            )}
                                          </div>
                                        </div>
                                      ),
                                      render: (_: any, row: any) => {
                                        if (charge.apportionBasis === 'manual') {
                                          return (
                                            <InputNumber size="small" min={0} precision={2} style={{ width: 120 }}
                                              value={charge.manualAmounts[row.key] ?? 0}
                                              onChange={val => updateManualAmount(charge.key, row.key, val ?? 0)} />
                                          );
                                        }
                                        const aedAmt = row.chargeAmounts[charge.key] ?? 0;
                                        const displayAmt = acqViewAccounted
                                          ? aedAmt
                                          : (chargeAccounted > 0 ? (aedAmt / chargeAccounted) * charge.amount : 0);
                                        return (
                                          <Text style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12, color: acqViewAccounted ? C.teal : C.orange }}>
                                            {fmt(displayAmt)}
                                          </Text>
                                        );
                                      },
                                    };
                                  }),
                                  {
                                    title: 'Total Charges', dataIndex: 'totalCharges', width: 130, align: 'right' as const,
                                    render: v => <Text strong style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12, color: C.orange }}>{fmt(v)}</Text>,
                                  },
                                  {
                                    title: 'Landed Cost', dataIndex: 'landedCost', width: 130, align: 'right' as const,
                                    render: v => <Text strong style={{ fontVariantNumeric: 'tabular-nums', fontSize: 13, color: C.teal }}>{fmt(v)}</Text>,
                                  },
                                  {
                                    title: 'Landed Unit Price', dataIndex: 'landedUnitPrice', width: 145, align: 'right' as const,
                                    render: v => <Text strong style={{ fontVariantNumeric: 'tabular-nums', fontSize: 13, color: C.green }}>{fmt(v)}</Text>,
                                  },
                                  {
                                    title: '% Change', dataIndex: 'pctChange', width: 90, align: 'right' as const,
                                    render: (v: number) => (
                                      <Tag color={v === 0 ? 'default' : v > 0 ? 'orange' : 'green'} style={{ fontWeight: 600, fontSize: 11 }}>
                                        {v >= 0 ? '+' : ''}{v.toFixed(2)}%
                                      </Tag>
                                    ),
                                  },
                                ]}
                                summary={() => {
                                  const totalChargesSum = acqResults.reduce((s: number, r: any) => s + r.totalCharges, 0);
                                  const totalLanded     = acqResults.reduce((s: number, r: any) => s + r.landedCost, 0);
                                  return (
                                    <Table.Summary.Row style={{ background: '#EBF0FA', fontWeight: 600 }}>
                                      <Table.Summary.Cell index={0} colSpan={6} align="right">
                                        <Text strong style={{ fontSize: 12 }}>Total</Text>
                                      </Table.Summary.Cell>
                                      <Table.Summary.Cell index={6} align="right">
                                        <Text strong style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(subtotal)}</Text>
                                      </Table.Summary.Cell>
                                      {acqCharges.map((charge, i) => (
                                        <Table.Summary.Cell key={charge.key} index={7 + i} align="right">
                                          <Text strong style={{ fontVariantNumeric: 'tabular-nums', color: C.orange }}>
                                            {fmt(acqResults.reduce((s: number, r: any) => s + (r.chargeAmounts[charge.key] ?? 0), 0))}
                                          </Text>
                                        </Table.Summary.Cell>
                                      ))}
                                      <Table.Summary.Cell index={7 + acqCharges.length} align="right">
                                        <Text strong style={{ fontVariantNumeric: 'tabular-nums', color: C.orange }}>{fmt(totalChargesSum)}</Text>
                                      </Table.Summary.Cell>
                                      <Table.Summary.Cell index={8 + acqCharges.length} align="right">
                                        <Text strong style={{ fontVariantNumeric: 'tabular-nums', fontSize: 14, color: C.teal }}>{fmt(totalLanded)}</Text>
                                      </Table.Summary.Cell>
                                      <Table.Summary.Cell index={9 + acqCharges.length} colSpan={2} />
                                    </Table.Summary.Row>
                                  );
                                }}
                              />
                            </div>
                          )}

                          {lines.length === 0 && (
                            <div style={{ padding: 28, textAlign: 'center', color: C.textLight }}>
                              Add line items first, then define charges to allocate.
                            </div>
                          )}
                        </div>
                      ),
                    },
                  ]}
                />
              </Card>

            </div>
          </>
        )}

        {/* ── Supplier Search Modal ────────────────────── */}
        <Modal open={supplierModalOpen}
          title={<Space><span>Search Supplier</span>
            <Tooltip title="Show last API call">
              <Button size="small" type="text" icon={<ApiOutlined style={{ color: supplierApiUrl ? C.blue : C.textLight }} />}
                onClick={() => supplierApiUrl && setSupplierApiModalOpen(true)} />
            </Tooltip></Space>}
          width={700} onCancel={() => setSupplierModalOpen(false)}
          footer={<Button onClick={() => setSupplierModalOpen(false)}>Close</Button>}>
          <Space style={{ marginBottom: 10 }}>
            <Text style={{ fontSize: 12, color: C.textLight }}>Search by</Text>
            <Segmented size="small" value={supplierSearchBy} onChange={(v) => setSupplierSearchBy(v as 'name' | 'number')}
              options={[{ label: 'Name', value: 'name' }, { label: 'Number', value: 'number' }]} />
          </Space>
          <Space.Compact style={{ width: '100%', marginBottom: 12 }}>
            <Input placeholder={supplierSearchBy === 'number' ? 'Type supplier number to search…' : 'Type supplier name to search…'} value={supplierSearch}
              onChange={e => setSupplierSearch(e.target.value)} onPressEnter={() => handleSupplierSearch(supplierSearch, supplierSearchBy)} allowClear />
            <Button type="primary" icon={<SearchOutlined />} loading={suppliersLoading}
              onClick={() => handleSupplierSearch(supplierSearch, supplierSearchBy)}
              style={{ background: C.red, borderColor: C.red }}>Search</Button>
          </Space.Compact>
          <Table dataSource={supplierResults} rowKey={r => String(r.SupplierId)} size="small" bordered
            loading={suppliersLoading} pagination={{ pageSize: 8, showSizeChanger: false }}
            locale={{ emptyText: `Enter a supplier ${supplierSearchBy} and click Search` }}
            onRow={record => ({ onClick: () => handleSelectSupplier(record), style: { cursor: 'pointer' } })}
            columns={[
              { title: 'Supplier Number', dataIndex: 'SupplierNumber', width: 140, render: v => <Text style={{ fontSize: 12, fontWeight: 600 }}>{v ?? '—'}</Text> },
              { title: 'Supplier Name', dataIndex: 'Supplier', render: v => <Text style={{ fontSize: 12 }}>{v ?? '—'}</Text> },
              { title: 'Type', dataIndex: 'SupplierType', width: 120, render: v => v ?? '—' },
            ]} />
        </Modal>

        <Modal open={supplierApiModalOpen}
          title={<Space><ApiOutlined style={{ color: C.blue }} /><span>Supplier API Call</span></Space>}
          width={620} onCancel={() => setSupplierApiModalOpen(false)}
          footer={<Button onClick={() => setSupplierApiModalOpen(false)}>Close</Button>}>
          <div style={{ background: C.bg, borderRadius: 6, padding: 12, wordBreak: 'break-all' }}>
            <Text copyable style={{ fontFamily: 'monospace', fontSize: 12 }}>{supplierApiUrl}</Text>
          </div>
        </Modal>

        <Modal open={orgQohApiModalOpen}
          title={<Space><ApiOutlined style={{ color: C.blue }} /><span>Org On Hand API Call</span></Space>}
          width={720} onCancel={() => setOrgQohApiModalOpen(false)}
          footer={<Button onClick={() => setOrgQohApiModalOpen(false)}>Close</Button>}>
          <div style={{ marginBottom: 8 }}>
            <Text style={{ fontSize: 12, color: C.textMid }}>
              The <Text code>fetchLOV</Text> helper appends <Text code>&amp;offset=N</Text> and paginates until <Text code>hasMore</Text> is false.
              The base URL (first page) is:
            </Text>
          </div>
          <div style={{ background: C.bg, borderRadius: 6, padding: 12, wordBreak: 'break-all' }}>
            <Text copyable style={{ fontFamily: 'monospace', fontSize: 12 }}>{orgQohApiUrl}</Text>
          </div>
          <div style={{ marginTop: 10 }}>
            <Text style={{ fontSize: 11, color: C.textLight }}>
              Decoded query: <Text code style={{ fontSize: 11 }}>
                {orgQohApiUrl ? decodeURIComponent(orgQohApiUrl.split('?q=')[1]?.split('&')[0] ?? '') : ''}
              </Text>
            </Text>
          </div>
        </Modal>

        {/* ── Add Item Modal ───────────────────────────── */}
        <Modal open={addItemOpen}
          title={
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, paddingRight: 32 }}>
              <Space align="center" size={8}>
                <ShopOutlined style={{ color: C.green }} />
                <span>Add Items — {header?.shipToOrg ?? ''}</span>
                {!itemsLoading && items.length > 0 && (
                  <Tag color="blue" style={{ fontWeight: 600, fontSize: 11 }}>{items.length} items</Tag>
                )}
                {itemCacheTs && !itemsLoading && (
                  <Tag color="default" style={{ fontSize: 10, color: C.textLight }}>
                    cached {dayjs(itemCacheTs).format('D-MMM-YYYY HH:mm')}
                  </Tag>
                )}
              </Space>
              <Space size={6}>
                <Tooltip title="Re-fetch from API and overwrite the cached Excel file">
                  <Button
                    size="small"
                    icon={<UploadOutlined style={{ transform: 'rotate(180deg)' }} />}
                    loading={itemsLoading}
                    onClick={refreshItems}
                    style={{ fontSize: 12 }}
                  >
                    Refresh Items
                  </Button>
                </Tooltip>
                <Tooltip title="Export loaded items to Excel">
                  <Button
                    size="small"
                    icon={<FileTextOutlined />}
                    disabled={items.length === 0 || itemsLoading}
                    onClick={exportItemsExcel}
                    style={{ fontSize: 12 }}
                  >
                    Export Excel
                  </Button>
                </Tooltip>
                <Tooltip title="Open the folder where item cache files are stored">
                  <Button
                    size="small"
                    icon={<BuildOutlined />}
                    onClick={() => eAPI?.openItemsFolder?.()}
                    style={{ fontSize: 12 }}
                  >
                    Open Folder
                  </Button>
                </Tooltip>
              </Space>
            </div>
          }
          width={1000}
          onCancel={() => setAddItemOpen(false)}
          footer={
            <Space>
              <Button onClick={() => setAddItemOpen(false)} icon={<CloseOutlined />}>Cancel</Button>
              {addItemTab === 'browse' ? (
                <Button type="primary" onClick={handleAddItems}
                  disabled={selectedItemKeys.filter(k => !existingItemNumbers.has(k)).length === 0}
                  style={{ background: C.green, borderColor: C.green }}>
                  {selectedItemKeys.filter(k => !existingItemNumbers.has(k)).length > 0
                    ? `Add ${selectedItemKeys.filter(k => !existingItemNumbers.has(k)).length} Item(s)` : 'Add Selected Items'}
                </Button>
              ) : (
                <Space>
                  <Button
                    onClick={handleValidatePasted}
                    loading={importValidating}
                    disabled={pastedRows.length === 0}
                    icon={<SearchOutlined />}
                  >
                    Validate Items
                  </Button>
                  <Button type="primary"
                    onClick={handleAddPastedItems}
                    disabled={pastedRows.filter(r => r.status === 'valid').length === 0}
                    style={{ background: C.green, borderColor: C.green }}>
                    {(() => {
                      const valid = pastedRows.filter(r => r.status === 'valid');
                      const add = valid.filter(r => !existingItemNumbers.has(r.itemNumber)).length;
                      const upd = valid.length - add;
                      if (valid.length === 0) return 'Add Valid Items';
                      if (upd > 0 && add > 0) return `Add ${add} · Update ${upd}`;
                      if (upd > 0) return `Update ${upd} Item(s)`;
                      return `Add ${add} Valid Item(s)`;
                    })()}
                  </Button>
                </Space>
              )}
            </Space>
          }>

          {/* API URL bar */}
          {addItemApiUrl && (
            <Tooltip title="Click to copy API URL">
              <div
                onClick={() => navigator.clipboard?.writeText(addItemApiUrl + '&limit=500&offset=0').catch(() => {})}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10,
                  background: '#0d1117', border: '1px solid #30363d',
                  borderRadius: 5, padding: '5px 10px', cursor: 'copy',
                }}
              >
                <ApiOutlined style={{ color: '#58a6ff', fontSize: 13, flexShrink: 0 }} />
                <span style={{
                  fontFamily: 'monospace', fontSize: 11, color: '#58a6ff',
                  flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {addItemApiUrl}&amp;limit=500&amp;offset=0&nbsp;→&nbsp;
                  {itemsLoading ? 'loading all pages…' : itemCacheTs ? `${items.length} records (from local cache)` : `${items.length} records (all pages fetched)`}
                </span>
              </div>
            </Tooltip>
          )}

          <Tabs
            activeKey={addItemTab}
            onChange={k => setAddItemTab(k as 'browse' | 'import')}
            size="small"
            items={[
              {
                key: 'browse',
                label: 'Browse Items',
                children: (
                  <>
                    <div style={{ marginBottom: 12, display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4, color: C.textMid }}>Search Type</div>
                        <Segmented
                          value={itemSearchType}
                          onChange={v => setItemSearchType(v as 'number' | 'description')}
                          options={[
                            { label: 'Item Number', value: 'number' },
                            { label: 'Description', value: 'description' }
                          ]}
                          style={{ width: '100%' }}
                        />
                      </div>
                      <div style={{ flex: 2 }}>
                        <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4, color: C.textMid }}>
                          {itemSearchType === 'number' ? 'Item Number' : 'Description'}
                        </div>
                        <Input
                          placeholder={itemSearchType === 'number' ? 'Enter item number…' : 'Enter description…'}
                          value={searchTerm}
                          onChange={e => setSearchTerm(e.target.value)}
                          onPressEnter={searchItemsV2}
                          allowClear
                          prefix={<SearchOutlined style={{ color: C.textLight }} />}
                        />
                      </div>
                      <Button
                        type="primary"
                        icon={<SearchOutlined />}
                        loading={itemSearchLoading}
                        onClick={searchItemsV2}
                        style={{ background: C.blue, borderColor: C.blue }}
                      >
                        Search
                      </Button>
                    </div>

                    {items.length === 0 && !itemSearchLoading && (
                      <div style={{ display: 'flex', justifyContent: 'center', padding: 60, color: C.textLight }}>
                        <Text type="secondary">Enter a search term and click Search to find items</Text>
                      </div>
                    )}
                    {itemSearchLoading && (
                      <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
                        <Spin tip="Searching items…" />
                      </div>
                    )}
                    {items.length > 0 && !itemSearchLoading && (
                      <Table columns={itemTableCols} dataSource={filteredItems} rowKey={r => String(r.item_number)}
                        size="small" bordered
                        pagination={{ pageSize: 20, showSizeChanger: true, pageSizeOptions: ['10','20','50','100'],
                          showTotal: (t, [s, e]) => `${s}–${e} of ${t} items` }}
                        scroll={{ x: 700 }}
                        rowSelection={rowSel}
                        rowClassName={(_, i) => i % 2 !== 0 ? 'po-row-alt' : ''} />
                    )}
                  </>
                ),
              },
              {
                key: 'import',
                label: 'Import / Paste',
                children: (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <Alert
                      type="info" showIcon
                      message="Paste item data or upload an Excel file. Columns: Item Number (A), Qty (B), Price (C). (Two columns — Item Number, Price — still works; Qty defaults to 1.) After pasting/uploading, click Validate to check items against the item master."
                    />

                    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                      {/* Paste textarea */}
                      <div style={{ flex: 1, minWidth: 280 }}>
                        <Text style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                          Paste Data (tab- or comma-separated: ItemNumber, Qty, Price)
                        </Text>
                        <Input.TextArea
                          rows={6}
                          placeholder={'ITEM-001\t10\t150.00\nITEM-002\t5\t89.50\nITEM-003\t20\t200.00'}
                          value={pasteText}
                          onChange={e => setPasteText(e.target.value)}
                          style={{ fontFamily: 'monospace', fontSize: 12 }}
                        />
                        <Button
                          size="small"
                          style={{ marginTop: 6 }}
                          disabled={!pasteText.trim()}
                          onClick={() => handleParseText()}
                        >
                          Parse Text ({parsePasteText(pasteText).length} rows)
                        </Button>
                      </div>

                      {/* Excel upload */}
                      <div style={{ minWidth: 200 }}>
                        <Text style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                          Upload Excel File
                        </Text>
                        <Text style={{ fontSize: 11, color: C.textLight, display: 'block', marginBottom: 8 }}>
                          Column A: Item Number · Column B: Qty · Column C: Price · Row 1: header (skipped)
                        </Text>
                        <Upload
                          accept=".xlsx,.xls,.csv"
                          beforeUpload={file => { handleParseExcel(file); return false; }}
                          showUploadList={false}
                        >
                          <Button icon={<UploadOutlined />}>Upload Excel / CSV</Button>
                        </Upload>
                      </div>
                    </div>

                    {/* Parsed rows table */}
                    {pastedRows.length > 0 && (
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                          <Text strong style={{ fontSize: 12 }}>{pastedRows.length} rows parsed</Text>
                          {pastedRows.some(r => r.status !== 'pending') && (
                            <Space size={6}>
                              <Tag color="success">{pastedRows.filter(r => r.status === 'valid').length} valid</Tag>
                              <Tag color="error">{pastedRows.filter(r => r.status === 'invalid').length} invalid</Tag>
                            </Space>
                          )}
                          <Button
                            size="small"
                            danger
                            icon={<DeleteOutlined />}
                            onClick={() => { setPastedRows([]); setPasteText(''); }}
                          >
                            Clear
                          </Button>
                        </div>
                        <Table
                          size="small"
                          bordered
                          rowKey="key"
                          dataSource={pastedRows}
                          pagination={false}
                          scroll={{ y: 360 }}
                          rowClassName={r => r.status === 'invalid' ? 'qoh-low' : ''}
                          columns={[
                            {
                              title: '', key: 'status', width: 36, align: 'center' as const,
                              render: (_: any, r: PastedItem) =>
                                r.status === 'pending' ? <Text style={{ color: C.textLight, fontSize: 16 }}>·</Text>
                                : r.status === 'valid'   ? <CheckCircleOutlined style={{ color: C.green, fontSize: 15 }} />
                                : <CloseCircleOutlined style={{ color: C.red, fontSize: 15 }} />,
                            },
                            {
                              title: 'Item Number', dataIndex: 'itemNumber', width: 180,
                              render: (v: string) => <Text style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: 12, color: C.blue }}>{v}</Text>,
                            },
                            {
                              title: 'Qty', dataIndex: 'qty', width: 80, align: 'right' as const,
                              render: (v: number) => <Text style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>{fmt(v)}</Text>,
                            },
                            {
                              title: 'Price', dataIndex: 'price', width: 110, align: 'right' as const,
                              render: (v: number) => <Text style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>{fmt(v)}</Text>,
                            },
                            {
                              title: 'Value', key: 'value', width: 120, align: 'right' as const,
                              render: (_: any, r: PastedItem) => <Text strong style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12, color: C.red }}>{fmt((Number(r.qty) || 0) * (Number(r.price) || 0))}</Text>,
                            },
                            {
                              title: 'Description (matched)', key: 'desc',
                              render: (_: any, r: PastedItem) => r.matchedItem
                                ? <Space size={4}><Text style={{ fontSize: 12 }}>{r.matchedItem.description ?? '—'}</Text>
                                    {(r.matchedItem as any)._source === 'fusion' && <Tag color="blue" style={{ fontSize: 10, lineHeight: '16px', margin: 0 }}>Fusion</Tag>}</Space>
                                : r.status === 'invalid'
                                  ? <Text style={{ fontSize: 12, color: C.red }}>Not found in item master or Fusion</Text>
                                  : <Text style={{ fontSize: 12, color: C.textLight }}>—</Text>,
                            },
                            {
                              title: 'UOM', key: 'uom', width: 70, align: 'center' as const,
                              render: (_: any, r: PastedItem) => r.matchedItem
                                ? <Text style={{ fontSize: 11 }}>{r.matchedItem.primary_uom_code ?? r.matchedItem.uom ?? '—'}</Text>
                                : null,
                            },
                            {
                              title: 'Already on PO', key: 'dup', width: 100, align: 'center' as const,
                              render: (_: any, r: PastedItem) => existingItemNumbers.has(r.itemNumber)
                                ? <Tag color="warning" style={{ fontSize: 10 }}>Exists</Tag>
                                : null,
                            },
                          ]}
                          summary={() => {
                            const totQty = pastedRows.reduce((s, r) => s + (Number(r.qty) || 0), 0);
                            const totVal = pastedRows.reduce((s, r) => s + (Number(r.qty) || 0) * (Number(r.price) || 0), 0);
                            return (
                              <Table.Summary fixed>
                                <Table.Summary.Row style={{ background: '#fafafa', fontWeight: 700 }}>
                                  <Table.Summary.Cell index={0} colSpan={2}><Text strong>Total ({pastedRows.length})</Text></Table.Summary.Cell>
                                  <Table.Summary.Cell index={2} align="right"><Text strong style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(totQty)}</Text></Table.Summary.Cell>
                                  <Table.Summary.Cell index={3} />
                                  <Table.Summary.Cell index={4} align="right"><Text strong style={{ fontVariantNumeric: 'tabular-nums', color: C.red }}>{fmt(totVal)} {header?.currency ?? ''}</Text></Table.Summary.Cell>
                                  <Table.Summary.Cell index={5} colSpan={3} />
                                </Table.Summary.Row>
                              </Table.Summary>
                            );
                          }}
                        />
                      </div>
                    )}
                  </div>
                ),
              },
            ]}
          />
        </Modal>

        {/* ── Approval Modal ──────────────────────────── */}
        <Modal
          open={approvalOpen}
          title={
            <Space>
              <MailOutlined style={{ color: C.orange }} />
              <span>Send Purchase Order for Approval</span>
            </Space>
          }
          width={600}
          onCancel={() => setApprovalOpen(false)}
          footer={
            <Space>
              <Button onClick={() => setApprovalOpen(false)} icon={<CloseOutlined />}>Cancel</Button>
              <Button
                type="primary"
                icon={<MailOutlined />}
                loading={approvalSending}
                disabled={!approverEmail.trim()}
                onClick={handleSendApproval}
                style={{ background: C.orange, borderColor: C.orange, fontWeight: 600 }}
              >
                {approvalSending ? 'Sending…' : 'Send for Approval'}
              </Button>
            </Space>
          }
        >
          {/* PO summary */}
          <div style={{ background: '#F7F7F7', borderRadius: 6, padding: '10px 14px', marginBottom: 16, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 10, color: C.textLight, textTransform: 'uppercase' }}>PO Number</div>
              <Text strong style={{ color: C.text }}>{header?.poNumber}</Text>
            </div>
            <div>
              <div style={{ fontSize: 10, color: C.textLight, textTransform: 'uppercase' }}>Supplier</div>
              <Text strong>{header?.supplierName}</Text>
            </div>
            <div>
              <div style={{ fontSize: 10, color: C.textLight, textTransform: 'uppercase' }}>Lines</div>
              <Text strong>{lines.length}</Text>
            </div>
            <div>
              <div style={{ fontSize: 10, color: C.textLight, textTransform: 'uppercase' }}>Grand Total</div>
              <Text strong style={{ color: C.red }}>{fmt(grandTotal)} {header?.currency}</Text>
            </div>
            {acqCharges.length > 0 && (
              <div>
                <div style={{ fontSize: 10, color: C.textLight, textTransform: 'uppercase' }}>Acq. Charges</div>
                <Text strong style={{ color: C.orange }}>{fmt(acqCharges.reduce((s,c) => s+c.amount,0))} {header?.currency}</Text>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                Approver Email(s) <Text type="danger">*</Text>
              </Text>
              <Input
                placeholder="approver@company.com  (separate multiple with commas)"
                value={approverEmail}
                onChange={e => setApproverEmail(e.target.value)}
                prefix={<MailOutlined style={{ color: C.textLight }} />}
              />
            </div>
            <div>
              <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>CC (optional)</Text>
              <Input
                placeholder="cc1@company.com, cc2@company.com"
                value={approvalCc}
                onChange={e => setApprovalCc(e.target.value)}
                prefix={<MailOutlined style={{ color: C.textLight }} />}
              />
            </div>
            <div>
              <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Note to Approver (optional)</Text>
              <Input.TextArea
                rows={3}
                placeholder="Add any context or notes for the approver…"
                value={approvalNote}
                onChange={e => setApprovalNote(e.target.value)}
              />
            </div>
            <div style={{
              background: '#EBF5FF', border: `1px solid ${C.blue}40`,
              borderRadius: 5, padding: '8px 12px', fontSize: 12, color: C.textMid,
            }}>
              <FileTextOutlined style={{ color: C.blue, marginRight: 6 }} />
              Attachment: <Text strong>PO_{header?.poNumber}_Approval.xlsx</Text>
              {' '}— includes PO header, all lines{acqCharges.length > 0 ? ', acquisition costs, and landed cost breakdown' : ''}.
            </div>
          </div>
        </Modal>

        {/* ── Generate PO Success Modal (with confetti) ── */}
        <Modal
          open={generatePoModalOpen}
          title={null}
          closable={false}
          centered
          width={480}
          footer={
            <Space style={{ justifyContent: 'center', width: '100%' }} wrap>
              <Button
                size="large"
                onClick={() => { setGeneratePoModalOpen(false); setConfettiPieces([]); }}
              >
                Stay Here
              </Button>
              <Button
                size="large"
                icon={<MailOutlined />}
                loading={approvingFusion}
                disabled={!poHeaderId}
                style={{ background: C.orange, borderColor: C.orange, color: '#fff', fontWeight: 700 }}
                onClick={() => submitForApproval()}
              >
                Submit for Approval
              </Button>
              <Button
                type="primary"
                size="large"
                icon={<CheckCircleOutlined />}
                style={{ background: C.green, borderColor: C.green, fontWeight: 700 }}
                onClick={() => { setGeneratePoModalOpen(false); setConfettiPieces([]); exit(); }}
              >
                Go to PO List
              </Button>
            </Space>
          }
        >
          <style>{`
            @keyframes confetti-fall {
              0%   { transform: translateY(-20px) rotate(0deg); opacity: 1; }
              100% { transform: translateY(110vh) rotate(720deg); opacity: 0; }
            }
            @keyframes po-success-pop {
              0%   { transform: scale(0.4); opacity: 0; }
              60%  { transform: scale(1.12); }
              100% { transform: scale(1); opacity: 1; }
            }
          `}</style>

          {/* Confetti layer */}
          {confettiPieces.map(p => (
            <div key={p.id} style={{
              position: 'fixed',
              top: 0,
              left: `${p.x}%`,
              width: p.size,
              height: p.size * 0.6,
              background: p.color,
              borderRadius: 2,
              pointerEvents: 'none',
              zIndex: 99999,
              animation: `confetti-fall ${1.8 + Math.random() * 1.2}s ease-in forwards`,
              animationDelay: `${p.delay}s`,
            }} />
          ))}

          <div style={{ textAlign: 'center', padding: '32px 16px 16px', animation: 'po-success-pop 0.5s ease-out' }}>
            <div style={{ fontSize: 64, lineHeight: 1, marginBottom: 12 }}>🎉</div>
            <CheckCircleOutlined style={{ fontSize: 48, color: C.green, marginBottom: 10 }} />
            <div style={{ fontSize: 15, color: C.textMid, marginBottom: 6 }}>
              Purchase Order generated successfully in Oracle Fusion
            </div>
            <div style={{
              fontSize: 28, fontWeight: 800, color: C.blue, letterSpacing: '0.04em',
              fontFamily: 'monospace', marginBottom: 10,
            }}>
              {generatePoSuccess?.orderNumber}
            </div>
            {generatePoSuccess?.status && (
              <Tag color="orange" style={{ fontWeight: 700, fontSize: 13, padding: '2px 14px' }}>
                {generatePoSuccess.status}
              </Tag>
            )}
            <div style={{ marginTop: 16, padding: '10px 16px', background: '#F0FFF4', borderRadius: 8, border: '1px solid #b7ebc8' }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {lines.length} line{lines.length !== 1 ? 's' : ''} &nbsp;·&nbsp; Grand Total:&nbsp;
              </Text>
              <Text strong style={{ color: C.teal, fontSize: 13 }}>
                {fmt(grandTotal)} {header?.currency}
              </Text>
            </div>
          </div>
        </Modal>


        {/* ── Discard Modal ───────────────────────────── */}
        <Modal open={discardConfirmOpen} title="Discard Purchase Order?" onCancel={() => setDiscardConfirmOpen(false)}
          footer={<Space>
            <Button onClick={() => setDiscardConfirmOpen(false)}>Cancel</Button>
            <Button danger type="primary" onClick={() => { setDiscardConfirmOpen(false); exit(); }}>Discard</Button>
          </Space>}>
          <Text>All unsaved changes will be lost. Are you sure?</Text>
        </Modal>

        {/* ── Edit mode: Save Changes operations (JSON) ─── */}
        <Modal
          open={editJsonOpen}
          title={<Space><CodeOutlined style={{ color: C.blue }} />Save Changes — Fusion Operations</Space>}
          onCancel={() => setEditJsonOpen(false)}
          width={820}
          footer={<Button onClick={() => setEditJsonOpen(false)}>Close</Button>}
        >
          {editOps.length === 0 ? (
            <Alert type="info" showIcon message="No line changes to save." />
          ) : (
            <>
              <Text type="secondary" style={{ fontSize: 12 }}>
                On Save Changes these run in order — {editOps.filter(o => o.method === 'POST').length} new line(s) POSTed, {editOps.filter(o => o.method === 'PATCH').length} existing line(s) PATCHed. Deletes happen immediately when you remove a line. Use Test to run a single operation now.
              </Text>
              <div style={{ marginTop: 10, maxHeight: 460, overflow: 'auto' }}>
                {editOps.map((o, i) => {
                  const t = editOpResults[i];
                  return (
                    <div key={i} style={{ border: `1px solid ${C.border}`, borderRadius: 6, padding: 10, marginBottom: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Tag color={o.method === 'POST' ? 'green' : 'gold'} style={{ fontSize: 11 }}>{o.method}</Tag>
                        <Text style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all', flex: 1 }}>{o.url}</Text>
                        <Button size="small" loading={t?.loading} onClick={() => runEditOp(i)}>Test</Button>
                      </div>
                      <pre style={{ fontSize: 10.5, background: '#0d0d0d', color: '#a8ff78', borderRadius: 4, padding: 8, margin: '6px 0 0', maxHeight: 200, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                        {JSON.stringify(o.body, null, 2)}
                      </pre>
                      {t && t.status !== 0 && (
                        <>
                          <div style={{ fontSize: 11, color: '#888', margin: '6px 0 2px' }}>
                            HTTP <b style={{ color: t.status >= 200 && t.status < 300 ? C.green : C.red }}>{t.status}</b>
                          </div>
                          <pre style={{ fontSize: 10.5, background: '#0d0d0d', color: '#79c0ff', borderRadius: 4, padding: 8, margin: 0, maxHeight: 200, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                            {t.body || '(empty)'}
                          </pre>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </Modal>

        {/* ── Item Details (click item in lines) ──────── */}
        <Modal
          open={itemDetailOpen}
          onCancel={() => setItemDetailOpen(false)}
          width={820}
          title={<Space><SearchOutlined style={{ color: C.blue }} />Item Details — {itemDetailNumber}</Space>}
          footer={<Button onClick={() => setItemDetailOpen(false)}>Close</Button>}
        >
          {itemDetailLoading ? (
            <div style={{ textAlign: 'center', padding: 40 }}><Spin /><div style={{ marginTop: 8, color: C.textMid, fontSize: 12 }}>Loading item…</div></div>
          ) : itemDetailErr ? (
            <Alert type="warning" showIcon message={itemDetailErr} />
          ) : (() => {
            const org = header?.shipToOrg;
            const primary = itemDetailRows.find(i => org && i.OrganizationCode === org) ?? itemDetailRows.find(i => i.SalesAccountId != null) ?? itemDetailRows[0] ?? {};
            const entries = Object.entries(primary).filter(([k, v]) => k !== 'links' && v != null && v !== '');
            return (
              <>
                <div style={{ fontSize: 12, color: C.textMid, marginBottom: 10 }}>
                  {org
                    ? <>Showing attributes for Ship-to Organization <Tag color="cyan" style={{ fontSize: 11 }}>{primary.OrganizationCode ?? org}</Tag>({itemDetailRows.length} row{itemDetailRows.length !== 1 ? 's' : ''}).</>
                    : <>Found in <b>{itemDetailRows.length}</b> organization row(s). Showing the master definition{primary.OrganizationCode ? ` (${primary.OrganizationCode})` : ''}.</>}
                  {primary.SalesAccountId != null && <Tag color="green" style={{ marginLeft: 8, fontSize: 11 }}>Sales Acct {primary.SalesAccountId}</Tag>}
                </div>
                <div style={{ maxHeight: 420, overflow: 'auto', border: `1px solid ${C.border}`, borderRadius: 6 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <tbody>
                      {entries.map(([k, v]) => (
                        <tr key={k} style={{ borderBottom: `1px solid ${C.border}` }}>
                          <td style={{ padding: '5px 10px', fontWeight: 600, width: 260, color: C.textMid, background: '#fafafa', wordBreak: 'break-all' }}>{k}</td>
                          <td style={{ padding: '5px 10px', wordBreak: 'break-all' }}>{String(v)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ fontSize: 11, color: C.textLight, marginTop: 8 }}>
                  Source: <Text code style={{ fontSize: 11 }}>{itemDetailApiUrl || `GET itemsV2?q=ItemNumber='${itemDetailNumber}'`}</Text>
                </div>
              </>
            );
          })()}
        </Modal>

        {/* ── Assign to Org — itemsV2 payload preview ─── */}
        <Modal
          open={assignApiOpen}
          onCancel={() => setAssignApiOpen(false)}
          width={760}
          title={<Space><ApiOutlined style={{ color: C.blue }} />Assign Item — itemsV2 ({assignApiTitle})</Space>}
          footer={<Button onClick={() => setAssignApiOpen(false)}>Close</Button>}
        >
          <div style={{ fontSize: 12, marginBottom: 6 }}>
            <Space size={6}><Tag color={assignApiUpdate ? 'orange' : 'green'}>{assignApiUpdate ? 'PATCH' : 'POST'}</Tag>
              <Text type="secondary">{assignApiUpdate ? 'Already assigned — Update one item /itemsV2/{itemsV2UniqID} (attributes only)' : 'Assign item to inventory org (copies master-org attributes)'}</Text></Space>
          </div>
          <Text copyable style={{ fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all' }}>{assignApiUpdate ? assignApiHref : `${FUSION_BASE}/itemsV2`}</Text>
          {assignApiUpdate && <div style={{ fontSize: 11, color: C.textLight, marginTop: 4 }}>If the server rejects PATCH (InvalidOperationUpdate…), it retries once via <Text code style={{ fontSize: 11 }}>POST + Upsert-Mode: true</Text>.</div>}
          {assignApiLoading ? (
            <div style={{ textAlign: 'center', padding: 24 }}><Text type="secondary">Reading master item…</Text></div>
          ) : (
            <>
              {assignApiMaster
                ? <Alert type="success" showIcon style={{ margin: '10px 0', fontSize: 12 }}
                    message={`Master attributes found — Sales Account: ${assignApiMaster.SalesAccountValue ?? assignApiMaster.SalesAccountId ?? '—'}`} />
                : <Alert type="warning" showIcon style={{ margin: '10px 0', fontSize: 12 }}
                    message="No master item found — posting base attributes only (Sales Account not copied)." />}
              <div style={{ fontSize: 12, fontWeight: 600, margin: '8px 0 4px' }}>Request Body (JSON)</div>
              <pre style={{ fontSize: 11, background: '#0d0d0d', color: '#a8ff78', borderRadius: 4, padding: 10, maxHeight: 340, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {assignApiBody ? JSON.stringify(assignApiBody, null, 2) : '(no body)'}
              </pre>
            </>
          )}
        </Modal>

        {/* ── Custom Fusion PO action ─────────────────── */}
        <Modal
          open={customActionOpen}
          title={<Space><ThunderboltOutlined style={{ color: C.blue }} />Run Custom Fusion Action</Space>}
          onCancel={() => setCustomActionOpen(false)}
          footer={<Space>
            <Button onClick={() => setCustomActionOpen(false)}>Close</Button>
            <Button type="primary" disabled={!customActionName.trim()} loading={!!poActionLoading}
              style={{ background: C.blue, borderColor: C.blue }}
              onClick={() => { setCustomActionOpen(false); runPoAction(customActionName.trim(), customActionName.trim(), (customActionResource || 'purchaseOrders').trim()); }}>
              Run action
            </Button>
          </Space>}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Runs any Fusion custom action on this PO (POHeaderId {poHeaderId ?? '—'}). Use the
            Search Orders → Submit-for-Approval “Discover actions” tool to find valid names for
            <Text code>purchaseOrders</Text> (cancel/change/close…).
          </Text>
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div>
              <Text strong style={{ fontSize: 12 }}>Resource</Text>
              <Input value={customActionResource} onChange={e => setCustomActionResource(e.target.value)}
                placeholder="purchaseOrders" style={{ fontFamily: 'monospace', marginTop: 4 }} />
            </div>
            <div>
              <Text strong style={{ fontSize: 12 }}>Action name</Text>
              <Input value={customActionName} onChange={e => setCustomActionName(e.target.value)}
                placeholder="e.g. cancelDocument" style={{ fontFamily: 'monospace', marginTop: 4 }} />
            </div>
            {customActionName.trim() && poHeaderId && (
              <pre style={{ fontSize: 11, background: '#f5f5f5', padding: 10, borderRadius: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 }}>
{`POST ${FUSION_BASE}/${(customActionResource || 'purchaseOrders').trim()}/${poHeaderId}
Content-Type: application/vnd.oracle.adf.action+json

${JSON.stringify({ name: customActionName.trim(), parameters: [] }, null, 2)}`}
              </pre>
            )}
          </div>
        </Modal>

        {/* ── Fusion PO Modal (preview + run) ─────────── */}
        <Modal
          open={fusionModalOpen}
          title={
            <Space>
              <ApiOutlined style={{ color: C.blue }} />
              <span>Create Order Header in Oracle Fusion</span>
              {fusionPostResult && (
                <Tag
                  color={fusionPostResult.success ? 'success' : 'error'}
                  style={{ fontWeight: 700, fontSize: 12 }}
                >
                  HTTP {fusionPostResult.status || 'ERR'}
                </Tag>
              )}
            </Space>
          }
          width={780}
          onCancel={() => { setFusionModalOpen(false); setFusionPostResult(null); }}
          footer={
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Button onClick={() => { setFusionModalOpen(false); setFusionPostResult(null); }}>Close</Button>
              <Space>
                {fusionPostResult?.success && fusionPostResult.data?.OrderNumber && (
                  <Button
                    type="primary"
                    icon={<CheckCircleOutlined />}
                    style={{ background: C.green, borderColor: C.green }}
                    onClick={() => { setFusionModalOpen(false); exit(); }}
                  >
                    Go to PO List
                  </Button>
                )}
                {fusionPreparedBody && (
                  <Button
                    type="primary"
                    icon={<ApiOutlined />}
                    loading={fusionPostLoading}
                    style={{ background: C.red, borderColor: C.red, fontWeight: 700, minWidth: 120 }}
                    onClick={handleRunFusionPost}
                  >
                    {fusionPostLoading ? 'Running…' : fusionPostResult ? 'Run Again' : 'Run POST'}
                  </Button>
                )}
              </Space>
            </div>
          }
        >
          {/* Endpoint URL */}
          <div style={{ background: '#F0F4FF', border: `1px solid ${C.blue}40`, borderRadius: 6, padding: '8px 12px', marginBottom: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: C.blue, marginBottom: 3 }}>
              POST · Endpoint
            </div>
            <Text copyable style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}>
              {`${FUSION_BASE}/draftPurchaseOrders`}
            </Text>
          </div>

          {/* Request body */}
          {fusionPreparedBody && (
            <div style={{ background: '#FAFAFA', border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 12px', marginBottom: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: C.textMid, marginBottom: 4 }}>
                Request Body (JSON)
              </div>
              <pre style={{ margin: 0, fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 260, overflow: 'auto', lineHeight: 1.5 }}>
                {JSON.stringify(fusionPreparedBody, null, 2)}
              </pre>
            </div>
          )}

          {/* Result section */}
          {fusionPostResult && (
            <>
              {/* Network / CORS error */}
              {fusionPostResult.networkError && (
                <Alert type="error" showIcon message="Network / CORS Error"
                  description={
                    <div>
                      <div style={{ fontFamily: 'monospace', fontSize: 12, marginBottom: 6 }}>{fusionPostResult.networkError}</div>
                      <div style={{ fontSize: 11, color: C.textMid }}>
                        The browser blocked the request or the server is unreachable. Check the browser Console (F12) for the full CORS error.
                      </div>
                    </div>
                  }
                />
              )}

              {/* HTTP response */}
              {!fusionPostResult.networkError && (
                <>
                  {fusionPostResult.success && fusionPostResult.data?.OrderNumber && (
                    <div style={{ textAlign: 'center', padding: '10px 0 8px' }}>
                      <CheckCircleOutlined style={{ fontSize: 36, color: C.green, marginBottom: 6 }} />
                      <div style={{ fontSize: 13, color: C.textMid }}>Draft PO created successfully</div>
                      <Text strong style={{ fontSize: 20, color: C.blue }}>{fusionPostResult.data.OrderNumber}</Text>
                      {fusionPostResult.data?.Status && (
                        <div style={{ marginTop: 6 }}>
                          <Tag color="orange" style={{ fontWeight: 600 }}>{fusionPostResult.data.Status}</Tag>
                        </div>
                      )}
                    </div>
                  )}
                  <div style={{
                    background: fusionPostResult.success ? '#F0FFF4' : '#FFF2F0',
                    border: `1px solid ${fusionPostResult.success ? '#b7ebc8' : '#FFCCC7'}`,
                    borderRadius: 6, padding: '8px 12px', marginTop: 8,
                  }}>
                    <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: fusionPostResult.success ? C.green : C.red, marginBottom: 4 }}>
                      Response · HTTP {fusionPostResult.status}
                    </div>
                    <pre style={{
                      margin: 0, fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                      maxHeight: 260, overflow: 'auto', lineHeight: 1.5,
                      color: fusionPostResult.success ? '#1a4731' : C.red,
                    }}>
                      {fusionPostResult.data
                        ? JSON.stringify(fusionPostResult.data, null, 2)
                        : (fusionPostResult.rawText || '(empty response)')}
                    </pre>
                  </div>
                </>
              )}
            </>
          )}

          {/* Prompt to click Run POST when no result yet */}
          {!fusionPostResult && fusionPreparedBody && !fusionPostLoading && (
            <div style={{ textAlign: 'center', padding: '8px 0 4px', color: C.textLight, fontSize: 12 }}>
              Review the request body above, then click <strong>Run POST</strong> to submit to Oracle Fusion.
            </div>
          )}
        </Modal>

      </Content>
    </Layout>
  );
};

export default CreatePurchaseOrder;
