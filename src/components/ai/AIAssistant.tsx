import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Dropdown, Input, Select, Tooltip, Typography, message as antMessage } from 'antd';
import {
  ApiOutlined, CloseOutlined, CommentOutlined, DeleteOutlined, DownloadOutlined, HistoryOutlined,
  PlusOutlined, PlusSquareOutlined, SendOutlined, SettingOutlined, ThunderboltOutlined,
} from '@ant-design/icons';
import Anthropic from '@anthropic-ai/sdk';
import { APEX_DB_CONFIG } from '../../config/api.config';
import { getCurrentCompany } from '../../config/company.config';
import { useAuth } from '../../context/AuthContext';
import {
  ASSISTANT_TOOLS, buildSystemPrompt, runAssistantTool, type ApiCallLog, type DeliveredFile,
} from './assistantTools';

const { Text } = Typography;

const APEX = APEX_DB_CONFIG.baseUrl;
const LS_KEY = 'reerp.ai.key';
const LS_MODEL = 'reerp.ai.model';
const LS_CONVS = 'reerp.ai.convs';
const LS_CUR = 'reerp.ai.cur';
const DEFAULT_MODEL = 'claude-opus-5';
const MAX_TOOL_ROUNDS = 10;
const MAX_PANELS = 4;
const PANEL_W = 440;

