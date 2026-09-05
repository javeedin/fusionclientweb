import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Card, DatePicker, Dropdown, Input, Modal, Radio, Select, Table, Tabs, Tag, Tooltip, Typography, message as antMessage } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  ApiOutlined, CloseOutlined, CodeOutlined, DatabaseOutlined, DeleteOutlined, ExportOutlined, EyeOutlined,
  FileExcelOutlined, FilePdfOutlined, FileTextOutlined, FilterOutlined, FolderOpenOutlined,
  FullscreenExitOutlined, FullscreenOutlined, MailOutlined, MinusCircleOutlined, PlusOutlined,
  ReloadOutlined, SearchOutlined, SendOutlined, ShareAltOutlined, SnippetsOutlined, StopOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import ExcelJS from 'exceljs';
import { getCurrentCompany } from '../../config/company.config';
import { getFusionInstanceUrl } from '../../config/api.helper';
import { fetchTrainingRecipes } from '../../components/ai/aiTraining';
import type { RecipeParam, TrainingRecipe } from '../../components/ai/aiTraining';

const { Text } = Typography;

const LS_KEY = 'reerp.claudechat2';

// endpoints of the company the user is logged into
const toOrigin = (u: string) => { try { return new URL(u).origin; } catch { return u || ''; } };
const buildCompanyCtx = () => {
  const c = getCurrentCompany();
  return {
    company: c.code,
    apexBaseUrl: c.apexBaseUrl,
    fusionBaseUrl: toOrigin(getFusionInstanceUrl() || c.fusionBaseUrl || ''),
  };
};

// tools ran during a turn: old chats stored plain names, new ones carry the
// command / SQL / path that was executed
type ToolRef = string | { name: string; detail?: string };
interface ChatMsg { role: 'user' | 'assistant'; text: string; tools?: ToolRef[] }
interface Conv { id: string; title: string; sessionId: string | null; msgs: ChatMsg[]; updatedAt: number }

interface ChatEvent {
  kind: 'init' | 'text' | 'tool' | 'result' | 'error' | 'done';
  sessionId?: string; model?: string; text?: string; name?: string; input?: string; detail?: string;
  isError?: boolean; resultText?: string; error?: string; code?: number;
}

interface WsFile { name: string; relPath: string; size: number; mtime: number }

interface ChatApi {
  claudeChatSend: (opts: { text: string; sessionId?: string | null; ctx?: Record<string, string> }) => Promise<{ success: boolean; error?: string }>;
  claudeChatCancel: () => Promise<{ success: boolean }>;
  claudeChatOpenWorkspace?: () => Promise<{ success: boolean }>;
  claudeChatCatalog?: () => Promise<{ success: boolean; markdown: string }>;
  claudeChatRecipes?: (opts: { apexBaseUrl: string }) => Promise<{ success: boolean; items?: Record<string, unknown>[]; error?: string; url?: string }>;
  claudeChatLov?: (opts: { apexBaseUrl: string; path: string }) => Promise<{ success: boolean; items?: Record<string, unknown>[]; error?: string }>;
  claudeChatApiGet?: (opts: { apexBaseUrl: string; path: string }) => Promise<{ success: boolean; status?: number; text?: string; error?: string; url?: string }>;
  claudeChatSaveDirect?: (opts: { json: string }) => Promise<{ success: boolean; error?: string }>;
  claudeChatLoadDb?: (opts: { json: string; table: string; mode?: 'replace' | 'append'; ctx: Record<string, string> }) => Promise<{ success: boolean; message?: string; error?: string }>;
  claudeChatQueryDb?: (opts: { sql?: string; tables?: boolean; ctx: Record<string, string> }) => Promise<{
    success: boolean; rowCount?: number; rows?: Record<string, unknown>[];
    tables?: { name: string; rows: number; columns: string[] }[]; error?: string;
  }>;
  claudeChatListFiles?: () => Promise<{ success: boolean; files: WsFile[] }>;
  claudeChatReadFile?: (relPath: string) => Promise<{ success: boolean; base64?: string; name?: string; error?: string }>;
  claudeChatOpenFile?: (relPath: string) => Promise<{ success: boolean }>;
  onClaudeChatEvent: (cb: (e: unknown, evt: ChatEvent) => void) => void;
  removeClaudeChatListeners: () => void;
  claudeCliStatus?: () => Promise<{ installed?: boolean; version?: string }>;
}

const getApi = (): ChatApi | undefined => {
  const api = (window as unknown as { electronAPI?: Partial<ChatApi> }).electronAPI;
  return api?.claudeChatSend ? (api as ChatApi) : undefined;
};

