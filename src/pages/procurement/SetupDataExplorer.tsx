import React, { useEffect, useMemo, useState } from 'react';
import {
  Card, Row, Col, Statistic, Progress, Table, Tag, Upload, Segmented, Input, Button,
  Drawer, Empty, Space, Typography, message, Tabs, Tooltip, Breadcrumb,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Link } from 'react-router-dom';
import {
  InboxOutlined, DatabaseOutlined, CheckCircleTwoTone, MinusCircleOutlined, EyeOutlined,
  ReloadOutlined, DownloadOutlined, SearchOutlined, AppstoreOutlined, HomeOutlined, FilePdfOutlined,
} from '@ant-design/icons';
import {
  parseSetupExport, getSetupCache, setSetupCache, mergeSetupTasks, type SetupTask, type SetupModule,
} from '../../utils/fusionSetupZip';

const { Text, Title } = Typography;
const RW = {
  primary: '#C74634', info: '#0572CE', success: '#1D7B4D', warn: '#D4A800', error: '#C74634',
  purple: '#6B21A8', teal: '#00918A', n100: '#F4F4F2', n200: '#E4E1DD', n600: '#6B6862', n900: '#1B1A17',
};
const MOD_COLOR: Record<SetupModule, string> = { 'Financials': RW.info, 'Supply Chain': RW.teal, 'Common': RW.purple };
const MOD_ARGB: Record<SetupModule, string> = { 'Financials': 'FF0572CE', 'Supply Chain': 'FF00918A', 'Common': 'FF6B21A8' };
const MODULES: SetupModule[] = ['Financials', 'Supply Chain', 'Common'];
const fill = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } });

const TAB_MODULES: SetupModule[] = ['Financials', 'Supply Chain', 'Common'];

