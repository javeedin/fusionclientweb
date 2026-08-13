import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  Modal, Layout, Tabs, Button, Table, Space, Tag, Spin,
  Alert, Tooltip, Typography, Badge, Divider, Input, message,
  Select, Form, Collapse, Popconfirm, Checkbox, Progress,
} from 'antd';
import {
  CloudDownloadOutlined, FileExcelOutlined, SyncOutlined,
  InfoCircleOutlined, SearchOutlined, CheckCircleOutlined,
  ClockCircleOutlined, ApiOutlined, CopyOutlined, UnorderedListOutlined,
  TableOutlined, CloudUploadOutlined, PlusOutlined, DeleteOutlined,
  AppstoreOutlined, HistoryOutlined, ReloadOutlined, FileDoneOutlined,
  DownloadOutlined, LoadingOutlined, CloseCircleOutlined,
} from '@ant-design/icons';
import { ORACLE_SOAP_CONFIG, APEX_DB_CONFIG } from '../../config/api.config';
import { callSoapBip, insertToApex } from '../../services/sync-http';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';

const { Sider, Content } = Layout;
const { Text } = Typography;
const { Option } = Select;

const APEX_BASE = APEX_DB_CONFIG.baseUrl;
const EXCEL_BATCH_SIZE   = 15000;
const LARGE_ROW_THRESHOLD = 15000;

// ── Types ─────────────────────────────────────────────────────────────────────

interface BIPReport {
  reportId:      number;
  module:        string;
  reportName:    string;
  path:          string;
  description:   string;
  apexEndpoint:  string;
  createdDate:   string;
}

interface TabState {
  loading:        boolean;
  error:          string | null;
  rawErrorDetail: string | null;
  columns:        string[];
  rows:           Record<string, string>[];
  duration:       number | null;
  gridSearch:     string;
  rawEnvelope:    string | null;
  soapUrl:        string;
  decodedXml:     string | null;
}

interface FetchAllStatus {
  phase:        'pending' | 'fetching' | 'exporting' | 'done' | 'error';
  rowCount:     number;
  downloadDone: boolean;
  exportDone:   boolean;
  fileType:     'xlsx' | 'csv' | null;
  error:        string | null;
}

// ── SOAP helpers ──────────────────────────────────────────────────────────────

const buildSoapEnvelope = (
  reportPath: string,
  username:   string,
  password:   string,
): string => `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:v2="http://xmlns.oracle.com/oxp/service/v2">
  <soapenv:Header/>
  <soapenv:Body>
    <v2:runReport>
      <v2:reportRequest>
        <v2:reportAbsolutePath>${reportPath}</v2:reportAbsolutePath>
        <v2:parameterNameValues><v2:listOfParamNameValues/></v2:parameterNameValues>
        <v2:reportData/><v2:reportOutputPath/>
      </v2:reportRequest>
      <v2:userID>${username}</v2:userID>
      <v2:password>${password}</v2:password>
    </v2:runReport>
  </soapenv:Body>
</soapenv:Envelope>`;

const parseGenericXml = (xmlString: string): { columns: string[]; rows: Record<string, string>[] } => {
  if (!xmlString.trim()) return { columns: [], rows: [] };
  const parser  = new DOMParser();
  const doc     = parser.parseFromString(xmlString, 'text/xml');
  let elements: NodeListOf<Element> | Element[] = doc.querySelectorAll('G_1');
  if (elements.length === 0) {
    const root        = doc.documentElement;
    const childCounts = new Map<string, number>();
    Array.from(root.children).forEach(c =>
      childCounts.set(c.tagName, (childCounts.get(c.tagName) || 0) + 1));
    let best = { tag: '', count: 0 };
    childCounts.forEach((count, tag) => { if (count > best.count) best = { tag, count }; });
    if (best.tag) elements = doc.querySelectorAll(best.tag);
  }
  if (elements.length === 0) return { columns: [], rows: [] };
  const colSet: Set<string> = new Set();
  const colOrder: string[]  = [];
  Array.from(elements).forEach(el =>
    Array.from(el.children).forEach(c => {
      if (!colSet.has(c.tagName)) { colSet.add(c.tagName); colOrder.push(c.tagName); }
    })
  );
  const rows: Record<string, string>[] = Array.from(elements).map(el => {
    const row: Record<string, string> = {};
    colOrder.forEach(col => { row[col] = el.querySelector(col)?.textContent?.trim() || ''; });
    return row;
  });
  return { columns: colOrder, rows };
};

// ── Timestamp suffix: _YYYYMMDD_HHMMSS ───────────────────────────────────────
const tsStamp = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
};

// ── Export helper: Excel (batched) → CSV fallback ─────────────────────────────

const exportToFile = async (
  reportName:  string,
  columns:     string[],
  rows:        Record<string, string>[],
  folderPath?: string,           // Electron folder path — if provided, save directly there
): Promise<'xlsx' | 'csv'> => {
  const safeName = reportName.replace(/[^a-zA-Z0-9_\-]/g, '_');
  const ts       = tsStamp();
  const eAPI     = (window as any).electronAPI;

  // ── Build workbook ─────────────────────────────────────────────────────────
  const tryExcel = async (): Promise<'xlsx' | null> => {
    try {
      const wb = XLSX.utils.book_new();
      if (rows.length <= LARGE_ROW_THRESHOLD) {
        const ws = XLSX.utils.json_to_sheet(rows);
        XLSX.utils.book_append_sheet(wb, ws, reportName.slice(0, 31));
      } else {
        let sheetNum = 1;
        for (let i = 0; i < rows.length; i += EXCEL_BATCH_SIZE) {
          const ws = XLSX.utils.json_to_sheet(rows.slice(i, i + EXCEL_BATCH_SIZE));
          XLSX.utils.book_append_sheet(wb, ws, `Sheet${sheetNum++}`);
        }
      }
      const buf      = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const filename = `${safeName}${ts}.xlsx`;

      if (folderPath && eAPI?.saveFileToFolder) {
        await eAPI.saveFileToFolder(buf, folderPath, filename);
      } else if (eAPI?.openExcel) {
        eAPI.openExcel(buf, filename);
      } else {
        saveAs(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
      }
      return 'xlsx';
    } catch {
      return null;
    }
  };

  const result = await tryExcel();
  if (result) return result;

  // ── CSV fallback ───────────────────────────────────────────────────────────
  const lines: string[] = [columns.map(c => `"${c}"`).join(',')];
  for (const row of rows) {
    lines.push(columns.map(c => {
      const v = String(row[c] ?? '');
      return v.includes(',') || v.includes('"') || v.includes('\n')
        ? `"${v.replace(/"/g, '""')}"` : v;
    }).join(','));
  }
  const filename = `${safeName}${ts}.csv`;
  const csvBlob  = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });

  if (folderPath && eAPI?.saveFileToFolder) {
    const csvArr = await csvBlob.arrayBuffer();
    await eAPI.saveFileToFolder(Array.from(new Uint8Array(csvArr)), folderPath, filename);
  } else {
    saveAs(csvBlob, filename);
  }
  return 'csv';
};

// ── Component ─────────────────────────────────────────────────────────────────

interface Props { open: boolean; onClose: () => void; }

