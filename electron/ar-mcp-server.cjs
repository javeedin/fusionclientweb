#!/usr/bin/env node
// ============================================================================
// AR MCP Server — Oracle Fusion Cloud Receivables
//
// Standalone, self-contained MCP server for AR queries against Oracle Fusion
// (fscmRestApi). Independent of gl-mcp-server and of the registry server —
// one server per domain, easy to see which is running in Claude Desktop.
//
// Tools:
//   getOpenInstallments(customer_name)   — customer site activities with ONLY
//                                          unpaid installments (TotalBalanceAmount != 0)
//   getCustomerActivities(customer_name) — site totals only (fast, no child rows)
//
// Run:  node ar-mcp-server.cjs --stdio      (Claude Desktop)
//
// Env:
//   FUSION_BASE_URL   default https://efmh.fa.em3.oraclecloud.com
//   FUSION_USERNAME / FUSION_PASSWORD   Basic auth (required)
// ============================================================================

const { logToolCall } = require('./mcp-call-logger.cjs');

function log(level, message) {
  console.error(`[${new Date().toISOString()}] [AR MCP ${level}] ${message}`);
}

const FUSION_DOMAIN = (() => {
  const raw = process.env.FUSION_BASE_URL || 'https://efmh.fa.em3.oraclecloud.com';
  try { const u = new URL(raw); return `${u.protocol}//${u.host}`; }
  catch (e) { return raw; }
})();
const API_BASE = `${FUSION_DOMAIN}/fscmRestApi/resources/11.13.18.05`;

log('INFO', `Fusion endpoint: ${API_BASE}`);

// ── Fusion fetch with Basic auth ───────────────────────────────────────────
async function fusionGet(pathAndQuery) {
  const user = process.env.FUSION_USERNAME || '';
  const pass = process.env.FUSION_PASSWORD || '';
  if (!user || !pass) {
    throw new Error('Fusion credentials not configured — set FUSION_USERNAME and FUSION_PASSWORD');
  }
  const url = `${API_BASE}${pathAndQuery}`;
  log('INFO', `GET ${url}`);
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Authorization: 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64'),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Fusion API ${res.status}: ${text.substring(0, 300)}`);
  return JSON.parse(text);
}

// ── Tools ──────────────────────────────────────────────────────────────────

// Single-call pattern: parent query + expand=transactionPaymentSchedules,
// then keep only installments with a remaining balance.
async function getOpenInstallments({ customer_name }) {
  if (!customer_name) throw new Error('customer_name is required');
  const q = encodeURIComponent(`CustomerName LIKE '${customer_name}%'`);
  const data = await fusionGet(
    `/receivablesCustomerAccountSiteActivities?q=${q}&expand=transactionPaymentSchedules&onlyData=true&limit=200`
  );
  const items = (data.items || []).map((site) => {
    const all = site.transactionPaymentSchedules || [];
    const open = all.filter((i) => Number(i.TotalBalanceAmount || 0) !== 0);
    return {
      customerName: site.CustomerName,
      accountNumber: site.AccountNumber,
      billToSiteNumber: site.BillToSiteNumber,
      billToSiteAddress: site.BillToSiteAddress,
      totalOpenReceivablesForSite: site.TotalOpenReceivablesForSite,
      totalTransactionsDueForSite: site.TotalTransactionsDueForSite,
      openInstallmentCount: open.length,
      totalInstallmentCount: all.length,
      openInstallments: open,
    };
  });
  return { count: items.length, items };
}

// Parent rows only — site-level totals, no child expansion (fast).
async function getCustomerActivities({ customer_name }) {
  if (!customer_name) throw new Error('customer_name is required');
  const q = encodeURIComponent(`CustomerName LIKE '${customer_name}%'`);
  const data = await fusionGet(
    `/receivablesCustomerAccountSiteActivities?q=${q}&onlyData=true&limit=200`
  );
  return { count: (data.items || []).length, items: data.items || [] };
}