const MODEL_OPTIONS = [
  { value: 'claude-opus-5', label: 'Claude Opus 5 (best)' },
  { value: 'claude-sonnet-5', label: 'Claude Sonnet 5 (fast + smart)' },
  { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 (fastest)' },
];

interface ChatMsg { role: 'user' | 'assistant'; text: string; files?: DeliveredFile[]; apiCalls?: ApiCallLog[] }
interface Conversation { id: string; title: string; msgs: ChatMsg[]; updatedAt: number }

const lsGet = (k: string): string => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

const loadConvs = (): Conversation[] => {
  try { return JSON.parse(localStorage.getItem(LS_CONVS) || '[]'); } catch { return []; }
};
const saveConvs = (convs: Conversation[]) =>
  lsSet(LS_CONVS, JSON.stringify(convs.slice(0, 20).map(c => ({
    ...c,
    // blob URLs die on reload — keep only names for history
    msgs: c.msgs.map(m => ({ ...m, files: (m.files || []).map(f => ({ name: f.name, url: '' })) })),
  }))));

const newConvId = () => `c${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

// ── Tiny markdown renderer (code, bold, lists, tables) ──────────────────────
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function mdToHtml(src: string): string {
  const codeBlocks: string[] = [];
  let t = src.replace(/```[a-z]*\n?([\s\S]*?)```/g, (_m, c) => {
    codeBlocks.push(`<pre class="ai-pre">${esc(c.replace(/\n$/, ''))}</pre>`);
    return ` ${codeBlocks.length - 1} `;
  });
  t = esc(t);
  // tables
  t = t.replace(/((?:^\|.*\|\s*$\n?)+)/gm, block => {
    const lines = block.trim().split('\n').filter(l => l.trim().startsWith('|'));
    if (lines.length < 2) return block;
    const cells = (l: string) => l.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
    const isSep = (l: string) => /^\s*\|?[\s:|-]+\|?\s*$/.test(l) && l.includes('-');
    let html = '<table class="ai-table">';
    lines.forEach((l, i) => {
      if (isSep(l)) return;
      const tag = i === 0 && lines[1] && isSep(lines[1]) ? 'th' : 'td';
      html += '<tr>' + cells(l).map(c => `<${tag}>${c}</${tag}>`).join('') + '</tr>';
    });
    return html + '</table>';
  });
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  t = t.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  t = t.replace(/^#{1,4}\s+(.*)$/gm, '<div class="ai-h">$1</div>');
  t = t.replace(/^\s*[-*]\s+(.*)$/gm, '<div class="ai-li">• $1</div>');
  t = t.replace(/^\s*(\d+)\.\s+(.*)$/gm, '<div class="ai-li">$1. $2</div>');
  t = t.replace(/\n{2,}/g, '<br/><br/>').replace(/\n/g, '<br/>');
  t = t.replace(/(<\/(?:table|div|pre)>)<br\/>/g, '$1');
  return t.replace(/ (\d+) /g, (_m, i) => codeBlocks[Number(i)]);
}

// ── API call inspector list ─────────────────────────────────────────────────
const ApiCallList: React.FC<{ calls: ApiCallLog[] }> = ({ calls }) => (
  <div className="ai-apilog">
    {calls.map((c, i) => (
      <div key={i} className="ai-apirow">
        <span className={`ai-apimethod ${c.method === 'GET' ? 'get' : 'local'}`}>{c.method}</span>
        <span className="ai-apiurl" title={c.url}>{c.url}</span>
        <span className={`ai-apistatus ${c.status === 200 || c.status === 'OK' ? 'ok' : 'err'}`}>
          {String(c.status)}{c.rows !== undefined ? ` · ${c.rows} rows` : ''} · {c.ms} ms
        </span>
        {c.error && <span className="ai-apierr">{c.error}</span>}
      </div>
    ))}
  </div>
);

// ── Shared store hooks (conversations shared across all open panels) ────────
interface ConvStore {
  convs: Conversation[];
  pushMsg: (convId: string, m: ChatMsg) => void;
  createConv: () => string;
  deleteConv: (id: string) => void;
}

// ── One chat window ─────────────────────────────────────────────────────────
interface PanelProps {
  index: number;
  total: number;
  store: ConvStore;
  initialConvId: string;
  apiKey: string;
  setApiKey: (k: string) => void;
  model: string;
  setModel: (m: string) => void;
  resolveKey: () => Promise<string>;
  userName: string;
  onClose: () => void;
  onNewWindow: () => void;
}

const AssistantPanel: React.FC<PanelProps> = ({
  index, total, store, initialConvId, apiKey, setApiKey, model, setModel,
  resolveKey, userName, onClose, onNewWindow,
}) => {
  const [curId, setCurId] = useState(initialConvId);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [draftKey, setDraftKey] = useState('');
  const [liveCalls, setLiveCalls] = useState<ApiCallLog[]>([]);
  const [apiOpen, setApiOpen] = useState<Record<number, boolean>>({});
  const msgsRef = useRef<HTMLDivElement>(null);

  const cur = store.convs.find(c => c.id === curId) ?? null;
  const msgs = useMemo(() => cur?.msgs ?? [], [cur]);

  useEffect(() => {
    if (msgsRef.current) msgsRef.current.scrollTop = msgsRef.current.scrollHeight;
  }, [msgs, busy]);

  const send = useCallback(async (textArg?: string) => {
    const text = (textArg ?? input).trim();
    if (!text || busy) return;
    const key = apiKey || await resolveKey();
    if (!key) { setShowSettings(true); antMessage.warning('Add your Anthropic API key first'); return; }

    let convId = curId;
    if (!store.convs.find(c => c.id === convId)) {
      convId = store.createConv();
      setCurId(convId);
    }
    if (index === 0) lsSet(LS_CUR, convId);

    setInput('');
    // keep an in-flight transcript so parallel panels never clobber each other
    const localHist: ChatMsg[] = [...(store.convs.find(c => c.id === convId)?.msgs ?? []), { role: 'user', text }];
    store.pushMsg(convId, { role: 'user', text });
    setBusy(true);
    setLiveCalls([]);

    const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
    const apiMsgs: Anthropic.MessageParam[] = localHist.map(m => ({ role: m.role, content: m.text || '…' }));
    const delivered: DeliveredFile[] = [];
    const calls: ApiCallLog[] = [];
    const onLog = (c: ApiCallLog) => { calls.push(c); setLiveCalls(calls.slice()); };
    const system = buildSystemPrompt(getCurrentCompany().code, userName);
    const finish = (m: ChatMsg) => store.pushMsg(convId, { ...m, apiCalls: calls.slice() });

    try {
      let rounds = 0;
      for (;;) {
        if (++rounds > MAX_TOOL_ROUNDS) {
          finish({ role: 'assistant', text: '⚠️ Stopped after too many tool calls — please narrow the request.' });
          break;
        }
        const resp = await client.messages.create({
          model,
          max_tokens: 8000,
          system,
          tools: ASSISTANT_TOOLS,
          messages: apiMsgs,
        });
        if (resp.stop_reason === 'tool_use') {
          apiMsgs.push({ role: 'assistant', content: resp.content });
          const results: Anthropic.ToolResultBlockParam[] = [];
          for (const blk of resp.content) {
            if (blk.type === 'tool_use') {
              setStatus(`Running ${blk.name.replace(/_/g, ' ')}…`);
              const out = await runAssistantTool(
                blk.name, blk.input as Record<string, unknown>, APEX, f => delivered.push(f), onLog,
              );
              results.push({ type: 'tool_result', tool_use_id: blk.id, content: out });
            }
          }
          apiMsgs.push({ role: 'user', content: results });
          continue;
        }
        if (resp.stop_reason === 'refusal') {
          finish({ role: 'assistant', text: '⚠️ The model declined this request.' });
          break;
        }
        const txt = resp.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map(b => b.text).join('\n').trim();
        finish({ role: 'assistant', text: txt || '(no text response)', files: delivered.slice() });
        break;
      }
    } catch (e) {
      const msg = e instanceof Anthropic.AuthenticationError
        ? 'Invalid Anthropic API key — check it in settings (⚙).'
        : e instanceof Anthropic.RateLimitError
          ? 'Rate limited by Anthropic — try again in a moment.'
          : e instanceof Error ? e.message : String(e);
      finish({ role: 'assistant', text: `⚠️ ${msg}` });
    } finally {
      setBusy(false);
      setStatus('');
      setLiveCalls([]);
    }
  }, [input, busy, apiKey, resolveKey, curId, store, model, userName, index]);

  const historyMenu = useMemo(() => ({
    items: store.convs.length
      ? store.convs.map(c => ({
          key: c.id,
          label: (
            <span style={{ display: 'inline-block', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
              {c.title || 'New chat'}
            </span>
          ),
        }))
      : [{ key: 'none', label: 'No previous chats', disabled: true }],
    onClick: ({ key }: { key: string }) => {
      if (key !== 'none') { setCurId(key); if (index === 0) lsSet(LS_CUR, key); }
    },
  }), [store.convs, index]);

  const suggestions = [
    'What is the AP invoice status summary?',
    'Show open GL periods',
    'Top 10 suppliers by outstanding balance — export to Excel',
    'Trial balance for Jun-26, download as Excel',
  ];

  // stack panels right → left
  const right = 24 + index * (PANEL_W + 16);

  return (
    <div className="ai-panel" style={{ right, zIndex: 1001 + (total - index) }}>
      <div className="ai-head">
        <ThunderboltOutlined style={{ fontSize: 18 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>
            Re-ERP AI Assistant{total > 1 ? ` · ${index + 1}` : ''}
          </div>
          <div style={{ fontSize: 11, opacity: .85, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {cur?.title && cur.title !== 'New chat' ? cur.title : 'Live data · all modules · Excel & Word exports'}
          </div>
        </div>
        <Tooltip title="Open another assistant window">
          <Button size="small" type="text" icon={<PlusSquareOutlined />} onClick={onNewWindow} disabled={total >= MAX_PANELS} />
        </Tooltip>
        <Dropdown menu={historyMenu} trigger={['click']} placement="bottomRight">
          <Tooltip title="Chat history"><Button size="small" type="text" icon={<HistoryOutlined />} /></Tooltip>
        </Dropdown>
        <Tooltip title="New chat">
          <Button size="small" type="text" icon={<PlusOutlined />} onClick={() => {
            const id = store.createConv();
            setCurId(id); if (index === 0) lsSet(LS_CUR, id);
          }} />
        </Tooltip>
        <Tooltip title="Settings">
          <Button size="small" type="text" icon={<SettingOutlined />} onClick={() => { setDraftKey(apiKey); setShowSettings(s => !s); }} />
        </Tooltip>
        <Tooltip title="Delete this chat">
          <Button size="small" type="text" icon={<DeleteOutlined />} onClick={() => {
            if (cur) store.deleteConv(cur.id);
            setCurId(''); if (index === 0) lsSet(LS_CUR, '');
          }} />
        </Tooltip>
        <Button size="small" type="text" icon={<CloseOutlined />} onClick={onClose} />
      </div>

      <div className="ai-msgs" ref={msgsRef}>
        {!msgs.length && !busy && (
          <div style={{ textAlign: 'center', paddingTop: 24 }}>
            <div style={{ fontSize: 36 }}>🤖</div>
            <div style={{ fontWeight: 700, margin: '6px 0 2px', color: '#3A3632' }}>Ask me anything about your ERP data</div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              I query the live webservices across GL, AP, AR, Cash, FA and Petty Cash — and can build formatted Excel or Word files.
            </Text>
            <div style={{ marginTop: 14, textAlign: 'left' }}>
              {suggestions.map(s => (
                <button key={s} className="ai-sug" onClick={() => send(s)}>{s}</button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`ai-row ${m.role === 'user' ? 'me' : 'bot'}`}>
            <div className="ai-bubble">
              {m.role === 'user'
                ? m.text.split('\n').map((l, j) => <div key={j}>{l}</div>)
                : <div dangerouslySetInnerHTML={{ __html: mdToHtml(m.text) }} />}
              {!!m.files?.length && (
                <div>
                  {m.files.map(f => f.url
                    ? <a key={f.name} className="ai-file" href={f.url} download={f.name}><DownloadOutlined /> {f.name}</a>
                    : <span key={f.name} className="ai-file"><DownloadOutlined /> {f.name}</span>)}
                </div>
              )}
              {!!m.apiCalls?.length && (
                <div>
                  <button
                    className={`ai-apibtn${apiOpen[i] ? ' open' : ''}`}
                    onClick={() => setApiOpen(p => ({ ...p, [i]: !p[i] }))}
                    title="Show the API calls behind this answer"
                  >
                    <ApiOutlined /> {m.apiCalls.length} API call{m.apiCalls.length > 1 ? 's' : ''}
                  </button>
                  {apiOpen[i] && <ApiCallList calls={m.apiCalls} />}
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && (
          <div className="ai-row bot">
            <div className="ai-bubble" style={{ minWidth: liveCalls.length ? '86%' : undefined }}>
              <div className="ai-typing"><span /><span /><span /></div>
              {!!liveCalls.length && <ApiCallList calls={liveCalls} />}
            </div>
          </div>
        )}
      </div>

      {status && <div className="ai-status"><ApiOutlined style={{ marginRight: 6 }} />{status}</div>}

      {showSettings && (
        <div className="ai-settings">
          <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13 }}>AI Settings</div>
          <Input.Password
            placeholder="Anthropic API key (sk-ant-…)"
            value={draftKey}
            onChange={e => setDraftKey(e.target.value)}
            size="small"
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <Select size="small" style={{ flex: 1 }} value={model} options={MODEL_OPTIONS}
              onChange={v => { setModel(v); lsSet(LS_MODEL, v); }} />
            <Button size="small" onClick={async () => {
              lsSet(LS_KEY, ''); setApiKey('');
              const k = await resolveKey();
              if (k) { setDraftKey(k); antMessage.success('Key loaded from saved settings'); }
              else antMessage.warning('No key found in app or server settings');
            }}>Fetch saved key</Button>
            <Button size="small" type="primary" onClick={() => {
              lsSet(LS_KEY, draftKey.trim()); setApiKey(draftKey.trim());
              setShowSettings(false); antMessage.success('AI settings saved');
            }}>Save</Button>
          </div>
          <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 6 }}>
            The key is stored only in this browser and sent directly to Anthropic. It is never saved on the ERP server by this chat.
          </Text>
        </div>
      )}

      <div className="ai-compose">
        <textarea
          rows={1}
          placeholder="Ask about journals, invoices, balances… or request an Excel report"
          value={input}
          onChange={e => {
            setInput(e.target.value);
            const ta = e.target; ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 110) + 'px';
          }}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
          }}
        />
        <Button type="primary" shape="circle" icon={<SendOutlined />} onClick={() => send()} loading={busy}
          style={{ background: '#C74634', borderColor: '#C74634' }} />
      </div>
    </div>
  );
};

// ── Root: FAB + panel manager + shared conversation store ───────────────────
const AIAssistant: React.FC = () => {
  const { user } = useAuth();
  const userName = (user as { name?: string; email?: string } | null)?.name
    ?? (user as { email?: string } | null)?.email?.split('@')[0] ?? 'user';

  const [apiKey, setApiKey] = useState(() => lsGet(LS_KEY));
  const [model, setModel] = useState(() => lsGet(LS_MODEL) || DEFAULT_MODEL);
  const [convs, setConvs] = useState<Conversation[]>(loadConvs);
  const [panels, setPanels] = useState<{ pid: number; convId: string }[]>([]);
  const nextPid = useRef(1);

  useEffect(() => { saveConvs(convs); }, [convs]);

  // functional updates so parallel panels never clobber each other
  const pushMsg = useCallback((convId: string, m: ChatMsg) => {
    setConvs(prev => {
      const next = prev.map(c => c.id === convId
        ? {
            ...c,
            msgs: [...c.msgs, m],
            updatedAt: Date.now(),
            title: c.title === 'New chat' && m.role === 'user' ? m.text.slice(0, 42) : c.title,
          }
        : c);
      return [...next].sort((a, b) => b.updatedAt - a.updatedAt);
    });
  }, []);

  const createConv = useCallback((): string => {
    const id = newConvId();
    setConvs(prev => [{ id, title: 'New chat', msgs: [], updatedAt: Date.now() }, ...prev]);
    return id;
  }, []);

  const deleteConv = useCallback((id: string) => {
    setConvs(prev => prev.filter(c => c.id !== id));
  }, []);

  const store: ConvStore = useMemo(
    () => ({ convs, pushMsg, createConv, deleteConv }),
    [convs, pushMsg, createConv, deleteConv],
  );

  const resolveKey = useCallback(async (): Promise<string> => {
    const local = lsGet(LS_KEY);
    if (local) return local;
    try {
      const eapi = (window as unknown as { electronAPI?: { glMcpGetCredentials?: () => Promise<{ claudeApiKey?: string } | null> } }).electronAPI;
      const creds = await eapi?.glMcpGetCredentials?.();
      if (creds?.claudeApiKey) { lsSet(LS_KEY, creds.claudeApiKey); setApiKey(creds.claudeApiKey); return creds.claudeApiKey; }
    } catch { /* ignore */ }
    try {
      const res = await fetch(`${APEX}/settings/claudekey`, { headers: { Accept: 'application/json' } });
      if (res.ok) {
        const d = await res.json();
        const k = d.apiKey || d.claudeKey || d.key;
        if (k) { lsSet(LS_KEY, k); setApiKey(k); return k; }
      }
    } catch { /* ignore */ }
    return '';
  }, []);

  const addPanel = useCallback((convId?: string) => {
    setPanels(prev => {
      if (prev.length >= MAX_PANELS) {
        antMessage.info(`Maximum ${MAX_PANELS} assistant windows`);
        return prev;
      }
      return [...prev, { pid: nextPid.current++, convId: convId ?? '' }];
    });
  }, []);

  const onFab = useCallback(() => {
    if (panels.length === 0) addPanel(lsGet(LS_CUR));
    else setPanels([]);
  }, [panels.length, addPanel]);

  return (
    <>
      <style>{`
        .ai-fab{position:fixed;right:24px;bottom:24px;z-index:1005;width:56px;height:56px;border-radius:50%;
          background:linear-gradient(135deg,#C74634,#8B2F22);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;
          box-shadow:0 6px 20px rgba(199,70,52,.45);transition:transform .15s ease, box-shadow .15s ease;color:#fff;font-size:24px}
        .ai-fab:hover{transform:scale(1.08);box-shadow:0 8px 26px rgba(199,70,52,.55)}
        .ai-fab-badge{position:absolute;top:-2px;right:-2px;background:#fff;color:#C74634;border:1px solid #C74634;
          border-radius:10px;font-size:11px;font-weight:700;min-width:18px;height:18px;line-height:16px;padding:0 3px}
        .ai-panel{position:fixed;bottom:92px;width:${PANEL_W}px;max-width:calc(100vw - 32px);
          height:min(640px,calc(100vh - 130px));background:#fff;border-radius:16px;display:flex;flex-direction:column;overflow:hidden;
          box-shadow:0 12px 48px rgba(0,0,0,.22);border:1px solid #E8E8E8;animation:aiIn .18s ease}
        @keyframes aiIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
        .ai-head{background:linear-gradient(135deg,#C74634,#9E3527);color:#fff;padding:12px 14px;display:flex;align-items:center;gap:6px}
        .ai-head .anticon{color:#fff}
        .ai-msgs{flex:1;overflow-y:auto;padding:14px;background:#FAF9F8}
        .ai-row{display:flex;margin-bottom:10px}
        .ai-row.me{justify-content:flex-end}
        .ai-bubble{max-width:86%;padding:9px 12px;border-radius:12px;font-size:13px;line-height:1.5;word-break:break-word}
        .ai-row.me .ai-bubble{background:#C74634;color:#fff;border-bottom-right-radius:4px}
        .ai-row.bot .ai-bubble{background:#fff;border:1px solid #EDE8E6;border-bottom-left-radius:4px;color:#3A3632}
        .ai-pre{background:#2b2b2b;color:#e8e8e8;padding:8px 10px;border-radius:8px;font-size:11.5px;overflow-x:auto;margin:6px 0}
        .ai-bubble code{background:#F3EDEB;color:#8B2F22;padding:1px 5px;border-radius:4px;font-size:12px}
        .ai-row.me .ai-bubble code{background:rgba(255,255,255,.2);color:#fff}
        .ai-table{border-collapse:collapse;margin:6px 0;font-size:12px;width:100%}
        .ai-table th{background:#C74634;color:#fff;padding:4px 8px;border:1px solid #d8a69d;text-align:left}
        .ai-table td{padding:4px 8px;border:1px solid #E8DEDB}
        .ai-table tr:nth-child(even) td{background:#FBF4F2}
        .ai-h{font-weight:700;margin:6px 0 2px}
        .ai-li{margin-left:6px}
        .ai-file{display:inline-flex;align-items:center;gap:6px;background:#F6EEEC;border:1px solid #E4D2CD;color:#8B2F22;
          border-radius:8px;padding:4px 10px;margin:6px 6px 0 0;font-size:12px;text-decoration:none}
        .ai-typing span{display:inline-block;width:7px;height:7px;margin-right:4px;border-radius:50%;background:#C74634;opacity:.4;animation:aiB 1.2s infinite}
        .ai-typing span:nth-child(2){animation-delay:.2s}.ai-typing span:nth-child(3){animation-delay:.4s}
        @keyframes aiB{0%,100%{opacity:.3;transform:translateY(0)}50%{opacity:1;transform:translateY(-3px)}}
        .ai-status{padding:4px 14px;font-size:11.5px;color:#9E3527;background:#FBF1EF;border-top:1px solid #F1E2DE;font-style:italic}
        .ai-compose{display:flex;gap:8px;padding:10px 12px;border-top:1px solid #EFEAE8;background:#fff;align-items:flex-end}
        .ai-compose textarea{flex:1;resize:none;border:1px solid #E0D5D2;border-radius:10px;padding:8px 10px;font-size:13px;
          font-family:inherit;outline:none;max-height:110px;line-height:1.4}
        .ai-compose textarea:focus{border-color:#C74634;box-shadow:0 0 0 2px rgba(199,70,52,.12)}
        .ai-sug{display:block;width:100%;text-align:left;background:#fff;border:1px solid #EBE2DF;border-radius:10px;
          padding:8px 12px;margin-top:8px;cursor:pointer;font-size:12.5px;color:#5b4a45}
        .ai-sug:hover{border-color:#C74634;color:#C74634}
        .ai-settings{padding:14px;border-top:1px solid #EFEAE8;background:#FCFAF9}
        .ai-apibtn{display:inline-flex;align-items:center;gap:5px;background:transparent;border:1px solid #E4D2CD;color:#9E3527;
          border-radius:8px;padding:2px 8px;margin-top:8px;font-size:11px;cursor:pointer}
        .ai-apibtn:hover,.ai-apibtn.open{background:#F6EEEC;border-color:#C74634}
        .ai-apilog{margin-top:6px;background:#2b2b2b;border-radius:8px;padding:6px 8px;max-height:180px;overflow-y:auto}
        .ai-apirow{font-family:Consolas,Menlo,monospace;font-size:10.5px;line-height:1.7;color:#d8d8d8;
          display:flex;flex-wrap:wrap;gap:6px;align-items:baseline;border-bottom:1px solid #3a3a3a;padding:2px 0}
        .ai-apirow:last-child{border-bottom:none}
        .ai-apimethod{font-weight:700;border-radius:4px;padding:0 5px;font-size:10px}
        .ai-apimethod.get{background:#1D7B4D;color:#fff}
        .ai-apimethod.local{background:#0572CE;color:#fff}
        .ai-apiurl{word-break:break-all;color:#f0e6e2;flex:1;min-width:120px}
        .ai-apistatus{white-space:nowrap}
        .ai-apistatus.ok{color:#6fdc9c}
        .ai-apistatus.err{color:#ff8a7a}
        .ai-apierr{color:#ff8a7a;width:100%;font-size:10px}
      `}</style>

      {panels.map((p, i) => (
        <AssistantPanel
          key={p.pid}
          index={i}
          total={panels.length}
          store={store}
          initialConvId={p.convId}
          apiKey={apiKey}
          setApiKey={setApiKey}
          model={model}
          setModel={setModel}
          resolveKey={resolveKey}
          userName={userName}
          onClose={() => setPanels(prev => prev.filter(x => x.pid !== p.pid))}
          onNewWindow={() => addPanel()}
        />
      ))}

      <button className="ai-fab" onClick={onFab}
        title={panels.length ? 'Close AI Assistant windows' : 'AI Assistant'}
        aria-label="Open AI Assistant">
        {panels.length ? <CloseOutlined /> : <CommentOutlined />}
        {panels.length > 1 && <span className="ai-fab-badge">{panels.length}</span>}
      </button>
    </>
  );
};

export default AIAssistant;
