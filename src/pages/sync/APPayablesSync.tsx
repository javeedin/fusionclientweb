import React, { useState, useCallback, useRef } from 'react';
import {
  Modal, Layout, Tabs, Button, Table, Space, Tag, Spin,
  Alert, Tooltip, Typography, Badge, Divider, Input, message, Select, Progress,
} from 'antd';
import {
  AuditOutlined, CloudDownloadOutlined, FileExcelOutlined,
  SyncOutlined, InfoCircleOutlined, SearchOutlined,
  CheckCircleOutlined, ClockCircleOutlined, ApiOutlined, CopyOutlined,
  UnorderedListOutlined, TableOutlined, CloudUploadOutlined, StopOutlined,
} from '@ant-design/icons';
import { ORACLE_SOAP_CONFIG } from '../../config/api.config';
import { callSoapBip, insertToApex } from '../../services/sync-http';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';

const { Sider, Content } = Layout;
const { Text } = Typography;

const AP_BASE_PATH  = '/Custom/FA_REPORTS/ReERPAPreports';
const AP_COLOR      = '#1677ff';
const BATCH_SIZE    = 500;

const APEX_ENDPOINT_MAP: Record<string, string> = {
  AP_INVOICES_ALL_BIP:               'ap/raw-invoices',
  AP_INVOICE_PAYMENTS_ALL_BIP:       'ap/raw-invoice-payments',
  AP_INVOICE_LINES_ALL_BIP:          'ap/raw-invoice-lines',
  AP_INVOICE_DISTRIBUTIONS_ALL_BIP:  'ap/raw-invoice-distributions',
  AP_PAYMENT_SCHEDULES_ALL_BIP:      'ap/raw-payment-schedules',
  AP_SYSTEM_PARAMETERS_ALL_BIP:      'ap/raw-system-parameters',
};

const AP_REPORTS = [
  { id: 'AP_INVOICES_ALL_BIP',               label: 'AP_INVOICES_ALL',               description: 'Invoice headers — amounts, dates, vendor, status' },
  { id: 'AP_INVOICE_PAYMENTS_ALL_BIP',       label: 'AP_INVOICE_PAYMENTS_ALL',       description: 'Payment applications against invoices' },
  { id: 'AP_INVOICE_LINES_ALL_BIP',          label: 'AP_INVOICE_LINES_ALL',          description: 'Invoice distribution lines' },
  { id: 'AP_INVOICE_DISTRIBUTIONS_ALL_BIP',  label: 'AP_INVOICE_DISTRIBUTIONS_ALL',  description: 'GL account distributions per invoice line' },
  { id: 'AP_PAYMENT_SCHEDULES_ALL_BIP',      label: 'AP_PAYMENT_SCHEDULES_ALL',      description: 'Payment due dates and installments' },
  { id: 'AP_SYSTEM_PARAMETERS_ALL_BIP',      label: 'AP_SYSTEM_PARAMETERS_ALL',      description: 'Payables system configuration by OU' },
];

interface BatchProgress {
  batch: number;       // current batch number (1-based)
  rowsFetched: number; // rows accumulated so far
  startedAt: number;   // Date.now() when fetch started
}

interface TabState {
  loading: boolean;
  batchProgress: BatchProgress | null;
  cancelled: boolean;
  error: string | null;
  rawErrorDetail: string | null;
  columns: string[];
  rows: Record<string, string>[];
  duration: number | null;
  gridSearch: string;
  rawEnvelope: string | null;
  soapUrl: string;
}

const buildSoapEnvelope = (
  reportPath: string,
  params: Record<string, string>,
  username: string,
  password: string,
): string => {
  const paramXml = Object.entries(params)
    .map(([k, v]) => `<v2:item><v2:name>${k}</v2:name><v2:values><v2:item>${v}</v2:item></v2:values></v2:item>`)
    .join('');
  return `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:v2="http://xmlns.oracle.com/oxp/service/v2">
  <soapenv:Header/>
  <soapenv:Body>
    <v2:runReport>
      <v2:reportRequest>
        <v2:reportAbsolutePath>${reportPath}</v2:reportAbsolutePath>
        <v2:parameterNameValues><v2:listOfParamNameValues>${paramXml}</v2:listOfParamNameValues></v2:parameterNameValues>
        <v2:reportData/><v2:reportOutputPath/>
      </v2:reportRequest>
      <v2:userID>${username}</v2:userID>
      <v2:password>${password}</v2:password>
    </v2:runReport>
  </soapenv:Body>
</soapenv:Envelope>`;
};

