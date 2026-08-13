import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  Layout, Card, Table, Form, Input, Select, DatePicker, Button,
  Tabs, Tag, Typography, Space, Badge, Tooltip, Spin, Row, Col, message, Modal, InputNumber,
} from 'antd';
import type { TabsProps } from 'antd';
import {
  SearchOutlined, EyeOutlined, ClearOutlined, InboxOutlined,
  ReloadOutlined, HomeOutlined, FileExcelOutlined, FilterOutlined,
  CodeOutlined, EnvironmentOutlined, CopyOutlined,
  EditOutlined, NumberOutlined, ApiOutlined,
} from '@ant-design/icons';
import { Link, useSearchParams } from 'react-router-dom';
import * as XLSX from 'xlsx';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import { FUSION_POD_HOST, FUSION_POD_AUTH } from '../../config/fusionInstance';

const { Content } = Layout;
const { Title, Text } = Typography;
const { Option } = Select;
const { RangePicker } = DatePicker;

// In Electron the request goes directly (no CORS). In a browser (localhost dev)
// we route through the Vite proxy to avoid CORS blocking. NOTE: the preload
// exposes window.electronAPI (not window.electron), so detect via that.
const FUSION_BASE = `${FUSION_POD_HOST}/fscmRestApi/resources/11.13.18.05`;
const AUTH_HEADER = FUSION_POD_AUTH;
const FUSION_HDRS = { Authorization: AUTH_HEADER, Accept: 'application/json' };

const REDWOOD = {
  primary: '#C74634',
  info: '#0572CE',
  success: '#1D7B4D',
  warning: '#D4A800',
  teal: '#00918A',
  bg: '#F4F5F7',
  surface: '#FFFFFF',
  neutral200: '#E5E5E5',
  neutral600: '#6B6B6B',
  neutral900: '#1A1A1A',
};

// ── Types ──────────────────────────────────────────────────────────────────────
interface ReceiptLine {
  DocumentLineId?: number;
  DocumentNumber?: string;
  DocumentLineNumber?: number;
  DocumentScheduleNumber?: number;
  ASNNumber?: string;
  ItemNumber?: string;
  ItemDescription?: string;
  ToOrganizationCode?: string;
  VendorName?: string;
  VendorSiteCode?: string;
  SourceDocumentCode?: string;
  ShipToLocation?: string;
  AvailableQuantity?: number;
  OrderedQuantity?: number;
  UOMCode?: string;
  DueDate?: string;
  POUnitPrice?: number;
  CurrencyCode?: string;
  IntegrationStatus?: string;
  DestinationType?: string;
  links?: Array<{ name: string; href: string; rel?: string }>;
  _selfLink?: string;
  [key: string]: unknown;
}

interface POGroup {
  _key: string;
  DocumentNumber: string;
  ToOrganizationCode: string;
  SourceDocumentCode: string;
  VendorName: string;
  DestinationType: string;
  ShipToLocation: string;
  IntegrationStatus: string;
  ASNNumbers: string;
  dueDateEarliest: string;
  dueDateLatest: string;
  linesCount: number;
  lines: ReceiptLine[];
}

interface OpenTab {
  key: string;
  poNumber: string;
  asn?: string;
  lines: ReceiptLine[];
}

type DateMode = 'none' | 'exact' | 'last7' | 'last15' | 'range';

// ── Helpers ────────────────────────────────────────────────────────────────────
const buildQuery = (
  org: string, poNum: string, dateMode: DateMode,
  exactDate: Dayjs | null, dateRange: [Dayjs | null, Dayjs | null] | null,
  asn = '',
): string => {
  const parts: string[] = [];
  if (org.trim()) parts.push(`ToOrganizationCode='${org.trim()}'`);
  if (poNum.trim()) parts.push(`DocumentNumber='${poNum.trim()}'`);
  if (asn.trim()) parts.push(`ASNNumber='${asn.trim()}'`);
  if (dateMode === 'exact' && exactDate)
    parts.push(`DueDate='${exactDate.format('YYYY-MM-DD')}'`);
  else if (dateMode === 'last7')
    parts.push(`DueDate>='${dayjs().subtract(7, 'day').format('YYYY-MM-DD')}'`);
  else if (dateMode === 'last15')
    parts.push(`DueDate>='${dayjs().subtract(15, 'day').format('YYYY-MM-DD')}'`);
  else if (dateMode === 'range' && dateRange?.[0] && dateRange?.[1]) {
    parts.push(`DueDate>='${dateRange[0].format('YYYY-MM-DD')}'`);
    parts.push(`DueDate<='${dateRange[1].format('YYYY-MM-DD')}'`);
  }
  return parts.join(';');
};

function groupRows(rows: ReceiptLine[]): POGroup[] {
  const map = new Map<string, {
    ToOrganizationCode: Set<string>;
    SourceDocumentCode: Set<string>;
    VendorName: Set<string>;
    DestinationType: Set<string>;
    ShipToLocation: Set<string>;
    IntegrationStatus: Set<string>;
    ASNNumbers: Set<string>;
    dueDates: string[];
    lines: ReceiptLine[];
  }>();

  for (const row of rows) {
    // Group by PO number AND ASN number: lines already shipped on an ASN form
    // their own group (one row per ASN), and lines not yet on an ASN group under
    // the same PO with an empty ASN. So a PO with 2 ASNs shows as 3 rows max.
    const asnKey = String(row.ASNNumber ?? '').trim();
    const key = `${row.DocumentNumber ?? ''}||${asnKey}`;
    if (!map.has(key)) {
      map.set(key, {
        ToOrganizationCode: new Set(),
        SourceDocumentCode: new Set(),
        VendorName: new Set(),
        DestinationType: new Set(),
        ShipToLocation: new Set(),
        IntegrationStatus: new Set(),
        ASNNumbers: new Set(),
        dueDates: [],
        lines: [],
      });
    }
    const g = map.get(key)!;
    if (row.ToOrganizationCode) g.ToOrganizationCode.add(row.ToOrganizationCode);
    if (row.SourceDocumentCode) g.SourceDocumentCode.add(String(row.SourceDocumentCode));
    if (row.VendorName) g.VendorName.add(row.VendorName);
    if (row.DestinationType) g.DestinationType.add(row.DestinationType);
    if (row.ShipToLocation) g.ShipToLocation.add(String(row.ShipToLocation));
    if (row.IntegrationStatus) g.IntegrationStatus.add(row.IntegrationStatus);
    if (row.ASNNumber && String(row.ASNNumber).trim()) g.ASNNumbers.add(String(row.ASNNumber).trim());
    if (row.DueDate) g.dueDates.push(row.DueDate);
    g.lines.push(row);
  }

  const pick = (s: Set<string>) => s.size === 0 ? '—' : s.size === 1 ? [...s][0] : 'Multiple';
  const pickStatus = (s: Set<string>) => s.size === 0 ? '—' : s.size === 1 ? [...s][0] : 'Mixed';

  return Array.from(map.entries()).map(([key, g]) => {
    const [docNum, asnKey] = key.split('||');
    const sorted = [...g.dueDates].sort();
    return {
      _key: key,
      DocumentNumber: docNum,
      ToOrganizationCode: pick(g.ToOrganizationCode),
      SourceDocumentCode: pick(g.SourceDocumentCode),
      VendorName: pick(g.VendorName),
      DestinationType: pick(g.DestinationType),
      ShipToLocation: pick(g.ShipToLocation),
      IntegrationStatus: pickStatus(g.IntegrationStatus),
      ASNNumbers: asnKey || Array.from(g.ASNNumbers).join(', '),
      dueDateEarliest: sorted[0] ?? '',
      dueDateLatest: sorted[sorted.length - 1] ?? '',
      linesCount: g.lines.length,
      lines: g.lines,
    };
  });
}

async function fetchLinesToReceive(q: string): Promise<ReceiptLine[]> {
  const qParam = q ? `q=${encodeURIComponent(q)}&` : '';
  let all: ReceiptLine[] = [];
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const url = `${FUSION_BASE}/linesToReceive?${qParam}limit=500&offset=${offset}`;
    const res = await fetch(url, { headers: FUSION_HDRS });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const data = await res.json();
    const items: ReceiptLine[] = (data.items ?? []).map((item: ReceiptLine) => ({
      ...item,
      _selfLink: item.links?.find(l => l.name === 'linesToReceive')?.href,
    }));
    all = [...all, ...items];
    hasMore = items.length === 500;
    offset += 500;
  }
  return all;
}

