import { getFusionAuthHeaders } from '../../config/api.helper';
import React, { useMemo, useState } from 'react';
import {
  Card, Row, Col, Button, Table, Tag, Progress, Statistic, Modal, Tabs, Space,
  Typography, Input, Tooltip, message, Empty, Checkbox, Segmented, Breadcrumb, Badge,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Link } from 'react-router-dom';
import { getCurrentCompany } from '../../config/company.config';
import {
  DatabaseOutlined, ApiOutlined, PlayCircleOutlined, ReloadOutlined, CheckCircleTwoTone,
  CloseCircleTwoTone, MinusCircleOutlined, LoadingOutlined, SearchOutlined, CopyOutlined,
  HomeOutlined, AppstoreOutlined, ThunderboltOutlined, GlobalOutlined, FilePdfOutlined, FileExcelOutlined,
} from '@ant-design/icons';
import {
  FUSION_SERVICES, SERVICE_MODULES, buValuesOf,
  type FusionService, type FusionModule,
} from '../../data/fusionServices';

const { Text, Title, Paragraph } = Typography;

// Get Fusion base URL from current company configuration
const getFusionBase = () => {
  const company = getCurrentCompany();
  return company.fusionBaseUrl ? `${company.fusionBaseUrl}/fscmRestApi/resources/11.13.18.05` : '';
};

// Same Fusion endpoint resolution the rest of the app uses (proxy in browser,
// direct URL under Electron) with Basic auth.
const _isElectron = typeof navigator !== 'undefined' && /electron/i.test(navigator.userAgent)
  || !!(window as unknown as { electronAPI?: unknown }).electronAPI;
const FUSION_BASE = `${getFusionBase()}`;
const getHeaders = () => getFusionAuthHeaders();

const RW = {
  primary: '#C74634', info: '#0572CE', success: '#1D7B4D', warn: '#D4A800', error: '#C74634',
  purple: '#6B21A8', teal: '#00918A', n100: '#F4F4F2', n200: '#E4E1DD', n600: '#6B6862', n900: '#1B1A17',
};
const MOD_COLOR: Record<FusionModule, string> = { 'Financials': RW.info, 'Supply Chain': RW.teal };
const MOD_ARGB: Record<FusionModule, string> = { 'Financials': 'FF0572CE', 'Supply Chain': 'FF00918A' };

const PAGE = 500;
const BU_SCAN_MAX = 1500;   // rows sampled per service to discover business units

type Status = 'idle' | 'running' | 'success' | 'empty' | 'error';
interface ServiceResult {
  status: Status;
  count: number;
  scanned: number;
  bus: string[];
  sample: any[];
  error?: string;
  url: string;
}

const svcUrl = (svc: FusionService) => `${FUSION_BASE}/${svc.resource}?onlyData=true&totalResults=true&limit=${PAGE}`;