const MCP_TOOLS = [
  {
    name: 'getOpenInstallments',
    description: 'Get OPEN (unpaid) receivables installments for a customer from Oracle Fusion Cloud. Returns each customer site with its totals and only the installments that still have a balance (TotalBalanceAmount != 0), including transaction number, dates, due date, original and remaining amounts.',
    inputSchema: {
      type: 'object',
      properties: {
        customer_name: { type: 'string', description: 'Customer name (prefix match), e.g. PICK AND BUY TRIBECA LTD' },
      },
      required: ['customer_name'],
    },
  },
  {
    name: 'getCustomerActivities',
    description: 'Get receivables account site activity summary for a customer from Oracle Fusion Cloud — site addresses and total open receivables / total due per site. Fast overview without installment detail.',
    inputSchema: {
      type: 'object',
      properties: {
        customer_name: { type: 'string', description: 'Customer name (prefix match)' },
      },
      required: ['customer_name'],
    },
  },
];

async function executeTool(name, args) {
  switch (name) {
    case 'getOpenInstallments':   return await getOpenInstallments(args || {});
    case 'getCustomerActivities': return await getCustomerActivities(args || {});
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

// ── MCP Prompts — appear as "/" slash commands in Claude Desktop ───────────
const MCP_PROMPTS = [
  {
    name: 'open-installments',
    description: 'Show unpaid installments for a customer',
    arguments: [{ name: 'customer', description: 'Customer name, e.g. PICK AND BUY TRIBECA LTD', required: true }],
    template: (a) => `Use getOpenInstallments for customer "${a.customer}". Show the open installments as a table with transaction number, transaction date, due date, original amount, and remaining balance. Total the remaining balances and flag anything overdue.`,
  },
  {
    name: 'payment-reminder',
    description: 'Draft a payment reminder email for a customer',
    arguments: [{ name: 'customer', description: 'Customer name', required: true }],
    template: (a) => `Use getOpenInstallments for customer "${a.customer}", then draft a polite but firm payment reminder email listing each overdue invoice with number, due date, and amount, and the total outstanding. Keep it professional and ready to send.`,
  },
  {
    name: 'customer-overview',
    description: 'Quick receivables overview for a customer (site totals)',
    arguments: [{ name: 'customer', description: 'Customer name', required: true }],
    template: (a) => `Use getCustomerActivities for customer "${a.customer}" and summarize: each site, its address, total open receivables, and total due. Highlight the largest exposure.`,
  },
];

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
          capabilities: { tools: {}, prompts: {} },
          serverInfo: { name: 'AR MCP Server', version: '1.0.0' },
        },
      };
    }
    if (method === 'notifications/initialized' || method.startsWith('notifications/')) return null;
    if (method === 'ping') return { jsonrpc, id, result: {} };
    if (method === 'resources/list') return { jsonrpc, id, result: { resources: [] } };
    if (method === 'prompts/list') {
      return { jsonrpc, id, result: { prompts: MCP_PROMPTS.map((p) => ({ name: p.name, description: p.description, arguments: p.arguments })) } };
    }
    if (method === 'prompts/get') {
      const { name, arguments: pargs } = params || {};
      const p = MCP_PROMPTS.find((x) => x.name === name);
      if (!p) return { jsonrpc, id, error: { code: -32602, message: `Unknown prompt: ${name}` } };
      return { jsonrpc, id, result: { description: p.description, messages: [{ role: 'user', content: { type: 'text', text: p.template(pargs || {}) } }] } };
    }
    if (method === 'tools/list') return { jsonrpc, id, result: { tools: MCP_TOOLS } };
    if (method === 'tools/call') {
      const { name, arguments: toolArgs } = params || {};
      const t0 = Date.now();
      try {
        const result = await executeTool(name, toolArgs);
        logToolCall('ar-server', { tool: name, args: toolArgs, ok: true, ms: Date.now() - t0, result });
        return { jsonrpc, id, result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] } };
      } catch (e) {
        logToolCall('ar-server', { tool: name, args: toolArgs, ok: false, ms: Date.now() - t0, error: e.message });
        throw e;
      }
    }
    if (isNotification) return null;
    return { jsonrpc, id, error: { code: -32601, message: `Method not found: ${method}` } };
  } catch (error) {
    log('ERROR', `MCP Error: ${error.message}`);
    if (isNotification) return null;
    return { jsonrpc, id, error: { code: -32603, message: error.message } };
  }
}

// ── stdio transport ────────────────────────────────────────────────────────
function runStdioServer() {
  log('INFO', 'Starting AR MCP Server in stdio mode');
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
    try { request = JSON.parse(trimmed); }
    catch (e) {
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
}

if (process.argv.includes('--stdio') || process.env.MCP_STDIO === '1') {
  runStdioServer();
} else {
  log('ERROR', 'Pass --stdio to run (this server is stdio-only)');
  process.exit(1);
}

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
