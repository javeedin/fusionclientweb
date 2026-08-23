#!/usr/bin/env node
// ============================================================================
// Archive MCP Server — conversation & document archive (Level 2 recording)
//
// Lets Claude Desktop SAVE analysis text and generated documents to a fixed
// local archive, and READ them back later for reference:
//
//   saveConversationSummary(title, content)      -> <ARCHIVE>/conversations/*.md
//   saveDocument(filename, content, encoding)    -> <ARCHIVE>/documents/*
//   listArchive(folder?, search?)                -> file inventory
//   readArchiveFile(filename, folder)            -> file content back to Claude
//
// Usage in a chat: "Save this analysis to the archive" / "What did we archive
// about Tribeca last week?"
//
// Run:  node archive-server.cjs --stdio
// Env:  ARCHIVE_DIR (default C:\ClaudeArchive on Windows, ~/ClaudeArchive else)
// ============================================================================
const fs = require('fs');
const path = require('path');
const { ARCHIVE_DIR, logToolCall } = require('./mcp-call-logger.cjs');

function log(level, message) {
  console.error(`[${new Date().toISOString()}] [ARCHIVE ${level}] ${message}`);
}

log('INFO', `Archive directory: ${ARCHIVE_DIR}`);

const FOLDERS = { conversations: 'conversations', documents: 'documents' };

