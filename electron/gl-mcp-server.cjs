// GL MCP Server with MCP Protocol Support
// Supports both MCP JSON-RPC (for Claude Desktop) and custom HTTP API (for Electron app)
const https = require('https');
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');
const { logToolCall } = require('./mcp-call-logger.cjs');

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
  if (!period) {
    throw new Error('period_names is required (e.g., "Jan-26")');
  }
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

// ── Period Close Copilot tools ─────────────────────────────────────────────
// Modeled on Oracle Fusion AI Agent Studio's "Ledger Insights" close workspace
// (period status, variance analysis, clearing accounts, TB health), but backed
// by the Re-ERP ORDS endpoints instead of Fusion-internal BOSS services.

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Period status per application (GL/AP/AR) — same endpoint the Trial Balance
// screen uses (periodsstatus/create?P_APPLICATION_NAME=&P_LEDGER_NAME=).
async function getPeriodStatus(params) {
  const { ledger_name, period_names, applications } = params;
  const period = String(period_names || '').split(',')[0].trim();
  const ledger = ledger_name || 'BUIMERC LEDGER';
  const apps = (applications && String(applications).split(',').map((s) => s.trim()).filter(Boolean))
    || ['General Ledger', 'Payables', 'Receivables'];

  const results = await Promise.all(apps.map(async (app) => {
    try {
      const qp = new URLSearchParams({ P_APPLICATION_NAME: app, P_LEDGER_NAME: ledger });
      const data = await fetchAPI(`/periodsstatus/create?${qp.toString()}`, { method: 'GET' });
      let items = Array.isArray(data?.items) ? data.items : [];
      if (period) items = items.filter((r) => String(r.period_name_id || r.period_name || '') === period);
      return { application: app, periods: items.map((r) => ({
        period: r.period_name_id || r.period_name, status: r.status,
        start_date: r.start_date, end_date: r.end_date,
      })) };
    } catch (e) {
      return { application: app, error: e.message };
    }
  }));
  return { ledger, period: period || '(all)', applications: results };
}

// Trial balance health: totals, Dr=Cr check, net-closing gap, largest closings.
async function getTrialBalanceHealth(params) {
  const { ledger_name, period_names, company } = params;
  const period = String(period_names || '').split(',')[0].trim();
  const items = await fetchTrialBalance(ledger_name, period, company);

  let opening = 0, debit = 0, credit = 0, closing = 0;
  const byType = {};
  for (const r of items) {
    opening += Number(r.opening) || 0;
    debit += Number(r.debit) || 0;
    credit += Number(r.credit) || 0;
    closing += Number(r.closing) || 0;
    const t = r.account_type || '?';
    byType[t] = (byType[t] || 0) + (Number(r.closing) || 0);
  }
  const topClosing = [...items]
    .sort((a, b) => Math.abs(Number(b.closing) || 0) - Math.abs(Number(a.closing) || 0))
    .slice(0, 10)
    .map((r) => ({ account: r.account_combination, description: r.account_desc, closing: round2(r.closing) }));

  return {
    ledger: ledger_name || 'BUIMERC LEDGER', period, company: company || '(all)',
    accountCount: items.length,
    totals: { opening: round2(opening), debit: round2(debit), credit: round2(credit), closing: round2(closing) },
    debitsEqualCredits: Math.abs(debit - credit) < 0.01,
    drCrDifference: round2(debit - credit),
    // Net of all closing balances; a non-zero value means the TB does not net
    // to zero (e.g., missing retained-earnings roll-forward or one-sided rows).
    netClosingGap: round2(closing),
    closingByAccountType: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, round2(v)])),
    largestClosingBalances: topClosing,
  };
}