const parseGenericXml = (xmlString: string): { columns: string[]; rows: Record<string, string>[] } => {
  if (!xmlString.trim()) return { columns: [], rows: [] };
  const parser = new DOMParser();
  const doc    = parser.parseFromString(xmlString, 'text/xml');

  let elements: NodeListOf<Element> | Element[] = doc.querySelectorAll('G_1');
  if (elements.length === 0) {
    const root       = doc.documentElement;
    const childCounts = new Map<string, number>();
    Array.from(root.children).forEach(c => childCounts.set(c.tagName, (childCounts.get(c.tagName) || 0) + 1));
    let best = { tag: '', count: 0 };
    childCounts.forEach((count, tag) => { if (count > best.count) best = { tag, count }; });
    if (best.tag) elements = doc.querySelectorAll(best.tag);
  }
  if (elements.length === 0) return { columns: [], rows: [] };

  const colSet   = new Set<string>();
  const colOrder: string[] = [];
  Array.from(elements).slice(0, 5).forEach(el => {
    Array.from(el.children).forEach(c => {
      if (!colSet.has(c.tagName)) { colSet.add(c.tagName); colOrder.push(c.tagName); }
    });
  });

  const rows: Record<string, string>[] = Array.from(elements).map(el => {
    const row: Record<string, string> = {};
    colOrder.forEach(col => { row[col] = el.querySelector(col)?.textContent?.trim() || ''; });
    return row;
  });

  return { columns: colOrder, rows };
};

interface Props { open: boolean; onClose: () => void; }

