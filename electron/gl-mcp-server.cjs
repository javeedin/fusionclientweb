const { Server } = require('@modelcontextprotocol/sdk/server/stdio');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio');
const { CallToolRequest, Tool } = require('@modelcontextprotocol/sdk/types');

// ── Configuration ──────────────────────────────────────────────────────────
const ORACLE_BASE_URL = process.env.ORACLE_BASE_URL || 'https://g15d6279501ae08-buimerc.adb.me-dubai-1.oraclecloudapps.com';
const APEX_ENDPOINT = `${ORACLE_BASE_URL}/ords/bcldifc/reerp`;

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

  // Add basic auth if credentials provided
  if (username && password) {
    const encoded = Buffer.from(`${username}:${password}`).toString('base64');
    headers['Authorization'] = `Basic ${encoded}`;
  }

  try {
    const response = await fetch(`${APEX_ENDPOINT}${endpoint}`, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (!response.ok) {
      throw new Error(`Oracle API ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error(`[GL API] Error: ${error.message}`);
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

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[GL MCP Server] Started successfully');
}

main().catch(console.error);
