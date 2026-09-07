// ── Fusion SQL ──────────────────────────────────────────────────────────────
// A CloudMiner-style live query tool over the Oracle Fusion pod: SQL editor +
// schema browser + results grid. Runs SELECTs through BI Publisher's
// runReport SOAP service (main-process fusion-sql.cjs) against a "query
// runner" report deployed once in the pod (see fusion/bip/README.md). The
// schema browser bootstraps itself by running data-dictionary queries through
// the same runner. Read-only. Groundwork for a live-Fusion Claude tool.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Button, Card, Drawer, Dropdown, Empty, Input, InputNumber, Segmented, Select, Space, Table,
  Tabs, Tag, Tooltip, Typography, message as antMessage,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  ApiOutlined, CaretRightOutlined, DatabaseOutlined, FileExcelOutlined, FilePdfOutlined,
  FileTextOutlined, PlayCircleOutlined, ReloadOutlined, SearchOutlined, SettingOutlined,
  TableOutlined, ThunderboltOutlined,
} from '@ant-design/icons';
import ExcelJS from 'exceljs';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import dayjs from 'dayjs';

const { Text } = Typography;

interface FusionSqlApi {
  fusionSqlConfig?: (patch?: Record<string, unknown>) => Promise<{ success: boolean; config?: FsConfig; error?: string }>;
  fusionSqlExecute?: (opts: { sql: string; rowLimit?: number }) => Promise<FsResult>;
  fusionSqlDeploy?: () => Promise<{ success: boolean; message?: string; error?: string; steps?: string[]; raw?: string }>;
  fusionSqlCalls?: (opts?: { clear?: boolean }) => Promise<{ success: boolean; calls: ApiCall[]; error?: string }>;
  getFusionCredentials?: () => Promise<{ username: string; password: string } | null>;
  saveFusionCredentials?: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  openExcel?: (buf: unknown, filename: string) => Promise<unknown>;
}
interface FsConfig { baseUrl?: string; reportPath?: string; dataModelPath?: string; folderPath?: string; dataSource?: string; rowLimit?: number }
interface ApiCall { at: number; kind: string; protocol: string; url: string; status: number; request: string; response: string }
interface FsResult {
  success: boolean; rows?: Record<string, unknown>[]; columns?: string[];
  rowCount?: number; capped?: boolean; error?: string; raw?: string;
}
const getApi = (): FusionSqlApi | undefined => {
  const api = (window as unknown as { electronAPI?: FusionSqlApi }).electronAPI;
  return api?.fusionSqlExecute ? api : undefined;
};

