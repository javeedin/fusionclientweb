// GL MCP Server with MCP Protocol Support
// Supports both MCP JSON-RPC (for Claude Desktop) and custom HTTP API (for Electron app)
const https = require('https');
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');

// ── Logging utility ────────────────────────────────────────────────────────
function log(level, message) {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [GL MCP ${level}]`;
  console.error(`${prefix} ${message}`);
}

log('INFO', 'GL MCP Server initializing with MCP protocol support...');

// ── Configuration ──────────────────────────────────────────────────────────
function extractDomain(urlStr) {
  try {
    const urlObj = new URL(urlStr);
    return `${urlObj.protocol}//${urlObj.host}`;
  } catch (e) {
    const match = urlStr.match(/^https?:\/\/[^/]+/);
    return match ? match[0] : urlStr;
  }
}

const ORACLE_DOMAIN = extractDomain(process.env.ORACLE_BASE_URL || 'https://g15d6279501ae08-buimerc.adb.me-dubai-1.oraclecloudapps.com');
const APEX_ENDPOINT = `${ORACLE_DOMAIN}/ords/bcldifc/reerp`;
const HTTP_PORT = process.env.GL_MCP_HTTP_PORT ? parseInt(process.env.GL_MCP_HTTP_PORT, 10) : null;
const SKIP_AUTH = process.env.SKIP_AUTH === 'true' || process.env.SKIP_AUTH === '1';

log('INFO', `Config: ORACLE_DOMAIN=${ORACLE_DOMAIN}`);
log('INFO', `Config: APEX_ENDPOINT=${APEX_ENDPOINT}`);
log('INFO', `Config: SKIP_AUTH=${SKIP_AUTH}`);
if (HTTP_PORT) log('INFO', `Config: HTTP_PORT=${HTTP_PORT}`);

// Cache for API calls (TTL: 5 minutes)
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

function getCachedValue(key) {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() - item.timestamp > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  return item.value;
}

function setCachedValue(key, value) {
  cache.set(key, { value, timestamp: Date.now() });
}

