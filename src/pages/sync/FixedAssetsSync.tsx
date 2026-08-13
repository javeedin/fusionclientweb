import React, { useState, useCallback } from 'react';
import {
  Modal, Layout, Tabs, Button, Table, Space, Tag, Spin,
  Alert, Tooltip, Typography, Badge, Divider, Input, message, Select,
} from 'antd';
import {
  AuditOutlined, CloudDownloadOutlined, FileExcelOutlined,
  SyncOutlined, InfoCircleOutlined, SearchOutlined,
  CheckCircleOutlined, ClockCircleOutlined, ApiOutlined, CopyOutlined,
  UnorderedListOutlined, TableOutlined, CloudUploadOutlined,
} from '@ant-design/icons';
import { ORACLE_SOAP_CONFIG } from '../../config/api.config';
import { callSoapBip, insertToApex } from '../../services/sync-http';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';

const { Sider, Content } = Layout;
const { Text, Title } = Typography;

const FA_BASE_PATH = '/Custom/FA_REPORTS/ReERPFAreports';

// Maps BIP report ID → APEX REST endpoint (POST reerp/fa/<entity>)
// Reports without a procedure are omitted (MASS_ADDITIONS, TRANSFER_DETAILS, etc.)
const APEX_ENDPOINT_MAP: Record<string, string> = {
  FA_ADDITIONS_B:          'fa/additions',
  FA_ADDITIONS_TL:         'fa/additions-tl',
  FA_ASSET_HISTORY:        'fa/asset-history',
  FA_BOOKS:                'fa/books',
  FA_BOOK_CONTROLS:        'fa/book-controls',
  FA_CATEGORIES_B:         'fa/categories-b',
  FA_CATEGORIES_TL:        'fa/categories-tl',
  FA_CATEGORY_BOOKS:       'fa/category-books',
  FA_DEPRN_SUMMARY:        'fa/deprn-summary',
  FA_DEPRN_PERIODS:        'fa/deprn-periods',
  FA_DISTRIBUTION_HISTORY: 'fa/distribution-history',
  FA_LOCATIONS:            'fa/locations',
  FA_RETIREMENTS:          'fa/retirements',
  FA_TRANSACTION_HEADERS:  'fa/transaction-headers',
  FA_DEPRN_DETAIL:         'fa/deprn-detail',
  FA_ASSET_INVOICES:       'fa/asset-invoices',
  FA_ADJUSTMENTS:          'fa/adjustments',
  FA_METHODS:              'fa/methods',
  FA_CALENDAR_PERIODS:     'fa/calendar-periods',
  FA_CONVENTION_TYPES:     'fa/convention-types',
  FA_BOOKS_SUMMARY:        'fa/books-summary',
};

