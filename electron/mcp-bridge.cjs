// ── MCP bridge for the in-app AI Assistant ──────────────────────────────────
// Runs the repo's MCP servers (electron/*.cjs) as stdio children and speaks
// newline-delimited MCP JSON-RPC to them (initialize → tools/list →
// tools/call), so the renderer's chatbot can use the same tools as Claude
// Desktop / LibreChat. Servers are started lazily on first use and share the
// saved GL API credentials.

const { app, safeStorage } = require('electron');
const { spawn } = require('child_process');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

const SERVERS = {
  gl:       { script: 'gl-mcp-server.cjs',              label: 'General Ledger' },
  ar:       { script: 'ar-mcp-server.cjs',              label: 'Receivables' },
  arbal:    { script: 'ar-customer-balance-server.cjs', label: 'AR Customer Balances' },
  inv:      { script: 'inv-onhand-server.cjs',          label: 'Inventory On-hand' },
  registry: { script: 'mcp-registry-server.cjs',        label: 'MCP Registry' },
};

const INIT_TIMEOUT_MS = 20000;
const CALL_TIMEOUT_MS = 120000;

const connections = {}; // name -> { proc, pending: Map, nextId, tools }

function log(...args) { console.log('[MCP Bridge]', ...args); }

function serverPath(script) {
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
  return isDev
    ? path.join(__dirname, script)
    : path.join(app.getAppPath(), 'electron', script);
}

// Same credential file the GL MCP settings screen writes
function readGlCreds() {
  try {
    const file = path.join(app.getPath('userData'), 'gl-api-creds.json');
    if (!fs.existsSync(file)) return {};
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const dec = (val, wasEncrypted) => {
      if (!val) return '';
      if (wasEncrypted && safeStorage.isEncryptionAvailable()) {
        return safeStorage.decryptString(Buffer.from(val, 'base64'));
      }
      return Buffer.from(val, 'base64').toString();
    };
    return {
      oracleBaseUrl: data.oracleBaseUrl || '',
      username: data.username || '',
      password: dec(data.password, data.encrypted),
      skipAuth: !!data.skipAuth,
    };
  } catch (e) {
    log('could not read credentials:', e.message);
    return {};
  }
}

function buildEnv() {
  const creds = readGlCreds();
  return {
    ...process.env,
    ORACLE_BASE_URL: creds.oracleBaseUrl || 'https://g15d6279501ae08-buimerc.adb.me-dubai-1.oraclecloudapps.com',
    ORACLE_USERNAME: creds.username || '',
    ORACLE_PASSWORD: creds.password || '',
    SKIP_AUTH: creds.skipAuth === false ? 'false' : 'true',
  };
}

function disconnect(name) {
  const conn = connections[name];
  if (!conn) return;
  delete connections[name];
  for (const [, p] of conn.pending) { clearTimeout(p.timer); p.reject(new Error('MCP server stopped')); }
  conn.pending.clear();
  try { conn.proc.kill(); } catch { /* already dead */ }
}

function request(conn, method, params, timeoutMs) {
  return new Promise((resolve, reject) => {
    const id = conn.nextId++;
    const timer = setTimeout(() => {
      conn.pending.delete(id);
      reject(new Error(`MCP ${method} timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);
    conn.pending.set(id, { resolve, reject, timer });
    conn.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}

async function connect(name) {
  const existing = connections[name];
  if (existing && existing.proc.exitCode === null) return existing;
  if (existing) disconnect(name);

  const def = SERVERS[name];
  if (!def) throw new Error(`Unknown MCP server: ${name}`);
  const file = serverPath(def.script);
  if (!fs.existsSync(file)) throw new Error(`${def.script} not found`);

  const proc = spawn('node', [file, '--stdio'], {
    cwd: path.dirname(file),
    stdio: ['pipe', 'pipe', 'pipe'],
    env: buildEnv(),
    windowsHide: true,
  });
  const conn = { proc, pending: new Map(), nextId: 1, tools: [] };
  connections[name] = conn;

  const rl = readline.createInterface({ input: proc.stdout, terminal: false });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch { return; } // servers may log non-JSON lines
    if (msg.id === undefined || msg.id === null) return;
    const p = conn.pending.get(msg.id);
    if (!p) return;
    conn.pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.error) p.reject(new Error(msg.error.message || 'MCP error'));
    else p.resolve(msg.result);
  });
  proc.stderr.on('data', (d) => log(`[${name}]`, String(d).trim().slice(0, 300)));
  proc.on('exit', (code) => {
    log(`${name} exited (code ${code})`);
    if (connections[name] === conn) disconnect(name);
  });
  proc.on('error', (err) => log(`${name} spawn error:`, err.message));

  await request(conn, 'initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'reerp-ai-assistant', version: '1.0.0' },
  }, INIT_TIMEOUT_MS);
  proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

  const res = await request(conn, 'tools/list', {}, INIT_TIMEOUT_MS);
  conn.tools = res?.tools || [];
  log(`${name}: connected, ${conn.tools.length} tools`);
  return conn;
}

// ── Public API (wired to IPC in main.cjs) ───────────────────────────────────

// Connect every available server (in parallel) and report their tools.
async function listTools() {
  const names = Object.keys(SERVERS).filter((n) => fs.existsSync(serverPath(SERVERS[n].script)));
  const servers = await Promise.all(names.map(async (name) => {
    try {
      const conn = await connect(name);
      return { name, label: SERVERS[name].label, tools: conn.tools };
    } catch (e) {
      return { name, label: SERVERS[name].label, tools: [], error: e.message };
    }
  }));
  return { servers };
}

async function callTool(server, tool, args) {
  const conn = await connect(server);
  const result = await request(conn, 'tools/call', { name: tool, arguments: args || {} }, CALL_TIMEOUT_MS);
  // MCP result: { content: [{type:'text', text:'...'}, ...], isError? }
  const text = (result?.content || [])
    .filter((c) => c && c.type === 'text')
    .map((c) => c.text)
    .join('\n');
  return { text, isError: !!result?.isError };
}

function stopAll() {
  for (const name of Object.keys(connections)) disconnect(name);
}

app.on('will-quit', stopAll);

module.exports = { listTools, callTool, stopAll };
