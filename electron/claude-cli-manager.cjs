// ── Claude Code CLI manager ─────────────────────────────────────────────────
// Runs the `claude` CLI (subscription-billed) inside the app as an embedded
// terminal. A workspace is provisioned under userData/claude-cli with:
//   - mcp/           copies of the repo's MCP servers (gl, ar, arbal, inv, registry)
//   - .mcp.json      wiring those servers into the CLI with the saved Oracle creds
//   - CLAUDE.md      short ERP context so Claude knows what it is working with
// The CLI is spawned in a real PTY (node-pty prebuilt) so the interactive TUI,
// /login flow and colors all work; the renderer renders it with xterm.js.

const { app, safeStorage } = require('electron');
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// node-pty is a native module — load it lazily and tolerate its absence so a
// missing/unbuilt module can never crash the whole app at startup.
let pty = null;
let ptyError = '';
function loadPty() {
  if (pty || ptyError) return pty;
  try {
    pty = require('@homebridge/node-pty-prebuilt-multiarch');
  } catch (e) {
    ptyError = e.message;
    console.error('[Claude CLI] terminal module unavailable:', ptyError);
  }
  return pty;
}

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
  const ptyReady = !!loadPty();
  return { installed, version, running: !!proc, workspace: workspaceDir(), ptyReady, ptyError };
}

function start(sender, { cols = 120, rows = 30 } = {}) {
  if (!loadPty()) {
    return {
      success: false,
      error: 'Embedded terminal module is not available on this machine — use "Open in system terminal" instead (same ERP MCP setup).',
    };
  }
  if (proc) return { success: true, alreadyRunning: true };
  const ws = provisionWorkspace();
  // strip API credentials so the CLI always uses the subscription login
  // (an inherited ANTHROPIC_API_KEY would silently switch it to API billing)
  const cleanEnv = { ...process.env, TERM: 'xterm-256color' };
  delete cleanEnv.ANTHROPIC_API_KEY;
  delete cleanEnv.ANTHROPIC_AUTH_TOKEN;
  const shellFile = process.platform === 'win32' ? 'claude.cmd' : 'claude';
  try {
    proc = pty.spawn(shellFile, [], {
      name: 'xterm-256color',
      cwd: ws,
      cols, rows,
      env: cleanEnv,
      useConpty: false, // winpty is more reliable across Windows versions
    });
  } catch (e) {
    // PATH fallback: run through the user's shell
    try {
      const sh = process.platform === 'win32' ? 'cmd.exe' : (process.env.SHELL || 'bash');
      const args = process.platform === 'win32' ? ['/c', 'claude'] : ['-lc', 'claude'];
      proc = pty.spawn(sh, args, {
        name: 'xterm-256color', cwd: ws, cols, rows,
        env: cleanEnv,
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

// Fallback with no native code: open the OS terminal in the provisioned
// workspace and run claude there — same .mcp.json / CLAUDE.md, so the ERP
// tools work identically. Used when node-pty is unavailable, or on demand.
function openExternal() {
  try {
    const ws = provisionWorkspace();
    if (process.platform === 'win32') {
      const launcher = path.join(ws, 'launch-claude.cmd');
      fs.writeFileSync(launcher, '@echo off\r\ncd /d "%~dp0"\r\nclaude\r\n', 'utf8');
      spawn('cmd.exe', ['/c', 'start', 'Claude Code - Re-ERP', 'cmd', '/k', launcher],
        { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'darwin') {
      const launcher = path.join(ws, 'launch-claude.command');
      fs.writeFileSync(launcher, `#!/bin/bash\ncd "$(dirname "$0")"\nclaude\n`, { mode: 0o755 });
      spawn('open', [launcher], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('x-terminal-emulator', ['-e', `bash -lc 'cd "${ws}" && claude'`],
        { detached: true, stdio: 'ignore' }).unref();
    }
    return { success: true, workspace: ws };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

app.on('will-quit', () => { try { if (proc) proc.kill(); } catch { /* ignore */ } });

module.exports = { getStatus, start, input, resize, stop, openExternal };