// ── tiny markdown renderer ──────────────────────────────────────────────────
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function mdToHtml(src: string): string {
  const codeBlocks: string[] = [];
  let t = src.replace(/```[a-z]*\n?([\s\S]*?)```/g, (_m, c) => {
    codeBlocks.push(`<pre class="cc-pre">${esc(c.replace(/\n$/, ''))}</pre>`);
    return `\u0000CB${codeBlocks.length - 1}\u0000`;
  });
  t = esc(t);
  t = t.replace(/((?:^\|.*\|\s*$\n?)+)/gm, block => {
    const lines = block.trim().split('\n').filter(l => l.trim().startsWith('|'));
    if (lines.length < 2) return block;
    const cells = (l: string) => l.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
    const isSep = (l: string) => /^\s*\|?[\s:|-]+\|?\s*$/.test(l) && l.includes('-');
    let html = '<table class="cc-table">';
    lines.forEach((l, i) => {
      if (isSep(l)) return;
      const tag = i === 0 && lines[1] && isSep(lines[1]) ? 'th' : 'td';
      html += '<tr>' + cells(l).map(c => `<${tag}>${c}</${tag}>`).join('') + '</tr>';
    });
    return html + '</table>';
  });
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  t = t.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  t = t.replace(/^#{1,4}\s+(.*)$/gm, '<div class="cc-h">$1</div>');
  t = t.replace(/^\s*[-*]\s+(.*)$/gm, '<div class="cc-li">• $1</div>');
  t = t.replace(/^\s*(\d+)\.\s+(.*)$/gm, '<div class="cc-li">$1. $2</div>');
  t = t.replace(/\n{2,}/g, '<br/><br/>').replace(/\n/g, '<br/>');
  t = t.replace(/(<\/(?:table|div|pre)>)<br\/>/g, '$1');
  return t.replace(/\u0000CB(\d+)\u0000/g, (_m, i) => codeBlocks[Number(i)] ?? '');
}

const loadState = (): { convs: Conv[]; curId: string } => {
  try {
    const s = JSON.parse(localStorage.getItem(LS_KEY) || '');
    if (s && Array.isArray(s.convs)) return s;
  } catch { /* fresh */ }
  return { convs: [], curId: '' };
};
const saveState = (convs: Conv[], curId: string) => {
  try { localStorage.setItem(LS_KEY, JSON.stringify({ convs: convs.slice(0, 20), curId })); } catch { /* ignore */ }
};

// ── endpoint catalog parsing ────────────────────────────────────────────────
interface EndpointGroup { group: string; paths: string[] }
function parseCatalog(md: string): EndpointGroup[] {
  const groups: EndpointGroup[] = [];
  let cur: EndpointGroup | null = null;
  for (const line of md.split('\n')) {
    if (line.startsWith('## ')) { cur = { group: line.slice(3).trim(), paths: [] }; groups.push(cur); }
    else if (line.startsWith('- ') && cur) cur.paths.push(line.slice(2).trim());
  }
  return groups.filter(g => g.paths.length);
}

// Parameters inside a catalog path: {id}, {supplierNumber}, :invoice_id …
function getEpParams(p: string): string[] {
  const out: string[] = [];
  const re = /\{([A-Za-z0-9_]+)\}|:([A-Za-z_][A-Za-z0-9_]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(p)) !== null) {
    const name = m[1] || m[2];
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

// What the parameter form is collecting values for: a catalog endpoint or a
// training recipe (method + URL template + declared parameters).
interface ParamTarget { title: string; method: string; path: string; params: RecipeParam[]; trained?: boolean }

// One row of the "/" popup — a training recipe or a catalog endpoint
interface SlashItem { kind: 'recipe' | 'endpoint'; label: string; sub?: string; params?: string; recipe?: TrainingRecipe; trained?: boolean }

// Map a raw /ai/training row. Handler versions differ in key casing
// (camelCase aliases vs. plain snake_case columns) — accept both, and
// params/example may arrive as JSON strings or already-parsed values.
const parseJsonSafe = <T,>(s: unknown, fallback: T): T => {
  if (Array.isArray(s) || (s !== null && typeof s === 'object')) return s as T;
  if (typeof s !== 'string' || !s.trim()) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
};
const mapRecipeRow = (raw: Record<string, unknown>): TrainingRecipe => {
  // key casing varies by handler version (recipeName / recipe_name /
  // recipename) — compare with case and underscores stripped
  const norm: Record<string, unknown> = {};
  Object.keys(raw).forEach(k => { norm[k.toLowerCase().replace(/_/g, '')] = raw[k]; });
  const g = (k: string) => norm[k];
  return {
    recipeId: Number(g('recipeid')) || undefined,
    recipeName: String(g('recipename') || ''),
    description: g('description') as string | undefined,
    module: g('module') as string | undefined,
    method: String(g('method') || 'GET'),
    urlTemplate: String(g('urltemplate') || ''),
    params: parseJsonSafe<RecipeParam[]>(g('paramsjson'), []),
    example: parseJsonSafe<Record<string, string>>(g('examplejson'), {}),
    appPath: g('apppath') as string | undefined,
    enabled: g('enabled') as string | undefined,
    createdBy: g('createdby') as string | undefined,
  };
};

// Field-type detection for the search panel
const isBuParam = (n: string) => /business_?unit/i.test(n) || /^bu$/i.test(n);
const isLedgerParam = (n: string) => /ledger/i.test(n);
const isCompanyParam = (n: string) => /company/i.test(n);
const isDateParam = (n: string) => /date/i.test(n);
// BU / ledger / company are always mandatory when the recipe has them
const isForcedRequired = (n: string) => isBuParam(n) || isLedgerParam(n) || isCompanyParam(n);

// Pull one display value out of a LOV row regardless of key casing
const lovValue = (it: Record<string, unknown>, keys: string[]): string => {
  const n: Record<string, unknown> = {};
  Object.keys(it).forEach(k => { n[k.toLowerCase().replace(/_/g, '')] = it[k]; });
  for (const k of keys) { const v = n[k]; if (v !== undefined && v !== null && v !== '') return String(v); }
  return '';
};

// Normalize a path/template for comparison: strip origin, query, trailing "/"
function normPath(t: string): string {
  let s = String(t || '').trim();
  try { if (/^https?:/i.test(s)) s = new URL(s).pathname; } catch { /* keep as-is */ }
  return s.split('?')[0].replace(/\/+$/, '');
}

// ── xlsx preview data ───────────────────────────────────────────────────────
interface SheetPreview { name: string; rows: (string | number)[][] }

// One entry in the preview history: a direct run, a SQL query, or a result
// set the AI produced during a chat turn
interface PreviewEntry {
  id: string;
  kind: 'direct' | 'sql' | 'ai';
  title: string;
  rows: Record<string, unknown>[];
  raw: string | null;
  at: number;
}

// ── chat-table export & share ───────────────────────────────────────────────
// Markdown tables in AI answers get Excel / PDF / Share actions.

function extractMdTables(md: string): string[][][] {
  const tables: string[][][] = [];
  const blocks = md.match(/(?:^\|.*\|[ \t]*$\n?)+/gm) || [];
  const isSep = (l: string) => /^\s*\|?[\s:|-]+\|?\s*$/.test(l) && l.includes('-');
  for (const b of blocks) {
    const lines = b.trim().split('\n').filter(l => l.trim().startsWith('|'));
    const rows = lines
      .filter(l => !isSep(l))
      .map(l => l.replace(/^\||\|$/g, '').split('|').map(c => c.trim().replace(/\*\*/g, '').replace(/`/g, '')));
    if (rows.length >= 2) tables.push(rows);
  }
  return tables;
}

const tableCellValue = (c: string): string | number => {
  const cleaned = c.replace(/,/g, '');
  return c !== '' && /^[+-]?\d+(\.\d+)?$/.test(cleaned) ? Number(cleaned) : c;
};

async function buildTablesWorkbook(tables: string[][][]): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  tables.forEach((t, i) => {
    const ws = wb.addWorksheet(tables.length > 1 ? `Table ${i + 1}` : 'Report');
    t.forEach((r, ri) => {
      const row = ws.addRow(r.map(tableCellValue));
      if (ri === 0) {
        row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        row.eachCell(cell => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC74634' } }; });
      }
    });
    t[0].forEach((_h, ci) => {
      ws.getColumn(ci + 1).width = Math.min(45, Math.max(12, ...t.map(r => String(r[ci] ?? '').length + 2)));
    });
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  });
  return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}

const chatFileStamp = () => dayjs().format('YYYYMMDD-HHmmss');
type ElectronFileApi = {
  openExcel?: (b: unknown, f: string) => Promise<unknown>;
  selectFolder?: () => Promise<{ canceled?: boolean; filePaths?: string[]; folderPath?: string } | string | null>;
  saveFileToFolder?: (b: unknown, folder: string, f: string) => Promise<unknown>;
};
const eFileApi = (): ElectronFileApi => (window as unknown as { electronAPI?: ElectronFileApi }).electronAPI || {};

async function exportChatTablesExcel(tables: string[][][]) {
  const buf = await buildTablesWorkbook(tables);
  const eAPI = eFileApi();
  if (eAPI.openExcel) await eAPI.openExcel(buf, `report-${chatFileStamp()}.xlsx`);
  else antMessage.warning('Excel export needs the desktop app');
}

function exportChatTablesPdf(tables: string[][][]) {
  const doc = new jsPDF({ orientation: tables.some(t => t[0].length > 6) ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
  let y = 28;
  tables.forEach(t => {
    autoTable(doc, {
      head: [t[0]],
      body: t.slice(1),
      startY: y,
      styles: { fontSize: 8, cellPadding: 3, overflow: 'linebreak' },
      headStyles: { fillColor: [199, 70, 52], textColor: 255 },
      alternateRowStyles: { fillColor: [251, 244, 242] },
    });
    y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 22;
  });
  doc.save(`report-${chatFileStamp()}.pdf`);
}

const tablesAsText = (tables: string[][][]) =>
  tables.map(t => t.map(r => r.join('\t')).join('\n')).join('\n\n');
const tablesAsMarkdown = (tables: string[][][]) =>
  tables.map(t => [
    `| ${t[0].join(' | ')} |`,
    `| ${t[0].map(() => '---').join(' | ')} |`,
    ...t.slice(1).map(r => `| ${r.join(' | ')} |`),
  ].join('\n')).join('\n\n');

async function shareChatTables(key: string, tables: string[][][]) {
  if (key === 'copy') {
    await navigator.clipboard.writeText(tablesAsText(tables));
    antMessage.success('Copied — paste straight into Excel or an email');
  } else if (key === 'markdown') {
    await navigator.clipboard.writeText(tablesAsMarkdown(tables));
    antMessage.success('Copied as Markdown');
  } else if (key === 'email') {
    const body = tablesAsText(tables);
    const a = document.createElement('a');
    a.href = `mailto:?subject=${encodeURIComponent('Re-ERP report')}&body=${encodeURIComponent(body.slice(0, 1800))}`;
    a.click();
    if (body.length > 1800) {
      await navigator.clipboard.writeText(body);
      antMessage.info('Table is long — the full version is on your clipboard, paste it into the email');
    }
  } else if (key === 'folder') {
    const eAPI = eFileApi();
    if (!eAPI.selectFolder || !eAPI.saveFileToFolder) { antMessage.warning('Needs the desktop app'); return; }
    const sel = await eAPI.selectFolder();
    const folder = typeof sel === 'string' ? sel : sel?.folderPath || sel?.filePaths?.[0];
    if (!folder) return;
    const buf = await buildTablesWorkbook(tables);
    await eAPI.saveFileToFolder(buf, folder, `report-${chatFileStamp()}.xlsx`);
    antMessage.success('Excel file saved to the selected folder');
  }
}

// ── memoized heavy sections ─────────────────────────────────────────────────
// Typing in the chat box re-renders the page every keystroke; these keep the
// expensive parts (markdown bubbles, the direct-result grid, the 283-row
// endpoint list) from re-rendering unless their own data changed.

const MsgBubble = React.memo(function MsgBubble({ m }: { m: ChatMsg }) {
  const tables = m.role === 'assistant' && m.text ? extractMdTables(m.text) : [];
  return (
    <div className={`cc-row ${m.role === 'user' ? 'me' : 'bot'}`}>
      <div className="cc-bubble">
        {m.role === 'assistant' && <div><span className="cc-srcflag">AI</span></div>}
        {!!m.tools?.length && (
          <div style={{ marginBottom: m.text ? 6 : 0 }}>
            {m.tools.map((t, j) => {
              const name = (typeof t === 'string' ? t : t.name).replace(/^mcp__/, '');
              const detail = typeof t === 'string' ? '' : (t.detail || '');
              const chip = (
                <span className="cc-toolchip">
                  <ApiOutlined />{name}
                  {detail && <span className="cc-toolcmd">{detail.length > 90 ? `${detail.slice(0, 90)}…` : detail}</span>}
                </span>
              );
              return detail
                ? <Tooltip key={j} title={<span style={{ fontSize: 11, fontFamily: 'Consolas, monospace', wordBreak: 'break-all' }}>{detail}</span>}>{chip}</Tooltip>
                : <React.Fragment key={j}>{chip}</React.Fragment>;
            })}
          </div>
        )}
        {m.role === 'user'
          ? m.text.split('\n').map((l, j) => <div key={j}>{l}</div>)
          : m.text
            ? <div dangerouslySetInnerHTML={{ __html: mdToHtml(m.text) }} />
            : <Text type="secondary" style={{ fontSize: 12 }}>working…</Text>}
        {tables.length > 0 && (
          <div className="cc-tblactions">
            <Button size="small" icon={<FileExcelOutlined style={{ color: '#1D7B4D' }} />}
              onClick={() => exportChatTablesExcel(tables)}>Excel</Button>
            <Button size="small" icon={<FilePdfOutlined style={{ color: '#C74634' }} />}
              onClick={() => exportChatTablesPdf(tables)}>PDF</Button>
            <Dropdown
              trigger={['click']}
              menu={{
                items: [
                  { key: 'copy', icon: <SnippetsOutlined />, label: 'Copy for Excel / email (tab-separated)' },
                  { key: 'markdown', icon: <FileTextOutlined />, label: 'Copy as Markdown' },
                  { key: 'email', icon: <MailOutlined />, label: 'Email…' },
                  { key: 'folder', icon: <FolderOpenOutlined />, label: 'Save Excel to folder…' },
                ],
                onClick: ({ key }) => { shareChatTables(key, tables); },
              }}
            >
              <Button size="small" icon={<ShareAltOutlined />}>Share</Button>
            </Dropdown>
          </div>
        )}
      </div>
    </div>
  );
});

const DirectGrid = React.memo(function DirectGrid({ data, columns }: {
  data: Record<string, unknown>[]; columns: ColumnsType<Record<string, unknown>>;
}) {
  return (
    <Table
      size="small"
      dataSource={data}
      rowKey="__rk"
      columns={columns}
      pagination={{ pageSize: 100, size: 'small', showSizeChanger: false, showTotal: t => `${t} rows` }}
      scroll={{ x: 'max-content' }}
    />
  );
});

const EndpointsList = React.memo(function EndpointsList({ groups, trained, onRun, onForm }: {
  groups: EndpointGroup[]; trained: Set<string>; onRun: (p: string) => void; onForm: (p: string) => void;
}) {
  return (
    <>
      {groups.map(g => (
        <div key={g.group}>
          <div className="cc-epgroup">{g.group}</div>
          {g.paths.map(p => {
            const hasParams = getEpParams(p).length > 0;
            const isTrained = trained.has(p);
            return (
              <div key={p} className="cc-ep-row">
                <Tooltip placement="right" mouseEnterDelay={0.6}
                  title={isTrained
                    ? `Trained ✓ — click to open the search panel with this recipe's parameters`
                    : hasParams
                      ? `Has parameters — click to fill them in and run GET ${p}`
                      : `Click to ask Claude to run GET ${p}`}>
                  <button className={`cc-ep${hasParams ? ' cc-ep-param' : ''}`} onClick={() => onRun(p)}>
                    {p}
                    {isTrained && <span className="cc-ep-tick">✓</span>}
                    {!isTrained && hasParams && <span className="cc-ep-badge">⋯</span>}
                  </button>
                </Tooltip>
                <Tooltip title="Open the search panel to enter parameters" placement="right">
                  <button className="cc-ep-gear" onClick={() => onForm(p)}><FilterOutlined /></button>
                </Tooltip>
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
});

const ClaudeChat: React.FC = () => {
  const api = getApi();
  const init = useRef(loadState());
  const [convs, setConvs] = useState<Conv[]>(init.current.convs);
  const [curId, setCurId] = useState<string>(init.current.curId);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [liveTool, setLiveTool] = useState('');
  const [cliOk, setCliOk] = useState<boolean | null>(null);
  const [lastError, setLastError] = useState('');
  const [catalog, setCatalog] = useState<EndpointGroup[]>([]);
  const [epSearch, setEpSearch] = useState('');
  const [paramTarget, setParamTarget] = useState<ParamTarget | null>(null); // endpoint/recipe awaiting parameter values
  const [paramVals, setParamVals] = useState<Record<string, string>>({});
  const [paramQuery, setParamQuery] = useState('');
  const [extraRows, setExtraRows] = useState<{ k: string; v: string }[]>([]); // user-added query/body parameters
  const [recipes, setRecipes] = useState<TrainingRecipe[]>([]);
  const [recipeErr, setRecipeErr] = useState(''); // why /ai/training returned nothing
  const [luBU, setLuBU] = useState<string[]>([]); // list-of-values for the search panel
  const [luLedger, setLuLedger] = useState<string[]>([]);
  const [luCompany, setLuCompany] = useState<string[]>([]);
  const [previewFile, setPreviewFile] = useState<WsFile | null>(null);
  const [previewSheets, setPreviewSheets] = useState<SheetPreview[] | null>(null);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [prevHist, setPrevHist] = useState<PreviewEntry[]>([]); // newest first, capped
  const [prevId, setPrevId] = useState('');
  const directResult = useMemo(() => prevHist.find(e => e.id === prevId) ?? null, [prevHist, prevId]);
  const [directLoading, setDirectLoading] = useState(false);
  const [directSearch, setDirectSearch] = useState('');
  const [previewFull, setPreviewFull] = useState(false);
  const directResultRef = useRef<PreviewEntry | null>(null);
  useEffect(() => { directResultRef.current = directResult; setDirectSearch(''); }, [directResult]);
  const lastToolDetailRef = useRef(''); // titles AI-produced preview entries

  const pushPreview = useCallback((kind: PreviewEntry['kind'], title: string, rows: Record<string, unknown>[], raw: string | null) => {
    const id = `p${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setPrevHist(prev => [{ id, kind, title, rows, raw, at: Date.now() }, ...prev].slice(0, 15));
    setPrevId(id);
    setPreviewFile(null);
    setPreviewSheets(null);
    setPreviewText(null);
  }, []);
  const [dbOpen, setDbOpen] = useState(false); // SQL DB browser in the preview panel
  const [dbTables, setDbTables] = useState<{ name: string; rows: number; columns: string[] }[]>([]);
  const [dbSql, setDbSql] = useState('');
  const [dbErr, setDbErr] = useState('');
  const [dbBusy, setDbBusy] = useState(false);
  const [sqlLoadOpen, setSqlLoadOpen] = useState(false); // "→ SQL" dialog
  const [sqlLoadTable, setSqlLoadTable] = useState('');
  const [sqlLoadMode, setSqlLoadMode] = useState<'replace' | 'append'>('replace');
  const [slashIdx, setSlashIdx] = useState(0);
  const [files, setFiles] = useState<WsFile[]>([]);
  const [filesOpen, setFilesOpen] = useState(false); // workspace files list, hidden by default
  const listRef = useRef<HTMLDivElement>(null);
  const curIdRef = useRef(curId);
  useEffect(() => { curIdRef.current = curId; }, [curId]);

  const cur = useMemo(() => convs.find(c => c.id === curId) ?? null, [convs, curId]);
  const msgs = cur?.msgs ?? [];

  useEffect(() => { saveState(convs, curId); }, [convs, curId]);
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [msgs, busy, liveTool]);

  // load recipes with diagnostics: the debug record says exactly what
  // /ai/training answered, so an empty list is never a silent mystery
  const loadRecipes = useCallback(async (): Promise<TrainingRecipe[]> => {
    // main-process fetch first (same network path as the workspace's
    // call-api script, which is known to work), renderer fetch as fallback
    let list: TrainingRecipe[] = [];
    let err = '';
    try {
      const r = await api?.claudeChatRecipes?.({ apexBaseUrl: buildCompanyCtx().apexBaseUrl });
      if (r?.success && Array.isArray(r.items)) {
        list = r.items.map(mapRecipeRow).filter(x => x.recipeName && x.urlTemplate && x.enabled !== 'N');
        if (!list.length) {
          err = r.items.length
            ? `${r.url || '/ai/training'} → OK, ${r.items.length} rows but keys not recognized: ${Object.keys(r.items[0] || {}).slice(0, 10).join(', ')}`
            : `${r.url || '/ai/training'} → OK but 0 recipes returned`;
        }
      } else if (r) {
        err = `${r.url || '/ai/training'} → ${r.error || 'failed'}`;
      }
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
    }
    if (!list.length) {
      try {
        const viaRenderer = await fetchTrainingRecipes(true);
        if (viaRenderer.length) { list = viaRenderer; err = ''; }
      } catch { /* keep main-process error */ }
    }
    setRecipes(list);
    setRecipeErr(list.length ? '' : (err || 'no recipes returned'));
    return list;
  }, [api]);

  // business units / ledgers / companies fetched once at page open —
  // they become dropdown lists of values in the search panel
  const loadLovs = useCallback(async () => {
    const apex = buildCompanyCtx().apexBaseUrl;
    const get = async (path: string): Promise<Record<string, unknown>[]> => {
      try {
        const r = await api?.claudeChatLov?.({ apexBaseUrl: apex, path });
        return r?.success && Array.isArray(r.items) ? r.items : [];
      } catch { return []; }
    };
    const uniq = (a: string[]) => [...new Set(a.filter(Boolean))].sort();
    const [bus, lgs, cos] = await Promise.all([
      get('gl/businessunits'), get('gl/rr-trialbalance/ledgers'), get('gl/rr-trialbalance/companies'),
    ]);
    setLuBU(uniq(bus.map(it => lovValue(it, ['businessunitname', 'buname', 'name']))));
    setLuLedger(uniq(lgs.map(it => lovValue(it, ['ledgername', 'ledger', 'name']))));
    setLuCompany(uniq(cos.map(it => lovValue(it, ['company', 'companycode', 'companyname', 'segment1', 'name']))));
  }, [api]);

  useEffect(() => {
    api?.claudeCliStatus?.().then(s => setCliOk(!!s?.installed)).catch(() => setCliOk(null));
    api?.claudeChatCatalog?.().then(r => { if (r?.success) setCatalog(parseCatalog(r.markdown)); }).catch(() => { /* ignore */ });
    loadRecipes().catch(e => setRecipeErr(e instanceof Error ? e.message : String(e)));
    loadLovs();
  }, [api, loadRecipes, loadLovs]);

  const refreshFiles = useCallback(async () => {
    const r = await api?.claudeChatListFiles?.();
    if (r?.success) setFiles(r.files);
  }, [api]);
  useEffect(() => { refreshFiles(); }, [refreshFiles]);

  const mutateConv = useCallback((id: string, fn: (c: Conv) => Conv) => {
    setConvs(prev => prev.map(c => (c.id === id ? fn(c) : c)).sort((a, b) => b.updatedAt - a.updatedAt));
  }, []);

  // stream events → current conversation's last assistant bubble
  useEffect(() => {
    if (!api) return;
    api.onClaudeChatEvent((_e, evt) => {
      const id = curIdRef.current;
      if (evt.kind === 'init' && evt.sessionId) {
        mutateConv(id, c => ({ ...c, sessionId: evt.sessionId! }));
      } else if (evt.kind === 'text' && evt.text) {
        setLiveTool('');
        mutateConv(id, c => {
          const msgsN = [...c.msgs];
          const last = msgsN[msgsN.length - 1];
          if (last && last.role === 'assistant') {
            msgsN[msgsN.length - 1] = { ...last, text: last.text ? `${last.text}\n\n${evt.text}` : evt.text! };
          } else msgsN.push({ role: 'assistant', text: evt.text!, tools: [] });
          return { ...c, msgs: msgsN, updatedAt: Date.now() };
        });
      } else if (evt.kind === 'tool') {
        const entry: ToolRef = { name: evt.name || 'tool', detail: evt.detail };
        lastToolDetailRef.current = evt.detail || evt.name || '';
        setLiveTool(evt.detail ? `${evt.name}: ${evt.detail.slice(0, 70)}` : (evt.name || 'tool'));
        mutateConv(id, c => {
          const msgsN = [...c.msgs];
          const last = msgsN[msgsN.length - 1];
          if (last && last.role === 'assistant') {
            msgsN[msgsN.length - 1] = { ...last, tools: [...(last.tools || []), entry] };
          } else msgsN.push({ role: 'assistant', text: '', tools: [entry] });
          return { ...c, msgs: msgsN, updatedAt: Date.now() };
        });
      } else if (evt.kind === 'toolresult' && evt.text) {
        // tabular tool output (query-db / call-api JSON) → preview history
        const t = evt.text.replace(/^HTTP \d+\s*\n/, '');
        const tryParse = (s: string) => { try { return JSON.parse(s); } catch { return undefined; } };
        const j = tryParse(t) ?? tryParse(t.replace(/:(\s*-?\d+)\.(?=\s*[,}\]])/g, ':$1'));
        const rows = j && Array.isArray(j.rows) ? j.rows : j && Array.isArray(j.items) ? j.items : Array.isArray(j) ? j : null;
        if (rows && rows.length && rows[0] && typeof rows[0] === 'object') {
          pushPreview('ai', `AI: ${(lastToolDetailRef.current || 'result').slice(0, 90)}`, rows as Record<string, unknown>[], null);
        }
      } else if (evt.kind === 'result') {
        if (evt.sessionId) mutateConv(id, c => ({ ...c, sessionId: evt.sessionId! }));
        if (evt.isError && evt.resultText) setLastError(evt.resultText);
      } else if (evt.kind === 'error') {
        setLastError(evt.error || 'Unknown error');
      } else if (evt.kind === 'done') {
        setBusy(false);
        setLiveTool('');
        refreshFiles();
      }
    });
    return () => api.removeClaudeChatListeners();
  }, [api, mutateConv, refreshFiles, pushPreview]);

  const send = useCallback(async (textArg?: string) => {
    const text = (textArg ?? input).trim();
    if (!text || busy || !api) return;
    let id = curIdRef.current;
    let sessionId: string | null = null;
    if (!convs.find(c => c.id === id)) {
      id = `c${Date.now()}`;
      setConvs(prev => [{ id, title: text.slice(0, 42), sessionId: null, msgs: [], updatedAt: Date.now() }, ...prev]);
      setCurId(id);
      curIdRef.current = id;
    } else {
      sessionId = convs.find(c => c.id === id)?.sessionId ?? null;
    }
    setInput('');
    setLastError('');
    mutateConv(id, c => ({
      ...c,
      title: c.title || text.slice(0, 42),
      msgs: [...c.msgs, { role: 'user', text }],
      updatedAt: Date.now(),
    }));
    setBusy(true);
    // a direct-query result on screen becomes context for the question:
    // its rows are saved to a workspace file that Claude reads for analysis
    let outbound = text;
    const d = directResultRef.current;
    if (d && d.rows.length && api.claudeChatSaveDirect) {
      try {
        const r0 = await api.claudeChatSaveDirect({
          json: JSON.stringify({ source: `GET ${d.title}`, rowCount: d.rows.length, items: d.rows }),
        });
        if (r0?.success) {
          const src = d.title.startsWith('SQL:') ? d.title : `GET ${d.title}`;
          outbound += `\n\n(Context: the data currently shown in the app came from ${src} — the full result, ${d.rows.length} rows, is saved in the workspace file direct-result.json. Read that file (or query erp-data.db if the table exists) to answer/analyze instead of re-querying the API.)`;
        }
      } catch { /* send without context */ }
    }
    const r = await api.claudeChatSend({ text: outbound, sessionId, ctx: buildCompanyCtx() });
    if (!r.success) {
      setBusy(false);
      antMessage.error(r.error || 'Could not send');
    }
  }, [input, busy, api, convs, mutateConv]);

  const newChat = () => { setCurId(''); setLastError(''); setParamTarget(null); };

  // A training recipe that targets this endpoint (its URL template's path
  // matches) — its declared params give the search panel real labeled fields.
  const recipeForEndpoint = (p: string, list: TrainingRecipe[]): TrainingRecipe | undefined => {
    const target = normPath(p);
    if (!target) return undefined;
    const matches = list.filter(r => {
      const rp = normPath(r.urlTemplate);
      return rp === target || rp.endsWith(target);
    });
    return matches.find(r => (r.method || 'GET').toUpperCase() === 'GET') || matches[0];
  };

  // catalog paths that have a training recipe — shown with a "Trained ✓" flag
  const trainedSet = useMemo(() => {
    const rps = recipes.map(r => normPath(r.urlTemplate)).filter(Boolean);
    const s = new Set<string>();
    if (!rps.length) return s;
    for (const g of catalog) {
      for (const p of g.paths) {
        const np = normPath(p);
        if (np && rps.some(rp => rp === np || rp.endsWith(np))) s.add(p);
      }
    }
    return s;
  }, [recipes, catalog]);

  // the search panel: works for ANY endpoint — a matching training recipe's
  // declared parameters when one exists, else placeholders (if any) plus
  // user-added query parameters. If no recipe matched, the list may simply
  // not have loaded yet (page opened offline, slow ORDS) — refetch and retry
  // once before falling back to the generic form.
  const openEndpointForm = async (p: string) => {
    let r = recipeForEndpoint(p, recipes);
    if (!r) {
      try {
        r = recipeForEndpoint(p, await loadRecipes());
      } catch { /* offline — generic form below */ }
    }
    if (r) { pickRecipe(r); return; }
    setParamTarget({ title: `GET ${p}`, method: 'GET', path: p, params: getEpParams(p).map(n => ({ name: n })) });
    setParamVals({});
    setParamQuery('');
    setExtraRows([]);
  };

  // stable wrappers so the memoized endpoint list never re-renders on typing
  const clickEndpointRef = useRef<(p: string) => void>(() => { /* set below */ });
  const openFormRef = useRef<(p: string) => void>(() => { /* set below */ });
  const stableClickEndpoint = useCallback((p: string) => clickEndpointRef.current(p), []);
  const stableOpenForm = useCallback((p: string) => openFormRef.current(p), []);

  // endpoint click: trained or parameterized paths open the fill-in form,
  // plain ones go straight to the input
  const clickEndpoint = (p: string) => {
    if (trainedSet.has(p) || getEpParams(p).length) {
      openEndpointForm(p);
    } else {
      setParamTarget(null);
      setInput(`Run GET ${p}`);
    }
  };
  clickEndpointRef.current = clickEndpoint;
  openFormRef.current = openEndpointForm;

  // training recipe pick: always opens the search panel first (declared params
  // + any placeholders still in the URL template; extras can be added by hand),
  // so the user reviews/fills parameters before anything runs
  const pickRecipe = (r: TrainingRecipe) => {
    const method = (r.method || 'GET').toUpperCase();
    const params: RecipeParam[] = [...(r.params || [])];
    getEpParams(r.urlTemplate).forEach(n => { if (!params.some(p => p.name === n)) params.push({ name: n }); });
    setParamTarget({ title: `${r.recipeName} — ${method} ${r.urlTemplate}`, method, path: r.urlTemplate, params, trained: true });
    setParamVals({});
    setParamQuery('');
    setExtraRows([]);
  };

  // Build the final request from the panel's values. Shared by "Ask Claude"
  // and the direct (no-AI) runner. Returns null after warning when a
  // hard-required field (BU / ledger / company) is empty.
  const composeRequest = () => {
    if (!paramTarget) return null;
    const forcedMissing = paramTarget.params.filter(
      p => isForcedRequired(p.name) && !(paramVals[p.name] || '').trim(),
    );
    if (forcedMissing.length) {
      antMessage.warning(`Please select: ${forcedMissing.map(p => p.label || p.name).join(', ')}`);
      return null;
    }
    let path = paramTarget.path;
    const missing: string[] = [];
    const extraPairs: [string, string][] = []; // filled params that are not URL placeholders
    for (const p of paramTarget.params) {
      const v = (paramVals[p.name] || '').trim();
      const phRe = () => new RegExp(`\\{${p.name}\\}|:${p.name}(?![A-Za-z0-9_])`, 'g');
      const inPath = phRe().test(path.split('?')[0]);
      if (v) {
        if (phRe().test(path)) path = path.replace(phRe(), encodeURIComponent(v));
        else extraPairs.push([p.name, v]);
      } else if (inPath || p.required) {
        // blank query-only placeholders are simply omitted below
        missing.push(p.name);
      }
    }
    // drop query pairs whose placeholder was left blank (optional filters)
    const qIdx = path.indexOf('?');
    if (qIdx >= 0) {
      const kept = path.slice(qIdx + 1).split('&').filter(kv => kv && !/\{[A-Za-z0-9_]+\}/.test(kv));
      path = kept.length ? `${path.slice(0, qIdx)}?${kept.join('&')}` : path.slice(0, qIdx);
    }
    extraRows.forEach(({ k, v }) => {
      if (k.trim() && v.trim()) extraPairs.push([k.trim(), v.trim()]);
    });
    let qParts = [paramQuery.trim().replace(/^[?&]/, '')].filter(Boolean);
    if (paramTarget.method === 'GET') {
      qParts = qParts.concat(extraPairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`));
    }
    if (qParts.length) path += (path.includes('?') ? '&' : '?') + qParts.join('&');
    return { path, missing, extraPairs, method: paramTarget.method };
  };

  const runParamEp = () => {
    if (busy) return;
    const req = composeRequest();
    if (!req) return;
    let text = `Run ${req.method} ${req.path}`;
    if (req.method !== 'GET') {
      if (req.extraPairs.length) text += ` with ${req.extraPairs.map(([k, v]) => `${k}=${v}`).join(', ')}`;
      text += ' — show me the full request and wait for my confirmation before executing';
    }
    if (req.missing.length) {
      text += ` — I left ${req.missing.map(n => `{${n}}`).join(', ')} blank; look up a sensible value first or ask me.`;
    }
    setParamTarget(null);
    send(text);
  };

  // Direct query — no AI in the loop: the composed GET runs through the main
  // process and the rows render in the Preview pane within a second or two.
  const runDirect = async () => {
    const req = composeRequest();
    if (!req) return;
    if (req.method !== 'GET') { runParamEp(); return; } // writes always go through Claude + confirmation
    setDirectLoading(true);
    try {
      const r = await api?.claudeChatApiGet?.({ apexBaseUrl: buildCompanyCtx().apexBaseUrl, path: req.path });
      if (!r?.success || !r.text) {
        antMessage.error(r?.error || 'Request failed');
        return;
      }
      let rows: Record<string, unknown>[] = [];
      let raw: string | null = null;
      const tryParse = (s: string) => { try { return JSON.parse(s); } catch { return undefined; } };
      // Oracle can emit numbers with a trailing dot ("amount":-3706.) — invalid
      // JSON; strip the dot in value position and parse again
      const j = tryParse(r.text) ?? tryParse(r.text.replace(/:(\s*-?\d+)\.(?=\s*[,}\]])/g, ':$1'));
      if (j === undefined) raw = r.text;
      else if (j && Array.isArray(j.items)) rows = j.items;
      else if (Array.isArray(j)) rows = j;
      else raw = JSON.stringify(j, null, 2);
      pushPreview('direct', req.path, rows, raw);
    } finally {
      setDirectLoading(false);
    }
  };

  // one global search box filters every column; sorting stays per column.
  // ID-ish columns (…Id, …Number) are identifiers — never thousand-formatted.
  const isIdCol = (k: string) => /(id|number)$/i.test(k);
  const directRows = useMemo(() => {
    if (!directResult) return [];
    const q = directSearch.trim().toLowerCase();
    if (!q) return directResult.rows;
    return directResult.rows.filter(r => Object.values(r).some(v => String(v ?? '').toLowerCase().includes(q)));
  }, [directResult, directSearch]);

  const directColumns = useMemo<ColumnsType<Record<string, unknown>>>(() => {
    if (!directResult?.rows.length) return [];
    return Object.keys(directResult.rows[0]).map(k => ({
      title: k,
      dataIndex: k,
      key: k,
      ellipsis: true,
      sorter: (a: Record<string, unknown>, b: Record<string, unknown>) => {
        const av = a[k], bv = b[k];
        if (typeof av === 'number' && typeof bv === 'number') return av - bv;
        return String(av ?? '').localeCompare(String(bv ?? ''));
      },
      render: (v: unknown) =>
        v === null || v === undefined
          ? ''
          : typeof v === 'number' && !isIdCol(k)
            ? <span style={{ display: 'block', textAlign: 'right' }}>{v.toLocaleString()}</span>
            : typeof v === 'object' ? JSON.stringify(v) : String(v),
    }));
  }, [directResult]);

  const directData = useMemo(
    () => directRows.map((row, i) => ({ ...row, __rk: i })),
    [directRows],
  );

  // ── local SQL database (erp-data.db in the workspace) ─────────────────────
  const loadDbTables = useCallback(async () => {
    setDbErr('');
    try {
      const r = await api?.claudeChatQueryDb?.({ tables: true, ctx: buildCompanyCtx() });
      if (r?.success) setDbTables(r.tables || []);
      else { setDbTables([]); setDbErr(r?.error || 'Could not read the database'); }
    } catch (e) { setDbErr(e instanceof Error ? e.message : String(e)); }
  }, [api]);

  const runSql = useCallback(async (sql: string, title?: string) => {
    const s = sql.trim();
    if (!s) return;
    setDbBusy(true);
    setDbErr('');
    try {
      const r = await api?.claudeChatQueryDb?.({ sql: s, ctx: buildCompanyCtx() });
      if (!r?.success) { setDbErr(r?.error || 'Query failed'); return; }
      pushPreview(
        'sql',
        title || `SQL: ${s.slice(0, 90)}`,
        r.rows || [],
        (r.rows || []).length ? null : JSON.stringify(r, null, 2),
      );
    } finally { setDbBusy(false); }
  }, [api, pushPreview]);

  // "→ SQL" opens a small dialog: editable table name + Replace/Append
  const openSqlLoad = () => {
    const d = directResultRef.current;
    if (!d || !d.rows.length) return;
    const derived = d.title.split('?')[0].split('/').filter(Boolean).join('_').replace(/[^A-Za-z0-9_]/g, '_').toLowerCase() || 'data';
    setSqlLoadTable(derived);
    setSqlLoadMode('replace');
    setSqlLoadOpen(true);
  };

  const doSqlLoad = async () => {
    const d = directResultRef.current;
    const table = sqlLoadTable.trim().replace(/[^A-Za-z0-9_]/g, '_');
    if (!d || !d.rows.length || !table || !api?.claudeChatLoadDb) return;
    setDbBusy(true);
    try {
      const r = await api.claudeChatLoadDb({
        json: JSON.stringify({ items: d.rows }), table, mode: sqlLoadMode, ctx: buildCompanyCtx(),
      });
      if (r?.success) {
        antMessage.success(r.message || `Loaded into table ${table}`);
        setSqlLoadOpen(false);
        setDbOpen(true);
        loadDbTables();
      } else {
        antMessage.error(r?.error || 'Load failed');
      }
    } finally { setDbBusy(false); }
  };

  const directCell = (k: string, v: unknown): string | number => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return isIdCol(k) ? String(v) : v;
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  };

  const exportDirectExcel = async () => {
    if (!directResult || !directRows.length) return;
    const keys = Object.keys(directResult.rows[0]);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Data');
    const head = ws.addRow(keys);
    head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    head.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC74634' } }; });
    directRows.forEach(r => ws.addRow(keys.map(k => directCell(k, r[k]))));
    keys.forEach((k, i) => { ws.getColumn(i + 1).width = Math.min(45, Math.max(12, k.length + 4)); });
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: keys.length } };
    const buf = await wb.xlsx.writeBuffer();
    const eAPI = (window as unknown as { electronAPI?: { openExcel?: (b: unknown, f: string) => Promise<unknown> } }).electronAPI;
    const name = `direct-export-${dayjs().format('YYYYMMDD-HHmmss')}.xlsx`;
    if (eAPI?.openExcel) await eAPI.openExcel(buf, name);
    else antMessage.warning('Excel export needs the desktop app');
  };

  const exportDirectPdf = () => {
    if (!directResult || !directRows.length) return;
    const keys = Object.keys(directResult.rows[0]);
    const doc = new jsPDF({ orientation: keys.length > 6 ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
    doc.setFontSize(10);
    doc.text(directResult.title.slice(0, 120), 24, 24);
    autoTable(doc, {
      head: [keys],
      body: directRows.map(r => keys.map(k => String(directCell(k, r[k])))),
      startY: 32,
      styles: { fontSize: 6.5, cellPadding: 2, overflow: 'linebreak' },
      headStyles: { fillColor: [199, 70, 52], textColor: 255 },
      alternateRowStyles: { fillColor: [251, 244, 242] },
    });
    doc.save(`direct-export-${dayjs().format('YYYYMMDD-HHmmss')}.pdf`);
  };

  // ── "/" popup: training recipes + endpoints, like the CLI's slash menu ────
  const slashOpen = !busy && input.startsWith('/');
  const slashItems = useMemo<SlashItem[]>(() => {
    if (!slashOpen) return [];
    // "/r <q>" = recipes only, "/e <q>" = endpoints only, "/<q>" = both
    const raw = input.slice(1);
    let mode: 'all' | 'recipe' | 'endpoint' = 'all';
    let q = raw.trim().toLowerCase();
    const m = raw.match(/^([re])(?:\s+(.*))?$/i);
    if (m) {
      mode = m[1].toLowerCase() === 'r' ? 'recipe' : 'endpoint';
      q = (m[2] || '').trim().toLowerCase();
    }
    const match = (s?: string) => !q || (s || '').toLowerCase().includes(q);
    const items: SlashItem[] = [];
    if (mode !== 'endpoint') {
      recipes.forEach(r => {
        if (match(r.recipeName) || match(r.description) || match(r.urlTemplate)) {
          items.push({
            kind: 'recipe',
            label: r.recipeName,
            sub: `${(r.method || 'GET').toUpperCase()} ${r.urlTemplate}`,
            params: (r.params || []).map(p => p.name + (p.required ? '*' : '')).join(', '),
            recipe: r,
          });
        }
      });
    }
    if (mode !== 'recipe') {
      let epCount = 0;
      const cap = mode === 'endpoint' ? 100 : 40;
      for (const g of catalog) {
        for (const p of g.paths) {
          if (epCount >= cap) break;
          if (match(p)) { items.push({ kind: 'endpoint', label: p, sub: g.group, trained: trainedSet.has(p) }); epCount++; }
        }
      }
    }
    return items;
  }, [slashOpen, input, recipes, catalog, trainedSet]);
  useEffect(() => { setSlashIdx(0); }, [input]);
  useEffect(() => {
    document.getElementById(`cc-slash-${slashIdx}`)?.scrollIntoView({ block: 'nearest' });
  }, [slashIdx]);

  // "/" selection always opens the search panel before running — no need to
  // ask for it in the chat; just press Run if there is nothing to fill in
  const pickSlash = (it: SlashItem) => {
    setInput('');
    if (it.kind === 'recipe' && it.recipe) pickRecipe(it.recipe);
    else openEndpointForm(it.label);
  };

  const cancel = async () => {
    await api?.claudeChatCancel();
    setBusy(false);
    setLiveTool('');
  };

  // ── preview loading ────────────────────────────────────────────────────────
  const openPreview = useCallback(async (f: WsFile) => {
    if (!api?.claudeChatReadFile) return;
    setPreviewFile(f);
    setPreviewSheets(null);
    setPreviewText(null);
    setPrevId('');
    const r = await api.claudeChatReadFile(f.relPath);
    if (!r?.success || !r.base64) { setPreviewText(`Could not read file: ${r?.error || 'unknown'}`); return; }
    const bin = Uint8Array.from(atob(r.base64), ch => ch.charCodeAt(0));
    const ext = f.name.toLowerCase().split('.').pop();
    if (ext === 'xlsx' || ext === 'xls') {
      try {
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(bin.buffer as ArrayBuffer);
        const sheets: SheetPreview[] = wb.worksheets.map(ws => {
          const rows: (string | number)[][] = [];
          ws.eachRow({ includeEmpty: false }, (row, n) => {
            if (n > 300) return;
            const vals = (row.values as unknown[]).slice(1).map(v => {
              if (v === null || v === undefined) return '';
              if (typeof v === 'number') return v;
              if (typeof v === 'object' && v && 'result' in (v as object)) return String((v as { result: unknown }).result ?? '');
              if (typeof v === 'object' && v && 'richText' in (v as object)) return (v as { richText: { text: string }[] }).richText.map(x => x.text).join('');
              return String(v);
            });
            rows.push(vals as (string | number)[]);
          });
          return { name: ws.name, rows };
        });
        setPreviewSheets(sheets);
      } catch (e) {
        setPreviewText(`Could not parse workbook: ${e instanceof Error ? e.message : e}`);
      }
    } else {
      const text = new TextDecoder().decode(bin);
      setPreviewText(text.slice(0, 100000));
    }
  }, [api]);

  const filteredCatalog = useMemo(() => {
    const q = epSearch.trim().toLowerCase();
    if (!q) return catalog;
    return catalog
      .map(g => ({ group: g.group, paths: g.paths.filter(p => p.toLowerCase().includes(q)) }))
      .filter(g => g.paths.length);
  }, [catalog, epSearch]);

  if (!api) {
    return (
      <div style={{ padding: 24 }}>
        <Alert type="warning" showIcon message="Claude Chat is only available in the desktop (Electron) app" />
      </div>
    );
  }

  const suggestions = [
    'Show the GL period status',
    'Run GET /ap/invoices/stats',
    'Check trial balance health for Jun-26 and export to Excel',
  ];

  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', height: 'calc(100vh - 92px)', gap: 8 }}>
      <style>{`
        .cc-body{flex:1;min-height:0;display:flex;gap:8px}
        .cc-side{width:255px;flex-shrink:0;display:flex;flex-direction:column;gap:8px;min-height:0}
        .cc-panel{background:#fff;border:1px solid #EFEAE8;border-radius:10px;display:flex;flex-direction:column;min-height:0}
        .cc-panel-head{padding:8px 12px;font-weight:600;font-size:12px;color:#6B6B6B;display:flex;align-items:center;gap:6px;border-bottom:1px solid #F3EFED}
        .cc-panel-body{flex:1;overflow-y:auto;padding:6px}
        .cc-conv{padding:8px 10px;border-radius:8px;cursor:pointer;margin-bottom:3px;position:relative}
        .cc-conv:hover{background:#F7F2F0}
        .cc-conv.on{background:#FBF1EF;border:1px solid #EAD2CC}
        .cc-conv-title{font-size:12.5px;font-weight:600;color:#3A3632;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .cc-conv-sub{font-size:10.5px;color:#9a908c}
        .cc-conv .cc-del{position:absolute;right:8px;top:50%;transform:translateY(-50%);color:#b9aca7;display:none}
        .cc-conv:hover .cc-del{display:inline-block}
        .cc-epgroup{font-size:10.5px;font-weight:700;color:#9a908c;text-transform:uppercase;margin:8px 6px 2px}
        .cc-ep{display:block;width:100%;text-align:left;border:none;background:none;font-family:Consolas,monospace;font-size:11px;
          color:#5b4a45;padding:3px 8px;border-radius:6px;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .cc-ep:hover{background:#F6EEEC;color:#C74634}
        .cc-ep-row{display:flex;align-items:center}
        .cc-ep-row .cc-ep{flex:1;min-width:0}
        .cc-ep-gear{display:none;border:none;background:none;color:#b9aca7;cursor:pointer;padding:2px 6px;border-radius:6px;flex-shrink:0}
        .cc-ep-row:hover .cc-ep-gear{display:inline-flex}
        .cc-ep-gear:hover{color:#C74634;background:#F6EEEC}
        .cc-ep-param{color:#8a5a2b}
        .cc-ep-badge{display:inline-block;margin-left:5px;color:#C79A34;font-weight:700}
        .cc-ep-tick{display:inline-block;margin-left:5px;color:#1D7B4D;font-weight:700}
        .cc-recipe{display:block;width:100%;text-align:left;border:none;background:none;padding:5px 8px;border-radius:8px;cursor:pointer}
        .cc-recipe:hover{background:#F6EEEC}
        .cc-recipe-name{display:block;font-size:12px;font-weight:600;color:#3A3632}
        .cc-recipe-sub{display:block;font-family:Consolas,monospace;font-size:10.5px;color:#8B2F22;
          overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .cc-recipe-params{display:block;font-family:Consolas,monospace;font-size:10px;color:#9a908c;
          overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .cc-params{background:#fff;border:1px solid #EAD2CC;border-radius:10px;padding:10px 12px;box-shadow:0 -2px 10px rgba(199,70,52,.06)}
        .cc-params-head{display:flex;align-items:center;gap:8px;margin-bottom:8px;font-weight:600;color:#3A3632}
        .cc-params-row{display:flex;align-items:center;gap:8px;margin-bottom:6px}
        .cc-params-name{width:150px;flex-shrink:0;font-family:Consolas,monospace;font-size:12px;color:#8B2F22;text-align:right;
          overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .cc-slash{position:absolute;bottom:100%;left:0;right:52px;margin-bottom:6px;background:#fff;border:1px solid #EAD2CC;
          border-radius:10px;box-shadow:0 6px 22px rgba(0,0,0,.14);max-height:300px;overflow-y:auto;z-index:20}
        .cc-slash-head{padding:6px 12px;font-size:10.5px;color:#9a908c;border-bottom:1px solid #F3EFED;position:sticky;top:0;background:#fff}
        .cc-slash-item{display:flex;align-items:center;gap:8px;padding:6px 12px;cursor:pointer;font-size:12.5px}
        .cc-slash-item.on{background:#FBF1EF}
        .cc-slash-kind{flex-shrink:0;font-size:9.5px;font-weight:700;border-radius:4px;padding:1px 6px;background:#EEF4EC;color:#1D7B4D}
        .cc-slash-kind.recipe{background:#F1EBF7;color:#5A4482}
        .cc-slash-label{display:block;font-weight:600;color:#3A3632;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .cc-slash-params{display:block;font-family:Consolas,monospace;font-size:10px;color:#9a908c;white-space:nowrap;
          overflow:hidden;text-overflow:ellipsis}
        .cc-slash-sub{margin-left:auto;font-family:Consolas,monospace;font-size:10.5px;color:#9a908c;white-space:nowrap;
          overflow:hidden;text-overflow:ellipsis;max-width:45%;flex-shrink:0}
        .cc-slash-empty{padding:10px 12px;font-size:12px;color:#9a908c}
        .cc-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:8px}
        .cc-msgs{flex:1;overflow-y:auto;padding:14px;background:#FAF9F8;border-radius:10px;border:1px solid #EFEAE8}
        .cc-row{display:flex;margin-bottom:12px}
        .cc-row.me{justify-content:flex-end}
        .cc-bubble{max-width:82%;padding:10px 14px;border-radius:12px;font-size:13.5px;line-height:1.55;word-break:break-word}
        .cc-row.me .cc-bubble{background:#C74634;color:#fff;border-bottom-right-radius:4px}
        .cc-row.bot .cc-bubble{background:#fff;border:1px solid #EDE8E6;border-bottom-left-radius:4px;color:#3A3632}
        .cc-pre{background:#2b2b2b;color:#e8e8e8;padding:8px 10px;border-radius:8px;font-size:12px;overflow-x:auto;margin:6px 0}
        .cc-bubble code{background:#F3EDEB;color:#8B2F22;padding:1px 5px;border-radius:4px;font-size:12.5px}
        .cc-row.me .cc-bubble code{background:rgba(255,255,255,.2);color:#fff}
        .cc-table{border-collapse:collapse;margin:6px 0;font-size:12.5px;width:100%}
        .cc-table th{background:#C74634;color:#fff;padding:4px 8px;border:1px solid #d8a69d;text-align:left}
        .cc-table td{padding:4px 8px;border:1px solid #E8DEDB}
        .cc-table tr:nth-child(even) td{background:#FBF4F2}
        .cc-h{font-weight:700;margin:6px 0 2px}
        .cc-li{margin-left:6px}
        .cc-toolchip{display:inline-flex;align-items:center;gap:4px;background:#F1EBF7;border:1px solid #D9CBEA;color:#5A4482;
          border-radius:6px;padding:1px 8px;margin:2px 4px 2px 0;font-size:11px;font-family:Consolas,monospace;max-width:100%}
        .cc-toolcmd{margin-left:4px;color:#8a7aa8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:430px}
        .cc-srcflag{display:inline-block;background:#F1EBF7;border:1px solid #D9CBEA;color:#5A4482;font-size:9.5px;
          font-weight:700;border-radius:4px;padding:0 6px;margin-bottom:4px;letter-spacing:.5px}
        .cc-tblactions{display:flex;gap:6px;margin-top:10px;padding-top:8px;border-top:1px dashed #EDE3E0}
        .cc-typing span{display:inline-block;width:7px;height:7px;margin-right:4px;border-radius:50%;background:#C74634;opacity:.4;animation:ccB 1.2s infinite}
        .cc-typing span:nth-child(2){animation-delay:.2s}.cc-typing span:nth-child(3){animation-delay:.4s}
        @keyframes ccB{0%,100%{opacity:.3;transform:translateY(0)}50%{opacity:1;transform:translateY(-3px)}}
        .cc-compose{display:flex;gap:8px;align-items:flex-end}
        .cc-compose textarea{flex:1;resize:none;border:1px solid #E0D5D2;border-radius:10px;padding:10px 12px;font-size:13.5px;
          font-family:inherit;outline:none;max-height:130px;line-height:1.4}
        .cc-compose textarea:focus{border-color:#C74634;box-shadow:0 0 0 2px rgba(199,70,52,.12)}
        .cc-sug{display:inline-block;background:#fff;border:1px solid #EBE2DF;border-radius:10px;
          padding:8px 12px;margin:4px 8px 4px 0;cursor:pointer;font-size:12.5px;color:#5b4a45}
        .cc-sug:hover{border-color:#C74634;color:#C74634}
        .cc-preview{width:38%;min-width:320px;flex-shrink:0;display:flex;flex-direction:column;min-height:0}
        .cc-preview.full{position:fixed;inset:12px;z-index:1000;width:auto;min-width:0;max-width:none;
          box-shadow:0 12px 48px rgba(0,0,0,.28);border-radius:12px;background:#fff}
        .cc-ptabs{display:flex;gap:4px;overflow-x:auto;padding:4px 6px;border-bottom:1px solid #F3EFED;flex-shrink:0}
        .cc-ptab{display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border-radius:7px;border:1px solid #EBE2DF;
          font-size:11px;color:#5b4a45;cursor:pointer;white-space:nowrap;background:#fff;flex-shrink:0}
        .cc-ptab.on{background:#FBF1EF;border-color:#EAD2CC;font-weight:600}
        .cc-ptab-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
        .cc-ptab-dot.direct{background:#1D7B4D}
        .cc-ptab-dot.sql{background:#2F54EB}
        .cc-ptab-dot.ai{background:#722ED1}
        .cc-ptab-x{font-size:9px;color:#b9aca7;margin-left:2px}
        .cc-ptab-x:hover{color:#C74634}
        .cc-file{display:flex;align-items:center;gap:6px;padding:5px 8px;border-radius:8px;cursor:pointer;font-size:12px}
        .cc-file:hover{background:#F7F2F0}
        .cc-file.on{background:#FBF1EF;border:1px solid #EAD2CC}
        .cc-xl{border-collapse:collapse;font-size:11.5px;background:#fff;min-width:100%}
        .cc-xl td,.cc-xl th{padding:4px 8px;border:1px solid #E8DEDB;white-space:nowrap}
        .cc-xl tr:first-child td{background:#C74634;color:#fff;font-weight:600}
        .cc-xl tr:nth-child(even) td{background:#FBF4F2}
      `}</style>

      <Card size="small" styles={{ body: { padding: '8px 12px' } }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <ThunderboltOutlined style={{ fontSize: 18, color: '#C74634' }} />
          <Text strong>Claude Chat</Text>
          <Tag color="green">Subscription-billed</Tag>
          <Tag icon={<ApiOutlined />}>ERP MCP + REST</Tag>
          <div style={{ flex: 1 }} />
          {busy && <Button danger icon={<StopOutlined />} onClick={cancel}>Stop</Button>}
          <Tooltip title="Open the workspace folder in Explorer">
            <Button icon={<FolderOpenOutlined />} onClick={() => api.claudeChatOpenWorkspace?.()} />
          </Tooltip>
          <Button icon={<PlusOutlined />} onClick={newChat}>New chat</Button>
          <Tooltip title="Interactive terminal version">
            <Link to="/claude-cli"><Button icon={<CodeOutlined />} /></Link>
          </Tooltip>
        </div>
      </Card>

      {cliOk === false && (
        <Alert type="warning" showIcon
          message={<span>The Claude Code CLI is not installed — set it up once on the <Link to="/claude-cli">Claude Code CLI page</Link> (install + /login), then come back here.</span>} />
      )}
      {lastError && (
        <Alert type="error" showIcon closable onClose={() => setLastError('')}
          message="Claude returned an error"
          description={<span style={{ fontSize: 12 }}>{lastError.slice(0, 500)}{/login|log in|auth/i.test(lastError) && (
            <> — if this is a login problem, run <Text code>/login</Text> once on the <Link to="/claude-cli">Claude Code CLI page</Link>.</>
          )}</span>} />
      )}

      <div className="cc-body">
        {/* ── Section 1: history + endpoints ── */}
        <div className="cc-side">
          <div className="cc-panel" style={{ flex: '0 0 auto', maxHeight: '28%' }}>
            <div className="cc-panel-head">
              Chats ({convs.length})
              <span style={{ flex: 1 }} />
              <Button size="small" type="text" icon={<PlusOutlined />} onClick={newChat} />
            </div>
            <div className="cc-panel-body">
              {!convs.length && <Text type="secondary" style={{ fontSize: 12, padding: 8, display: 'block' }}>No chats yet</Text>}
              {convs.map(c => (
                <div key={c.id} className={`cc-conv${c.id === curId ? ' on' : ''}`} onClick={() => setCurId(c.id)}>
                  <div className="cc-conv-title">{c.title || 'New chat'}</div>
                  <div className="cc-conv-sub">{new Date(c.updatedAt).toLocaleDateString()} · {c.msgs.length} msgs</div>
                  <DeleteOutlined className="cc-del" onClick={e => {
                    e.stopPropagation();
                    setConvs(prev => prev.filter(x => x.id !== c.id));
                    if (c.id === curId) setCurId('');
                  }} />
                </div>
              ))}
            </div>
          </div>

          <div className="cc-panel" style={{ flex: 1 }}>
            <div className="cc-panel-head"><ApiOutlined /> Endpoints ({catalog.reduce((n, g) => n + g.paths.length, 0)})</div>
            <div style={{ padding: '6px 8px 0' }}>
              <Input size="small" prefix={<SearchOutlined />} placeholder="Filter endpoints" allowClear
                value={epSearch} onChange={e => setEpSearch(e.target.value)} />
            </div>
            <div className="cc-panel-body">
              <EndpointsList groups={filteredCatalog} trained={trainedSet} onRun={stableClickEndpoint} onForm={stableOpenForm} />
              {!filteredCatalog.length && <Text type="secondary" style={{ fontSize: 12, padding: 8, display: 'block' }}>
                {catalog.length ? 'No matches' : 'Catalog loads after the first workspace start'}
              </Text>}
            </div>
          </div>

          <div className="cc-panel" style={{ flex: '0 0 auto', maxHeight: '34%' }}>
            <div className="cc-panel-head">
              <ThunderboltOutlined /> AI Training ({recipes.length})
              <span style={{ flex: 1 }} />
              <Tooltip title="Reload training recipes">
                <Button size="small" type="text" icon={<ReloadOutlined />}
                  onClick={() => loadRecipes().catch(e => setRecipeErr(String(e)))} />
              </Tooltip>
            </div>
            <div className="cc-panel-body">
              {!!recipeErr && (
                <Text type="danger" style={{ fontSize: 10.5, padding: '4px 6px', display: 'block', wordBreak: 'break-all' }}>
                  ⚠ {recipeErr}
                </Text>
              )}
              {recipes.map(r => (
                <button key={r.recipeId ?? r.recipeName} className="cc-recipe" onClick={() => pickRecipe(r)}>
                  <span className="cc-recipe-name">{r.recipeName}<span className="cc-ep-tick">✓</span></span>
                  <span className="cc-recipe-sub">{(r.method || 'GET').toUpperCase()} {r.urlTemplate}</span>
                  {!!(r.params || []).length && (
                    <span className="cc-recipe-params">{(r.params || []).map(p => p.name + (p.required ? '*' : '')).join(', ')}</span>
                  )}
                </button>
              ))}
              {!recipes.length && !recipeErr && (
                <Text type="secondary" style={{ fontSize: 12, padding: 8, display: 'block' }}>
                  No training recipes yet — teach one from any page's "Teach AI" button.
                </Text>
              )}
            </div>
          </div>
        </div>

        {/* ── Section 2: chat ── */}
        <div className="cc-main">
          <div className="cc-msgs" ref={listRef}>
            {!msgs.length && !busy && (
              <div style={{ textAlign: 'center', paddingTop: 40 }}>
                <div style={{ fontSize: 40 }}>⚡</div>
                <div style={{ fontWeight: 700, margin: '8px 0 2px', color: '#3A3632', fontSize: 16 }}>
                  Claude on your subscription — with live ERP data
                </div>
                <Text type="secondary" style={{ fontSize: 13 }}>
                  MCP tools + direct REST on every endpoint the app uses. Click an endpoint on the left,
                  or type <Text code>/</Text> to pick a training recipe.
                </Text>
                <div style={{ marginTop: 18 }}>
                  {suggestions.map(s => (
                    <button key={s} className="cc-sug" onClick={() => send(s)}>{s}</button>
                  ))}
                </div>
              </div>
            )}
            {msgs.map((m, i) => <MsgBubble key={i} m={m} />)}
            {busy && (
              <div className="cc-row bot">
                <div className="cc-bubble">
                  <span className="cc-typing"><span /><span /><span /></span>
                  {liveTool && <span className="cc-toolchip" style={{ marginLeft: 8 }}><ApiOutlined />{liveTool.replace(/^mcp__/, '')}</span>}
                </div>
              </div>
            )}
          </div>

          {paramTarget && (
            <div className="cc-params">
              <div className="cc-params-head">
                <ApiOutlined style={{ color: '#C74634' }} />
                <code style={{ fontSize: 12 }}>{paramTarget.title}</code>
                {paramTarget.trained && <Tag color="green" style={{ fontSize: 10, lineHeight: '16px', margin: 0 }}>Trained ✓</Tag>}
                <span style={{ flex: 1 }} />
                <Button size="small" type="text" icon={<CloseOutlined />} onClick={() => setParamTarget(null)} />
              </div>
              {paramTarget.params.map((p, i) => {
                const allNames = paramTarget.params.map(x => x.name);
                // date_from + date_to pairs collapse into one range picker
                const toPartner = isDateParam(p.name) && /from$/i.test(p.name)
                  ? (() => { const q = p.name.replace(/from$/i, 'to'); return allNames.includes(q) ? q : null; })()
                  : null;
                const isRangeTo = isDateParam(p.name) && /to$/i.test(p.name)
                  && allNames.includes(p.name.replace(/to$/i, 'from'));
                if (isRangeTo) return null; // rendered by its "from" partner
                const partnerParam = toPartner ? paramTarget.params.find(x => x.name === toPartner) : null;
                const lov = isBuParam(p.name) ? luBU : isLedgerParam(p.name) ? luLedger : isCompanyParam(p.name) ? luCompany : null;
                const required = p.required || partnerParam?.required || isForcedRequired(p.name);
                const placeholder = p.label || p.description
                  ? `${p.label || p.description}${p.example ? ` — e.g. ${p.example}` : ''}`
                  : p.example
                    ? `e.g. ${p.example}`
                    : `Value for {${p.name}} — leave blank to let Claude find it`;
                const setVal = (v: string) => setParamVals(prev => ({ ...prev, [p.name]: v }));
                if (toPartner) {
                  return (
                    <div key={p.name} className="cc-params-row">
                      <span className="cc-params-name">{p.name.replace(/_?from$/i, '') || 'date'} range{required ? ' *' : ''}</span>
                      <DatePicker.RangePicker
                        size="small"
                        style={{ flex: 1 }}
                        format="YYYY-MM-DD"
                        value={[
                          paramVals[p.name] ? dayjs(paramVals[p.name]) : null,
                          paramVals[toPartner] ? dayjs(paramVals[toPartner]) : null,
                        ]}
                        onChange={range => setParamVals(prev => ({
                          ...prev,
                          [p.name]: range?.[0] ? range[0].format('YYYY-MM-DD') : '',
                          [toPartner]: range?.[1] ? range[1].format('YYYY-MM-DD') : '',
                        }))}
                      />
                    </div>
                  );
                }
                return (
                  <div key={p.name} className="cc-params-row">
                    <span className="cc-params-name">{p.name}{required ? ' *' : ''}</span>
                    {lov && lov.length ? (
                      <Select
                        size="small"
                        style={{ flex: 1 }}
                        showSearch
                        allowClear
                        placeholder={placeholder}
                        value={paramVals[p.name] || undefined}
                        onChange={v => setVal(v || '')}
                        options={lov.map(x => ({ value: x, label: x }))}
                      />
                    ) : isDateParam(p.name) ? (
                      <DatePicker
                        size="small"
                        style={{ flex: 1 }}
                        format="YYYY-MM-DD"
                        placeholder={placeholder}
                        value={paramVals[p.name] ? dayjs(paramVals[p.name]) : null}
                        onChange={d => setVal(d ? d.format('YYYY-MM-DD') : '')}
                      />
                    ) : (
                      <Input
                        size="small"
                        autoFocus={i === 0}
                        placeholder={placeholder}
                        value={paramVals[p.name] || ''}
                        onChange={e => setVal(e.target.value)}
                        onPressEnter={() => (paramTarget.method === 'GET' ? runDirect() : runParamEp())}
                      />
                    )}
                  </div>
                );
              })}
              {!paramTarget.params.length && (
                <Text type="secondary" style={{ fontSize: 11.5, display: 'block', marginBottom: 6 }}>
                  This endpoint has no path parameters — add search filters below (e.g. date_from, date_to, status, row_limit).
                </Text>
              )}
              {extraRows.map((row, i) => (
                <div key={i} className="cc-params-row">
                  <Input
                    size="small"
                    style={{ width: 150, flexShrink: 0, fontFamily: 'Consolas, monospace' }}
                    placeholder="name, e.g. date_from"
                    value={row.k}
                    onChange={e => setExtraRows(prev => prev.map((r, j) => (j === i ? { ...r, k: e.target.value } : r)))}
                  />
                  <Input
                    size="small"
                    placeholder="value, e.g. 2026-06-01"
                    value={row.v}
                    onChange={e => setExtraRows(prev => prev.map((r, j) => (j === i ? { ...r, v: e.target.value } : r)))}
                    onPressEnter={runParamEp}
                  />
                  <Button size="small" type="text" icon={<MinusCircleOutlined />}
                    onClick={() => setExtraRows(prev => prev.filter((_, j) => j !== i))} />
                </div>
              ))}
              <div className="cc-params-row">
                <span className="cc-params-name">query</span>
                <Input
                  size="small"
                  placeholder="Optional query string, e.g. period=Jun-26&limit=50"
                  value={paramQuery}
                  onChange={e => setParamQuery(e.target.value)}
                  onPressEnter={runParamEp}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 6 }}>
                <Button size="small" type="dashed" icon={<PlusOutlined />}
                  onClick={() => setExtraRows(prev => [...prev, { k: '', v: '' }])}>
                  Add parameter
                </Button>
                <span style={{ flex: 1 }} />
                <Button size="small" onClick={() => setParamTarget(null)}>Cancel</Button>
                {paramTarget.method === 'GET' && (
                  <Tooltip title="Query the data directly — instant, no AI tokens; rows show in the Preview pane">
                    <Button size="small" type="primary" icon={<ThunderboltOutlined />} onClick={runDirect}
                      loading={directLoading} style={{ background: '#1D7B4D', borderColor: '#1D7B4D' }}>
                      Run direct
                    </Button>
                  </Tooltip>
                )}
                <Tooltip title="Send to Claude for analysis, summaries or Excel">
                  <Button size="small" type="primary" icon={<SendOutlined />} onClick={runParamEp} disabled={busy}
                    style={{ background: '#C74634', borderColor: '#C74634' }}>
                    Ask Claude
                  </Button>
                </Tooltip>
              </div>
            </div>
          )}

          <div style={{ position: 'relative' }}>
            {slashOpen && (
              <div className="cc-slash">
                <div className="cc-slash-head">
                  <b>/r</b> recipes only · <b>/e</b> endpoints only · keep typing to filter · ↑↓ choose · Enter select · Esc close
                </div>
                {slashItems.map((it, i) => (
                  <div
                    key={`${it.kind}:${it.label}`}
                    id={`cc-slash-${i}`}
                    className={`cc-slash-item${i === slashIdx ? ' on' : ''}`}
                    onMouseDown={e => { e.preventDefault(); pickSlash(it); }}
                    onMouseEnter={() => setSlashIdx(i)}
                  >
                    <span className={`cc-slash-kind ${it.kind}`}>{it.kind === 'recipe' ? 'RECIPE' : 'API'}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span className="cc-slash-label">{it.label}{it.trained && <span className="cc-ep-tick">✓</span>}</span>
                      {it.params && <span className="cc-slash-params">{it.params}</span>}
                    </span>
                    {it.sub && <span className="cc-slash-sub">{it.sub}</span>}
                  </div>
                ))}
                {!slashItems.length && (
                  <div className="cc-slash-empty">
                    {recipes.length || catalog.length ? 'No matching recipes or endpoints' : 'No training recipes loaded yet'}
                  </div>
                )}
              </div>
            )}
            <div className="cc-compose">
              <textarea
                rows={1}
                placeholder="Ask about your ERP data, or type / for trained actions and endpoints…"
                value={input}
                disabled={busy}
                onChange={e => {
                  setInput(e.target.value);
                  const ta = e.target; ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 130) + 'px';
                }}
                onKeyDown={e => {
                  if (slashOpen) {
                    if (e.key === 'ArrowDown') { e.preventDefault(); setSlashIdx(i => Math.min(i + 1, slashItems.length - 1)); return; }
                    if (e.key === 'ArrowUp') { e.preventDefault(); setSlashIdx(i => Math.max(i - 1, 0)); return; }
                    if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
                      e.preventDefault();
                      if (slashItems[slashIdx]) pickSlash(slashItems[slashIdx]);
                      return;
                    }
                    if (e.key === 'Escape') { e.preventDefault(); setInput(''); return; }
                  }
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
                }}
              />
              <Button type="primary" shape="circle" icon={<SendOutlined />} onClick={() => send()} loading={busy}
                style={{ background: '#C74634', borderColor: '#C74634', width: 42, height: 42 }} />
            </div>
          </div>
        </div>

        {/* ── Section 3: preview ── */}
        <div className={`cc-preview${previewFull ? ' full' : ''}`}>
          <div className="cc-panel" style={{ flex: 1 }}>
            <div className="cc-panel-head">
              <EyeOutlined /> Preview
              <span style={{ flex: 1 }} />
              <Tooltip title={filesOpen ? 'Hide generated files' : `Show generated files (${files.length})`}>
                <Button size="small" type={filesOpen ? 'primary' : 'text'} icon={<FolderOpenOutlined />}
                  onClick={() => setFilesOpen(o => !o)} />
              </Tooltip>
              <Tooltip title="Browse the local SQL database (erp-data.db)">
                <Button size="small" type={dbOpen ? 'primary' : 'text'} icon={<DatabaseOutlined />}
                  style={dbOpen ? { background: '#1D7B4D', borderColor: '#1D7B4D' } : undefined}
                  onClick={() => { setDbOpen(o => !o); if (!dbOpen) loadDbTables(); }} />
              </Tooltip>
              <Tooltip title={previewFull ? 'Exit full screen' : 'Expand to full screen'}>
                <Button size="small" type="text"
                  icon={previewFull ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
                  onClick={() => setPreviewFull(f => !f)} />
              </Tooltip>
              {previewFile && (
                <Tooltip title="Open in Excel / default app">
                  <Button size="small" type="text" icon={<ExportOutlined />} onClick={() => api.claudeChatOpenFile?.(previewFile.relPath)} />
                </Tooltip>
              )}
              <Tooltip title="Refresh files"><Button size="small" type="text" icon={<ReloadOutlined />} onClick={refreshFiles} /></Tooltip>
            </div>
            {prevHist.length > 0 && (
              <div className="cc-ptabs">
                {prevHist.map(e => (
                  <Tooltip key={e.id} title={`${e.title} · ${e.rows.length} rows · ${new Date(e.at).toLocaleTimeString()}`}>
                    <span className={`cc-ptab${e.id === prevId ? ' on' : ''}`} onClick={() => setPrevId(e.id)}>
                      <span className={`cc-ptab-dot ${e.kind}`} />
                      {e.title.replace(/^(SQL|AI):\s*/, '').slice(0, 26)}
                      <CloseOutlined className="cc-ptab-x" onClick={ev => {
                        ev.stopPropagation();
                        setPrevHist(prev => prev.filter(x => x.id !== e.id));
                        if (e.id === prevId) setPrevId('');
                      }} />
                    </span>
                  </Tooltip>
                ))}
              </div>
            )}
            {dbOpen && (
              <div style={{ maxHeight: 220, overflowY: 'auto', padding: 6, borderBottom: '1px solid #F3EFED', background: '#FBFAF9' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <Text strong style={{ fontSize: 12 }}><DatabaseOutlined /> erp-data.db — {dbTables.length} table{dbTables.length === 1 ? '' : 's'}</Text>
                  <span style={{ flex: 1 }} />
                  <Tooltip title="Refresh tables"><Button size="small" type="text" icon={<ReloadOutlined />} onClick={loadDbTables} /></Tooltip>
                </div>
                {!!dbErr && <Text type="danger" style={{ fontSize: 11, display: 'block', wordBreak: 'break-all', marginBottom: 4 }}>⚠ {dbErr}</Text>}
                {dbTables.map(t => (
                  <Tooltip key={t.name} title={`Click to view SELECT * FROM ${t.name} LIMIT 500`} placement="left" mouseEnterDelay={0.5}>
                    <button className="cc-recipe" onClick={() => runSql(`SELECT * FROM "${t.name}" LIMIT 500`, `SQL: ${t.name}`)}>
                      <span className="cc-recipe-name">{t.name}
                        <Text type="secondary" style={{ fontWeight: 400, fontSize: 11, marginLeft: 8 }}>{t.rows.toLocaleString()} rows</Text>
                      </span>
                      <span className="cc-recipe-params">{t.columns.join(', ')}</span>
                    </button>
                  </Tooltip>
                ))}
                {!dbTables.length && !dbErr && (
                  <Text type="secondary" style={{ fontSize: 12, display: 'block', padding: 4 }}>
                    No tables yet — run a direct search and press "→ SQL" on the result, or ask Claude to load a pull.
                  </Text>
                )}
                <Input.Search
                  size="small"
                  style={{ marginTop: 6 }}
                  placeholder={'Run SQL, e.g. SELECT COUNT(*) FROM …'}
                  enterButton="Run"
                  loading={dbBusy}
                  value={dbSql}
                  onChange={e => setDbSql(e.target.value)}
                  onSearch={s => runSql(s)}
                />
              </div>
            )}
            <div hidden={!filesOpen} style={{ maxHeight: 130, overflowY: 'auto', padding: 6, borderBottom: '1px solid #F3EFED' }}>
              {!files.length && <Text type="secondary" style={{ fontSize: 12, padding: 6, display: 'block' }}>Generated files appear here</Text>}
              {files.map(f => (
                <div key={f.relPath} className={`cc-file${previewFile?.relPath === f.relPath ? ' on' : ''}`} onClick={() => openPreview(f)}>
                  {/\.(xlsx|xls|csv)$/i.test(f.name) ? <FileExcelOutlined style={{ color: '#1D7B4D' }} /> : <FileTextOutlined />}
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                  <Text type="secondary" style={{ fontSize: 10 }}>{new Date(f.mtime).toLocaleTimeString()}</Text>
                </div>
              ))}
            </div>
            <div className="cc-panel-body">
              {directResult && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <Tag color={directResult.kind === 'direct' ? 'green' : directResult.kind === 'sql' ? 'geekblue' : 'purple'} style={{ margin: 0 }}>
                      {directResult.kind === 'direct' ? 'Direct' : directResult.kind === 'sql' ? 'SQL' : 'AI'}
                    </Tag>
                    <code style={{ fontSize: 11, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{directResult.title}</code>
                    <Text type="secondary" style={{ fontSize: 10.5, flexShrink: 0 }}>{new Date(directResult.at).toLocaleTimeString()}</Text>
                    <Button size="small" type="text" icon={<CloseOutlined />} onClick={() => setPrevId('')} />
                  </div>
                  {directResult.rows.length > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <Input
                        size="small"
                        allowClear
                        prefix={<SearchOutlined />}
                        placeholder="Search in all columns…"
                        value={directSearch}
                        onChange={e => setDirectSearch(e.target.value)}
                        style={{ maxWidth: 280 }}
                      />
                      <Text type="secondary" style={{ fontSize: 11, flex: 1 }}>
                        {directSearch ? `${directRows.length} of ${directResult.rows.length} rows` : `${directResult.rows.length} rows`}
                      </Text>
                      <Button size="small" icon={<FileExcelOutlined style={{ color: '#1D7B4D' }} />} onClick={exportDirectExcel}>Excel</Button>
                      <Button size="small" icon={<FileTextOutlined />} onClick={exportDirectPdf}>PDF</Button>
                      {directResult.kind !== 'sql' && (
                        <Tooltip title="Load these rows into the local SQL database (erp-data.db) for analysis and joins">
                          <Button size="small" icon={<DatabaseOutlined />} loading={dbBusy} onClick={openSqlLoad}>→ SQL</Button>
                        </Tooltip>
                      )}
                    </div>
                  )}
                  {directResult.rows.length > 0 ? (
                    <DirectGrid data={directData} columns={directColumns} />
                  ) : directResult.raw ? (
                    <pre style={{ fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>{directResult.raw.slice(0, 100000)}</pre>
                  ) : (
                    <Text type="secondary" style={{ fontSize: 12 }}>No rows returned.</Text>
                  )}
                </div>
              )}
              {!previewFile && !directResult && (
                <div style={{ textAlign: 'center', paddingTop: 60, color: '#8B8580' }}>
                  <FileExcelOutlined style={{ fontSize: 38, color: '#D9CDC9' }} />
                  <div style={{ fontSize: 13, marginTop: 8 }}>
                    Results appear here — run a search or ask Claude.
                    <br />The folder icon above shows generated files (Excel, exports).
                  </div>
                </div>
              )}
              {previewSheets && (
                <Tabs
                  size="small"
                  items={previewSheets.map((s, i) => ({
                    key: String(i),
                    label: s.name,
                    children: (
                      <div style={{ overflow: 'auto' }}>
                        <table className="cc-xl">
                          <tbody>
                            {s.rows.map((row, ri) => (
                              <tr key={ri}>
                                {row.map((v, ci) => (
                                  <td key={ci} style={typeof v === 'number' ? { textAlign: 'right' } : undefined}>
                                    {typeof v === 'number' ? v.toLocaleString() : v}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ),
                  }))}
                />
              )}
              {previewText !== null && (
                <pre style={{ fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>{previewText}</pre>
              )}
            </div>
          </div>
        </div>
      </div>

      <Modal
        title={<span><DatabaseOutlined /> Load into SQL database</span>}
        open={sqlLoadOpen}
        onCancel={() => setSqlLoadOpen(false)}
        onOk={doSqlLoad}
        okText={sqlLoadMode === 'append' ? 'Append rows' : 'Load (replace)'}
        okButtonProps={{ loading: dbBusy, disabled: !sqlLoadTable.trim() }}
        width={460}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 6 }}>
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>Table name</Text>
            <Input
              value={sqlLoadTable}
              onChange={e => setSqlLoadTable(e.target.value)}
              onPressEnter={doSqlLoad}
              placeholder="e.g. extl_june"
            />
            <Text type="secondary" style={{ fontSize: 11 }}>
              Change it (e.g. <Text code>extl_june</Text>) to keep several pulls side by side for comparison.
            </Text>
          </div>
          <Radio.Group value={sqlLoadMode} onChange={e => setSqlLoadMode(e.target.value)}>
            <Radio value="replace">
              Replace — table becomes exactly these {directResultRef.current?.rows.length ?? 0} rows (safe default)
            </Radio>
            <Radio value="append">
              Append — add to the existing table
            </Radio>
          </Radio.Group>
          {sqlLoadMode === 'append' && (
            <Alert type="warning" showIcon style={{ padding: '4px 10px' }}
              message={<span style={{ fontSize: 12 }}>
                Append only pulls that do not overlap (e.g. a different month) — overlapping rows are double-counted in every total.
              </span>} />
          )}
        </div>
      </Modal>
    </div>
  );
};

export default ClaudeChat;
