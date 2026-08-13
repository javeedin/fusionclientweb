import React, { useState, useRef, useCallback } from 'react';
import {
  Layout, Card, Button, Space, Typography, Table, Tag, Progress,
  Statistic, Row, Col, Form, Input, Tooltip, Breadcrumb,
  Alert, Badge, Divider, message, Tabs, Modal,
} from 'antd';
import {
  HomeOutlined, DownloadOutlined, CloudOutlined, SyncOutlined,
  CheckCircleOutlined, CloseCircleOutlined, FolderOpenOutlined,
  FileOutlined, FilePdfOutlined, FileImageOutlined, FileExcelOutlined,
  FileWordOutlined, ReloadOutlined, StopOutlined, SearchOutlined,
  BankOutlined, FileTextOutlined, UserOutlined, TeamOutlined,
  SwapOutlined, EyeOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import type { ColumnsType } from 'antd/es/table';
import { APEX_DB_CONFIG, ORACLE_FUSION_CONFIG } from '../../config/api.config';
import FloatingMenu from '../../components/FloatingMenu';

const { Content } = Layout;
const { Title, Text } = Typography;

const FUSION_BASE  = ORACLE_FUSION_CONFIG.baseUrl;
const FUSION_HOST  = 'https://iaaobn.fa.ocs.oraclecloud.com';
const APEX_BASE    = APEX_DB_CONFIG.baseUrl;
const APEX_INVOICES = `${APEX_BASE}/ap/createinvoice`;
const APEX_DL_LOG   = `${APEX_BASE}/ap/fusion-invoice-attachments`;

// ── Shared interfaces ────────────────────────────────────────────────────────

interface FusionFile {
  fileName:  string;
  savedAs:   string;
  href:      string;
  fileSize?: number;
  mimeType?: string;
  status:    'pending' | 'downloading' | 'done' | 'error' | 'skipped';
  error?:    string;
}

interface InvoiceRow {
  key:             string;
  invoiceId:       number;
  invoiceNumber:   string;
  supplier:        string;
  invoiceDate:     string;
  businessUnit:    string;
  invoiceCurrency: string;
  scanStatus:      'idle' | 'scanning' | 'found' | 'none' | 'error';
  scanError?:      string;
  attachmentHref?: string;
  files:           FusionFile[];
  dlStatus:        'idle' | 'downloading' | 'done' | 'error' | 'partial';
}

interface BatchRow {
  key:        string;
  jeBatchId:  number;
  periodName: string;
  batchName:  string;
  status:     string;
  scanStatus: 'idle' | 'scanning' | 'found' | 'none' | 'error';
  scanError?: string;
  files:      FusionFile[];
  dlStatus:   'idle' | 'downloading' | 'done' | 'error' | 'partial';
}

interface SupplierRow {
  key:            string;
  supplierId:     number;
  supplierNumber: string;
  supplierName:   string;
  alternateName:  string;
  scanStatus:     'idle' | 'scanning' | 'found' | 'none' | 'error';
  scanError?:     string;
  files:          FusionFile[];
  dlStatus:       'idle' | 'downloading' | 'done' | 'error' | 'partial';
}

interface ReceiptAttRow {
  key:               string;
  standardReceiptId: number;
  receiptNumber:     string;
  customerName:      string;
  businessUnit:      string;
  currency:          string;
  scanStatus:        'idle' | 'scanning' | 'found' | 'none' | 'error';
  scanError?:        string;
  files:             FusionFile[];
  dlStatus:          'idle' | 'downloading' | 'done' | 'error' | 'partial';
}

interface ArInvRow {
  key:                   string;
  customerTransactionId: number;
  transactionNumber:     string;
  customerName:          string;
  businessUnit:          string;
  transactionDate:       string;
  currency:              string;
  scanStatus:            'idle' | 'scanning' | 'found' | 'none' | 'error';
  scanError?:            string;
  files:                 FusionFile[];
  dlStatus:              'idle' | 'downloading' | 'done' | 'error' | 'partial';
}

// ── Shared helpers ───────────────────────────────────────────────────────────

const fusionCreds   = () => btoa(`${ORACLE_FUSION_CONFIG.username}:${ORACLE_FUSION_CONFIG.password}`);
const fusionHeaders = () => ({ 'Authorization': `Basic ${fusionCreds()}`, 'Accept': 'application/json' });

function fileIcon(mimeType: string, fileName: string) {
  const ext = (fileName || '').split('.').pop()?.toLowerCase() ?? '';
  if (mimeType?.includes('pdf') || ext === 'pdf')
    return <FilePdfOutlined style={{ color: '#E53935' }} />;
  if (mimeType?.includes('image') || ['jpg','jpeg','png','gif','bmp','webp'].includes(ext))
    return <FileImageOutlined style={{ color: '#1E88E5' }} />;
  if (['xls','xlsx'].includes(ext)) return <FileExcelOutlined style={{ color: '#1D7B4D' }} />;
  if (['doc','docx'].includes(ext)) return <FileWordOutlined  style={{ color: '#1565C0' }} />;
  return <FileOutlined style={{ color: '#6B6B6B' }} />;
}

function safeName(name: string) { return name.replace(/[\\/:*?"<>|]/g, '_'); }

function statusLabel(s: string) {
  if (s === 'P') return <Tag color="green"  style={{ fontSize: 11 }}>Posted</Tag>;
  if (s === 'U') return <Tag color="blue"   style={{ fontSize: 11 }}>Unposted</Tag>;
  if (s === 'S') return <Tag color="orange" style={{ fontSize: 11 }}>Selected</Tag>;
  return <Tag style={{ fontSize: 11 }}>{s}</Tag>;
}

// ── Main Component ───────────────────────────────────────────────────────────

const DownloadInvoiceAttachments: React.FC = () => {
  const [form] = Form.useForm();
  const [batchForm] = Form.useForm();

  // ── Shared: folder picker ─────────────────────────────────────────────────
  const dirHandleRef            = useRef<FileSystemDirectoryHandle | null>(null);
  const [folderName, setFolderName] = useState('');

  const chooseFolder = async () => {
    try {
      const handle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
      dirHandleRef.current = handle;
      setFolderName(handle.name);
    } catch { /* user cancelled */ }
  };

  const saveBlob = async (blob: Blob, savedAs: string) => {
    if (dirHandleRef.current) {
      try {
        const fh  = await dirHandleRef.current.getFileHandle(savedAs, { create: true });
        const wr  = await (fh as any).createWritable();
        await wr.write(blob);
        await wr.close();
        return;
      } catch { /* fall through */ }
    }
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href = url; a.download = savedAs;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // TAB 1 — INVOICES (existing logic, unchanged)
  // ═══════════════════════════════════════════════════════════════════════════

  const [rows, setRows]             = useState<InvoiceRow[]>([]);
  const [loading, setLoading]       = useState(false);
  const [running, setRunning]       = useState(false);
  const stopRef                     = useRef(false);
  const [scanned, setScanned]       = useState(0);
  const [withAttach, setWithAttach] = useState(0);
  const [totalFiles, setTotalFiles] = useState(0);
  const [doneFiles, setDoneFiles]   = useState(0);
  const [errorFiles, setErrorFiles] = useState(0);

  const logToApex = async (inv: InvoiceRow, file: FusionFile, status: 'DOWNLOADED' | 'ERROR', blob?: Blob, errMsg?: string) => {
    try {
      await fetch(APEX_DL_LOG, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoiceId: inv.invoiceId, invoiceNumber: inv.invoiceNumber,
          fileName: file.fileName, savedAs: file.savedAs, fusionHref: file.href,
          downloadStatus: status, fileSize: blob?.size ?? null, mimeType: blob?.type ?? null,
          errorMessage: errMsg ?? null, createdBy: ORACLE_FUSION_CONFIG.username,
        }),
      });
    } catch { /* non-critical */ }
  };

  const scanInvoice = useCallback(async (inv: InvoiceRow): Promise<InvoiceRow> => {
    const upd = (p: Partial<InvoiceRow>): InvoiceRow => ({ ...inv, ...p });
    try {
      const r1   = await fetch(`${FUSION_BASE}/invoices?q=InvoiceNumber=${encodeURIComponent(inv.invoiceNumber)}`, { headers: fusionHeaders() });
      if (!r1.ok) throw new Error(`HTTP ${r1.status}`);
      const item = ((await r1.json()).items || [])[0];
      if (!item) return upd({ scanStatus: 'none' });
      const attachLink = (item.links || []).find((l: any) => l.rel === 'child' && l.name === 'attachments');
      if (!attachLink) return upd({ scanStatus: 'none' });
      const r2 = await fetch(attachLink.href, { headers: fusionHeaders() });
      if (!r2.ok) throw new Error(`HTTP ${r2.status}`);
      const items: any[] = (await r2.json()).items || [];
      if (items.length === 0) return upd({ scanStatus: 'none' });
      const files: FusionFile[] = items.map((att: any) => {
        const links: any[] = att.links || [];
        const best = links.find((l: any) => l.rel === 'enclosure' && l.name === 'FileContents') ||
                     links.find((l: any) => l.rel === 'enclosure') ||
                     (att.FileUrl ? { href: FUSION_HOST + att.FileUrl } : null);
        const fileName = att.FileName || att.Title || 'attachment';
        return { fileName, savedAs: `[${safeName(inv.invoiceNumber)}]_${safeName(fileName)}`, href: best?.href ?? '', fileSize: att.FileSize ?? att.UploadedFileLength, mimeType: att.ContentType ?? att.UploadedFileContentType, status: 'pending' } as FusionFile;
      });
      return upd({ scanStatus: 'found', attachmentHref: attachLink.href, files });
    } catch (e: any) { return upd({ scanStatus: 'error', scanError: e.message }); }
  }, []);

  const downloadInvFile = async (inv: InvoiceRow, file: FusionFile): Promise<'done' | 'error'> => {
    if (!file.href) return 'error';
    try {
      const res = await fetch(file.href, { headers: { 'Authorization': `Basic ${fusionCreds()}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      await saveBlob(blob, file.savedAs);
      await logToApex(inv, file, 'DOWNLOADED', blob);
      return 'done';
    } catch (e: any) {
      await logToApex(inv, file, 'ERROR', undefined, e.message);
      return 'error';
    }
  };

  const handleSearch = async () => {
    const vals = form.getFieldsValue();
    setLoading(true); setRows([]);
    setScanned(0); setWithAttach(0); setTotalFiles(0); setDoneFiles(0); setErrorFiles(0);
    try {
      const q = new URLSearchParams();
      if (vals.businessUnit)  q.set('business_unit',   vals.businessUnit);
      if (vals.supplier)      q.set('supplier',         vals.supplier);
      if (vals.invoiceNumber) q.set('invoice_number',   vals.invoiceNumber);
      q.set('row_limit', '2000');
      const res  = await fetch(`${APEX_INVOICES}?${q}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const mapped: InvoiceRow[] = (data.items || data || []).map((item: any, i: number) => ({
        key: item.invoice_id?.toString() || String(i), invoiceId: item.invoice_id ?? 0,
        invoiceNumber: item.invoice_number || '', supplier: item.supplier || item.party || '',
        invoiceDate: (item.invoice_date || '').slice(0, 10), businessUnit: item.business_unit || '',
        invoiceCurrency: item.invoice_currency || '', scanStatus: 'idle', files: [], dlStatus: 'idle',
      }));
      setRows(mapped);
      message.success(`Loaded ${mapped.length} invoices`);
    } catch (e: any) { message.error(`Failed: ${e.message}`); }
    finally { setLoading(false); }
  };

  const handleRun = async () => {
    if (rows.length === 0) { message.warning('Load invoices first'); return; }
    stopRef.current = false; setRunning(true);
    setScanned(0); setWithAttach(0); setTotalFiles(0); setDoneFiles(0); setErrorFiles(0);
    let sc = 0, ac = 0, fc = 0, dc = 0, ec = 0;
    const work: InvoiceRow[] = rows.map(r => ({ ...r, scanStatus: 'idle' as const, files: [], dlStatus: 'idle' as const }));
    const upd = (i: number, p: Partial<InvoiceRow>) => { work[i] = { ...work[i], ...p } as InvoiceRow; setRows([...work]); };
    for (let i = 0; i < work.length; i++) {
      if (stopRef.current) break;
      upd(i, { scanStatus: 'scanning' });
      const sv = await scanInvoice(work[i]); sc++; setScanned(sc);
      if (sv.scanStatus === 'found') { ac++; fc += sv.files.length; setWithAttach(ac); setTotalFiles(fc); }
      upd(i, sv);
      if (sv.scanStatus !== 'found' || sv.files.length === 0) continue;
      if (stopRef.current) break;
      upd(i, { dlStatus: 'downloading' });
      const uf = [...sv.files]; let id = 0, ie = 0;
      for (let j = 0; j < uf.length; j++) {
        if (stopRef.current) break;
        uf[j] = { ...uf[j], status: 'downloading' }; upd(i, { files: [...uf] });
        const r = await downloadInvFile(work[i], uf[j]);
        if (r === 'done') { uf[j] = { ...uf[j], status: 'done' }; dc++; id++; setDoneFiles(dc); }
        else              { uf[j] = { ...uf[j], status: 'error'}; ec++; ie++; setErrorFiles(ec); }
        upd(i, { files: [...uf] });
      }
      upd(i, { dlStatus: ie === 0 ? 'done' : id === 0 ? 'error' : 'partial', files: [...uf] });
    }
    setRunning(false);
    message.success(`Finished. ${dc} downloaded, ${ec} errors.`);
  };

  const invColumns: ColumnsType<InvoiceRow> = [
    { title: '#', key: 'seq', width: 50, render: (_,__,i) => <Text type="secondary" style={{ fontSize: 11 }}>{i+1}</Text> },
    { title: 'Invoice Number', dataIndex: 'invoiceNumber', width: 160, render: (v) => <Text strong style={{ fontSize: 12 }}>{v}</Text> },
    { title: 'Supplier', dataIndex: 'supplier', ellipsis: true, render: (v) => <Text style={{ fontSize: 12 }}>{v}</Text> },
    { title: 'Date', dataIndex: 'invoiceDate', width: 100, render: (v) => <Text style={{ fontSize: 12 }}>{v}</Text> },
    { title: 'BU', dataIndex: 'businessUnit', width: 140, ellipsis: true, render: (v) => <Text style={{ fontSize: 11 }}>{v}</Text> },
    { title: 'Scan', key: 'scan', width: 110, render: (_,r: InvoiceRow) => ({
        idle: <Tag style={{ fontSize: 11 }}>—</Tag>,
        scanning: <Tag color="processing" icon={<SyncOutlined spin />} style={{ fontSize: 11 }}>Scanning</Tag>,
        found:    <Tag color="green" icon={<CheckCircleOutlined />} style={{ fontSize: 11 }}>{r.files.length} file{r.files.length !== 1 ? 's' : ''}</Tag>,
        none:     <Tag color="default" style={{ fontSize: 11 }}>No attachments</Tag>,
        error:    <Tooltip title={r.scanError}><Tag color="red" icon={<CloseCircleOutlined />} style={{ fontSize: 11 }}>Error</Tag></Tooltip>,
      }[r.scanStatus] ?? null ),
    },
    { title: 'Download', key: 'dl', width: 110, render: (_,r: InvoiceRow) => ({
        idle: null,
        downloading: <Tag color="processing" icon={<SyncOutlined spin />} style={{ fontSize: 11 }}>Downloading</Tag>,
        done:        <Tag color="success"    icon={<CheckCircleOutlined />} style={{ fontSize: 11 }}>Done</Tag>,
        partial:     <Tag color="warning"    icon={<CloseCircleOutlined />} style={{ fontSize: 11 }}>Partial</Tag>,
        error:       <Tag color="error"      icon={<CloseCircleOutlined />} style={{ fontSize: 11 }}>Error</Tag>,
      }[r.dlStatus] ?? null ),
    },
    { title: 'Files', key: 'files', render: (_,r: InvoiceRow) => r.files.length === 0 ? null : (
        <Space size={2} wrap>{r.files.map((f,i) => {
          const col = f.status === 'done' ? '#1D7B4D' : f.status === 'error' ? '#D93025' : f.status === 'downloading' ? '#0572CE' : '#6B6B6B';
          return <Tooltip key={i} title={`${f.savedAs}${f.error ? ` — ${f.error}` : ''}`}><span style={{ color: col, fontSize: 16 }}>{fileIcon(f.mimeType ?? '', f.fileName)}</span></Tooltip>;
        })}</Space>
    )},
  ];

  const invPct = totalFiles > 0 ? Math.round((doneFiles / totalFiles) * 100) : 0;

  // ═══════════════════════════════════════════════════════════════════════════
  // TAB 2 — JOURNAL BATCHES
  // ═══════════════════════════════════════════════════════════════════════════

  const [batchRows, setBatchRows]           = useState<BatchRow[]>([]);
  const [batchLoading, setBatchLoading]     = useState(false);
  const [batchRunning, setBatchRunning]     = useState(false);
  const batchStopRef                        = useRef(false);
  const [batchScanned, setBatchScanned]     = useState(0);
  const [batchWith, setBatchWith]           = useState(0);
  const [batchTotal, setBatchTotal]         = useState(0);
  const [batchDone, setBatchDone]           = useState(0);
  const [batchErr, setBatchErr]             = useState(0);

  // Fetch progress (shown while loading batches from Fusion)
  const [fetchProgress, setFetchProgress]   = useState<{ page: number; fetched: number; status: string } | null>(null);

  // Preview modal state
  const [previewBatch, setPreviewBatch]     = useState<BatchRow | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Load journal batches from Fusion (paginated; limit option for testing)
  const handleLoadBatches = async () => {
    const vals = batchForm.getFieldsValue();
    const fetchLimit: number = Number(vals.fetchLimit ?? 0);  // 0 = all pages
    const PAGE = fetchLimit > 0 ? Math.min(fetchLimit, 500) : 500;

    setBatchLoading(true); setBatchRows([]);
    setBatchScanned(0); setBatchWith(0); setBatchTotal(0); setBatchDone(0); setBatchErr(0);
    setFetchProgress({ page: 0, fetched: 0, status: 'Connecting to Oracle Fusion…' });

    try {
      let offset = 0;
      let pageNum = 0;
      let all: BatchRow[] = [];
      let hasMore = true;

      while (hasMore) {
        pageNum++;
        setFetchProgress({ page: pageNum, fetched: all.length, status: `Fetching page ${pageNum} (offset ${offset})…` });

        const params = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
        if (vals.periodName) params.set('q', `DefaultPeriodName="${vals.periodName}"`);

        const res = await fetch(`${FUSION_BASE}/journalBatches?${params}`, { headers: fusionHeaders() });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const items: any[] = data.items || [];

        const mapped: BatchRow[] = items.map((it: any, i: number) => ({
          key:        String(it.JeBatchId ?? `${offset}_${i}`),
          jeBatchId:  it.JeBatchId ?? 0,
          periodName: it.DefaultPeriodName || '',
          batchName:  (it.BatchName || '').trim(),
          status:     it.Status || '',
          scanStatus: 'idle',
          files:      [],
          dlStatus:   'idle',
        }));

        const filtered = vals.batchName
          ? mapped.filter(r => r.batchName.toLowerCase().includes(vals.batchName.toLowerCase()))
          : mapped;

        all = [...all, ...filtered];
        setBatchRows([...all]);  // update grid live as pages arrive

        // Stop after one page when a fixed limit was requested
        hasMore = fetchLimit > 0 ? false : (data.hasMore === true && items.length === PAGE);
        offset += PAGE;

        setFetchProgress({ page: pageNum, fetched: all.length, status: hasMore ? `Page ${pageNum} done — fetching next…` : 'Done' });
      }

      setFetchProgress({ page: pageNum, fetched: all.length, status: `Loaded ${all.length} batches` });
      message.success(`Loaded ${all.length} journal batches`);
    } catch (e: any) {
      setFetchProgress(prev => prev ? { ...prev, status: `Error: ${e.message}` } : null);
      message.error(`Failed: ${e.message}`);
    } finally {
      setBatchLoading(false);
    }
  };

  const scanBatch = useCallback(async (row: BatchRow): Promise<BatchRow> => {
    const upd = (p: Partial<BatchRow>): BatchRow => ({ ...row, ...p });
    try {
      const url = `${FUSION_BASE}/journalBatches/${row.jeBatchId}/child/batchAttachment`;
      const res = await fetch(url, { headers: fusionHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data  = await res.json();
      const items: any[] = data.items || [];
      if (items.length === 0) return upd({ scanStatus: 'none' });
      const files: FusionFile[] = items.map((att: any) => {
        const links: any[] = att.links || [];
        const best = links.find((l: any) => l.rel === 'enclosure' && l.name === 'FileContents') ||
                     links.find((l: any) => l.rel === 'enclosure') ||
                     (att.FileUrl ? { href: FUSION_HOST + att.FileUrl } : null);
        const fileName = att.FileName || att.Title || 'attachment';
        return {
          fileName,
          savedAs:  `[${row.jeBatchId}]_${safeName(fileName)}`,
          href:     best?.href ?? '',
          fileSize: att.UploadedFileLength ?? att.FileSize,
          mimeType: att.UploadedFileContentType ?? att.ContentType,
          status:   'pending',
        } as FusionFile;
      });
      return upd({ scanStatus: 'found', files });
    } catch (e: any) { return upd({ scanStatus: 'error', scanError: e.message }); }
  }, []);

  const downloadBatchFile = async (file: FusionFile): Promise<'done' | 'error'> => {
    if (!file.href) return 'error';
    try {
      const res = await fetch(file.href, { headers: { 'Authorization': `Basic ${fusionCreds()}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      await saveBlob(blob, file.savedAs);
      return 'done';
    } catch { return 'error'; }
  };

  const handleRunBatches = async () => {
    if (batchRows.length === 0) { message.warning('Load batches first'); return; }
    batchStopRef.current = false; setBatchRunning(true);
    setBatchScanned(0); setBatchWith(0); setBatchTotal(0); setBatchDone(0); setBatchErr(0);
    let sc = 0, ac = 0, fc = 0, dc = 0, ec = 0;
    const work: BatchRow[] = batchRows.map(r => ({ ...r, scanStatus: 'idle' as const, files: [], dlStatus: 'idle' as const }));
    const upd = (i: number, p: Partial<BatchRow>) => { work[i] = { ...work[i], ...p } as BatchRow; setBatchRows([...work]); };
    for (let i = 0; i < work.length; i++) {
      if (batchStopRef.current) break;
      upd(i, { scanStatus: 'scanning' });
      const sv = await scanBatch(work[i]); sc++; setBatchScanned(sc);
      if (sv.scanStatus === 'found') { ac++; fc += sv.files.length; setBatchWith(ac); setBatchTotal(fc); }
      upd(i, sv);
      if (sv.scanStatus !== 'found' || sv.files.length === 0) continue;
      if (batchStopRef.current) break;
      upd(i, { dlStatus: 'downloading' });
      const uf = [...sv.files]; let id = 0, ie = 0;
      for (let j = 0; j < uf.length; j++) {
        if (batchStopRef.current) break;
        uf[j] = { ...uf[j], status: 'downloading' }; upd(i, { files: [...uf] });
        const r = await downloadBatchFile(uf[j]);
        if (r === 'done') { uf[j] = { ...uf[j], status: 'done' }; dc++; id++; setBatchDone(dc); }
        else              { uf[j] = { ...uf[j], status: 'error'}; ec++; ie++; setBatchErr(ec);  }
        upd(i, { files: [...uf] });
      }
      upd(i, { dlStatus: ie === 0 ? 'done' : id === 0 ? 'error' : 'partial', files: [...uf] });
    }
    setBatchRunning(false);
    message.success(`Finished. ${dc} downloaded, ${ec} errors.`);
  };

  // Preview a single batch's attachments
  const handlePreview = async (row: BatchRow) => {
    setPreviewLoading(true);
    setPreviewBatch({ ...row, scanStatus: 'scanning', files: [] });
    const result = await scanBatch(row);
    setPreviewBatch(result);
    setPreviewLoading(false);
  };

  const batchColumns: ColumnsType<BatchRow> = [
    { title: '#', key: 'seq', width: 50, render: (_,__,i) => <Text type="secondary" style={{ fontSize: 11 }}>{i+1}</Text> },
    { title: 'Batch ID', dataIndex: 'jeBatchId', width: 110, render: (v) => <Text code style={{ fontSize: 11 }}>{v}</Text> },
    { title: 'Period', dataIndex: 'periodName', width: 90, render: (v) => <Text style={{ fontSize: 12 }}>{v}</Text> },
    { title: 'Batch Name', dataIndex: 'batchName', ellipsis: true, render: (v) => <Text style={{ fontSize: 12 }}>{v}</Text> },
    { title: 'Status', dataIndex: 'status', width: 90, render: (v) => statusLabel(v) },
    { title: 'Scan', key: 'scan', width: 120, render: (_,r: BatchRow) => ({
        idle:     <Tag style={{ fontSize: 11 }}>—</Tag>,
        scanning: <Tag color="processing" icon={<SyncOutlined spin />} style={{ fontSize: 11 }}>Scanning</Tag>,
        found:    <Tag color="green" icon={<CheckCircleOutlined />} style={{ fontSize: 11 }}>{r.files.length} file{r.files.length !== 1 ? 's' : ''}</Tag>,
        none:     <Tag color="default" style={{ fontSize: 11 }}>No attachments</Tag>,
        error:    <Tooltip title={r.scanError}><Tag color="red" icon={<CloseCircleOutlined />} style={{ fontSize: 11 }}>Error</Tag></Tooltip>,
      }[r.scanStatus] ?? null ),
    },
    { title: 'Download', key: 'dl', width: 110, render: (_,r: BatchRow) => ({
        idle: null,
        downloading: <Tag color="processing" icon={<SyncOutlined spin />} style={{ fontSize: 11 }}>Downloading</Tag>,
        done:        <Tag color="success"    icon={<CheckCircleOutlined />} style={{ fontSize: 11 }}>Done</Tag>,
        partial:     <Tag color="warning"    icon={<CloseCircleOutlined />} style={{ fontSize: 11 }}>Partial</Tag>,
        error:       <Tag color="error"      icon={<CloseCircleOutlined />} style={{ fontSize: 11 }}>Error</Tag>,
      }[r.dlStatus] ?? null ),
    },
    { title: 'Files', key: 'files', render: (_,r: BatchRow) => r.files.length === 0 ? null : (
        <Space size={2} wrap>{r.files.map((f,i) => {
          const col = f.status === 'done' ? '#1D7B4D' : f.status === 'error' ? '#D93025' : f.status === 'downloading' ? '#0572CE' : '#6B6B6B';
          return <Tooltip key={i} title={`${f.savedAs}${f.error ? ` — ${f.error}` : ''}`}><span style={{ color: col, fontSize: 16 }}>{fileIcon(f.mimeType ?? '', f.fileName)}</span></Tooltip>;
        })}</Space>
    )},
    { title: 'Preview', key: 'preview', width: 80, render: (_,r: BatchRow) => (
        <Tooltip title="Preview attachments for this batch">
          <Button size="small" icon={<EyeOutlined />} onClick={() => handlePreview(r)} />
        </Tooltip>
    )},
  ];

  const batchPct = batchTotal > 0 ? Math.round((batchDone / batchTotal) * 100) : 0;

  // ═══════════════════════════════════════════════════════════════════════════
  // TAB 5 — SUPPLIERS
  // ═══════════════════════════════════════════════════════════════════════════

  const [supplierForm] = Form.useForm();
  const [suppRows, setSuppRows]               = useState<SupplierRow[]>([]);
  const [suppLoading, setSuppLoading]         = useState(false);
  const [suppRunning, setSuppRunning]         = useState(false);
  const suppStopRef                           = useRef(false);
  const [suppScanned, setSuppScanned]         = useState(0);
  const [suppWith, setSuppWith]               = useState(0);
  const [suppTotal, setSuppTotal]             = useState(0);
  const [suppDone, setSuppDone]               = useState(0);
  const [suppErr, setSuppErr]                 = useState(0);
  const [suppFetchProgress, setSuppFetchProgress] = useState<{ page: number; fetched: number; status: string } | null>(null);
  const [suppPreview, setSuppPreview]         = useState<SupplierRow | null>(null);
  const [suppPreviewLoading, setSuppPreviewLoading] = useState(false);

  const handleLoadSuppliers = async () => {
    const vals = supplierForm.getFieldsValue();
    const fetchLimit: number = Number(vals.fetchLimit ?? 0);
    const PAGE = fetchLimit > 0 ? Math.min(fetchLimit, 500) : 500;

    setSuppLoading(true); setSuppRows([]);
    setSuppScanned(0); setSuppWith(0); setSuppTotal(0); setSuppDone(0); setSuppErr(0);
    setSuppFetchProgress({ page: 0, fetched: 0, status: 'Connecting to Oracle Fusion…' });

    try {
      let offset = 0, pageNum = 0;
      let all: SupplierRow[] = [];
      let hasMore = true;

      while (hasMore) {
        pageNum++;
        setSuppFetchProgress({ page: pageNum, fetched: all.length, status: `Fetching page ${pageNum} (offset ${offset})…` });

        const params = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
        if (vals.supplierName) params.set('q', `Supplier LIKE "${vals.supplierName}%"`);

        const res = await fetch(`${FUSION_BASE}/suppliers?${params}`, { headers: fusionHeaders() });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const items: any[] = data.items || [];

        const mapped: SupplierRow[] = items.map((it: any, i: number) => ({
          key:            String(it.SupplierId ?? `${offset}_${i}`),
          supplierId:     it.SupplierId ?? 0,
          supplierNumber: it.SupplierNumber || '',
          supplierName:   (it.Supplier || '').trim(),
          alternateName:  it.AlternateName || '',
          scanStatus:     'idle',
          files:          [],
          dlStatus:       'idle',
        }));

        const filtered = vals.supplierNameFilter
          ? mapped.filter(r => r.supplierName.toLowerCase().includes(vals.supplierNameFilter.toLowerCase()))
          : mapped;

        all = [...all, ...filtered];
        setSuppRows([...all]);

        hasMore = fetchLimit > 0 ? false : (data.hasMore === true && items.length === PAGE);
        offset += PAGE;
        setSuppFetchProgress({ page: pageNum, fetched: all.length, status: hasMore ? `Page ${pageNum} done — fetching next…` : 'Done' });
      }

      setSuppFetchProgress({ page: pageNum, fetched: all.length, status: `Loaded ${all.length} suppliers` });
      message.success(`Loaded ${all.length} suppliers`);
    } catch (e: any) {
      setSuppFetchProgress(prev => prev ? { ...prev, status: `Error: ${e.message}` } : null);
      message.error(`Failed: ${e.message}`);
    } finally {
      setSuppLoading(false);
    }
  };

  const scanSupplier = useCallback(async (row: SupplierRow): Promise<SupplierRow> => {
    const upd = (p: Partial<SupplierRow>): SupplierRow => ({ ...row, ...p });
    try {
      const url = `${FUSION_BASE}/suppliers/${row.supplierId}/child/attachments`;
      const res = await fetch(url, { headers: fusionHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data  = await res.json();
      const items: any[] = data.items || [];
      if (items.length === 0) return upd({ scanStatus: 'none' });
      const files: FusionFile[] = items.map((att: any) => {
        const links: any[] = att.links || [];
        const best = links.find((l: any) => l.rel === 'enclosure' && l.name === 'FileContents') ||
                     links.find((l: any) => l.rel === 'enclosure') ||
                     (att.FileUrl ? { href: FUSION_HOST + att.FileUrl } : null);
        const fileName = att.FileName || att.Title || 'attachment';
        return {
          fileName,
          savedAs:  `[${row.supplierNumber || row.supplierId}]_${safeName(fileName)}`,
          href:     best?.href ?? '',
          fileSize: att.UploadedFileLength ?? att.FileSize,
          mimeType: att.UploadedFileContentType ?? att.ContentType,
          status:   'pending',
        } as FusionFile;
      });
      return upd({ scanStatus: 'found', files });
    } catch (e: any) { return upd({ scanStatus: 'error', scanError: e.message }); }
  }, []);

  const downloadSuppFile = async (file: FusionFile): Promise<'done' | 'error'> => {
    if (!file.href) return 'error';
    try {
      const res = await fetch(file.href, { headers: { 'Authorization': `Basic ${fusionCreds()}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await saveBlob(await res.blob(), file.savedAs);
      return 'done';
    } catch { return 'error'; }
  };

  const handleRunSuppliers = async () => {
    if (suppRows.length === 0) { message.warning('Load suppliers first'); return; }
    suppStopRef.current = false; setSuppRunning(true);
    setSuppScanned(0); setSuppWith(0); setSuppTotal(0); setSuppDone(0); setSuppErr(0);
    let sc = 0, ac = 0, fc = 0, dc = 0, ec = 0;
    const work: SupplierRow[] = suppRows.map(r => ({ ...r, scanStatus: 'idle' as const, files: [], dlStatus: 'idle' as const }));
    const upd = (i: number, p: Partial<SupplierRow>) => { work[i] = { ...work[i], ...p } as SupplierRow; setSuppRows([...work]); };
    for (let i = 0; i < work.length; i++) {
      if (suppStopRef.current) break;
      upd(i, { scanStatus: 'scanning' });
      const sv = await scanSupplier(work[i]); sc++; setSuppScanned(sc);
      if (sv.scanStatus === 'found') { ac++; fc += sv.files.length; setSuppWith(ac); setSuppTotal(fc); }
      upd(i, sv);
      if (sv.scanStatus !== 'found' || sv.files.length === 0) continue;
      if (suppStopRef.current) break;
      upd(i, { dlStatus: 'downloading' });
      const uf = [...sv.files]; let id = 0, ie = 0;
      for (let j = 0; j < uf.length; j++) {
        if (suppStopRef.current) break;
        uf[j] = { ...uf[j], status: 'downloading' }; upd(i, { files: [...uf] });
        const r = await downloadSuppFile(uf[j]);
        if (r === 'done') { uf[j] = { ...uf[j], status: 'done' }; dc++; id++; setSuppDone(dc); }
        else              { uf[j] = { ...uf[j], status: 'error'}; ec++; ie++; setSuppErr(ec); }
        upd(i, { files: [...uf] });
      }
      upd(i, { dlStatus: ie === 0 ? 'done' : id === 0 ? 'error' : 'partial', files: [...uf] });
    }
    setSuppRunning(false);
    message.success(`Finished. ${dc} downloaded, ${ec} errors.`);
  };

  const handleSuppPreview = async (row: SupplierRow) => {
    setSuppPreviewLoading(true);
    setSuppPreview({ ...row, scanStatus: 'scanning', files: [] });
    const result = await scanSupplier(row);
    setSuppPreview(result);
    setSuppPreviewLoading(false);
  };

  const suppColumns: ColumnsType<SupplierRow> = [
    { title: '#', key: 'seq', width: 50, render: (_,__,i) => <Text type="secondary" style={{ fontSize: 11 }}>{i+1}</Text> },
    { title: 'Supplier #', dataIndex: 'supplierNumber', width: 100, render: (v) => <Text code style={{ fontSize: 11 }}>{v}</Text> },
    { title: 'Supplier Name', dataIndex: 'supplierName', ellipsis: true, render: (v) => <Text style={{ fontSize: 12 }}>{v}</Text> },
    { title: 'Alternate Name', dataIndex: 'alternateName', ellipsis: true, render: (v) => <Text type="secondary" style={{ fontSize: 11 }}>{v || '—'}</Text> },
    { title: 'Scan', key: 'scan', width: 120, render: (_,r: SupplierRow) => ({
        idle:     <Tag style={{ fontSize: 11 }}>—</Tag>,
        scanning: <Tag color="processing" icon={<SyncOutlined spin />} style={{ fontSize: 11 }}>Scanning</Tag>,
        found:    <Tag color="green" icon={<CheckCircleOutlined />} style={{ fontSize: 11 }}>{r.files.length} file{r.files.length !== 1 ? 's' : ''}</Tag>,
        none:     <Tag color="default" style={{ fontSize: 11 }}>No attachments</Tag>,
        error:    <Tooltip title={r.scanError}><Tag color="red" icon={<CloseCircleOutlined />} style={{ fontSize: 11 }}>Error</Tag></Tooltip>,
      }[r.scanStatus] ?? null),
    },
    { title: 'Download', key: 'dl', width: 110, render: (_,r: SupplierRow) => ({
        idle: null,
        downloading: <Tag color="processing" icon={<SyncOutlined spin />} style={{ fontSize: 11 }}>Downloading</Tag>,
        done:        <Tag color="success"    icon={<CheckCircleOutlined />} style={{ fontSize: 11 }}>Done</Tag>,
        partial:     <Tag color="warning"    icon={<CloseCircleOutlined />} style={{ fontSize: 11 }}>Partial</Tag>,
        error:       <Tag color="error"      icon={<CloseCircleOutlined />} style={{ fontSize: 11 }}>Error</Tag>,
      }[r.dlStatus] ?? null),
    },
    { title: 'Files', key: 'files', render: (_,r: SupplierRow) => r.files.length === 0 ? null : (
        <Space size={2} wrap>{r.files.map((f,i) => {
          const col = f.status === 'done' ? '#1D7B4D' : f.status === 'error' ? '#D93025' : f.status === 'downloading' ? '#0572CE' : '#6B6B6B';
          return <Tooltip key={i} title={`${f.savedAs}${f.error ? ` — ${f.error}` : ''}`}><span style={{ color: col, fontSize: 16 }}>{fileIcon(f.mimeType ?? '', f.fileName)}</span></Tooltip>;
        })}</Space>
    )},
    { title: 'Preview', key: 'preview', width: 80, render: (_,r: SupplierRow) => (
        <Tooltip title="Preview attachments for this supplier">
          <Button size="small" icon={<EyeOutlined />} onClick={() => handleSuppPreview(r)} />
        </Tooltip>
    )},
  ];

  const suppPct = suppTotal > 0 ? Math.round((suppDone / suppTotal) * 100) : 0;

  // ═══════════════════════════════════════════════════════════════════════════
  // TAB 6 — AR RECEIPTS
  // ═══════════════════════════════════════════════════════════════════════════

  const [rcptForm] = Form.useForm();
  const [rcptRows, setRcptRows]               = useState<ReceiptAttRow[]>([]);
  const [rcptLoading, setRcptLoading]         = useState(false);
  const [rcptRunning, setRcptRunning]         = useState(false);
  const rcptStopRef                           = useRef(false);
  const [rcptScanned, setRcptScanned]         = useState(0);
  const [rcptWith, setRcptWith]               = useState(0);
  const [rcptTotal, setRcptTotal]             = useState(0);
  const [rcptDone, setRcptDone]               = useState(0);
  const [rcptErr, setRcptErr]                 = useState(0);
  const [rcptPreview, setRcptPreview]         = useState<ReceiptAttRow | null>(null);
  const [rcptPreviewLoading, setRcptPreviewLoading] = useState(false);

  const handleLoadReceipts = async () => {
    const vals = rcptForm.getFieldsValue();
    setRcptLoading(true); setRcptRows([]);
    setRcptScanned(0); setRcptWith(0); setRcptTotal(0); setRcptDone(0); setRcptErr(0);
    try {
      const q = new URLSearchParams({ limit: '2000' });
      if (vals.businessUnit)  q.set('business_unit',  vals.businessUnit);
      if (vals.receiptNumber) q.set('receipt_number',  vals.receiptNumber);
      if (vals.customerName)  q.set('customer_name',   vals.customerName);
      const res = await fetch(`${APEX_BASE}/ar/receipts?${q}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const mapped: ReceiptAttRow[] = (data.items || data || []).map((it: any, i: number) => ({
        key:               String(it.standard_receipt_id ?? it.StandardReceiptId ?? i),
        standardReceiptId: it.standard_receipt_id ?? it.StandardReceiptId ?? 0,
        receiptNumber:     it.receipt_number        ?? it.ReceiptNumber     ?? '',
        customerName:      it.customer_name         ?? it.CustomerName      ?? '',
        businessUnit:      it.business_unit         ?? it.BusinessUnit      ?? '',
        currency:          it.currency_code         ?? it.CurrencyCode      ?? '',
        scanStatus:        'idle',
        files:             [],
        dlStatus:          'idle',
      }));
      setRcptRows(mapped);
      message.success(`Loaded ${mapped.length} receipts`);
    } catch (e: any) { message.error(`Failed: ${e.message}`); }
    finally { setRcptLoading(false); }
  };

  const scanReceipt = useCallback(async (row: ReceiptAttRow): Promise<ReceiptAttRow> => {
    const upd = (p: Partial<ReceiptAttRow>): ReceiptAttRow => ({ ...row, ...p });
    try {
      const url = `${FUSION_BASE}/standardReceipts/${row.standardReceiptId}/child/attachments`;
      const res = await fetch(url, { headers: fusionHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data  = await res.json();
      const items: any[] = data.items || [];
      if (items.length === 0) return upd({ scanStatus: 'none' });
      const files: FusionFile[] = items.map((att: any) => {
        const links: any[] = att.links || [];
        const best = links.find((l: any) => l.rel === 'enclosure' && l.name === 'FileContents') ||
                     links.find((l: any) => l.rel === 'enclosure') ||
                     (att.FileUrl ? { href: FUSION_HOST + att.FileUrl } : null);
        const fileName = att.FileName || att.Title || 'attachment';
        return {
          fileName,
          savedAs:  `[${safeName(row.receiptNumber || String(row.standardReceiptId))}]_${safeName(fileName)}`,
          href:     best?.href ?? '',
          fileSize: att.UploadedFileLength ?? att.FileSize,
          mimeType: att.UploadedFileContentType ?? att.ContentType,
          status:   'pending',
        } as FusionFile;
      });
      return upd({ scanStatus: 'found', files });
    } catch (e: any) { return upd({ scanStatus: 'error', scanError: e.message }); }
  }, []);

  const downloadRcptFile = async (file: FusionFile): Promise<'done' | 'error'> => {
    if (!file.href) return 'error';
    try {
      const res = await fetch(file.href, { headers: { 'Authorization': `Basic ${fusionCreds()}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await saveBlob(await res.blob(), file.savedAs);
      return 'done';
    } catch { return 'error'; }
  };

  const handleRunReceipts = async () => {
    if (rcptRows.length === 0) { message.warning('Load receipts first'); return; }
    rcptStopRef.current = false; setRcptRunning(true);
    setRcptScanned(0); setRcptWith(0); setRcptTotal(0); setRcptDone(0); setRcptErr(0);
    let sc = 0, ac = 0, fc = 0, dc = 0, ec = 0;
    const work: ReceiptAttRow[] = rcptRows.map(r => ({ ...r, scanStatus: 'idle' as const, files: [], dlStatus: 'idle' as const }));
    const upd = (i: number, p: Partial<ReceiptAttRow>) => { work[i] = { ...work[i], ...p } as ReceiptAttRow; setRcptRows([...work]); };
    for (let i = 0; i < work.length; i++) {
      if (rcptStopRef.current) break;
      upd(i, { scanStatus: 'scanning' });
      const sv = await scanReceipt(work[i]); sc++; setRcptScanned(sc);
      if (sv.scanStatus === 'found') { ac++; fc += sv.files.length; setRcptWith(ac); setRcptTotal(fc); }
      upd(i, sv);
      if (sv.scanStatus !== 'found' || sv.files.length === 0) continue;
      if (rcptStopRef.current) break;
      upd(i, { dlStatus: 'downloading' });
      const uf = [...sv.files]; let id = 0, ie = 0;
      for (let j = 0; j < uf.length; j++) {
        if (rcptStopRef.current) break;
        uf[j] = { ...uf[j], status: 'downloading' }; upd(i, { files: [...uf] });
        const r = await downloadRcptFile(uf[j]);
        if (r === 'done') { uf[j] = { ...uf[j], status: 'done' }; dc++; id++; setRcptDone(dc); }
        else              { uf[j] = { ...uf[j], status: 'error'}; ec++; ie++; setRcptErr(ec); }
        upd(i, { files: [...uf] });
      }
      upd(i, { dlStatus: ie === 0 ? 'done' : id === 0 ? 'error' : 'partial', files: [...uf] });
    }
    setRcptRunning(false);
    message.success(`Finished. ${dc} downloaded, ${ec} errors.`);
  };

  const handleRcptPreview = async (row: ReceiptAttRow) => {
    setRcptPreviewLoading(true);
    setRcptPreview({ ...row, scanStatus: 'scanning', files: [] });
    const result = await scanReceipt(row);
    setRcptPreview(result);
    setRcptPreviewLoading(false);
  };

  const rcptColumns: ColumnsType<ReceiptAttRow> = [
    { title: '#', key: 'seq', width: 50, render: (_,__,i) => <Text type="secondary" style={{ fontSize: 11 }}>{i+1}</Text> },
    { title: 'Receipt #', dataIndex: 'receiptNumber', width: 160, render: (v) => <Text strong style={{ fontSize: 12 }}>{v}</Text> },
    { title: 'Customer', dataIndex: 'customerName', ellipsis: true, render: (v) => <Text style={{ fontSize: 12 }}>{v}</Text> },
    { title: 'BU', dataIndex: 'businessUnit', width: 140, ellipsis: true, render: (v) => <Text style={{ fontSize: 11 }}>{v}</Text> },
    { title: 'Currency', dataIndex: 'currency', width: 80, render: (v) => <Text style={{ fontSize: 12 }}>{v}</Text> },
    { title: 'Scan', key: 'scan', width: 120, render: (_,r: ReceiptAttRow) => ({
        idle:     <Tag style={{ fontSize: 11 }}>—</Tag>,
        scanning: <Tag color="processing" icon={<SyncOutlined spin />} style={{ fontSize: 11 }}>Scanning</Tag>,
        found:    <Tag color="green" icon={<CheckCircleOutlined />} style={{ fontSize: 11 }}>{r.files.length} file{r.files.length !== 1 ? 's' : ''}</Tag>,
        none:     <Tag color="default" style={{ fontSize: 11 }}>No attachments</Tag>,
        error:    <Tooltip title={r.scanError}><Tag color="red" icon={<CloseCircleOutlined />} style={{ fontSize: 11 }}>Error</Tag></Tooltip>,
      }[r.scanStatus] ?? null),
    },
    { title: 'Download', key: 'dl', width: 110, render: (_,r: ReceiptAttRow) => ({
        idle: null,
        downloading: <Tag color="processing" icon={<SyncOutlined spin />} style={{ fontSize: 11 }}>Downloading</Tag>,
        done:        <Tag color="success"    icon={<CheckCircleOutlined />} style={{ fontSize: 11 }}>Done</Tag>,
        partial:     <Tag color="warning"    icon={<CloseCircleOutlined />} style={{ fontSize: 11 }}>Partial</Tag>,
        error:       <Tag color="error"      icon={<CloseCircleOutlined />} style={{ fontSize: 11 }}>Error</Tag>,
      }[r.dlStatus] ?? null),
    },
    { title: 'Files', key: 'files', render: (_,r: ReceiptAttRow) => r.files.length === 0 ? null : (
        <Space size={2} wrap>{r.files.map((f,i) => {
          const col = f.status === 'done' ? '#1D7B4D' : f.status === 'error' ? '#D93025' : f.status === 'downloading' ? '#0572CE' : '#6B6B6B';
          return <Tooltip key={i} title={`${f.savedAs}${f.error ? ` — ${f.error}` : ''}`}><span style={{ color: col, fontSize: 16 }}>{fileIcon(f.mimeType ?? '', f.fileName)}</span></Tooltip>;
        })}</Space>
    )},
    { title: 'Preview', key: 'preview', width: 80, render: (_,r: ReceiptAttRow) => (
        <Tooltip title="Preview attachments for this receipt">
          <Button size="small" icon={<EyeOutlined />} onClick={() => handleRcptPreview(r)} />
        </Tooltip>
    )},
  ];

  const rcptPct = rcptTotal > 0 ? Math.round((rcptDone / rcptTotal) * 100) : 0;

  // ═══════════════════════════════════════════════════════════════════════════
  // TAB 7 — AR INVOICES
  // ═══════════════════════════════════════════════════════════════════════════

  const [arInvForm] = Form.useForm();
  const [arInvRows, setArInvRows]               = useState<ArInvRow[]>([]);
  const [arInvLoading, setArInvLoading]         = useState(false);
  const [arInvRunning, setArInvRunning]         = useState(false);
  const arInvStopRef                            = useRef(false);
  const [arInvScanned, setArInvScanned]         = useState(0);
  const [arInvWith, setArInvWith]               = useState(0);
  const [arInvTotal, setArInvTotal]             = useState(0);
  const [arInvDone, setArInvDone]               = useState(0);
  const [arInvErr, setArInvErr]                 = useState(0);
  const [arInvPreview, setArInvPreview]         = useState<ArInvRow | null>(null);
  const [arInvPreviewLoading, setArInvPreviewLoading] = useState(false);

  const handleLoadArInvoices = async () => {
    const vals = arInvForm.getFieldsValue();
    setArInvLoading(true); setArInvRows([]);
    setArInvScanned(0); setArInvWith(0); setArInvTotal(0); setArInvDone(0); setArInvErr(0);
    try {
      const allItems: any[] = [];
      let offset = 0;
      const pageSize = 500;
      while (true) {
        const q = new URLSearchParams({ limit: String(pageSize), offset: String(offset) });
        if (vals.businessUnit)      q.set('business_unit',    vals.businessUnit);
        if (vals.transactionNumber) q.set('transaction_number', vals.transactionNumber);
        if (vals.customerName)      q.set('bill_to_customer', vals.customerName);
        const res = await fetch(`${APEX_BASE}/ar/invoices?${q}`, { headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const items: any[] = data.items || [];
        allItems.push(...items);
        if (items.length < pageSize || !data.hasMore) break;
        offset += items.length;
      }
      const mapped: ArInvRow[] = allItems.map((it: any, i: number) => ({
        key:                   String(it.customer_transaction_id ?? it.CUSTOMER_TRANSACTION_ID ?? i),
        customerTransactionId: Number(it.customer_transaction_id ?? it.CUSTOMER_TRANSACTION_ID ?? 0),
        transactionNumber:     it.transaction_number    ?? it.TRANSACTION_NUMBER    ?? '',
        customerName:          it.bill_to_customer_name ?? it.BILL_TO_CUSTOMER_NAME ?? '',
        businessUnit:          it.business_unit         ?? it.BUSINESS_UNIT         ?? '',
        transactionDate:       it.transaction_date      ?? it.TRANSACTION_DATE      ?? '',
        currency:              it.invoice_currency_code ?? it.INVOICE_CURRENCY_CODE ?? '',
        scanStatus:            'idle',
        files:                 [],
        dlStatus:              'idle',
      }));
      setArInvRows(mapped);
      message.success(`Loaded ${mapped.length} AR invoices`);
    } catch (e: any) { message.error(`Failed: ${e.message}`); }
    finally { setArInvLoading(false); }
  };

  const scanArInvoice = useCallback(async (row: ArInvRow): Promise<ArInvRow> => {
    const upd = (p: Partial<ArInvRow>): ArInvRow => ({ ...row, ...p });
    try {
      const url = `${FUSION_BASE}/receivablesInvoices/${row.customerTransactionId}/child/attachments`;
      const res = await fetch(url, { headers: fusionHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data  = await res.json();
      const items: any[] = data.items || [];
      if (items.length === 0) return upd({ scanStatus: 'none' });
      const files: FusionFile[] = items.map((att: any) => {
        const links: any[] = att.links || [];
        const best = links.find((l: any) => l.rel === 'enclosure' && l.name === 'FileContents') ||
                     links.find((l: any) => l.rel === 'enclosure') ||
                     (att.FileUrl ? { href: FUSION_HOST + att.FileUrl } : null);
        const fileName = att.FileName || att.Title || 'attachment';
        return {
          fileName,
          savedAs:  `[${safeName(row.transactionNumber || String(row.customerTransactionId))}]_${safeName(fileName)}`,
          href:     best?.href ?? '',
          fileSize: att.UploadedFileLength ?? att.FileSize,
          mimeType: att.UploadedFileContentType ?? att.ContentType,
          status:   'pending',
        } as FusionFile;
      });
      return upd({ scanStatus: 'found', files });
    } catch (e: any) { return upd({ scanStatus: 'error', scanError: e.message }); }
  }, []);

  const downloadArInvFile = async (file: FusionFile): Promise<'done' | 'error'> => {
    if (!file.href) return 'error';
    try {
      const res = await fetch(file.href, { headers: { 'Authorization': `Basic ${fusionCreds()}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await saveBlob(await res.blob(), file.savedAs);
      return 'done';
    } catch { return 'error'; }
  };

  const handleRunArInvoices = async () => {
    if (arInvRows.length === 0) { message.warning('Load invoices first'); return; }
    arInvStopRef.current = false; setArInvRunning(true);
    setArInvScanned(0); setArInvWith(0); setArInvTotal(0); setArInvDone(0); setArInvErr(0);
    let sc = 0, ac = 0, fc = 0, dc = 0, ec = 0;
    const work: ArInvRow[] = arInvRows.map(r => ({ ...r, scanStatus: 'idle' as const, files: [], dlStatus: 'idle' as const }));
    const upd = (i: number, p: Partial<ArInvRow>) => { work[i] = { ...work[i], ...p } as ArInvRow; setArInvRows([...work]); };
    for (let i = 0; i < work.length; i++) {
      if (arInvStopRef.current) break;
      upd(i, { scanStatus: 'scanning' });
      const sv = await scanArInvoice(work[i]); sc++; setArInvScanned(sc);
      if (sv.scanStatus === 'found') { ac++; fc += sv.files.length; setArInvWith(ac); setArInvTotal(fc); }
      upd(i, sv);
      if (sv.scanStatus !== 'found' || sv.files.length === 0) continue;
      if (arInvStopRef.current) break;
      upd(i, { dlStatus: 'downloading' });
      const uf = [...sv.files]; let id = 0, ie = 0;
      for (let j = 0; j < uf.length; j++) {
        if (arInvStopRef.current) break;
        uf[j] = { ...uf[j], status: 'downloading' }; upd(i, { files: [...uf] });
        const r = await downloadArInvFile(uf[j]);
        if (r === 'done') { uf[j] = { ...uf[j], status: 'done' }; dc++; id++; setArInvDone(dc); }
        else              { uf[j] = { ...uf[j], status: 'error'}; ec++; ie++; setArInvErr(ec); }
        upd(i, { files: [...uf] });
      }
      upd(i, { dlStatus: ie === 0 ? 'done' : id === 0 ? 'error' : 'partial', files: [...uf] });
    }
    setArInvRunning(false);
    message.success(`Finished. ${dc} downloaded, ${ec} errors.`);
  };

  const handleArInvPreview = async (row: ArInvRow) => {
    setArInvPreviewLoading(true);
    setArInvPreview({ ...row, scanStatus: 'scanning', files: [] });
    const result = await scanArInvoice(row);
    setArInvPreview(result);
    setArInvPreviewLoading(false);
  };

  const arInvColumns: ColumnsType<ArInvRow> = [
    { title: '#', key: 'seq', width: 50, render: (_,__,i) => <Text type="secondary" style={{ fontSize: 11 }}>{i+1}</Text> },
    { title: 'Txn #', dataIndex: 'transactionNumber', width: 160, render: (v) => <Text strong style={{ fontSize: 12 }}>{v}</Text> },
    { title: 'Customer', dataIndex: 'customerName', ellipsis: true, render: (v) => <Text style={{ fontSize: 12 }}>{v}</Text> },
    { title: 'BU', dataIndex: 'businessUnit', width: 140, ellipsis: true, render: (v) => <Text style={{ fontSize: 11 }}>{v}</Text> },
    { title: 'Date', dataIndex: 'transactionDate', width: 100, render: (v) => <Text style={{ fontSize: 11 }}>{v ? String(v).substring(0, 10) : '—'}</Text> },
    { title: 'Currency', dataIndex: 'currency', width: 80, render: (v) => <Text style={{ fontSize: 12 }}>{v}</Text> },
    { title: 'Scan', key: 'scan', width: 120, render: (_,r: ArInvRow) => ({
        idle:     <Tag style={{ fontSize: 11 }}>—</Tag>,
        scanning: <Tag color="processing" icon={<SyncOutlined spin />} style={{ fontSize: 11 }}>Scanning</Tag>,
        found:    <Tag color="green" icon={<CheckCircleOutlined />} style={{ fontSize: 11 }}>{r.files.length} file{r.files.length !== 1 ? 's' : ''}</Tag>,
        none:     <Tag color="default" style={{ fontSize: 11 }}>No attachments</Tag>,
        error:    <Tooltip title={r.scanError}><Tag color="red" icon={<CloseCircleOutlined />} style={{ fontSize: 11 }}>Error</Tag></Tooltip>,
      }[r.scanStatus] ?? null),
    },
    { title: 'Download', key: 'dl', width: 110, render: (_,r: ArInvRow) => ({
        idle: null,
        downloading: <Tag color="processing" icon={<SyncOutlined spin />} style={{ fontSize: 11 }}>Downloading</Tag>,
        done:        <Tag color="success"    icon={<CheckCircleOutlined />} style={{ fontSize: 11 }}>Done</Tag>,
        partial:     <Tag color="warning"    icon={<CloseCircleOutlined />} style={{ fontSize: 11 }}>Partial</Tag>,
        error:       <Tag color="error"      icon={<CloseCircleOutlined />} style={{ fontSize: 11 }}>Error</Tag>,
      }[r.dlStatus] ?? null),
    },
    { title: 'Files', key: 'files', render: (_,r: ArInvRow) => r.files.length === 0 ? null : (
        <Space size={2} wrap>{r.files.map((f,i) => {
          const col = f.status === 'done' ? '#1D7B4D' : f.status === 'error' ? '#D93025' : f.status === 'downloading' ? '#0572CE' : '#6B6B6B';
          return <Tooltip key={i} title={`${f.savedAs}${f.error ? ` — ${f.error}` : ''}`}><span style={{ color: col, fontSize: 16 }}>{fileIcon(f.mimeType ?? '', f.fileName)}</span></Tooltip>;
        })}</Space>
    )},
    { title: 'Preview', key: 'preview', width: 80, render: (_,r: ArInvRow) => (
        <Tooltip title="Preview attachments for this invoice">
          <Button size="small" icon={<EyeOutlined />} onClick={() => handleArInvPreview(r)} />
        </Tooltip>
    )},
  ];

  const arInvPct = arInvTotal > 0 ? Math.round((arInvDone / arInvTotal) * 100) : 0;

  // ── Placeholder tab ───────────────────────────────────────────────────────
  const comingSoon = (label: string) => (
    <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>
      <CloudOutlined style={{ fontSize: 48, marginBottom: 12 }} />
      <div style={{ fontSize: 16 }}>{label} — Coming Soon</div>
      <div style={{ fontSize: 12, marginTop: 8 }}>This tab will follow the same download framework as Invoices and Journal Batches.</div>
    </div>
  );

  // ── Folder controls (shared, rendered inside each tab) ───────────────────
  const folderControls = (
    <Space>
      <Button icon={<FolderOpenOutlined />} onClick={chooseFolder}>
        {folderName ? `Folder: ${folderName}` : 'Choose Save Folder'}
      </Button>
      {!folderName && <Text type="secondary" style={{ fontSize: 12 }}>No folder — files will go to Downloads</Text>}
    </Space>
  );

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Layout style={{ minHeight: '100vh', background: '#f7f7f7' }}>
      <Content style={{ padding: '16px 20px' }}>

        <Breadcrumb style={{ marginBottom: 12 }} items={[
          { title: <Link to="/"><HomeOutlined /></Link> },
          { title: <Link to="/ap">Payables</Link> },
          { title: 'Attachments' },
        ]} />

        <Space style={{ marginBottom: 16 }} align="center">
          <CloudOutlined style={{ fontSize: 22, color: '#722ed1' }} />
          <Title level={4} style={{ margin: 0 }}>Download Attachments from Oracle Fusion</Title>
        </Space>

        <Tabs
          type="card"
          size="small"
          items={[
            // ── Tab 1: Invoices ────────────────────────────────────────────
            {
              key: 'invoices',
              label: <span><FileTextOutlined style={{ marginRight: 6 }} />Invoices</span>,
              children: (
                <div style={{ paddingTop: 8 }}>
                  <Card size="small" style={{ marginBottom: 12, borderRadius: 8 }}>
                    <Form form={form} layout="inline" size="small" onFinish={handleSearch}>
                      <Form.Item name="businessUnit" label="Business Unit">
                        <Input style={{ width: 220 }} placeholder="Filter by BU" allowClear />
                      </Form.Item>
                      <Form.Item name="supplier" label="Supplier">
                        <Input style={{ width: 200 }} placeholder="Supplier name" allowClear />
                      </Form.Item>
                      <Form.Item name="invoiceNumber" label="Invoice #">
                        <Input style={{ width: 160 }} placeholder="Invoice number" allowClear />
                      </Form.Item>
                      <Form.Item>
                        <Button type="primary" icon={<SearchOutlined />} htmlType="submit" loading={loading}>
                          Load Invoices
                        </Button>
                      </Form.Item>
                    </Form>
                  </Card>

                  <Row gutter={12} style={{ marginBottom: 12 }}>
                    {[
                      { title: 'Loaded',           value: rows.length,  color: undefined },
                      { title: 'Scanned',          value: scanned,      color: '#0572CE' },
                      { title: 'With Attachments', value: withAttach,   color: '#722ed1' },
                      { title: 'Total Files',      value: totalFiles,   color: undefined },
                      { title: 'Downloaded',       value: doneFiles,    color: '#1D7B4D' },
                      { title: 'Errors',           value: errorFiles,   color: '#D93025' },
                    ].map(s => (
                      <Col span={4} key={s.title}>
                        <Card size="small" style={{ borderRadius: 8, textAlign: 'center' }}>
                          <Statistic title={s.title} value={s.value} valueStyle={{ fontSize: 22, color: s.color }} />
                        </Card>
                      </Col>
                    ))}
                  </Row>

                  {(running || doneFiles > 0 || errorFiles > 0) && (
                    <Card size="small" style={{ marginBottom: 12, borderRadius: 8 }}>
                      <Space direction="vertical" style={{ width: '100%' }} size={4}>
                        <Space>
                          <Text strong style={{ fontSize: 13 }}>{running ? 'Downloading…' : 'Complete'}</Text>
                          <Text type="secondary" style={{ fontSize: 12 }}>{doneFiles} of {totalFiles} files{errorFiles > 0 && ` · ${errorFiles} error${errorFiles > 1 ? 's' : ''}`}</Text>
                        </Space>
                        <Progress percent={invPct} strokeColor={{ '0%': '#722ed1', '100%': '#1D7B4D' }} status={running ? 'active' : errorFiles > 0 ? 'exception' : 'success'} />
                      </Space>
                    </Card>
                  )}

                  <Card size="small" style={{ marginBottom: 12, borderRadius: 8 }}>
                    <Space wrap>
                      {folderControls}
                      <Divider type="vertical" />
                      <Button type="primary" icon={<DownloadOutlined />} onClick={handleRun} loading={running} disabled={rows.length === 0} style={{ background: '#722ed1', borderColor: '#722ed1' }}>
                        Scan &amp; Download All
                      </Button>
                      {running && <Button danger icon={<StopOutlined />} onClick={() => { stopRef.current = true; }}>Stop</Button>}
                      {!running && rows.length > 0 && <Button icon={<ReloadOutlined />} onClick={handleSearch}>Reset</Button>}
                    </Space>
                  </Card>

                  {!folderName && rows.length > 0 && (
                    <Alert type="info" showIcon style={{ marginBottom: 12, borderRadius: 8 }}
                      message='Click "Choose Save Folder" to save directly to a local path.'
                      description="Files are named [InvoiceNumber]_FileName. Without a folder selection, files go to your browser's Downloads folder."
                    />
                  )}

                  <Card size="small" style={{ borderRadius: 8 }}
                    title={<Space><Badge count={rows.length} style={{ backgroundColor: '#722ed1' }} /><Text strong>Invoices</Text></Space>}
                  >
                    <Table<InvoiceRow>
                      dataSource={rows} columns={invColumns} rowKey="key" size="small" loading={loading}
                      pagination={{ pageSize: 50, size: 'small', showSizeChanger: true, showTotal: t => `${t} invoices` }}
                      scroll={{ y: 500 }}
                      rowClassName={r => r.dlStatus === 'done' ? 'row-done' : r.dlStatus === 'error' ? 'row-error' : r.scanStatus === 'found' ? 'row-found' : ''}
                    />
                  </Card>
                </div>
              ),
            },

            // ── Tab 2: Journal Batches ─────────────────────────────────────
            {
              key: 'journalBatches',
              label: <span><BankOutlined style={{ marginRight: 6 }} />Journal Batches</span>,
              children: (
                <div style={{ paddingTop: 8 }}>
                  <Card size="small" style={{ marginBottom: 12, borderRadius: 8 }}>
                    <Form form={batchForm} layout="inline" size="small" onFinish={handleLoadBatches}
                      initialValues={{ fetchLimit: 0 }}>
                      <Form.Item name="periodName" label="Period">
                        <Input style={{ width: 130 }} placeholder='e.g. May-24' allowClear />
                      </Form.Item>
                      <Form.Item name="batchName" label="Batch Name">
                        <Input style={{ width: 200 }} placeholder="Filter (client-side)" allowClear />
                      </Form.Item>
                      <Form.Item name="fetchLimit" label="Fetch">
                        <select style={{ height: 24, fontSize: 12, border: '1px solid #d9d9d9', borderRadius: 4, padding: '0 6px', cursor: 'pointer' }}>
                          <option value={25}>25 — Test</option>
                          <option value={100}>100</option>
                          <option value={500}>500</option>
                          <option value={0}>All pages</option>
                        </select>
                      </Form.Item>
                      <Form.Item>
                        <Button type="primary" icon={<SearchOutlined />} htmlType="submit" loading={batchLoading}>
                          Load Batches
                        </Button>
                      </Form.Item>
                    </Form>

                    {/* Live fetch progress */}
                    {batchLoading && fetchProgress && (
                      <div style={{ marginTop: 10, padding: '6px 10px', background: '#e6f4ff', borderRadius: 6, border: '1px solid #91caff', fontSize: 12 }}>
                        <Space>
                          <SyncOutlined spin style={{ color: '#1677ff' }} />
                          <Text style={{ fontSize: 12 }}>
                            <strong>Page {fetchProgress.page}</strong>
                            {' · '}
                            <strong>{fetchProgress.fetched}</strong> batches fetched
                            {' · '}
                            {fetchProgress.status}
                          </Text>
                        </Space>
                      </div>
                    )}
                    {!batchLoading && fetchProgress && fetchProgress.fetched > 0 && (
                      <div style={{ marginTop: 10, padding: '6px 10px', background: '#f6ffed', borderRadius: 6, border: '1px solid #b7eb8f', fontSize: 12 }}>
                        <Space>
                          <CheckCircleOutlined style={{ color: '#52c41a' }} />
                          <Text style={{ fontSize: 12 }}>
                            Fetched <strong>{fetchProgress.fetched}</strong> batches in <strong>{fetchProgress.page}</strong> page{fetchProgress.page !== 1 ? 's' : ''} from Oracle Fusion
                          </Text>
                        </Space>
                      </div>
                    )}
                  </Card>

                  <Row gutter={12} style={{ marginBottom: 12 }}>
                    {[
                      { title: 'Loaded',           value: batchRows.length, color: undefined },
                      { title: 'Scanned',          value: batchScanned,     color: '#0572CE' },
                      { title: 'With Attachments', value: batchWith,        color: '#722ed1' },
                      { title: 'Total Files',      value: batchTotal,       color: undefined },
                      { title: 'Downloaded',       value: batchDone,        color: '#1D7B4D' },
                      { title: 'Errors',           value: batchErr,         color: '#D93025' },
                    ].map(s => (
                      <Col span={4} key={s.title}>
                        <Card size="small" style={{ borderRadius: 8, textAlign: 'center' }}>
                          <Statistic title={s.title} value={s.value} valueStyle={{ fontSize: 22, color: s.color }} />
                        </Card>
                      </Col>
                    ))}
                  </Row>

                  {(batchRunning || batchDone > 0 || batchErr > 0) && (
                    <Card size="small" style={{ marginBottom: 12, borderRadius: 8 }}>
                      <Space direction="vertical" style={{ width: '100%' }} size={4}>
                        <Space>
                          <Text strong style={{ fontSize: 13 }}>{batchRunning ? 'Downloading…' : 'Complete'}</Text>
                          <Text type="secondary" style={{ fontSize: 12 }}>{batchDone} of {batchTotal} files{batchErr > 0 && ` · ${batchErr} error${batchErr > 1 ? 's' : ''}`}</Text>
                        </Space>
                        <Progress percent={batchPct} strokeColor={{ '0%': '#1677ff', '100%': '#1D7B4D' }} status={batchRunning ? 'active' : batchErr > 0 ? 'exception' : 'success'} />
                      </Space>
                    </Card>
                  )}

                  <Card size="small" style={{ marginBottom: 12, borderRadius: 8 }}>
                    <Space wrap>
                      {folderControls}
                      <Divider type="vertical" />
                      <Button type="primary" icon={<DownloadOutlined />} onClick={handleRunBatches} loading={batchRunning} disabled={batchRows.length === 0} style={{ background: '#1677ff', borderColor: '#1677ff' }}>
                        Scan &amp; Download All
                      </Button>
                      {batchRunning && <Button danger icon={<StopOutlined />} onClick={() => { batchStopRef.current = true; }}>Stop</Button>}
                      {!batchRunning && batchRows.length > 0 && <Button icon={<ReloadOutlined />} onClick={handleLoadBatches}>Reset</Button>}
                    </Space>
                  </Card>

                  {!folderName && batchRows.length > 0 && (
                    <Alert type="info" showIcon style={{ marginBottom: 12, borderRadius: 8 }}
                      message='Click "Choose Save Folder" to save directly to a local path.'
                      description='Files are named [BatchId]_FileName. Use the Preview button (eye icon) on any row to check attachments before running the full download.'
                    />
                  )}

                  <Card size="small" style={{ borderRadius: 8 }}
                    title={<Space><Badge count={batchRows.length} style={{ backgroundColor: '#1677ff' }} /><Text strong>Journal Batches</Text></Space>}
                  >
                    <Table<BatchRow>
                      dataSource={batchRows} columns={batchColumns} rowKey="key" size="small" loading={batchLoading}
                      pagination={{ pageSize: 50, size: 'small', showSizeChanger: true, showTotal: t => `${t} batches` }}
                      scroll={{ y: 500 }}
                      rowClassName={r => r.dlStatus === 'done' ? 'row-done' : r.dlStatus === 'error' ? 'row-error' : r.scanStatus === 'found' ? 'row-found' : ''}
                    />
                  </Card>

                  {/* Preview modal */}
                  <Modal
                    open={previewBatch !== null}
                    title={previewBatch ? `Attachments — Batch ${previewBatch.jeBatchId} · ${previewBatch.batchName}` : ''}
                    onCancel={() => setPreviewBatch(null)}
                    footer={[
                      previewBatch?.scanStatus === 'found' && previewBatch.files.length > 0 && (
                        <Button key="dl" type="primary" icon={<DownloadOutlined />}
                          onClick={async () => {
                            if (!previewBatch) return;
                            for (const f of previewBatch.files) await downloadBatchFile(f);
                            message.success(`Downloaded ${previewBatch.files.length} file(s)`);
                            setPreviewBatch(null);
                          }}
                        >
                          Download All ({previewBatch.files.length})
                        </Button>
                      ),
                      <Button key="close" onClick={() => setPreviewBatch(null)}>Close</Button>,
                    ]}
                    width={640}
                  >
                    {previewLoading ? (
                      <div style={{ textAlign: 'center', padding: 32 }}><SyncOutlined spin style={{ fontSize: 32, color: '#1677ff' }} /></div>
                    ) : previewBatch?.scanStatus === 'none' ? (
                      <Alert type="info" message="No attachments found for this batch." />
                    ) : previewBatch?.scanStatus === 'error' ? (
                      <Alert type="error" message={`Error: ${previewBatch.scanError}`} />
                    ) : (
                      <Table
                        dataSource={(previewBatch?.files || []).map((f, i) => ({ ...f, key: i }))}
                        size="small"
                        pagination={false}
                        columns={[
                          { title: 'File', dataIndex: 'fileName', render: (v, r: any) => <Space>{fileIcon(r.mimeType ?? '', v)}<Text style={{ fontSize: 12 }}>{v}</Text></Space> },
                          { title: 'Saved As', dataIndex: 'savedAs', ellipsis: true, render: (v) => <Text code style={{ fontSize: 11 }}>{v}</Text> },
                          { title: 'Size', dataIndex: 'fileSize', width: 90, render: (v) => v ? <Text style={{ fontSize: 11 }}>{(v / 1024).toFixed(0)} KB</Text> : '—' },
                          { title: 'Download', key: 'dl', width: 90, render: (_,r: any) => (
                              <Button size="small" icon={<DownloadOutlined />}
                                onClick={async () => {
                                  await downloadBatchFile(r);
                                  message.success(`Downloaded ${r.fileName}`);
                                }}
                              >
                                Save
                              </Button>
                          )},
                        ]}
                      />
                    )}
                  </Modal>
                </div>
              ),
            },

            // ── Tab 3: Payments (placeholder) ──────────────────────────────
            {
              key: 'payments',
              label: <span><SwapOutlined style={{ marginRight: 6 }} />Payments</span>,
              children: comingSoon('Payments'),
            },

            // ── Tab 4: External Transactions (placeholder) ─────────────────
            {
              key: 'externalTx',
              label: <span><FileOutlined style={{ marginRight: 6 }} />External Transactions</span>,
              children: comingSoon('External Transactions'),
            },

            // ── Tab 5: Suppliers ───────────────────────────────────────────
            {
              key: 'suppliers',
              label: <span><UserOutlined style={{ marginRight: 6 }} />Suppliers</span>,
              children: (
                <div style={{ paddingTop: 8 }}>
                  <Card size="small" style={{ marginBottom: 12, borderRadius: 8 }}>
                    <Form form={supplierForm} layout="inline" size="small" onFinish={handleLoadSuppliers}
                      initialValues={{ fetchLimit: 0 }}>
                      <Form.Item name="supplierName" label="Supplier Name">
                        <Input style={{ width: 220 }} placeholder="Starts with (Fusion query)" allowClear />
                      </Form.Item>
                      <Form.Item name="supplierNameFilter" label="Filter">
                        <Input style={{ width: 180 }} placeholder="Contains (client-side)" allowClear />
                      </Form.Item>
                      <Form.Item name="fetchLimit" label="Fetch">
                        <select style={{ height: 24, fontSize: 12, border: '1px solid #d9d9d9', borderRadius: 4, padding: '0 6px', cursor: 'pointer' }}>
                          <option value={25}>25 — Test</option>
                          <option value={100}>100</option>
                          <option value={500}>500</option>
                          <option value={0}>All pages</option>
                        </select>
                      </Form.Item>
                      <Form.Item>
                        <Button type="primary" icon={<SearchOutlined />} htmlType="submit" loading={suppLoading}>
                          Load Suppliers
                        </Button>
                      </Form.Item>
                    </Form>

                    {suppLoading && suppFetchProgress && (
                      <div style={{ marginTop: 10, padding: '6px 10px', background: '#e6f4ff', borderRadius: 6, border: '1px solid #91caff', fontSize: 12 }}>
                        <Space>
                          <SyncOutlined spin style={{ color: '#1677ff' }} />
                          <Text style={{ fontSize: 12 }}>
                            <strong>Page {suppFetchProgress.page}</strong>
                            {' · '}
                            <strong>{suppFetchProgress.fetched}</strong> suppliers fetched
                            {' · '}
                            {suppFetchProgress.status}
                          </Text>
                        </Space>
                      </div>
                    )}
                    {!suppLoading && suppFetchProgress && suppFetchProgress.fetched > 0 && (
                      <div style={{ marginTop: 10, padding: '6px 10px', background: '#f6ffed', borderRadius: 6, border: '1px solid #b7eb8f', fontSize: 12 }}>
                        <Space>
                          <CheckCircleOutlined style={{ color: '#52c41a' }} />
                          <Text style={{ fontSize: 12 }}>
                            Fetched <strong>{suppFetchProgress.fetched}</strong> suppliers in <strong>{suppFetchProgress.page}</strong> page{suppFetchProgress.page !== 1 ? 's' : ''} from Oracle Fusion
                          </Text>
                        </Space>
                      </div>
                    )}
                  </Card>

                  <Row gutter={12} style={{ marginBottom: 12 }}>
                    {[
                      { title: 'Loaded',           value: suppRows.length, color: undefined },
                      { title: 'Scanned',          value: suppScanned,     color: '#0572CE' },
                      { title: 'With Attachments', value: suppWith,        color: '#722ed1' },
                      { title: 'Total Files',      value: suppTotal,       color: undefined },
                      { title: 'Downloaded',       value: suppDone,        color: '#1D7B4D' },
                      { title: 'Errors',           value: suppErr,         color: '#D93025' },
                    ].map(s => (
                      <Col span={4} key={s.title}>
                        <Card size="small" style={{ borderRadius: 8, textAlign: 'center' }}>
                          <Statistic title={s.title} value={s.value} valueStyle={{ fontSize: 22, color: s.color }} />
                        </Card>
                      </Col>
                    ))}
                  </Row>

                  {(suppRunning || suppDone > 0 || suppErr > 0) && (
                    <Card size="small" style={{ marginBottom: 12, borderRadius: 8 }}>
                      <Space direction="vertical" style={{ width: '100%' }} size={4}>
                        <Space>
                          <Text strong style={{ fontSize: 13 }}>{suppRunning ? 'Downloading…' : 'Complete'}</Text>
                          <Text type="secondary" style={{ fontSize: 12 }}>{suppDone} of {suppTotal} files{suppErr > 0 && ` · ${suppErr} error${suppErr > 1 ? 's' : ''}`}</Text>
                        </Space>
                        <Progress percent={suppPct} strokeColor={{ '0%': '#fa8c16', '100%': '#1D7B4D' }} status={suppRunning ? 'active' : suppErr > 0 ? 'exception' : 'success'} />
                      </Space>
                    </Card>
                  )}

                  <Card size="small" style={{ marginBottom: 12, borderRadius: 8 }}>
                    <Space wrap>
                      {folderControls}
                      <Divider type="vertical" />
                      <Button type="primary" icon={<DownloadOutlined />} onClick={handleRunSuppliers} loading={suppRunning} disabled={suppRows.length === 0} style={{ background: '#fa8c16', borderColor: '#fa8c16' }}>
                        Scan &amp; Download All
                      </Button>
                      {suppRunning && <Button danger icon={<StopOutlined />} onClick={() => { suppStopRef.current = true; }}>Stop</Button>}
                      {!suppRunning && suppRows.length > 0 && <Button icon={<ReloadOutlined />} onClick={handleLoadSuppliers}>Reset</Button>}
                    </Space>
                  </Card>

                  {!folderName && suppRows.length > 0 && (
                    <Alert type="info" showIcon style={{ marginBottom: 12, borderRadius: 8 }}
                      message='Click "Choose Save Folder" to save directly to a local path.'
                      description='Files are named [SupplierNumber]_FileName. Use the Preview button to check attachments for a single supplier first.'
                    />
                  )}

                  <Card size="small" style={{ borderRadius: 8 }}
                    title={<Space><Badge count={suppRows.length} style={{ backgroundColor: '#fa8c16' }} /><Text strong>Suppliers</Text></Space>}
                  >
                    <Table<SupplierRow>
                      dataSource={suppRows} columns={suppColumns} rowKey="key" size="small" loading={suppLoading}
                      pagination={{ pageSize: 50, size: 'small', showSizeChanger: true, showTotal: t => `${t} suppliers` }}
                      scroll={{ y: 500 }}
                      rowClassName={r => r.dlStatus === 'done' ? 'row-done' : r.dlStatus === 'error' ? 'row-error' : r.scanStatus === 'found' ? 'row-found' : ''}
                    />
                  </Card>

                  {/* Preview modal */}
                  <Modal
                    open={suppPreview !== null}
                    title={suppPreview ? `Attachments — ${suppPreview.supplierNumber} · ${suppPreview.supplierName}` : ''}
                    onCancel={() => setSuppPreview(null)}
                    footer={[
                      suppPreview?.scanStatus === 'found' && suppPreview.files.length > 0 && (
                        <Button key="dl" type="primary" icon={<DownloadOutlined />}
                          onClick={async () => {
                            if (!suppPreview) return;
                            for (const f of suppPreview.files) await downloadSuppFile(f);
                            message.success(`Downloaded ${suppPreview.files.length} file(s)`);
                            setSuppPreview(null);
                          }}
                        >
                          Download All ({suppPreview.files.length})
                        </Button>
                      ),
                      <Button key="close" onClick={() => setSuppPreview(null)}>Close</Button>,
                    ]}
                    width={640}
                  >
                    {suppPreviewLoading ? (
                      <div style={{ textAlign: 'center', padding: 32 }}><SyncOutlined spin style={{ fontSize: 32, color: '#fa8c16' }} /></div>
                    ) : suppPreview?.scanStatus === 'none' ? (
                      <Alert type="info" message="No attachments found for this supplier." />
                    ) : suppPreview?.scanStatus === 'error' ? (
                      <Alert type="error" message={`Error: ${suppPreview.scanError}`} />
                    ) : (
                      <Table
                        dataSource={(suppPreview?.files || []).map((f, i) => ({ ...f, key: i }))}
                        size="small" pagination={false}
                        columns={[
                          { title: 'File', dataIndex: 'fileName', render: (v, r: any) => <Space>{fileIcon(r.mimeType ?? '', v)}<Text style={{ fontSize: 12 }}>{v}</Text></Space> },
                          { title: 'Saved As', dataIndex: 'savedAs', ellipsis: true, render: (v) => <Text code style={{ fontSize: 11 }}>{v}</Text> },
                          { title: 'Size', dataIndex: 'fileSize', width: 90, render: (v) => v ? <Text style={{ fontSize: 11 }}>{(v / 1024).toFixed(0)} KB</Text> : '—' },
                          { title: 'Download', key: 'dl', width: 90, render: (_,r: any) => (
                              <Button size="small" icon={<DownloadOutlined />}
                                onClick={async () => { await downloadSuppFile(r); message.success(`Downloaded ${r.fileName}`); }}
                              >Save</Button>
                          )},
                        ]}
                      />
                    )}
                  </Modal>
                </div>
              ),
            },

            // ── Tab 6: AR Receipts ─────────────────────────────────────────
            {
              key: 'arReceipts',
              label: <span><SwapOutlined style={{ marginRight: 6 }} />AR Receipts</span>,
              children: (
                <div style={{ paddingTop: 8 }}>
                  <Card size="small" style={{ marginBottom: 12, borderRadius: 8 }}>
                    <Form form={rcptForm} layout="inline" size="small" onFinish={handleLoadReceipts}>
                      <Form.Item name="businessUnit" label="Business Unit">
                        <Input style={{ width: 220 }} placeholder="Filter by BU" allowClear />
                      </Form.Item>
                      <Form.Item name="receiptNumber" label="Receipt #">
                        <Input style={{ width: 180 }} placeholder="Receipt number" allowClear />
                      </Form.Item>
                      <Form.Item name="customerName" label="Customer">
                        <Input style={{ width: 180 }} placeholder="Customer name" allowClear />
                      </Form.Item>
                      <Form.Item>
                        <Button type="primary" icon={<SearchOutlined />} htmlType="submit" loading={rcptLoading}>
                          Load Receipts
                        </Button>
                      </Form.Item>
                    </Form>
                  </Card>

                  <Row gutter={12} style={{ marginBottom: 12 }}>
                    {[
                      { title: 'Loaded',           value: rcptRows.length, color: undefined },
                      { title: 'Scanned',          value: rcptScanned,     color: '#0572CE' },
                      { title: 'With Attachments', value: rcptWith,        color: '#722ed1' },
                      { title: 'Total Files',      value: rcptTotal,       color: undefined },
                      { title: 'Downloaded',       value: rcptDone,        color: '#1D7B4D' },
                      { title: 'Errors',           value: rcptErr,         color: '#D93025' },
                    ].map(s => (
                      <Col span={4} key={s.title}>
                        <Card size="small" style={{ borderRadius: 8, textAlign: 'center' }}>
                          <Statistic title={s.title} value={s.value} valueStyle={{ fontSize: 22, color: s.color }} />
                        </Card>
                      </Col>
                    ))}
                  </Row>

                  {(rcptRunning || rcptDone > 0 || rcptErr > 0) && (
                    <Card size="small" style={{ marginBottom: 12, borderRadius: 8 }}>
                      <Space direction="vertical" style={{ width: '100%' }} size={4}>
                        <Space>
                          <Text strong style={{ fontSize: 13 }}>{rcptRunning ? 'Downloading…' : 'Complete'}</Text>
                          <Text type="secondary" style={{ fontSize: 12 }}>{rcptDone} of {rcptTotal} files{rcptErr > 0 && ` · ${rcptErr} error${rcptErr > 1 ? 's' : ''}`}</Text>
                        </Space>
                        <Progress percent={rcptPct} strokeColor={{ '0%': '#13c2c2', '100%': '#1D7B4D' }} status={rcptRunning ? 'active' : rcptErr > 0 ? 'exception' : 'success'} />
                      </Space>
                    </Card>
                  )}

                  <Card size="small" style={{ marginBottom: 12, borderRadius: 8 }}>
                    <Space wrap>
                      {folderControls}
                      <Divider type="vertical" />
                      <Button type="primary" icon={<DownloadOutlined />} onClick={handleRunReceipts} loading={rcptRunning} disabled={rcptRows.length === 0} style={{ background: '#13c2c2', borderColor: '#13c2c2' }}>
                        Scan &amp; Download All
                      </Button>
                      {rcptRunning && <Button danger icon={<StopOutlined />} onClick={() => { rcptStopRef.current = true; }}>Stop</Button>}
                      {!rcptRunning && rcptRows.length > 0 && <Button icon={<ReloadOutlined />} onClick={handleLoadReceipts}>Reset</Button>}
                    </Space>
                  </Card>

                  {!folderName && rcptRows.length > 0 && (
                    <Alert type="info" showIcon style={{ marginBottom: 12, borderRadius: 8 }}
                      message='Click "Choose Save Folder" to save directly to a local path.'
                      description='Files are named [ReceiptNumber]_FileName. Use the Preview button to check attachments for a single receipt first.'
                    />
                  )}

                  <Card size="small" style={{ borderRadius: 8 }}
                    title={<Space><Badge count={rcptRows.length} style={{ backgroundColor: '#13c2c2' }} /><Text strong>AR Receipts</Text></Space>}
                  >
                    <Table<ReceiptAttRow>
                      dataSource={rcptRows} columns={rcptColumns} rowKey="key" size="small" loading={rcptLoading}
                      pagination={{ pageSize: 50, size: 'small', showSizeChanger: true, showTotal: t => `${t} receipts` }}
                      scroll={{ y: 500 }}
                      rowClassName={r => r.dlStatus === 'done' ? 'row-done' : r.dlStatus === 'error' ? 'row-error' : r.scanStatus === 'found' ? 'row-found' : ''}
                    />
                  </Card>

                  {/* Preview modal */}
                  <Modal
                    open={rcptPreview !== null}
                    title={rcptPreview ? `Attachments — ${rcptPreview.receiptNumber} · ${rcptPreview.customerName}` : ''}
                    onCancel={() => setRcptPreview(null)}
                    footer={[
                      rcptPreview?.scanStatus === 'found' && rcptPreview.files.length > 0 && (
                        <Button key="dl" type="primary" icon={<DownloadOutlined />}
                          onClick={async () => {
                            if (!rcptPreview) return;
                            for (const f of rcptPreview.files) await downloadRcptFile(f);
                            message.success(`Downloaded ${rcptPreview.files.length} file(s)`);
                            setRcptPreview(null);
                          }}
                        >
                          Download All ({rcptPreview.files.length})
                        </Button>
                      ),
                      <Button key="close" onClick={() => setRcptPreview(null)}>Close</Button>,
                    ]}
                    width={640}
                  >
                    {rcptPreviewLoading ? (
                      <div style={{ textAlign: 'center', padding: 32 }}><SyncOutlined spin style={{ fontSize: 32, color: '#13c2c2' }} /></div>
                    ) : rcptPreview?.scanStatus === 'none' ? (
                      <Alert type="info" message="No attachments found for this receipt." />
                    ) : rcptPreview?.scanStatus === 'error' ? (
                      <Alert type="error" message={`Error: ${rcptPreview.scanError}`} />
                    ) : (
                      <Table
                        dataSource={(rcptPreview?.files || []).map((f, i) => ({ ...f, key: i }))}
                        size="small" pagination={false}
                        columns={[
                          { title: 'File', dataIndex: 'fileName', render: (v, r: any) => <Space>{fileIcon(r.mimeType ?? '', v)}<Text style={{ fontSize: 12 }}>{v}</Text></Space> },
                          { title: 'Saved As', dataIndex: 'savedAs', ellipsis: true, render: (v) => <Text code style={{ fontSize: 11 }}>{v}</Text> },
                          { title: 'Size', dataIndex: 'fileSize', width: 90, render: (v) => v ? <Text style={{ fontSize: 11 }}>{(v / 1024).toFixed(0)} KB</Text> : '—' },
                          { title: 'Download', key: 'dl', width: 90, render: (_,r: any) => (
                              <Button size="small" icon={<DownloadOutlined />}
                                onClick={async () => { await downloadRcptFile(r); message.success(`Downloaded ${r.fileName}`); }}
                              >Save</Button>
                          )},
                        ]}
                      />
                    )}
                  </Modal>
                </div>
              ),
            },

            // ── Tab 7: AR Invoices ─────────────────────────────────────────
            {
              key: 'arInvoices',
              label: <span><FileTextOutlined style={{ marginRight: 6 }} />AR Invoices</span>,
              children: (
                <div style={{ paddingTop: 8 }}>
                  <Card size="small" style={{ marginBottom: 12, borderRadius: 8 }}>
                    <Form form={arInvForm} layout="inline" size="small" onFinish={handleLoadArInvoices}>
                      <Form.Item name="businessUnit" label="Business Unit">
                        <Input style={{ width: 220 }} placeholder="Filter by BU" allowClear />
                      </Form.Item>
                      <Form.Item name="customerName" label="Customer">
                        <Input style={{ width: 200 }} placeholder="Customer name" allowClear />
                      </Form.Item>
                      <Form.Item name="transactionNumber" label="Txn #">
                        <Input style={{ width: 160 }} placeholder="Transaction number" allowClear />
                      </Form.Item>
                      <Form.Item>
                        <Button type="primary" icon={<SearchOutlined />} htmlType="submit" loading={arInvLoading}
                          style={{ background: '#fa8c16', borderColor: '#fa8c16' }}>
                          Load Invoices
                        </Button>
                      </Form.Item>
                    </Form>
                  </Card>

                  <Row gutter={12} style={{ marginBottom: 12 }}>
                    {[
                      { title: 'Loaded',           value: arInvRows.length, color: undefined },
                      { title: 'Scanned',          value: arInvScanned,     color: '#0572CE' },
                      { title: 'With Attachments', value: arInvWith,        color: '#fa8c16' },
                      { title: 'Total Files',      value: arInvTotal,       color: undefined },
                      { title: 'Downloaded',       value: arInvDone,        color: '#1D7B4D' },
                      { title: 'Errors',           value: arInvErr,         color: '#D93025' },
                    ].map(s => (
                      <Col span={4} key={s.title}>
                        <Card size="small" style={{ borderRadius: 8, textAlign: 'center' }}>
                          <Statistic title={s.title} value={s.value} valueStyle={{ fontSize: 22, color: s.color }} />
                        </Card>
                      </Col>
                    ))}
                  </Row>

                  {(arInvRunning || arInvDone > 0 || arInvErr > 0) && (
                    <Card size="small" style={{ marginBottom: 12, borderRadius: 8 }}>
                      <Space direction="vertical" style={{ width: '100%' }} size={4}>
                        <Space>
                          <Text strong style={{ fontSize: 13 }}>{arInvRunning ? 'Downloading…' : 'Complete'}</Text>
                          <Text type="secondary" style={{ fontSize: 12 }}>{arInvDone} of {arInvTotal} files{arInvErr > 0 && ` · ${arInvErr} error${arInvErr > 1 ? 's' : ''}`}</Text>
                        </Space>
                        <Progress percent={arInvPct} strokeColor={{ '0%': '#fa8c16', '100%': '#1D7B4D' }} status={arInvRunning ? 'active' : arInvErr > 0 ? 'exception' : 'success'} />
                      </Space>
                    </Card>
                  )}

                  <Card size="small" style={{ marginBottom: 12, borderRadius: 8 }}>
                    <Space wrap>
                      {folderControls}
                      <Divider type="vertical" />
                      <Button type="primary" icon={<DownloadOutlined />} onClick={handleRunArInvoices} loading={arInvRunning} disabled={arInvRows.length === 0} style={{ background: '#fa8c16', borderColor: '#fa8c16' }}>
                        Scan &amp; Download All
                      </Button>
                      {arInvRunning && <Button danger icon={<StopOutlined />} onClick={() => { arInvStopRef.current = true; }}>Stop</Button>}
                      {!arInvRunning && arInvRows.length > 0 && <Button icon={<ReloadOutlined />} onClick={handleLoadArInvoices}>Reset</Button>}
                    </Space>
                  </Card>

                  {!folderName && arInvRows.length > 0 && (
                    <Alert type="info" showIcon style={{ marginBottom: 12, borderRadius: 8 }}
                      message='Click "Choose Save Folder" to save directly to a local path.'
                      description='Files are named [TransactionNumber]_FileName. Use the Preview button to check attachments for a single invoice first.'
                    />
                  )}

                  <Card size="small" style={{ borderRadius: 8 }}
                    title={<Space><Badge count={arInvRows.length} style={{ backgroundColor: '#fa8c16' }} /><Text strong>AR Invoices</Text></Space>}
                  >
                    <Table<ArInvRow>
                      dataSource={arInvRows} columns={arInvColumns} rowKey="key" size="small" loading={arInvLoading}
                      pagination={{ pageSize: 50, size: 'small', showSizeChanger: true, showTotal: t => `${t} invoices` }}
                      scroll={{ y: 500 }}
                      rowClassName={r => r.dlStatus === 'done' ? 'row-done' : r.dlStatus === 'error' ? 'row-error' : r.scanStatus === 'found' ? 'row-found' : ''}
                    />
                  </Card>

                  {/* Preview modal */}
                  <Modal
                    open={arInvPreview !== null}
                    title={arInvPreview ? `Attachments — ${arInvPreview.transactionNumber} · ${arInvPreview.customerName}` : ''}
                    onCancel={() => setArInvPreview(null)}
                    footer={[
                      arInvPreview?.scanStatus === 'found' && arInvPreview.files.length > 0 && (
                        <Button key="dl" type="primary" icon={<DownloadOutlined />}
                          style={{ background: '#fa8c16', borderColor: '#fa8c16' }}
                          onClick={async () => {
                            if (!arInvPreview) return;
                            for (const f of arInvPreview.files) await downloadArInvFile(f);
                            message.success(`Downloaded ${arInvPreview.files.length} file(s)`);
                            setArInvPreview(null);
                          }}
                        >
                          Download All ({arInvPreview.files.length})
                        </Button>
                      ),
                      <Button key="close" onClick={() => setArInvPreview(null)}>Close</Button>,
                    ]}
                    width={640}
                  >
                    {arInvPreviewLoading ? (
                      <div style={{ textAlign: 'center', padding: 32 }}><SyncOutlined spin style={{ fontSize: 32, color: '#fa8c16' }} /></div>
                    ) : arInvPreview?.scanStatus === 'none' ? (
                      <Alert type="info" message="No attachments found for this invoice." />
                    ) : arInvPreview?.scanStatus === 'error' ? (
                      <Alert type="error" message={`Error: ${arInvPreview.scanError}`} />
                    ) : (
                      <Table
                        dataSource={(arInvPreview?.files || []).map((f, i) => ({ ...f, key: i }))}
                        size="small" pagination={false}
                        columns={[
                          { title: 'File', dataIndex: 'fileName', render: (v, r: any) => <Space>{fileIcon(r.mimeType ?? '', v)}<Text style={{ fontSize: 12 }}>{v}</Text></Space> },
                          { title: 'Saved As', dataIndex: 'savedAs', ellipsis: true, render: (v) => <Text code style={{ fontSize: 11 }}>{v}</Text> },
                          { title: 'Size', dataIndex: 'fileSize', width: 90, render: (v) => v ? <Text style={{ fontSize: 11 }}>{(v / 1024).toFixed(0)} KB</Text> : '—' },
                          { title: 'Download', key: 'dl', width: 90, render: (_,r: any) => (
                              <Button size="small" icon={<DownloadOutlined />}
                                onClick={async () => { await downloadArInvFile(r); message.success(`Downloaded ${r.fileName}`); }}
                              >Save</Button>
                          )},
                        ]}
                      />
                    )}
                  </Modal>
                </div>
              ),
            },

            // ── Tab 8: Customers (placeholder) ────────────────────────────
            {
              key: 'customers',
              label: <span><TeamOutlined style={{ marginRight: 6 }} />Customers</span>,
              children: comingSoon('Customers'),
            },
          ]}
        />

      </Content>
      <FloatingMenu />
    </Layout>
  );
};

export default DownloadInvoiceAttachments;