const APPayablesSync: React.FC<Props> = ({ open, onClose }) => {
  const [openTabs, setOpenTabs]     = useState<string[]>([]);
  const [activeTab, setActiveTab]   = useState<string>('');
  const [tabStates, setTabStates]   = useState<Record<string, TabState>>({});
  const [sideSearch, setSideSearch] = useState('');
  const [colModal, setColModal]     = useState<{ reportId: string; columns: string[] } | null>(null);
  const [colCopyFmt, setColCopyFmt] = useState<'list' | 'ddl' | 'insert' | 'select'>('list');
  const [apiExpanded, setApiExpanded] = useState<Record<string, boolean>>({});
  const [fetchingAll, setFetchingAll] = useState(false);
  const [fetchAllProgress, setFetchAllProgress] = useState<{ done: number; total: number } | null>(null);
  const [tabSyncing, setTabSyncing]   = useState<Record<string, boolean>>({});
  const [tabSyncResult, setTabSyncResult] = useState<Record<string, { success: boolean; message?: string; error?: string } | null>>({});

  // Cancel flags per report — set to true to stop the batch loop
  const cancelFlags = useRef<Record<string, boolean>>({});

  const openReport = (reportId: string) => {
    if (!openTabs.includes(reportId)) setOpenTabs(prev => [...prev, reportId]);
    setActiveTab(reportId);
  };

  const closeTab = (reportId: string) => {
    cancelFlags.current[reportId] = true;
    const newTabs = openTabs.filter(t => t !== reportId);
    setOpenTabs(newTabs);
    if (activeTab === reportId) setActiveTab(newTabs[newTabs.length - 1] || '');
    setTabStates(prev => { const n = { ...prev }; delete n[reportId]; return n; });
  };

  const cancelFetch = (reportId: string) => {
    cancelFlags.current[reportId] = true;
  };

  // ── Core batch-loop fetch ──────────────────────────────────────────────────
  const fetchReport = useCallback(async (reportId: string) => {
    const reportPath = `${AP_BASE_PATH}/${reportId}.xdo`;
    const env        = ORACLE_SOAP_CONFIG.prod;
    const startedAt  = Date.now();

    // Reset cancel flag and init tab state
    cancelFlags.current[reportId] = false;

    const firstEnvelope = buildSoapEnvelope(
      reportPath,
      { P_START_ROW: '1', P_END_ROW: String(BATCH_SIZE) },
      env.username, env.password,
    );
    const displayEnvelope = firstEnvelope.replace(
      /<v2:password>[^<]*<\/v2:password>/,
      '<v2:password>••••••••</v2:password>',
    );

    setTabStates(prev => ({
      ...prev,
      [reportId]: {
        loading: true, cancelled: false, error: null, rawErrorDetail: null,
        columns: [], rows: [], duration: null, gridSearch: '',
        rawEnvelope: displayEnvelope, soapUrl: env.baseUrl,
        batchProgress: { batch: 1, rowsFetched: 0, startedAt },
      },
    }));

    let allRows: Record<string, string>[] = [];
    let allColumns: string[] = [];
    let batchNum   = 1;
    let hasMore    = true;

    while (hasMore) {
      // Check cancel
      if (cancelFlags.current[reportId]) {
        setTabStates(prev => ({
          ...prev,
          [reportId]: {
            ...prev[reportId],
            loading: false,
            cancelled: true,
            rows: allRows,
            columns: allColumns,
            duration: Date.now() - startedAt,
            batchProgress: null,
          },
        }));
        message.warning(`${reportId}: fetch cancelled (${allRows.length} rows retrieved)`);
        return;
      }

      const startRow = (batchNum - 1) * BATCH_SIZE + 1;
      const endRow   = batchNum * BATCH_SIZE;

      const envelope = buildSoapEnvelope(
        reportPath,
        { P_START_ROW: String(startRow), P_END_ROW: String(endRow) },
        env.username, env.password,
      );

      // Update progress
      setTabStates(prev => ({
        ...prev,
        [reportId]: {
          ...prev[reportId],
          batchProgress: { batch: batchNum, rowsFetched: allRows.length, startedAt },
        },
      }));

      const result = await callSoapBip(env.baseUrl, envelope);

      if (!result.success || !result.decodedXml) {
        setTabStates(prev => ({
          ...prev,
          [reportId]: {
            ...prev[reportId],
            loading: false, batchProgress: null,
            error: result.error || 'SOAP call failed — no data returned',
            rawErrorDetail: (result as any).details || null,
            duration: Date.now() - startedAt,
            rows: allRows,
            columns: allColumns,
          },
        }));
        return;
      }

      const { columns, rows } = parseGenericXml(result.decodedXml);

      if (columns.length > 0 && allColumns.length === 0) {
        allColumns = columns;
      }

      allRows = [...allRows, ...rows];

      // Fewer rows than batch size means we've reached the last page
      if (rows.length < BATCH_SIZE) {
        hasMore = false;
      } else {
        batchNum++;
      }
    }

    setTabStates(prev => ({
      ...prev,
      [reportId]: {
        ...prev[reportId],
        loading: false, batchProgress: null, cancelled: false, error: null,
        columns: allColumns,
        rows: allRows,
        duration: Date.now() - startedAt,
      },
    }));
  }, []);

  const syncToApex = useCallback(async (reportId: string) => {
    const endpoint = APEX_ENDPOINT_MAP[reportId];
    const rows     = tabStates[reportId]?.rows;
    if (!endpoint || !rows?.length) return;

    setTabSyncing(prev    => ({ ...prev, [reportId]: true }));
    setTabSyncResult(prev => ({ ...prev, [reportId]: null }));

    try {
      const result = await insertToApex(endpoint, rows);
      const ok = result?.success === true;
      setTabSyncResult(prev => ({
        ...prev,
        [reportId]: {
          success: ok,
          message: ok ? (result.message || `${rows.length} rows posted to APEX`) : undefined,
          error:   !ok ? (result?.error || 'APEX returned an error') : undefined,
        },
      }));
      if (ok) message.success(`${reportId}: ${rows.length} rows posted to APEX`);
      else     message.error(`${reportId}: ${result?.error || 'Post failed'}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setTabSyncResult(prev => ({ ...prev, [reportId]: { success: false, error: msg } }));
      message.error(`${reportId}: ${msg}`);
    } finally {
      setTabSyncing(prev => ({ ...prev, [reportId]: false }));
    }
  }, [tabStates]);

  const fetchAllReports = useCallback(async () => {
    setFetchingAll(true);
    setFetchAllProgress({ done: 0, total: AP_REPORTS.length });
    setOpenTabs(AP_REPORTS.map(r => r.id));
    setActiveTab(AP_REPORTS[0].id);

    for (let i = 0; i < AP_REPORTS.length; i++) {
      const { id } = AP_REPORTS[i];
      setActiveTab(id);
      await fetchReport(id);
      setFetchAllProgress({ done: i + 1, total: AP_REPORTS.length });
    }

    setFetchingAll(false);
    message.success(`Fetched all ${AP_REPORTS.length} AP Payables reports`);
  }, [fetchReport]);

  const copyAllTableScripts = useCallback(() => {
    const fetched = AP_REPORTS.filter(r => {
      const s = tabStates[r.id];
      return s && !s.loading && !s.error && s.columns.length > 0;
    });
    if (fetched.length === 0) {
      message.warning('No reports fetched yet. Run Fetch All first.');
      return;
    }
    const scripts = fetched.map(r => {
      const cols = tabStates[r.id].columns;
      return [
        `-- ${r.description}`,
        `CREATE TABLE RR_AP_${r.id.replace('_BIP', '')} (`,
        cols.map((c, i) => `  ${c.padEnd(40)} VARCHAR2(400)${i < cols.length - 1 ? ',' : ''}`).join('\n'),
        `);`,
      ].join('\n');
    }).join('\n\n');
    navigator.clipboard.writeText(scripts);
    message.success(`Copied CREATE TABLE scripts for ${fetched.length} reports`);
  }, [tabStates]);

  const exportToExcel = (reportId: string) => {
    const state = tabStates[reportId];
    if (!state?.rows.length) return;
    const ws  = XLSX.utils.json_to_sheet(state.rows);
    const wb  = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, reportId.slice(0, 31));
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const eAPI = (window as any).electronAPI;
    if (eAPI?.openExcel) {
      eAPI.openExcel(buf, `${reportId}.xlsx`);
    } else {
      saveAs(
        new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
        `${reportId}.xlsx`,
      );
    }
  };

  const buildColCopyText = (reportId: string, columns: string[], fmt: typeof colCopyFmt): string => {
    switch (fmt) {
      case 'list':   return columns.join('\n');
      case 'ddl':
        return [
          `CREATE TABLE RR_AP_${reportId.replace('_BIP', '')} (`,
          columns.map((c, i) => `  ${c.padEnd(40)} VARCHAR2(400)${i < columns.length - 1 ? ',' : ''}`).join('\n'),
          `);`,
        ].join('\n');
      case 'insert':
        return [
          `INSERT INTO RR_AP_${reportId.replace('_BIP', '')} (`,
          `  ${columns.join(',\n  ')}`,
          `) VALUES (`,
          `  ${columns.map(c => `:${c.toLowerCase()}`).join(',\n  ')}`,
          `);`,
        ].join('\n');
      case 'select':
        return `SELECT\n  ${columns.join(',\n  ')}\nFROM RR_AP_${reportId.replace('_BIP', '')};`;
      default: return columns.join('\n');
    }
  };

  // ── Batch progress panel ───────────────────────────────────────────────────
  const renderBatchProgress = (reportId: string, bp: BatchProgress) => {
    const elapsed = ((Date.now() - bp.startedAt) / 1000).toFixed(1);
    const rps     = bp.startedAt && bp.rowsFetched > 0
      ? (bp.rowsFetched / ((Date.now() - bp.startedAt) / 1000)).toFixed(0)
      : '—';

    return (
      <div style={{
        background: '#e6f4ff', border: '1px solid #91caff', borderRadius: 8,
        padding: '16px 20px', marginBottom: 16,
      }}>
        <Space style={{ marginBottom: 10 }} size={16}>
          <SyncOutlined spin style={{ fontSize: 20, color: AP_COLOR }} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: AP_COLOR }}>
              Fetching batch {bp.batch} — {bp.rowsFetched.toLocaleString()} rows retrieved
            </div>
            <div style={{ fontSize: 12, color: '#595959', marginTop: 2 }}>
              Rows {((bp.batch - 1) * BATCH_SIZE + 1).toLocaleString()} – {(bp.batch * BATCH_SIZE).toLocaleString()}
              &nbsp;·&nbsp;{elapsed}s elapsed
              &nbsp;·&nbsp;~{rps} rows/s
            </div>
          </div>
          <Button
            size="small"
            danger
            icon={<StopOutlined />}
            onClick={() => cancelFetch(reportId)}
          >
            Cancel
          </Button>
        </Space>
        <Progress
          percent={Math.min(100, bp.batch * 2)}
          status="active"
          strokeColor={AP_COLOR}
          showInfo={false}
          style={{ marginBottom: 0 }}
        />
        <div style={{ marginTop: 6, fontSize: 11, color: '#8c8c8c' }}>
          Each batch = {BATCH_SIZE} rows · Loop continues until a batch returns fewer than {BATCH_SIZE} rows
        </div>
      </div>
    );
  };

  // ── Column modal ───────────────────────────────────────────────────────────
  const renderColModal = () => {
    if (!colModal) return null;
    const { reportId, columns } = colModal;
    const copyText = buildColCopyText(reportId, columns, colCopyFmt);
    return (
      <Modal
        open
        onCancel={() => setColModal(null)}
        footer={null}
        width={760}
        title={
          <Space>
            <UnorderedListOutlined style={{ color: AP_COLOR }} />
            <span>All Columns — <code style={{ fontSize: 13 }}>{reportId}</code></span>
            <Tag color="blue">{columns.length} columns</Tag>
          </Space>
        }
      >
        <Space style={{ marginBottom: 12 }} wrap>
          <span style={{ fontSize: 12, color: '#595959' }}>Copy as:</span>
          <Select
            value={colCopyFmt}
            onChange={v => setColCopyFmt(v)}
            size="small"
            style={{ width: 200 }}
            options={[
              { value: 'list',   label: 'Plain List' },
              { value: 'ddl',    label: 'CREATE TABLE DDL' },
              { value: 'insert', label: 'INSERT INTO template' },
              { value: 'select', label: 'SELECT statement' },
            ]}
          />
          <Button
            icon={<CopyOutlined />} size="small" type="primary"
            onClick={() => { navigator.clipboard.writeText(copyText); message.success('Copied!'); }}
          >Copy</Button>
        </Space>
        <pre style={{
          background: '#1e1e1e', color: '#9cdcfe', borderRadius: 6,
          padding: '10px 14px', fontSize: 11, maxHeight: 260,
          overflow: 'auto', whiteSpace: 'pre', marginBottom: 16, lineHeight: 1.6,
        }}>
          {copyText}
        </pre>
        <Divider style={{ margin: '8px 0 12px' }} />
        <div style={{ marginBottom: 6, fontSize: 12, color: '#595959', fontWeight: 600 }}>
          <TableOutlined style={{ marginRight: 4 }} />All {columns.length} columns:
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxHeight: 300, overflowY: 'auto' }}>
          {columns.map((col, i) => (
            <Tag
              key={col}
              style={{ fontFamily: 'monospace', fontSize: 11, cursor: 'pointer', marginBottom: 2 }}
              onClick={() => { navigator.clipboard.writeText(col); message.success(`Copied: ${col}`); }}
              title="Click to copy"
            >
              <span style={{ color: '#8c8c8c', marginRight: 4 }}>{i + 1}.</span>{col}
            </Tag>
          ))}
        </div>
        <div style={{ marginTop: 8, fontSize: 11, color: '#aaa' }}>Click any column tag to copy its name.</div>
      </Modal>
    );
  };

  // ── SOAP API info panel ────────────────────────────────────────────────────
  const renderApiPanel = (reportId: string) => {
    const state      = tabStates[reportId];
    const reportPath = `${AP_BASE_PATH}/${reportId}.xdo`;
    const soapUrl    = state?.soapUrl || ORACLE_SOAP_CONFIG.prod.baseUrl;
    const envelope   = state?.rawEnvelope || buildSoapEnvelope(
      reportPath,
      { P_START_ROW: '1', P_END_ROW: String(BATCH_SIZE) },
      ORACLE_SOAP_CONFIG.prod.username, '••••••••',
    );
    const expanded = apiExpanded[reportId] ?? false;

    return (
      <div style={{ marginBottom: 12 }}>
        <div
          onClick={() => setApiExpanded(prev => ({ ...prev, [reportId]: !prev[reportId] }))}
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
          <Tag color="cyan" style={{ fontSize: 10 }}>Batch {BATCH_SIZE}/call</Tag>
          <code style={{ flex: 1, fontSize: 10, color: '#595959', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {soapUrl}
          </code>
          <span style={{ fontSize: 11, flexShrink: 0 }}>{expanded ? '▲ Hide' : '▼ Show'}</span>
        </div>

        {expanded && (
          <div style={{
            marginTop: 6, padding: '10px 12px', borderRadius: 6,
            background: '#fafafa', border: '1px solid #d9d9d9', fontSize: 12,
          }}>
            <div style={{ marginBottom: 6 }}>
              <Text type="secondary" style={{ fontSize: 11 }}>Endpoint (SOAPAction: "runReport")</Text>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6, marginTop: 2,
                background: '#fff', border: '1px solid #e0e0e0', borderRadius: 4, padding: '4px 8px',
              }}>
                <code style={{ flex: 1, fontSize: 11, wordBreak: 'break-all', color: '#1d39c4' }}>{soapUrl}</code>
                <Tooltip title="Copy URL">
                  <CopyOutlined style={{ cursor: 'pointer', color: '#595959', flexShrink: 0 }}
                    onClick={() => { navigator.clipboard.writeText(soapUrl); message.success('URL copied'); }} />
                </Tooltip>
              </div>
            </div>
            <div style={{ marginBottom: 6 }}>
              <Text type="secondary" style={{ fontSize: 11 }}>Report Path · Parameters: P_START_ROW, P_END_ROW (batch size {BATCH_SIZE})</Text>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6, marginTop: 2,
                background: '#fff', border: '1px solid #e0e0e0', borderRadius: 4, padding: '4px 8px',
              }}>
                <code style={{ flex: 1, fontSize: 11, color: '#d46b08' }}>{reportPath}</code>
                <Tooltip title="Copy path">
                  <CopyOutlined style={{ cursor: 'pointer', color: '#595959', flexShrink: 0 }}
                    onClick={() => { navigator.clipboard.writeText(reportPath); message.success('Path copied'); }} />
                </Tooltip>
              </div>
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <Text type="secondary" style={{ fontSize: 11 }}>Sample XML (Batch 1 — rows 1–{BATCH_SIZE}, password masked)</Text>
                <Tooltip title="Copy XML">
                  <CopyOutlined style={{ cursor: 'pointer', color: '#595959', fontSize: 12 }}
                    onClick={() => { navigator.clipboard.writeText(envelope); message.success('XML copied'); }} />
                </Tooltip>
              </div>
              <pre style={{
                margin: 0, padding: '8px 10px',
                background: '#1e1e1e', color: '#9cdcfe',
                borderRadius: 4, fontSize: 10, maxHeight: 260,
                overflow: 'auto', whiteSpace: 'pre', lineHeight: 1.5,
              }}>
                {envelope}
              </pre>
            </div>
          </div>
        )}
      </div>
    );
  };

  // ── Success grid + toolbar ─────────────────────────────────────────────────
  const renderSuccessContent = (reportId: string, report: typeof AP_REPORTS[0], state: TabState) => {
    const search   = state.gridSearch.toLowerCase();
    const filtered = search
      ? state.rows.filter(r => Object.values(r).some(v => v.toLowerCase().includes(search)))
      : state.rows;

    const tableCols = state.columns.map(col => ({
      title: col, dataIndex: col, key: col, width: 140, ellipsis: true,
      render: (v: string) => (
        <Text style={{ fontFamily: 'monospace', fontSize: 11 }}>
          {v || <span style={{ color: '#d9d9d9' }}>—</span>}
        </Text>
      ),
    }));

    return (
      <div>
        <Space style={{ marginBottom: 12 }} wrap>
          <Button
            type="primary"
            icon={<CloudDownloadOutlined />}
            onClick={() => fetchReport(reportId)}
            style={{ background: AP_COLOR, borderColor: AP_COLOR }}
          >
            Fetch Data
          </Button>
          <Button
            icon={<FileExcelOutlined />}
            disabled={!state.rows.length}
            onClick={() => exportToExcel(reportId)}
            style={{ borderColor: '#1D6F42', color: '#1D6F42' }}
          >
            Export Excel
          </Button>
          <Button
            icon={<UnorderedListOutlined />}
            onClick={() => setColModal({ reportId, columns: state.columns })}
            style={{ borderColor: '#722ed1', color: '#722ed1' }}
          >
            Columns ({state.columns.length})
          </Button>
          {APEX_ENDPOINT_MAP[reportId] ? (
            <Button
              icon={tabSyncing[reportId] ? <SyncOutlined spin /> : <CloudUploadOutlined />}
              loading={tabSyncing[reportId]}
              disabled={!state.rows.length || tabSyncing[reportId]}
              onClick={() => syncToApex(reportId)}
              style={{ borderColor: AP_COLOR, color: AP_COLOR }}
            >
              Post to APEX
            </Button>
          ) : (
            <Tooltip title="No APEX endpoint configured for this report">
              <Button icon={<CloudUploadOutlined />} disabled>Post to APEX</Button>
            </Tooltip>
          )}
          <Input.Search
            placeholder="Search grid…"
            allowClear size="small" style={{ width: 200 }}
            value={state.gridSearch}
            onChange={e => setTabStates(prev => ({
              ...prev, [reportId]: { ...prev[reportId], gridSearch: e.target.value },
            }))}
          />
          {state.duration !== null && (
            <Tag icon={<ClockCircleOutlined />} color="blue">
              {(state.duration / 1000).toFixed(1)}s
            </Tag>
          )}
          {state.rows.length > 0 && (
            <Tag icon={<CheckCircleOutlined />} color="green">
              {filtered.length.toLocaleString()} / {state.rows.length.toLocaleString()} rows
            </Tag>
          )}
          {state.cancelled && (
            <Tag color="orange">Cancelled — partial data</Tag>
          )}
        </Space>

        {tabSyncResult[reportId] && (
          <Alert
            type={tabSyncResult[reportId]!.success ? 'success' : 'error'}
            showIcon closable
            onClose={() => setTabSyncResult(prev => ({ ...prev, [reportId]: null }))}
            message={
              tabSyncResult[reportId]!.success
                ? tabSyncResult[reportId]!.message
                : `Post to APEX failed: ${tabSyncResult[reportId]!.error}`
            }
            style={{ marginBottom: 10, fontSize: 12 }}
          />
        )}

        <div style={{ marginBottom: 8, fontSize: 11, color: '#8c8c8c', fontFamily: 'monospace' }}>
          <InfoCircleOutlined style={{ marginRight: 4 }} />
          {AP_BASE_PATH}/{reportId}.xdo · {report.description}
        </div>

        <Table
          dataSource={filtered.map((r, i) => ({ ...r, _key: i }))}
          rowKey="_key"
          columns={tableCols}
          size="small"
          scroll={{ x: state.columns.length * 140, y: 400 }}
          pagination={{ pageSize: 100, showSizeChanger: true, showQuickJumper: true }}
          bordered
        />
      </div>
    );
  };

  // ── Tab content dispatcher ─────────────────────────────────────────────────
  const renderTabContent = (reportId: string) => {
    const report = AP_REPORTS.find(r => r.id === reportId)!;
    const state  = tabStates[reportId];

    if (!state) {
      return (
        <div>
          {renderApiPanel(reportId)}
          <div style={{ padding: 32, textAlign: 'center' }}>
            <AuditOutlined style={{ fontSize: 48, color: '#d9d9d9', marginBottom: 16 }} />
            <div style={{ color: '#8c8c8c', marginBottom: 8 }}>
              Click <strong>Fetch Data</strong> to run the BIP report
            </div>
            <div style={{ color: '#aaa', fontSize: 12, marginBottom: 24 }}>
              Fetches {BATCH_SIZE} rows per SOAP call, loops until all records are retrieved
            </div>
            <Button
              type="primary" icon={<CloudDownloadOutlined />} size="large"
              style={{ background: AP_COLOR, borderColor: AP_COLOR }}
              onClick={() => fetchReport(reportId)}
            >
              Fetch Data
            </Button>
          </div>
        </div>
      );
    }

    if (state.loading && state.batchProgress) {
      return (
        <div>
          {renderApiPanel(reportId)}
          {renderBatchProgress(reportId, state.batchProgress)}
          {state.rows.length > 0 && (
            <div style={{ opacity: 0.5, pointerEvents: 'none' }}>
              <div style={{ marginBottom: 8, fontSize: 11, color: '#8c8c8c' }}>
                Preview of rows fetched so far ({state.rows.length.toLocaleString()}):
              </div>
              <Table
                dataSource={state.rows.slice(0, 50).map((r, i) => ({ ...r, _key: i }))}
                rowKey="_key"
                columns={state.columns.slice(0, 8).map(col => ({
                  title: col, dataIndex: col, key: col, width: 120, ellipsis: true,
                }))}
                size="small"
                scroll={{ x: 960, y: 280 }}
                pagination={false}
                bordered
              />
            </div>
          )}
        </div>
      );
    }

    if (state.error) {
      return (
        <div>
          {renderApiPanel(reportId)}
          {state.rows.length > 0 && (
            <Alert
              type="warning" showIcon
              message={`Partial data available — ${state.rows.length.toLocaleString()} rows fetched before error`}
              style={{ marginBottom: 10 }}
            />
          )}
          <Alert
            type="error" showIcon
            message={`SOAP Call Failed — ${state.error}`}
            description={
              state.rawErrorDetail
                ? <pre style={{ fontSize: 11, maxHeight: 120, overflow: 'auto', whiteSpace: 'pre-wrap', marginTop: 8 }}>
                    {state.rawErrorDetail}
                  </pre>
                : 'Verify the report path exists in Oracle BIP and credentials are correct.'
            }
            style={{ marginBottom: 12 }}
          />
          <Button icon={<CloudDownloadOutlined />} onClick={() => fetchReport(reportId)}>Retry</Button>
        </div>
      );
    }

    return (
      <div>
        {renderApiPanel(reportId)}
        {renderSuccessContent(reportId, report, state)}
      </div>
    );
  };

  const filteredReports = sideSearch.trim()
    ? AP_REPORTS.filter(r =>
        r.label.toLowerCase().includes(sideSearch.toLowerCase()) ||
        r.description.toLowerCase().includes(sideSearch.toLowerCase())
      )
    : AP_REPORTS;

  const tabItems = openTabs.map(id => {
    const report = AP_REPORTS.find(r => r.id === id)!;
    const state  = tabStates[id];
    const bp     = state?.batchProgress;
    return {
      key: id,
      closable: true,
      label: (
        <span style={{ fontSize: 12 }}>
          {state?.loading && <SyncOutlined spin style={{ marginRight: 4, color: AP_COLOR }} />}
          {bp && (
            <Tag color="processing" style={{ fontSize: 9, padding: '0 3px', lineHeight: '14px', marginRight: 4 }}>
              B{bp.batch}
            </Tag>
          )}
          {state?.rows.length && !state.loading
            ? <Badge count={state.rows.length} size="small" style={{ marginRight: 4, backgroundColor: '#52c41a' }} />
            : null}
          {report.label}
        </span>
      ),
      children: renderTabContent(id),
    };
  });

  return (
    <>
      <Modal
        open={open}
        onCancel={onClose}
        footer={null}
        width="92vw"
        style={{ top: 20 }}
        styles={{ body: { padding: 0, height: '85vh', overflow: 'hidden' } }}
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <AuditOutlined style={{ color: AP_COLOR, fontSize: 18 }} />
            <span style={{ fontWeight: 700 }}>Payables — BIP Reports</span>
            <Tag color="blue">{AP_REPORTS.length} Reports</Tag>
            <Tag color="cyan" style={{ fontSize: 11 }}>Batch size: {BATCH_SIZE}</Tag>
            <Tag color="geekblue" style={{ fontFamily: 'monospace', fontSize: 11 }}>{AP_BASE_PATH}</Tag>

            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
              {fetchAllProgress && fetchingAll && (
                <Tag color="processing">{fetchAllProgress.done} / {fetchAllProgress.total}</Tag>
              )}
              <Button
                type="primary"
                icon={fetchingAll ? <SyncOutlined spin /> : <CloudDownloadOutlined />}
                loading={fetchingAll}
                onClick={fetchAllReports}
                size="small"
                style={{ background: AP_COLOR, borderColor: AP_COLOR }}
              >
                Fetch All Reports
              </Button>
              <Button
                icon={<CopyOutlined />}
                onClick={copyAllTableScripts}
                size="small"
                style={{ borderColor: '#722ed1', color: '#722ed1' }}
              >
                Copy All Table Scripts
              </Button>
            </div>
          </div>
        }
        destroyOnClose
      >
        <Layout style={{ height: '100%', background: '#fff' }}>
          <Sider
            width={260}
            style={{ background: '#fafafa', borderRight: '1px solid #f0f0f0', height: '100%', overflowY: 'auto' }}
          >
            <div style={{ padding: '12px 12px 8px' }}>
              <Input
                prefix={<SearchOutlined style={{ color: '#aaa' }} />}
                placeholder="Search reports…"
                size="small" allowClear
                value={sideSearch}
                onChange={e => setSideSearch(e.target.value)}
              />
            </div>
            <Divider style={{ margin: '0 0 4px' }} />

            {filteredReports.map(report => {
              const isOpen   = openTabs.includes(report.id);
              const state    = tabStates[report.id];
              const isActive = activeTab === report.id;
              const bp       = state?.batchProgress;

              return (
                <div
                  key={report.id}
                  onClick={() => openReport(report.id)}
                  style={{
                    padding: '8px 12px', cursor: 'pointer',
                    background: isActive ? '#e6f4ff' : isOpen ? '#f6ffed' : 'transparent',
                    borderLeft: isActive ? `3px solid ${AP_COLOR}` : isOpen ? '3px solid #52c41a' : '3px solid transparent',
                    borderBottom: '1px solid #f5f5f5',
                    transition: 'background 0.15s',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Text style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: isActive ? 700 : 500 }} ellipsis>
                      {report.label}
                    </Text>
                    {state?.loading && <SyncOutlined spin style={{ fontSize: 10, color: AP_COLOR }} />}
                    {bp && (
                      <Tag color="processing" style={{ fontSize: 9, padding: '0 3px', lineHeight: '14px', marginLeft: 'auto' }}>
                        {bp.rowsFetched.toLocaleString()}…
                      </Tag>
                    )}
                    {state?.rows.length && !state.loading
                      ? <Tag color="green" style={{ fontSize: 9, padding: '0 3px', lineHeight: '14px', marginLeft: 'auto' }}>
                          {state.rows.length.toLocaleString()}
                        </Tag>
                      : null}
                    {state?.error && <Tag color="red" style={{ fontSize: 9, padding: '0 3px', lineHeight: '14px', marginLeft: 'auto' }}>ERR</Tag>}
                  </div>
                  <Text type="secondary" style={{ fontSize: 10 }} ellipsis>{report.description}</Text>
                </div>
              );
            })}
          </Sider>

          <Content style={{ padding: 16, overflowY: 'auto', height: '100%' }}>
            {openTabs.length === 0 ? (
              <div style={{ textAlign: 'center', paddingTop: 80, color: '#8c8c8c' }}>
                <AuditOutlined style={{ fontSize: 64, color: '#d9d9d9', marginBottom: 16 }} />
                <div style={{ fontSize: 16, marginBottom: 8 }}>No reports open</div>
                <div style={{ fontSize: 13 }}>Click a report in the left panel to open it</div>
              </div>
            ) : (
              <Tabs
                type="editable-card"
                hideAdd
                activeKey={activeTab}
                onChange={setActiveTab}
                onEdit={(key, action) => { if (action === 'remove') closeTab(key as string); }}
                items={tabItems}
                style={{ height: '100%' }}
              />
            )}
          </Content>
        </Layout>
      </Modal>

      {renderColModal()}
    </>
  );
};

export default APPayablesSync;