function ensureDir(sub) {
  const dir = path.join(ARCHIVE_DIR, sub);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Strip anything path-like or unsafe out of a filename
function safeName(name) {
  const cleaned = String(name || '').replace(/[\/\\:*?"<>|\x00-\x1f]/g, '_').replace(/\.\./g, '_').trim();
  if (!cleaned) throw new Error('Invalid or empty filename');
  return cleaned.substring(0, 180);
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

// ── Tools ──────────────────────────────────────────────────────────────────
async function saveConversationSummary({ title, content }) {
  if (!title) throw new Error('title is required');
  if (!content) throw new Error('content is required');
  const dir = ensureDir(FOLDERS.conversations);
  const slug = safeName(title).replace(/\s+/g, '-').toLowerCase();
  const filename = `${stamp()}_${slug}.md`;
  const filePath = path.join(dir, filename);
  const header = `# ${title}\n\n> Archived: ${new Date().toISOString()}\n\n`;
  fs.writeFileSync(filePath, header + content, 'utf8');
  return { saved: true, path: filePath, bytes: header.length + content.length };
}

async function saveDocument({ filename, content, encoding = 'utf8' }) {
  if (!filename) throw new Error('filename is required');
  if (content === undefined || content === null) throw new Error('content is required');
  if (!['utf8', 'base64'].includes(encoding)) throw new Error('encoding must be utf8 or base64');
  const dir = ensureDir(FOLDERS.documents);
  const name = safeName(filename);
  // Prefix a date, keep the extension meaningful
  const filePath = path.join(dir, `${stamp()}_${name}`);
  const buf = encoding === 'base64' ? Buffer.from(String(content), 'base64') : Buffer.from(String(content), 'utf8');
  fs.writeFileSync(filePath, buf);
  return { saved: true, path: filePath, bytes: buf.length };
}

async function listArchive({ folder, search } = {}) {
  const subs = folder && FOLDERS[folder] ? [FOLDERS[folder]] : Object.values(FOLDERS);
  const out = [];
  for (const sub of subs) {
    const dir = path.join(ARCHIVE_DIR, sub);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      const st = fs.statSync(path.join(dir, f));
      if (!st.isFile()) continue;
      if (search && !f.toLowerCase().includes(String(search).toLowerCase())) continue;
      out.push({ folder: sub, filename: f, bytes: st.size, modified: st.mtime.toISOString() });
    }
  }
  out.sort((a, b) => b.modified.localeCompare(a.modified));
  return { count: out.length, files: out.slice(0, 200) };
}

async function readArchiveFile({ filename, folder = 'conversations' }) {
  if (!filename) throw new Error('filename is required');
  const sub = FOLDERS[folder];
  if (!sub) throw new Error(`folder must be one of: ${Object.keys(FOLDERS).join(', ')}`);
  const filePath = path.join(ARCHIVE_DIR, sub, safeName(filename));
  if (!filePath.startsWith(path.join(ARCHIVE_DIR, sub))) throw new Error('Invalid path');
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filename}`);
  const st = fs.statSync(filePath);
  if (st.size > 2 * 1024 * 1024) throw new Error('File larger than 2MB — open it directly from the archive folder');
  const buf = fs.readFileSync(filePath);
  // Return text files as text, binary as base64
  const isText = /\.(md|txt|csv|json|html|xml|log|jsonl)$/i.test(filename);
  return isText
    ? { filename, folder: sub, encoding: 'utf8', content: buf.toString('utf8') }
    : { filename, folder: sub, encoding: 'base64', content: buf.toString('base64') };
}

const MCP_TOOLS = [
  {
    name: 'saveConversationSummary',
    description: 'Save an analysis, conversation summary, or findings as a markdown file in the permanent local archive (conversations folder). Use when the user asks to archive/save the discussion or its conclusions for future reference.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short title, used in the filename, e.g. "Tribeca open balance analysis"' },
        content: { type: 'string', description: 'Full markdown content to save — include the key data, tables, and conclusions' },
      },
      required: ['title', 'content'],
    },
  },
  {
    name: 'saveDocument',
    description: 'Save a document/file (CSV, JSON, text, or base64-encoded binary) into the permanent local archive (documents folder). Use when the user wants a generated table, export, or file kept for future reference.',
    inputSchema: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'Filename with extension, e.g. tribeca-open-installments.csv' },
        content: { type: 'string', description: 'File content (text, or base64 when encoding=base64)' },
        encoding: { type: 'string', enum: ['utf8', 'base64'], description: 'utf8 (default) for text, base64 for binary' },
      },
      required: ['filename', 'content'],
    },
  },
  {
    name: 'listArchive',
    description: 'List files in the local archive (conversations and documents), newest first. Optionally filter by folder or filename search term. Use to find previously archived analyses.',
    inputSchema: {
      type: 'object',
      properties: {
        folder: { type: 'string', enum: ['conversations', 'documents'], description: 'Limit to one folder (optional)' },
        search: { type: 'string', description: 'Filename substring filter (optional)' },
      },
      required: [],
    },
  },
  {
    name: 'readArchiveFile',
    description: 'Read a previously archived file back so its content can be referenced in the current conversation.',
    inputSchema: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'Exact filename from listArchive' },
        folder: { type: 'string', enum: ['conversations', 'documents'], description: 'Folder the file is in (default conversations)' },
      },
      required: ['filename'],
    },
  },
  {
    name: 'logAgentRun',
    description: 'Record the outcome of a scheduled/agent task run into the monitoring log (RR_MCP_CALL_LOG in Oracle). Call this at the END of every scheduled task run with the task name, status, and a short summary of what was found/done — this is how run history is monitored.',
    inputSchema: {
      type: 'object',
      properties: {
        task_name: { type: 'string', description: 'Stable task identifier, e.g. "morning-balance-check"' },
        status: { type: 'string', enum: ['success', 'failed'], description: 'Run outcome (default success)' },
        summary: { type: 'string', description: 'Short summary of the run output / findings, or the error if failed' },
      },
      required: ['task_name'],
    },
  },
];

// Self-reporting for scheduled/agent runs: writes a row with server name
// "agent-run" into the call log (file + RR_MCP_CALL_LOG in Oracle), so
// monitoring can answer "did the morning task run today, and did it succeed?"
async function logAgentRun({ task_name, status, summary }) {
  if (!task_name) throw new Error('task_name is required');
  const ok = String(status || 'success').toLowerCase() === 'success';
  logToolCall('agent-run', {
    tool: task_name,
    args: { status: status || 'success' },
    ok,
    ms: null,
    result: summary || '',
    error: ok ? undefined : (summary || 'failed'),
  });
  return { logged: true, task: task_name, status: ok ? 'success' : 'failed' };
}

async function executeTool(name, args) {
  switch (name) {
    case 'saveConversationSummary': return await saveConversationSummary(args || {});
    case 'saveDocument':            return await saveDocument(args || {});
    case 'listArchive':             return await listArchive(args || {});
    case 'readArchiveFile':         return await readArchiveFile(args || {});
    case 'logAgentRun':             return await logAgentRun(args || {});
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

// ── MCP JSON-RPC dispatch ──────────────────────────────────────────────────
async function handleMcpRequest(request) {
  const { jsonrpc = '2.0', method, params, id } = request;
  const isNotification = (id === undefined || id === null);
  try {
    log('INFO', `MCP Request: ${method}`);
    if (method === 'initialize') {
      return {
        jsonrpc, id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'Archive MCP Server', version: '1.0.0' },
        },
      };
    }
    if (method === 'notifications/initialized' || method.startsWith('notifications/')) return null;
    if (method === 'ping') return { jsonrpc, id, result: {} };
    if (method === 'resources/list') return { jsonrpc, id, result: { resources: [] } };
    if (method === 'prompts/list') return { jsonrpc, id, result: { prompts: [] } };
    if (method === 'tools/list') return { jsonrpc, id, result: { tools: MCP_TOOLS } };
    if (method === 'tools/call') {
      const { name, arguments: toolArgs } = params || {};
      const t0 = Date.now();
      try {
        const result = await executeTool(name, toolArgs);
        logToolCall('archive-server', { tool: name, args: toolArgs && { ...toolArgs, content: toolArgs.content ? `<${String(toolArgs.content).length} chars>` : undefined }, ok: true, ms: Date.now() - t0, result });
        return { jsonrpc, id, result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] } };
      } catch (e) {
        logToolCall('archive-server', { tool: name, args: toolArgs, ok: false, ms: Date.now() - t0, error: e.message });
        throw e;
      }
    }
    if (isNotification) return null;
    return { jsonrpc, id, error: { code: -32601, message: `Method not found: ${method}` } };
  } catch (error) {
    log('ERROR', `MCP Error: ${error.message}`);
    if (isNotification) return null;
    return { jsonrpc, id, error: { code: -32603, message: error.message } };
  }
}

// ── stdio transport ────────────────────────────────────────────────────────
function runStdioServer() {
  log('INFO', 'Starting Archive MCP Server in stdio mode');
  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin, terminal: false });

  let pending = 0;
  let stdinClosed = false;
  const maybeExit = () => {
    if (stdinClosed && pending === 0) {
      log('INFO', 'stdin closed and no pending requests, shutting down');
      process.exit(0);
    }
  };

  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let request;
    try { request = JSON.parse(trimmed); }
    catch (e) {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n');
      return;
    }
    pending++;
    try {
      const response = await handleMcpRequest(request);
      if (response) process.stdout.write(JSON.stringify(response) + '\n');
    } finally {
      pending--;
      maybeExit();
    }
  });

  rl.on('close', () => { stdinClosed = true; maybeExit(); });
}

if (process.argv.includes('--stdio') || process.env.MCP_STDIO === '1') {
  runStdioServer();
} else {
  log('ERROR', 'Pass --stdio to run (this server is stdio-only)');
  process.exit(1);
}

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