const BIPReportsSync: React.FC<Props> = ({ open, onClose }) => {

  // Registry state
  const [reports, setReports]           = useState<BIPReport[]>([]);
  const [loadingReports, setLoadingReports] = useState(false);

  // Register popup
  const [registerOpen, setRegisterOpen] = useState(false);
  const [registerForm] = Form.useForm();
  const [registering, setRegistering]   = useState(false);

  // History modal
  const [historyOpen, setHistoryOpen]   = useState(false);
  const [historyRows, setHistoryRows]   = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Tab / sidebar state
  const [openTabs, setOpenTabs]         = useState<string[]>([]);
  const [activeTab, setActiveTab]       = useState<string>('');
  const [tabStates, setTabStates]       = useState<Record<string, TabState>>({});
  const [sideSearch, setSideSearch]     = useState('');
  const [tabSyncing, setTabSyncing]     = useState<Record<string, boolean>>({});
  const [tabSyncResult, setTabSyncResult] = useState<Record<string, { success: boolean; message?: string; error?: string } | null>>({});

  // Column viewer
  const [colModal, setColModal]         = useState<{ reportId: string; columns: string[] } | null>(null);
  const [colCopyFmt, setColCopyFmt]     = useState<'list' | 'ddl' | 'select'>('list');
  const [apiExpanded, setApiExpanded]   = useState<Record<string, boolean>>({});

  // XML preview
  const [xmlPreview, setXmlPreview]     = useState<{ reportName: string; xml: string } | null>(null);

  // ── Fetch All ─────────────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds]   = useState<Set<number>>(new Set());
  const [fetchAllOpen, setFetchAllOpen] = useState(false);
  const [fetchAllStatus, setFetchAllStatus] = useState<Record<number, FetchAllStatus>>({});
  const [fetchAllRunning, setFetchAllRunning] = useState(false);
  const fetchAllAbortRef = useRef(false);
  const [exportFolder, setExportFolder] = useState<string>('');
  const [selectingFolder, setSelectingFolder] = useState(false);

  const toggleSelect = (reportId: number, checked: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (checked) next.add(reportId); else next.delete(reportId);
      return next;
    });
  };
  const selectAll = (checked: boolean) => {
    setSelectedIds(checked ? new Set(reports.map(r => r.reportId)) : new Set());
  };
  const allSelected   = reports.length > 0 && selectedIds.size === reports.length;
  const someSelected  = selectedIds.size > 0 && !allSelected;

  const handleSelectFolder = async () => {
    const eAPI = (window as any).electronAPI;
    if (eAPI?.selectFolder) {
      setSelectingFolder(true);
      try {
        const result = await eAPI.selectFolder();
        if (!result.cancelled) setExportFolder(result.folderPath);
      } finally {
        setSelectingFolder(false);
      }
    }
  };

  const openFetchAll = async () => {
    // Prompt for folder first (Electron only)
    const eAPI = (window as any).electronAPI;
    if (eAPI?.selectFolder) {
      setSelectingFolder(true);
      try {
        const result = await eAPI.selectFolder();
        if (result.cancelled) return;
        setExportFolder(result.folderPath);
      } finally {
        setSelectingFolder(false);
      }
    }
    const init: Record<number, FetchAllStatus> = {};
    reports.filter(r => selectedIds.has(r.reportId)).forEach(r => {
      init[r.reportId] = { phase: 'pending', rowCount: 0, downloadDone: false, exportDone: false, fileType: null, error: null };
    });
    setFetchAllStatus(init);
    fetchAllAbortRef.current = false;
    setFetchAllOpen(true);
  };

  const handleFetchAll = async () => {
    setFetchAllRunning(true);
    fetchAllAbortRef.current = false;

    const selected = reports.filter(r => selectedIds.has(r.reportId));
    const env      = ORACLE_SOAP_CONFIG.prod;

    for (const report of selected) {
      if (fetchAllAbortRef.current) break;

      // ── Phase: fetching ─────────────────────────────────────────────────
      setFetchAllStatus(prev => ({
        ...prev,
        [report.reportId]: { ...prev[report.reportId], phase: 'fetching', error: null },
      }));

      const envelope = buildSoapEnvelope(report.path, env.username, env.password);
      const result   = await callSoapBip(env.baseUrl, envelope);

      if (!result.success || !result.decodedXml) {
        const errMsg = result.error || 'SOAP call failed';
        setFetchAllStatus(prev => ({
          ...prev,
          [report.reportId]: { ...prev[report.reportId], phase: 'error', error: errMsg },
        }));
        await recordHistory(report, 'ERROR', 0, errMsg);
        continue;
      }

      const { columns, rows } = parseGenericXml(result.decodedXml);

      // Update tab state so report is available in main grid too
      const key = getTabKey(report);
      const displayEnv = envelope.replace(/<v2:password>[^<]*<\/v2:password>/, '<v2:password>••••••••</v2:password>');
      setTabStates(prev => ({
        ...prev,
        [key]: {
          loading: false, error: null, rawErrorDetail: null,
          columns, rows, duration: result.duration ?? null,
          gridSearch: '', rawEnvelope: displayEnv,
          soapUrl: env.baseUrl, decodedXml: result.decodedXml ?? null,
        },
      }));
      if (!openTabs.includes(key)) setOpenTabs(prev => [...prev, key]);

      setFetchAllStatus(prev => ({
        ...prev,
        [report.reportId]: { ...prev[report.reportId], downloadDone: true, rowCount: rows.length },
      }));
      await recordHistory(report, 'SUCCESS', rows.length);

      // ── Phase: exporting ────────────────────────────────────────────────
      setFetchAllStatus(prev => ({
        ...prev,
        [report.reportId]: { ...prev[report.reportId], phase: 'exporting' },
      }));

      let fileType: 'xlsx' | 'csv' = 'xlsx';
      try {
        fileType = await exportToFile(report.reportName, columns, rows, exportFolder || undefined);
      } catch (exportErr: any) {
        setFetchAllStatus(prev => ({
          ...prev,
          [report.reportId]: {
            ...prev[report.reportId],
            phase: 'error',
            error: `Export failed: ${exportErr?.message || exportErr}`,
          },
        }));
        continue;
      }

      setFetchAllStatus(prev => ({
        ...prev,
        [report.reportId]: { ...prev[report.reportId], phase: 'done', exportDone: true, fileType },
      }));
    }

    setFetchAllRunning(false);
  };

  // ── Load registered reports ───────────────────────────────────────────────
  const loadReports = useCallback(async () => {
    setLoadingReports(true);
    try {
      const res  = await fetch(`${APEX_BASE}/bip-reports`);
      const data = await res.json();
      const items: BIPReport[] = (data.items || []).map((r: any) => ({
        reportId:     r.report_id     ?? r.REPORT_ID     ?? r.reportId,
        module:       r.module        ?? r.MODULE        ?? '',
        reportName:   r.report_name   ?? r.REPORT_NAME   ?? r.reportName   ?? '',
        path:         r.path          ?? r.PATH          ?? '',
        description:  r.description   ?? r.DESCRIPTION   ?? '',
        apexEndpoint: r.apex_endpoint ?? r.APEX_ENDPOINT ?? r.apexEndpoint ?? '',
        createdDate:  r.created_date  ?? r.CREATED_DATE  ?? r.createdDate  ?? '',
      }));
      setReports(items);
    } catch (e: any) {
      message.error(`Failed to load reports: ${e.message}`);
    } finally {
      setLoadingReports(false);
    }
  }, []);

  useEffect(() => { if (open) loadReports(); }, [open, loadReports]);

  // ── Register new report ───────────────────────────────────────────────────
  const handleRegister = async () => {
    const vals = await registerForm.validateFields();
    setRegistering(true);
    try {
      const res  = await fetch(`${APEX_BASE}/bip-reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          module:       vals.module,
          reportName:   vals.reportName,
          path:         vals.path.trim(),
          description:  vals.description || '',
          apexEndpoint: vals.apexEndpoint || '',
        }),
      });
      const result = await res.json();
      if (!res.ok) { message.error(result.error || 'Registration failed'); return; }
      message.success('Report registered');
      setRegisterOpen(false);
      registerForm.resetFields();
      loadReports();
    } catch (e: any) {
      message.error(`Registration error: ${e.message}`);
    } finally {
      setRegistering(false);
    }
  };

  // ── Delete report ─────────────────────────────────────────────────────────
  const handleDelete = async (reportId: number) => {
    try {
      const res = await fetch(`${APEX_BASE}/bip-reports/${reportId}`, { method: 'DELETE' });
      const result = await res.json();
      if (!res.ok) { message.error(result.error || 'Delete failed'); return; }
      message.success('Report removed');
      loadReports();
    } catch (e: any) {
      message.error(`Delete error: ${e.message}`);
    }
  };

  // ── Record history ────────────────────────────────────────────────────────
  const recordHistory = async (
    report: BIPReport,
    status: 'SUCCESS' | 'ERROR',
    rowCount: number,
    errorMessage?: string,
  ) => {
    try {
      await fetch(`${APEX_BASE}/bip-reports/history`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reportId:        report.reportId,
          module:          report.module,
          reportName:      report.reportName,
          path:            report.path,
          executionStatus: status,
          rowCount:        rowCount,
          errorMessage:    errorMessage || null,
        }),
      });
    } catch { /* silent */ }
  };

  // ── Load execution history ────────────────────────────────────────────────
  const loadHistory = async () => {
    setLoadingHistory(true);
    try {
      const res  = await fetch(`${APEX_BASE}/bip-reports/history`);
      const data = await res.json();
      setHistoryRows((data.items || []).map((r: any, i: number) => ({
        key:             i,
        historyId:       r.history_id       ?? r.HISTORY_ID        ?? r.historyId,
        module:          r.module           ?? r.MODULE             ?? '',
        reportName:      r.report_name      ?? r.REPORT_NAME        ?? r.reportName   ?? '',
        executionDate:   r.execution_date   ?? r.EXECUTION_DATE     ?? r.executionDate ?? '',
        executionStatus: r.execution_status ?? r.EXECUTION_STATUS   ?? r.executionStatus ?? '',
        rowCount:        r.row_count        ?? r.ROW_COUNT          ?? r.rowCount     ?? 0,
        errorMessage:    r.error_message    ?? r.ERROR_MESSAGE      ?? r.errorMessage ?? '',
      })));
    } catch (e: any) {
      message.error(`Failed to load history: ${e.message}`);
    } finally {
      setLoadingHistory(false);
    }
  };

  // ── Tab management ────────────────────────────────────────────────────────
  const getTabKey = (r: BIPReport) => `${r.module}__${r.reportId}`;

  const openReport = (report: BIPReport) => {
    const key = getTabKey(report);
    if (!openTabs.includes(key)) setOpenTabs(prev => [...prev, key]);
    setActiveTab(key);
  };

  const closeTab = (key: string) => {
    const next = openTabs.filter(t => t !== key);
    setOpenTabs(next);
    if (activeTab === key) setActiveTab(next[next.length - 1] || '');
    setTabStates(prev => { const n = { ...prev }; delete n[key]; return n; });
  };

  // ── Fetch a single report ─────────────────────────────────────────────────
  const fetchReport = useCallback(async (report: BIPReport) => {
    const key      = getTabKey(report);
    const env      = ORACLE_SOAP_CONFIG.prod;
    const envelope = buildSoapEnvelope(report.path, env.username, env.password);
    const displayEnv = envelope.replace(/<v2:password>[^<]*<\/v2:password>/, '<v2:password>••••••••</v2:password>');

    setTabStates(prev => ({
      ...prev,
      [key]: {
        loading: true, error: null, rawErrorDetail: null,
        columns: [], rows: [], duration: null, gridSearch: '',
        rawEnvelope: displayEnv, soapUrl: env.baseUrl, decodedXml: null,
      },
    }));

    const result = await callSoapBip(env.baseUrl, envelope);

    if (!result.success || !result.decodedXml) {
      const errMsg = result.error || 'SOAP call failed — no data returned';
      setTabStates(prev => ({
        ...prev,
        [key]: { ...prev[key], loading: false, error: errMsg, rawErrorDetail: (result as any).details || null, duration: result.duration ?? null },
      }));
      await recordHistory(report, 'ERROR', 0, errMsg);
      return;
    }

    const { columns, rows } = parseGenericXml(result.decodedXml);
    setTabStates(prev => ({
      ...prev,
      [key]: { ...prev[key], loading: false, error: null, rawErrorDetail: null, columns, rows, duration: result.duration ?? null, decodedXml: result.decodedXml ?? null },
    }));
    await recordHistory(report, 'SUCCESS', rows.length);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Post to APEX ──────────────────────────────────────────────────────────
  const syncToApex = useCallback(async (report: BIPReport) => {
    const key  = getTabKey(report);
    const rows = tabStates[key]?.rows;
    if (!report.apexEndpoint || !rows?.length) return;

    setTabSyncing(prev => ({ ...prev, [key]: true }));
    setTabSyncResult(prev => ({ ...prev, [key]: null }));
    try {
      const result = await insertToApex(report.apexEndpoint, rows);
      const ok     = result?.success === true;
      setTabSyncResult(prev => ({
        ...prev,
        [key]: {
          success: ok,
          message: ok ? (result.message || `${rows.length} rows posted`) : undefined,
          error:   !ok ? (result?.error || 'APEX returned an error') : undefined,
        },
      }));
      if (ok) message.success(`${report.reportName}: ${rows.length} rows posted to APEX`);
      else    message.error(`${report.reportName}: ${result?.error || 'Post failed'}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setTabSyncResult(prev => ({ ...prev, [key]: { success: false, error: msg } }));
      message.error(`${report.reportName}: ${msg}`);
    } finally {
      setTabSyncing(prev => ({ ...prev, [key]: false }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabStates]);

  // ── Export Excel from tab ─────────────────────────────────────────────────
  const exportToExcel = async (report: BIPReport) => {
    const key   = getTabKey(report);
    const state = tabStates[key];
    if (!state?.rows.length) return;
    try {
      const type = await exportToFile(report.reportName, state.columns, state.rows);
      message.success(`Exported as ${type.toUpperCase()}: ${report.reportName}`);
    } catch (e: any) {
      message.error(`Export failed: ${e.message}`);
    }
  };

  // ── Render API info panel ─────────────────────────────────────────────────
  const renderApiPanel = (report: BIPReport) => {
    const key      = getTabKey(report);
    const state    = tabStates[key];
    const env      = ORACLE_SOAP_CONFIG.prod;
    const envelope = state?.rawEnvelope || buildSoapEnvelope(report.path, env.username, '••••••••');
    const expanded = apiExpanded[key] ?? false;

    return (
      <div style={{ marginBottom: 12 }}>
        <div
          onClick={() => setApiExpanded(prev => ({ ...prev, [key]: !prev[key] }))}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
            padding: '5px 10px', borderRadius: 6,
            background: '#f0f5ff', border: '1px solid #adc6ff',
            fontSize: 12, color: '#2f54eb', userSelect: 'none',
          }}
        >
          <ApiOutlined style={{ fontSize: 13 }} />
          <span style={{ fontWeight: 600 }}>API Info — SOAP Payload</span>
          <Tag color="blue" style={{ marginLeft: 4, fontSize: 10 }}>POST</Tag>
          <code style={{ flex: 1, fontSize: 10, color: '#595959', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {env.baseUrl}
          </code>
          <span style={{ fontSize: 11, flexShrink: 0 }}>{expanded ? '▲ Hide' : '▼ Show'}</span>
        </div>
        {expanded && (
          <div style={{ marginTop: 6, padding: '10px 12px', borderRadius: 6, background: '#fafafa', border: '1px solid #d9d9d9', fontSize: 12 }}>
            <div style={{ marginBottom: 6 }}>
              <Text type="secondary" style={{ fontSize: 11 }}>Report Path</Text>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2, background: '#fff', border: '1px solid #e0e0e0', borderRadius: 4, padding: '4px 8px' }}>
                <code style={{ flex: 1, fontSize: 11, color: '#d46b08' }}>{report.path}</code>
                <CopyOutlined style={{ cursor: 'pointer', color: '#595959', flexShrink: 0 }}
                  onClick={() => { navigator.clipboard.writeText(report.path); message.success('Path copied'); }} />
              </div>
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <Text type="secondary" style={{ fontSize: 11 }}>Full XML Payload (password masked)</Text>
                <CopyOutlined style={{ cursor: 'pointer', color: '#595959', fontSize: 12 }}
                  onClick={() => { navigator.clipboard.writeText(envelope); message.success('XML copied'); }} />
              </div>
              <pre style={{ margin: 0, padding: '8px 10px', background: '#1e1e1e', color: '#9cdcfe', borderRadius: 4, fontSize: 10, maxHeight: 220, overflow: 'auto', whiteSpace: 'pre', lineHeight: 1.5 }}>
                {envelope}
              </pre>
            </div>
          </div>
        )}
      </div>
    );
  };

  // ── Column viewer ─────────────────────────────────────────────────────────
  const renderColModal = () => {
    if (!colModal) return null;
    const { reportId: rId, columns } = colModal;
    const report = reports.find(r => getTabKey(r) === rId);
    const tblName = `RR_${report?.module || 'BIP'}_${report?.reportName || rId}`.toUpperCase();

    const copyText = colCopyFmt === 'list'
      ? columns.join('\n')
      : colCopyFmt === 'ddl'
        ? [`CREATE TABLE ${tblName} (`, columns.map((c, i) => `  ${c.padEnd(40)} VARCHAR2(400)${i < columns.length - 1 ? ',' : ''}`).join('\n'), `);`].join('\n')
        : `SELECT\n  ${columns.join(',\n  ')}\nFROM ${tblName};`;

    return (
      <Modal open onCancel={() => setColModal(null)} footer={null} width={720}
        title={<Space><UnorderedListOutlined style={{ color: '#C74634' }} /><span>Columns — <code style={{ fontSize: 13 }}>{report?.reportName}</code></span><Tag color="blue">{columns.length}</Tag></Space>}>
        <Space style={{ marginBottom: 12 }} wrap>
          <span style={{ fontSize: 12, color: '#595959' }}>Copy as:</span>
          <Select value={colCopyFmt} onChange={v => setColCopyFmt(v)} size="small" style={{ width: 200 }}
            options={[{ value: 'list', label: 'Plain List' }, { value: 'ddl', label: 'CREATE TABLE DDL' }, { value: 'select', label: 'SELECT statement' }]} />
          <Button icon={<CopyOutlined />} size="small" type="primary"
            onClick={() => { navigator.clipboard.writeText(copyText); message.success('Copied!'); }}>Copy</Button>
        </Space>
        <pre style={{ background: '#1e1e1e', color: '#9cdcfe', borderRadius: 6, padding: '10px 14px', fontSize: 11, maxHeight: 220, overflow: 'auto', marginBottom: 14 }}>
          {copyText}
        </pre>
        <Divider style={{ margin: '8px 0 12px' }} />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxHeight: 260, overflowY: 'auto' }}>
          {columns.map((col, i) => (
            <Tag key={col} style={{ fontFamily: 'monospace', fontSize: 11, cursor: 'pointer' }}
              onClick={() => { navigator.clipboard.writeText(col); message.success(`Copied: ${col}`); }}
              title="Click to copy">
              <span style={{ color: '#8c8c8c', marginRight: 4 }}>{i + 1}.</span>{col}
            </Tag>
          ))}
        </div>
      </Modal>
    );
  };

  // ── Tab content ───────────────────────────────────────────────────────────
  const renderTabContent = (report: BIPReport) => {
    const key   = getTabKey(report);
    const state = tabStates[key];

    if (!state) return (
      <div>
        {renderApiPanel(report)}
        <div style={{ padding: 40, textAlign: 'center' }}>
          <AppstoreOutlined style={{ fontSize: 48, color: '#d9d9d9', marginBottom: 16 }} />
          <div style={{ color: '#8c8c8c', marginBottom: 24 }}>Click <strong>Fetch Data</strong> to run the BIP report</div>
          <Button type="primary" icon={<CloudDownloadOutlined />} size="large" onClick={() => fetchReport(report)}>Fetch Data</Button>
        </div>
      </div>
    );

    if (state.loading) return (
      <div>
        {renderApiPanel(report)}
        <div style={{ padding: 48, textAlign: 'center' }}>
          <Spin size="large" />
          <div style={{ marginTop: 16, color: '#8c8c8c' }}>Running SOAP call to Oracle BI Publisher…</div>
        </div>
      </div>
    );

    if (state.error) return (
      <div>
        {renderApiPanel(report)}
        <Alert type="error" showIcon message={`SOAP Call Failed — ${state.error}`}
          description={state.rawErrorDetail
            ? <pre style={{ fontSize: 11, maxHeight: 120, overflow: 'auto', whiteSpace: 'pre-wrap', marginTop: 8 }}>{state.rawErrorDetail}</pre>
            : 'Verify the report path exists in Oracle BIP and credentials are correct.'}
          style={{ marginBottom: 12 }} />
        <Button icon={<CloudDownloadOutlined />} onClick={() => fetchReport(report)}>Retry</Button>
      </div>
    );

    const search   = state.gridSearch.toLowerCase();
    const filtered = search ? state.rows.filter(r => Object.values(r).some(v => v.toLowerCase().includes(search))) : state.rows;
    const tableCols = state.columns.map(col => ({
      title: col, dataIndex: col, key: col, width: 140, ellipsis: true,
      render: (v: string) => <Text style={{ fontFamily: 'monospace', fontSize: 11 }}>{v || <span style={{ color: '#d9d9d9' }}>—</span>}</Text>,
    }));

    return (
      <div>
        {renderApiPanel(report)}

        {/* Toolbar */}
        <Space style={{ marginBottom: 12 }} wrap>
          <Button type="primary" icon={<CloudDownloadOutlined />} onClick={() => fetchReport(report)}>Fetch Data</Button>
          <Button icon={<FileExcelOutlined />} disabled={!state.rows.length} onClick={() => exportToExcel(report)}
            style={{ borderColor: '#1D6F42', color: '#1D6F42' }}>
            Export {state.rows.length > LARGE_ROW_THRESHOLD ? `(${Math.ceil(state.rows.length / EXCEL_BATCH_SIZE)} sheets)` : 'Excel'}
          </Button>
          <Button icon={<UnorderedListOutlined />} disabled={!state.columns.length}
            onClick={() => setColModal({ reportId: key, columns: state.columns })}
            style={{ borderColor: '#722ed1', color: '#722ed1' }}>
            Columns ({state.columns.length})
          </Button>
          {report.apexEndpoint ? (
            <Button icon={tabSyncing[key] ? <SyncOutlined spin /> : <CloudUploadOutlined />}
              loading={tabSyncing[key]} disabled={!state.rows.length || tabSyncing[key]}
              onClick={() => syncToApex(report)} style={{ borderColor: '#C74634', color: '#C74634' }}>
              Post to APEX
            </Button>
          ) : (
            <Tooltip title="No APEX endpoint configured for this report">
              <Button icon={<CloudUploadOutlined />} disabled>Post to APEX</Button>
            </Tooltip>
          )}
          {state.decodedXml && (
            <Button icon={<InfoCircleOutlined />}
              onClick={() => setXmlPreview({ reportName: report.reportName, xml: state.decodedXml! })}
              style={{ borderColor: '#13c2c2', color: '#13c2c2' }}>
              XML Preview
            </Button>
          )}
          <Input.Search placeholder="Search grid…" allowClear size="small" style={{ width: 200 }}
            value={state.gridSearch}
            onChange={e => setTabStates(prev => ({ ...prev, [key]: { ...prev[key], gridSearch: e.target.value } }))} />
          {state.duration !== null && <Tag icon={<ClockCircleOutlined />} color="blue">{(state.duration / 1000).toFixed(1)}s</Tag>}
          {state.rows.length > 0 && <Tag icon={<CheckCircleOutlined />} color="green">{filtered.length.toLocaleString()} / {state.rows.length.toLocaleString()} rows</Tag>}
          {state.rows.length > LARGE_ROW_THRESHOLD && (
            <Tag color="orange" style={{ fontSize: 11 }}>
              Large dataset — Excel split into {Math.ceil(state.rows.length / EXCEL_BATCH_SIZE)} sheets of {EXCEL_BATCH_SIZE.toLocaleString()}
            </Tag>
          )}
        </Space>

        {/* APEX result */}
        {tabSyncResult[key] && (
          <Alert type={tabSyncResult[key]!.success ? 'success' : 'error'} showIcon closable
            onClose={() => setTabSyncResult(prev => ({ ...prev, [key]: null }))}
            message={tabSyncResult[key]!.success ? tabSyncResult[key]!.message : `Post failed: ${tabSyncResult[key]!.error}`}
            style={{ marginBottom: 10, fontSize: 12 }} />
        )}

        <div style={{ marginBottom: 8, fontSize: 11, color: '#8c8c8c', fontFamily: 'monospace' }}>
          <InfoCircleOutlined style={{ marginRight: 4 }} />
          {report.path}
          {report.description && <> · {report.description}</>}
        </div>

        <Table dataSource={filtered.map((r, i) => ({ ...r, _key: i }))} rowKey="_key"
          columns={tableCols} size="small"
          scroll={{ x: state.columns.length * 140, y: 400 }}
          pagination={{ pageSize: 100, showSizeChanger: true, showQuickJumper: true }}
          bordered />
      </div>
    );
  };

  // ── Fetch All modal ───────────────────────────────────────────────────────
  const renderFetchAllModal = () => {
    const selected = reports.filter(r => selectedIds.has(r.reportId));
    const doneCount = selected.filter(r => fetchAllStatus[r.reportId]?.phase === 'done').length;
    const errCount  = selected.filter(r => fetchAllStatus[r.reportId]?.phase === 'error').length;

    const statusIcon = (s: FetchAllStatus | undefined) => {
      if (!s || s.phase === 'pending')  return <Tag color="default" style={{ fontSize: 11 }}>Pending</Tag>;
      if (s.phase === 'fetching')       return <Tag icon={<LoadingOutlined />} color="processing" style={{ fontSize: 11 }}>Downloading…</Tag>;
      if (s.phase === 'exporting')      return <Tag icon={<LoadingOutlined />} color="blue" style={{ fontSize: 11 }}>Exporting…</Tag>;
      if (s.phase === 'error')          return <Tag icon={<CloseCircleOutlined />} color="error" style={{ fontSize: 11 }}>Error</Tag>;
      if (s.phase === 'done')           return <Tag icon={<CheckCircleOutlined />} color="success" style={{ fontSize: 11 }}>Done</Tag>;
      return null;
    };

    const cols = [
      {
        title: 'Module', dataIndex: 'module', width: 70,
        render: (v: string) => <Tag color={moduleColors[v] || 'default'} style={{ fontSize: 11 }}>{v}</Tag>,
      },
      {
        title: 'Report', dataIndex: 'reportName', ellipsis: true,
        render: (v: string) => <Text style={{ fontSize: 12, fontFamily: 'monospace' }}>{v}</Text>,
      },
      {
        title: 'Rows', width: 80, align: 'right' as const,
        render: (_: any, r: BIPReport) => {
          const s = fetchAllStatus[r.reportId];
          return s?.rowCount ? <Text style={{ fontSize: 12, fontFamily: 'monospace' }}>{s.rowCount.toLocaleString()}</Text> : '—';
        },
      },
      {
        title: 'Download', width: 100, align: 'center' as const,
        render: (_: any, r: BIPReport) => {
          const s = fetchAllStatus[r.reportId];
          if (!s || s.phase === 'pending') return <span style={{ color: '#d9d9d9', fontSize: 18 }}>○</span>;
          if (s.phase === 'fetching')      return <LoadingOutlined style={{ color: '#1677ff', fontSize: 16 }} />;
          if (s.downloadDone)              return <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 18 }} />;
          if (s.phase === 'error')         return <CloseCircleOutlined style={{ color: '#ff4d4f', fontSize: 18 }} />;
          return null;
        },
      },
      {
        title: 'Export', width: 120, align: 'center' as const,
        render: (_: any, r: BIPReport) => {
          const s = fetchAllStatus[r.reportId];
          if (!s || s.phase === 'pending' || s.phase === 'fetching') return <span style={{ color: '#d9d9d9', fontSize: 18 }}>○</span>;
          if (s.phase === 'exporting') return <LoadingOutlined style={{ color: '#1677ff', fontSize: 16 }} />;
          if (s.exportDone)            return (
            <Space size={4}>
              <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 18 }} />
              <Tag color={s.fileType === 'csv' ? 'orange' : 'green'} style={{ fontSize: 10, margin: 0 }}>
                {s.fileType?.toUpperCase()}
              </Tag>
            </Space>
          );
          if (s.phase === 'error')     return <CloseCircleOutlined style={{ color: '#ff4d4f', fontSize: 18 }} />;
          return null;
        },
      },
      {
        title: 'Status', width: 130,
        render: (_: any, r: BIPReport) => statusIcon(fetchAllStatus[r.reportId]),
      },
      {
        title: 'Error', ellipsis: true,
        render: (_: any, r: BIPReport) => {
          const s = fetchAllStatus[r.reportId];
          return s?.error ? <Text type="danger" style={{ fontSize: 11 }}>{s.error}</Text> : null;
        },
      },
    ];

    return (
      <Modal
        open={fetchAllOpen}
        onCancel={() => { if (!fetchAllRunning) setFetchAllOpen(false); }}
        width={820}
        title={
          <Space>
            <DownloadOutlined style={{ color: '#1677ff' }} />
            <span>Fetch All Selected Reports</span>
            <Tag color="blue">{selected.length} report{selected.length !== 1 ? 's' : ''}</Tag>
            {doneCount > 0 && <Tag color="success">{doneCount} done</Tag>}
            {errCount  > 0 && <Tag color="error">{errCount} errors</Tag>}
          </Space>
        }
        footer={
          <Space>
            {fetchAllRunning && (
              <Button danger onClick={() => { fetchAllAbortRef.current = true; }}>
                Stop
              </Button>
            )}
            <Button onClick={() => { if (!fetchAllRunning) setFetchAllOpen(false); }} disabled={fetchAllRunning}>
              Close
            </Button>
            <Button
              type="primary"
              icon={fetchAllRunning ? <SyncOutlined spin /> : <DownloadOutlined />}
              loading={fetchAllRunning}
              disabled={fetchAllRunning || selected.length === 0}
              onClick={handleFetchAll}
            >
              {fetchAllRunning ? 'Fetching…' : 'Fetch & Export'}
            </Button>
          </Space>
        }
      >
        {/* Folder display */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12,
          padding: '8px 12px', background: exportFolder ? '#f6ffed' : '#fffbe6',
          border: `1px solid ${exportFolder ? '#b7eb8f' : '#ffe58f'}`, borderRadius: 6,
        }}>
          <FileDoneOutlined style={{ color: exportFolder ? '#52c41a' : '#faad14', fontSize: 16, flexShrink: 0 }} />
          <Text style={{ flex: 1, fontSize: 12, fontFamily: 'monospace', color: exportFolder ? '#237804' : '#d46b08' }} ellipsis>
            {exportFolder || 'No folder selected — files will download via browser'}
          </Text>
          {!fetchAllRunning && (
            <Button size="small" loading={selectingFolder} onClick={handleSelectFolder}
              style={{ flexShrink: 0 }}>
              {exportFolder ? 'Change Folder' : 'Select Folder'}
            </Button>
          )}
        </div>

        {fetchAllRunning && (
          <Progress
            percent={Math.round((doneCount + errCount) / selected.length * 100)}
            status={errCount > 0 && !fetchAllRunning ? 'exception' : 'active'}
            style={{ marginBottom: 12 }}
          />
        )}
        <Alert
          type="info" showIcon style={{ marginBottom: 12, fontSize: 12 }}
          message={`Files saved with timestamp (e.g. ReportName_20250618_143022.xlsx). Files > ${LARGE_ROW_THRESHOLD.toLocaleString()} rows split into ${EXCEL_BATCH_SIZE.toLocaleString()}-row sheets. CSV used as fallback if Excel fails.`}
        />
        <Table
          dataSource={selected.map(r => ({ ...r, key: r.reportId }))}
          columns={cols}
          size="small"
          pagination={false}
          bordered
        />
      </Modal>
    );
  };

  // ── Sidebar: grouped by module ────────────────────────────────────────────
  const filteredReports = sideSearch.trim()
    ? reports.filter(r =>
        r.reportName.toLowerCase().includes(sideSearch.toLowerCase()) ||
        r.description.toLowerCase().includes(sideSearch.toLowerCase()) ||
        r.module.toLowerCase().includes(sideSearch.toLowerCase())
      )
    : reports;

  const byModule = filteredReports.reduce<Record<string, BIPReport[]>>((acc, r) => {
    const m = r.module || 'Other';
    if (!acc[m]) acc[m] = [];
    acc[m].push(r);
    return acc;
  }, {});

  const moduleColors: Record<string, string> = {
    FA: '#fa8c16', AP: '#1677ff', GL: '#52c41a',
    AR: '#722ed1', CM: '#13c2c2', INV: '#eb2f96',
  };

  // ── Register form ─────────────────────────────────────────────────────────
  const renderRegisterModal = () => (
    <Modal open={registerOpen} onCancel={() => { setRegisterOpen(false); registerForm.resetFields(); }}
      onOk={handleRegister} okText="Register Report" confirmLoading={registering}
      title={<Space><PlusOutlined style={{ color: '#C74634' }} /><span>Register BIP Report</span></Space>}
      width={560}>
      <Form form={registerForm} layout="vertical" size="small">
        <Form.Item name="module" label="Module" rules={[{ required: true }]}>
          <Select placeholder="Select or type module" showSearch allowClear style={{ width: '100%' }}>
            {['FA', 'AP', 'GL', 'AR', 'CM', 'INV', 'PO', 'OM', 'HR'].map(m => <Option key={m} value={m}>{m}</Option>)}
          </Select>
        </Form.Item>
        <Form.Item name="reportName" label="Report Name" rules={[{ required: true }]}
          extra="Short identifier, e.g. FA_ADDITIONS_B">
          <Input placeholder="e.g. FA_ADDITIONS_B" />
        </Form.Item>
        <Form.Item name="path" label="BIP Report Path (absolute)" rules={[{ required: true }]}
          extra="Full path as it appears in Oracle BIP, e.g. /Custom/FA_REPORTS/ReERPFAreports/FA_ADDITIONS_B_BIP.xdo">
          <Input.TextArea rows={2} placeholder="/Custom/FA_REPORTS/ReERPFAreports/FA_ADDITIONS_B_BIP.xdo" />
        </Form.Item>
        <Form.Item name="description" label="Description">
          <Input placeholder="Brief description of what this report contains" />
        </Form.Item>
        <Form.Item name="apexEndpoint" label="APEX Endpoint (optional)"
          extra="Relative endpoint for Post to APEX, e.g. fa/additions. Leave blank if not yet mapped.">
          <Input placeholder="e.g. fa/additions" />
        </Form.Item>
      </Form>
    </Modal>
  );

  // ── History modal ─────────────────────────────────────────────────────────
  const renderHistoryModal = () => (
    <Modal open={historyOpen} onCancel={() => setHistoryOpen(false)} footer={null}
      width={900} title={<Space><HistoryOutlined style={{ color: '#C74634' }} /><span>Execution History</span></Space>}>
      <div style={{ marginBottom: 10, textAlign: 'right' }}>
        <Button size="small" icon={<ReloadOutlined />} onClick={loadHistory} loading={loadingHistory}>Refresh</Button>
      </div>
      <Table dataSource={historyRows} rowKey="key" size="small" loading={loadingHistory}
        pagination={{ pageSize: 50, size: 'small' }}
        columns={[
          { title: 'Date', dataIndex: 'executionDate', width: 160, render: v => <Text style={{ fontSize: 12, fontFamily: 'monospace' }}>{v}</Text> },
          { title: 'Module', dataIndex: 'module', width: 60, render: v => <Tag color={moduleColors[v] || 'default'} style={{ fontSize: 11 }}>{v}</Tag> },
          { title: 'Report', dataIndex: 'reportName', ellipsis: true, render: v => <Text style={{ fontSize: 12, fontFamily: 'monospace' }}>{v}</Text> },
          { title: 'Status', dataIndex: 'executionStatus', width: 90, render: v => <Tag color={v === 'SUCCESS' ? 'green' : 'red'} style={{ fontSize: 11 }}>{v}</Tag> },
          { title: 'Rows', dataIndex: 'rowCount', width: 70, align: 'right', render: v => <Text style={{ fontSize: 12, fontFamily: 'monospace' }}>{(v || 0).toLocaleString()}</Text> },
          { title: 'Error', dataIndex: 'errorMessage', ellipsis: true, render: v => v ? <Text type="danger" style={{ fontSize: 11 }}>{v}</Text> : null },
        ]}
      />
    </Modal>
  );

  // ── XML preview modal ─────────────────────────────────────────────────────
  const renderXmlPreview = () => {
    if (!xmlPreview) return null;
    const { reportName, xml } = xmlPreview;
    const pretty = (() => {
      try {
        const parser = new DOMParser();
        const doc    = parser.parseFromString(xml, 'text/xml');
        const ser    = new XMLSerializer();
        let raw      = ser.serializeToString(doc);
        let indent   = 0;
        return raw
          .replace(/></g, '>\n<')
          .split('\n')
          .map(line => {
            if (line.match(/^<\/\w/)) indent = Math.max(0, indent - 1);
            const padded = '  '.repeat(indent) + line.trim();
            if (line.match(/^<\w[^>]*[^/]>$/) && !line.match(/^<\?/)) indent++;
            return padded;
          })
          .join('\n');
      } catch { return xml; }
    })();

    const previewLines = pretty.split('\n').slice(0, 300).join('\n');
    const totalLines   = pretty.split('\n').length;
    const truncated    = totalLines > 300;

    return (
      <Modal open onCancel={() => setXmlPreview(null)} footer={null} width={860}
        title={
          <Space>
            <InfoCircleOutlined style={{ color: '#13c2c2' }} />
            <span>Decoded XML — <code style={{ fontSize: 13 }}>{reportName}</code></span>
            <Tag color="cyan">{totalLines.toLocaleString()} lines</Tag>
            <Tag color="blue">{(xml.length / 1024).toFixed(1)} KB</Tag>
          </Space>
        }>
        <div style={{ marginBottom: 8, display: 'flex', gap: 8 }}>
          <Button size="small" icon={<CopyOutlined />}
            onClick={() => { navigator.clipboard.writeText(xml); message.success('XML copied to clipboard'); }}>
            Copy Full XML
          </Button>
          <Button size="small" icon={<FileExcelOutlined />} style={{ borderColor: '#1D6F42', color: '#1D6F42' }}
            onClick={() => { saveAs(new Blob([xml], { type: 'text/xml' }), `${reportName}.xml`); }}>
            Download .xml
          </Button>
        </div>
        {truncated && (
          <Alert type="info" showIcon style={{ marginBottom: 8, fontSize: 12 }}
            message={`Showing first 300 of ${totalLines.toLocaleString()} lines. Use Copy or Download for the full XML.`} />
        )}
        <pre style={{
          background: '#1e1e1e', color: '#9cdcfe',
          borderRadius: 6, padding: '12px 14px',
          fontSize: 11, lineHeight: 1.6,
          maxHeight: '60vh', overflow: 'auto',
          whiteSpace: 'pre', margin: 0,
        }}>
          {previewLines}
        </pre>
      </Modal>
    );
  };

  // ── Copy all table scripts ────────────────────────────────────────────────
  const copyAllTableScripts = useCallback(() => {
    const fetched = reports.filter(r => {
      const s = tabStates[getTabKey(r)];
      return s && !s.loading && !s.error && s.columns.length > 0;
    });
    if (fetched.length === 0) {
      message.warning('No reports fetched yet — open and fetch reports first.');
      return;
    }
    const scripts = fetched.map(r => {
      const cols    = tabStates[getTabKey(r)].columns;
      const tblName = `RR_${r.module}_${r.reportName}`.toUpperCase();
      return [
        `-- ${r.module} · ${r.reportName}${r.description ? ' · ' + r.description : ''}`,
        `CREATE TABLE ${tblName} (`,
        cols.map((c, i) => `  ${c.padEnd(40)} VARCHAR2(400)${i < cols.length - 1 ? ',' : ''}`).join('\n'),
        `);`,
      ].join('\n');
    }).join('\n\n');
    navigator.clipboard.writeText(scripts);
    message.success(`Copied CREATE TABLE scripts for ${fetched.length} report${fetched.length !== 1 ? 's' : ''}`);
  }, [reports, tabStates]);

  const tabItems = openTabs.map(key => {
    const report = reports.find(r => getTabKey(r) === key);
    if (!report) return null;
    const state = tabStates[key];
    return {
      key, closable: true,
      label: (
        <span style={{ fontSize: 12 }}>
          {state?.loading && <SyncOutlined spin style={{ marginRight: 4 }} />}
          {state?.rows.length && !state.loading
            ? <Badge count={state.rows.length} size="small" style={{ marginRight: 4, backgroundColor: '#52c41a' }} />
            : null}
          <Tag color={moduleColors[report.module] || 'default'} style={{ fontSize: 10, marginRight: 4 }}>{report.module}</Tag>
          {report.reportName}
        </span>
      ),
      children: renderTabContent(report),
    };
  }).filter(Boolean) as any[];

  return (
    <>
      <Modal open={open} onCancel={onClose} footer={null} width="93vw" style={{ top: 16 }}
        styles={{ body: { padding: 0, height: '86vh', overflow: 'hidden' } }}
        destroyOnClose
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <AppstoreOutlined style={{ color: '#C74634', fontSize: 18 }} />
            <span style={{ fontWeight: 700 }}>Sync BIP Reports</span>
            <Tag color="orange">{reports.length} Reports</Tag>
            <Tag color="blue" style={{ fontSize: 11 }}>Dynamic Registry</Tag>
            {selectedIds.size > 0 && (
              <Tag color="geekblue" style={{ fontSize: 11 }}>{selectedIds.size} selected</Tag>
            )}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              {selectedIds.size > 0 && (
                <Button
                  size="small"
                  type="primary"
                  icon={<DownloadOutlined />}
                  onClick={openFetchAll}
                  style={{ background: '#1677ff' }}
                >
                  Fetch All ({selectedIds.size})
                </Button>
              )}
              <Button size="small" icon={<CopyOutlined />} onClick={copyAllTableScripts}
                style={{ borderColor: '#722ed1', color: '#722ed1' }}>
                Copy All Table Scripts
              </Button>
              <Button size="small" icon={<HistoryOutlined />}
                onClick={() => { setHistoryOpen(true); loadHistory(); }}
                style={{ borderColor: '#13c2c2', color: '#13c2c2' }}>
                History
              </Button>
              <Button size="small" icon={<ReloadOutlined />} loading={loadingReports} onClick={loadReports}>Refresh</Button>
            </div>
          </div>
        }
      >
        <Layout style={{ height: '100%', background: '#fff' }}>
          {/* ── Left sidebar ─────────────────────────────────────────── */}
          <Sider width={280} style={{ background: '#fafafa', borderRight: '1px solid #f0f0f0', height: '100%', overflowY: 'auto' }}>
            <div style={{ padding: '10px 12px 6px' }}>
              <Input prefix={<SearchOutlined style={{ color: '#aaa' }} />} placeholder="Search reports…"
                size="small" allowClear value={sideSearch} onChange={e => setSideSearch(e.target.value)} />
            </div>
            <div style={{ padding: '4px 12px 8px', display: 'flex', gap: 6 }}>
              <Button size="small" type="dashed" flex="1" icon={<PlusOutlined />}
                onClick={() => setRegisterOpen(true)}
                style={{ flex: 1, borderColor: '#C74634', color: '#C74634', fontSize: 12 }}>
                Register Report
              </Button>
            </div>

            {/* Select All row */}
            {reports.length > 0 && (
              <div style={{
                padding: '5px 12px 5px 14px', borderBottom: '1px solid #ebebeb',
                background: '#f0f5ff', display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <Checkbox
                  checked={allSelected}
                  indeterminate={someSelected}
                  onChange={e => selectAll(e.target.checked)}
                />
                <Text style={{ fontSize: 11, color: '#595959' }}>
                  {allSelected ? 'Deselect All' : 'Select All'} ({reports.length})
                </Text>
                {selectedIds.size > 0 && (
                  <Tag color="geekblue" style={{ fontSize: 10, marginLeft: 'auto', padding: '0 4px' }}>
                    {selectedIds.size} ✓
                  </Tag>
                )}
              </div>
            )}

            <Divider style={{ margin: 0 }} />

            {loadingReports && <div style={{ textAlign: 'center', padding: 24 }}><Spin size="small" /></div>}

            {!loadingReports && reports.length === 0 && (
              <div style={{ padding: 24, textAlign: 'center', color: '#8c8c8c', fontSize: 12 }}>
                <AppstoreOutlined style={{ fontSize: 28, color: '#d9d9d9', display: 'block', marginBottom: 8 }} />
                No reports registered yet.<br />Click <strong>Register Report</strong> to add one.
              </div>
            )}

            {Object.entries(byModule).sort().map(([mod, reps]) => (
              <div key={mod}>
                <div style={{
                  padding: '6px 12px 4px', background: '#f5f5f5',
                  borderBottom: '1px solid #ebebeb', borderTop: '1px solid #ebebeb',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  <Tag color={moduleColors[mod] || 'default'} style={{ fontSize: 11, margin: 0 }}>{mod}</Tag>
                  <Text style={{ fontSize: 11, color: '#8c8c8c' }}>{reps.length} report{reps.length !== 1 ? 's' : ''}</Text>
                </div>
                {reps.map(report => {
                  const key      = getTabKey(report);
                  const isOpen   = openTabs.includes(key);
                  const isActive = activeTab === key;
                  const state    = tabStates[key];
                  const isChecked = selectedIds.has(report.reportId);
                  return (
                    <div key={key}
                      style={{
                        padding: '7px 12px 7px 14px', cursor: 'pointer',
                        background: isActive ? '#fff2e8' : isOpen ? '#f6ffed' : 'transparent',
                        borderLeft: isActive ? '3px solid #C74634' : isOpen ? '3px solid #52c41a' : '3px solid transparent',
                        borderBottom: '1px solid #f5f5f5',
                        transition: 'background 0.15s',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Checkbox
                          checked={isChecked}
                          onChange={e => { e.stopPropagation(); toggleSelect(report.reportId, e.target.checked); }}
                          onClick={e => e.stopPropagation()}
                          style={{ flexShrink: 0 }}
                        />
                        <Text
                          style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: isActive ? 700 : 500, flex: 1 }}
                          ellipsis
                          onClick={() => openReport(report)}
                        >
                          {report.reportName}
                        </Text>
                        {state?.loading && <SyncOutlined spin style={{ fontSize: 10, color: '#C74634' }} />}
                        {state?.rows.length && !state.loading
                          ? <Tag color="green" style={{ fontSize: 9, padding: '0 3px', lineHeight: '14px' }}>{state.rows.length}</Tag>
                          : null}
                        {state?.error && <Tag color="red" style={{ fontSize: 9, padding: '0 3px', lineHeight: '14px' }}>ERR</Tag>}
                        <Popconfirm title="Remove this report?" onConfirm={e => { e?.stopPropagation(); handleDelete(report.reportId); }}
                          onPopupClick={e => e.stopPropagation()}>
                          <DeleteOutlined style={{ fontSize: 10, color: '#ccc', flexShrink: 0 }}
                            onClick={e => e.stopPropagation()}
                            onMouseEnter={e => (e.currentTarget.style.color = '#ff4d4f')}
                            onMouseLeave={e => (e.currentTarget.style.color = '#ccc')} />
                        </Popconfirm>
                      </div>
                      {report.description && (
                        <Text type="secondary" style={{ fontSize: 10, marginLeft: 22 }} ellipsis>{report.description}</Text>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </Sider>

          {/* ── Main content ──────────────────────────────────────────── */}
          <Content style={{ padding: 16, overflowY: 'auto', height: '100%' }}>
            {openTabs.length === 0 ? (
              <div style={{ textAlign: 'center', paddingTop: 80, color: '#8c8c8c' }}>
                <AppstoreOutlined style={{ fontSize: 64, color: '#d9d9d9', marginBottom: 16 }} />
                <div style={{ fontSize: 16, marginBottom: 8 }}>No reports open</div>
                <div style={{ fontSize: 13 }}>Select a report from the left panel, or register a new one.</div>
              </div>
            ) : (
              <Tabs type="editable-card" hideAdd activeKey={activeTab} onChange={setActiveTab}
                onEdit={(key, action) => { if (action === 'remove') closeTab(key as string); }}
                items={tabItems} style={{ height: '100%' }} />
            )}
          </Content>
        </Layout>
      </Modal>

      {renderRegisterModal()}
      {renderHistoryModal()}
      {renderColModal()}
      {renderXmlPreview()}
      {renderFetchAllModal()}
    </>
  );
};

export default BIPReportsSync;
