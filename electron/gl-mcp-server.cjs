// Note: MCP SDK dependency removed - using HTTP mode only
// The HTTP endpoint provides full MCP functionality for Claude Desktop
log('INFO', 'GL MCP Server running in HTTPS mode (self-signed certificate)');
const https = require('https');
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ── Logging utility ────────────────────────────────────────────────────────
function log(level, message) {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [GL MCP ${level}]`;
  console.error(`${prefix} ${message}`);
}

log('INFO', 'GL MCP Server initializing...');

// ── Configuration ──────────────────────────────────────────────────────────
// Extract just the domain from Oracle Base URL
function extractDomain(url) {
  try {
    const urlObj = new URL(url);
    return `${urlObj.protocol}//${urlObj.host}`;
  } catch (e) {
    // Fallback: try to extract protocol and host manually
    const match = url.match(/^https?:\/\/[^/]+/);
    return match ? match[0] : url;
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

  // Add basic auth only if not skipped and credentials provided
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

// ── Tool: Get GL Account Analysis ──────────────────────────────────────────
async function getGLAccountAnalysis(params) {
  const { ledger_name, period_names, company, account } = params;

  // Build cache key
  const cacheKey = `gl_analysis_${ledger_name}_${period_names}_${company}_${account}`;
  const cached = getCachedValue(cacheKey);
  if (cached) return { ...cached, cached: true };

  // Build query string with parameters
  const queryParams = new URLSearchParams({
    ledger_name: ledger_name || '',
    period_names: period_names || '',
    company: company || '',
    account: account || '',
  }).toString();

  const result = await fetchAPI(`/gl/accountanalysis?${queryParams}`, {
    method: 'GET',
  });

  setCachedValue(cacheKey, result);
  return { ...result, cached: false };
}

// ── Tool: Get GL Transactions ──────────────────────────────────────────────
async function getGLTransactions(params) {
  const { ledger_name, period_names, company, account, limit = 100, offset = 0 } = params;

  const cacheKey = `gl_txns_${ledger_name}_${period_names}_${company}_${account}_${limit}_${offset}`;
  const cached = getCachedValue(cacheKey);
  if (cached) return { ...cached, cached: true };

  // Build query string with parameters
  const queryParams = new URLSearchParams({
    ledger_name: ledger_name || '',
    period_names: period_names || '',
    company: company || '',
    account: account || '',
    limit: limit.toString(),
    offset: offset.toString(),
  }).toString();

  const result = await fetchAPI(`/gl/transactions?${queryParams}`, {
    method: 'GET',
  });

  setCachedValue(cacheKey, result);
  return { ...result, cached: false };
}

// ── Tool: Get Account Balance ──────────────────────────────────────────────
async function getAccountBalance(params) {
  const { ledger_name, period_names, account } = params;

  const cacheKey = `gl_balance_${ledger_name}_${period_names}_${account}`;
  const cached = getCachedValue(cacheKey);
  if (cached) return { ...cached, cached: true };

  // Build query string with parameters
  const queryParams = new URLSearchParams({
    ledger_name: ledger_name || '',
    period_names: period_names || '',
    account: account || '',
  }).toString();

  const result = await fetchAPI(`/gl/accountbalance?${queryParams}`, {
    method: 'GET',
  });

  setCachedValue(cacheKey, result);
  return { ...result, cached: false };
}

// ── Tool: Search Accounts ──────────────────────────────────────────────────
async function searchAccounts(params) {
  const { ledger_name, search_term } = params;

  const result = await fetchAPI('/gl/accounts/search', {
    method: 'POST',
    body: {
      ledger_name,
      search_term,
    },
  });

  return result;
}

// ── Tool: Get Journal Entry ────────────────────────────────────────────────
async function getJournalEntry(params) {
  const { je_header_id } = params;

  const result = await fetchAPI(`/gl/journalentry/${je_header_id}`, {
    method: 'GET',
  });

  return result;
}

// Note: MCP tools are exposed via HTTP endpoints only
// This allows testing on Claude Desktop and other MCP clients via HTTP

// ── Generate or load self-signed certificate ──────────────────────────────
function getCertificate() {
  const certDir = path.join(require('os').homedir(), '.gl-mcp-server');
  const certPath = path.join(certDir, 'cert.pem');
  const keyPath = path.join(certDir, 'key.pem');

  // Return existing cert if available
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

  // Generate new self-signed certificate
  log('INFO', 'Generating self-signed certificate for localhost...');
  try {
    // Ensure cert directory exists
    if (!fs.existsSync(certDir)) {
      fs.mkdirSync(certDir, { recursive: true });
    }

    // Try openssl first (faster)
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
      // Fallback to Node.js selfsigned package
      try {
        const selfsigned = require('selfsigned');
        const attrs = [{ name: 'commonName', value: 'localhost' }];
        const pems = selfsigned.generate(attrs, { days: 365, algorithm: 'sha256', keySize: 2048 });

        // Ensure we have cert and private key
        if (!pems.cert || !pems.private) {
          throw new Error(`selfsigned returned invalid data: cert=${!!pems.cert}, private=${!!pems.private}`);
        }

        // Write as strings/buffers
        const certData = pems.cert.toString ? pems.cert.toString() : pems.cert;
        const keyData = pems.private.toString ? pems.private.toString() : pems.private;

        fs.writeFileSync(certPath, certData);
        fs.writeFileSync(keyPath, keyData);

        log('INFO', `Certificate generated at ${certDir} using selfsigned`);
        return {
          cert: certData,
          key: keyData,
        };
      } catch (nodeError) {
        log('ERROR', `Failed to generate certificate with selfsigned: ${nodeError.message}`);
        return null;
      }
    }
  } catch (e) {
    log('ERROR', `Failed to generate certificate: ${e.message}`);
    return null;
  }
}

