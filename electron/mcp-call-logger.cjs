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

const PREVIEW_CHARS = 2000; // stored per call; full responses can be huge

function logToolCall(serverName, { tool, args, ok, ms, result, error }) {
  try {
    const dir = path.join(ARCHIVE_DIR, 'mcp-calls');
    fs.mkdirSync(dir, { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    const file = path.join(dir, `${day}_${serverName}.jsonl`);
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
    };
    fs.appendFileSync(file, JSON.stringify(entry) + '\n');
  } catch (e) {
    console.error(`[mcp-call-logger] failed: ${e.message}`);
  }
}

module.exports = { ARCHIVE_DIR, logToolCall };
