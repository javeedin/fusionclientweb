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

async function getGLTransactions(params) {
  const { ledger_name, period_names, company, account, limit = 100, offset = 0 } = params;
  const cacheKey = `gl_txns_${ledger_name}_${period_names}_${company}_${account}_${limit}_${offset}`;
  const cached = getCachedValue(cacheKey);
  if (cached) return { ...cached, cached: true };

  const queryParams = new URLSearchParams({
    ledger_name: ledger_name || '',
    period_names: period_names || '',
    company: company || '',
    account: account || '',
    limit: limit.toString(),
    offset: offset.toString(),
  }).toString();

  const result = await fetchAPI(`/gl/transactions?${queryParams}`, { method: 'GET' });
  setCachedValue(cacheKey, result);
  return { ...result, cached: false };
}

async function getAccountBalance(params) {
  const { ledger_name, period_names, account } = params;
  const cacheKey = `gl_balance_${ledger_name}_${period_names}_${account}`;
  const cached = getCachedValue(cacheKey);
  if (cached) return { ...cached, cached: true };

  const queryParams = new URLSearchParams({
    ledger_name: ledger_name || '',
    period_names: period_names || '',
    account: account || '',
  }).toString();

  const result = await fetchAPI(`/gl/accountbalance?${queryParams}`, { method: 'GET' });
  setCachedValue(cacheKey, result);
  return { ...result, cached: false };
}

async function searchAccounts(params) {
  const { ledger_name, search_term } = params;
  return await fetchAPI('/gl/accounts/search', {
    method: 'POST',
    body: { ledger_name, search_term },
  });
}

async function getJournalEntry(params) {
  const { je_header_id } = params;
  return await fetchAPI(`/gl/journalentry/${je_header_id}`, { method: 'GET' });
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
    description: 'Get GL transactions with pagination support',
    inputSchema: {
      type: 'object',
      properties: {
        ledger_name: { type: 'string', description: 'General Ledger name' },
        period_names: { type: 'string', description: 'Period name' },
        company: { type: 'string', description: 'Company code' },
        account: { type: 'string', description: 'GL Account number' },
        limit: { type: 'integer', description: 'Max results (default 100)' },
        offset: { type: 'integer', description: 'Pagination offset (default 0)' }
      },
      required: ['ledger_name', 'period_names', 'company', 'account']
    }
  },
  {
    name: 'getAccountBalance',
    description: 'Get account balance for a specific period',
    inputSchema: {
      type: 'object',
      properties: {
        ledger_name: { type: 'string', description: 'General Ledger name' },
        period_names: { type: 'string', description: 'Period name' },
        account: { type: 'string', description: 'GL Account number' }
      },
      required: ['ledger_name', 'period_names', 'account']
    }
  },
  {
    name: 'searchAccounts',
    description: 'Search for GL accounts by term',
    inputSchema: {
      type: 'object',
      properties: {
        ledger_name: { type: 'string', description: 'General Ledger name' },
        search_term: { type: 'string', description: 'Search term' }
      },
      required: ['ledger_name', 'search_term']
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
        log('INFO', `MCP Request: ${request.method}`);

        let response;
        const { jsonrpc = '2.0', method, params, id } = request;

        if (method === 'initialize') {
          response = {
            jsonrpc,
            id,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: {},
              serverInfo: {
                name: 'GL MCP Server',
                version: '1.0.0'
              }
            }
          };
        }
        else if (method === 'resources/list') {
          response = {
            jsonrpc,
            id,
            result: { resources: [] }
          };
        }
        else if (method === 'tools/list') {
          response = {
            jsonrpc,
            id,
            result: { tools: MCP_TOOLS }
          };
        }
        else if (method === 'tools/call') {
          const { name, arguments: toolArgs } = params;
          const result = await executeTool(name, toolArgs);
          response = {
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
        else {
          throw new Error(`Unknown MCP method: ${method}`);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response));
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

// ── Generate or load self-signed certificate ──────────────────────────────
function getCertificate() {
  const certDir = path.join(require('os').homedir(), '.gl-mcp-server');
  const certPath = path.join(certDir, 'cert.pem');
  const keyPath = path.join(certDir, 'key.pem');

  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    try {
      return {
        cert: fs.readFileSync(certPath, 'utf8'),
        key: fs.readFileSync(keyPath, 'utf8'),
      };
    } catch (e) {
      log('WARN', `Failed to read existing certificates: ${e.message}`);
    }
  }

  log('INFO', 'Generating self-signed certificate for localhost...');
  try {
    if (!fs.existsSync(certDir)) {
      fs.mkdirSync(certDir, { recursive: true });
    }

    try {
      const { execSync } = require('child_process');
      const cmd = `openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -days 365 -nodes -subj "/CN=localhost"`;
      execSync(cmd);
      log('INFO', `Certificate generated at ${certDir} using openssl`);
      return {
        cert: fs.readFileSync(certPath, 'utf8'),
        key: fs.readFileSync(keyPath, 'utf8'),
      };
    } catch (opensslError) {
      log('DEBUG', `openssl not available: ${opensslError.message}`);
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

  httpServer.listen(port, 'localhost', () => {
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

  httpsServer.listen(port, 'localhost', () => {
    log('INFO', `HTTPS Server listening on https://localhost:${port}`);
    log('INFO', `MCP Endpoint: https://localhost:${port}/`);
    log('INFO', `Certificate: Self-signed (safe for localhost testing)`);
  });

  httpsServer.on('error', (err) => {
    log('ERROR', `HTTPS Server error: ${err.message}`);
  });

  return httpsServer;
}

// ── Main startup ──────────────────────────────────────────────────────────
async function main() {
  try {
    // Use HTTP for localhost development (Claude Desktop can access HTTP on localhost)
    // Use HTTPS for remote/production (with proper certificates)
    const useHttps = process.env.FORCE_HTTPS === 'true';

    if (HTTP_PORT) {
      if (useHttps) {
        log('INFO', 'Starting GL MCP Server (HTTPS mode with MCP protocol)');
        log('INFO', `Starting HTTPS server on port ${HTTP_PORT}`);
        startHttpsServer(HTTP_PORT);
        log('INFO', 'GL MCP Server started successfully - HTTPS server running');
      } else {
        log('INFO', 'Starting GL MCP Server (HTTP mode with MCP protocol)');
        log('INFO', `Starting HTTP server on port ${HTTP_PORT}`);
        startHttpServer(HTTP_PORT);
        log('INFO', 'GL MCP Server started successfully - HTTP server running');
        log('INFO', `MCP Endpoint: http://localhost:${HTTP_PORT}/`);
      }
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
