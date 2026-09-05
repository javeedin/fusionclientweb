// ── Claude Code CLI manager ─────────────────────────────────────────────────
// Runs the `claude` CLI (subscription-billed) inside the app as an embedded
// terminal. A workspace is provisioned under userData/claude-cli with:
//   - mcp/           copies of the repo's MCP servers (gl, ar, arbal, inv, registry)
//   - .mcp.json      wiring those servers into the CLI with the saved Oracle creds
//   - CLAUDE.md      short ERP context so Claude knows what it is working with
// The CLI is spawned in a real PTY (node-pty prebuilt) so the interactive TUI,
// /login flow and colors all work; the renderer renders it with xterm.js.

const { app, safeStorage } = require('electron');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const pty = require('@homebridge/node-pty-prebuilt-multiarch');

const MCP_FILES = [
  'gl-mcp-server.cjs', 'ar-mcp-server.cjs', 'ar-customer-balance-server.cjs',
  'inv-onhand-server.cjs', 'mcp-registry-server.cjs',
  'mcp-call-logger.cjs', 'ords-token.cjs', // shared modules the servers require
];

let proc = null; // active pty process

function log(...args) { console.log('[Claude CLI]', ...args); }

function workspaceDir() {
  return path.join(app.getPath('userData'), 'claude-cli');
}

function sourceDir(file) {
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
  return isDev ? path.join(__dirname, file) : path.join(app.getAppPath(), 'electron', file);
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

function provisionWorkspace() {
  const ws = workspaceDir();
  const mcpDir = path.join(ws, 'mcp');
  fs.mkdirSync(mcpDir, { recursive: true });

  for (const f of MCP_FILES) {
    const src = sourceDir(f);
    if (fs.existsSync(src)) fs.writeFileSync(path.join(mcpDir, f), fs.readFileSync(src));
  }

  const creds = readGlCreds();
  const env = {
    ORACLE_BASE_URL: creds.oracleBaseUrl || 'https://g15d6279501ae08-buimerc.adb.me-dubai-1.oraclecloudapps.com',
    ORACLE_USERNAME: creds.username || '',
    ORACLE_PASSWORD: creds.password || '',
    SKIP_AUTH: creds.skipAuth === false ? 'false' : 'true',
  };
  const server = (script) => ({
    command: 'node',
    args: [path.join(mcpDir, script), '--stdio'],
    env,
  });
  const mcpJson = {
    mcpServers: {
      'oracle-gl':        server('gl-mcp-server.cjs'),
      'oracle-ar':        server('ar-mcp-server.cjs'),
      'oracle-ar-balances': server('ar-customer-balance-server.cjs'),
      'oracle-inventory': server('inv-onhand-server.cjs'),
      'oracle-registry':  server('mcp-registry-server.cjs'),
    },
  };
  fs.writeFileSync(path.join(ws, '.mcp.json'), JSON.stringify(mcpJson, null, 2), 'utf8');

  fs.writeFileSync(path.join(ws, 'CLAUDE.md'), `# Re-ERP Workspace

You are running inside Re-ERP, an Oracle Fusion companion ERP (company BUIMERC,
ledger currency AED, GL periods in Mon-YY format like Jun-26).

MCP servers (approve them when asked) give you LIVE ERP data:
- oracle-gl: GL account analysis, balances, trial balance health, journals, period status
- oracle-ar: receivables tools
- oracle-ar-balances: customer balance tools
- oracle-inventory: inventory on-hand
- oracle-registry: data-driven tools defined in the app's MCP Registry

Rules:
- Always fetch real data through the MCP tools before answering about balances,
  journals, invoices or transactions. Never invent figures.
- Amounts: thousand separators, 2 decimals. Accounting dates are the source of
  truth for a journal's period (Mon-YY of the GL date).
- Files you write are saved in this workspace folder.
`, 'utf8');

  return ws;
}

// ── Public API (wired to IPC in main.cjs) ───────────────────────────────────

function getStatus() {
  let installed = false;
  let version = '';
  try {
    version = execSync('claude --version', { shell: true, timeout: 15000 }).toString().trim();
    installed = true;
  } catch { /* not installed / not on PATH */ }
  return { installed, version, running: !!proc, workspace: workspaceDir() };
}

function start(sender, { cols = 120, rows = 30 } = {}) {
  if (proc) return { success: true, alreadyRunning: true };
  const ws = provisionWorkspace();
  const shellFile = process.platform === 'win32' ? 'claude.cmd' : 'claude';
  try {
    proc = pty.spawn(shellFile, [], {
      name: 'xterm-256color',
      cwd: ws,
      cols, rows,
      env: { ...process.env, TERM: 'xterm-256color' },
      useConpty: false, // winpty is more reliable across Windows versions
    });
  } catch (e) {
    // PATH fallback: run through the user's shell
    try {
      const sh = process.platform === 'win32' ? 'cmd.exe' : (process.env.SHELL || 'bash');
      const args = process.platform === 'win32' ? ['/c', 'claude'] : ['-lc', 'claude'];
      proc = pty.spawn(sh, args, {
        name: 'xterm-256color', cwd: ws, cols, rows,
        env: { ...process.env, TERM: 'xterm-256color' },
        useConpty: false,
      });
    } catch (e2) {
      proc = null;
      return { success: false, error: `Could not start claude: ${e2.message}` };
    }
  }

  proc.onData((data) => {
    try { sender.send('claude-cli:data', data); } catch { /* window closed */ }
  });
  proc.onExit(({ exitCode }) => {
    log(`claude exited (code ${exitCode})`);
    try { sender.send('claude-cli:exit', exitCode); } catch { /* window closed */ }
    proc = null;
  });

  log(`claude started in ${ws}`);
  return { success: true, workspace: ws };
}

function input(data) {
  if (proc) proc.write(data);
}

function resize(cols, rows) {
  try { if (proc && cols > 0 && rows > 0) proc.resize(cols, rows); } catch { /* ignore */ }
}

function stop() {
  if (!proc) return { success: true };
  try { proc.kill(); } catch { /* already dead */ }
  proc = null;
  return { success: true };
}

app.on('will-quit', () => { try { if (proc) proc.kill(); } catch { /* ignore */ } });

module.exports = { getStatus, start, input, resize, stop };