// ── Fetch wrapper with basic auth ──────────────────────────────────────────
async function fetchAPI(endpoint, options = {}) {
  const username = process.env.ORACLE_USERNAME || '';
  const password = process.env.ORACLE_PASSWORD || '';

  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (!SKIP_AUTH && username && password) {
    const encoded = Buffer.from(`${username}:${password}`).toString('base64');
    headers['Authorization'] = `Basic ${encoded}`;
  } else if (!SKIP_AUTH && (!username || !password)) {
    log('WARN', 'No credentials provided but SKIP_AUTH is disabled');
  }

  const fullUrl = `${APEX_ENDPOINT}${endpoint}`;
  log('DEBUG', `API Call: ${options.method || 'GET'} ${endpoint}`);

  try {
    const response = await fetch(fullUrl, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (!response.ok) {
      const error = new Error(`Oracle API ${response.status}: ${response.statusText}`);
      log('ERROR', `API Failed: ${error.message}`);
      throw error;
    }

    const data = await response.json();
    log('DEBUG', `API Success: Got response with ${JSON.stringify(data).length} bytes`);
    return data;
  } catch (error) {
    log('ERROR', `API Error: ${error.message}`);
    throw error;
  }
}

// ── GL Tools ───────────────────────────────────────────────────────────────
async function getGLAccountAnalysis(params) {
  const { ledger_name, period_names, company, account } = params;
  const cacheKey = `gl_analysis_${ledger_name}_${period_names}_${company}_${account}`;
  const cached = getCachedValue(cacheKey);
  if (cached) return { ...cached, cached: true };

  const queryParams = new URLSearchParams({
    ledger_name: ledger_name || '',
    period_names: period_names || '',
    company: company || '',
    account: account || '',
  }).toString();

  const result = await fetchAPI(`/gl/accountanalysis?${queryParams}`, { method: 'GET' });
  setCachedValue(cacheKey, result);
  return { ...result, cached: false };
}

// GL journal lines, filtered by period. The ORDS handler filters on
// period_name/reference1/reference2/reference5/limit; account filtering is
// applied client-side on the returned rows.
async function getGLTransactions(params) {
  const { period_names, account, limit = 100 } = params;
  const period = String(period_names || '').split(',')[0].trim();

  const queryParams = new URLSearchParams();
  if (period) queryParams.set('period_name', period);
  queryParams.set('limit', String(Math.max(Number(limit) || 100, 100)));

  const result = await fetchAPI(`/gl/journals/lines?${queryParams.toString()}`, { method: 'GET' });
  let items = Array.isArray(result?.items) ? result.items : (Array.isArray(result) ? result : []);
  if (account) items = items.filter((r) => String(r.account || '').includes(String(account)));
  return { count: items.length, items: items.slice(0, Number(limit) || 100) };
}

// Shared fetch of the standard trial balance — one row per account for a
// ledger + period, with account_combination, account_desc, opening, debit,
// credit, closing. Same endpoint the Trial Balance screen uses.
async function fetchTrialBalance(ledger_name, period, company) {
  const queryParams = new URLSearchParams({
    ledger_name: ledger_name || 'BUIMERC LEDGER',
    period_name: period,
  });
  if (company) queryParams.set('company', company);
  const result = await fetchAPI(`/gl/rr-trialbalance/standard?${queryParams.toString()}`, { method: 'GET' });
  return Array.isArray(result?.items) ? result.items : (Array.isArray(result) ? result : []);
}

// GL balances for a period from the standard trial balance. account is an
// optional filter — omit it to list balances for ALL accounts in the period.
async function getAccountBalance(params) {
  const { ledger_name, period_names, company, account } = params;
  const period = String(period_names || '').split(',')[0].trim();
  const cacheKey = `gl_balance_${ledger_name}_${period}_${company}_${account}`;
  const cached = getCachedValue(cacheKey);
  if (cached) return { ...cached, cached: true };

  let items = await fetchTrialBalance(ledger_name, period, company);
  if (account) {
    items = items.filter((r) => String(r.account_combination || '').includes(String(account)));
  }
  const out = { count: items.length, items };
  setCachedValue(cacheKey, out);
  return { ...out, cached: false };
}

// Search the chart of accounts by number or description, from the distinct
// accounts in the period's trial balance.
async function searchAccounts(params) {
  const { ledger_name, period_names, search_term } = params;
  const period = String(period_names || '').split(',')[0].trim();
  const items = await fetchTrialBalance(ledger_name, period);

  const seen = new Map();
  for (const r of items) {
    const combo = r.account_combination;
    if (combo && !seen.has(combo)) {
      seen.set(combo, { account: combo, description: r.account_desc || '' });
    }
  }
  let accounts = Array.from(seen.values());
  if (search_term) {
    const term = String(search_term).toLowerCase();
    accounts = accounts.filter((a) =>
      a.account.toLowerCase().includes(term) || a.description.toLowerCase().includes(term));
  }
  accounts.sort((a, b) => a.account.localeCompare(b.account));
  return { count: accounts.length, accounts: accounts.slice(0, 300) };
}

async function getJournalEntry(params) {
  const { je_header_id } = params;
  return await fetchAPI(`/gl/journals/${je_header_id}/lines`, { method: 'GET' });
}

// ── MCP Tool Definitions ──────────────────────────────────────────────────
const MCP_TOOLS = [
  {
    name: 'getGLAccountAnalysis',
    description: 'Get GL account analysis data for a specific account, period, and ledger',
    inputSchema: {
      type: 'object',
      properties: {
        ledger_name: { type: 'string', description: 'General Ledger name' },
        period_names: { type: 'string', description: 'Period name (e.g., Jan-26)' },
        company: { type: 'string', description: 'Company code' },
        account: { type: 'string', description: 'GL Account number' }
      },
      required: ['ledger_name', 'period_names', 'company', 'account']
    }
  },
  {
    name: 'getGLTransactions',
    description: 'Get GL journal line transactions for a period, optionally filtered by account',
    inputSchema: {
      type: 'object',
      properties: {
        period_names: { type: 'string', description: 'Period name (e.g., Jan-26)' },
        account: { type: 'string', description: 'GL Account number (optional filter)' },
        limit: { type: 'integer', description: 'Max results (default 100)' }
      },
      required: ['period_names']
    }
  },
  {
    name: 'getAccountBalance',
    description: 'Get GL trial-balance figures (opening, debit, credit, closing) for every account in a period. Omit account to list ALL accounts.',
    inputSchema: {
      type: 'object',
      properties: {
        ledger_name: { type: 'string', description: 'General Ledger name (e.g., BUIMERC LEDGER)' },
        period_names: { type: 'string', description: 'Period name (e.g., Jan-26)' },
        company: { type: 'string', description: 'Company code (optional)' },
        account: { type: 'string', description: 'GL Account number (optional — omit to list all accounts)' }
      },
      required: ['ledger_name', 'period_names']
    }
  },
  {
    name: 'searchAccounts',
    description: 'List or search the chart of accounts (account combination + description) active in a period',
    inputSchema: {
      type: 'object',
      properties: {
        ledger_name: { type: 'string', description: 'General Ledger name (e.g., BUIMERC LEDGER)' },
        period_names: { type: 'string', description: 'Period name (e.g., Jan-26)' },
        search_term: { type: 'string', description: 'Search term — matches account number or description (optional, omit to list all accounts)' }
      },
      required: ['ledger_name', 'period_names']
    }
  },
  {
    name: 'getJournalEntry',
    description: 'Get details of a specific journal entry',
    inputSchema: {
      type: 'object',
      properties: {
        je_header_id: { type: 'string', description: 'Journal Entry Header ID' }
      },
      required: ['je_header_id']
    }
  }
];

// ── Execute Tool ────────────────────────────────────────────────────────
async function executeTool(toolName, args) {
  switch (toolName) {
    case 'getGLAccountAnalysis':
      return await getGLAccountAnalysis(args);
    case 'getGLTransactions':
      return await getGLTransactions(args);
    case 'getAccountBalance':
      return await getAccountBalance(args);
    case 'searchAccounts':
      return await searchAccounts(args);
    case 'getJournalEntry':
      return await getJournalEntry(args);
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

// ── MCP JSON-RPC dispatch (shared by HTTP and stdio transports) ────────────
// Returns a response object, or null for notifications (no id → no response).
async function handleMcpRequest(request) {
  const { jsonrpc = '2.0', method, params, id } = request;
  const isNotification = (id === undefined || id === null);

  try {
    log('INFO', `MCP Request: ${method}`);

    if (method === 'initialize') {
      return {
        jsonrpc,
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: {
            name: 'GL MCP Server',
            version: '1.0.0'
          }
        }
      };
    }
    if (method === 'notifications/initialized' || method.startsWith('notifications/')) {
      return null;
    }
    if (method === 'ping') {
      return { jsonrpc, id, result: {} };
    }
    if (method === 'resources/list') {
      return { jsonrpc, id, result: { resources: [] } };
    }
    if (method === 'prompts/list') {
      return { jsonrpc, id, result: { prompts: [] } };
    }
    if (method === 'tools/list') {
      return { jsonrpc, id, result: { tools: MCP_TOOLS } };
    }
    if (method === 'tools/call') {
      const { name, arguments: toolArgs } = params;
      const result = await executeTool(name, toolArgs);
      return {
        jsonrpc,
        id,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2)
            }
          ]
        }
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

// ── Request handler (HTTP and HTTPS) ──────────────────────────────────────
async function requestHandler(req, res) {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // Health check
  if (pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
    return;
  }

  // MCP JSON-RPC endpoint (for Claude Desktop)
  if ((pathname === '/' || pathname === '') && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const request = JSON.parse(body);
        const response = await handleMcpRequest(request);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response || {}));
      } catch (error) {
        log('ERROR', `MCP Error: ${error.message}`);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32603, message: error.message }
        }));
      }
    });
    return;
  }

  // Custom HTTP /execute endpoint (for Electron app)
  if (pathname === '/execute' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { tool, arguments: args } = JSON.parse(body);
        log('INFO', `HTTP Request: Tool=${tool}`);

        const result = await executeTool(tool, args);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, data: result }));
      } catch (error) {
        log('ERROR', `HTTP Error: ${error.message}`);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: error.message }));
      }
    });
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
}

