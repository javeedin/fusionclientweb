#!/usr/bin/env node
// ============================================================================
// Generic Registry-Driven MCP Server
//
// Tool definitions live in the Oracle table RR_MCP_TOOL_REGISTRY (managed via
// the Admin > MCP Registry screen). Each active row becomes an MCP tool:
//   toolName, description, paramsSchema (JSON), httpMethod, urlTemplate
//   ({param} placeholders), authType (NONE|BASIC_ORDS|BASIC_FUSION), and an
//   optional declarative resultFilter.
//
// Adding a tool = INSERT a row. No code change, no redeploy.
//
// Run modes:
//   node mcp-registry-server.cjs --stdio      (Claude Desktop)
//   MCP_HTTP_PORT=3002 node mcp-registry-server.cjs   (HTTP testing)
//
// Env:
//   ORACLE_BASE_URL   Oracle APEX domain hosting the registry (required)
//   ORACLE_USERNAME / ORACLE_PASSWORD   for authType BASIC_ORDS
//   FUSION_USERNAME / FUSION_PASSWORD   for authType BASIC_FUSION
// ============================================================================
const http = require('http');
const { getOrdsAuthHeader, isOrdsUrl } = require('./ords-token.cjs');

function log(level, message) {
  console.error(`[${new Date().toISOString()}] [MCP REGISTRY ${level}] ${message}`);
}

function extractDomain(urlStr) {
  try {
    const u = new URL(urlStr);
    return `${u.protocol}//${u.host}`;
  } catch (e) {
    const m = String(urlStr || '').match(/^https?:\/\/[^/]+/);
    return m ? m[0] : urlStr;
  }
}

const ORACLE_DOMAIN = extractDomain(process.env.ORACLE_BASE_URL || 'https://g15d6279501ae08-buimerc.adb.me-dubai-1.oraclecloudapps.com');
const REGISTRY_URL  = `${ORACLE_DOMAIN}/ords/bcldifc/reerp/settings/mcptools`;
const HTTP_PORT     = process.env.MCP_HTTP_PORT ? parseInt(process.env.MCP_HTTP_PORT, 10) : null;

log('INFO', `Registry source: ${REGISTRY_URL}`);

// ── Registry cache ─────────────────────────────────────────────────────────
let registryTools = [];          // parsed rows from RR_MCP_TOOL_REGISTRY
let registryLoadedAt = 0;
const REGISTRY_TTL = 60 * 1000;  // re-fetch at most once a minute

async function loadRegistry(force = false) {
  if (!force && registryTools.length && Date.now() - registryLoadedAt < REGISTRY_TTL) return registryTools;
  try {
    const res = await fetch(REGISTRY_URL, { headers: { Accept: 'application/json', ...(await getOrdsAuthHeader()) } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const rows = Array.isArray(data?.tools) ? data.tools : [];
    registryTools = rows.map((r) => ({
      toolName:     r.toolName,
      description:  r.description || '',
      paramsSchema: safeParse(r.paramsSchema, { properties: {}, required: [] }),
      httpMethod:   (r.httpMethod || 'GET').toUpperCase(),
      urlTemplate:  r.urlTemplate,
      authType:     (r.authType || 'NONE').toUpperCase(),
      resultFilter: safeParse(r.resultFilter, null),
    })).filter((t) => t.toolName && t.urlTemplate);
    registryLoadedAt = Date.now();
    log('INFO', `Registry loaded: ${registryTools.length} tool(s)`);
  } catch (e) {
    log('ERROR', `Failed to load registry: ${e.message}${registryTools.length ? ' — using cached tools' : ''}`);
  }
  return registryTools;
}

function safeParse(str, fallback) {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch (e) { return fallback; }
}

// ── Tool execution ─────────────────────────────────────────────────────────
function buildAuthHeader(authType) {
  let user = '', pass = '';
  if (authType === 'BASIC_ORDS') {
    user = process.env.ORACLE_USERNAME || ''; pass = process.env.ORACLE_PASSWORD || '';
  } else if (authType === 'BASIC_FUSION') {
    user = process.env.FUSION_USERNAME || ''; pass = process.env.FUSION_PASSWORD || '';
  } else {
    return null;
  }
  if (!user || !pass) {
    throw new Error(`${authType} credentials not configured (set ${authType === 'BASIC_FUSION' ? 'FUSION' : 'ORACLE'}_USERNAME / _PASSWORD)`);
  }
  return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
}

// Substitute {param} placeholders with URI-encoded argument values.
// Missing required params throw; missing optional params substitute ''.
function buildUrl(tool, args) {
  const required = tool.paramsSchema?.required || [];
  for (const p of required) {
    if (args?.[p] === undefined || args?.[p] === null || args?.[p] === '') {
      throw new Error(`Missing required parameter: ${p}`);
    }
  }
  return tool.urlTemplate.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, name) => {
    const v = args?.[name];
    return v === undefined || v === null ? '' : encodeURIComponent(String(v));
  });
}

