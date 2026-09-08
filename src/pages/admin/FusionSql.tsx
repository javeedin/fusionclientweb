// ── Fusion SQL ──────────────────────────────────────────────────────────────
// A CloudMiner-style live query tool over the Oracle Fusion pod: SQL editor +
// schema browser + results grid. Runs SELECTs through BI Publisher's
// runReport SOAP service (main-process fusion-sql.cjs) against a "query
// runner" report deployed once in the pod (see fusion/bip/README.md). The
// schema browser bootstraps itself by running data-dictionary queries through
// the same runner. Read-only. Groundwork for a live-Fusion Claude tool.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Button, Card, Drawer, Dropdown, Empty, Input, InputNumber, Modal, Select, Space, Table,
  Tabs, Tag, Tooltip, Typography, message as antMessage,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  ApiOutlined, CaretRightOutlined, DatabaseOutlined, FileExcelOutlined, FilePdfOutlined,
  DeleteOutlined, DownloadOutlined, EditOutlined, FileTextOutlined, PlayCircleOutlined, ReloadOutlined, RobotOutlined,
  SaveOutlined, SearchOutlined, SendOutlined, SettingOutlined,
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
  fusionSqlCacheGet?: (opts: { pod?: string; key: string }) => Promise<{ success: boolean; value: unknown }>;
  fusionSqlCacheSet?: (opts: { pod?: string; key: string; value: unknown }) => Promise<{ success: boolean; error?: string }>;
  fusionSqlCacheClear?: (opts: { pod?: string }) => Promise<{ success: boolean; error?: string }>;
  fusionSqlCacheExport?: (opts: { pod?: string }) => Promise<{ success: boolean; path?: string; canceled?: boolean; error?: string }>;
  fusionSqlAiSql?: (opts: { question: string; schema: string; history?: { role: string; content: string }[] }) => Promise<{ success: boolean; response?: string; error?: string }>;
  getFusionCredentials?: () => Promise<{ username: string; password: string } | null>;
  saveFusionCredentials?: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  openExcel?: (buf: unknown, filename: string) => Promise<unknown>;
}
interface FsConfig { baseUrl?: string; reportPath?: string; dataModelPath?: string; folderPath?: string; dataSource?: string; rowLimit?: number; reportServicePath?: string }
interface ApiCall { at: number; kind: string; protocol: string; url: string; status: number; headers?: Record<string, string>; request: string; response: string }
interface FsResult {
  success: boolean; rows?: Record<string, unknown>[]; columns?: string[];
  rowCount?: number; capped?: boolean; error?: string; raw?: string;
}
interface SavedQuery { id: string; name: string; sql: string; at: number; }
const getApi = (): FusionSqlApi | undefined => {
  const api = (window as unknown as { electronAPI?: FusionSqlApi }).electronAPI;
  return api?.fusionSqlExecute ? api : undefined;
};

const HIST_KEY = 'reerp.fusionsql.history';
const SCHEMA_CAP = 20000; // max objects fetched per kind for the local schema cache
const SCHEMA_PAGE_SIZE = 200; // objects shown per page in the schema browser

