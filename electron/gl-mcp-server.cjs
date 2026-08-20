// Import MCP SDK - the package exports these directly
const { Server, StdioServerTransport, CallToolRequest } = require('@modelcontextprotocol/sdk');
const http = require('http');
const url = require('url');

// ── Logging utility ────────────────────────────────────────────────────────
function log(level, message) {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [GL MCP ${level}]`;
  console.error(`${prefix} ${message}`);
}

log('INFO', 'GL MCP Server initializing...');

// ── Configuration ──────────────────────────────────────────────────────────
const ORACLE_BASE_URL = process.env.ORACLE_BASE_URL || 'https://g15d6279501ae08-buimerc.adb.me-dubai-1.oraclecloudapps.com';
const APEX_ENDPOINT = `${ORACLE_BASE_URL}/ords/bcldifc/reerp`;
const HTTP_PORT = process.env.GL_MCP_HTTP_PORT ? parseInt(process.env.GL_MCP_HTTP_PORT, 10) : null;
const SKIP_AUTH = process.env.SKIP_AUTH === 'true' || process.env.SKIP_AUTH === '1';

log('INFO', `Config: ORACLE_BASE_URL=${ORACLE_BASE_URL}`);
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

  const result = await fetchAPI('/gl/accountanalysis', {
    method: 'GET',
    headers: {
      'ledger_name': encodeURIComponent(ledger_name),
      'period_names': encodeURIComponent(period_names),
      'company': company,
      'account': account,
    },
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

  const result = await fetchAPI(`/gl/transactions?limit=${limit}&offset=${offset}`, {
    method: 'GET',
    headers: {
      'ledger_name': encodeURIComponent(ledger_name),
      'period_names': encodeURIComponent(period_names),
      'company': company,
      'account': account,
    },
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

  const result = await fetchAPI('/gl/accountbalance', {
    method: 'GET',
    headers: {
      'ledger_name': encodeURIComponent(ledger_name),
      'period_names': encodeURIComponent(period_names),
      'account': account,
    },
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

// ── MCP Server Setup ───────────────────────────────────────────────────────
const server = new Server({
  name: 'oracle-gl-mcp-server',
  version: '1.0.0',
});

// Register tools
server.setRequestHandler(CallToolRequest, async (request) => {
  const { name, arguments: args } = request;

  try {
    let result;

    switch (name) {
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
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Tool error: ${error.message}` }],
      isError: true,
    };
  }
});

// Expose tools
server.tool('getGLAccountAnalysis', 'Get GL account analysis for a given account and period', {
  ledger_name: { type: 'string', description: 'Ledger name (e.g., "BUIMERC LEDGER")' },
  period_names: { type: 'string', description: 'Period name (e.g., "Jan-26")' },
  company: { type: 'string', description: 'Company code (e.g., "01")' },
  account: { type: 'string', description: 'Account number (e.g., "1222107")' },
});

server.tool('getGLTransactions', 'Get GL transactions with pagination', {
  ledger_name: { type: 'string', description: 'Ledger name' },
  period_names: { type: 'string', description: 'Period name' },
  company: { type: 'string', description: 'Company code' },
  account: { type: 'string', description: 'Account number' },
  limit: { type: 'number', description: 'Records per page (default: 100)' },
  offset: { type: 'number', description: 'Page offset (default: 0)' },
});

server.tool('getAccountBalance', 'Get account balance for a specific period', {
  ledger_name: { type: 'string', description: 'Ledger name' },
  period_names: { type: 'string', description: 'Period name' },
  account: { type: 'string', description: 'Account number' },
});

server.tool('searchAccounts', 'Search chart of accounts', {
  ledger_name: { type: 'string', description: 'Ledger name' },
  search_term: { type: 'string', description: 'Account name or number to search' },
});

server.tool('getJournalEntry', 'Get journal entry details', {
  je_header_id: { type: 'number', description: 'Journal entry header ID' },
});

// ── HTTP Server (for Claude Desktop testing) ──────────────────────────────
function startHttpServer(port) {
  const httpServer = http.createServer(async (req, res) => {
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
  });

  httpServer.listen(port, 'localhost', () => {
    log('INFO', `HTTP Server listening on http://localhost:${port}`);
  });

  httpServer.on('error', (err) => {
    log('ERROR', `HTTP Server error: ${err.message}`);
  });

  return httpServer;
}

// ── Main startup ───────────────────────────────────────────────────────────
async function main() {
  try {
    log('INFO', 'Starting GL MCP Server');

    // Start HTTP server if port provided
    if (HTTP_PORT) {
      log('INFO', `Starting HTTP server on port ${HTTP_PORT}`);
      startHttpServer(HTTP_PORT);
    }

    // Start stdio MCP server
    log('INFO', 'Starting stdio MCP server');
    const transport = new StdioServerTransport();
    await server.connect(transport);
    log('INFO', 'GL MCP Server started successfully - waiting for commands');
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