const FA_REPORTS = [
  { id: 'FA_ADDITIONS_B',         label: 'FA_ADDITIONS_B',         description: 'Asset identity' },
  { id: 'FA_ADDITIONS_TL',        label: 'FA_ADDITIONS_TL',        description: 'Asset description' },
  { id: 'FA_ASSET_HISTORY',       label: 'FA_ASSET_HISTORY',       description: 'Category + BOOK_TYPE_CODE per asset' },
  { id: 'FA_BOOKS',               label: 'FA_BOOKS',               description: 'Cost, depreciation info' },
  { id: 'FA_BOOK_CONTROLS',       label: 'FA_BOOK_CONTROLS',       description: 'Book name, ledger, calendar' },
  { id: 'FA_CATEGORIES_B',        label: 'FA_CATEGORIES_B',        description: 'Category segments (SEGMENT1, SEGMENT2)' },
  { id: 'FA_CATEGORIES_TL',       label: 'FA_CATEGORIES_TL',       description: 'Category description' },
  { id: 'FA_CATEGORY_BOOKS',      label: 'FA_CATEGORY_BOOKS',      description: 'GL account CCIDs per category+book' },
  { id: 'FA_DEPRN_SUMMARY',       label: 'FA_DEPRN_SUMMARY',       description: 'NBV, YTD, accumulated depreciation' },
  { id: 'FA_DEPRN_PERIODS',       label: 'FA_DEPRN_PERIODS',       description: 'Period names per book' },
  { id: 'FA_DISTRIBUTION_HISTORY',label: 'FA_DISTRIBUTION_HISTORY',description: 'Cost center, location, employee' },
  { id: 'FA_LOCATIONS',           label: 'FA_LOCATIONS',           description: 'Location description' },
  { id: 'FA_RETIREMENTS',         label: 'FA_RETIREMENTS',         description: 'Retired assets' },
  { id: 'FA_TRANSACTION_HEADERS', label: 'FA_TRANSACTION_HEADERS', description: 'Transaction audit trail' },
  { id: 'FA_DEPRN_DETAIL',        label: 'FA_DEPRN_DETAIL',        description: 'Depreciation by distribution line' },
  { id: 'FA_ASSET_INVOICES',      label: 'FA_ASSET_INVOICES',      description: 'AP/PO source' },
  { id: 'FA_MASS_ADDITIONS',      label: 'FA_MASS_ADDITIONS',      description: 'AP interface' },
  { id: 'FA_ADJUSTMENTS',         label: 'FA_ADJUSTMENTS',         description: 'GL journal lines' },
  { id: 'FA_METHODS',             label: 'FA_METHODS',             description: 'Depreciation method names' },
  { id: 'FA_CALENDAR_PERIODS',    label: 'FA_CALENDAR_PERIODS',    description: 'Calendar dates' },
  { id: 'FA_CONVENTION_TYPES',    label: 'FA_CONVENTION_TYPES',    description: 'Prorate convention names' },
  { id: 'FA_TRANSFER_DETAILS',    label: 'FA_TRANSFER_DETAILS',    description: 'Transfer details' },
  { id: 'FA_MASS_TRANSACTIONS',   label: 'FA_MASS_TRANSACTIONS',   description: 'Mass transaction requests' },
  { id: 'FA_LEASE_DETAILS',       label: 'FA_LEASE_DETAILS',       description: 'Lease information' },
  { id: 'FA_ADD_WARRANTIES',      label: 'FA_ADD_WARRANTIES',      description: 'Warranty information' },
  { id: 'FA_BOOKS_SUMMARY',       label: 'FA_BOOKS_SUMMARY',       description: 'Group assets only' },
];

interface TabState {
  loading: boolean;
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

// Generic XML parser — auto-detects row element and columns
const parseGenericXml = (xmlString: string): { columns: string[]; rows: Record<string, string>[] } => {
  if (!xmlString.trim()) return { columns: [], rows: [] };

  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, 'text/xml');

  // Try G_1 first (standard BIP row element), then find most-repeated child
  let elements: NodeListOf<Element> | Element[] = doc.querySelectorAll('G_1');

  if (elements.length === 0) {
    const root = doc.documentElement;
    const childCounts = new Map<string, number>();
    Array.from(root.children).forEach(c => childCounts.set(c.tagName, (childCounts.get(c.tagName) || 0) + 1));
    let best = { tag: '', count: 0 };
    childCounts.forEach((count, tag) => { if (count > best.count) best = { tag, count }; });
    if (best.tag) elements = doc.querySelectorAll(best.tag);
  }

  if (elements.length === 0) return { columns: [], rows: [] };

  // Collect all column names from ALL rows (union) in case first row is sparse
  const colSet = new Set<string>();
  const colOrder: string[] = [];
  Array.from(elements).slice(0, 5).forEach(el => {
    Array.from(el.children).forEach(c => {
      if (!colSet.has(c.tagName)) { colSet.add(c.tagName); colOrder.push(c.tagName); }
    });
  });

  const rows: Record<string, string>[] = Array.from(elements).map(el => {
    const row: Record<string, string> = {};
    colOrder.forEach(col => {
      row[col] = el.querySelector(col)?.textContent?.trim() || '';
    });
    return row;
  });

  return { columns: colOrder, rows };
};

// ── Component ─────────────────────────────────────────────────────────────────
interface Props { open: boolean; onClose: () => void; }

