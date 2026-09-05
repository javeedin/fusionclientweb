// ── Claude Chat manager (headless Claude Code) ──────────────────────────────
// Chat-bubble UI over the claude CLI: each user message spawns
//   claude -p --input-format stream-json --output-format stream-json --verbose
// in the provisioned ERP workspace (same .mcp.json + CLAUDE.md as the
// terminal page), resuming the same CLI session for conversation memory.
// The prompt goes in via stdin as JSON (never on the command line), stream
// events come back line by line and are forwarded to the renderer.
// Billing: the user's Claude subscription login — no API key involved.

const { spawn } = require('child_process');
const cli = require('./claude-cli-manager.cjs');

// Pre-approved tools for the non-interactive chat: the ERP MCP servers,
// file reads/writes INSIDE the workspace only, and exactly one shell
// command — the workspace's Excel builder script.
const ALLOWED_TOOLS = [
  'mcp__oracle-gl', 'mcp__oracle-ar', 'mcp__oracle-ar-balances',
  'mcp__oracle-inventory', 'mcp__oracle-registry',
  'Read(./**)', 'Write(./**)', 'Edit(./**)',
  'Bash(node tools/make-excel.cjs:*)',
  'Bash(node tools/call-api.cjs:*)',
  'Bash(node tools/load-db.cjs:*)',
  'Bash(node tools/query-db.cjs:*)',
].join(',');

let proc = null; // one in-flight turn at a time

function log(...args) { console.log('[Claude Chat]', ...args); }

function send(sender, { text, sessionId, ctx } = {}) {
  if (!text || !String(text).trim()) return { success: false, error: 'Empty message' };
  if (proc) return { success: false, error: 'A message is already being processed — cancel it first' };

  const ws = cli.provisionWorkspace(ctx);
  const env = cli.buildCleanEnv();
  const file = process.platform === 'win32' ? 'claude.cmd' : 'claude';
  const args = [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--allowedTools', ALLOWED_TOOLS,
    ...(sessionId ? ['--resume', String(sessionId)] : []),
  ];

  try {
    proc = spawn(file, args, {
      cwd: ws,
      env,
      shell: process.platform === 'win32', // .cmd needs a shell; argv is fixed, prompt goes via stdin
      windowsHide: true,
    });
  } catch (e) {
    proc = null;
    return { success: false, error: `Could not start claude: ${e.message}` };
  }

  const emit = (payload) => { try { sender.send('claude-chat:event', payload); } catch { /* window closed */ } };

  let buffer = '';
  proc.stdout.on('data', (chunk) => {
    buffer += String(chunk);
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      let evt;
      try { evt = JSON.parse(line); } catch { continue; }

      if (evt.type === 'system' && evt.subtype === 'init') {
        emit({ kind: 'init', sessionId: evt.session_id, model: evt.model });
      } else if (evt.type === 'assistant' && evt.message && Array.isArray(evt.message.content)) {
        for (const blk of evt.message.content) {
          if (blk.type === 'text' && blk.text) {
            emit({ kind: 'text', text: blk.text });
          } else if (blk.type === 'tool_use') {
            emit({ kind: 'tool', name: blk.name || 'tool', input: JSON.stringify(blk.input || {}).slice(0, 300) });
          }
        }
      } else if (evt.type === 'result') {
        emit({
          kind: 'result',
          sessionId: evt.session_id,
          isError: !!evt.is_error,
          resultText: typeof evt.result === 'string' ? evt.result : '',
          durationMs: evt.duration_ms,
          numTurns: evt.num_turns,
        });
      }
    }
  });

  let stderrTail = '';
  proc.stderr.on('data', (d) => {
    stderrTail = (stderrTail + String(d)).slice(-2000);
  });

  proc.on('error', (err) => {
    emit({ kind: 'error', error: err.message });
    proc = null;
  });
  proc.on('close', (code) => {
    if (code !== 0 && stderrTail) emit({ kind: 'error', error: stderrTail.trim().slice(-600) });
    emit({ kind: 'done', code });
    proc = null;
  });

  // the user's message goes in over stdin as JSON — never on the command line
  const userMsg = {
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text: String(text) }] },
  };
  try {
    proc.stdin.write(JSON.stringify(userMsg) + '\n');
    proc.stdin.end();
  } catch (e) {
    emit({ kind: 'error', error: `Could not send message: ${e.message}` });
    try { proc.kill(); } catch { /* ignore */ }
    proc = null;
    return { success: false, error: e.message };
  }

  log(`turn started${sessionId ? ` (resume ${sessionId})` : ''}`);
  return { success: true };
}

function cancel() {
  if (!proc) return { success: true };
  try { proc.kill(); } catch { /* already dead */ }
  proc = null;
  return { success: true };
}

const isBusy = () => !!proc;

module.exports = { send, cancel, isBusy };