const runService = async (svc: FusionService): Promise<ServiceResult> => {
  const base = `${FUSION_BASE}/${svc.resource}`;
  const url = svcUrl(svc);
  const bus = new Set<string>();
  let total = 0, scanned = 0, offset = 0, first = true;
  let sample: any[] = [];
  try {
    while (scanned < BU_SCAN_MAX) {
      const r = await fetch(`${base}?onlyData=true&totalResults=true&limit=${PAGE}&offset=${offset}`, { headers: getHeaders() });
      if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText || ''}`.trim());
      const d = await r.json();
      const items: any[] = Array.isArray(d) ? d : (d.items ?? []);
      if (first) { total = typeof d.totalResults === 'number' ? d.totalResults : items.length; sample = items.slice(0, 5); first = false; }
      items.forEach(it => buValuesOf(it, svc.buFields).forEach(b => bus.add(b)));
      scanned += items.length;
      if (!d.hasMore || items.length < PAGE) break;
      offset += PAGE;
    }
    return { status: total > 0 ? 'success' : 'empty', count: total, scanned, bus: [...bus].sort(), sample, url };
  } catch (e: any) {
    return { status: 'error', count: 0, scanned, bus: [], sample: [], error: e?.message ?? String(e), url };
  }
};

const mapLimit = async <T,>(items: T[], limit: number, fn: (t: T, i: number) => Promise<void>) => {
  let idx = 0;
  const worker = async () => { while (idx < items.length) { const c = idx++; await fn(items[c], c); } };
  await Promise.all(Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, worker));
};

const StatusIcon: React.FC<{ status: Status }> = ({ status }) =>
  status === 'running' ? <LoadingOutlined style={{ color: RW.info }} />
    : status === 'success' ? <CheckCircleTwoTone twoToneColor={RW.success} />
    : status === 'empty' ? <MinusCircleOutlined style={{ color: RW.n600 }} />
    : status === 'error' ? <CloseCircleTwoTone twoToneColor={RW.error} />
    : <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: RW.n200 }} />;

const statusText: Record<Status, string> = { idle: 'Not run', running: 'Running…', success: 'Has data', empty: 'No data', error: 'Error' };

const BrowseData: React.FC = () => {
  const [selectedModules, setSelectedModules] = useState<FusionModule[]>([...SERVICE_MODULES]);
  const [kindFilter, setKindFilter] = useState<'all' | 'Transaction' | 'Master'>('all');
  const [results, setResults] = useState<Record<string, ServiceResult>>({});
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [tab, setTab] = useState<'scan' | 'coverage' | 'explorer'>('scan');
  const [search, setSearch] = useState('');

  // Service detail / run dialog
  const [dialog, setDialog] = useState<FusionService | null>(null);
  const [dialogRunning, setDialogRunning] = useState(false);

  // API Explorer — custom GET runner
  const [customPath, setCustomPath] = useState('');
  const [customRunning, setCustomRunning] = useState(false);
  const [customResult, setCustomResult] = useState<{ ok: boolean; status: number; data?: any; error?: string; url: string } | null>(null);

  const selected = useMemo(
    () => FUSION_SERVICES.filter(s => selectedModules.includes(s.module) && (kindFilter === 'all' || s.kind === kindFilter)),
    [selectedModules, kindFilter]);

  const runAll = async () => {
    if (!selected.length) { message.warning('Choose at least one module'); return; }
    setRunning(true); setProgress({ done: 0, total: selected.length });
    setResults(prev => { const n = { ...prev }; selected.forEach(s => { n[s.key] = { ...(n[s.key] ?? {}), status: 'running', count: 0, scanned: 0, bus: [], sample: [], url: svcUrl(s) }; }); return n; });
    let done = 0;
    await mapLimit(selected, 4, async (s) => {
      const res = await runService(s);
      setResults(prev => ({ ...prev, [s.key]: res }));
      done++; setProgress({ done, total: selected.length });
    });
    setRunning(false); setProgress(null);
    message.success('Data scan complete');
    setTab('coverage');
  };

  const runOne = async (svc: FusionService) => {
    setDialogRunning(true);
    setResults(prev => ({ ...prev, [svc.key]: { ...(prev[svc.key] ?? {}), status: 'running', count: 0, scanned: 0, bus: [], sample: [], url: svcUrl(svc) } }));
    const res = await runService(svc);
    setResults(prev => ({ ...prev, [svc.key]: res }));
    setDialogRunning(false);
  };

  const runCustom = async () => {
    const p = customPath.trim();
    if (!p) return;
    const url = /^https?:\/\//.test(p) ? p : `${FUSION_BASE}/${p.replace(/^\//, '')}`;
    const full = /[?&]limit=/.test(url) ? url : `${url}${url.includes('?') ? '&' : '?'}onlyData=true&limit=100`;
    setCustomRunning(true); setCustomResult(null);
    try {
      const r = await fetch(full, { headers: getHeaders() });
      let data: any; try { data = await r.json(); } catch { data = await r.text(); }
      setCustomResult({ ok: r.ok, status: r.status, data, url: full });
    } catch (e: any) { setCustomResult({ ok: false, status: 0, error: e?.message ?? String(e), url: full }); }
    finally { setCustomRunning(false); }
  };

  const copy = (s: string) => { navigator.clipboard?.writeText(s); message.success('Copied'); };

  // PDF summary report — module summary, service results, and BU coverage.
  const exportPdf = async () => {
    if (analysis.ranCount === 0) { message.warning('Run the services first'); return; }
    const { default: jsPDF } = await import('jspdf');
    const autoTable = (await import('jspdf-autotable')).default;
    const doc = new jsPDF('portrait', 'mm', 'a4');
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const finalY = () => (doc as any).lastAutoTable.finalY as number;

    doc.setFontSize(15); doc.setFont('helvetica', 'bold');
    doc.text('Fusion Data Coverage — Summary Report', pageW / 2, 15, { align: 'center' });
    doc.setFontSize(9); doc.setFont('helvetica', 'normal');
    const today = new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    doc.text(`Generated: ${today}`, 14, 23);
    doc.setFont('helvetica', 'bold');
    doc.text(`Business units with data: ${analysis.buUniverse.length}    Services with data: ${analysis.withData.length}    Services run: ${analysis.ranCount}`, 14, 30);

    autoTable(doc, {
      startY: 35,
      head: [['Module', 'Services w/ data', 'Ran', 'Total', 'Records', 'BUs']],
      body: analysis.modSummary.map(m => [m.module, m.withData, m.ran, m.total, m.records.toLocaleString(), m.bus]),
      styles: { fontSize: 9 }, headStyles: { fillColor: [199, 70, 52] }, margin: { left: 14, right: 14 },
    });

    let y = finalY() + 8;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text('Service results', 14, y);
    autoTable(doc, {
      startY: y + 3,
      head: [['Service', 'Module', 'Type', 'Status', 'Records', 'BUs']],
      body: FUSION_SERVICES.filter(s => results[s.key] && results[s.key].status !== 'running').map(s => {
        const r = results[s.key];
        return [s.label, s.module, s.kind, r.status === 'success' ? 'Has data' : r.status === 'empty' ? 'No data' : 'Error', r.status === 'error' ? '—' : r.count.toLocaleString(), r.bus.length || '—'];
      }),
      styles: { fontSize: 8 }, headStyles: { fillColor: [7, 114, 206] }, margin: { left: 14, right: 14 },
      didParseCell: (d: any) => { if (d.section === 'body' && d.column.index === 3) d.cell.styles.textColor = d.cell.raw === 'Has data' ? [29, 123, 77] : d.cell.raw === 'Error' ? [199, 70, 52] : [150, 150, 150]; },
    });

    y = finalY() + 8;
    if (y > pageH - 40) { doc.addPage(); y = 16; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
    doc.text(`Business Unit data coverage (${analysis.buUniverse.length} BUs)`, 14, y);
    autoTable(doc, {
      startY: y + 3,
      head: [['Business Unit', 'Modules', 'Services with data']],
      body: analysis.buRows.map(r => [r.bu, r.modules.join(', '), `${r.serviceCount}/${analysis.withData.length}`]),
      styles: { fontSize: 8 }, headStyles: { fillColor: [0, 145, 138] }, margin: { left: 14, right: 14 },
    });

    // BU × Service matrix on a landscape page (with per-column tick counts)
    const svcs = analysis.withData;
    if (svcs.length) {
      doc.addPage('a4', 'landscape');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(0);
      doc.text(`Business Unit × Service coverage — ${analysis.buUniverse.length} BUs`, 12, 12);
      autoTable(doc, {
        startY: 16,
        head: [
          ['Business Unit', 'Done', ...svcs.map(s => s.label)],
          ['BUs with data →', '', ...svcs.map(s => String(results[s.key]?.bus.length ?? 0))],
        ],
        body: analysis.buRows.map(r => [r.bu, `${r.serviceCount}/${svcs.length}`, ...svcs.map(s => r.cells[s.key] ? 'Y' : '')]),
        styles: { fontSize: 6, halign: 'center', valign: 'middle', cellPadding: 1, overflow: 'linebreak' },
        columnStyles: { 0: { halign: 'left', cellWidth: 40 }, 1: { cellWidth: 11 } },
        headStyles: { fillColor: [199, 70, 52], textColor: [255, 255, 255], fontSize: 5.5, valign: 'middle' },
        margin: { left: 10, right: 10 },
        didParseCell: (d: any) => {
          if (d.section === 'head' && d.row.index === 1) { d.cell.styles.fillColor = [29, 123, 77]; d.cell.styles.textColor = [255, 255, 255]; d.cell.styles.fontStyle = 'bold'; d.cell.styles.fontSize = 6.5; }
          if (d.section === 'body' && d.column.index >= 2 && d.cell.raw === 'Y') { d.cell.text = ['✓']; d.cell.styles.textColor = [29, 123, 77]; d.cell.styles.fillColor = [234, 246, 238]; d.cell.styles.fontStyle = 'bold'; }
        },
      });
    }

    const pc = (doc as any).internal.getNumberOfPages();
    for (let i = 1; i <= pc; i++) { doc.setPage(i); const w = doc.internal.pageSize.getWidth(); const h = doc.internal.pageSize.getHeight(); doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(120); doc.text('Re-ERP · Browse Data', 14, h - 8); doc.text(`Page ${i} of ${pc}`, w - 14, h - 8, { align: 'right' }); }
    doc.save(`data-coverage-summary-${new Date().toISOString().slice(0, 10)}.pdf`);
    message.success('PDF report generated');
  };

  // Styled Excel — Module Summary + Service Results + BU × Service matrix (with
  // a per-column tick-count row), mirroring the on-screen coverage matrix.
  const exportExcel = async () => {
    if (analysis.ranCount === 0) { message.warning('Run the services first'); return; }
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const thin = { style: 'thin' as const, color: { argb: 'FFE4E1DD' } };
    const bd = { top: thin, bottom: thin, left: thin, right: thin };
    const fill = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } });

    const ms = wb.addWorksheet('Module Summary', { views: [{ state: 'frozen', ySplit: 1 }] });
    ms.columns = [{ header: 'Module', width: 18 }, { header: 'Services with data', width: 18 }, { header: 'Ran', width: 8 }, { header: 'Total', width: 8 }, { header: 'Records', width: 12 }, { header: 'BUs', width: 8 }];
    ms.getRow(1).eachCell((c: any) => { c.fill = fill('FFC74634'); c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.alignment = { horizontal: 'center' }; c.border = bd; });
    analysis.modSummary.forEach(m => { const r = ms.addRow([m.module, m.withData, m.ran, m.total, m.records, m.bus]); r.eachCell((c: any) => { c.border = bd; }); r.getCell(1).fill = fill(MOD_ARGB[m.module]); r.getCell(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }; });

    const sr = wb.addWorksheet('Service Results', { views: [{ state: 'frozen', ySplit: 1 }] });
    sr.columns = [{ header: 'Service', width: 30 }, { header: 'Module', width: 16 }, { header: 'Type', width: 12 }, { header: 'Status', width: 14 }, { header: 'Records', width: 12 }, { header: 'Business Units', width: 14 }];
    sr.getRow(1).eachCell((c: any) => { c.fill = fill('FFC74634'); c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.alignment = { horizontal: 'center' }; c.border = bd; });
    FUSION_SERVICES.filter(s => results[s.key] && results[s.key].status !== 'running').forEach(s => {
      const r0 = results[s.key]; const st = r0.status === 'success' ? 'Has data' : r0.status === 'empty' ? 'No data' : 'Error';
      const row = sr.addRow([s.label, s.module, s.kind, st, r0.status === 'error' ? '' : r0.count, r0.bus.length]);
      row.eachCell((c: any) => { c.border = bd; });
      row.getCell(2).fill = fill(MOD_ARGB[s.module]); row.getCell(2).font = { bold: true, color: { argb: 'FFFFFFFF' } }; row.getCell(2).alignment = { horizontal: 'center' };
      row.getCell(4).font = { bold: true, color: { argb: st === 'Has data' ? 'FF1D7B4D' : st === 'Error' ? 'FFC74634' : 'FF9A9691' } };
    });

    const svcs = analysis.withData;
    const bm = wb.addWorksheet('BU x Service', { views: [{ state: 'frozen', xSplit: 3, ySplit: 2 }] });
    bm.columns = [{ header: 'Business Unit', width: 34 }, { header: 'Modules', width: 12 }, { header: 'Services Done', width: 13 }, ...svcs.map(s => ({ header: s.label, width: 5.5 }))];
    const hr = bm.getRow(1); hr.height = 150;
    hr.eachCell((c: any) => { c.fill = fill('FFC74634'); c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.alignment = { horizontal: 'center', vertical: 'bottom', textRotation: 90, wrapText: true }; c.border = bd; });
    [1, 2, 3].forEach(i => { hr.getCell(i).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; });
    const cr = bm.addRow(['', 'BUs →', '', ...svcs.map(s => results[s.key]?.bus.length ?? 0)]);
    cr.eachCell((c: any) => { c.border = bd; c.fill = fill('FF1D7B4D'); c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.alignment = { horizontal: 'center' }; });
    cr.getCell(2).alignment = { horizontal: 'right' };
    analysis.buRows.forEach(row => {
      const r = bm.addRow([row.bu, row.modules.map(m => m === 'Supply Chain' ? 'SCM' : 'FIN').join(' '), `${row.serviceCount}/${svcs.length}`, ...svcs.map(s => row.cells[s.key] ? '✓' : '')]);
      r.eachCell((c: any) => { c.border = bd; });
      r.getCell(1).font = { bold: true };
      r.getCell(3).font = { bold: true, color: { argb: 'FF00918A' } }; r.getCell(3).alignment = { horizontal: 'center' };
      svcs.forEach((s, i) => { const c = r.getCell(4 + i); c.alignment = { horizontal: 'center' }; if (row.cells[s.key]) { c.font = { bold: true, color: { argb: 'FF1D7B4D' } }; c.fill = fill('FFEAF6EE'); } });
    });

    const buf = await wb.xlsx.writeBuffer() as ArrayBuffer;
    const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = document.createElement('a'); a.href = url; a.download = `data-coverage-${new Date().toISOString().slice(0, 10)}.xlsx`; a.click(); URL.revokeObjectURL(url);
    message.success('Excel exported');
  };

  // ── Coverage analysis (BU-wise / module-wise) from the run results ──
  const analysis = useMemo(() => {
    const withData = FUSION_SERVICES.filter(s => results[s.key]?.status === 'success');
    const buUniverse = Array.from(new Set(withData.flatMap(s => results[s.key].bus))).sort((a, b) => a.localeCompare(b));
    const buRows = buUniverse.map(bu => {
      const hit = withData.filter(s => results[s.key].bus.includes(bu));
      const modules = Array.from(new Set(hit.map(s => s.module)));
      return {
        bu, serviceCount: hit.length, moduleCount: modules.length, modules,
        cells: Object.fromEntries(hit.map(s => [s.key, true])) as Record<string, boolean>,
      };
    }).sort((a, b) => b.serviceCount - a.serviceCount || a.bu.localeCompare(b.bu));
    const modSummary = SERVICE_MODULES.map(m => {
      const inMod = FUSION_SERVICES.filter(s => s.module === m);
      const ran = inMod.filter(s => results[s.key] && results[s.key].status !== 'running');
      const dataSvcs = ran.filter(s => results[s.key].status === 'success');
      const records = dataSvcs.reduce((n, s) => n + results[s.key].count, 0);
      const bus = new Set(dataSvcs.flatMap(s => results[s.key].bus));
      return { module: m, total: inMod.length, ran: ran.length, withData: dataSvcs.length, records, bus: bus.size };
    });
    const ranCount = FUSION_SERVICES.filter(s => results[s.key] && results[s.key].status !== 'running').length;
    return { withData, buUniverse, buRows, modSummary, ranCount };
  }, [results]);

  const scanRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return selected.filter(s => !q || s.label.toLowerCase().includes(q) || s.resource.toLowerCase().includes(q) || s.area.toLowerCase().includes(q));
  }, [selected, kindFilter, search, selectedModules]); // eslint-disable-line react-hooks/exhaustive-deps

  const statusCol = (svc: FusionService) => {
    const r = results[svc.key]; const st = r?.status ?? 'idle';
    return (
      <Button type="text" size="small" onClick={() => setDialog(svc)} style={{ padding: '0 6px' }}>
        <Space size={6}><StatusIcon status={st} /><Text style={{ fontSize: 12, color: st === 'error' ? RW.error : undefined }}>{statusText[st]}</Text></Space>
      </Button>
    );
  };

  const scanCols: ColumnsType<FusionService> = [
    { title: 'Service', dataIndex: 'label', render: (v, s) => <Space size={6}><Text strong style={{ fontSize: 12.5 }}>{v}</Text><Tag style={{ fontSize: 10 }}>{s.area}</Tag></Space>, sorter: (a, b) => a.label.localeCompare(b.label) },
    { title: 'Module', dataIndex: 'module', width: 130, render: (m: FusionModule) => <Tag style={{ background: MOD_COLOR[m], color: '#fff', border: 'none', fontWeight: 600 }}>{m}</Tag>,
      filters: SERVICE_MODULES.map(m => ({ text: m, value: m })), onFilter: (v, s) => s.module === v },
    { title: 'Type', dataIndex: 'kind', width: 110, render: (k: string) => <Tag color={k === 'Transaction' ? 'geekblue' : 'gold'}>{k}</Tag>,
      filters: [{ text: 'Transaction', value: 'Transaction' }, { text: 'Master', value: 'Master' }], onFilter: (v, s) => s.kind === v },
    { title: 'Status', width: 150, render: (_, s) => statusCol(s) },
    { title: 'Records', width: 110, align: 'right', sorter: (a, b) => (results[a.key]?.count ?? -1) - (results[b.key]?.count ?? -1),
      render: (_, s) => { const r = results[s.key]; if (!r || r.status === 'idle') return <Text type="secondary">—</Text>; if (r.status === 'running') return <LoadingOutlined />; if (r.status === 'error') return <Text type="danger" style={{ fontSize: 11 }}>error</Text>;
        return <Text strong style={{ color: r.count ? RW.primary : RW.n600 }}>{r.count.toLocaleString()}{r.count > r.scanned && r.scanned >= BU_SCAN_MAX ? '' : ''}</Text>; } },
    { title: 'Business Units', width: 150, align: 'right', sorter: (a, b) => (results[a.key]?.bus.length ?? -1) - (results[b.key]?.bus.length ?? -1),
      render: (_, s) => { const r = results[s.key]; if (!r || r.status !== 'success') return <Text type="secondary">—</Text>; if (!r.bus.length) return <Tooltip title="No business-unit attribute detected in the data"><Text type="secondary">n/a</Text></Tooltip>;
        return <Tooltip title={r.bus.join(', ')}><Tag color="cyan" style={{ cursor: 'help' }}>{r.bus.length} BU{r.bus.length > 1 ? 's' : ''}</Tag></Tooltip>; } },
    { title: '', width: 90, render: (_, s) => <Button size="small" icon={<PlayCircleOutlined />} onClick={() => setDialog(s)}>Open</Button> },
  ];

  const dr = dialog ? results[dialog.key] : undefined;
  const totalRun = analysis.ranCount;

  return (
    <div style={{ padding: '8px 4px' }}>
      <Breadcrumb style={{ marginBottom: 12 }} items={[
        { title: <Link to="/home"><HomeOutlined /> Home</Link> },
        { title: <Link to="/procurement">Fusion Supply Chain</Link> },
        { title: <Link to="/procurement/setup-data">Setup Data</Link> },
        { title: 'Browse Data' },
      ]} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <ThunderboltOutlined style={{ fontSize: 20, color: RW.primary }} />
        <Title level={4} style={{ margin: 0 }}>Browse Data</Title>
        <Text type="secondary" style={{ fontSize: 12.5 }}>Run read-only GET services to see, per business unit, in how many modules you have live data.</Text>
      </div>

      {/* Control bar */}
      <Card size="small" style={{ borderRadius: 10, marginBottom: 14 }} styles={{ body: { padding: 12 } }}>
        <Space wrap size={16} align="center">
          <Space size={8}>
            <Text strong style={{ fontSize: 12 }}>Modules:</Text>
            <Checkbox.Group value={selectedModules} onChange={v => setSelectedModules(v as FusionModule[])}
              options={SERVICE_MODULES.map(m => ({ label: <Tag style={{ background: MOD_COLOR[m], color: '#fff', border: 'none', fontWeight: 600 }}>{m}</Tag>, value: m }))} />
          </Space>
          <Space size={8}>
            <Text strong style={{ fontSize: 12 }}>Type:</Text>
            <Segmented size="small" value={kindFilter} onChange={v => setKindFilter(v as any)}
              options={[{ label: 'All', value: 'all' }, { label: 'Transactions', value: 'Transaction' }, { label: 'Masters', value: 'Master' }]} />
          </Space>
          <Badge count={selected.length} showZero color={RW.info} offset={[6, -2]}>
            <Button type="primary" icon={<PlayCircleOutlined />} loading={running} onClick={runAll} style={{ background: RW.primary, borderColor: RW.primary }}>Run services</Button>
          </Badge>
          {totalRun > 0 && <Button icon={<FileExcelOutlined />} onClick={exportExcel} disabled={running} style={{ borderColor: RW.success, color: RW.success }}>Excel</Button>}
          {totalRun > 0 && <Button icon={<FilePdfOutlined />} onClick={exportPdf} disabled={running}>PDF report</Button>}
          {totalRun > 0 && <Button icon={<ReloadOutlined />} onClick={() => setResults({})} disabled={running}>Reset</Button>}
          {progress && <div style={{ minWidth: 220 }}><Progress percent={progress.total ? Math.round((progress.done / progress.total) * 100) : 0} size="small" /><Text type="secondary" style={{ fontSize: 11 }}>Ran {progress.done}/{progress.total} services…</Text></div>}
        </Space>
      </Card>

      <Tabs activeKey={tab} onChange={k => setTab(k as any)} items={[
        {
          key: 'scan', label: <span><DatabaseOutlined /> Services</span>,
          children: (
            <Card size="small" style={{ borderRadius: 10 }} styles={{ body: { padding: 10 } }}
              title={<Space wrap><Text strong>Data services</Text>
                <Input allowClear size="small" prefix={<SearchOutlined />} placeholder="Search service…" value={search} onChange={e => setSearch(e.target.value)} style={{ width: 220 }} /></Space>}>
              <Table size="small" rowKey="key" columns={scanCols} dataSource={scanRows}
                pagination={{ defaultPageSize: 25, showSizeChanger: true, pageSizeOptions: [25, 50, 100, 200] }}
                scroll={{ x: 860 }} locale={{ emptyText: 'Choose a module to list its services' }} />
            </Card>
          ),
        },
        {
          key: 'coverage', label: <span><AppstoreOutlined /> BU &amp; Module Coverage</span>,
          children: totalRun === 0 ? <Empty description="Run the services to build the coverage dashboard" style={{ padding: 40 }} /> : (
            <>
              {/* Module summary */}
              <Row gutter={[12, 12]} style={{ marginBottom: 14 }}>
                <Col xs={24} md={8}>
                  <Card size="small" style={{ borderRadius: 10, borderTop: `3px solid ${RW.primary}`, height: '100%' }}>
                    <Statistic title="Business Units with data" value={analysis.buUniverse.length} prefix={<GlobalOutlined style={{ color: RW.primary }} />} />
                    <div style={{ marginTop: 6, fontSize: 12 }}><Text type="secondary">Across </Text><Text strong>{analysis.withData.length}</Text><Text type="secondary"> services that returned data</Text></div>
                  </Card>
                </Col>
                {analysis.modSummary.map(m => (
                  <Col xs={24} md={8} key={m.module}>
                    <Card size="small" style={{ borderRadius: 10, borderTop: `3px solid ${MOD_COLOR[m.module]}`, height: '100%' }}>
                      <Statistic title={<Text strong style={{ color: MOD_COLOR[m.module] }}>{m.module}</Text>} value={m.withData} suffix={<Text type="secondary" style={{ fontSize: 13 }}>/ {m.total} services with data</Text>} />
                      <div style={{ marginTop: 8 }}><Progress percent={m.ran ? Math.round((m.withData / m.ran) * 100) : 0} strokeColor={MOD_COLOR[m.module]} size="small" /></div>
                      <Space size={14} style={{ marginTop: 4, fontSize: 12 }}>
                        <span><Text type="secondary">Records </Text><Text strong>{m.records.toLocaleString()}</Text></span>
                        <span><Text type="secondary">BUs </Text><Text strong>{m.bus}</Text></span>
                      </Space>
                    </Card>
                  </Col>
                ))}
              </Row>

              {/* BU × Service coverage matrix */}
              <Card size="small" style={{ borderRadius: 10 }}
                title={<Space wrap><DatabaseOutlined style={{ color: RW.teal }} /><Text strong>Business Unit data coverage</Text>
                  <Tag color="cyan">{analysis.buUniverse.length} BUs</Tag><Tag>{analysis.withData.length} services with data</Tag></Space>}>
                {analysis.buUniverse.length === 0
                  ? <Empty description="No business-unit-scoped data found in the services that were run" />
                  : <Table size="small" rowKey="bu" dataSource={analysis.buRows}
                      pagination={{ defaultPageSize: 25, showSizeChanger: true, pageSizeOptions: [25, 50, 100, 200] }}
                      scroll={{ x: 460 + analysis.withData.length * 88, y: 540 }}
                      columns={[
                        { title: 'Business Unit', dataIndex: 'bu', width: 240, fixed: 'left' as const, render: (v: string) => <Text strong style={{ fontSize: 12 }}>{v}</Text> },
                        { title: 'Modules', dataIndex: 'moduleCount', width: 150, fixed: 'left' as const, sorter: (a: any, b: any) => a.moduleCount - b.moduleCount,
                          render: (_: any, r: any) => <Space size={4}>{r.modules.map((m: FusionModule) => <Tag key={m} style={{ background: MOD_COLOR[m], color: '#fff', border: 'none', fontSize: 10 }}>{m === 'Supply Chain' ? 'SCM' : 'FIN'}</Tag>)}</Space> },
                        { title: 'Services', dataIndex: 'serviceCount', width: 140, fixed: 'left' as const, sorter: (a: any, b: any) => a.serviceCount - b.serviceCount, defaultSortOrder: 'descend' as const,
                          render: (n: number) => <Space size={6}><Text strong style={{ color: RW.primary }}>{n}/{analysis.withData.length}</Text><Progress percent={Math.round((n / analysis.withData.length) * 100)} size="small" showInfo={false} style={{ width: 60 }} strokeColor={RW.teal} /></Space> },
                        ...analysis.withData.map(s => ({
                          title: <Tooltip title={`${s.label} · ${s.module} — ${results[s.key]?.bus.length ?? 0} of ${analysis.buUniverse.length} BUs have data`}>
                            <div style={{ textAlign: 'center' as const, lineHeight: 1.2 }}>
                              <div style={{ fontSize: 10.5 }}>{s.label.length > 15 ? s.label.slice(0, 14) + '…' : s.label}</div>
                              <span style={{ display: 'inline-block', marginTop: 3, fontSize: 10.5, fontWeight: 700, color: '#fff', background: RW.success, borderRadius: 8, padding: '0 6px', lineHeight: '16px' }}>✓ {results[s.key]?.bus.length ?? 0}</span>
                            </div></Tooltip>,
                          dataIndex: ['cells', s.key], width: 88, align: 'center' as const,
                          render: (_: any, r: any) => r.cells[s.key] ? <CheckCircleTwoTone twoToneColor={RW.success} /> : <span style={{ color: RW.n200 }}>·</span>,
                        })),
                      ] as ColumnsType<any>} />}
              </Card>
            </>
          ),
        },
        {
          key: 'explorer', label: <span><ApiOutlined /> API Explorer</span>,
          children: (
            <>
              <Card size="small" style={{ borderRadius: 10, marginBottom: 14 }}
                title={<Space><ApiOutlined style={{ color: RW.info }} /><Text strong>Run any GET</Text><Tag>read-only</Tag></Space>}>
                <Space.Compact style={{ width: '100%', maxWidth: 720 }}>
                  <Input addonBefore="GET" placeholder="resource path or full URL — e.g. salesOrdersForOrderHub?q=OrderNumber='123'"
                    value={customPath} onChange={e => setCustomPath(e.target.value)} onPressEnter={runCustom} />
                  <Button type="primary" loading={customRunning} onClick={runCustom} icon={<PlayCircleOutlined />} style={{ background: RW.primary, borderColor: RW.primary }}>Run</Button>
                </Space.Compact>
                <div style={{ marginTop: 6 }}><Text type="secondary" style={{ fontSize: 11 }}>Base: <code>{FUSION_BASE}</code> · Auth: Basic [{getFusionInstance().username}] · adds <code>onlyData=true&amp;limit=100</code> when no limit is given.</Text></div>
                {customResult && (
                  <div style={{ marginTop: 12 }}>
                    <Space wrap style={{ marginBottom: 6 }}>
                      <Tag color={customResult.ok ? 'success' : 'error'}>{customResult.ok ? 'OK' : 'FAILED'} · HTTP {customResult.status || '—'}</Tag>
                      <Text copyable={{ text: customResult.url }} style={{ fontSize: 11 }} type="secondary">{customResult.url}</Text>
                      {Array.isArray(customResult.data?.items) && <Tag color="blue">{customResult.data.items.length} rows{typeof customResult.data.totalResults === 'number' ? ` of ${customResult.data.totalResults}` : ''}</Tag>}
                    </Space>
                    <pre style={{ maxHeight: 340, overflow: 'auto', background: RW.n100, padding: 10, borderRadius: 8, fontSize: 11, margin: 0 }}>
                      {customResult.error ? customResult.error : JSON.stringify(customResult.data, null, 2).slice(0, 20000)}
                    </pre>
                  </div>
                )}
              </Card>

              <Card size="small" style={{ borderRadius: 10 }} styles={{ body: { padding: 10 } }}
                title={<Space><GlobalOutlined style={{ color: RW.teal }} /><Text strong>All REST GET services</Text><Tag>{FUSION_SERVICES.length} endpoints</Tag></Space>}>
                <Table size="small" rowKey="key" dataSource={FUSION_SERVICES}
                  pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: [25, 50, 100] }}
                  scroll={{ x: 820 }}
                  columns={[
                    { title: 'Service', dataIndex: 'label', render: (v, s: FusionService) => <div><Text strong style={{ fontSize: 12.5 }}>{v}</Text><div><Text type="secondary" style={{ fontSize: 11 }}>{s.description}</Text></div></div>, sorter: (a: FusionService, b: FusionService) => a.label.localeCompare(b.label) },
                    { title: 'Module', dataIndex: 'module', width: 130, render: (m: FusionModule) => <Tag style={{ background: MOD_COLOR[m], color: '#fff', border: 'none', fontWeight: 600 }}>{m}</Tag>, filters: SERVICE_MODULES.map(m => ({ text: m, value: m })), onFilter: (v, s: FusionService) => s.module === v },
                    { title: 'Type', dataIndex: 'kind', width: 110, render: (k: string) => <Tag color={k === 'Transaction' ? 'geekblue' : 'gold'}>{k}</Tag> },
                    { title: 'GET endpoint', dataIndex: 'resource', render: (r: string) => <Space size={4}><code style={{ fontSize: 11 }}>/{r}</code><Tooltip title="Copy full URL"><Button type="text" size="small" icon={<CopyOutlined />} onClick={() => copy(`${FUSION_BASE}/${r}`)} /></Tooltip></Space> },
                    { title: '', width: 90, render: (_: any, s: FusionService) => <Button size="small" icon={<PlayCircleOutlined />} onClick={() => setDialog(s)}>Run</Button> },
                  ] as ColumnsType<FusionService>} />
              </Card>
            </>
          ),
        },
      ]} />

      {/* Service detail + run dialog */}
      <Modal open={!!dialog} onCancel={() => setDialog(null)} width={720} footer={null}
        title={dialog && <Space><StatusIcon status={dr?.status ?? 'idle'} />{dialog.label}<Tag style={{ background: MOD_COLOR[dialog.module], color: '#fff', border: 'none', fontWeight: 600 }}>{dialog.module}</Tag><Tag color={dialog.kind === 'Transaction' ? 'geekblue' : 'gold'}>{dialog.kind}</Tag></Space>}>
        {dialog && <>
          <Paragraph type="secondary" style={{ marginBottom: 8 }}>{dialog.description}</Paragraph>
          <div style={{ marginBottom: 10 }}>
            <Text strong style={{ fontSize: 12 }}>Web service (GET)</Text>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
              <code style={{ flex: 1, background: RW.n100, padding: '6px 10px', borderRadius: 6, fontSize: 11, wordBreak: 'break-all' }}>{svcUrl(dialog)}</code>
              <Tooltip title="Copy"><Button size="small" icon={<CopyOutlined />} onClick={() => copy(svcUrl(dialog))} /></Tooltip>
            </div>
          </div>
          <Space style={{ marginBottom: 12 }}>
            <Button type="primary" icon={<PlayCircleOutlined />} loading={dialogRunning} onClick={() => runOne(dialog)} style={{ background: RW.primary, borderColor: RW.primary }}>Run service</Button>
          </Space>
          {dr && dr.status !== 'idle' && dr.status !== 'running' && (
            <Card size="small" style={{ background: RW.n100, borderRadius: 8 }}>
              {dr.status === 'error'
                ? <Text type="danger">{dr.error}</Text>
                : <>
                    <Space wrap size={16}>
                      <Statistic title="Records" value={dr.count} valueStyle={{ fontSize: 20, color: dr.count ? RW.primary : RW.n600 }} />
                      <Statistic title="Business Units" value={dr.bus.length} valueStyle={{ fontSize: 20, color: RW.teal }} />
                      <div><Text type="secondary" style={{ fontSize: 12 }}>Status</Text><div><Tag color={dr.count ? 'success' : 'default'}>{dr.count ? 'Has data' : 'No data'}</Tag></div></div>
                    </Space>
                    {dr.count > dr.scanned && dr.scanned >= BU_SCAN_MAX && <div><Text type="secondary" style={{ fontSize: 11 }}>Business units sampled from the first {BU_SCAN_MAX.toLocaleString()} of {dr.count.toLocaleString()} records.</Text></div>}
                    {dr.bus.length > 0 && <div style={{ marginTop: 8 }}><Text strong style={{ fontSize: 12 }}>Business units: </Text>{dr.bus.map(b => <Tag key={b} color="cyan" style={{ marginBottom: 4 }}>{b}</Tag>)}</div>}
                    {dr.sample.length > 0 && <details style={{ marginTop: 10 }}><summary style={{ cursor: 'pointer', fontSize: 12 }}>Sample response ({dr.sample.length} record{dr.sample.length > 1 ? 's' : ''})</summary>
                      <pre style={{ maxHeight: 260, overflow: 'auto', background: '#fff', padding: 10, borderRadius: 6, fontSize: 11, marginTop: 6 }}>{JSON.stringify(dr.sample, null, 2).slice(0, 12000)}</pre></details>}
                  </>}
            </Card>
          )}
        </>}
      </Modal>
    </div>
  );
};

export default BrowseData;