// ── Request handler (shared by HTTP and HTTPS) ────────────────────────────
async function requestHandler(req, res) {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // Health check endpoint
  if (pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
    return;
  }

  // Tool execution endpoint
  if (pathname === '/execute' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { tool, arguments: args } = JSON.parse(body);
        log('INFO', `HTTP Request: Tool=${tool}`);

        let result;
        switch (tool) {
          case 'getGLAccountAnalysis':
            result = await getGLAccountAnalysis(args);
            break;
          case 'getGLTransactions':
            result = await getGLTransactions(args);
            break;
          case 'getAccountBalance':
            result = await getAccountBalance(args);
            break;
          case 'searchAccounts':
            result = await searchAccounts(args);
            break;
          case 'getJournalEntry':
            result = await getJournalEntry(args);
            break;
          default:
            throw new Error(`Unknown tool: ${tool}`);
        }

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

// ── HTTP Server (fallback when HTTPS cert generation fails) ────────────────
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

// ── HTTPS Server (for Claude Desktop) ──────────────────────────────────────
function startHttpsServer(port) {
  const tlsConfig = getCertificate();

  if (!tlsConfig) {
    log('WARN', 'Could not generate HTTPS certificate, falling back to HTTP');
    return startHttpServer(port);
  }

  const httpsServer = https.createServer(tlsConfig, requestHandler);

  httpsServer.listen(port, 'localhost', () => {
    log('INFO', `HTTPS Server listening on https://localhost:${port}`);
    log('INFO', `Certificate: Self-signed (safe for localhost testing)`);
  });

  httpsServer.on('error', (err) => {
    log('ERROR', `HTTPS Server error: ${err.message}`);
  });

  return httpsServer;
}

// ── Main startup ───────────────────────────────────────────────────────────
async function main() {
  try {
    log('INFO', 'Starting GL MCP Server (HTTPS mode)');

    // Start HTTPS server
    if (HTTP_PORT) {
      log('INFO', `Starting HTTPS server on port ${HTTP_PORT}`);
      startHttpsServer(HTTP_PORT);
      log('INFO', 'GL MCP Server started successfully - HTTPS server running');
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