// ── DueDateTag ─────────────────────────────────────────────────────────────────
const DueDateTag: React.FC<{ date?: string }> = ({ date }) => {
  if (!date) return <span>—</span>;
  const d = dayjs(date);
  const diff = d.diff(dayjs(), 'day');
  const color = diff < 0 ? REDWOOD.primary : diff <= 7 ? REDWOOD.warning : REDWOOD.success;
  return (
    <Tag style={{ background: color + '18', color, borderColor: color + '60', fontWeight: 600 }}>
      {d.format('YYYY-MM-DD')}
    </Tag>
  );
};

// ── InfoTile ────────────────────────────────────────────────────────────────────
const InfoTile: React.FC<{ label: string; value?: React.ReactNode }> = ({ label, value }) => (
  <div style={{ background: REDWOOD.bg, borderRadius: 6, padding: '8px 12px', minWidth: 0 }}>
    <div style={{ fontSize: 10, color: REDWOOD.neutral600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>
      {label}
    </div>
    <div style={{ fontSize: 12, color: REDWOOD.neutral900, fontWeight: 600, wordBreak: 'break-word' }}>
      {value || '—'}
    </div>
  </div>
);

// ── StatusTag ──────────────────────────────────────────────────────────────────
const StatusTag: React.FC<{ status?: string }> = ({ status }) => {
  if (!status || status === '—') return <span>—</span>;
  if (status === 'Mixed') return <Tag color="orange">Mixed</Tag>;
  const isReady = status === 'Ready to interface';
  const color = isReady ? REDWOOD.success : REDWOOD.warning;
  return (
    <Tag style={{ background: color + '18', color, borderColor: color + '60', fontSize: 11 }}>{status}</Tag>
  );
};

// ── AllFieldsModal ──────────────────────────────────────────────────────────────
const AllFieldsModal: React.FC<{
  open: boolean;
  onClose: () => void;
  record: Record<string, unknown> | null;
  title: string;
}> = ({ open, onClose, record, title }) => {
  const entries = record
    ? Object.entries(record).filter(([k, v]) => !k.startsWith('_') && k !== 'links' && v !== null && v !== undefined)
    : [];
  return (
    <Modal open={open} title={title} onCancel={onClose} width={800}
      footer={[<Button key="close" onClick={onClose}>Close</Button>]}>
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr',
        gap: '8px 24px', maxHeight: 520, overflowY: 'auto', padding: '8px 0',
      }}>
        {entries.map(([k, v]) => (
          <div key={k} style={{ borderBottom: `1px solid ${REDWOOD.neutral200}`, paddingBottom: 6 }}>
            <div style={{ fontSize: 10, color: REDWOOD.neutral600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{k}</div>
            <div style={{ fontSize: 12, color: REDWOOD.neutral900, wordBreak: 'break-all' }}>{String(v)}</div>
          </div>
        ))}
      </div>
    </Modal>
  );
};

// ── PO Detail Tab ───────────────────────────────────────────────────────────────
interface RcvData { lotNumber: string; locator: string; subinventory: string; fromSerial: string; toSerial: string; qty: number; }

const PODetailTab: React.FC<{ poNumber: string; asn?: string; initialLines: ReceiptLine[] }> = ({
  poNumber, asn, initialLines,
}) => {
  const [lines, setLines]   = useState<ReceiptLine[]>(initialLines);
  const [loading, setLoading] = useState(false);
  const [allFieldsRecord, setAllFieldsRecord] = useState<ReceiptLine | null>(null);
  const [detailSubTab, setDetailSubTab] = useState<'lines' | 'receiving'>('lines');

  // Receiving state
  const [rcvSelectedKeys, setRcvSelectedKeys] = useState<(string | number)[]>([]);
  const [rcvLineData, setRcvLineData]         = useState<Record<string, RcvData>>({});
  const [rcvShipmentNum, setRcvShipmentNum]   = useState('');
  const [rcvJsonOpen, setRcvJsonOpen]         = useState(false);

  // Lot / serial customisation
  const [lotPrefix, setLotPrefix]           = useState(`IGRN_${poNumber}`);
  const [serialStart, setSerialStart]       = useState(1);
  const [rcvLotOpen, setRcvLotOpen]         = useState(false);
  const [rcvSerialOpen, setRcvSerialOpen]   = useState(false);
  const [tempLot, setTempLot]               = useState('');
  const [tempSerial, setTempSerial]         = useState(1);

  // ASN shown in the header: prefer the group's ASN passed from the search row,
  // else derive the distinct ASN number(s) present on the current lines.
  const asnDisplay = useMemo(() => {
    if (asn && asn.trim()) return asn.trim();
    const set = Array.from(new Set(lines.map(l => String(l.ASNNumber ?? '').trim()).filter(Boolean)));
    return set.join(', ');
  }, [asn, lines]);

  // Subinventories for the receiving org — subinventories?q=OrganizationCode=<org>.
  const [subinvs, setSubinvs] = useState<string[]>([]);
  useEffect(() => {
    const org = initialLines[0]?.ToOrganizationCode;
    if (!org) return;
    fetch(`${FUSION_BASE}/subinventories?q=OrganizationCode=${encodeURIComponent(org)}&onlyData=true&limit=500`, { headers: FUSION_HDRS })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(d => {
        const items: any[] = Array.isArray(d) ? d : (d.items ?? []);
        const names = Array.from(new Set(items.map(i => i.SecondaryInventoryName).filter(Boolean))).sort();
        setSubinvs(names as string[]);
      })
      .catch(() => setSubinvs([]));
  }, [initialLines]);

  // Options for the subinventory pickers — the org's fetched subinventories plus
  // any value already present on the lines/receiving data, so the picker works
  // even when the subinventories fetch returns nothing.
  const subinvOptions = useMemo(() => {
    const set = new Set<string>(subinvs);
    lines.forEach(l => { const s = String((l as Record<string, unknown>).Subinventory ?? ''); if (s) set.add(s); });
    Object.values(rcvLineData).forEach(d => { if (d?.subinventory) set.add(d.subinventory); });
    return Array.from(set).sort();
  }, [subinvs, lines, rcvLineData]);

  // Lot / serial control per item (from itemsV2) — drives whether the receiving
  // JSON carries lotSerialItemLots (only for lot-controlled items) and serials.
  const [itemCtl, setItemCtl] = useState<Record<string, { lot: boolean; serial: boolean }>>({});
  useEffect(() => {
    const org = lines[0]?.ToOrganizationCode;
    const nums = Array.from(new Set(lines.map(l => String(l.ItemNumber ?? '').trim()).filter(Boolean)));
    if (!org || !nums.length) return;
    let cancelled = false;
    (async () => {
      const map: Record<string, { lot: boolean; serial: boolean }> = {};
      let idx = 0;
      const worker = async () => {
        while (idx < nums.length) {
          const n = nums[idx++];
          try {
            const r = await fetch(`${FUSION_BASE}/itemsV2?q=OrganizationCode=${encodeURIComponent(org)};ItemNumber=${encodeURIComponent(n)}&limit=1&onlyData=true`, { headers: FUSION_HDRS });
            if (r.ok) {
              const it = ((await r.json()).items ?? [])[0];
              if (it) {
                // Serial control is under SerialGeneration* in itemsV2; code 1 /
                // "No serial number control" = off, anything else = on.
                const lc = it.LotControlCode;
                const sc = it.SerialGenerationCode ?? it.SerialNumberControlCode;
                const sv = it.SerialGenerationValue ?? it.SerialNumberControlValue ?? it.SerialGeneration;
                const lot = lc != null ? Number(lc) !== 1 : /full lot/i.test(String(it.LotControlValue ?? ''));
                const serial = sc != null ? Number(sc) !== 1 : (!!sv && !/no\s*serial/i.test(String(sv)));
                map[n.toUpperCase()] = { lot, serial };
              }
            }
          } catch { /* skip item */ }
        }
      };
      await Promise.all(Array.from({ length: Math.min(6, nums.length) }, worker));
      if (!cancelled) setItemCtl(map);
    })();
    return () => { cancelled = true; };
  }, [lines]);
  const lineLotCtl = (l: ReceiptLine) => itemCtl[String(l.ItemNumber ?? '').toUpperCase()]?.lot ?? false;
  const lineSerialCtl = (l: ReceiptLine) => itemCtl[String(l.ItemNumber ?? '').toUpperCase()]?.serial ?? false;

  const handleRefresh = useCallback(async () => {
    setLoading(true);
    try {
      const fresh = await fetchLinesToReceive(`DocumentNumber='${poNumber}'`);
      setLines(fresh);
    } catch (e: unknown) {
      message.error('Refresh failed: ' + (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [poNumber]);

  const pad3 = (n: number) => String(Math.ceil(n)).padStart(3, '0');

  // Assign cumulative serials across ALL lines so each line continues where the previous ended.
  // Reacts to lotPrefix / serialStart changes automatically via useEffect below.
  const initAllRcvLines = useCallback((lineList: ReceiptLine[]): Record<string, RcvData> => {
    const result: Record<string, RcvData> = {};
    let counter = serialStart;
    lineList.forEach(r => {
      const qty = Math.ceil(r.AvailableQuantity ?? r.OrderedQuantity ?? 1);
      const k = String(r.DocumentLineId ?? '');
      result[k] = {
        lotNumber:  lotPrefix,
        locator:    '',
        subinventory: String(r.Subinventory ?? (r as Record<string, unknown>).Subinventory ?? ''),
        fromSerial: `${lotPrefix}_${pad3(counter)}`,
        toSerial:   `${lotPrefix}_${pad3(counter + qty - 1)}`,
        qty,
      };
      counter += qty;
    });
    return result;
  }, [lotPrefix, serialStart]);

  // Re-initialise whenever lines change (first load or refresh).
  React.useEffect(() => {
    if (lines.length > 0) setRcvLineData(initAllRcvLines(lines));
  }, [lines, initAllRcvLines]);

  const rcvUpdateField = useCallback((lineKey: string, field: keyof RcvData, value: string | number) => {
    setRcvLineData(prev => ({ ...prev, [lineKey]: { ...prev[lineKey], [field]: value } as RcvData }));
  }, []);

  // Map one PO line + its receiving data into a receivingReceiptRequests line.
  const mapReceiveLine = useCallback((line: ReceiptLine, d: RcvData): Record<string, unknown> => {
    const lr = line as Record<string, unknown>;
    const base: Record<string, unknown> = {
      POHeaderId:       String(lr.POHeaderId ?? ''),
      POLineLocationId: String(lr.POLineLocationId ?? ''),
      SourceDocumentCode: String(line.SourceDocumentCode ?? 'PO'),
      ReceiptSourceCode:  String(lr.ReceiptSourceCode ?? 'VENDOR'),
      TransactionType:    'RECEIVE',
      AutoTransactCode:   'DELIVER',
      DocumentNumber:      line.DocumentNumber ?? poNumber,
      DocumentLineNumber:  String(line.DocumentLineNumber ?? ''),
      ItemNumber:         line.ItemNumber ?? '',
      OrganizationCode:   line.ToOrganizationCode ?? '',
      Subinventory:       (d?.subinventory ?? '') as string,
      Quantity:           d?.qty,
      FromOrganizationCode: null,
      UnitOfMeasure:      String(line.UnitOfMeasure ?? line.UOMCode ?? ''),
    };
    if (d?.locator) base.Locator = d.locator;
    // Only lot-controlled items carry lotSerialItemLots; serials only when the
    // item is serial-controlled. A plain (non-lot, non-serial) item gets neither.
    const lotCtl = lineLotCtl(line);
    const serialCtl = lineSerialCtl(line);
    if (lotCtl && d?.lotNumber) {
      base.lotSerialItemLots = [{
        LotNumber:           d.lotNumber,
        TransactionQuantity: d.qty,
        ...(serialCtl && d.fromSerial ? { lotSerialItemSerials: [{ FromSerialNumber: d.fromSerial, ToSerialNumber: d.toSerial }] } : {}),
      }];
    }
    return base;
  }, [poNumber, itemCtl]);

  // One receivingReceiptRequests body per line (mirrors the WMS PL/SQL, which
  // posts each line separately with a per-line ShipmentNumber).
  const buildBodyForLine = useCallback((line: ReceiptLine): Record<string, unknown> => {
    const k = String(line.DocumentLineId ?? '');
    const d = rcvLineData[k];
    const shipBase = rcvShipmentNum.trim() || String(Date.now()).slice(-6);
    return {
      FromOrganizationCode: null,
      OrganizationCode:  line.ToOrganizationCode ?? '',
      ReceiptSourceCode: 'VENDOR',
      EmployeeId:        '',
      VendorName:        line.VendorName ?? '',
      ShipmentNumber:    `${shipBase}${line.DocumentLineNumber ?? ''}`,
      lines: [mapReceiveLine(line, d)],
    };
  }, [rcvLineData, rcvShipmentNum, mapReceiveLine]);

  const buildReceivingJson = useCallback(() => {
    const firstL = lines[0];
    const shipNum = rcvShipmentNum.trim() || String(Date.now()).slice(-6);
    const selectedLines = lines.filter(l => rcvSelectedKeys.includes(String(l.DocumentLineId ?? '')));
    return {
      FromOrganizationCode: null,
      OrganizationCode:  firstL?.ToOrganizationCode ?? '',
      ReceiptSourceCode: 'VENDOR',
      EmployeeId:        '',
      VendorName:        firstL?.VendorName ?? '',
      ShipmentNumber:    shipNum,
      lines: selectedLines.map(line => mapReceiveLine(line, rcvLineData[String(line.DocumentLineId ?? '')])),
    };
  }, [lines, rcvSelectedKeys, rcvLineData, rcvShipmentNum, mapReceiveLine]);

  const firstLine = lines[0];

  // ── Receive PO — one receivingReceiptRequests POST per selected line ─────────
  const RECEIVE_URL = `${FUSION_BASE}/receivingReceiptRequests`;
  type RcvRow = {
    key: string; item: string; qty: number; subinv: string; body: any;
    status: 'pending' | 'processing' | 'success' | 'error'; http: number; message: string; response: string;
  };
  const [receiveOpen, setReceiveOpen]       = useState(false);
  const [receiveLoading, setReceiveLoading] = useState(false);
  const [receiveRows, setReceiveRows]       = useState<RcvRow[]>([]);
  const [receivedKeys, setReceivedKeys]     = useState<Set<string>>(new Set());

  const openReceive = () => {
    const missing = rcvSelectedKeys.filter(k => !rcvLineData[k]?.subinventory);
    if (missing.length > 0) {
      message.error(`Select a Subinventory on ${missing.length} selected line(s) before receiving.`);
      return;
    }
    const selected = lines.filter(l => rcvSelectedKeys.includes(String(l.DocumentLineId ?? '')));
    setReceiveRows(selected.map(l => {
      const k = String(l.DocumentLineId ?? '');
      const d = rcvLineData[k];
      return { key: k, item: l.ItemNumber ?? '', qty: d?.qty ?? 0, subinv: d?.subinventory ?? '',
        body: buildBodyForLine(l), status: 'pending' as const, http: 0, message: '', response: '' };
    }));
    setReceiveOpen(true);
  };

  const runReceive = async () => {
    setReceiveLoading(true);
    const succeeded: string[] = [];
    // Process each line sequentially so per-line status updates live.
    for (const row of receiveRows) {
      if (row.status === 'success') continue;
      setReceiveRows(prev => prev.map(r => r.key === row.key ? { ...r, status: 'processing', message: '' } : r));
      try {
        const res = await fetch(RECEIVE_URL, {
          method: 'POST', headers: { ...FUSION_HDRS, 'Content-Type': 'application/json' }, body: JSON.stringify(row.body),
        });
        const text = await res.text();
        let data: any = null, pretty = text;
        try { data = JSON.parse(text); pretty = JSON.stringify(data, null, 2); } catch { /* not json */ }
        const pStatus = data?.ProcessingStatusCode ?? data?.processingStatusCode;
        const retStatus = data?.ReturnStatus ?? data?.returnStatus;
        const retMsg  = data?.ReturnMessage ?? data?.returnMessage;
        // Fusion can return HTTP 200 with ReturnStatus=ERROR — treat that as a failure.
        const statusOk = pStatus ? ['SUCCESS', 'PENDING'].includes(String(pStatus).toUpperCase()) : true;
        const returnOk = !retStatus || String(retStatus).toUpperCase() !== 'ERROR';
        const ok = res.ok && statusOk && returnOk;
        const msg = ok
          ? `${pStatus ?? 'sent'}${data?.HeaderInterfaceId ? ` · Hdr ${data.HeaderInterfaceId}` : ''}`
          : (retMsg || (retStatus ? `ReturnStatus: ${retStatus}` : '') || data?.detail || data?.title || `HTTP ${res.status}`);
        setReceiveRows(prev => prev.map(r => r.key === row.key ? { ...r, status: ok ? 'success' : 'error', http: res.status, message: String(msg), response: pretty } : r));
        if (ok) succeeded.push(row.key);
      } catch (e: any) {
        setReceiveRows(prev => prev.map(r => r.key === row.key ? { ...r, status: 'error', http: 0, message: e?.message ?? 'Network error', response: e?.message ?? '' } : r));
      }
    }
    // Mark successful lines received + deselect them.
    if (succeeded.length) {
      setReceivedKeys(prev => { const n = new Set(prev); succeeded.forEach(k => n.add(k)); return n; });
      setRcvSelectedKeys(prev => prev.filter(k => !succeeded.includes(k)));
      message.success(`${succeeded.length} line(s) received`);
    }
    setReceiveLoading(false);
  };

  // ── Lines tab columns ──────────────────────────────────────────────────────
  const lineColumns = [
    { title: 'Line / Sch', key: 'linesch', width: 90,
      render: (_: unknown, r: ReceiptLine) => `${r.DocumentLineNumber ?? '—'}.${r.DocumentScheduleNumber ?? '—'}` },
    { title: 'Item Number', dataIndex: 'ItemNumber', key: 'ItemNumber', width: 150,
      render: (v: string) => <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 12 }}>{v ?? '—'}</span> },
    { title: 'Description', dataIndex: 'ItemDescription', key: 'ItemDescription', width: 220, ellipsis: true,
      render: (v: string) => <Tooltip title={v}><span>{v ?? '—'}</span></Tooltip> },
    { title: 'Avail Qty', dataIndex: 'AvailableQuantity', key: 'AvailableQuantity', width: 90, align: 'right' as const,
      render: (v: number) => {
        if (v === undefined || v === null) return '—';
        const color = v > 0 ? REDWOOD.success : REDWOOD.info;
        return <Tag style={{ background: color + '18', color, borderColor: color + '60', fontWeight: 600 }}>{v.toLocaleString()}</Tag>;
      } },
    { title: 'Ordered Qty', dataIndex: 'OrderedQuantity', key: 'OrderedQuantity', width: 100, align: 'right' as const,
      render: (v: number) => v !== undefined && v !== null ? v.toLocaleString() : '—' },
    { title: 'UOM', dataIndex: 'UOMCode', key: 'UOMCode', width: 60, align: 'center' as const },
    { title: 'Due Date', dataIndex: 'DueDate', key: 'DueDate', width: 130,
      render: (v: string) => <DueDateTag date={v} /> },
    { title: 'Unit Price', dataIndex: 'POUnitPrice', key: 'POUnitPrice', width: 110, align: 'right' as const,
      render: (v: number) => v !== undefined && v !== null
        ? v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—' },
    { title: 'Currency', dataIndex: 'CurrencyCode', key: 'CurrencyCode', width: 80 },
    { title: 'Status', dataIndex: 'IntegrationStatus', key: 'IntegrationStatus', width: 170,
      render: (v: string) => <StatusTag status={v} /> },
    { title: 'ASN', dataIndex: 'ASNNumber', key: 'ASNNumber', width: 150, ellipsis: true,
      render: (v: string) => v
        ? <Tooltip title={v}><Tag color="purple" style={{ margin: 0 }}>{v}</Tag></Tooltip>
        : <span style={{ color: REDWOOD.neutral600 }}>—</span> },
    { title: '', key: 'actions', width: 48, fixed: 'right' as const,
      render: (_: unknown, record: ReceiptLine) => (
        <Tooltip title="View all fields">
          <Button size="small" icon={<EyeOutlined />} onClick={() => setAllFieldsRecord(record)} />
        </Tooltip>
      ) },
  ];

  // ── Receiving tab columns ──────────────────────────────────────────────────
  const rcvColumns = [
    { title: '', key: 'recvStatus', width: 44, align: 'center' as const,
      render: (_: unknown, r: ReceiptLine) => receivedKeys.has(String(r.DocumentLineId ?? ''))
        ? <Tooltip title="Received"><Tag color="success" style={{ margin: 0, fontSize: 10 }}>✓</Tag></Tooltip>
        : null },
    { title: 'Line / Sch', key: 'linesch', width: 80,
      render: (_: unknown, r: ReceiptLine) => `${r.DocumentLineNumber ?? '—'}.${r.DocumentScheduleNumber ?? '—'}` },
    { title: 'Item', dataIndex: 'ItemNumber', key: 'ItemNumber', width: 130,
      render: (v: string) => <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 12 }}>{v ?? '—'}</span> },
    { title: 'Description', dataIndex: 'ItemDescription', key: 'ItemDescription', width: 180, ellipsis: true,
      render: (v: string) => <Tooltip title={v}><span style={{ fontSize: 12 }}>{v ?? '—'}</span></Tooltip> },
    { title: 'Qty', key: 'rcvQty', width: 90, align: 'right' as const,
      render: (_: unknown, r: ReceiptLine) => {
        const k = String(r.DocumentLineId ?? '');
        const disabled = !rcvSelectedKeys.includes(k);
        return <InputNumber size="small" min={0} precision={4} style={{ width: 80 }} disabled={disabled}
          value={rcvLineData[k]?.qty ?? (r.AvailableQuantity ?? r.OrderedQuantity ?? 0)}
          onChange={val => rcvUpdateField(k, 'qty', val ?? 0)} />;
      } },
    { title: 'UOM', dataIndex: 'UOMCode', key: 'UOMCode', width: 60, align: 'center' as const,
      render: (v: string) => <Tag style={{ fontSize: 11 }}>{v ?? '—'}</Tag> },
    { title: <Tooltip title="Item lot / serial control — drives whether lotSerialItemLots is sent">Lot / Serial</Tooltip>, key: 'ctl', width: 120, align: 'center' as const,
      render: (_: unknown, r: ReceiptLine) => {
        const lot = lineLotCtl(r), ser = lineSerialCtl(r);
        return <Space size={2}>
          <Tag color={lot ? 'green' : 'default'} style={{ margin: 0, fontSize: 10 }}>Lot {lot ? '✓' : '✗'}</Tag>
          <Tag color={ser ? 'blue' : 'default'} style={{ margin: 0, fontSize: 10 }}>Ser {ser ? '✓' : '✗'}</Tag>
        </Space>;
      } },
    { title: <span><span style={{ color: REDWOOD.primary, marginRight: 2 }}>*</span>Subinventory</span>, key: 'subinventory', width: 200,
      render: (_: unknown, r: ReceiptLine) => {
        const k = String(r.DocumentLineId ?? '');
        const disabled = !rcvSelectedKeys.includes(k);
        const val = rcvLineData[k]?.subinventory || undefined;
        return (
          <Space size={2}>
            <Select size="small" showSearch allowClear style={{ width: 150 }} disabled={disabled}
              placeholder="Select subinventory"
              status={!disabled && !val ? 'error' : undefined}
              value={val}
              onChange={v => rcvUpdateField(k, 'subinventory', v || '')}
              options={subinvOptions.map(s => ({ label: s, value: s }))}
              notFoundContent={subinvOptions.length === 0 ? 'No subinventories' : undefined} />
            <Tooltip title="Copy this subinventory to all lines">
              <Button size="small" type="text" icon={<CopyOutlined />} disabled={!val}
                onClick={() => setRcvLineData(prev => {
                  const next = { ...prev };
                  Object.keys(next).forEach(kk => { next[kk] = { ...next[kk], subinventory: val as string }; });
                  return next;
                })} />
            </Tooltip>
          </Space>
        );
      } },
    { title: 'Lot Number', key: 'lotNumber', width: 200,
      render: (_: unknown, r: ReceiptLine) => {
        const k = String(r.DocumentLineId ?? '');
        const disabled = !rcvSelectedKeys.includes(k);
        return <Input size="small" style={{ width: 190 }} disabled={disabled}
          value={rcvLineData[k]?.lotNumber ?? `IGRN_${poNumber}`}
          onChange={e => rcvUpdateField(k, 'lotNumber', e.target.value)} />;
      } },
    { title: 'Locator', key: 'locator', width: 150,
      render: (_: unknown, r: ReceiptLine) => {
        const k = String(r.DocumentLineId ?? '');
        const disabled = !rcvSelectedKeys.includes(k);
        return <Input size="small" style={{ width: 140 }} placeholder="—" disabled={disabled}
          value={rcvLineData[k]?.locator ?? ''}
          onChange={e => rcvUpdateField(k, 'locator', e.target.value)} />;
      } },
    { title: 'From Serial', key: 'fromSerial', width: 220,
      render: (_: unknown, r: ReceiptLine) => {
        const k = String(r.DocumentLineId ?? '');
        const disabled = !rcvSelectedKeys.includes(k);
        return <Input size="small" style={{ width: 210 }} disabled={disabled}
          value={rcvLineData[k]?.fromSerial ?? ''}
          onChange={e => rcvUpdateField(k, 'fromSerial', e.target.value)} />;
      } },
    { title: 'To Serial', key: 'toSerial', width: 220,
      render: (_: unknown, r: ReceiptLine) => {
        const k = String(r.DocumentLineId ?? '');
        const disabled = !rcvSelectedKeys.includes(k);
        return <Input size="small" style={{ width: 210 }} disabled={disabled}
          value={rcvLineData[k]?.toSerial ?? ''}
          onChange={e => rcvUpdateField(k, 'toSerial', e.target.value)} />;
      } },
  ];

  return (
    <div style={{ padding: '4px 0 20px' }}>
      {/* Header strip */}
      <Card
        size="small"
        style={{ marginBottom: 14, borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}` }}
        styles={{ body: { padding: '12px 16px' } }}
        title={<Text strong style={{ color: REDWOOD.teal, fontSize: 13 }}>Purchase Order Header</Text>}
        extra={
          <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={handleRefresh}>
            Refresh Lines
          </Button>
        }
      >
        <Row gutter={[8, 8]}>
          <Col xs={12} sm={8} md={4}><InfoTile label="PO Number" value={<span style={{ color: REDWOOD.info, fontWeight: 700 }}>{poNumber}</span>} /></Col>
          <Col xs={12} sm={8} md={4}><InfoTile label="ASN" value={asnDisplay ? <Tag color="purple" style={{ margin: 0 }}>{asnDisplay}</Tag> : '—'} /></Col>
          <Col xs={12} sm={8} md={4}><InfoTile label="No. of Lines" value={String(lines.length)} /></Col>
          <Col xs={12} sm={8} md={4}><InfoTile label="Organization" value={firstLine?.ToOrganizationCode} /></Col>
          <Col xs={12} sm={8} md={4}><InfoTile label="Vendor" value={firstLine?.VendorName} /></Col>
          <Col xs={12} sm={8} md={4}><InfoTile label="Vendor Site" value={firstLine?.VendorSiteCode} /></Col>
          <Col xs={12} sm={8} md={4}><InfoTile label="Source Doc Code" value={firstLine?.SourceDocumentCode as string} /></Col>
          <Col xs={12} sm={8} md={4}><InfoTile label="Currency" value={firstLine?.CurrencyCode} /></Col>
          <Col xs={12} sm={8} md={4}><InfoTile label="Destination Type" value={firstLine?.DestinationType} /></Col>
          <Col xs={12} sm={8} md={4}><InfoTile label="Ship To Location" value={firstLine?.ShipToLocation as string} /></Col>
          <Col xs={12} sm={8} md={4}><InfoTile label="Integration Status" value={firstLine?.IntegrationStatus} /></Col>
        </Row>
      </Card>

      {/* Lines / Receiving tabs */}
      <Card
        size="small"
        style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}` }}
        styles={{ body: { padding: '0 12px 12px' } }}
      >
        <Tabs
          size="small"
          activeKey={detailSubTab}
          onChange={k => setDetailSubTab(k as 'lines' | 'receiving')}
          tabBarStyle={{ marginBottom: 0 }}
          items={[
            {
              key: 'lines',
              label: (
                <Space size={4}>
                  <span>Lines</span>
                  <Badge count={lines.length} size="small" style={{ background: REDWOOD.teal }} overflowCount={9999} />
                  {loading && <Spin size="small" />}
                </Space>
              ),
              children: (
                <div style={{ paddingTop: 8 }}>
                  <Table<ReceiptLine>
                    dataSource={lines}
                    columns={lineColumns}
                    rowKey={(r, i) => String(r.DocumentLineId ?? i)}
                    size="small"
                    scroll={{ x: 'max-content' }}
                    loading={loading}
                    pagination={{ pageSize: 20, showSizeChanger: true, showTotal: t => `${t} lines` }}
                  />
                </div>
              ),
            },
            {
              key: 'receiving',
              label: (
                <Space size={4}>
                  <InboxOutlined />
                  <span>Receiving</span>
                  {rcvSelectedKeys.length > 0 && (
                    <Badge count={rcvSelectedKeys.length} size="small" style={{ background: REDWOOD.primary }} />
                  )}
                </Space>
              ),
              children: (
                <div style={{ paddingTop: 10 }}>
                  {/* Toolbar */}
                  <Space style={{ marginBottom: 12, flexWrap: 'wrap' as const }}>
                    <Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>Subinventory for all:</Text>
                    <Select
                      size="small" showSearch allowClear style={{ width: 190 }}
                      placeholder="Apply to all lines"
                      options={subinvOptions.map(s => ({ label: s, value: s }))}
                      onChange={v => { setRcvLineData(prev => {
                        const next = { ...prev };
                        Object.keys(next).forEach(k => { next[k] = { ...next[k], subinventory: (v as string) || '' }; });
                        return next;
                      }); if (v) message.success(`Subinventory "${v}" applied to all ${lines.length} line(s)`); }}
                      notFoundContent={subinvOptions.length === 0 ? 'No subinventories' : undefined}
                    />
                    <Button
                      type="primary"
                      icon={<InboxOutlined />}
                      disabled={rcvSelectedKeys.length === 0}
                      style={{ background: REDWOOD.success, borderColor: REDWOOD.success }}
                      onClick={openReceive}
                    >
                      Receive PO
                    </Button>
                    <Button
                      icon={<EnvironmentOutlined />}
                      disabled={rcvSelectedKeys.length === 0}
                      onClick={() => message.info('Find Locators — not yet implemented')}
                    >
                      Find Locators
                    </Button>
                    <Button
                      icon={<CodeOutlined />}
                      disabled={rcvSelectedKeys.length === 0}
                      onClick={() => setRcvJsonOpen(true)}
                    >
                      View JSON
                    </Button>
                    <Button
                      icon={<EditOutlined />}
                      onClick={() => { setTempLot(lotPrefix); setRcvLotOpen(true); }}
                    >
                      Change Lot
                    </Button>
                    <Button
                      icon={<NumberOutlined />}
                      onClick={() => { setTempSerial(serialStart); setRcvSerialOpen(true); }}
                    >
                      Serial Start
                    </Button>
                    {rcvSelectedKeys.length > 0 && (
                      <Tag color="blue">{rcvSelectedKeys.length} line{rcvSelectedKeys.length !== 1 ? 's' : ''} selected</Tag>
                    )}
                    <Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>Shipment #:</Text>
                    <Input
                      size="small" style={{ width: 140 }} placeholder="auto-generated"
                      value={rcvShipmentNum}
                      onChange={e => setRcvShipmentNum(e.target.value)}
                    />
                  </Space>

                  <Table<ReceiptLine>
                    dataSource={lines}
                    columns={rcvColumns}
                    rowKey={r => String(r.DocumentLineId ?? '')}
                    size="small"
                    scroll={{ x: 'max-content' }}
                    loading={loading}
                    pagination={false}
                    rowClassName={(r) => receivedKeys.has(String(r.DocumentLineId ?? '')) ? 'qoh-ok' : ''}
                    rowSelection={{
                      selectedRowKeys: rcvSelectedKeys,
                      onChange: keys => setRcvSelectedKeys(keys as (string | number)[]),
                      getCheckboxProps: (r) => ({ disabled: receivedKeys.has(String(r.DocumentLineId ?? '')) }),
                    }}
                  />
                </div>
              ),
            },
          ]}
        />
      </Card>

      <AllFieldsModal
        open={!!allFieldsRecord}
        onClose={() => setAllFieldsRecord(null)}
        record={allFieldsRecord as Record<string, unknown> | null}
        title={`All Fields — PO ${poNumber} · Line ${allFieldsRecord?.DocumentLineNumber ?? ''}.${allFieldsRecord?.DocumentScheduleNumber ?? ''}`}
      />

      {/* Receiving JSON Preview Modal */}
      <Modal
        title={<Space><CodeOutlined style={{ color: REDWOOD.info }} />Receiving JSON Preview — PO {poNumber}</Space>}
        open={rcvJsonOpen}
        onCancel={() => setRcvJsonOpen(false)}
        width={960}
        footer={[
          <Button key="copy" icon={<CopyOutlined />} onClick={() => {
            navigator.clipboard.writeText(JSON.stringify(buildReceivingJson(), null, 2));
            message.success('Copied to clipboard');
          }}>Copy JSON</Button>,
          <Button key="close" onClick={() => setRcvJsonOpen(false)}>Close</Button>,
        ]}
      >
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
          {rcvSelectedKeys.length} line{rcvSelectedKeys.length !== 1 ? 's' : ''} selected · PO: <Text strong>{poNumber}</Text>
        </Text>
        <pre style={{
          background: '#1e1e1e', color: '#d4d4d4',
          padding: 16, borderRadius: 8,
          maxHeight: 520, overflow: 'auto',
          fontSize: 12, lineHeight: 1.6,
          fontFamily: '"Fira Code", Consolas, monospace',
          margin: 0,
        }}>
          {JSON.stringify(buildReceivingJson(), null, 2)}
        </pre>
      </Modal>

      {/* Receive PO — per-line receivingReceiptRequests with live status */}
      <Modal
        open={receiveOpen}
        onCancel={() => setReceiveOpen(false)}
        width={900}
        title={<Space><InboxOutlined style={{ color: REDWOOD.success }} />Receive PO — {receiveRows.length} line(s)</Space>}
        footer={
          <Space>
            <Button onClick={() => setReceiveOpen(false)}>Close</Button>
            <Button type="primary" loading={receiveLoading} icon={<InboxOutlined />}
              disabled={receiveRows.every(r => r.status === 'success')}
              style={{ background: REDWOOD.success, borderColor: REDWOOD.success }}
              onClick={runReceive}>
              Confirm &amp; Receive ({receiveRows.filter(r => r.status !== 'success').length})
            </Button>
          </Space>
        }
      >
        <div style={{ fontSize: 12, marginBottom: 8 }}>
          <Space size={6}><Tag color="green">POST</Tag>
            <Text copyable style={{ fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all' }}>{RECEIVE_URL}</Text>
          </Space>
        </div>
        <Text type="secondary" style={{ fontSize: 12 }}>
          Each line is posted separately. Successful lines are marked and deselected. Expand a row to see its URL, JSON payload and response.
        </Text>
        <Table<RcvRow>
          style={{ marginTop: 10 }}
          size="small"
          rowKey="key"
          dataSource={receiveRows}
          pagination={false}
          scroll={{ y: 320 }}
          expandable={{
            expandedRowRender: (r) => (
              <div>
                <div style={{ fontSize: 11, color: REDWOOD.neutral600, marginBottom: 4 }}>Request Body</div>
                <pre style={{ fontSize: 10.5, background: '#0d0d0d', color: '#a8ff78', borderRadius: 4, padding: 8, margin: 0, maxHeight: 200, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                  {JSON.stringify(r.body, null, 2)}
                </pre>
                {r.response && (
                  <>
                    <div style={{ fontSize: 11, color: REDWOOD.neutral600, margin: '6px 0 4px' }}>Response {r.http ? `(HTTP ${r.http})` : ''}</div>
                    <pre style={{ fontSize: 10.5, background: '#0d0d0d', color: '#79c0ff', borderRadius: 4, padding: 8, margin: 0, maxHeight: 200, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                      {r.response}
                    </pre>
                  </>
                )}
              </div>
            ),
          }}
          columns={[
            { title: 'Item', dataIndex: 'item', width: 150, render: (v: string) => <span style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: 12 }}>{v}</span> },
            { title: 'Qty', dataIndex: 'qty', width: 70, align: 'right' as const },
            { title: 'Subinv', dataIndex: 'subinv', width: 110, render: (v: string) => <Tag style={{ fontSize: 11 }}>{v || '—'}</Tag> },
            { title: 'Status', dataIndex: 'status', width: 110, render: (s: RcvRow['status']) => {
              const map: Record<RcvRow['status'], { c: string; t: string }> = {
                pending: { c: 'default', t: 'Pending' }, processing: { c: 'processing', t: 'Processing…' },
                success: { c: 'success', t: 'Success' }, error: { c: 'error', t: 'Error' },
              };
              return <Tag color={map[s].c as any}>{map[s].t}</Tag>;
            } },
            { title: 'Message', dataIndex: 'message', ellipsis: true, render: (v: string) => <Tooltip title={v}><span style={{ fontSize: 11 }}>{v || '—'}</span></Tooltip> },
          ]}
        />
      </Modal>

      {/* Change Lot Number Modal */}
      <Modal
        title={<Space><EditOutlined style={{ color: REDWOOD.info }} />Change Lot Number</Space>}
        open={rcvLotOpen}
        onOk={() => { setLotPrefix(tempLot || `IGRN_${poNumber}`); setRcvLotOpen(false); }}
        onCancel={() => setRcvLotOpen(false)}
        okText="Apply & Regenerate"
        width={440}
      >
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
          The lot number is applied to all lines. Serial numbers will also be regenerated using this value as prefix.
        </Text>
        <Input
          value={tempLot}
          onChange={e => setTempLot(e.target.value)}
          placeholder={`IGRN_${poNumber}`}
          addonBefore="Lot #"
          size="large"
        />
        <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 8 }}>
          Current: <Text strong code>{lotPrefix}</Text>
        </Text>
      </Modal>

      {/* Change Serial Start Modal */}
      <Modal
        title={<Space><NumberOutlined style={{ color: REDWOOD.info }} />Change Serial Start Number</Space>}
        open={rcvSerialOpen}
        onOk={() => { setSerialStart(tempSerial > 0 ? tempSerial : 1); setRcvSerialOpen(false); }}
        onCancel={() => setRcvSerialOpen(false)}
        okText="Apply & Regenerate"
        width={440}
      >
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
          Serial numbers will be re-assigned starting from this number. All lines are recalculated in order.
        </Text>
        <InputNumber
          min={1}
          value={tempSerial}
          onChange={v => setTempSerial(v ?? 1)}
          style={{ width: '100%' }}
          addonBefore="Start from"
          size="large"
        />
        <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 8 }}>
          Current start: <Text strong code>{serialStart}</Text> — example: line 1 (qty 10) → <Text code>{lotPrefix}_{pad3(serialStart)}</Text> to <Text code>{lotPrefix}_{pad3(serialStart + 9)}</Text>
        </Text>
      </Modal>
    </div>
  );
};

// ── Search Tab ─────────────────────────────────────────────────────────────────
const SearchTabContent: React.FC<{ onOpenPO: (group: POGroup) => void }> = ({ onOpenPO }) => {
  const [org, setOrg] = useState('');
  const [poNum, setPoNum] = useState('');
  const [asn, setAsn] = useState('');
  const [sourceDoc, setSourceDoc] = useState<string>('');
  const [orgs, setOrgs] = useState<{ code: string; name: string }[]>([]);
  const [orgsLoading, setOrgsLoading] = useState(false);
  const [orgError, setOrgError] = useState('');
  const [dateMode, setDateMode] = useState<DateMode>('none');

  // Inventory organizations for the Organization dropdown — same source as the
  // On-Hand Inventory page (inventoryOrganizations web service).
  const orgsUrl = `${FUSION_BASE}/inventoryOrganizations?onlyData=true&limit=500`;
  const loadOrgs = useCallback(() => {
    setOrgsLoading(true); setOrgError('');
    fetch(orgsUrl, { headers: FUSION_HDRS })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status} ${r.statusText}`)))
      .then(d => {
        const items: any[] = Array.isArray(d) ? d : (d.items ?? []);
        const seen = new Set<string>();
        const list = items
          .map(o => ({ code: o.OrganizationCode ?? o.OrganizationCode, name: o.OrganizationName }))
          .filter(o => o.code && !seen.has(o.code) && seen.add(o.code))
          .sort((a, b) => String(a.code).localeCompare(String(b.code)));
        setOrgs(list);
        if (list.length === 0) setOrgError('inventoryOrganizations returned no rows.');
      })
      .catch((e) => setOrgError(e?.message || 'Failed to load organizations'))
      .finally(() => setOrgsLoading(false));
  }, [orgsUrl]);
  useEffect(() => { loadOrgs(); }, [loadOrgs]);
  const [exactDate, setExactDate] = useState<Dayjs | null>(null);
  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [groups, setGroups] = useState<POGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [filterText, setFilterText] = useState('');
  const [apiOpen, setApiOpen] = useState(false);

  // The exact linesToReceive request the current filters will run.
  const currentUrl = useMemo(() => {
    let q = buildQuery(org, poNum, dateMode, exactDate, dateRange, asn);
    if (sourceDoc.trim()) q = (q ? q + ';' : '') + `SourceDocumentCode='${sourceDoc.trim()}'`;
    const qParam = q ? `q=${encodeURIComponent(q)}&` : '';
    return `${FUSION_BASE}/linesToReceive?${qParam}limit=500&offset=0`;
  }, [org, poNum, asn, sourceDoc, dateMode, exactDate, dateRange]);

  const handleSearch = useCallback(async () => {
    setLoading(true);
    setSearched(true);
    setFilterText('');
    try {
      let q = buildQuery(org, poNum, dateMode, exactDate, dateRange, asn);
      if (sourceDoc.trim()) q = (q ? q + ';' : '') + `SourceDocumentCode='${sourceDoc.trim()}'`;
      const rows = await fetchLinesToReceive(q);
      const grouped = groupRows(rows);
      setGroups(grouped);
      if (grouped.length === 0) message.info('No records found.');
    } catch (e: unknown) {
      message.error('Search failed: ' + (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [org, poNum, asn, sourceDoc, dateMode, exactDate, dateRange]);

  const handleClear = () => {
    setOrg(''); setPoNum(''); setAsn(''); setSourceDoc(''); setDateMode('none');
    setExactDate(null); setDateRange(null);
    setGroups([]); setSearched(false); setFilterText('');
  };

  // Pre-fill + auto-search when arriving with ?po=<number> (from the PO search page).
  const [urlParams] = useSearchParams();
  const [pendingPoSearch, setPendingPoSearch] = useState(false);
  useEffect(() => {
    const po = urlParams.get('po');
    if (po) { setPoNum(po); setPendingPoSearch(true); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (pendingPoSearch && poNum) { setPendingPoSearch(false); handleSearch(); }
  }, [pendingPoSearch, poNum, handleSearch]);

  const filteredGroups = useMemo(() => {
    if (!filterText.trim()) return groups;
    const term = filterText.toLowerCase();
    return groups.filter(g =>
      [g.DocumentNumber, g.VendorName, g.ToOrganizationCode,
       g.SourceDocumentCode, g.DestinationType, g.ShipToLocation,
       g.IntegrationStatus, g.ASNNumbers, g.dueDateEarliest]
        .some(v => v?.toLowerCase().includes(term))
    );
  }, [groups, filterText]);

  const handleExport = useCallback(() => {
    if (filteredGroups.length === 0) { message.warning('No data to export.'); return; }
    const sheetData = filteredGroups.map(g => ({
      'PO Number': g.DocumentNumber,
      'Organization': g.ToOrganizationCode,
      'Source Doc Code': g.SourceDocumentCode,
      'Vendor': g.VendorName,
      'Destination Type': g.DestinationType,
      'Ship To Location': g.ShipToLocation,
      'Integration Status': g.IntegrationStatus,
      'ASN Number': g.ASNNumbers,
      'Earliest Due Date': g.dueDateEarliest,
      'Latest Due Date': g.dueDateLatest !== g.dueDateEarliest ? g.dueDateLatest : '',
      'Lines Count': g.linesCount,
    }));
    const ws = XLSX.utils.json_to_sheet(sheetData);
    ws['!cols'] = [
      { wch: 16 }, { wch: 14 }, { wch: 16 }, { wch: 36 },
      { wch: 18 }, { wch: 26 }, { wch: 22 }, { wch: 18 }, { wch: 16 }, { wch: 16 }, { wch: 10 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Expected PO Receipts');
    XLSX.writeFile(wb, `expected-po-receipts-${dayjs().format('YYYY-MM-DD')}.xlsx`);
    message.success(`Exported ${filteredGroups.length} purchase orders.`);
  }, [filteredGroups]);

  const columns = [
    {
      title: 'PO Number',
      dataIndex: 'DocumentNumber',
      key: 'DocumentNumber',
      width: 140,
      render: (v: string, record: POGroup) => (
        <Button
          type="link"
          style={{ padding: 0, fontWeight: 700, color: REDWOOD.info }}
          onClick={() => onOpenPO(record)}
        >
          {v}
        </Button>
      ),
    },
    {
      title: 'ASN',
      dataIndex: 'ASNNumbers',
      key: 'ASNNumbers',
      width: 240,
      render: (v: string) => v
        ? <Tooltip title={v}><Tag color="purple" style={{ whiteSpace: 'normal', height: 'auto', wordBreak: 'break-all', margin: 0 }}>{v}</Tag></Tooltip>
        : <span style={{ color: REDWOOD.neutral600 }}>—</span>,
    },
    {
      title: 'No. of Lines',
      dataIndex: 'linesCount',
      key: 'linesCount',
      width: 90,
      align: 'center' as const,
      render: (v: number) => (
        <Badge
          count={v}
          style={{ background: REDWOOD.teal, fontWeight: 600 }}
          overflowCount={999}
        />
      ),
    },
    {
      title: 'Organization',
      dataIndex: 'ToOrganizationCode',
      key: 'ToOrganizationCode',
      width: 110,
      render: (v: string) => v && v !== '—' ? <Tag color="cyan">{v}</Tag> : '—',
    },
    {
      title: 'Source Doc Code',
      dataIndex: 'SourceDocumentCode',
      key: 'SourceDocumentCode',
      width: 140,
    },
    {
      title: 'Vendor',
      dataIndex: 'VendorName',
      key: 'VendorName',
      width: 200,
      ellipsis: true,
    },
    {
      title: 'Destination Type',
      dataIndex: 'DestinationType',
      key: 'DestinationType',
      width: 140,
    },
    {
      title: 'Ship To Location',
      dataIndex: 'ShipToLocation',
      key: 'ShipToLocation',
      width: 180,
      ellipsis: true,
    },
    {
      title: 'Integration Status',
      dataIndex: 'IntegrationStatus',
      key: 'IntegrationStatus',
      width: 170,
      render: (v: string) => <StatusTag status={v} />,
    },
    {
      title: 'Due Date',
      dataIndex: 'dueDateEarliest',
      key: 'dueDateEarliest',
      width: 140,
      sorter: (a: POGroup, b: POGroup) => {
        if (!a.dueDateEarliest) return 1;
        if (!b.dueDateEarliest) return -1;
        return a.dueDateEarliest.localeCompare(b.dueDateEarliest);
      },
      defaultSortOrder: 'ascend' as const,
      render: (v: string, r: POGroup) => {
        if (!v) return '—';
        const hasRange = r.dueDateLatest && r.dueDateLatest !== v;
        return (
          <Space size={4} direction="vertical" style={{ gap: 2 }}>
            <DueDateTag date={v} />
            {hasRange && (
              <span style={{ fontSize: 10, color: REDWOOD.neutral600 }}>
                → {r.dueDateLatest}
              </span>
            )}
          </Space>
        );
      },
    },
  ];

  return (
    <div style={{ padding: '4px 0' }}>
      {/* Search form */}
      <Card
        style={{ marginBottom: 14, borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}` }}
        styles={{ body: { padding: '14px 16px' } }}
      >
        <Form layout="vertical">
          <Row gutter={[12, 0]} align="bottom">
            <Col xs={24} sm={6}>
              <Form.Item label="Organization" style={{ marginBottom: 0 }}>
                {orgs.length > 0 ? (
                  <Select
                    showSearch
                    allowClear
                    size="small"
                    loading={orgsLoading}
                    placeholder="Select inventory org"
                    value={org || undefined}
                    onChange={v => setOrg(v || '')}
                    optionFilterProp="label"
                    style={{ width: '100%' }}
                    options={orgs.map(o => ({ label: o.name ? `${o.code} — ${o.name}` : o.code, value: o.code }))}
                  />
                ) : (
                  <Input
                    placeholder={orgsLoading ? 'Loading orgs…' : 'e.g. AMS_B2B_GHANA'}
                    value={org}
                    onChange={e => setOrg(e.target.value)}
                    onPressEnter={handleSearch}
                    allowClear
                    size="small"
                    suffix={<Tooltip title="Reload org list"><ReloadOutlined spin={orgsLoading} onClick={loadOrgs} style={{ cursor: 'pointer', color: REDWOOD.info }} /></Tooltip>}
                  />
                )}
              </Form.Item>
            </Col>
            <Col xs={24} sm={6}>
              <Form.Item label="Purchase Order" style={{ marginBottom: 0 }}>
                <Input
                  placeholder="e.g. 2026020014"
                  value={poNum}
                  onChange={e => setPoNum(e.target.value)}
                  onPressEnter={handleSearch}
                  allowClear
                  size="small"
                />
              </Form.Item>
            </Col>
            <Col xs={24} sm={6}>
              <Form.Item label="ASN Number" style={{ marginBottom: 0 }}>
                <Input
                  placeholder="e.g. ASN2607282232"
                  value={asn}
                  onChange={e => setAsn(e.target.value)}
                  onPressEnter={handleSearch}
                  allowClear
                  size="small"
                />
              </Form.Item>
            </Col>
            <Col xs={24} sm={6}>
              <Form.Item label="Source Document" style={{ marginBottom: 0 }}>
                <Select
                  value={sourceDoc || undefined}
                  onChange={v => setSourceDoc(v || '')}
                  size="small"
                  allowClear
                  placeholder="All"
                  style={{ width: '100%' }}
                  options={[
                    { label: 'Purchase Order (PO)', value: 'PO' },
                    { label: 'Transfer Order (TO)', value: 'TRANSFER ORDER' },
                    { label: 'ASN', value: 'ASN' },
                    { label: 'RMA', value: 'RMA' },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col xs={24} sm={6}>
              <Form.Item label="Date Filter" style={{ marginBottom: 0 }}>
                <Select
                  value={dateMode}
                  onChange={v => { setDateMode(v); setExactDate(null); setDateRange(null); }}
                  size="small"
                  style={{ width: '100%' }}
                >
                  <Option value="none">No Date Filter</Option>
                  <Option value="exact">= Exact Date</Option>
                  <Option value="last7">Last 7 Days</Option>
                  <Option value="last15">Last 15 Days</Option>
                  <Option value="range">Date Range</Option>
                </Select>
              </Form.Item>
            </Col>
            <Col xs={24} sm={6}>
              <Form.Item label=" " style={{ marginBottom: 0 }}>
                <Space>
                  <Button
                    type="primary"
                    icon={<SearchOutlined />}
                    onClick={handleSearch}
                    loading={loading}
                    size="small"
                    style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}
                  >
                    Search
                  </Button>
                  <Button icon={<ClearOutlined />} onClick={handleClear} size="small">
                    Clear
                  </Button>
                  <Tooltip title="Show the Fusion web service URL">
                    <Button icon={<ApiOutlined />} size="small" onClick={() => setApiOpen(true)} />
                  </Tooltip>
                </Space>
              </Form.Item>
            </Col>
          </Row>

          {dateMode === 'exact' && (
            <Row style={{ marginTop: 10 }}>
              <Col xs={24} sm={8}>
                <Form.Item label="Exact Date" style={{ marginBottom: 0 }}>
                  <DatePicker
                    value={exactDate}
                    onChange={d => setExactDate(d)}
                    size="small"
                    style={{ width: '100%' }}
                  />
                </Form.Item>
              </Col>
            </Row>
          )}
          {dateMode === 'range' && (
            <Row style={{ marginTop: 10 }}>
              <Col xs={24} sm={12}>
                <Form.Item label="Date Range" style={{ marginBottom: 0 }}>
                  <RangePicker
                    value={dateRange as [Dayjs, Dayjs] | null}
                    onChange={v => setDateRange(v ? [v[0], v[1]] : null)}
                    size="small"
                    style={{ width: '100%' }}
                  />
                </Form.Item>
              </Col>
            </Row>
          )}
        </Form>
      </Card>

      <Modal
        open={apiOpen}
        onCancel={() => setApiOpen(false)}
        footer={<Button onClick={() => setApiOpen(false)}>Close</Button>}
        title={<Space><ApiOutlined style={{ color: REDWOOD.info }} />Fusion Web Service</Space>}
        width={720}
      >
        <div style={{ fontSize: 12, marginBottom: 6 }}>
          <Space size={6}><Tag color="blue">GET</Tag><Text type="secondary">Expected receipts — linesToReceive</Text></Space>
        </div>
        <Text copyable style={{ fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all' }}>{currentUrl}</Text>

        <div style={{ fontSize: 12, margin: '16px 0 6px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Space size={6}><Tag color="blue">GET</Tag><Text type="secondary">Organizations dropdown — inventoryOrganizations</Text></Space>
          <Tag color={orgError ? 'error' : orgsLoading ? 'processing' : 'success'} style={{ fontSize: 10 }}>
            {orgsLoading ? 'loading…' : orgError ? 'error' : `${orgs.length} orgs`}
          </Tag>
          <Button size="small" icon={<ReloadOutlined />} loading={orgsLoading} onClick={loadOrgs} style={{ marginLeft: 'auto' }}>Reload</Button>
        </div>
        <Text copyable style={{ fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all' }}>{orgsUrl}</Text>
        {orgError && <div style={{ fontSize: 11, color: REDWOOD.primary, marginTop: 6 }}>Org load error: {orgError}</div>}

        <div style={{ fontSize: 11, color: REDWOOD.neutral600, marginTop: 14 }}>
          linesToReceive params: ToOrganizationCode, DocumentNumber, SourceDocumentCode, DueDate (from the filters above).
        </div>
      </Modal>

      {/* Grouped results */}
      {(searched || groups.length > 0) && (
        <Card
          style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}` }}
          styles={{ body: { padding: '8px 12px' } }}
          title={
            <Space>
              <InboxOutlined style={{ color: REDWOOD.teal }} />
              <Text strong>Purchase Orders</Text>
              <Badge count={groups.length} style={{ background: REDWOOD.teal }} overflowCount={9999} />
              {filterText && filteredGroups.length !== groups.length && (
                <Tag color="blue">{filteredGroups.length} shown</Tag>
              )}
              {loading && <Spin size="small" />}
            </Space>
          }
          extra={
            <Space size={6}>
              <Button
                size="small"
                icon={<FileExcelOutlined />}
                onClick={handleExport}
                disabled={loading || filteredGroups.length === 0}
                style={{ color: REDWOOD.success, borderColor: REDWOOD.success }}
              >
                Export
              </Button>
              <Button size="small" icon={<ReloadOutlined />} onClick={handleSearch} disabled={loading}>
                Refresh
              </Button>
            </Space>
          }
        >
          {/* Grid filter bar */}
          <div style={{ marginBottom: 10 }}>
            <Input
              size="small"
              allowClear
              placeholder="Filter results by PO, vendor, org, status, date…"
              prefix={<FilterOutlined style={{ color: REDWOOD.neutral600 }} />}
              value={filterText}
              onChange={e => setFilterText(e.target.value)}
              style={{ maxWidth: 380 }}
            />
          </div>

          <Table<POGroup>
            dataSource={filteredGroups}
            columns={columns}
            rowKey="_key"
            size="small"
            scroll={{ x: 'max-content' }}
            loading={loading}
            pagination={{ pageSize: 20, showSizeChanger: true, showTotal: t => `${t} purchase orders` }}
          />
        </Card>
      )}
    </div>
  );
};

// ── Main Page ───────────────────────────────────────────────────────────────────
const ManageExpectedReceipts: React.FC = () => {
  const [activeTab, setActiveTab] = useState('search');
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([]);

  const handleOpenPO = useCallback((group: POGroup) => {
    const key = `po-${group._key}`;
    setOpenTabs(prev => {
      if (prev.find(t => t.key === key)) return prev;
      return [...prev, { key, poNumber: group.DocumentNumber, asn: group.ASNNumbers, lines: group.lines }];
    });
    setActiveTab(key);
  }, []);

  const handleRemoveTab = useCallback((targetKey: string) => {
    setOpenTabs(prev => {
      const idx = prev.findIndex(t => t.key === targetKey);
      const next = prev.filter(t => t.key !== targetKey);
      if (activeTab === targetKey) {
        const fallback = idx > 0 ? prev[idx - 1].key : (next.length > 0 ? next[0].key : 'search');
        setActiveTab(fallback);
      }
      return next;
    });
  }, [activeTab]);

  const tabItems: TabsProps['items'] = [
    {
      key: 'search',
      label: (
        <span>
          <SearchOutlined style={{ marginRight: 4 }} />
          Search
        </span>
      ),
      closable: false,
      children: <SearchTabContent onOpenPO={handleOpenPO} />,
    },
    ...openTabs.map(tab => ({
      key: tab.key,
      label: (
        <span>
          <InboxOutlined style={{ marginRight: 4 }} />
          {`PO ${tab.poNumber}`}{tab.asn ? ` · ASN ${tab.asn}` : ''}
        </span>
      ),
      closable: true,
      children: (
        <PODetailTab
          poNumber={tab.poNumber}
          asn={tab.asn}
          initialLines={tab.lines}
        />
      ),
    })),
  ];

  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.bg }}>
      <Content>
        {/* Breadcrumb */}
        <div style={{ padding: '10px 24px', background: REDWOOD.surface, borderBottom: `1px solid ${REDWOOD.neutral200}` }}>
          <Space>
            <Link to="/home"><HomeOutlined /> Home</Link>
            <Text type="secondary">/</Text>
            <Link to="/procurement">Fusion Supply Chain</Link>
            <Text type="secondary">/</Text>
            <Text>Expected PO Receipts</Text>
          </Space>
        </div>

        <div style={{ padding: 20 }}>
          {/* Page header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <div style={{
              width: 44, height: 44, borderRadius: 10,
              background: `linear-gradient(135deg, ${REDWOOD.teal} 0%, #007A74 100%)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: `0 4px 12px ${REDWOOD.teal}40`,
            }}>
              <InboxOutlined style={{ fontSize: 22, color: '#fff' }} />
            </div>
            <div>
              <Title level={3} style={{ margin: 0, color: REDWOOD.neutral900 }}>
                Manage Expected PO Receipts
              </Title>
              <Text type="secondary" style={{ fontSize: 12 }}>
                View and manage purchase order lines pending receipt in Oracle Fusion
              </Text>
            </div>
          </div>

          <Tabs
            type="editable-card"
            hideAdd
            activeKey={activeTab}
            onChange={setActiveTab}
            onEdit={(targetKey, action) => {
              if (action === 'remove') handleRemoveTab(String(targetKey));
            }}
            items={tabItems}
            style={{ background: REDWOOD.surface, borderRadius: 8, padding: '0 8px' }}
          />
        </div>
      </Content>
    </Layout>
  );
};

export default ManageExpectedReceipts;