// Variance vs a prior period: closing balance movement per account, ranked.
async function getVarianceVsPriorPeriod(params) {
  const { ledger_name, period_names, prior_period, company, top = 20, min_amount = 0 } = params;
  const period = String(period_names || '').split(',')[0].trim();
  const prior = String(prior_period || '').trim();
  if (!prior) throw new Error('prior_period is required (e.g., "Jun-26")');

  const [cur, prev] = await Promise.all([
    fetchTrialBalance(ledger_name, period, company),
    fetchTrialBalance(ledger_name, prior, company),
  ]);
  const prevMap = new Map(prev.map((r) => [r.account_combination, r]));
  const seen = new Set();
  const rows = [];
  for (const r of cur) {
    seen.add(r.account_combination);
    const p = prevMap.get(r.account_combination);
    const curClosing = Number(r.closing) || 0;
    const prevClosing = p ? (Number(p.closing) || 0) : 0;
    const change = curClosing - prevClosing;
    if (Math.abs(change) >= (Number(min_amount) || 0)) {
      rows.push({
        account: r.account_combination, description: r.account_desc,
        accountType: r.account_type,
        current: round2(curClosing), prior: round2(prevClosing), change: round2(change),
        pctChange: prevClosing !== 0 ? round2((change / Math.abs(prevClosing)) * 100) : null,
        newAccount: !p,
      });
    }
  }
  // Accounts that had a balance last period but vanished this period.
  for (const p of prev) {
    if (!seen.has(p.account_combination) && (Number(p.closing) || 0) !== 0) {
      rows.push({
        account: p.account_combination, description: p.account_desc,
        accountType: p.account_type,
        current: 0, prior: round2(p.closing), change: round2(-(Number(p.closing) || 0)),
        pctChange: -100, droppedAccount: true,
      });
    }
  }
  rows.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
  return {
    ledger: ledger_name || 'BUIMERC LEDGER', period, priorPeriod: prior, company: company || '(all)',
    comparedAccounts: cur.length,
    totalAbsoluteMovement: round2(rows.reduce((s, r) => s + Math.abs(r.change), 0)),
    topMovers: rows.slice(0, Number(top) || 20),
  };
}