// object types the schema browser can list (all_objects.object_type values)
const OBJECT_TYPES = [
  { value: 'TABLE', label: 'Tables' },
  { value: 'VIEW', label: 'Views' },
  { value: 'MATERIALIZED VIEW', label: 'Materialized Views' },
  { value: 'SYNONYM', label: 'Synonyms' },
  { value: 'PROCEDURE', label: 'Procedures' },
  { value: 'FUNCTION', label: 'Functions' },
  { value: 'PACKAGE', label: 'Packages' },
  { value: 'TRIGGER', label: 'Triggers' },
  { value: 'SEQUENCE', label: 'Sequences' },
  { value: 'TYPE', label: 'Types' },
];
// kinds whose members expose columns/arguments we can expand inline
const hasColumns = (kind: string) => kind === 'TABLE' || kind === 'VIEW' || kind === 'MATERIALIZED VIEW';
const hasArgs = (kind: string) => kind === 'PROCEDURE' || kind === 'FUNCTION' || kind === 'PACKAGE';
const sqlEsc = (s: string) => s.replace(/'/g, "''");
const cell = (v: unknown): string => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
const isIdCol = (k: string) => /(_id|_number|id|number)$/i.test(k);

// Parameters the app substitutes before running: {{TOKEN}} placeholders and
// Oracle :BIND variables (the runner can't bind, so both are text-substituted).
const extractParams = (s: string): string[] => {
  const out: string[] = [];
  const add = (t: string) => { if (t && !out.includes(t)) out.push(t); };
  (s.match(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g) || []).forEach(m => add(m.replace(/[{}\s]/g, '')));
  (s.match(/(?<![:\w]):([A-Za-z][A-Za-z0-9_]*)/g) || []).forEach(m => add(m.replace(/^:/, '')));
  return out;
};
// a blank value becomes NULL (so nvl(:P, col)-style optional filters mean "all");
// pure numbers pass through; everything else becomes a quoted, escaped literal.
const litFor = (v: string): string => {
  const t = (v ?? '').trim();
  if (t === '') return 'NULL';
  return /^-?\d+(\.\d+)?$/.test(t) ? t : `'${t.replace(/'/g, "''")}'`;
};
const substituteParams = (s: string, vals: Record<string, string>): string => {
  let out = s;
  for (const t of extractParams(s)) {
    const lit = litFor(vals[t] ?? '');
    out = out
      .replace(new RegExp(`\\{\\{\\s*${t}\\s*\\}\\}`, 'g'), lit)
      .replace(new RegExp(`(?<![:\\w]):${t}\\b`, 'g'), lit);
  }
  return out;
};

// Isolated so typing in a parameter field re-renders only this dialog, not the
// whole Fusion SQL screen (which holds a large results table) — keeps input fast.
const ParamDialog: React.FC<{
  open: boolean;
  params: string[];
  initial: Record<string, string>;
  onRun: (vals: Record<string, string>) => void;
  onCancel: () => void;
}> = ({ open, params, initial, onRun, onCancel }) => {
  const [vals, setVals] = useState<Record<string, string>>({});
  useEffect(() => { if (open) setVals(initial); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal
      title="Enter parameter values"
      open={open}
      onCancel={onCancel}
      okText="Run"
      okButtonProps={{ icon: <PlayCircleOutlined />, style: { background: '#1D7B4D', borderColor: '#1D7B4D' } }}
      onOk={() => onRun(vals)}
      width={460}
    >
      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 10 }}>
        This query has bind variables. Leave a value blank to treat it as <b>NULL</b> (i.e. “all”). Numbers are used as-is; text is quoted automatically.
      </Text>
      {params.map((p, i) => (
        <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{ width: 150, fontSize: 13, fontFamily: 'monospace', color: '#C74634', textAlign: 'right' }}>{p}</span>
          <Input
            autoFocus={i === 0}
            value={vals[p] ?? ''}
            placeholder="blank = all"
            onChange={e => { const v = e.target.value; setVals(prev => ({ ...prev, [p]: v })); }}
            onPressEnter={() => onRun(vals)}
          />
        </div>
      ))}
    </Modal>
  );
};

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
  const [schemaOwner, setSchemaOwner] = useState<string>('FUSION');
  const [owners, setOwners] = useState<string[]>(['FUSION']);
  const [schemaKind, setSchemaKind] = useState<string>('TABLE');
  const [schemaQ, setSchemaQ] = useState('');
  const [schemaList, setSchemaList] = useState<string[]>([]);
  const [schemaBusy, setSchemaBusy] = useState(false);
  const [schemaCapped, setSchemaCapped] = useState(false);
  const [schemaAt, setSchemaAt] = useState<number | null>(null);
  const [schemaLoadedFor, setSchemaLoadedFor] = useState<string>(''); // owner.kind actually loaded
  const [schemaPage, setSchemaPage] = useState(0);          // current page of the object list
  const [committedSearch, setCommittedSearch] = useState(''); // whole-list search (from the search icon)
  const [openObj, setOpenObj] = useState<string | null>(null);
  const [objCols, setObjCols] = useState<Record<string, unknown>[]>([]);

  // AI SQL assistant
  const [aiOpen, setAiOpen] = useState(false);
  const [aiInput, setAiInput] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMsgs, setAiMsgs] = useState<{ role: 'user' | 'assistant'; content: string; sql?: string }[]>([]);
  // values for {{PARAM}} placeholders detected in the editor SQL
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  // bind/parameter prompt dialog
  const [paramDlgOpen, setParamDlgOpen] = useState(false);
  const [paramDraft, setParamDraft] = useState<Record<string, string>>({});
  const [pendingSql, setPendingSql] = useState('');

  // top-level tabs + saved queries
  const [activeTab, setActiveTab] = useState<'builder' | 'list'>('builder');
  const [saved, setSaved] = useState<SavedQuery[]>([]);
  const [saveDlgOpen, setSaveDlgOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveEditId, setSaveEditId] = useState<string | null>(null);
  const [savedSearch, setSavedSearch] = useState('');

  // cache keys are scoped to the pod so switching pods never mixes schemas
  const podKey = useMemo(() => (cfg.baseUrl || 'pod').replace(/^https?:\/\//, '').replace(/[^\w.-]/g, '_'), [cfg.baseUrl]);

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

  // execute a raw statement, substituting {{PARAM}} / :BIND with `vals`
  const doExecute = useCallback(async (rawSql: string, vals: Record<string, string>) => {
    const q = substituteParams(rawSql.trim(), vals);
    if (!q || !api) return;
    setRunning(true);
    const t0 = Date.now();
    try {
      const r = await api.fusionSqlExecute!({ sql: q, rowLimit });
      setResult(r);
      setGridSearch('');
      if (r.success) {
        addLog(`${r.rowCount ?? 0} rows in ${Date.now() - t0} ms — ${q.slice(0, 80)}`, true);
        setHistory(prev => {
          const next = [rawSql.trim(), ...prev.filter(x => x !== rawSql.trim())].slice(0, 30);
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
  }, [rowLimit, api, apiOpen, loadCalls]);

  // Execute entry point. If the statement carries {{PARAM}} / :BIND variables,
  // prompt for their values in a dialog first; otherwise run straight away.
  const run = useCallback((stmt?: string) => {
    const base = (stmt ?? sql).trim();
    if (!base || running || !api) return;
    const params = extractParams(base);
    if (params.length) {
      setPendingSql(base);
      setParamDraft(prev => { const d: Record<string, string> = {}; params.forEach(p => { d[p] = paramValues[p] ?? prev[p] ?? ''; }); return d; });
      setParamDlgOpen(true);
      return;
    }
    doExecute(base, {});
  }, [sql, running, api, paramValues, doExecute]);

  // ── saved queries (persisted to a pod-independent local file) ───────────────
  const SAVED_LS = 'reerp.fusionsql.savedQueries';
  const loadSaved = useCallback(async () => {
    try {
      if (api?.fusionSqlCacheGet) {
        const r = await api.fusionSqlCacheGet({ pod: '__queries', key: 'list' });
        if (r?.success && Array.isArray(r.value)) { setSaved(r.value as SavedQuery[]); return; }
      }
    } catch { /* fall through */ }
    try { const v = JSON.parse(localStorage.getItem(SAVED_LS) || '[]'); setSaved(Array.isArray(v) ? v : []); } catch { setSaved([]); }
  }, [api]);
  const persistSaved = useCallback(async (list: SavedQuery[]) => {
    setSaved(list);
    try { if (api?.fusionSqlCacheSet) { await api.fusionSqlCacheSet({ pod: '__queries', key: 'list', value: list }); return; } } catch { /* fall through */ }
    try { localStorage.setItem(SAVED_LS, JSON.stringify(list)); } catch { /* quota */ }
  }, [api]);
  useEffect(() => { loadSaved(); }, [loadSaved]);

  const deriveName = (s: string) => {
    const m = s.match(/\bfrom\s+([A-Za-z0-9_.]+)/i);
    return m ? `Query on ${m[1]}` : 'Untitled query';
  };
  const openSave = () => {
    if (!sql.trim()) { antMessage.warning('Editor is empty'); return; }
    setSaveName(prev => prev || deriveName(sql));
    setSaveDlgOpen(true);
  };
  const confirmSave = () => {
    const name = saveName.trim();
    if (!name) { antMessage.warning('Enter a name'); return; }
    const sqlText = sql.trim();
    if (!sqlText) { antMessage.warning('Nothing to save'); return; }
    const list = [...saved];
    const idx = list.findIndex(q => q.id === saveEditId || q.name.toLowerCase() === name.toLowerCase());
    if (idx >= 0) list[idx] = { ...list[idx], name, sql: sqlText, at: Date.now() };
    else list.unshift({ id: `q_${Date.now()}`, name, sql: sqlText, at: Date.now() });
    persistSaved(list);
    setSaveEditId(idx >= 0 ? list[idx].id : list[0].id);
    setSaveDlgOpen(false);
    antMessage.success(idx >= 0 ? 'Query updated' : 'Query saved');
  };
  const runSaved = (item: SavedQuery) => { setSql(item.sql); setSaveEditId(item.id); setSaveName(item.name); setActiveTab('builder'); run(item.sql); };
  const editSaved = (item: SavedQuery) => { setSql(item.sql); setSaveEditId(item.id); setSaveName(item.name); setActiveTab('builder'); };
  const deleteSaved = (id: string) => { persistSaved(saved.filter(q => q.id !== id)); if (saveEditId === id) setSaveEditId(null); };

  // ── local cache (real file via Electron; localStorage as web fallback) ──────
  const cacheRead = useCallback(async (key: string): Promise<unknown> => {
    try {
      if (api?.fusionSqlCacheGet) {
        const r = await api.fusionSqlCacheGet({ pod: cfg.baseUrl, key });
        if (r?.success) return r.value;
      }
    } catch { /* fall through to localStorage */ }
    try { return JSON.parse(localStorage.getItem(`reerp.fusionsql.${podKey}.${key}`) || 'null'); } catch { return null; }
  }, [api, cfg.baseUrl, podKey]);
  const cacheWrite = useCallback(async (key: string, value: unknown) => {
    try {
      if (api?.fusionSqlCacheSet) { await api.fusionSqlCacheSet({ pod: cfg.baseUrl, key, value }); return; }
    } catch { /* fall through */ }
    try { localStorage.setItem(`reerp.fusionsql.${podKey}.${key}`, JSON.stringify(value)); } catch { /* quota */ }
  }, [api, cfg.baseUrl, podKey]);

  const namesOf = (rows: Record<string, unknown>[]) =>
    rows.map(x => String(x.OBJECT_NAME ?? x.object_name ?? '')).filter(Boolean);

  // the pod has many schemas (FUSION, FUSION_SETUP, FUSION_RUNTIME, …). Load the
  // owner list once (cached) so the user can pick which schema to browse.
  const loadOwners = useCallback(async (force = false) => {
    if (!api) return;
    if (!force) {
      const c = await cacheRead('owners') as string[] | null;
      if (Array.isArray(c) && c.length) { setOwners(c); return; }
    }
    const r = await api.fusionSqlExecute!({ sql: 'SELECT username FROM all_users ORDER BY username', rowLimit: 5000 });
    if (r.success && r.rows) {
      let names = r.rows.map(x => String(x.USERNAME ?? x.username ?? '')).filter(Boolean);
      if (!names.includes('PUBLIC')) names = ['PUBLIC', ...names]; // for public synonyms
      names = Array.from(new Set(names)).sort();
      setOwners(names);
      cacheWrite('owners', names);
    }
  }, [api, cacheRead, cacheWrite]);

  // fetch the FULL object list for the selected owner+kind once, cache it to the
  // local file, and filter it client-side. force=true re-pulls from the pod.
  const loadSchema = useCallback(async (force = false) => {
    if (!api) return;
    const key = `schema.${schemaOwner}.${schemaKind}`;
    if (!force) {
      const c = await cacheRead(key) as { at?: number; names?: string[]; capped?: boolean } | null;
      if (c && Array.isArray(c.names) && c.names.length) {
        setSchemaList(c.names); setSchemaCapped(!!c.capped); setSchemaAt(c.at || null);
        setSchemaLoadedFor(key);
        return;
      }
    }
    setSchemaBusy(true);
    const q = `SELECT object_name FROM all_objects WHERE owner='${sqlEsc(schemaOwner)}' AND object_type='${schemaKind}' ORDER BY object_name`;
    try {
      const r = await api.fusionSqlExecute!({ sql: q, rowLimit: SCHEMA_CAP });
      if (r.success && r.rows) {
        const names = Array.from(new Set(namesOf(r.rows)));
        const at = Date.now();
        setSchemaList(names); setSchemaCapped(!!r.capped); setSchemaAt(at);
        setSchemaLoadedFor(key); // loaded (even if 0 rows — schema has none visible)
        cacheWrite(key, { at, names, capped: !!r.capped });
      } else {
        antMessage.error(r.error || 'Schema query failed');
      }
    } finally { setSchemaBusy(false); }
  }, [api, schemaOwner, schemaKind, cacheRead, cacheWrite]);

  // find objects the cached list may not hold (beyond the cap): server LIKE
  // search, merged into the cached list so the local copy grows over time.
  const searchServer = useCallback(async () => {
    if (!api || !schemaQ.trim()) return;
    setSchemaBusy(true);
    const like = `%${sqlEsc(schemaQ.trim().toUpperCase())}%`;
    const q = `SELECT object_name FROM all_objects WHERE owner='${sqlEsc(schemaOwner)}' AND object_type='${schemaKind}' AND UPPER(object_name) LIKE '${like}' ORDER BY object_name`;
    try {
      const r = await api.fusionSqlExecute!({ sql: q, rowLimit: 2000 });
      if (r.success && r.rows) {
        const found = namesOf(r.rows);
        setSchemaList(prev => {
          const merged = Array.from(new Set([...prev, ...found])).sort();
          cacheWrite(`schema.${schemaOwner}.${schemaKind}`, { at: Date.now(), names: merged, capped: schemaCapped });
          return merged;
        });
        if (!found.length) antMessage.info('No matching objects on the pod.');
      } else {
        antMessage.error(r.error || 'Schema search failed');
      }
    } finally { setSchemaBusy(false); }
  }, [api, schemaOwner, schemaKind, schemaQ, cacheWrite, schemaCapped]);

  // load owners once the pod is known
  useEffect(() => { if (api && cfg.baseUrl) loadOwners(false); }, [api, cfg.baseUrl, loadOwners]);

  // auto-load (from cache if available) once the pod is known / owner / kind changes.
  useEffect(() => {
    if (api && cfg.baseUrl) { setOpenObj(null); setSchemaPage(0); setCommittedSearch(''); setSchemaQ(''); loadSchema(false); }
  }, [api, cfg.baseUrl, schemaOwner, schemaKind, loadSchema]);

  // Whole-list search (the search icon) narrows the entire cached list; the
  // result is then paginated. Typing in the box auto-filters the CURRENT page
  // only — click the search icon (or Enter) to search across all pages.
  const searchedBase = useMemo(() => {
    const s = committedSearch.trim().toUpperCase();
    return s ? schemaList.filter(n => n.toUpperCase().includes(s)) : schemaList;
  }, [schemaList, committedSearch]);
  const pageCount = Math.max(1, Math.ceil(searchedBase.length / SCHEMA_PAGE_SIZE));
  const pageBase = useMemo(
    () => searchedBase.slice(schemaPage * SCHEMA_PAGE_SIZE, schemaPage * SCHEMA_PAGE_SIZE + SCHEMA_PAGE_SIZE),
    [searchedBase, schemaPage],
  );
  // live auto-filter over just the current page
  const visibleSchema = useMemo(() => {
    const s = schemaQ.trim().toUpperCase();
    return s ? pageBase.filter(n => n.toUpperCase().includes(s)) : pageBase;
  }, [pageBase, schemaQ]);
  // commit a whole-list search from the search icon / Enter
  const commitSearch = () => { setCommittedSearch(schemaQ.trim()); setSchemaPage(0); };

  // Download the on-disk schema cache (tables & columns) for the current pod.
  const downloadSchemaCache = async () => {
    if (!api?.fusionSqlCacheExport) { antMessage.warning('The desktop app is required to download the cache file.'); return; }
    const r = await api.fusionSqlCacheExport({ pod: cfg.baseUrl });
    if (r?.success) antMessage.success(`Saved to ${r.path}`);
    else if (!r?.canceled) antMessage.error(r?.error || 'Could not download the schema cache');
  };
  // keep the page in range if the underlying list shrinks
  useEffect(() => { if (schemaPage > pageCount - 1) setSchemaPage(0); }, [pageCount, schemaPage]);

  // expand a table/view (columns) or a program unit (arguments), cached locally
  const loadColumns = useCallback(async (name: string) => {
    if (openObj === name) { setOpenObj(null); return; }
    if (!hasColumns(schemaKind) && !hasArgs(schemaKind)) return; // nothing to expand
    setOpenObj(name);
    setObjCols([]);
    const ckey = `detail.${schemaOwner}.${schemaKind}.${name}`;
    const cached = await cacheRead(ckey);
    if (Array.isArray(cached) && cached.length) { setObjCols(cached as Record<string, unknown>[]); return; }
    const q = hasArgs(schemaKind)
      ? `SELECT NVL(argument_name,'(return)') AS column_name, data_type, in_out FROM all_arguments WHERE owner='${sqlEsc(schemaOwner)}' AND object_name='${sqlEsc(name)}' AND argument_name IS NOT NULL ORDER BY position`
      : `SELECT column_name, data_type, data_length, nullable FROM all_tab_columns WHERE owner='${sqlEsc(schemaOwner)}' AND table_name='${sqlEsc(name)}' ORDER BY column_id`;
    const r = await api!.fusionSqlExecute!({ sql: q, rowLimit: 1000 });
    if (r.success && r.rows) { setObjCols(r.rows); cacheWrite(ckey, r.rows); }
  }, [api, openObj, schemaOwner, schemaKind, cacheRead, cacheWrite]);

  const insert = (text: string) => {
    const el = editorRef.current;
    if (!el) { setSql(s => `${s} ${text}`); return; }
    const start = el.selectionStart ?? sql.length;
    const end = el.selectionEnd ?? sql.length;
    setSql(sql.slice(0, start) + text + sql.slice(end));
    requestAnimationFrame(() => { el.focus(); const p = start + text.length; el.setSelectionRange(p, p); });
  };

  // ── AI SQL assistant ────────────────────────────────────────────────────────
  // Build a compact schema context for Claude from the local cache: candidate
  // tables/views whose name matches the question's keywords (plus a few finance
  // synonyms), with their columns (cached, or fetched live for the top matches).
  const FINANCE_SYNONYMS: Record<string, string[]> = {
    CUSTOMER: ['CUST', 'PARTY', 'HZ_'], SUPPLIER: ['VENDOR', 'POZ_', 'AP_SUPPLIER'],
    INVOICE: ['RA_CUSTOMER_TRX', 'AP_INVOICES', 'TRX'], BALANCE: ['PAYMENT_SCHEDULES', 'AMOUNT_DUE', 'AR_'],
    RECEIPT: ['CASH_RECEIPT', 'AR_CASH'], PAYMENT: ['AP_PAYMENT', 'CHECKS', 'PAYMENT_SCHEDULES'],
    ACCOUNT: ['CODE_COMBINATION', 'GL_CODE_COMBINATIONS'], LEDGER: ['GL_', 'LEDGER'],
    JOURNAL: ['GL_JE', 'JOURNAL'], TAX: ['ZX_', 'TAX'], BANK: ['CE_', 'IBY_', 'BANK'],
  };
  const buildSchemaContext = useCallback(async (question: string): Promise<string> => {
    const owner = schemaOwner || 'FUSION';
    const q = question.toUpperCase();
    const kws = Array.from(new Set((q.match(/[A-Z_]{3,}/g) || [])));
    const terms = new Set<string>(kws);
    for (const [k, syns] of Object.entries(FINANCE_SYNONYMS)) if (q.includes(k)) syns.forEach(s => terms.add(s));
    // candidate table/view names from the cache
    const all: { kind: string; name: string }[] = [];
    for (const kind of ['TABLE', 'VIEW']) {
      const c = await cacheRead(`schema.${owner}.${kind}`) as { names?: string[] } | null;
      (c?.names || []).forEach(n => all.push({ kind, name: n }));
    }
    if (!all.length) return '';
    const termArr = Array.from(terms);
    const cands = all.filter(t => termArr.some(kw => t.name.includes(kw))).slice(0, 40);
    if (!cands.length) {
      // no name match — hand over a sample of names so the model can still orient
      return `owner ${owner}. No name matched the request. Some ${all.length} objects:\n` +
        all.slice(0, 60).map(t => `${owner}.${t.name}`).join(', ');
    }
    // columns: cache first; fetch live for up to 15 uncached candidates
    let liveBudget = 15;
    const lines: string[] = [];
    for (const t of cands) {
      const ckey = `detail.${owner}.${t.kind}.${t.name}`;
      let cols = await cacheRead(ckey) as Record<string, unknown>[] | null;
      if ((!cols || !cols.length) && liveBudget > 0 && api?.fusionSqlExecute) {
        liveBudget--;
        const r = await api.fusionSqlExecute({ sql: `SELECT column_name, data_type FROM all_tab_columns WHERE owner='${sqlEsc(owner)}' AND table_name='${sqlEsc(t.name)}' ORDER BY column_id`, rowLimit: 500 });
        if (r.success && r.rows) { cols = r.rows; cacheWrite(ckey, r.rows); }
      }
      const colNames = (cols || []).map(c => String(c.COLUMN_NAME ?? c.column_name ?? '')).filter(Boolean);
      lines.push(`${owner}.${t.name}: ${colNames.length ? colNames.join(', ') : '(columns not loaded — expand this table to cache them)'}`);
    }
    return lines.join('\n');
  }, [schemaOwner, cacheRead, cacheWrite, api]);

  const extractSql = (text: string): string | undefined => {
    const m = text.match(/```sql\s*([\s\S]*?)```/i) || text.match(/```\s*([\s\S]*?)```/);
    return m ? m[1].trim().replace(/;+\s*$/, '') : undefined;
  };

  const askAi = useCallback(async (question: string) => {
    const qq = question.trim();
    if (!qq || aiBusy) return;
    if (!api?.fusionSqlAiSql) { antMessage.error('AI is only available in the desktop app.'); return; }
    setAiMsgs(prev => [...prev, { role: 'user', content: qq }]);
    setAiInput('');
    setAiBusy(true);
    try {
      const schema = await buildSchemaContext(qq);
      const history = aiMsgs.map(m => ({ role: m.role, content: m.content }));
      const r = await api.fusionSqlAiSql({ question: qq, schema, history });
      if (r.success && r.response) {
        setAiMsgs(prev => [...prev, { role: 'assistant', content: r.response!, sql: extractSql(r.response!) }]);
      } else {
        setAiMsgs(prev => [...prev, { role: 'assistant', content: `⚠️ ${r.error || 'AI request failed'}` }]);
      }
    } catch (e) {
      setAiMsgs(prev => [...prev, { role: 'assistant', content: `⚠️ ${e instanceof Error ? e.message : e}` }]);
    } finally { setAiBusy(false); }
  }, [api, aiBusy, aiMsgs, buildSchemaContext]);

  // put an AI-generated statement into the editor and prime its parameters
  const useAiSql = (stmt: string) => {
    setSql(stmt);
    const toks = extractParams(stmt);
    setParamValues(prev => { const next = { ...prev }; toks.forEach(t => { if (!(t in next)) next[t] = ''; }); return next; });
    setAiOpen(false);
    antMessage.success(toks.length ? `Loaded — fill the ${toks.length} parameter(s) and Execute` : 'Loaded into the editor');
  };

  // {{PARAM}} tokens present in the current editor SQL
  const sqlParams = useMemo(() => extractParams(sql), [sql]);

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

  // Memoise the results table element so editor typing / tab switches don't
  // re-render the (potentially large) grid — only rebuild when data changes.
  const resultDataSource = useMemo(() => filtered.map((r, i) => ({ ...r, __k: i })), [filtered]);
  const resultsTableEl = useMemo(() => (
    <Table
      size="small"
      rowKey="__k"
      columns={gridCols}
      dataSource={resultDataSource}
      pagination={{ pageSize: 100, size: 'small', showSizeChanger: false, showTotal: t => `${t} rows` }}
      scroll={{ x: 'max-content' }}
    />
  ), [gridCols, resultDataSource]);

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
        .fs-tabs{flex:1;min-height:0;display:flex;flex-direction:column}
        .fs-tabs>.ant-tabs-content-holder{flex:1;min-height:0;display:flex}
        .fs-tabs .ant-tabs-content{height:100%;width:100%}
        .fs-tabs .ant-tabs-tabpane{height:100%}
      `}</style>

      <Tabs
        className="fs-tabs"
        activeKey={activeTab}
        onChange={k => setActiveTab(k as 'builder' | 'list')}
        style={{ flex: 1, minHeight: 0 }}
        items={[{
          key: 'builder',
          label: <span><DatabaseOutlined /> SQL Builder</span>,
          children: (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '100%' }}>

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
          <Tooltip title="Ask AI to write SQL from the cached schema">
            <Button icon={<RobotOutlined />} onClick={() => setAiOpen(true)}
              style={{ borderColor: '#C74634', color: '#C74634' }}>Ask AI</Button>
          </Tooltip>
          <Tooltip title="Save this query to the List of Queries">
            <Button icon={<SaveOutlined />} onClick={openSave}>Save</Button>
          </Tooltip>
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
          <div className="fs-side-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span><TableOutlined /> Schema browser</span>
            <Space size={10}>
              <Tooltip title="Download the schema cache file (tables & columns JSON) for this pod">
                <DownloadOutlined onClick={downloadSchemaCache}
                  style={{ cursor: 'pointer', fontSize: 12, opacity: 0.85 }} />
              </Tooltip>
              <Tooltip title="Reload the full list from the pod (updates the local cache)">
                <ReloadOutlined spin={schemaBusy} onClick={() => loadSchema(true)}
                  style={{ cursor: 'pointer', fontSize: 12, opacity: 0.85 }} />
              </Tooltip>
            </Space>
          </div>
          <div style={{ padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Select size="small" showSearch value={schemaOwner} onChange={v => setSchemaOwner(v)}
              style={{ width: '100%' }} placeholder="Schema (owner)"
              options={owners.map(o => ({ value: o, label: o }))} optionFilterProp="label" />
            <Select size="small" value={schemaKind} onChange={v => setSchemaKind(v)}
              style={{ width: '100%' }} options={OBJECT_TYPES} />
            <Input size="small" placeholder="Filter current page — click 🔍 to search all"
              allowClear
              value={schemaQ}
              onChange={e => { const v = e.target.value; setSchemaQ(v); if (!v.trim() && committedSearch) { setCommittedSearch(''); setSchemaPage(0); } }}
              onPressEnter={commitSearch}
              suffix={
                <Tooltip title="Search across all pages of the cached list">
                  <SearchOutlined onClick={commitSearch} style={{ color: '#C74634', cursor: 'pointer' }} />
                </Tooltip>
              } />
            {committedSearch && (
              <div style={{ fontSize: 11, color: '#8c7f7a' }}>
                Searching all for “{committedSearch}” — {searchedBase.length.toLocaleString()} match(es).{' '}
                <a onClick={() => { setCommittedSearch(''); setSchemaPage(0); }} style={{ color: '#0572CE' }}>clear</a>
              </div>
            )}
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {schemaBusy && <Text type="secondary" style={{ fontSize: 12, padding: 10, display: 'block' }}>Loading…</Text>}
            {!schemaBusy && !schemaList.length && (
              <Text type="secondary" style={{ fontSize: 12, padding: 10, display: 'block' }}>
                {schemaLoadedFor === `schema.${schemaOwner}.${schemaKind}`
                  ? <>No {schemaKind.toLowerCase()}s in <b>{schemaOwner}</b> are visible to your BI user. Try the <b>FUSION</b> schema (where the transactional tables live), or another owner.</>
                  : <>Loading {schemaKind.toLowerCase()}s from <b>{schemaOwner}</b>… if nothing appears, click the refresh icon to load them from the pod.</>}
              </Text>
            )}
            {!schemaBusy && schemaList.length > 0 && !visibleSchema.length && (
              <Text type="secondary" style={{ fontSize: 12, padding: 10, display: 'block' }}>
                No match on this page.{' '}
                {committedSearch
                  ? 'No matches across the whole cached list.'
                  : <a onClick={commitSearch} style={{ color: '#0572CE' }}>Search all pages for “{schemaQ.trim()}”</a>}
                {schemaCapped && <> · <a onClick={searchServer} style={{ color: '#0572CE' }}>search the pod</a></>}
              </Text>
            )}
            {visibleSchema.map(name => {
              const expandable = hasColumns(schemaKind) || hasArgs(schemaKind);
              // FUSION/PUBLIC objects resolve unqualified; other schemas need owner.name
              const qualified = (schemaOwner === 'FUSION' || schemaOwner === 'PUBLIC')
                ? name.toLowerCase() : `${schemaOwner}.${name}`.toLowerCase();
              return (
              <div key={name}>
                <button className="fs-obj" onClick={() => insert(qualified)} onDoubleClick={() => expandable && loadColumns(name)}
                  title={expandable ? 'Click: insert into editor · Double-click: show columns' : 'Click: insert into editor'}>
                  {expandable
                    ? <CaretRightOutlined style={{ fontSize: 9, marginRight: 4, transform: openObj === name ? 'rotate(90deg)' : 'none' }}
                        onClick={e => { e.stopPropagation(); loadColumns(name); }} />
                    : <span style={{ display: 'inline-block', width: 13 }} />}
                  {name}
                </button>
                {openObj === name && objCols.map((c, i) => (
                  <div key={i} className="fs-col" onClick={() => insert(String(c.COLUMN_NAME ?? c.column_name ?? '').toLowerCase())}>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{String(c.COLUMN_NAME ?? c.column_name ?? '')}</span>
                    <span style={{ color: '#b9aca7' }}>{String(c.DATA_TYPE ?? c.data_type ?? '')}</span>
                  </div>
                ))}
              </div>
              );
            })}
          </div>
          {/* pagination */}
          {pageCount > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px', borderTop: '1px solid #eee', fontSize: 11 }}>
              <Button size="small" type="text" disabled={schemaPage <= 0} onClick={() => setSchemaPage(p => Math.max(0, p - 1))}>‹ Prev</Button>
              <span style={{ color: '#8c7f7a' }}>Page {schemaPage + 1} / {pageCount}</span>
              <Button size="small" type="text" disabled={schemaPage >= pageCount - 1} onClick={() => setSchemaPage(p => Math.min(pageCount - 1, p + 1))}>Next ›</Button>
            </div>
          )}
          {!!schemaList.length && (
            <div style={{ padding: '4px 8px', borderTop: '1px solid #eee', fontSize: 11, color: '#8c7f7a' }}>
              {committedSearch ? `${searchedBase.length.toLocaleString()} of ` : ''}{schemaList.length.toLocaleString()} cached
              {schemaCapped ? ` (capped at ${SCHEMA_CAP.toLocaleString()})` : ''}
              {schemaAt ? ` · ${dayjs(schemaAt).format('MMM D HH:mm')}` : ''}
            </div>
          )}
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

          {sqlParams.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', padding: '5px 8px', background: '#fff7f5', borderTop: '1px solid #f0d9d4', fontSize: 12 }}>
              <span style={{ color: '#C74634', fontWeight: 600 }}>Parameters:</span>
              {sqlParams.map(p => <Tag key={p} style={{ margin: 0 }}>{p}</Tag>)}
              <span style={{ color: '#8c7f7a' }}>— Execute will prompt for these.</span>
            </div>
          )}

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
                              {resultsTableEl}
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
            </div>
          ),
        }, {
          key: 'list',
          label: <span><FileTextOutlined /> List of Queries ({saved.length})</span>,
          children: (
            <div style={{ height: '100%', overflowY: 'auto', background: '#fff', border: '1px solid #EFEAE8', borderRadius: 10, padding: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <Input size="small" allowClear prefix={<SearchOutlined />} placeholder="Search saved queries"
                  style={{ width: 260 }} value={savedSearch} onChange={e => setSavedSearch(e.target.value)} />
                <div style={{ flex: 1 }} />
                <Text type="secondary" style={{ fontSize: 12 }}>{saved.length} saved</Text>
              </div>
              {!saved.length ? (
                <Empty description="No saved queries yet — write a query in SQL Builder and click Save." />
              ) : (
                <Table<SavedQuery>
                  size="small"
                  rowKey="id"
                  pagination={{ pageSize: 15, showSizeChanger: true }}
                  dataSource={saved.filter(q =>
                    !savedSearch.trim() ||
                    q.name.toLowerCase().includes(savedSearch.trim().toLowerCase()) ||
                    q.sql.toLowerCase().includes(savedSearch.trim().toLowerCase()))}
                  columns={[
                    { title: 'Name', dataIndex: 'name', width: 220, render: (v: string) => <Text strong>{v}</Text> },
                    {
                      title: 'SQL', dataIndex: 'sql', ellipsis: true,
                      render: (v: string) => (
                        <Tooltip title={<pre style={{ maxHeight: 300, overflow: 'auto', margin: 0, whiteSpace: 'pre-wrap' }}>{v}</pre>} overlayStyle={{ maxWidth: 640 }}>
                          <span style={{ fontFamily: 'Consolas,monospace', fontSize: 12, color: '#6B6B6B' }}>{v.replace(/\s+/g, ' ').slice(0, 90)}</span>
                        </Tooltip>
                      ),
                    },
                    {
                      title: 'Parameters', key: 'params', width: 160,
                      render: (_: unknown, r: SavedQuery) => {
                        const ps = extractParams(r.sql);
                        return ps.length ? <span>{ps.map(p => <Tag key={p} style={{ margin: '0 2px 2px 0' }}>{p}</Tag>)}</span> : <Text type="secondary">—</Text>;
                      },
                    },
                    { title: 'Saved', dataIndex: 'at', width: 130, render: (v: number) => <Text type="secondary" style={{ fontSize: 12 }}>{dayjs(v).format('MMM D, HH:mm')}</Text> },
                    {
                      title: 'Actions', key: 'act', width: 190,
                      render: (_: unknown, r: SavedQuery) => (
                        <Space size={4}>
                          <Button size="small" type="primary" icon={<PlayCircleOutlined />}
                            style={{ background: '#1D7B4D', borderColor: '#1D7B4D' }} onClick={() => runSaved(r)}>Run</Button>
                          <Button size="small" icon={<EditOutlined />} onClick={() => editSaved(r)}>Edit</Button>
                          <Button size="small" danger icon={<DeleteOutlined />}
                            onClick={() => Modal.confirm({ title: `Delete “${r.name}”?`, okText: 'Delete', okButtonProps: { danger: true }, onOk: () => deleteSaved(r.id) })} />
                        </Space>
                      ),
                    },
                  ]}
                />
              )}
            </div>
          ),
        }]}
      />

      {/* ── Save query ── */}
      <Modal
        title={saveEditId ? 'Update saved query' : 'Save query'}
        open={saveDlgOpen}
        onCancel={() => setSaveDlgOpen(false)}
        onOk={confirmSave}
        okText={saveEditId ? 'Update' : 'Save'}
        width={440}
      >
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
          Saved queries appear in the <b>List of Queries</b> tab, with Run / Edit. A name that already exists updates that query.
        </Text>
        <Input value={saveName} onChange={e => setSaveName(e.target.value)} placeholder="Query name"
          onPressEnter={confirmSave} autoFocus />
      </Modal>

      {/* ── Bind / parameter prompt (isolated component to keep typing fast) ── */}
      <ParamDialog
        open={paramDlgOpen}
        params={extractParams(pendingSql)}
        initial={paramDraft}
        onCancel={() => setParamDlgOpen(false)}
        onRun={vals => {
          setParamValues(prev => ({ ...prev, ...vals }));
          setParamDlgOpen(false);
          doExecute(pendingSql, vals);
        }}
      />

      {/* ── AI SQL assistant ── */}
      <Drawer
        title={<span><RobotOutlined style={{ color: '#C74634' }} /> Ask AI — write SQL from the schema</span>}
        open={aiOpen} onClose={() => setAiOpen(false)} width={520}
        extra={aiMsgs.length ? <Button size="small" onClick={() => setAiMsgs([])}>Clear</Button> : undefined}
        styles={{ body: { display: 'flex', flexDirection: 'column', padding: 0 } }}
      >
        <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
          {!aiMsgs.length && (
            <div style={{ color: '#6B6B6B', fontSize: 13 }}>
              <p>Ask in plain English and I&apos;ll write an Oracle SELECT using the tables/columns cached for
                <b> {schemaOwner}</b>. For anything to filter by, I&apos;ll add a <code>{'{{PARAMETER}}'}</code> you fill in before running.</p>
              <p style={{ marginTop: 8 }}>Try:</p>
              {[
                'Customer account balance, with a parameter for customer name',
                'Open AR invoices for a customer, parameter customer name',
                'Supplier outstanding balance by supplier name',
              ].map(s => (
                <div key={s} style={{ marginBottom: 6 }}>
                  <a onClick={() => askAi(s)} style={{ color: '#0572CE' }}>“{s}”</a>
                </div>
              ))}
              <Text type="secondary" style={{ fontSize: 11 }}>
                Tip: load the schema (Schema browser → Refresh) for the tables you expect, so the AI has their columns.
              </Text>
            </div>
          )}
          {aiMsgs.map((m, i) => (
            <div key={i} style={{ marginBottom: 12, textAlign: m.role === 'user' ? 'right' : 'left' }}>
              <div style={{
                display: 'inline-block', maxWidth: '92%', textAlign: 'left', padding: '8px 10px', borderRadius: 8,
                background: m.role === 'user' ? '#e6f0fb' : '#f5f5f5', fontSize: 13, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              }}>
                {m.sql ? (
                  <>
                    <div style={{ marginBottom: 6 }}>{m.content.replace(/```sql[\s\S]*?```/i, '').replace(/```[\s\S]*?```/, '').trim() || 'Here is the SQL:'}</div>
                    <pre style={{ background: '#1e1e1e', color: '#d4d4d4', padding: 8, borderRadius: 6, overflowX: 'auto', fontSize: 12, margin: 0 }}>{m.sql}</pre>
                    <div style={{ marginTop: 6 }}>
                      <Button size="small" type="primary" icon={<PlayCircleOutlined />}
                        style={{ background: '#1D7B4D', borderColor: '#1D7B4D' }}
                        onClick={() => useAiSql(m.sql!)}>Use in editor</Button>
                    </div>
                  </>
                ) : m.content}
              </div>
            </div>
          ))}
          {aiBusy && <Text type="secondary" style={{ fontSize: 12 }}>Thinking…</Text>}
        </div>
        <div style={{ borderTop: '1px solid #eee', padding: 8, display: 'flex', gap: 6 }}>
          <Input.TextArea
            value={aiInput}
            onChange={e => setAiInput(e.target.value)}
            onPressEnter={e => { if (!e.shiftKey) { e.preventDefault(); askAi(aiInput); } }}
            placeholder="e.g. customer account balance, parameter for customer name"
            autoSize={{ minRows: 1, maxRows: 4 }}
            disabled={aiBusy}
          />
          <Button type="primary" icon={<SendOutlined />} loading={aiBusy} onClick={() => askAi(aiInput)}
            style={{ background: '#C74634', borderColor: '#C74634' }} />
        </div>
      </Drawer>

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
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <Text strong style={{ fontSize: 11.5 }}>Endpoint URL</Text>
                  <Button size="small" type="link" style={{ padding: 0, height: 'auto', fontSize: 11 }}
                    onClick={() => { navigator.clipboard.writeText(c.url); antMessage.success('URL copied'); }}>copy</Button>
                </div>
                <pre style={{ fontSize: 10.5, background: '#faf7f6', padding: 8, borderRadius: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: '0 0 8px' }}>{c.url}</pre>

                <Text strong style={{ fontSize: 11.5 }}>HTTP headers (for SOAP UI)</Text>
                <pre style={{ fontSize: 10.5, background: '#faf7f6', padding: 8, borderRadius: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: '4px 0 8px' }}>
{Object.entries(c.headers || {}).map(([k, v]) => `${k}: ${v}`).join('\n')}
{'\n'}<Text type="secondary" style={{ fontSize: 10 }}>(replace the Authorization value with your own Basic base64 of user:password in SOAP UI)</Text>
                </pre>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <Text strong style={{ fontSize: 11.5 }}>Request body (XML)</Text>
                  <Button size="small" type="link" style={{ padding: 0, height: 'auto', fontSize: 11 }}
                    onClick={() => { navigator.clipboard.writeText(c.request); antMessage.success('Request XML copied'); }}>copy</Button>
                </div>
                <pre style={{ fontSize: 10.5, background: '#1e1e24', color: '#e6e6e6', padding: 8, borderRadius: 6, maxHeight: 260, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{c.request}</pre>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '6px 0 4px' }}>
                  <Text strong style={{ fontSize: 11.5 }}>Response</Text>
                  <Button size="small" type="link" style={{ padding: 0, height: 'auto', fontSize: 11 }}
                    onClick={() => { navigator.clipboard.writeText(c.response); antMessage.success('Response copied'); }}>copy</Button>
                </div>
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
            <Text type="secondary" style={{ fontSize: 12 }}>Report service endpoint (relative to the pod)</Text>
            <Input placeholder="/xmlpserver/services/v2/ReportService" value={draft.reportServicePath || ''}
              onChange={e => setDraft({ ...draft, reportServicePath: e.target.value })} />
            <Text type="secondary" style={{ fontSize: 10.5 }}>
              This is the same BIP endpoint Order Management uses (<Text code>/xmlpserver/services/v2/ReportService</Text>).
            </Text>
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
