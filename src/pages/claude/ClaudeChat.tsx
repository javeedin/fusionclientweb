import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Card, Input, Tabs, Tag, Tooltip, Typography, message as antMessage } from 'antd';
import {
  ApiOutlined, CloseOutlined, CodeOutlined, DeleteOutlined, ExportOutlined, EyeOutlined, FileExcelOutlined,
  FileTextOutlined, FilterOutlined, FolderOpenOutlined, MinusCircleOutlined, PlusOutlined, ReloadOutlined,
  SearchOutlined, SendOutlined, StopOutlined, ThunderboltOutlined,
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

interface ChatMsg { role: 'user' | 'assistant'; text: string; tools?: string[] }
interface Conv { id: string; title: string; sessionId: string | null; msgs: ChatMsg[]; updatedAt: number }

interface ChatEvent {
  kind: 'init' | 'text' | 'tool' | 'result' | 'error' | 'done';
  sessionId?: string; model?: string; text?: string; name?: string; input?: string;
  isError?: boolean; resultText?: string; error?: string; code?: number;
}

interface WsFile { name: string; relPath: string; size: number; mtime: number }

interface ChatApi {
  claudeChatSend: (opts: { text: string; sessionId?: string | null; ctx?: Record<string, string> }) => Promise<{ success: boolean; error?: string }>;
  claudeChatCancel: () => Promise<{ success: boolean }>;
  claudeChatOpenWorkspace?: () => Promise<{ success: boolean }>;
  claudeChatCatalog?: () => Promise<{ success: boolean; markdown: string }>;
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
    return ` ${codeBlocks.length - 1} `;
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
  return t.replace(/ (\d+) /g, (_m, i) => codeBlocks[Number(i)]);
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
interface ParamTarget { title: string; method: string; path: string; params: RecipeParam[] }

// One row of the "/" popup — a training recipe or a catalog endpoint
interface SlashItem { kind: 'recipe' | 'endpoint'; label: string; sub?: string; recipe?: TrainingRecipe }

// ── xlsx preview data ───────────────────────────────────────────────────────
interface SheetPreview { name: string; rows: (string | number)[][] }

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
  const [slashIdx, setSlashIdx] = useState(0);
  const [files, setFiles] = useState<WsFile[]>([]);
  const [previewFile, setPreviewFile] = useState<WsFile | null>(null);
  const [previewSheets, setPreviewSheets] = useState<SheetPreview[] | null>(null);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const curIdRef = useRef(curId);
  useEffect(() => { curIdRef.current = curId; }, [curId]);

  const cur = useMemo(() => convs.find(c => c.id === curId) ?? null, [convs, curId]);
  const msgs = cur?.msgs ?? [];

  useEffect(() => { saveState(convs, curId); }, [convs, curId]);
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [msgs, busy, liveTool]);

  useEffect(() => {
    api?.claudeCliStatus?.().then(s => setCliOk(!!s?.installed)).catch(() => setCliOk(null));
    api?.claudeChatCatalog?.().then(r => { if (r?.success) setCatalog(parseCatalog(r.markdown)); }).catch(() => { /* ignore */ });
    fetchTrainingRecipes().then(setRecipes).catch(() => { /* ignore */ });
  }, [api]);

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
        setLiveTool(evt.name || 'tool');
        mutateConv(id, c => {
          const msgsN = [...c.msgs];
          const last = msgsN[msgsN.length - 1];
          if (last && last.role === 'assistant') {
            msgsN[msgsN.length - 1] = { ...last, tools: [...(last.tools || []), evt.name || 'tool'] };
          } else msgsN.push({ role: 'assistant', text: '', tools: [evt.name || 'tool'] });
          return { ...c, msgs: msgsN, updatedAt: Date.now() };
        });
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
  }, [api, mutateConv, refreshFiles]);

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
    const r = await api.claudeChatSend({ text, sessionId, ctx: buildCompanyCtx() });
    if (!r.success) {
      setBusy(false);
      antMessage.error(r.error || 'Could not send');
    }
  }, [input, busy, api, convs, mutateConv]);

  const newChat = () => { setCurId(''); setLastError(''); setParamTarget(null); };

  // A training recipe that targets this endpoint (its URL template's path
  // matches) — its declared params give the search panel real labeled fields.
  const recipeForEndpoint = (p: string, list: TrainingRecipe[]): TrainingRecipe | undefined => {
    const pathOf = (t: string) => {
      let s = String(t || '').trim();
      try { if (/^https?:/i.test(s)) s = new URL(s).pathname; } catch { /* keep as-is */ }
      return s.split('?')[0].replace(/\/+$/, '');
    };
    const target = pathOf(p);
    if (!target) return undefined;
    const matches = list.filter(r => {
      const rp = pathOf(r.urlTemplate);
      return rp === target || rp.endsWith(target);
    });
    return matches.find(r => (r.method || 'GET').toUpperCase() === 'GET') || matches[0];
  };

  // the search panel: works for ANY endpoint — a matching training recipe's
  // declared parameters when one exists, else placeholders (if any) plus
  // user-added query parameters. If no recipe matched, the list may simply
  // not have loaded yet (page opened offline, slow ORDS) — refetch and retry
  // once before falling back to the generic form.
  const openEndpointForm = async (p: string) => {
    let r = recipeForEndpoint(p, recipes);
    if (!r) {
      try {
        const fresh = await fetchTrainingRecipes(true);
        if (fresh.length) setRecipes(fresh);
        r = recipeForEndpoint(p, fresh);
      } catch { /* offline — generic form below */ }
    }
    if (r) { pickRecipe(r); return; }
    setParamTarget({ title: `GET ${p}`, method: 'GET', path: p, params: getEpParams(p).map(n => ({ name: n })) });
    setParamVals({});
    setParamQuery('');
    setExtraRows([]);
  };

  // endpoint click: parameterized paths open the fill-in form, plain ones go straight to the input
  const clickEndpoint = (p: string) => {
    if (getEpParams(p).length) {
      openEndpointForm(p);
    } else {
      setParamTarget(null);
      setInput(`Run GET ${p}`);
    }
  };

  // training recipe pick: always opens the search panel first (declared params
  // + any placeholders still in the URL template; extras can be added by hand),
  // so the user reviews/fills parameters before anything runs
  const pickRecipe = (r: TrainingRecipe) => {
    const method = (r.method || 'GET').toUpperCase();
    const params: RecipeParam[] = [...(r.params || [])];
    getEpParams(r.urlTemplate).forEach(n => { if (!params.some(p => p.name === n)) params.push({ name: n }); });
    setParamTarget({ title: `${r.recipeName} — ${method} ${r.urlTemplate}`, method, path: r.urlTemplate, params });
    setParamVals({});
    setParamQuery('');
    setExtraRows([]);
  };

  const runParamEp = () => {
    if (!paramTarget || busy) return;
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
    let text = `Run ${paramTarget.method} ${path}`;
    if (paramTarget.method !== 'GET') {
      if (extraPairs.length) text += ` with ${extraPairs.map(([k, v]) => `${k}=${v}`).join(', ')}`;
      text += ' — show me the full request and wait for my confirmation before executing';
    }
    if (missing.length) {
      text += ` — I left ${missing.map(n => `{${n}}`).join(', ')} blank; look up a sensible value first or ask me.`;
    }
    setParamTarget(null);
    send(text);
  };

  // ── "/" popup: training recipes + endpoints, like the CLI's slash menu ────
  const slashOpen = !busy && input.startsWith('/');
  const slashItems = useMemo<SlashItem[]>(() => {
    if (!slashOpen) return [];
    const q = input.slice(1).trim().toLowerCase();
    const match = (s?: string) => !q || (s || '').toLowerCase().includes(q);
    const items: SlashItem[] = [];
    recipes.forEach(r => {
      if (match(r.recipeName) || match(r.description) || match(r.urlTemplate)) {
        items.push({ kind: 'recipe', label: r.recipeName, sub: `${(r.method || 'GET').toUpperCase()} ${r.urlTemplate}`, recipe: r });
      }
    });
    let epCount = 0;
    for (const g of catalog) {
      for (const p of g.paths) {
        if (epCount >= 40) break;
        if (match(p)) { items.push({ kind: 'endpoint', label: p, sub: g.group }); epCount++; }
      }
    }
    return items;
  }, [slashOpen, input, recipes, catalog]);
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
        .cc-slash-label{font-weight:600;color:#3A3632;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
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
          border-radius:6px;padding:1px 8px;margin:2px 4px 2px 0;font-size:11px;font-family:Consolas,monospace}
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
          <div className="cc-panel" style={{ flex: '0 0 auto', maxHeight: '42%' }}>
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
              {filteredCatalog.map(g => (
                <div key={g.group}>
                  <div className="cc-epgroup">{g.group}</div>
                  {g.paths.map(p => {
                    const hasParams = getEpParams(p).length > 0;
                    return (
                      <div key={p} className="cc-ep-row">
                        <Tooltip placement="right" mouseEnterDelay={0.6}
                          title={hasParams ? `Has parameters — click to fill them in and run GET ${p}` : `Click to ask Claude to run GET ${p}`}>
                          <button className={`cc-ep${hasParams ? ' cc-ep-param' : ''}`} onClick={() => clickEndpoint(p)}>
                            {p}{hasParams && <span className="cc-ep-badge">⋯</span>}
                          </button>
                        </Tooltip>
                        <Tooltip title="Open the search panel to enter parameters" placement="right">
                          <button className="cc-ep-gear" onClick={() => openEndpointForm(p)}><FilterOutlined /></button>
                        </Tooltip>
                      </div>
                    );
                  })}
                </div>
              ))}
              {!filteredCatalog.length && <Text type="secondary" style={{ fontSize: 12, padding: 8, display: 'block' }}>
                {catalog.length ? 'No matches' : 'Catalog loads after the first workspace start'}
              </Text>}
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
            {msgs.map((m, i) => (
              <div key={i} className={`cc-row ${m.role === 'user' ? 'me' : 'bot'}`}>
                <div className="cc-bubble">
                  {!!m.tools?.length && (
                    <div style={{ marginBottom: m.text ? 6 : 0 }}>
                      {m.tools.map((t, j) => <span key={j} className="cc-toolchip"><ApiOutlined />{t.replace(/^mcp__/, '')}</span>)}
                    </div>
                  )}
                  {m.role === 'user'
                    ? m.text.split('\n').map((l, j) => <div key={j}>{l}</div>)
                    : m.text
                      ? <div dangerouslySetInnerHTML={{ __html: mdToHtml(m.text) }} />
                      : <Text type="secondary" style={{ fontSize: 12 }}>working…</Text>}
                </div>
              </div>
            ))}
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
                <span style={{ flex: 1 }} />
                <Button size="small" type="text" icon={<CloseOutlined />} onClick={() => setParamTarget(null)} />
              </div>
              {paramTarget.params.map((p, i) => (
                <div key={p.name} className="cc-params-row">
                  <span className="cc-params-name">{p.name}{p.required ? ' *' : ''}</span>
                  <Input
                    size="small"
                    autoFocus={i === 0}
                    placeholder={
                      p.label || p.description
                        ? `${p.label || p.description}${p.example ? ` — e.g. ${p.example}` : ''}`
                        : p.example
                          ? `e.g. ${p.example}`
                          : `Value for {${p.name}} — leave blank to let Claude find it`
                    }
                    value={paramVals[p.name] || ''}
                    onChange={e => setParamVals(prev => ({ ...prev, [p.name]: e.target.value }))}
                    onPressEnter={runParamEp}
                  />
                </div>
              ))}
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
                <Button size="small" type="primary" icon={<SendOutlined />} onClick={runParamEp} disabled={busy}
                  style={{ background: '#C74634', borderColor: '#C74634' }}>
                  Run
                </Button>
              </div>
            </div>
          )}

          <div style={{ position: 'relative' }}>
            {slashOpen && (
              <div className="cc-slash">
                <div className="cc-slash-head">
                  Training recipes &amp; endpoints — keep typing to filter, ↑↓ to choose, Enter to select, Esc to close
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
                    <span className="cc-slash-label">{it.label}</span>
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
        <div className="cc-preview">
          <div className="cc-panel" style={{ flex: 1 }}>
            <div className="cc-panel-head">
              <EyeOutlined /> Preview
              <span style={{ flex: 1 }} />
              {previewFile && (
                <Tooltip title="Open in Excel / default app">
                  <Button size="small" type="text" icon={<ExportOutlined />} onClick={() => api.claudeChatOpenFile?.(previewFile.relPath)} />
                </Tooltip>
              )}
              <Tooltip title="Refresh files"><Button size="small" type="text" icon={<ReloadOutlined />} onClick={refreshFiles} /></Tooltip>
            </div>
            <div style={{ maxHeight: 130, overflowY: 'auto', padding: 6, borderBottom: '1px solid #F3EFED' }}>
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
              {!previewFile && (
                <div style={{ textAlign: 'center', paddingTop: 60, color: '#8B8580' }}>
                  <FileExcelOutlined style={{ fontSize: 38, color: '#D9CDC9' }} />
                  <div style={{ fontSize: 13, marginTop: 8 }}>Click a generated file to preview it here.</div>
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
    </div>
  );
};

export default ClaudeChat;