// Clearing / suspense account balances that should be zero at close.
// account_patterns: comma-separated substrings matched against the account
// combination or description; defaults to GL_CLEARING_ACCOUNTS env or
// description keywords "clearing"/"suspense".
async function getClearingAccountBalances(params) {
  const { ledger_name, period_names, company, account_patterns } = params;
  const period = String(period_names || '').split(',')[0].trim();
  const items = await fetchTrialBalance(ledger_name, period, company);

  const patterns = String(account_patterns || process.env.GL_CLEARING_ACCOUNTS || '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const matches = items.filter((r) => {
    const combo = String(r.account_combination || '').toLowerCase();
    const desc = String(r.account_desc || '').toLowerCase();
    if (patterns.length) return patterns.some((p) => combo.includes(p) || desc.includes(p));
    return desc.includes('clearing') || desc.includes('suspense');
  });
  const unreconciled = matches
    .filter((r) => Math.abs(Number(r.closing) || 0) >= 0.01)
    .sort((a, b) => Math.abs(Number(b.closing) || 0) - Math.abs(Number(a.closing) || 0))
    .map((r) => ({
      account: r.account_combination, description: r.account_desc,
      opening: round2(r.opening), debit: round2(r.debit), credit: round2(r.credit), closing: round2(r.closing),
    }));
  return {
    ledger: ledger_name || 'BUIMERC LEDGER', period, company: company || '(all)',
    patternsUsed: patterns.length ? patterns : ['clearing', 'suspense'],
    clearingAccountsFound: matches.length,
    unreconciledCount: unreconciled.length,
    unreconciledBalances: unreconciled,
    allClear: unreconciled.length === 0,
  };
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
  },
  {
    name: 'getPeriodStatus',
    description: 'Period close status per application (General Ledger, Payables, Receivables) for a ledger and period — is each subledger open or closed?',
    inputSchema: {
      type: 'object',
      properties: {
        ledger_name: { type: 'string', description: 'Ledger name (default BUIMERC LEDGER)' },
        period_names: { type: 'string', description: 'Period name (e.g., Jul-26); omit to list all periods' },
        applications: { type: 'string', description: 'Comma-separated application names (default "General Ledger,Payables,Receivables")' }
      },
      required: []
    }
  },
  {
    name: 'getTrialBalanceHealth',
    description: 'Period-close health check on the trial balance: total debits vs credits, net closing gap, closing by account type, and the largest closing balances. Use this first in a close review.',
    inputSchema: {
      type: 'object',
      properties: {
        ledger_name: { type: 'string', description: 'Ledger name (default BUIMERC LEDGER)' },
        period_names: { type: 'string', description: 'Period name (e.g., Jul-26)' },
        company: { type: 'string', description: 'Company code (optional)' }
      },
      required: ['period_names']
    }
  },
  {
    name: 'getVarianceVsPriorPeriod',
    description: 'Balance variance analysis: closing-balance movement per account between two periods, ranked by absolute change. Flags new accounts and accounts that dropped to zero.',
    inputSchema: {
      type: 'object',
      properties: {
        ledger_name: { type: 'string', description: 'Ledger name (default BUIMERC LEDGER)' },
        period_names: { type: 'string', description: 'Current period (e.g., Jul-26)' },
        prior_period: { type: 'string', description: 'Prior period to compare against (e.g., Jun-26)' },
        company: { type: 'string', description: 'Company code (optional)' },
        top: { type: 'integer', description: 'How many top movers to return (default 20)' },
        min_amount: { type: 'number', description: 'Ignore movements smaller than this (default 0)' }
      },
      required: ['period_names', 'prior_period']
    }
  },
  {
    name: 'getClearingAccountBalances',
    description: 'Clearing/suspense accounts that still carry a balance at period end — these should be zero before close. Matches accounts by pattern or by "clearing"/"suspense" in the description.',
    inputSchema: {
      type: 'object',
      properties: {
        ledger_name: { type: 'string', description: 'Ledger name (default BUIMERC LEDGER)' },
        period_names: { type: 'string', description: 'Period name (e.g., Jul-26)' },
        company: { type: 'string', description: 'Company code (optional)' },
        account_patterns: { type: 'string', description: 'Comma-separated substrings to match account number or description (optional; default clearing/suspense keywords)' }
      },
      required: ['period_names']
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
    case 'getPeriodStatus':
      return await getPeriodStatus(args);
    case 'getTrialBalanceHealth':
      return await getTrialBalanceHealth(args);
    case 'getVarianceVsPriorPeriod':
      return await getVarianceVsPriorPeriod(args);
    case 'getClearingAccountBalances':
      return await getClearingAccountBalances(args);
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

// ── MCP Prompts — appear as "/" slash commands in Claude Desktop ───────────
const MCP_PROMPTS = [
  {
    name: 'trial-balance',
    description: 'Trial balance for a period — all accounts with balances',
    arguments: [
      { name: 'period', description: 'Period name, e.g. Jan-26', required: true },
      { name: 'ledger', description: 'Ledger name (default BUIMERC LEDGER)', required: false },
    ],
    template: (a) => `Use getAccountBalance for ledger "${a.ledger || 'BUIMERC LEDGER'}" and period "${a.period}" (no account filter). Present the trial balance grouped by account type with opening, debit, credit, and closing columns, and highlight the largest closing balances.`,
  },
  {
    name: 'account-analysis',
    description: 'Analyze one GL account for a period',
    arguments: [
      { name: 'account', description: 'GL account number, e.g. 1222107', required: true },
      { name: 'period', description: 'Period name, e.g. Jan-26', required: true },
      { name: 'company', description: 'Company code (default 01)', required: false },
    ],
    template: (a) => `Use getGLAccountAnalysis for ledger "BUIMERC LEDGER", period "${a.period}", company "${a.company || '01'}", account "${a.account}". Summarize the activity, balances, and anything unusual.`,
  },
  {
    name: 'account-search',
    description: 'Search the chart of accounts by name or number',
    arguments: [
      { name: 'term', description: 'Search term, e.g. vehicle', required: true },
      { name: 'period', description: 'Period name, e.g. Jan-26', required: true },
    ],
    template: (a) => `Use searchAccounts on ledger "BUIMERC LEDGER" for period "${a.period}" with search term "${a.term}" and list the matching accounts with their descriptions.`,
  },
  {
    name: 'period-transactions',
    description: 'GL journal transactions for a period, optionally one account',
    arguments: [
      { name: 'period', description: 'Period name, e.g. Jan-26', required: true },
      { name: 'account', description: 'Account filter (optional)', required: false },
    ],
    template: (a) => `Use getGLTransactions for period "${a.period}"${a.account ? ` filtered to account "${a.account}"` : ''}. Summarize the journal activity by source and category, and point out large or unusual entries.`,
  },
  {
    name: 'close-review',
    description: 'Period Close Copilot — full close review for a period (status, TB health, variances, clearing accounts)',
    arguments: [
      { name: 'period', description: 'Period to review, e.g. Jul-26', required: true },
      { name: 'prior_period', description: 'Prior period for variance comparison, e.g. Jun-26', required: true },
      { name: 'ledger', description: 'Ledger name (default BUIMERC LEDGER)', required: false },
    ],
    template: (a) => {
      const ledger = a.ledger || 'BUIMERC LEDGER';
      return `Run a period close review for ledger "${ledger}", period "${a.period}".

Call these four tools (they are independent — run them all):
1. getPeriodStatus for period "${a.period}" — is each application (GL/AP/AR) open or closed?
2. getTrialBalanceHealth for period "${a.period}" — do debits equal credits, and is there a net closing gap?
3. getVarianceVsPriorPeriod for period "${a.period}" vs prior_period "${a.prior_period}" — what moved the most?
4. getClearingAccountBalances for period "${a.period}" — do clearing/suspense accounts still carry balances?

Then produce an executive close summary:
- Overall readiness verdict (Ready / Ready with exceptions / Not ready) with one-line reasoning.
- Period status per application as a checklist.
- TB health: state the debit/credit totals and call out any net closing gap explicitly with the amount.
- Top 5 variances with likely business explanation, flagging any that look like errors rather than activity.
- Clearing account exceptions that must be cleared before close.
- A prioritized action list (what to fix first, and which tool/screen to use).
Keep amounts formatted with thousands separators. If any tool fails, note it and continue with the rest.`;
    },
  },
];

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
          capabilities: { tools: {}, prompts: {} },
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
      return { jsonrpc, id, result: { prompts: MCP_PROMPTS.map((p) => ({ name: p.name, description: p.description, arguments: p.arguments })) } };
    }
    if (method === 'prompts/get') {
      const { name, arguments: pargs } = params || {};
      const p = MCP_PROMPTS.find((x) => x.name === name);
      if (!p) return { jsonrpc, id, error: { code: -32602, message: `Unknown prompt: ${name}` } };
      return { jsonrpc, id, result: { description: p.description, messages: [{ role: 'user', content: { type: 'text', text: p.template(pargs || {}) } }] } };
    }
    if (method === 'tools/list') {
      return { jsonrpc, id, result: { tools: MCP_TOOLS } };
    }
    if (method === 'tools/call') {
      const { name, arguments: toolArgs } = params;
      const t0 = Date.now();
      let result;
      try {
        result = await executeTool(name, toolArgs);
      } catch (e) {
        logToolCall('gl-server', { tool: name, args: toolArgs, ok: false, ms: Date.now() - t0, error: e.message });
        throw e;
      }
      logToolCall('gl-server', { tool: name, args: toolArgs, ok: true, ms: Date.now() - t0, result });
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