const HIST_KEY = 'reerp.fusionsql.history';
const sqlEsc = (s: string) => s.replace(/'/g, "''");
const cell = (v: unknown): string => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
const isIdCol = (k: string) => /(_id|_number|id|number)$/i.test(k);

const FusionSql: React.FC = () => {
  const api = getApi();
  const [cfg, setCfg] = useState<FsConfig>({ reportPath: '/Custom/ReERP/QueryRunner.xdo', rowLimit: 100 });
  const [sql, setSql] = useState('select * from ra_batches_all');
  const [rowLimit, setRowLimit] = useState(100);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<FsResult | null>(null);
  const [gridSearch, setGridSearch] = useState('');
  const [log, setLog] = useState<{ at: number; text: string; ok: boolean }[]>([]);
  const [history, setHistory] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(HIST_KEY) || '[]'); } catch { return []; }
  });

  // schema browser
  const [schemaKind, setSchemaKind] = useState<'TABLE' | 'VIEW' | 'SYNONYM'>('TABLE');
  const [schemaQ, setSchemaQ] = useState('');
  const [schemaList, setSchemaList] = useState<string[]>([]);
  const [schemaBusy, setSchemaBusy] = useState(false);
  const [openObj, setOpenObj] = useState<string | null>(null);
  const [objCols, setObjCols] = useState<Record<string, unknown>[]>([]);

  const [cfgOpen, setCfgOpen] = useState(false);
  const [draft, setDraft] = useState<FsConfig>({});
  const [deploying, setDeploying] = useState(false);
  const [deployMsg, setDeployMsg] = useState<{ ok: boolean; text: string; steps?: string[] } | null>(null);
  const [creds, setCreds] = useState<{ username: string; hasPassword: boolean } | null>(null);
  const [credUser, setCredUser] = useState('');
  const [credPass, setCredPass] = useState('');
  const [apiOpen, setApiOpen] = useState(false);
  const [calls, setCalls] = useState<ApiCall[]>([]);
  const editorRef = useRef<HTMLTextAreaElement>(null);

  const loadCalls = useCallback(async (clear?: boolean) => {
    const r = await api?.fusionSqlCalls?.({ clear });
    if (r?.success) setCalls(r.calls || []);
  }, [api]);

  const loadCreds = useCallback(async () => {
    try {
      const c = await api?.getFusionCredentials?.();
      if (c && c.username) { setCreds({ username: c.username, hasPassword: !!c.password }); setCredUser(c.username); }
      else setCreds(null);
    } catch { setCreds(null); }
  }, [api]);
  useEffect(() => { loadCreds(); }, [loadCreds]);

  useEffect(() => {
    api?.fusionSqlConfig?.().then(r => {
      if (r?.success && r.config) { setCfg(r.config); setRowLimit(r.config.rowLimit || 100); }
    }).catch(() => { /* ignore */ });
  }, [api]);

  const addLog = (text: string, ok: boolean) => setLog(l => [{ at: Date.now(), text, ok }, ...l].slice(0, 50));

  const run = useCallback(async (stmt?: string) => {
    const q = (stmt ?? sql).trim();
    if (!q || running || !api) return;
    setRunning(true);
    const t0 = Date.now();
    try {
      const r = await api.fusionSqlExecute!({ sql: q, rowLimit });
      setResult(r);
      setGridSearch('');
      if (r.success) {
        addLog(`${r.rowCount ?? 0} rows in ${Date.now() - t0} ms — ${q.slice(0, 80)}`, true);
        setHistory(prev => {
          const next = [q, ...prev.filter(x => x !== q)].slice(0, 30);
          try { localStorage.setItem(HIST_KEY, JSON.stringify(next)); } catch { /* ignore */ }
          return next;
        });
      } else {
        addLog(`ERROR: ${r.error} — ${q.slice(0, 80)}`, false);
      }
      if (apiOpen) loadCalls();
    } finally {
      setRunning(false);
    }
  }, [sql, rowLimit, running, api]);

  // schema browser: run a dictionary query through the same runner
  const loadSchema = useCallback(async () => {
    if (!api) return;
    setSchemaBusy(true);
    const like = schemaQ.trim() ? `AND UPPER(object_name) LIKE '%${sqlEsc(schemaQ.trim().toUpperCase())}%'` : '';
    const q = `SELECT object_name FROM all_objects WHERE owner='FUSION' AND object_type='${schemaKind}' ${like} ORDER BY object_name`;
    try {
      const r = await api.fusionSqlExecute!({ sql: q, rowLimit: 300 });
      setSchemaList(r.success && r.rows ? r.rows.map(x => String(x.OBJECT_NAME ?? x.object_name ?? '')).filter(Boolean) : []);
      if (!r.success) antMessage.error(r.error || 'Schema query failed');
    } finally { setSchemaBusy(false); }
  }, [api, schemaKind, schemaQ]);

  const loadColumns = useCallback(async (name: string) => {
    if (openObj === name) { setOpenObj(null); return; }
    setOpenObj(name);
    setObjCols([]);
    const q = `SELECT column_name, data_type, data_length, nullable FROM all_tab_columns WHERE owner='FUSION' AND table_name='${sqlEsc(name)}' ORDER BY column_id`;
    const r = await api!.fusionSqlExecute!({ sql: q, rowLimit: 500 });
    if (r.success && r.rows) setObjCols(r.rows);
  }, [api, openObj]);

  const insert = (text: string) => {
    const el = editorRef.current;
    if (!el) { setSql(s => `${s} ${text}`); return; }
    const start = el.selectionStart ?? sql.length;
    const end = el.selectionEnd ?? sql.length;
    setSql(sql.slice(0, start) + text + sql.slice(end));
    requestAnimationFrame(() => { el.focus(); const p = start + text.length; el.setSelectionRange(p, p); });
  };

  // ── results grid ───────────────────────────────────────────────────────────
  const rows = result?.rows || [];
  const filtered = useMemo(() => {
    const s = gridSearch.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter(r => Object.values(r).some(v => cell(v).toLowerCase().includes(s)));
  }, [rows, gridSearch]);
  const gridCols = useMemo<ColumnsType<Record<string, unknown>>>(() => {
    if (!rows.length) return [];
    return Object.keys(rows[0]).map(k => ({
      title: k, dataIndex: k, key: k, ellipsis: true,
      sorter: (a, b) => {
        const av = a[k], bv = b[k];
        if (typeof av === 'number' && typeof bv === 'number') return av - bv;
        return String(av ?? '').localeCompare(String(bv ?? ''));
      },
      render: (v: unknown) => (typeof v === 'number' && !isIdCol(k)
        ? <span style={{ display: 'block', textAlign: 'right' }}>{v.toLocaleString()}</span>
        : cell(v)),
    }));
  }, [rows]);

  const exportExcel = async () => {
    if (!filtered.length) return;
    const keys = Object.keys(rows[0]);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Query');
    const head = ws.addRow(keys);
    head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    head.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC74634' } }; });
    filtered.forEach(r => ws.addRow(keys.map(k => (typeof r[k] === 'number' && !isIdCol(k) ? r[k] : cell(r[k])))));
    keys.forEach((k, i) => { ws.getColumn(i + 1).width = Math.min(45, Math.max(12, k.length + 3)); });
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    const buf = await wb.xlsx.writeBuffer();
    const name = `fusion-query-${dayjs().format('YYYYMMDD-HHmmss')}.xlsx`;
    if (api?.openExcel) await api.openExcel(buf, name); else antMessage.warning('Desktop app required');
  };
  const exportPdf = () => {
    if (!filtered.length) return;
    const keys = Object.keys(rows[0]);
    const doc = new jsPDF({ orientation: keys.length > 6 ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
    autoTable(doc, {
      head: [keys], body: filtered.map(r => keys.map(k => cell(r[k]))), startY: 24,
      styles: { fontSize: 6.5, cellPadding: 2, overflow: 'linebreak' },
      headStyles: { fillColor: [199, 70, 52], textColor: 255 },
      alternateRowStyles: { fillColor: [251, 244, 242] },
    });
    doc.save(`fusion-query-${dayjs().format('YYYYMMDD-HHmmss')}.pdf`);
  };

  const saveCfg = async () => {
    const r = await api?.fusionSqlConfig?.(draft);
    if (r?.success && r.config) { setCfg(r.config); setRowLimit(r.config.rowLimit || 100); antMessage.success('Saved'); }
    else { antMessage.error(r?.error || 'Could not save'); }
    return r?.success;
  };

  const saveCreds = async () => {
    if (!credUser.trim() || !credPass) { antMessage.warning('Enter both username and password'); return; }
    const r = await api?.saveFusionCredentials?.(credUser.trim(), credPass);
    if (r?.success) { antMessage.success('Fusion credentials saved'); setCredPass(''); loadCreds(); }
    else antMessage.error(r?.error || 'Could not save credentials');
  };

  const deploy = async () => {
    if (!api?.fusionSqlDeploy) return;
    if (!creds?.hasPassword) { antMessage.warning('Save your Fusion username & password first (below)'); return; }
    // save current settings first so the deploy uses them
    await saveCfg();
    setDeploying(true);
    setDeployMsg(null);
    try {
      const r = await api.fusionSqlDeploy();
      setDeployMsg({ ok: !!r?.success, text: r?.success ? (r.message || 'Deployed') : (r?.error || 'Deploy failed'), steps: r?.steps });
      if (r?.success) antMessage.success('Runner report deployed');
      loadCalls();
    } finally { setDeploying(false); }
  };

  if (!api) {
    return <div style={{ padding: 24 }}><Alert type="warning" showIcon message="Fusion SQL is only available in the desktop (Electron) app" /></div>;
  }

  const pod = cfg.baseUrl ? (() => { try { return new URL(cfg.baseUrl).host; } catch { return cfg.baseUrl; } })() : null;

  return (
    <div style={{ padding: 12, height: 'calc(100vh - 92px)', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <style>{`
        .fs-body{flex:1;min-height:0;display:flex;gap:8px}
        .fs-side{width:260px;flex-shrink:0;display:flex;flex-direction:column;min-height:0;background:#fff;border:1px solid #EFEAE8;border-radius:10px}
        .fs-side-head{padding:8px 10px;font-weight:600;font-size:12px;color:#6B6B6B;border-bottom:1px solid #F3EFED;display:flex;align-items:center;gap:6px}
        .fs-obj{display:block;width:100%;text-align:left;border:none;background:none;font-family:Consolas,monospace;font-size:11.5px;
          color:#3A3632;padding:4px 10px;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .fs-obj:hover{background:#F6EEEC;color:#C74634}
        .fs-col{font-family:Consolas,monospace;font-size:11px;color:#6B6B6B;padding:2px 10px 2px 24px;display:flex;gap:8px;cursor:pointer}
        .fs-col:hover{background:#FBF4F2}
        .fs-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:8px}
        .fs-editor{width:100%;min-height:120px;max-height:280px;resize:vertical;border:1px solid #E0D5D2;border-radius:10px;
          padding:12px 14px;font-family:'Cascadia Code',Consolas,monospace;font-size:13.5px;line-height:1.5;outline:none;
          background:#1e1e24;color:#e6e6e6;tab-size:2}
        .fs-editor:focus{border-color:#C74634;box-shadow:0 0 0 2px rgba(199,70,52,.14)}
        .fs-results{flex:1;min-height:0;background:#fff;border:1px solid #EFEAE8;border-radius:10px;display:flex;flex-direction:column;overflow:hidden}
      `}</style>

      <Card size="small" styles={{ body: { padding: '8px 12px' } }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <DatabaseOutlined style={{ fontSize: 18, color: '#C74634' }} />
          <Text strong>Fusion SQL</Text>
          <Tag color="volcano">Live Oracle Fusion</Tag>
          <Tag icon={<ThunderboltOutlined />}>Read-only (SELECT)</Tag>
          {pod ? <Tag color="green">{pod}</Tag> : <Tag color="red">Not configured</Tag>}
          <Tooltip title={creds?.hasPassword ? `Signed in as ${creds.username}` : 'No Fusion credentials — open settings'}>
            <Tag color={creds?.hasPassword ? 'blue' : 'orange'} icon={<ApiOutlined />}>
              {creds?.hasPassword ? creds.username : 'No credentials'}
            </Tag>
          </Tooltip>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 12, color: '#6B6B6B' }}>Row limit</span>
          <InputNumber size="small" min={1} max={100000} value={rowLimit} onChange={v => setRowLimit(v || 100)} style={{ width: 90 }} />
          <Button type="primary" icon={<PlayCircleOutlined />} loading={running} onClick={() => run()}
            style={{ background: '#1D7B4D', borderColor: '#1D7B4D' }}>Execute</Button>
          <Dropdown menu={{ items: history.slice(0, 20).map((h, i) => ({ key: String(i), label: h.slice(0, 80) })), onClick: ({ key }) => setSql(history[Number(key)]) }}>
            <Button icon={<ReloadOutlined />}>History</Button>
          </Dropdown>
          <Tooltip title="API inspector — see the SOAP calls & payloads">
            <Button icon={<ApiOutlined />} onClick={() => { setApiOpen(true); loadCalls(); }} />
          </Tooltip>
          <Tooltip title="Connection settings"><Button icon={<SettingOutlined />} onClick={() => { setDraft(cfg); setCfgOpen(true); }} /></Tooltip>
        </div>
      </Card>

      {!pod && (
        <Alert type="info" showIcon
          message="Set the Fusion pod URL and query-runner report path"
          description={<span>Open <b>Connection settings</b> (gear). The runner report is deployed once in the pod — see <Text code>fusion/bip/README.md</Text>. Uses your saved Fusion credentials.</span>} />
      )}

      <div className="fs-body">
        {/* schema browser */}
        <div className="fs-side">
          <div className="fs-side-head"><TableOutlined /> Schema browser</div>
          <div style={{ padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Segmented size="small" block value={schemaKind} onChange={v => setSchemaKind(v as 'TABLE')}
              options={[{ label: 'Tables', value: 'TABLE' }, { label: 'Views', value: 'VIEW' }, { label: 'Synonyms', value: 'SYNONYM' }]} />
            <Input size="small" prefix={<SearchOutlined />} placeholder="Filter FUSION objects" allowClear
              value={schemaQ} onChange={e => setSchemaQ(e.target.value)} onPressEnter={loadSchema}
              suffix={<CaretRightOutlined onClick={loadSchema} style={{ color: '#C74634', cursor: 'pointer' }} />} />
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {schemaBusy && <Text type="secondary" style={{ fontSize: 12, padding: 10, display: 'block' }}>Loading…</Text>}
            {!schemaBusy && !schemaList.length && (
              <Text type="secondary" style={{ fontSize: 12, padding: 10, display: 'block' }}>
                Type a name and press Enter to search {schemaKind.toLowerCase()}s.
              </Text>
            )}
            {schemaList.map(name => (
              <div key={name}>
                <button className="fs-obj" onClick={() => insert(name.toLowerCase())} onDoubleClick={() => loadColumns(name)}
                  title="Click: insert into editor · Double-click: show columns">
                  <CaretRightOutlined style={{ fontSize: 9, marginRight: 4, transform: openObj === name ? 'rotate(90deg)' : 'none' }}
                    onClick={e => { e.stopPropagation(); loadColumns(name); }} />
                  {name}
                </button>
                {openObj === name && objCols.map((c, i) => (
                  <div key={i} className="fs-col" onClick={() => insert(String(c.COLUMN_NAME ?? c.column_name ?? '').toLowerCase())}>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{String(c.COLUMN_NAME ?? c.column_name ?? '')}</span>
                    <span style={{ color: '#b9aca7' }}>{String(c.DATA_TYPE ?? c.data_type ?? '')}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* editor + results */}
        <div className="fs-main">
          <textarea
            ref={editorRef}
            className="fs-editor"
            spellCheck={false}
            value={sql}
            onChange={e => setSql(e.target.value)}
            onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); } }}
            placeholder="SELECT * FROM ap_invoices_all WHERE ...   (Ctrl+Enter to run)"
          />

          <div className="fs-results">
            <Tabs
              size="small"
              style={{ height: '100%' }}
              tabBarStyle={{ margin: 0, padding: '0 10px' }}
              items={[
                {
                  key: 'results',
                  label: <span><TableOutlined /> Results{result?.success ? ` (${result.rowCount})` : ''}</span>,
                  children: (
                    <div style={{ padding: 8, height: '100%', display: 'flex', flexDirection: 'column' }}>
                      {result && !result.success && (
                        <Alert type="error" showIcon message="Query failed" style={{ marginBottom: 8 }}
                          description={<div><div>{result.error}</div>{result.raw && <pre style={{ fontSize: 11, marginTop: 6, maxHeight: 160, overflow: 'auto' }}>{result.raw}</pre>}</div>} />
                      )}
                      {result?.success && (
                        <>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                            <Input size="small" allowClear prefix={<SearchOutlined />} placeholder="Search results"
                              value={gridSearch} onChange={e => setGridSearch(e.target.value)} style={{ maxWidth: 260 }} />
                            <Text type="secondary" style={{ fontSize: 11, flex: 1 }}>
                              {gridSearch ? `${filtered.length} of ${rows.length}` : `${rows.length} rows`}{result.capped ? ` · capped at ${rowLimit}` : ''}
                            </Text>
                            <Button size="small" icon={<FileExcelOutlined style={{ color: '#1D7B4D' }} />} onClick={exportExcel}>Excel</Button>
                            <Button size="small" icon={<FilePdfOutlined style={{ color: '#C74634' }} />} onClick={exportPdf}>PDF</Button>
                          </div>
                          {rows.length ? (
                            <div style={{ flex: 1, overflow: 'auto' }}>
                              <Table size="small" rowKey={(_r, i) => String(i)} columns={gridCols}
                                dataSource={filtered.map((r, i) => ({ ...r, __k: i }))}
                                pagination={{ pageSize: 100, size: 'small', showSizeChanger: false, showTotal: t => `${t} rows` }}
                                scroll={{ x: 'max-content' }} />
                            </div>
                          ) : <Empty description="Statement ran — no rows returned" />}
                        </>
                      )}
                      {!result && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Run a query to see results" style={{ marginTop: 40 }} />}
                    </div>
                  ),
                },
                {
                  key: 'logs',
                  label: <span><ApiOutlined /> Logs</span>,
                  children: (
                    <div style={{ padding: 10, height: '100%', overflowY: 'auto' }}>
                      {!log.length && <Text type="secondary" style={{ fontSize: 12 }}>Execution log appears here.</Text>}
                      {log.map((l, i) => (
                        <div key={i} style={{ fontFamily: 'Consolas,monospace', fontSize: 11.5, padding: '2px 0', color: l.ok ? '#3A3632' : '#C74634' }}>
                          <span style={{ color: '#b9aca7' }}>{new Date(l.at).toLocaleTimeString()} </span>{l.text}
                        </div>
                      ))}
                    </div>
                  ),
                },
              ]}
            />
          </div>
        </div>
      </div>

      <Drawer title={<span><ApiOutlined /> API inspector — SOAP calls & payloads</span>} open={apiOpen} onClose={() => setApiOpen(false)} width={720}
        extra={<Space><Button size="small" icon={<ReloadOutlined />} onClick={() => loadCalls()}>Refresh</Button><Button size="small" onClick={() => loadCalls(true)}>Clear</Button></Space>}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          Every web-service call this tool makes, newest first — endpoint, request and response payload (password redacted).
          These are <b>SOAP</b> POSTs of XML to the pod's BI Publisher services.
        </Text>
        {!calls.length && <Empty style={{ marginTop: 40 }} description="No calls yet — run a query or deploy" />}
        <div style={{ marginTop: 12 }}>
          {calls.map((c, i) => (
            <details key={i} style={{ marginBottom: 8, border: '1px solid #EFEAE8', borderRadius: 8, padding: '6px 10px' }}>
              <summary style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Tag color={c.status >= 200 && c.status < 300 ? 'green' : 'red'}>{c.status}</Tag>
                <Tag color="blue">{c.protocol}</Tag>
                <b style={{ fontSize: 12.5 }}>{c.kind}</b>
                <Text type="secondary" style={{ fontSize: 11 }}>{new Date(c.at).toLocaleTimeString()}</Text>
                <span style={{ flex: 1 }} />
                <Text type="secondary" style={{ fontSize: 10.5, fontFamily: 'Consolas,monospace', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 320 }}>{c.url}</Text>
              </summary>
              <div style={{ marginTop: 8 }}>
                <Text strong style={{ fontSize: 11.5 }}>Request (XML)</Text>
                <pre style={{ fontSize: 10.5, background: '#1e1e24', color: '#e6e6e6', padding: 8, borderRadius: 6, maxHeight: 260, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{c.request}</pre>
                <Text strong style={{ fontSize: 11.5 }}>Response</Text>
                <pre style={{ fontSize: 10.5, background: '#faf7f6', padding: 8, borderRadius: 6, maxHeight: 260, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{c.response}</pre>
              </div>
            </details>
          ))}
        </div>
      </Drawer>

      <Drawer title="Fusion SQL — connection settings" open={cfgOpen} onClose={() => setCfgOpen(false)} width={500}
        extra={<Button type="primary" onClick={() => saveCfg().then(ok => ok && setCfgOpen(false))} style={{ background: '#C74634', borderColor: '#C74634' }}>Save</Button>}>
        <Space direction="vertical" style={{ width: '100%' }} size={14}>
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>Fusion pod URL</Text>
            <Input placeholder="https://efmh-test.fa.em3.oraclecloud.com" value={draft.baseUrl || ''}
              onChange={e => setDraft({ ...draft, baseUrl: e.target.value })} />
          </div>
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>Query-runner report path (absolute, in the BI catalog)</Text>
            <Input placeholder="/Custom/ReERP/QueryRunner.xdo" value={draft.reportPath || ''}
              onChange={e => setDraft({ ...draft, reportPath: e.target.value })} />
          </div>
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>Default row limit</Text>
            <br />
            <InputNumber min={1} max={100000} value={draft.rowLimit ?? 100} onChange={v => setDraft({ ...draft, rowLimit: v || 100 })} />
          </div>

          <Card size="small" title={<span style={{ fontSize: 13 }}><ApiOutlined /> Fusion credentials</span>}
            styles={{ body: { padding: 12 } }}>
            <Space direction="vertical" style={{ width: '100%' }} size={10}>
              {creds?.hasPassword
                ? <Alert type="success" showIcon style={{ padding: '4px 10px' }}
                    message={<span style={{ fontSize: 12 }}>Saved — <b>{creds.username}</b> (password stored, encrypted)</span>} />
                : <Alert type="warning" showIcon style={{ padding: '4px 10px' }}
                    message={<span style={{ fontSize: 12 }}>
                      {creds ? <>Username <b>{creds.username}</b> is saved, but no password — enter it below.</> : 'No Fusion credentials saved — enter them below.'}
                    </span>} />}
              <Text type="secondary" style={{ fontSize: 11.5 }}>
                Fusion SQL calls the pod's SOAP services with a username/password (the browser SSO login can't supply one).
                Use a dedicated BI account for this — not a personal login.
              </Text>
              <Input placeholder="Fusion username (e.g. SHAIK / user@company.com)" value={credUser}
                onChange={e => setCredUser(e.target.value)} autoComplete="off" />
              <Input.Password placeholder="Fusion password" value={credPass}
                onChange={e => setCredPass(e.target.value)} onPressEnter={saveCreds} autoComplete="new-password" />
              <Button icon={<SettingOutlined />} onClick={saveCreds}>Save credentials</Button>
            </Space>
          </Card>

          <Card size="small" title={<span style={{ fontSize: 13 }}><ThunderboltOutlined /> Auto-deploy runner report</span>}
            styles={{ body: { padding: 12 } }}>
            <Space direction="vertical" style={{ width: '100%' }} size={10}>
              <Text type="secondary" style={{ fontSize: 11.5 }}>
                Creates the folder, data model and report in the BI catalog for you (like CloudMiner) — no manual BIP steps.
                Needs a Fusion login with <b>BI Author / Administrator</b> rights.
              </Text>
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>BI data source name (JDBC connection in BIP)</Text>
                <Input placeholder="ApplicationDB_FSCM" value={draft.dataSource || ''}
                  onChange={e => setDraft({ ...draft, dataSource: e.target.value })} />
                <Text type="secondary" style={{ fontSize: 10.5 }}>
                  Find it in BIP → Administration → JDBC Connection. Financials pods are usually <Text code>ApplicationDB_FSCM</Text>.
                </Text>
              </div>
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>Folder path</Text>
                <Input placeholder="/Custom/ReERP" value={draft.folderPath || ''}
                  onChange={e => setDraft({ ...draft, folderPath: e.target.value })} />
              </div>
              <Button icon={<ThunderboltOutlined />} loading={deploying} onClick={deploy}
                style={{ background: '#1D7B4D', borderColor: '#1D7B4D', color: '#fff' }}>
                Deploy runner report
              </Button>
              {deployMsg && (
                <Alert type={deployMsg.ok ? 'success' : 'error'} showIcon
                  message={deployMsg.ok ? 'Deployed' : 'Deploy failed'}
                  description={<div style={{ fontSize: 11.5 }}>
                    <div>{deployMsg.text}</div>
                    {deployMsg.steps?.map((s, i) => <div key={i} style={{ fontFamily: 'Consolas,monospace' }}>· {s}</div>)}
                  </div>} />
              )}
            </Space>
          </Card>

          <Alert type="info" showIcon style={{ padding: '6px 10px' }}
            message={<span style={{ fontSize: 12 }}>
              Uses the Fusion username/password saved in the app. Read-only: only SELECT/WITH run. Prefer not to auto-deploy?
              Deploy the report by hand — see <Text code>fusion/bip/README.md</Text>.
            </span>} />
        </Space>
      </Drawer>
    </div>
  );
};

export default FusionSql;