// ── Generate or load locally-trusted certificate ────────────────────────
async function getCertificateAsync() {
  const certDir = path.join(require('os').homedir(), '.gl-mcp-server');
  const certPath = path.join(certDir, 'cert.pem');
  const keyPath = path.join(certDir, 'key.pem');

  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    try {
      log('INFO', 'Using existing certificate from ~/.gl-mcp-server');
      return {
        cert: fs.readFileSync(certPath, 'utf8'),
        key: fs.readFileSync(keyPath, 'utf8'),
      };
    } catch (e) {
      log('WARN', `Failed to read existing certificates: ${e.message}`);
    }
  }

  log('INFO', 'Generating locally-trusted certificate for localhost...');
  try {
    if (!fs.existsSync(certDir)) {
      fs.mkdirSync(certDir, { recursive: true });
    }

    try {
      const mkcert = require('mkcert');

      log('INFO', 'Creating certificate with mkcert (locally-trusted)...');
      const ca = await mkcert.createCA({
        organization: 'GL MCP Server',
        countryCode: 'US',
        state: 'State',
        locality: 'Local',
        validity: 365
      });

      const cert = await mkcert.createCert({
        domains: ['localhost', '127.0.0.1', '::1'],
        caKey: ca.key,
        caCert: ca.cert,
        validity: 365
      });

      fs.writeFileSync(certPath, cert.cert);
      fs.writeFileSync(keyPath, cert.key);

      log('INFO', `Certificate generated at ${certDir} using mkcert (locally-trusted)`);
      log('INFO', 'Certificate is trusted by your system for development');
      return {
        cert: cert.cert,
        key: cert.key,
      };
    } catch (mkcertError) {
      log('WARN', `mkcert not available: ${mkcertError.message}`);
      log('INFO', 'Falling back to self-signed certificate (will show warning)...');

      try {
        const forge = require('node-forge');

        log('DEBUG', 'Generating RSA key pair...');
        const keys = forge.pki.rsa.generateKeyPair(2048);

        log('DEBUG', 'Generating self-signed certificate...');
        const cert = forge.pki.createCertificate();
        cert.publicKey = keys.publicKey;
        cert.serialNumber = '01';

        const now = new Date();
        cert.validity.notBefore = now;
        cert.validity.notAfter = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

        cert.setSubject([
          { name: 'commonName', value: 'localhost' },
          { name: 'organizationName', value: 'GL MCP Server' },
          { name: 'countryName', value: 'US' }
        ]);

        cert.setIssuer(cert.subject.attributes);
        cert.sign(keys.privateKey, forge.md.sha256.create());

        const certPem = forge.pki.certificateToPem(cert);
        const keyPem = forge.pki.privateKeyToPem(keys.privateKey);

        fs.writeFileSync(certPath, certPem);
        fs.writeFileSync(keyPath, keyPem);

        log('INFO', `Certificate generated at ${certDir} using node-forge (${certPem.length} bytes cert, ${keyPem.length} bytes key)`);
        log('WARN', 'Self-signed certificate will show browser warnings - use mkcert for trusted certs');
        return {
          cert: certPem,
          key: keyPem,
        };
      } catch (nodeError) {
        log('ERROR', `Failed to generate certificate with node-forge: ${nodeError.message}`);
        return null;
      }
    }
  } catch (e) {
    log('ERROR', `Failed to generate certificate: ${e.message}`);
    return null;
  }
}