const FixedAssetsSync: React.FC<Props> = ({ open, onClose }) => {
  const [openTabs, setOpenTabs]     = useState<string[]>([]);
  const [activeTab, setActiveTab]   = useState<string>('');
  const [tabStates, setTabStates]   = useState<Record<string, TabState>>({});
  const [sideSearch, setSideSearch] = useState('');
  const [colModal, setColModal]         = useState<{ reportId: string; columns: string[] } | null>(null);
  const [colCopyFmt, setColCopyFmt]     = useState<'list' | 'ddl' | 'insert' | 'select'>('list');
  const [apiExpanded, setApiExpanded]   = useState<Record<string, boolean>>({});
  const [fetchingAll, setFetchingAll]   = useState(false);
  const [fetchAllProgress, setFetchAllProgress] = useState<{ done: number; total: number } | null>(null);
  const [tabSyncing, setTabSyncing]     = useState<Record<string, boolean>>({});
  const [tabSyncResult, setTabSyncResult] = useState<Record<string, { success: boolean; message?: string; error?: string } | null>>({});

  const openReport = (reportId: string) => {
    if (!openTabs.includes(reportId)) {
      setOpenTabs(prev => [...prev, reportId]);
    }
    setActiveTab(reportId);
  };

  const closeTab = (reportId: string) => {
    const newTabs = openTabs.filter(t => t !== reportId);
    setOpenTabs(newTabs);
    if (activeTab === reportId) setActiveTab(newTabs[newTabs.length - 1] || '');
    setTabStates(prev => { const n = { ...prev }; delete n[reportId]; return n; });
  };

  const fetchReport = useCallback(async (reportId: string) => {
    const reportPath = `${FA_BASE_PATH}/${reportId}_BIP.xdo`;
    const env        = ORACLE_SOAP_CONFIG.prod;
    const envelope   = buildSoapEnvelope(reportPath, {}, env.username, env.password);
    // Mask password in the displayed envelope
    const displayEnvelope = envelope.replace(
      /<v2:password>[^<]*<\/v2:password>/,
      '<v2:password>••••••••</v2:password>',
    );

    setTabStates(prev => ({
      ...prev,
      [reportId]: {
        loading: true, error: null, rawErrorDetail: null,
        columns: [], rows: [], duration: null, gridSearch: '',
        rawEnvelope: displayEnvelope,
        soapUrl: env.baseUrl,
      },
    }));

    const result = await callSoapBip(env.baseUrl, envelope);

    if (!result.success || !result.decodedXml) {
      setTabStates(prev => ({
        ...prev,
        [reportId]: {
          ...prev[reportId],
          loading: false,
          error: result.error || 'SOAP call failed — no data returned',
          rawErrorDetail: (result as any).details || null,
          duration: result.duration ?? null,
        },
      }));
      return;
    }

    const { columns, rows } = parseGenericXml(result.decodedXml);
    setTabStates(prev => ({
      ...prev,
      [reportId]: {
        ...prev[reportId],
        loading: false, error: null, rawErrorDetail: null,
        columns, rows,
        duration: result.duration ?? null,
      },
    }));
  }, []);

  // Post fetched rows to APEX for a single report
  const syncToApex = useCallback(async (reportId: string) => {
    const endpoint = APEX_ENDPOINT_MAP[reportId];
    const rows     = tabStates[reportId]?.rows;
    if (!endpoint || !rows?.length) return;

    setTabSyncing(prev  => ({ ...prev, [reportId]: true }));
    setTabSyncResult(prev => ({ ...prev, [reportId]: null }));

    try {
      // Payload = JSON array; column names are already uppercase from the BIP parser
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
      if (ok) {
        message.success(`${reportId}: ${rows.length} rows posted to APEX`);
      } else {
        message.error(`${reportId}: ${result?.error || 'Post failed'}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setTabSyncResult(prev => ({ ...prev, [reportId]: { success: false, error: msg } }));
      message.error(`${reportId}: ${msg}`);
    } finally {
      setTabSyncing(prev => ({ ...prev, [reportId]: false }));
    }
  }, [tabStates]);

  // Fetch all 26 reports sequentially
  const fetchAllReports = useCallback(async () => {
    setFetchingAll(true);
    setFetchAllProgress({ done: 0, total: FA_REPORTS.length });

    // Open all tabs first
    setOpenTabs(FA_REPORTS.map(r => r.id));
    setActiveTab(FA_REPORTS[0].id);

    for (let i = 0; i < FA_REPORTS.length; i++) {
      const { id } = FA_REPORTS[i];
      setActiveTab(id);

      const reportPath  = `${FA_BASE_PATH}/${id}_BIP.xdo`;
      const env         = ORACLE_SOAP_CONFIG.prod;
      const envelope    = buildSoapEnvelope(reportPath, {}, env.username, env.password);
      const displayEnv  = envelope.replace(
        /<v2:password>[^<]*<\/v2:password>/,
        '<v2:password>••••••••</v2:password>',
      );

      setTabStates(prev => ({
        ...prev,
        [id]: {
          loading: true, error: null, rawErrorDetail: null,
          columns: [], rows: [], duration: null, gridSearch: '',
          rawEnvelope: displayEnv, soapUrl: env.baseUrl,
        },
      }));

      const result = await callSoapBip(env.baseUrl, envelope);

      if (!result.success || !result.decodedXml) {
        setTabStates(prev => ({
          ...prev,
          [id]: {
            ...prev[id],
            loading: false,
            error: result.error || 'SOAP call failed',
            rawErrorDetail: (result as any).details || null,
            duration: result.duration ?? null,
          },
        }));
      } else {
        const { columns, rows } = parseGenericXml(result.decodedXml);
        setTabStates(prev => ({
          ...prev,
          [id]: {
            ...prev[id],
            loading: false, error: null, rawErrorDetail: null,
            columns, rows, duration: result.duration ?? null,
          },
        }));
      }

      setFetchAllProgress({ done: i + 1, total: FA_REPORTS.length });
    }

    setFetchingAll(false);
    message.success(`Fetched all ${FA_REPORTS.length} FA reports`);
  }, [fetchReport]);

  // Copy all CREATE TABLE scripts for fetched reports
  const copyAllTableScripts = useCallback(() => {
    const fetched = FA_REPORTS.filter(r => {
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
        `CREATE TABLE RR_FA_${r.id} (`,
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
    const ws = XLSX.utils.json_to_sheet(state.rows);
    const wb = XLSX.utils.book_new();
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

  // Build copy text for column modal
  const buildColCopyText = (reportId: string, columns: string[], fmt: typeof colCopyFmt): string => {
    const tbl = reportId.toLowerCase();
    switch (fmt) {
      case 'list':
        return columns.join('\n');
      case 'ddl':
        return [
          `CREATE TABLE RR_FA_${reportId} (`,
          columns.map((c, i) =>
            `  ${c.padEnd(40)} VARCHAR2(400)${i < columns.length - 1 ? ',' : ''}`
          ).join('\n'),
          `);`,
        ].join('\n');
      case 'insert':
        return [
          `INSERT INTO RR_FA_${reportId} (`,
          `  ${columns.join(',\n  ')}`,
          `) VALUES (`,
          `  ${columns.map(c => `:${c.toLowerCase()}`).join(',\n  ')}`,
          `);`,
        ].join('\n');
      case 'select':
        return `SELECT\n  ${columns.join(',\n  ')}\nFROM RR_FA_${reportId};`;
      default:
        return columns.join('\n');
    }
  };

  // Columns viewer modal
  const renderColModal = () => {
    if (!colModal) return null;
    const { reportId, columns } = colModal;
    const copyText = buildColCopyText(reportId, columns, colCopyFmt);

    const fmtOptions = [
      { value: 'list',   label: 'Plain List' },
      { value: 'ddl',    label: 'CREATE TABLE DDL' },
      { value: 'insert', label: 'INSERT INTO template' },
      { value: 'select', label: 'SELECT statement' },
    ];

    return (
      <Modal
        open
        onCancel={() => setColModal(null)}
        footer={null}
        width={760}
        title={
          <Space>
            <UnorderedListOutlined style={{ color: '#C74634' }} />
            <span>All Columns — <code style={{ fontSize: 13 }}>{reportId}</code></span>
            <Tag color="blue">{columns.length} columns</Tag>
          </Space>
        }
      >
        {/* Format selector + copy */}
        <Space style={{ marginBottom: 12 }} wrap>
          <span style={{ fontSize: 12, color: '#595959' }}>Copy as:</span>
          <Select
            value={colCopyFmt}
            onChange={v => setColCopyFmt(v)}
            size="small"
            style={{ width: 200 }}
            options={fmtOptions}
          />
          <Button
            icon={<CopyOutlined />}
            size="small"
            type="primary"
            onClick={() => { navigator.clipboard.writeText(copyText); message.success('Copied!'); }}
          >
            Copy
          </Button>
        </Space>

        {/* Generated text preview */}
        <pre style={{
          background: '#1e1e1e', color: '#9cdcfe',
          borderRadius: 6, padding: '10px 14px',
          fontSize: 11, maxHeight: 260, overflow: 'auto',
          whiteSpace: 'pre', marginBottom: 16,
          lineHeight: 1.6,
        }}>
          {copyText}
        </pre>

        <Divider style={{ margin: '8px 0 12px' }} />

        {/* Full column list as tags */}
        <div style={{ marginBottom: 6, fontSize: 12, color: '#595959', fontWeight: 600 }}>
          <TableOutlined style={{ marginRight: 4 }} />
          All {columns.length} columns:
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxHeight: 300, overflowY: 'auto' }}>
          {columns.map((col, i) => (
            <Tag
              key={col}
              style={{ fontFamily: 'monospace', fontSize: 11, cursor: 'pointer', marginBottom: 2 }}
              onClick={() => { navigator.clipboard.writeText(col); message.success(`Copied: ${col}`); }}
              title="Click to copy"
            >
              <span style={{ color: '#8c8c8c', marginRight: 4 }}>{i + 1}.</span>
              {col}
            </Tag>
          ))}
        </div>
        <div style={{ marginTop: 8, fontSize: 11, color: '#aaa' }}>
          Click any column tag to copy its name individually.
        </div>
      </Modal>
    );
  };

  // Reusable API info panel shown on every tab state
  const renderApiPanel = (reportId: string) => {
    const state = tabStates[reportId];
    const reportPath = `${FA_BASE_PATH}/${reportId}_BIP.xdo`;
    const soapUrl    = state?.soapUrl || ORACLE_SOAP_CONFIG.prod.baseUrl;
    const envelope   = state?.rawEnvelope || buildSoapEnvelope(
      reportPath, {},
      ORACLE_SOAP_CONFIG.prod.username, '••••••••',
    );
    const expanded = apiExpanded[reportId] ?? false;
    const toggle   = () => setApiExpanded(prev => ({ ...prev, [reportId]: !prev[reportId] }));

    return (
      <div style={{ marginBottom: 12 }}>
        <div
          onClick={toggle}
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
            {soapUrl}
          </code>
          <span style={{ fontSize: 11, flexShrink: 0 }}>{expanded ? '▲ Hide' : '▼ Show'}</span>
        </div>

        {expanded && (
          <div style={{
            marginTop: 6, padding: '10px 12px', borderRadius: 6,
            background: '#fafafa', border: '1px solid #d9d9d9', fontSize: 12,
          }}>
            {/* Endpoint */}
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

            {/* Report path */}
            <div style={{ marginBottom: 6 }}>
              <Text type="secondary" style={{ fontSize: 11 }}>Report Path (reportAbsolutePath)</Text>
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

            {/* Full XML envelope */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <Text type="secondary" style={{ fontSize: 11 }}>Full XML Payload (password masked)</Text>
                <Tooltip title="Copy XML">
                  <CopyOutlined style={{ cursor: 'pointer', color: '#595959', fontSize: 12 }}
                    onClick={() => { navigator.clipboard.writeText(envelope); message.success('XML copied'); }} />
                </Tooltip>
              </div>
              <pre style={{
                margin: 0, padding: '8px 10px',
                background: '#1e1e1e', color: '#9cdcfe',
                borderRadius: 4, fontSize: 10,
                maxHeight: 260, overflow: 'auto',
                whiteSpace: 'pre', wordBreak: 'normal',
                lineHeight: 1.5,
              }}>
                {envelope}
              </pre>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderTabContent = (reportId: string) => {
    const report = FA_REPORTS.find(r => r.id === reportId)!;
    const state  = tabStates[reportId];

    if (!state) {
      return (
        <div>
          {renderApiPanel(reportId)}
          <div style={{ padding: 32, textAlign: 'center' }}>
            <AuditOutlined style={{ fontSize: 48, color: '#d9d9d9', marginBottom: 16 }} />
            <div style={{ color: '#8c8c8c', marginBottom: 24 }}>
              Click <strong>Fetch Data</strong> to run the BIP report
            </div>
            <Button type="primary" icon={<CloudDownloadOutlined />} size="large"
              onClick={() => fetchReport(reportId)}>
              Fetch Data
            </Button>
          </div>
        </div>
      );
    }

    if (state.loading) {
      return (
        <div>
          {renderApiPanel(reportId)}
          <div style={{ padding: 48, textAlign: 'center' }}>
            <Spin size="large" />
            <div style={{ marginTop: 16, color: '#8c8c8c' }}>Running SOAP call to Oracle BI Publisher…</div>
          </div>
        </div>
      );
    }

    if (state.error) {
      return (
        <div style={{ padding: 0 }}>
          {renderApiPanel(reportId)}
          <Alert
            type="error" showIcon
            message={`SOAP Call Failed — ${state.error}`}
            description={
              state.rawErrorDetail
                ? <pre style={{ fontSize: 11, maxHeight: 120, overflow: 'auto', whiteSpace: 'pre-wrap', marginTop: 8 }}>
                    {state.rawErrorDetail}
                  </pre>
                : 'Check the XML payload above — verify the report path exists in Oracle BIP and credentials are correct.'
            }
            style={{ marginBottom: 12 }}
          />
          <Button icon={<CloudDownloadOutlined />} onClick={() => fetchReport(reportId)}>Retry</Button>
        </div>
      );
    }

    // Success state — show API panel collapsed by default, then toolbar + grid
    return (
      <div>
        {renderApiPanel(reportId)}
        {renderSuccessContent(reportId, report, state)}
      </div>
    );
  };

  // Success grid + toolbar extracted to avoid nesting issues
  const renderSuccessContent = (reportId: string, report: typeof FA_REPORTS[0], state: TabState) => {
    // Filter rows by grid search
    const search = state.gridSearch.toLowerCase();
    const filtered = search
      ? state.rows.filter(r => Object.values(r).some(v => v.toLowerCase().includes(search)))
      : state.rows;

    // Build dynamic columns
    const tableCols = state.columns.map(col => ({
      title: col,
      dataIndex: col,
      key: col,
      width: 140,
      ellipsis: true,
      render: (v: string) => (
        <Text style={{ fontFamily: 'monospace', fontSize: 11 }}>{v || <span style={{ color: '#d9d9d9' }}>—</span>}</Text>
      ),
    }));

    return (
      <div>
        {/* Toolbar */}
        <Space style={{ marginBottom: 12 }} wrap>
          <Button
            type="primary"
            icon={<CloudDownloadOutlined />}
            onClick={() => fetchReport(reportId)}
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
              style={{ borderColor: '#C74634', color: '#C74634' }}
            >
              Post to APEX
            </Button>
          ) : (
            <Tooltip title="No APEX procedure for this report">
              <Button icon={<CloudUploadOutlined />} disabled>Post to APEX</Button>
            </Tooltip>
          )}
          <Input.Search
            placeholder="Search grid…"
            allowClear
            size="small"
            style={{ width: 200 }}
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
        </Space>

        {/* APEX sync result */}
        {tabSyncResult[reportId] && (
          <Alert
            type={tabSyncResult[reportId]!.success ? 'success' : 'error'}
            showIcon
            closable
            onClose={() => setTabSyncResult(prev => ({ ...prev, [reportId]: null }))}
            message={
              tabSyncResult[reportId]!.success
                ? tabSyncResult[reportId]!.message
                : `Post to APEX failed: ${tabSyncResult[reportId]!.error}`
            }
            style={{ marginBottom: 10, fontSize: 12 }}
          />
        )}

        {/* Report path info */}
        <div style={{ marginBottom: 8, fontSize: 11, color: '#8c8c8c', fontFamily: 'monospace' }}>
          <InfoCircleOutlined style={{ marginRight: 4 }} />
          {FA_BASE_PATH}/{reportId}_BIP.xdo
          {' · '}
          {report.description}
        </div>

        <Table
          dataSource={filtered.map((r, i) => ({ ...r, _key: i }))}
          rowKey="_key"
          columns={tableCols}
          size="small"
          scroll={{ x: state.columns.length * 140, y: 420 }}
          pagination={{ pageSize: 100, showSizeChanger: true, showQuickJumper: true }}
          bordered
        />
      </div>
    );
  };

  const filteredReports = sideSearch.trim()
    ? FA_REPORTS.filter(r =>
        r.label.toLowerCase().includes(sideSearch.toLowerCase()) ||
        r.description.toLowerCase().includes(sideSearch.toLowerCase())
      )
    : FA_REPORTS;

  const tabItems = openTabs.map(id => {
    const report = FA_REPORTS.find(r => r.id === id)!;
    const state  = tabStates[id];
    return {
      key: id,
      closable: true,
      label: (
        <span style={{ fontSize: 12 }}>
          {state?.loading && <SyncOutlined spin style={{ marginRight: 4 }} />}
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
          <AuditOutlined style={{ color: '#C74634', fontSize: 18 }} />
          <span style={{ fontWeight: 700 }}>Fixed Assets — BIP Reports</span>
          <Tag color="orange">{FA_REPORTS.length} Reports</Tag>
          <Tag color="blue" style={{ fontFamily: 'monospace', fontSize: 11 }}>{FA_BASE_PATH}</Tag>

          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            {/* Progress indicator */}
            {fetchAllProgress && fetchingAll && (
              <Tag color="processing">
                {fetchAllProgress.done} / {fetchAllProgress.total}
              </Tag>
            )}

            {/* Fetch All */}
            <Button
              type="primary"
              icon={fetchingAll ? <SyncOutlined spin /> : <CloudDownloadOutlined />}
              loading={fetchingAll}
              onClick={fetchAllReports}
              size="small"
              style={{ background: '#C74634', borderColor: '#C74634' }}
            >
              Fetch All Reports
            </Button>

            {/* Copy All Table Scripts */}
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
        {/* Left sidebar — report list */}
        <Sider
          width={260}
          style={{
            background: '#fafafa',
            borderRight: '1px solid #f0f0f0',
            height: '100%',
            overflowY: 'auto',
          }}
        >
          <div style={{ padding: '12px 12px 8px' }}>
            <Input
              prefix={<SearchOutlined style={{ color: '#aaa' }} />}
              placeholder="Search reports…"
              size="small"
              allowClear
              value={sideSearch}
              onChange={e => setSideSearch(e.target.value)}
            />
          </div>
          <Divider style={{ margin: '0 0 4px' }} />

          {filteredReports.map(report => {
            const isOpen   = openTabs.includes(report.id);
            const state    = tabStates[report.id];
            const isActive = activeTab === report.id;

            return (
              <div
                key={report.id}
                onClick={() => openReport(report.id)}
                style={{
                  padding: '8px 12px',
                  cursor: 'pointer',
                  background: isActive ? '#fff2e8' : isOpen ? '#f6ffed' : 'transparent',
                  borderLeft: isActive ? '3px solid #C74634' : isOpen ? '3px solid #52c41a' : '3px solid transparent',
                  borderBottom: '1px solid #f5f5f5',
                  transition: 'background 0.15s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Text
                    style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: isActive ? 700 : 500 }}
                    ellipsis
                  >
                    {report.label}
                  </Text>
                  {state?.loading && <SyncOutlined spin style={{ fontSize: 10, color: '#C74634' }} />}
                  {state?.rows.length && !state.loading
                    ? <Tag color="green" style={{ fontSize: 9, padding: '0 3px', lineHeight: '14px', marginLeft: 'auto' }}>
                        {state.rows.length}
                      </Tag>
                    : null}
                  {state?.error && <Tag color="red" style={{ fontSize: 9, padding: '0 3px', lineHeight: '14px', marginLeft: 'auto' }}>ERR</Tag>}
                </div>
                <Text type="secondary" style={{ fontSize: 10 }} ellipsis>{report.description}</Text>
              </div>
            );
          })}
        </Sider>

        {/* Main tabbed content */}
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
              onEdit={(key, action) => {
                if (action === 'remove') closeTab(key as string);
              }}
              items={tabItems}
              style={{ height: '100%' }}
            />
          )}
        </Content>
      </Layout>
    </Modal>

    {/* Columns viewer modal */}
    {renderColModal()}
    </>
  );
};

export default FixedAssetsSync;
