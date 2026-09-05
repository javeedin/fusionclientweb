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

// Claude Desktop's MCP config — when the user's Claude Desktop setup works,
// its env blocks hold PROVEN credentials/URLs for these same servers, so we
// reuse them as the primary source.
function readClaudeDesktopEnv() {
  try {
    const cfgPath = path.join(app.getPath('appData'), 'Claude', 'claude_desktop_config.json');
    if (!fs.existsSync(cfgPath)) return {};
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    const out = {};
    for (const s of Object.values(cfg.mcpServers || {})) {
      for (const [k, v] of Object.entries(s.env || {})) {
        if (out[k] === undefined && /^(FUSION_|ORACLE_|ORDS_|SKIP_AUTH|GL_)/.test(k) && v !== undefined && v !== '') {
          out[k] = String(v);
        }
      }
    }
    if (Object.keys(out).length) log('reusing env from Claude Desktop config:', Object.keys(out).join(', '));
    return out;
  } catch (e) {
    log('could not read Claude Desktop config:', e.message);
    return {};
  }
}

// Oracle Fusion credentials saved by the app's Fusion settings screen
// (same file save-fusion-credentials writes)
function readFusionCreds() {
  try {
    const file = path.join(app.getPath('userData'), 'fusion-creds.json');
    if (!fs.existsSync(file)) return {};
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    let password = '';
    if (data.password) {
      if (data.encrypted && safeStorage.isEncryptionAvailable()) {
        password = safeStorage.decryptString(Buffer.from(data.password, 'base64'));
      } else {
        password = Buffer.from(data.password, 'base64').toString();
      }
    }
    return { username: data.username || '', password };
  } catch (e) {
    log('could not read fusion credentials:', e.message);
    return {};
  }
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

const toOrigin = (u) => { try { return new URL(u).origin; } catch { return u || ''; } };

// ctx comes from the renderer (the page that starts Claude) and carries the
// LOGIN COMPANY's endpoints: { company, apexBaseUrl, fusionBaseUrl }
function provisionWorkspace(ctx = {}) {
  const ws = workspaceDir();
  const mcpDir = path.join(ws, 'mcp');
  fs.mkdirSync(mcpDir, { recursive: true });

  for (const f of MCP_FILES) {
    const src = sourceDir(f);
    if (fs.existsSync(src)) fs.writeFileSync(path.join(mcpDir, f), fs.readFileSync(src));
  }

  const creds = readGlCreds();
  const fusion = readFusionCreds();
  // Priority per variable: Claude Desktop's working config → the app's own
  // stored credentials → process env → defaults
  const desktop = readClaudeDesktopEnv();
  const env = {
    ...desktop,
    // ORDS (GL server) — the login company's APEX origin wins
    ORACLE_BASE_URL: toOrigin(ctx.apexBaseUrl) || creds.oracleBaseUrl || desktop.ORACLE_BASE_URL || 'https://g15d6279501ae08-buimerc.adb.me-dubai-1.oraclecloudapps.com',
    ORACLE_USERNAME: creds.username || desktop.ORACLE_USERNAME || '',
    ORACLE_PASSWORD: creds.password || desktop.ORACLE_PASSWORD || '',
    SKIP_AUTH: creds.skipAuth === false ? 'false' : (desktop.SKIP_AUTH || 'true'),
    // Oracle Fusion (AR / balances / inventory / registry servers) — the
    // login company's pod (incl. the instance picked in the app) wins
    FUSION_BASE_URL: toOrigin(ctx.fusionBaseUrl) || desktop.FUSION_BASE_URL || process.env.FUSION_BASE_URL || 'https://iaaobn-test.fa.ocs.oraclecloud.com',
    ...(desktop.FUSION_USERNAME
      ? {}
      : fusion.username ? { FUSION_USERNAME: fusion.username, FUSION_PASSWORD: fusion.password } : {}),
    // ORDS OAuth2 token passthrough (registry server)
    ...(desktop.ORDS_USE_TOKEN ? {} : process.env.ORDS_USE_TOKEN ? { ORDS_USE_TOKEN: process.env.ORDS_USE_TOKEN } : {}),
    ...(desktop.ORDS_CLIENT_ID ? {} : process.env.ORDS_CLIENT_ID ? { ORDS_CLIENT_ID: process.env.ORDS_CLIENT_ID } : {}),
    ...(desktop.ORDS_CLIENT_SECRET ? {} : process.env.ORDS_CLIENT_SECRET ? { ORDS_CLIENT_SECRET: process.env.ORDS_CLIENT_SECRET } : {}),
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

  // Excel builder for the headless chat: Claude writes a JSON spec and runs
  // this script (the only pre-approved shell command) to produce a styled
  // .xlsx — same look as the in-app assistant's reports. exceljs is loaded
  // from the app's own node_modules by absolute path.
  let excelJsPath = '';
  try { excelJsPath = path.dirname(require.resolve('exceljs/package.json')); } catch { /* not found */ }
  const toolsDir = path.join(ws, 'tools');
  fs.mkdirSync(toolsDir, { recursive: true });
  fs.mkdirSync(path.join(ws, 'output'), { recursive: true });
  fs.writeFileSync(path.join(toolsDir, 'make-excel.cjs'), `// generated by Re-ERP — builds a styled .xlsx from a JSON spec
// usage: node tools/make-excel.cjs <spec.json> <output.xlsx>
const fs = require('fs');
const path = require('path');
let ExcelJS;
try { ExcelJS = require(${JSON.stringify(excelJsPath)}); }
catch (e) { console.error('exceljs not found (' + e.message + ') — run "npm i exceljs" in this folder'); process.exit(1); }

const HEADER_BG = 'FFC74634', ZEBRA_BG = 'FFFBF1EF', TITLE_FG = 'FF3A3632';
const B = { style: 'thin', color: { argb: 'FFE0D5D2' } };
const BORDER = { top: B, left: B, bottom: B, right: B };

(async () => {
  const [specPath, outPath] = process.argv.slice(2);
  if (!specPath || !outPath) { console.error('usage: node tools/make-excel.cjs <spec.json> <output.xlsx>'); process.exit(1); }
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Re-ERP Claude Chat';

  for (const s of spec.sheets || []) {
    const ws = wb.addWorksheet(String(s.name || 'Sheet').slice(0, 31));
    const cols = s.columns || [];
    let r = 1;
    if (spec.title) {
      ws.mergeCells(1, 1, 1, Math.max(cols.length, 1));
      const tc = ws.getCell(1, 1);
      tc.value = spec.title;
      tc.font = { bold: true, size: 15, color: { argb: TITLE_FG } };
      ws.getRow(1).height = 28; r = 2;
      if (spec.subtitle) {
        ws.mergeCells(2, 1, 2, Math.max(cols.length, 1));
        const sc = ws.getCell(2, 1);
        sc.value = spec.subtitle;
        sc.font = { size: 10, italic: true, color: { argb: 'FF8B8580' } };
        r = 3;
      }
    }
    const hr = ws.getRow(r);
    cols.forEach((c, i) => {
      const cell = hr.getCell(i + 1);
      cell.value = c;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG } };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = BORDER;
    });
    hr.height = 22;
    (s.rows || []).forEach((row, ri) => {
      const xr = ws.getRow(r + 1 + ri);
      (row || []).forEach((v, ci) => {
        const cell = xr.getCell(ci + 1);
        cell.value = v === null || v === undefined ? '' : v;
        cell.border = BORDER;
        cell.alignment = { vertical: 'middle' };
        if (ri % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA_BG } };
        if (typeof v === 'number') {
          cell.alignment = { vertical: 'middle', horizontal: 'right' };
          if (!Number.isInteger(v) || Math.abs(v) >= 1000) cell.numFmt = '#,##0.00';
        }
      });
    });
    if (s.totalsRow && s.totalsRow.length) {
      const tr = ws.getRow(r + 1 + (s.rows || []).length);
      s.totalsRow.forEach((v, ci) => {
        const cell = tr.getCell(ci + 1);
        cell.value = v === null || v === undefined ? '' : v;
        cell.font = { bold: true };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3E6E3' } };
        cell.border = Object.assign({}, BORDER, { top: { style: 'double', color: { argb: 'FFC74634' } } });
        if (typeof v === 'number') { cell.alignment = { horizontal: 'right' }; cell.numFmt = '#,##0.00'; }
      });
    }
    cols.forEach((c, i) => {
      let mx = String(c == null ? '' : c).length;
      (s.rows || []).forEach(row => {
        const v = row && row[i];
        if (v !== null && v !== undefined) mx = Math.max(mx, typeof v === 'number' ? v.toLocaleString().length : String(v).length);
      });
      ws.getColumn(i + 1).width = Math.min(Math.max(mx + 3, 10), 52);
    });
    ws.views = [{ state: 'frozen', ySplit: r }];
    if ((s.rows || []).length) ws.autoFilter = { from: { row: r, column: 1 }, to: { row: r, column: Math.max(cols.length, 1) } };
  }

  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  await wb.xlsx.writeFile(outPath);
  console.log('Excel written: ' + path.resolve(outPath));
})().catch(e => { console.error(e.message); process.exit(1); });
`, 'utf8');

  fs.writeFileSync(path.join(ws, 'CLAUDE.md'), `# Re-ERP Workspace

You are running inside Re-ERP, an Oracle Fusion companion ERP (company
${ctx.company || 'BUIMERC'}, ledger currency AED, GL periods in Mon-YY format like Jun-26).

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

## Formatted Excel reports
When the user asks for an Excel report/export, produce a styled .xlsx like this
(the node command below is pre-approved; no other shell commands are):
1. Write a spec file, e.g. specs/report.json:
   {"title":"Report Title","subtitle":"period, filters, run date",
    "sheets":[{"name":"Data","columns":["Account","Amount"],
               "rows":[["1242100", 1234.56]],
               "totalsRow":["Total", 1234.56]}]}
   Numbers must be JSON numbers (not strings); totalsRow is optional.
2. Run: node tools/make-excel.cjs specs/report.json "output/Report Name.xlsx"
3. The script prints the absolute path — give it to the user and tell them the
   Open files folder button in the chat opens this folder.
`, 'utf8');

  return ws;
}

// Environment for any claude process: strip API credentials so the CLI always
// uses the subscription login (an inherited ANTHROPIC_API_KEY would silently
// switch it to API billing), and strip VS Code vars that make it misdetect an
// IDE when the app was launched from VS Code's terminal.
function buildCleanEnv() {
  const env = { ...process.env, TERM: 'xterm-256color' };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.TERM_PROGRAM;
  delete env.TERM_PROGRAM_VERSION;
  for (const k of Object.keys(env)) {
    if (k.startsWith('VSCODE_')) delete env[k];
  }
  return env;
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

function start(sender, { cols = 120, rows = 30, ctx } = {}) {
  if (!loadPty()) {
    return {
      success: false,
      error: 'Embedded terminal module is not available on this machine — use "Open in system terminal" instead (same ERP MCP setup).',
    };
  }
  if (proc) return { success: true, alreadyRunning: true };
  const ws = provisionWorkspace(ctx);
  const cleanEnv = buildCleanEnv();
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
function openExternal(ctx) {
  try {
    const ws = provisionWorkspace(ctx);
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

module.exports = { getStatus, start, input, resize, stop, openExternal, provisionWorkspace, buildCleanEnv };