// ── HTTP Server (fallback) ────────────────────────────────────────────────
function startHttpServer(port) {
  const httpServer = http.createServer(requestHandler);

  httpServer.listen(port, '127.0.0.1', () => {
    log('INFO', `HTTP Server listening on http://localhost:${port}`);
    log('WARN', 'Running in HTTP mode - not compatible with Claude Desktop');
  });

  httpServer.on('error', (err) => {
    log('ERROR', `HTTP Server error: ${err.message}`);
  });

  return httpServer;
}

// ── HTTPS Server ──────────────────────────────────────────────────────────
function startHttpsServer(port) {
  const tlsConfig = getCertificate();

  if (!tlsConfig) {
    log('WARN', 'Could not generate HTTPS certificate, falling back to HTTP');
    return startHttpServer(port);
  }

  const httpsServer = https.createServer(tlsConfig, requestHandler);

  httpsServer.listen(port, '127.0.0.1', () => {
    log('INFO', `HTTPS Server listening on https://localhost:${port}`);
    log('INFO', `MCP Endpoint: https://localhost:${port}/`);
    log('INFO', `Certificate: Self-signed (safe for localhost testing)`);
  });

  httpsServer.on('error', (err) => {
    log('ERROR', `HTTPS Server error: ${err.message}`);
  });

  return httpsServer;
}

