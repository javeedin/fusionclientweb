// ============================================================================
// Shared MCP call logger (Level 1 recording)
//
// Every tools/call across the independent MCP servers is appended as one JSON
// line to  <ARCHIVE_DIR>/mcp-calls/YYYY-MM-DD_<server>.jsonl  so there is a
// permanent, searchable record of what Claude asked for and what came back.
//
// ARCHIVE_DIR env var overrides the default (C:\ClaudeArchive on Windows,
// ~/ClaudeArchive elsewhere). Logging failures never break the tool call.
// ============================================================================
const fs = require('fs');
const path = require('path');
const os = require('os');

const ARCHIVE_DIR = process.env.ARCHIVE_DIR ||
  (process.platform === 'win32' ? 'C:\\ClaudeArchive' : path.join(os.homedir(), 'ClaudeArchive'));

// Oracle destination for RR_MCP_CALL_LOG rows (POST /settings/mcplog).
// Domain-only; falls back to the standard APEX instance.
const ORACLE_DOMAIN = (() => {
  const raw = process.env.ORACLE_BASE_URL || 'https://g15d6279501ae08-buimerc.adb.me-dubai-1.oraclecloudapps.com';
  try { const u = new URL(raw); return `${u.protocol}//${u.host}`; }
  catch (e) { return raw; }
})();
const DB_LOG_URL = `${ORACLE_DOMAIN}/ords/bcldifc/reerp/settings/mcplog`;
const DB_LOG_DISABLED = process.env.MCP_DB_LOG === 'off';

const PREVIEW_CHARS = 2000; // stored per call; full responses can be huge

// Caller identity: the servers run on the caller's machine, so hostname,
// OS user, platform, and local IP identify who/where every call came from.
const CALLER = (() => {
  let ip = '';
  try {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const n of nets[name] || []) {
        if (n.family === 'IPv4' && !n.internal) { ip = n.address; break; }
      }
      if (ip) break;
    }
  } catch (e) { /* ignore */ }
  let user = '';
  try { user = os.userInfo().username; } catch (e) { user = process.env.USERNAME || process.env.USER || ''; }
  return { host: os.hostname(), osUser: user, ip, platform: `${process.platform} ${os.release()}` };
})();

function logToolCall(serverName, { tool, args, ok, ms, result, error }) {
  const resultStr = result === undefined ? '' : (typeof result === 'string' ? result : JSON.stringify(result));
  const entry = {
    ts: new Date().toISOString(),
    server: serverName,
    tool,
    args: args || {},
    ok: !!ok,
    ms,
    resultBytes: resultStr.length,
    resultPreview: resultStr.substring(0, PREVIEW_CHARS),
    error: error || undefined,
    host: CALLER.host,
    osUser: CALLER.osUser,
    ip: CALLER.ip,
    platform: CALLER.platform,
  };

  // 1. Local JSONL file (works offline)
  try {
    const dir = path.join(ARCHIVE_DIR, 'mcp-calls');
    fs.mkdirSync(dir, { recursive: true });
    const day = entry.ts.slice(0, 10);
    fs.appendFileSync(path.join(dir, `${day}_${serverName}.jsonl`), JSON.stringify(entry) + '\n');
  } catch (e) {
    console.error(`[mcp-call-logger] file log failed: ${e.message}`);
  }

  // 2. Oracle RR_MCP_CALL_LOG (fire-and-forget — never blocks or fails the call)
  if (!DB_LOG_DISABLED) {
    require('./ords-token.cjs').getOrdsAuthHeader().then((authHeader) => fetch(DB_LOG_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader },
      body: JSON.stringify({
        server: serverName,
        tool,
        args: JSON.stringify(args || {}),
        ok: entry.ok ? 'Y' : 'N',
        ms,
        resultPreview: entry.resultPreview,
        error: error || null,
        host: CALLER.host,
        osUser: CALLER.osUser,
        ip: CALLER.ip,
        platform: CALLER.platform,
      }),
    })).catch((e) => console.error(`[mcp-call-logger] db log failed: ${e.message}`));
  }
}

module.exports = { ARCHIVE_DIR, logToolCall };