const SetupDataExplorer: React.FC<{ defaultModule?: SetupModule }> = ({ defaultModule }) => {
  const [tasks, setTasks] = useState<SetupTask[]>(() => getSetupCache()?.tasks ?? []);
  const [fileNames, setFileNames] = useState<string[]>(() => getSetupCache()?.fileNames ?? []);
  const [parsing, setParsing] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [activeMod, setActiveMod] = useState<SetupModule>(defaultModule ?? 'Financials');
  const [search, setSearch] = useState('');
  const [configuredOnly, setConfiguredOnly] = useState(false);
  const [detail, setDetail] = useState<SetupTask | null>(null);
  const [view, setView] = useState<'explorer' | 'analysis'>('explorer');
  const [buSearch, setBuSearch] = useState('');

  useEffect(() => { if (defaultModule) setActiveMod(defaultModule); }, [defaultModule]);

  const onFile = async (file: File) => {
    setParsing(true); setProgress({ done: 0, total: 0 });
    try {
      const parsed = await parseSetupExport(file, (done, total) => setProgress({ done, total }));
      const merged = mergeSetupTasks(tasks, parsed);
      const names = Array.from(new Set([...fileNames, file.name]));
      setTasks(merged); setFileNames(names); setSetupCache(names, merged);
      message.success(`Added ${parsed.length} tasks from ${file.name} (${merged.length} total)`);
    } catch (e: any) { message.error(`Could not read the export: ${e?.message ?? e}`); }
    finally { setParsing(false); setProgress(null); }
    return false;
  };

  // Per-module rollup for the dashboard.
  const stats = useMemo(() => {
    const per = (m?: SetupModule) => {
      const t = m ? tasks.filter(x => x.module === m) : tasks;
      const configured = t.filter(x => x.hasData).length;
      const records = t.reduce((s, x) => s + x.recordCount, 0);
      return { total: t.length, configured, empty: t.length - configured, records, pct: t.length ? Math.round((configured / t.length) * 100) : 0 };
    };
    return { all: per(), byMod: Object.fromEntries(MODULES.map(m => [m, per(m)])) as Record<SetupModule, ReturnType<typeof per>> };
  }, [tasks]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return tasks.filter(t =>
      t.module === activeMod &&
      (!configuredOnly || t.hasData) &&
      (!s || t.name.toLowerCase().includes(s)));
  }, [tasks, activeMod, search, configuredOnly]);

  // ── Analysis: Business-Unit × Setup-task matrix, scoped to the active module ──
  const analysis = useMemo(() => {
    const scoped = tasks.filter(t => t.module === activeMod && t.businessUnits.length > 0).sort((a, b) => b.businessUnits.length - a.businessUnits.length);
    const buUniverse = Array.from(new Set(scoped.flatMap(t => t.businessUnits))).sort((a, b) => a.localeCompare(b));
    const has = (bu: string, t: SetupTask) => t.businessUnits.includes(bu);
    const buRows = buUniverse.map(bu => {
      const done = scoped.filter(t => has(bu, t));
      return { bu, doneCount: done.length, doneTasks: done.map(t => t.name), cells: Object.fromEntries(scoped.map(t => [t.name, has(bu, t)])) as Record<string, boolean> };
    }).sort((a, b) => b.doneCount - a.doneCount || a.bu.localeCompare(b.bu));
    // per-column tick count — how many BUs have each setup task configured
    const colCounts = Object.fromEntries(scoped.map(t => [t.name, buUniverse.filter(bu => has(bu, t)).length])) as Record<string, number>;
    // module status rollup (all modules — context)
    const modRows = MODULES.map(m => {
      const t = tasks.filter(x => x.module === m);
      const configured = t.filter(x => x.hasData).length;
      return { module: m, total: t.length, configured, empty: t.length - configured, records: t.reduce((s, x) => s + x.recordCount, 0), pct: t.length ? Math.round((configured / t.length) * 100) : 0 };
    });
    return { scoped, buUniverse, buRows, colCounts, modRows };
  }, [tasks, activeMod]);

  const buRowsFiltered = useMemo(() => {
    const s = buSearch.trim().toLowerCase();
    return s ? analysis.buRows.filter(r => r.bu.toLowerCase().includes(s)) : analysis.buRows;
  }, [analysis.buRows, buSearch]);

  const base = (fileNames[0] || 'export').replace(/\.zip$/i, '') || 'export';
  const download = (buf: ArrayBuffer, name: string) => {
    const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
  };

  // Styled Excel (exceljs) mirroring the on-screen look — coloured headers, module
  // fills, green ✓ ticks, % formatting.
  const exportMatrix = async () => {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const thin = { style: 'thin' as const, color: { argb: 'FFE4E1DD' } };
    const bd = { top: thin, bottom: thin, left: thin, right: thin };
    const hdr = (row: any, rotate = false) => row.eachCell((c: any) => { c.fill = fill('FFC74634'); c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.alignment = { horizontal: 'center', vertical: rotate ? 'bottom' : 'middle', textRotation: rotate ? 90 : 0, wrapText: true }; c.border = bd; });

    const ms = wb.addWorksheet('Module Status', { views: [{ state: 'frozen', ySplit: 1 }] });
    ms.columns = [{ header: 'Module', width: 20 }, { header: 'Tasks', width: 10 }, { header: 'Configured', width: 12 }, { header: 'Empty', width: 10 }, { header: '% Done', width: 10 }, { header: 'Records', width: 12 }];
    hdr(ms.getRow(1));
    analysis.modRows.forEach(m => {
      const r = ms.addRow([m.module, m.total, m.configured, m.empty, m.pct / 100, m.records]);
      r.eachCell((c: any) => { c.border = bd; });
      r.getCell(1).fill = fill(MOD_ARGB[m.module]); r.getCell(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      r.getCell(3).font = { bold: true, color: { argb: 'FF1D7B4D' } };
      r.getCell(5).numFmt = '0%'; r.getCell(6).font = { bold: true, color: { argb: 'FFC74634' } };
    });
    const t = analysis.modRows.reduce((a, m) => ({ total: a.total + m.total, configured: a.configured + m.configured, empty: a.empty + m.empty, records: a.records + m.records }), { total: 0, configured: 0, empty: 0, records: 0 });
    const tr = ms.addRow(['All modules', t.total, t.configured, t.empty, t.total ? t.configured / t.total : 0, t.records]);
    tr.eachCell((c: any) => { c.font = { bold: true }; c.fill = fill('FFF4F4F2'); c.border = bd; }); tr.getCell(5).numFmt = '0%';

    const bm = wb.addWorksheet('BU x Setup', { views: [{ state: 'frozen', xSplit: 3, ySplit: 2 }] });
    bm.columns = [{ header: 'Business Unit', width: 38 }, { header: 'Setups Done', width: 12 }, { header: '% Complete', width: 11 }, ...analysis.scoped.map(tk => ({ header: tk.name, width: 5.5 }))];
    const hr = bm.getRow(1); hr.height = 150; hdr(hr, true);
    [1, 2, 3].forEach(i => { hr.getCell(i).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; });
    // per-column count row — how many BUs have each setup configured
    const cr = bm.addRow(['', 'BUs →', '', ...analysis.scoped.map(tk => analysis.colCounts[tk.name])]);
    cr.eachCell((c: any) => { c.border = bd; c.fill = fill('FF1D7B4D'); c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.alignment = { horizontal: 'center' }; });
    cr.getCell(2).alignment = { horizontal: 'right' };
    analysis.buRows.forEach(row => {
      const r = bm.addRow([row.bu, `${row.doneCount}/${analysis.scoped.length}`, analysis.scoped.length ? row.doneCount / analysis.scoped.length : 0, ...analysis.scoped.map(tk => row.cells[tk.name] ? '✓' : '')]);
      r.eachCell((c: any) => { c.border = bd; });
      r.getCell(1).font = { bold: true };
      r.getCell(2).font = { bold: true, color: { argb: 'FF00918A' } }; r.getCell(2).alignment = { horizontal: 'center' };
      r.getCell(3).numFmt = '0%'; r.getCell(3).alignment = { horizontal: 'center' };
      analysis.scoped.forEach((tk, i) => { const c = r.getCell(4 + i); c.alignment = { horizontal: 'center' }; if (row.cells[tk.name]) { c.font = { bold: true, color: { argb: 'FF1D7B4D' } }; c.fill = fill('FFEAF6EE'); } });
    });
    download(await wb.xlsx.writeBuffer() as ArrayBuffer, `setup-bu-analysis-${base}.xlsx`);
    message.success('Analysis exported');
  };

  const exportSummary = async () => {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const thin = { style: 'thin' as const, color: { argb: 'FFE4E1DD' } };
    const bd = { top: thin, bottom: thin, left: thin, right: thin };
    const ws = wb.addWorksheet('Setup Tasks', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = [{ header: 'Setup Task', width: 46 }, { header: 'Module', width: 16 }, { header: 'Status', width: 16 }, { header: 'Records', width: 10 }, { header: 'Files', width: 8 }, { header: 'Batch', width: 8 }];
    ws.getRow(1).eachCell((c: any) => { c.fill = fill('FFC74634'); c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.alignment = { horizontal: 'center' }; c.border = bd; });
    tasks.forEach(t => {
      const r = ws.addRow([t.name, t.module, t.hasData ? 'Configured' : 'Not configured', t.recordCount, t.files.length, t.batch ? 'Yes' : '']);
      r.eachCell((c: any) => { c.border = bd; });
      r.getCell(2).fill = fill(MOD_ARGB[t.module]); r.getCell(2).font = { bold: true, color: { argb: 'FFFFFFFF' } }; r.getCell(2).alignment = { horizontal: 'center' };
      r.getCell(3).font = { bold: true, color: { argb: t.hasData ? 'FF1D7B4D' : 'FF9A9691' } };
      r.getCell(4).font = { color: { argb: t.recordCount ? 'FFC74634' : 'FF9A9691' } };
    });
    download(await wb.xlsx.writeBuffer() as ArrayBuffer, `setup-summary-${base}.xlsx`);
    message.success('Summary exported');
  };

  // PDF summary report — KPIs, module status, BU coverage, per-task BU counts,
  // and the full task list. Covers all modules of the uploaded export(s).
  const exportPdf = async () => {
    const { default: jsPDF } = await import('jspdf');
    const autoTable = (await import('jspdf-autotable')).default;
    const doc = new jsPDF('portrait', 'mm', 'a4');
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const finalY = () => (doc as any).lastAutoTable.finalY as number;

    doc.setFontSize(15); doc.setFont('helvetica', 'bold');
    doc.text('Fusion Setup Data — Summary Report', pageW / 2, 15, { align: 'center' });
    doc.setFontSize(9); doc.setFont('helvetica', 'normal');
    const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    doc.text(`Generated: ${today}`, 14, 23);
    doc.text(`Exports: ${fileNames.join(', ') || '—'}`, 14, 28);
    doc.setFont('helvetica', 'bold');
    doc.text(`Total tasks: ${stats.all.total}    Configured: ${stats.all.configured}    Empty: ${stats.all.empty}    Done: ${stats.all.pct}%    Records: ${stats.all.records.toLocaleString()}`, 14, 34);

    autoTable(doc, {
      startY: 39,
      head: [['Module', 'Tasks', 'Configured', 'Empty', '% Done', 'Records']],
      body: MODULES.map(m => { const s = stats.byMod[m]; return [m, s.total, s.configured, s.empty, `${s.pct}%`, s.records.toLocaleString()]; }),
      styles: { fontSize: 9 }, headStyles: { fillColor: [199, 70, 52] }, margin: { left: 14, right: 14 },
    });

    // Global BU coverage (all modules)
    const buScoped = tasks.filter(t => t.businessUnits.length > 0);
    const buUniverse = Array.from(new Set(buScoped.flatMap(t => t.businessUnits)));
    const buRows = buUniverse.map(bu => {
      const hit = buScoped.filter(t => t.businessUnits.includes(bu));
      const mods = Array.from(new Set(hit.map(t => t.module)));
      return { bu, done: hit.length, mods: mods.join(', ') };
    }).sort((a, b) => b.done - a.done || a.bu.localeCompare(b.bu));

    let y = finalY() + 8;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
    doc.text(`Business Unit setup coverage (${buUniverse.length} BUs)`, 14, y);
    autoTable(doc, {
      startY: y + 3,
      head: [['Business Unit', 'Setups Done', 'Modules']],
      body: buRows.map(r => [r.bu, `${r.done}/${buScoped.length}`, r.mods]),
      styles: { fontSize: 8 }, headStyles: { fillColor: [0, 145, 138] }, margin: { left: 14, right: 14 },
    });

    // Per-task BU counts
    y = finalY() + 8;
    if (y > pageH - 40) { doc.addPage(); y = 16; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
    doc.text('Setup tasks — business units configured', 14, y);
    autoTable(doc, {
      startY: y + 3,
      head: [['Setup Task', 'Module', 'BUs Configured']],
      body: buScoped.map(t => [t.name, t.module, t.businessUnits.length]).sort((a, b) => (b[2] as number) - (a[2] as number)),
      styles: { fontSize: 8 }, headStyles: { fillColor: [7, 114, 206] }, margin: { left: 14, right: 14 },
    });

    // Full task list
    y = finalY() + 8;
    if (y > pageH - 40) { doc.addPage(); y = 16; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
    doc.text('All setup tasks', 14, y);
    autoTable(doc, {
      startY: y + 3,
      head: [['Setup Task', 'Module', 'Status', 'Records']],
      body: tasks.map(t => [t.name, t.module, t.hasData ? 'Configured' : 'Not configured', t.recordCount || (t.batch ? 'batch' : 0)]),
      styles: { fontSize: 7.5 }, headStyles: { fillColor: [58, 58, 58] }, margin: { left: 14, right: 14 },
      didParseCell: (d: any) => { if (d.section === 'body' && d.column.index === 2) d.cell.styles.textColor = d.cell.raw === 'Configured' ? [29, 123, 77] : [150, 150, 150]; },
    });

    // BU × Setup matrix on a landscape page (with per-column BU counts)
    if (buScoped.length) {
      doc.addPage('a4', 'landscape');
      const colCount = (t: SetupTask) => buUniverse.filter(bu => t.businessUnits.includes(bu)).length;
      const matTasks = [...buScoped].sort((a, b) => colCount(b) - colCount(a));
      doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(0);
      doc.text(`Business Unit × Setup coverage — ${buUniverse.length} BUs`, 12, 12);
      autoTable(doc, {
        startY: 16,
        head: [
          ['Business Unit', 'Done', ...matTasks.map(t => t.name)],
          ['BUs configured →', '', ...matTasks.map(t => String(colCount(t)))],
        ],
        body: buRows.map(r => [r.bu, `${r.done}/${buScoped.length}`, ...matTasks.map(t => t.businessUnits.includes(r.bu) ? 'Y' : '')]),
        styles: { fontSize: 6, halign: 'center', valign: 'middle', cellPadding: 1, overflow: 'linebreak' },
        columnStyles: { 0: { halign: 'left', cellWidth: 42 }, 1: { cellWidth: 11 } },
        headStyles: { fillColor: [199, 70, 52], textColor: [255, 255, 255], fontSize: 5.5, valign: 'middle' },
        margin: { left: 10, right: 10 },
        didParseCell: (d: any) => {
          if (d.section === 'head' && d.row.index === 1) { d.cell.styles.fillColor = [29, 123, 77]; d.cell.styles.textColor = [255, 255, 255]; d.cell.styles.fontStyle = 'bold'; d.cell.styles.fontSize = 6.5; }
          if (d.section === 'body' && d.column.index >= 2 && d.cell.raw === 'Y') { d.cell.text = ['✓']; d.cell.styles.textColor = [29, 123, 77]; d.cell.styles.fillColor = [234, 246, 238]; d.cell.styles.fontStyle = 'bold'; }
        },
      });
    }

    const pc = (doc as any).internal.getNumberOfPages();
    for (let i = 1; i <= pc; i++) { doc.setPage(i); const w = doc.internal.pageSize.getWidth(); const h = doc.internal.pageSize.getHeight(); doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(120); doc.text('Re-ERP · Setup Data', 14, h - 8); doc.text(`Page ${i} of ${pc}`, w - 14, h - 8, { align: 'right' }); }
    doc.save(`setup-data-summary-${base}.pdf`);
    message.success('PDF report generated');
  };

  const cols: ColumnsType<SetupTask> = [
    { title: 'Setup Task', dataIndex: 'name', render: (v, t) => <Space size={6}><Text strong style={{ fontSize: 12.5 }}>{v}</Text>{t.batch && <Tag color="geekblue" style={{ fontSize: 10 }}>batch</Tag>}</Space>, sorter: (a, b) => a.name.localeCompare(b.name) },
    { title: 'Module', dataIndex: 'module', width: 150, filters: MODULES.map(m => ({ text: m, value: m })), onFilter: (v, t) => t.module === v, render: (m: SetupModule) => <Tag style={{ background: MOD_COLOR[m], color: '#fff', border: 'none', fontWeight: 600 }}>{m}</Tag> },
    { title: 'Status', dataIndex: 'hasData', width: 170, sorter: (a, b) => Number(a.hasData) - Number(b.hasData), render: (_, t) => t.hasData
        ? <Space size={6}><CheckCircleTwoTone twoToneColor={RW.success} /><Text style={{ fontSize: 12 }}>Configured</Text></Space>
        : <Space size={6}><MinusCircleOutlined style={{ color: RW.n600 }} /><Text type="secondary" style={{ fontSize: 12 }}>Not configured</Text></Space> },
    { title: 'Records', dataIndex: 'recordCount', width: 100, align: 'right', sorter: (a, b) => a.recordCount - b.recordCount, render: (v, t) => t.batch && !v ? <Text type="secondary" style={{ fontSize: 11 }}>batch</Text> : <Text strong style={{ fontVariantNumeric: 'tabular-nums', color: v ? RW.primary : RW.n600 }}>{v || '—'}</Text> },
    { title: 'Files', dataIndex: 'files', width: 70, align: 'right', render: (f: any[]) => f.length || '—' },
    { title: '', width: 90, align: 'center', render: (_, t) => <Button size="small" type="text" icon={<EyeOutlined />} disabled={!t.files.length} style={{ color: t.files.length ? RW.info : undefined }} onClick={() => setDetail(t)}>View</Button> },
  ];

  const hasData = tasks.length > 0;

  return (
    <div style={{ padding: '8px 4px' }}>
      <Breadcrumb style={{ marginBottom: 12 }} items={[
        { title: <Link to="/home"><HomeOutlined /> Home</Link> },
        { title: <Link to="/procurement">Procurement</Link> },
        { title: <Link to="/procurement/setup-data">Setup Data</Link> },
        { title: defaultModule ?? 'Overview' },
      ]} />
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12, gap: 10, flexWrap: 'wrap' }}>
        <DatabaseOutlined style={{ fontSize: 20, color: RW.primary }} />
        <Title level={4} style={{ margin: 0 }}>Setup Data Analysis</Title>
        {fileNames.map(f => <Tag key={f} color="default" style={{ fontSize: 11 }}>{f}</Tag>)}
        {hasData && <Segmented value={view} onChange={v => setView(v as any)} options={[{ value: 'explorer', label: 'Explorer' }, { value: 'analysis', label: 'BU & Module Analysis' }]} />}
        <span style={{ marginLeft: 'auto' }} />
        {hasData && <>
          <Button size="small" icon={<FilePdfOutlined />} onClick={exportPdf}>PDF report</Button>
          <Button size="small" icon={<DownloadOutlined />} onClick={view === 'analysis' ? exportMatrix : exportSummary}>Export {view === 'analysis' ? 'analysis' : 'summary'}</Button>
          <Upload accept=".zip" showUploadList={false} beforeUpload={onFile}><Button size="small" type="primary" icon={<InboxOutlined />} loading={parsing} style={{ background: RW.primary, borderColor: RW.primary }}>Add export…</Button></Upload>
        </>}
      </div>

      {!hasData ? (
        <Card style={{ borderRadius: 10 }}>
          <Upload.Dragger accept=".zip" showUploadList={false} beforeUpload={onFile} disabled={parsing} style={{ padding: 20 }}>
            <p style={{ margin: 0 }}><InboxOutlined style={{ fontSize: 42, color: RW.primary }} /></p>
            <p style={{ margin: '10px 0 2px', fontSize: 15, fontWeight: 600 }}>Upload an Oracle Fusion Setup Data Export (.zip)</p>
            <p style={{ margin: 0, color: RW.n600, fontSize: 12.5 }}>Export it from Functional Setup Manager → Export Setup Data. Each inner task is parsed in your browser; nothing is uploaded to a server.</p>
            {parsing && progress && <div style={{ marginTop: 16, maxWidth: 360, marginInline: 'auto' }}><Progress percent={progress.total ? Math.round((progress.done / progress.total) * 100) : 0} size="small" /><Text type="secondary" style={{ fontSize: 11 }}>Parsing {progress.done}/{progress.total} tasks…</Text></div>}
          </Upload.Dragger>
        </Card>
      ) : (
        <>
          {/* Dashboard (global across all uploaded exports) */}
          <Row gutter={[12, 12]} style={{ marginBottom: 14 }}>
            <Col xs={24} md={6}>
              <Card size="small" style={{ borderRadius: 10, borderTop: `3px solid ${RW.primary}`, height: '100%' }}>
                <Statistic title="Setup Tasks" value={stats.all.total} prefix={<AppstoreOutlined style={{ color: RW.primary }} />} />
                <div style={{ marginTop: 8 }}>
                  <Progress percent={stats.all.pct} strokeColor={RW.success} size="small" format={p => `${p}% done`} />
                  <Space size={12} style={{ fontSize: 12 }}>
                    <span><CheckCircleTwoTone twoToneColor={RW.success} /> {stats.all.configured} configured</span>
                    <Text type="secondary">{stats.all.empty} empty</Text>
                  </Space>
                </div>
                <div style={{ marginTop: 6, fontSize: 12 }}><Text type="secondary">Total records </Text><Text strong style={{ color: RW.primary }}>{stats.all.records.toLocaleString()}</Text></div>
              </Card>
            </Col>
            {MODULES.map(m => {
              const s = stats.byMod[m];
              return (
                <Col xs={24} md={6} key={m}>
                  <Card size="small" hoverable onClick={() => setActiveMod(m)} style={{ borderRadius: 10, borderTop: `3px solid ${MOD_COLOR[m]}`, height: '100%', cursor: 'pointer', outline: activeMod === m ? `2px solid ${MOD_COLOR[m]}` : undefined }}>
                    <Statistic title={<Text strong style={{ color: MOD_COLOR[m] }}>{m}</Text>} value={s.configured} suffix={<Text type="secondary" style={{ fontSize: 13 }}>/ {s.total} tasks</Text>} />
                    <div style={{ marginTop: 8 }}><Progress percent={s.pct} strokeColor={MOD_COLOR[m]} size="small" /></div>
                    <div style={{ marginTop: 4, fontSize: 12 }}><Text type="secondary">Records </Text><Text strong>{s.records.toLocaleString()}</Text></div>
                  </Card>
                </Col>
              );
            })}
          </Row>

          {/* Module tabs — Financials / Supply Chain / Common */}
          <Tabs activeKey={activeMod} onChange={k => setActiveMod(k as SetupModule)} style={{ marginBottom: 4 }}
            items={TAB_MODULES.map(m => ({ key: m, label: <span style={{ fontWeight: 600, color: activeMod === m ? MOD_COLOR[m] : undefined }}>{m} <Tag style={{ marginInlineStart: 4, background: MOD_COLOR[m], color: '#fff', border: 'none' }}>{stats.byMod[m].configured}/{stats.byMod[m].total}</Tag></span> }))} />

          {view === 'explorer' ? (
            <Card size="small" style={{ borderRadius: 10 }}
              styles={{ body: { padding: 10 } }}
              title={<Space wrap>
                <Text strong style={{ color: MOD_COLOR[activeMod] }}>{activeMod} tasks</Text>
                <Input allowClear size="small" prefix={<SearchOutlined />} placeholder="Search task…" value={search} onChange={e => setSearch(e.target.value)} style={{ width: 220 }} />
                <Button size="small" type={configuredOnly ? 'primary' : 'default'} onClick={() => setConfiguredOnly(v => !v)} style={configuredOnly ? { background: RW.success, borderColor: RW.success } : undefined}>Configured only</Button>
              </Space>}>
              <Table size="small" rowKey="name" columns={cols} dataSource={filtered} pagination={{ defaultPageSize: 25, showSizeChanger: true, pageSizeOptions: [25, 50, 100, 200, 500] }}
                scroll={{ x: 720 }} locale={{ emptyText: 'No tasks match' }} />
            </Card>
          ) : (
          <>
          {/* Module status */}
          <Card size="small" title={<Space><AppstoreOutlined style={{ color: RW.primary }} />Module-wise setup status</Space>} style={{ borderRadius: 10, marginBottom: 14 }}>
            <Table size="small" rowKey="module" pagination={false} dataSource={analysis.modRows}
              columns={[
                { title: 'Module', dataIndex: 'module', render: (m: SetupModule) => <Tag style={{ background: MOD_COLOR[m], color: '#fff', border: 'none', fontWeight: 600 }}>{m}</Tag> },
                { title: 'Tasks', dataIndex: 'total', width: 90, align: 'right' },
                { title: 'Configured', dataIndex: 'configured', width: 110, align: 'right', render: (v: number) => <Text strong style={{ color: RW.success }}>{v}</Text> },
                { title: 'Empty', dataIndex: 'empty', width: 90, align: 'right', render: (v: number) => <Text type="secondary">{v}</Text> },
                { title: '% Done', dataIndex: 'pct', width: 160, render: (p: number) => <Progress percent={p} size="small" strokeColor={RW.success} /> },
                { title: 'Records', dataIndex: 'records', width: 110, align: 'right', render: (v: number) => <Text strong style={{ color: RW.primary }}>{v.toLocaleString()}</Text> },
              ] as ColumnsType<any>}
              summary={() => { const t = analysis.modRows.reduce((a, m) => ({ total: a.total + m.total, configured: a.configured + m.configured, empty: a.empty + m.empty, records: a.records + m.records }), { total: 0, configured: 0, empty: 0, records: 0 }); return (
                <Table.Summary.Row style={{ background: RW.n100 }}>
                  <Table.Summary.Cell index={0}><Text strong>All modules</Text></Table.Summary.Cell>
                  <Table.Summary.Cell index={1} align="right"><Text strong>{t.total}</Text></Table.Summary.Cell>
                  <Table.Summary.Cell index={2} align="right"><Text strong style={{ color: RW.success }}>{t.configured}</Text></Table.Summary.Cell>
                  <Table.Summary.Cell index={3} align="right"><Text strong>{t.empty}</Text></Table.Summary.Cell>
                  <Table.Summary.Cell index={4}><Text strong>{t.total ? Math.round((t.configured / t.total) * 100) : 0}%</Text></Table.Summary.Cell>
                  <Table.Summary.Cell index={5} align="right"><Text strong style={{ color: RW.primary }}>{t.records.toLocaleString()}</Text></Table.Summary.Cell>
                </Table.Summary.Row>
              ); }} />
          </Card>

          {/* Business Unit × Setup matrix */}
          <Card size="small" style={{ borderRadius: 10 }}
            title={<Space wrap><DatabaseOutlined style={{ color: RW.teal }} /><Text strong>Business Unit × Setup matrix</Text>
              <Tag>{analysis.buUniverse.length} BUs</Tag><Tag>{analysis.scoped.length} BU-scoped tasks</Tag>
              <Input allowClear size="small" prefix={<SearchOutlined />} placeholder="Search BU…" value={buSearch} onChange={e => setBuSearch(e.target.value)} style={{ width: 200 }} /></Space>}>
            {analysis.scoped.length === 0
              ? <Empty description="No business-unit-scoped setup tasks found in this export" />
              : <Table size="small" rowKey="bu" dataSource={buRowsFiltered} pagination={{ defaultPageSize: 30, showSizeChanger: true, pageSizeOptions: [30, 50, 100, 200, 500] }}
                  scroll={{ x: 300 + analysis.scoped.length * 92, y: 520 }}
                  columns={[
                    { title: 'Business Unit', dataIndex: 'bu', width: 250, fixed: 'left' as const, render: (v: string) => <Text strong style={{ fontSize: 12 }}>{v}</Text> },
                    { title: 'Setups Done', dataIndex: 'doneCount', width: 150, fixed: 'left' as const, align: 'left' as const, sorter: (a: any, b: any) => a.doneCount - b.doneCount, defaultSortOrder: 'descend' as const,
                      render: (n: number) => <Space size={6}><Text strong style={{ color: RW.primary }}>{n}/{analysis.scoped.length}</Text><Progress percent={Math.round((n / analysis.scoped.length) * 100)} size="small" showInfo={false} style={{ width: 70 }} strokeColor={RW.teal} /></Space> },
                    ...analysis.scoped.map(t => ({
                      title: <Tooltip title={`${t.name} — ${analysis.colCounts[t.name]} of ${analysis.buUniverse.length} BUs configured`}>
                        <div style={{ textAlign: 'center' as const, lineHeight: 1.2 }}>
                          <div style={{ fontSize: 10.5 }}>{t.name.length > 16 ? t.name.slice(0, 15) + '…' : t.name}</div>
                          <span style={{ display: 'inline-block', marginTop: 3, fontSize: 10.5, fontWeight: 700, color: '#fff', background: RW.success, borderRadius: 8, padding: '0 6px', lineHeight: '16px' }}>✓ {analysis.colCounts[t.name]}</span>
                        </div></Tooltip>,
                      dataIndex: ['cells', t.name], width: 92, align: 'center' as const,
                      render: (_: any, r: any) => r.cells[t.name] ? <CheckCircleTwoTone twoToneColor={RW.success} /> : <span style={{ color: RW.n200 }}>·</span>,
                    })),
                  ] as ColumnsType<any>} />}
          </Card>
        </>
      )}

      {/* Task detail — the parsed setup data */}
      <Drawer open={!!detail} onClose={() => setDetail(null)} width={920} title={detail && <Space><DatabaseOutlined style={{ color: MOD_COLOR[detail.module] }} />{detail.name}<Tag style={{ background: MOD_COLOR[detail.module], color: '#fff', border: 'none', fontWeight: 600 }}>{detail.module}</Tag>{detail.hasData ? <Tag color="success">{detail.recordCount} record(s)</Tag> : <Tag>empty</Tag>}</Space>}>
        {detail && (detail.files.length === 0
          ? <Empty description={detail.batch ? 'Batch-format task — records are in a nested import batch (not table-parsed).' : 'No setup data (task not configured).'} />
          : <Tabs size="small" items={detail.files.map((f, i) => ({
              key: String(i),
              label: <Space size={4}>{f.sdoTitle || f.name}<Tag style={{ fontSize: 10, marginInlineStart: 4 }}>{f.rows.length}</Tag></Space>,
              children: f.headers.length === 0
                ? <Empty description="No columns" />
                : <Table size="small" rowKey={(_, idx) => String(idx)} pagination={f.rows.length > 50 ? { pageSize: 50 } : false}
                    scroll={{ x: 'max-content', y: 520 }}
                    columns={f.headers.map((h, ci) => ({ title: h || `Col ${ci + 1}`, dataIndex: ci, ellipsis: true, render: (v: any) => <Tooltip title={v}><span style={{ fontSize: 11.5 }}>{v || <Text type="secondary">—</Text>}</span></Tooltip> }))}
                    dataSource={f.rows.map((r, ri) => ({ key: ri, ...Object.fromEntries(r.map((c, ci) => [ci, c])) }))} />,
            }))} />)}
      </Drawer>
        </>
      )}
    </div>
  );
};

export default SetupDataExplorer;