// ── stdio transport (for Claude Desktop — no port, no TLS, no wrapper) ─────
// Reads newline-delimited JSON-RPC from stdin, writes responses to stdout.
// All logging goes to stderr (log() uses console.error), so stdout stays clean.
function runStdioServer() {
  log('INFO', 'Starting GL MCP Server in stdio mode');
  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin, terminal: false });

  // Don't exit while tool calls are still in flight — stdin can close (or the
  // client can cycle the pipe) while an Oracle request is awaiting its response.
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
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0', id: null,
        error: { code: -32700, message: 'Parse error' }
      }) + '\n');
      return;
    }
    pending++;
    try {
      const response = await handleMcpRequest(request);
      if (response) {
        process.stdout.write(JSON.stringify(response) + '\n');
      }
    } finally {
      pending--;
      maybeExit();
    }
  });

  rl.on('close', () => {
    stdinClosed = true;
    maybeExit();
  });
}

// ── Main startup ──────────────────────────────────────────────────────────
async function main() {
  try {
    // stdio mode: spawned directly by Claude Desktop via claude_desktop_config.json
    if (process.argv.includes('--stdio') || process.env.MCP_STDIO === '1') {
      runStdioServer();
      return;
    }

    log('INFO', 'Starting GL MCP Server (HTTPS mode with MCP protocol)');

    if (HTTP_PORT) {
      log('INFO', `Starting HTTPS server on port ${HTTP_PORT}`);
      log('INFO', 'Generating/loading certificate...');

      const tlsConfig = await getCertificateAsync();

      if (!tlsConfig) {
        log('ERROR', 'Failed to generate certificate, cannot start HTTPS server');
        process.exit(1);
      }

      const httpsServer = https.createServer(tlsConfig, requestHandler);

      httpsServer.listen(HTTP_PORT, '127.0.0.1', () => {
        log('INFO', `HTTPS Server listening on https://localhost:${HTTP_PORT}`);
        log('INFO', `MCP Endpoint: https://localhost:${HTTP_PORT}/`);
        log('INFO', 'GL MCP Server started successfully - ready for Claude Desktop');
      });

      httpsServer.on('error', (err) => {
        log('ERROR', `HTTPS Server error: ${err.message}`);
      });
    } else {
      log('ERROR', 'No HTTP port configured, cannot start server');
      process.exit(1);
    }
  } catch (error) {
    log('ERROR', `Failed to start server: ${error.message}`);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
  log('INFO', 'SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  log('INFO', 'SIGINT received, shutting down gracefully');
  process.exit(0);
});

main().catch((error) => {
  log('ERROR', `Startup error: ${error.message}`);
  process.exit(1);
});