// Declarative result filter:
//   { "path": "items[].transactionPaymentSchedules",
//     "where": { "field": "TotalBalanceAmount", "op": "!=", "value": 0 } }
// "path" walks the response; a segment ending in "[]" maps over that array.
// The "where" clause filters the final array. Ops: =, !=, >, <, >=, <=, LIKE.
function applyWhere(arr, where) {
  if (!where || !Array.isArray(arr)) return arr;
  const { field, op, value } = where;
  return arr.filter((row) => {
    const v = row?.[field];
    switch (op) {
      case '=':  return v == value;            // eslint-disable-line eqeqeq
      case '!=': return v != value;            // eslint-disable-line eqeqeq
      case '>':  return Number(v) >  Number(value);
      case '<':  return Number(v) <  Number(value);
      case '>=': return Number(v) >= Number(value);
      case '<=': return Number(v) <= Number(value);
      case 'LIKE': return String(v ?? '').toLowerCase().includes(String(value).toLowerCase());
      default:   return true;
    }
  });
}

function applyResultFilter(data, filter) {
  if (!filter || !filter.path) return data;
  const segments = String(filter.path).split('.');

  function walk(node, i) {
    if (node === undefined || node === null) return node;
    if (i >= segments.length) return node;
    const seg = segments[i];
    const isMap = seg.endsWith('[]');
    const key = isMap ? seg.slice(0, -2) : seg;
    const child = node[key];
    if (child === undefined) return node;

    if (i === segments.length - 1) {
      // Last segment: filter the array here
      if (isMap || Array.isArray(child)) {
        return { ...node, [key]: applyWhere(child, filter.where) };
      }
      return node;
    }
    if (isMap && Array.isArray(child)) {
      return { ...node, [key]: child.map((el) => walk(el, i + 1)) };
    }
    return { ...node, [key]: walk(child, i + 1) };
  }

  return walk(data, 0);
}

async function executeRegistryTool(tool, args) {
  const url = buildUrl(tool, args || {});
  const headers = { Accept: 'application/json' };
  const auth = buildAuthHeader(tool.authType);
  if (auth) headers.Authorization = auth;
  // ORDS OAuth2 token for registry tools hitting the protected schema
  // (no-op while ORDS_USE_TOKEN!=YES; never overrides an explicit authType).
  if (!headers.Authorization && isOrdsUrl(url)) {
    Object.assign(headers, await getOrdsAuthHeader());
  }

  let body;
  if (tool.httpMethod !== 'GET' && args?.body) {
    headers['Content-Type'] = 'application/json';
    body = typeof args.body === 'string' ? args.body : JSON.stringify(args.body);
  }

  log('INFO', `Tool ${tool.toolName}: ${tool.httpMethod} ${url.replace(/\/\/[^@]*@/, '//***@')}`);
  const res = await fetch(url, { method: tool.httpMethod, headers, body });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Upstream API ${res.status}: ${text.substring(0, 300)}`);
  }
  let data;
  try { data = JSON.parse(text); } catch (e) { return { raw: text.substring(0, 10000) }; }
  return applyResultFilter(data, tool.resultFilter);
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
          capabilities: { tools: { listChanged: true } },
          serverInfo: { name: 'MCP Registry Server', version: '1.0.0' },
        },
      };
    }
    if (method === 'notifications/initialized' || method.startsWith('notifications/')) return null;
    if (method === 'ping') return { jsonrpc, id, result: {} };
    if (method === 'resources/list') return { jsonrpc, id, result: { resources: [] } };
    if (method === 'prompts/list') return { jsonrpc, id, result: { prompts: [] } };

    if (method === 'tools/list') {
      const tools = await loadRegistry();
      return {
        jsonrpc, id,
        result: {
          tools: tools.map((t) => ({
            name: t.toolName,
            description: t.description,
            inputSchema: {
              type: 'object',
              properties: t.paramsSchema?.properties || {},
              required: t.paramsSchema?.required || [],
            },
          })),
        },
      };
    }

    if (method === 'tools/call') {
      const { name, arguments: toolArgs } = params || {};
      const tools = await loadRegistry();
      const tool = tools.find((t) => t.toolName === name);
      if (!tool) throw new Error(`Unknown tool: ${name} (registry has ${tools.length} tools)`);
      const result = await executeRegistryTool(tool, toolArgs);
      return {
        jsonrpc, id,
        result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] },
      };
    }

    if (isNotification) return null;
    return { jsonrpc, id, error: { code: -32601, message: `Method not found: ${method}` } };
  } catch (error) {
    log('ERROR', `MCP Error: ${error.message}`);
    if (isNotification) return null;
    return { jsonrpc, id, error: { code: -32603, message: error.message } };
  }
}

// ── stdio transport (Claude Desktop) ───────────────────────────────────────
function runStdioServer() {
  log('INFO', 'Starting MCP Registry Server in stdio mode');
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
    try {
      request = JSON.parse(trimmed);
    } catch (e) {
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

  // Warm the registry cache so the first tools/list is fast
  loadRegistry(true);
}

// ── HTTP transport (testing / future Render deployment) ────────────────────
function runHttpServer(port) {
  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', tools: registryTools.length, timestamp: new Date().toISOString() }));
      return;
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', async () => {
        try {
          const response = await handleMcpRequest(JSON.parse(body));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(response || {}));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: e.message } }));
        }
      });
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });
  server.listen(port, '127.0.0.1', () => {
    log('INFO', `HTTP server listening on http://127.0.0.1:${port} (MCP JSON-RPC on POST /)`);
  });
  loadRegistry(true);
}

// ── Main ───────────────────────────────────────────────────────────────────
if (process.argv.includes('--stdio') || process.env.MCP_STDIO === '1') {
  runStdioServer();
} else if (HTTP_PORT) {
  runHttpServer(HTTP_PORT);
} else {
  log('ERROR', 'No mode selected: pass --stdio or set MCP_HTTP_PORT');
  process.exit(1);
}

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
