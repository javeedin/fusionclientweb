#!/usr/bin/env node
// ============================================================================
// AR Customer Balance MCP Server — Oracle Fusion Cloud Receivables
//
// Determines the CORRECT customer balance by fetching the parent site
// activities and then walking EVERY child collection link with FULL
// pagination (all pages, however many records):
//
//   transactionPaymentSchedules      — invoices / installments
//   creditMemos                      — credit memos
//   creditMemoApplications           — CM applications
//   standardReceipts                 — receipts (payments)
//   standardReceiptApplications     — receipt applications
//   transactionAdjustments           — adjustments
//   transactionsPaidByOtherCustomers — cross-customer payments
//
// Everything is fetched server-side; Claude receives a computed summary
// (totals per child type, open/closed splits, reconciliation against the
// site-level TotalOpenReceivablesForSite) plus compact detail rows.
//
// Run:  node ar-customer-balance-server.cjs --stdio
// Env:  FUSION_BASE_URL (default https://efmh.fa.em3.oraclecloud.com)
//       FUSION_USERNAME / FUSION_PASSWORD  (required)
// ============================================================================

const { logToolCall } = require('./mcp-call-logger.cjs');

function log(level, message) {
  console.error(`[${new Date().toISOString()}] [AR BALANCE ${level}] ${message}`);
}

const FUSION_DOMAIN = (() => {
  const raw = process.env.FUSION_BASE_URL || 'https://efmh.fa.em3.oraclecloud.com';
  try { const u = new URL(raw); return `${u.protocol}//${u.host}`; }
  catch (e) { return raw; }
})();
const API_BASE = `${FUSION_DOMAIN}/fscmRestApi/resources/11.13.18.05`;
const PAGE_SIZE = 500;          // Fusion REST max rows per page
const MAX_PAGES = 100;          // safety cap: 100 × 500 = 50,000 rows per collection

const CHILD_COLLECTIONS = [
  'transactionPaymentSchedules',
  'creditMemos',
  'creditMemoApplications',
  'standardReceipts',
  'standardReceiptApplications',
  'transactionAdjustments',
  'transactionsPaidByOtherCustomers',
];

log('INFO', `Fusion endpoint: ${API_BASE}`);

// ── Fusion GET with Basic auth ─────────────────────────────────────────────
async function fusionGet(pathAndQuery) {
  const user = process.env.FUSION_USERNAME || '';
  const pass = process.env.FUSION_PASSWORD || '';
  if (!user || !pass) {
    throw new Error('Fusion credentials not configured — set FUSION_USERNAME and FUSION_PASSWORD');
  }
  const url = `${API_BASE}${pathAndQuery}`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Authorization: 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64'),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Fusion API ${res.status} on ${pathAndQuery.split('?')[0]}: ${text.substring(0, 200)}`);
  return JSON.parse(text);
}

// Fetch EVERY page of a collection (hasMore/offset pagination).
async function fetchAllPages(basePath, extraQuery = '') {
  const all = [];
  let offset = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const sep = basePath.includes('?') ? '&' : '?';
    const data = await fusionGet(`${basePath}${sep}onlyData=true&limit=${PAGE_SIZE}&offset=${offset}${extraQuery}`);
    const items = data.items || [];
    all.push(...items);
    if (!data.hasMore) break;
    offset += PAGE_SIZE;
    log('INFO', `  ...paging ${basePath.split('?')[0]} offset=${offset} (fetched ${all.length} so far)`);
  }
  return all;
}

// Sum every numeric field ending in "Amount" across rows → { FieldName: total }
function sumAmountFields(rows) {
  const sums = {};
  for (const row of rows) {
    for (const [k, v] of Object.entries(row)) {
      if (/Amount$/i.test(k) && v !== null && v !== '' && !isNaN(Number(v))) {
        sums[k] = Math.round(((sums[k] || 0) + Number(v)) * 100) / 100;
      }
    }
  }
  return sums;
}

// Compact a row: keep identifiers, dates, statuses, currency, and amounts only
function compactRow(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === null || v === undefined || k === 'links') continue;
    if (/Amount$|Number$|Date$|Status$|Currency|Class$|Type$|Id$|Reference$|DaysLate$/i.test(k)) {
      out[k] = v;
    }
  }
  return out;
}

// ── The tool ───────────────────────────────────────────────────────────────
async function getCustomerBalance({ customer_name, detail_level = 'summary' }) {
  if (!customer_name) throw new Error('customer_name is required');
  const started = Date.now();

  // 1. Parent — all pages of site activities for the customer
  const q = encodeURIComponent(`CustomerName LIKE '${customer_name}%'`);
  log('INFO', `Fetching site activities for "${customer_name}"...`);
  const sites = await fetchAllPages(`/receivablesCustomerAccountSiteActivities?q=${q}`);
  if (sites.length === 0) {
    return { customerName: customer_name, message: 'No customer account sites found', sites: [] };
  }

  // 2. Every child collection of every site — all pages
  const siteResults = [];
  for (const site of sites) {
    const siteId = site.BillToSiteUseId;
    log('INFO', `Site ${site.BillToSiteNumber} (${siteId}): fetching ${CHILD_COLLECTIONS.length} child collections...`);

    const childData = {};
    // Fetch the 7 collections in parallel per site
    await Promise.all(CHILD_COLLECTIONS.map(async (child) => {
      try {
        childData[child] = await fetchAllPages(`/receivablesCustomerAccountSiteActivities/${siteId}/child/${child}`);
      } catch (e) {
        log('WARN', `  ${child}: ${e.message}`);
        childData[child] = { error: e.message };
      }
    }));

    // 3. Aggregate per child collection
    const children = {};
    for (const child of CHILD_COLLECTIONS) {
      const rows = childData[child];
      if (!Array.isArray(rows)) {
        children[child] = { error: rows.error };
        continue;
      }
      const entry = {
        recordCount: rows.length,
        amountTotals: sumAmountFields(rows),
      };
      if (child === 'transactionPaymentSchedules') {
        const open = rows.filter((r) => Number(r.TotalBalanceAmount || 0) !== 0);
        entry.openCount = open.length;
        entry.closedCount = rows.length - open.length;
        entry.openBalanceTotal = Math.round(open.reduce((s, r) => s + Number(r.TotalBalanceAmount || 0), 0) * 100) / 100;
      }
      if (detail_level === 'full') {
        entry.records = rows.map(compactRow);
      } else if (child === 'transactionPaymentSchedules') {
        // summary mode still includes the OPEN installments in compact form
        entry.openRecords = rows
          .filter((r) => Number(r.TotalBalanceAmount || 0) !== 0)
          .map(compactRow);
      }
      children[child] = entry;
    }

    const computedOpenBalance = children.transactionPaymentSchedules?.openBalanceTotal ?? null;
    siteResults.push({
      customerName: site.CustomerName,
      accountNumber: site.AccountNumber,
      billToSiteNumber: site.BillToSiteNumber,
      billToSiteAddress: site.BillToSiteAddress,
      siteReported: {
        totalOpenReceivablesForSite: site.TotalOpenReceivablesForSite,
        totalTransactionsDueForSite: site.TotalTransactionsDueForSite,
      },
      computedOpenBalance,
      reconciliationDifference: (computedOpenBalance !== null && site.TotalOpenReceivablesForSite != null)
        ? Math.round((Number(site.TotalOpenReceivablesForSite) - computedOpenBalance) * 100) / 100
        : null,
      children,
    });
  }

  // 4. Customer-level rollup
  const totalRecordsFetched = siteResults.reduce((s, site) =>
    s + Object.values(site.children).reduce((c, ch) => c + (ch.recordCount || 0), 0), 0);

  return {
    customerName: sites[0].CustomerName,
    siteCount: siteResults.length,
    totalRecordsFetched,
    fetchSeconds: Math.round((Date.now() - started) / 100) / 10,
    totalOpenReceivables: Math.round(siteResults.reduce((s, x) => s + Number(x.siteReported.totalOpenReceivablesForSite || 0), 0) * 100) / 100,
    totalComputedOpenBalance: Math.round(siteResults.reduce((s, x) => s + Number(x.computedOpenBalance || 0), 0) * 100) / 100,
    sites: siteResults,
    note: detail_level === 'full'
      ? 'All records included in compact form.'
      : 'Summary mode: totals for every child collection plus open installments. Call again with detail_level="full" for all records.',
  };
}

const MCP_TOOLS = [
  {
    name: 'getCustomerBalance',
    description: 'Determine the CORRECT receivables balance for a customer from Oracle Fusion Cloud by fetching ALL underlying child collections with full pagination (every page, all records): payment schedules, credit memos and their applications, receipts and their applications, adjustments, and cross-customer payments. Returns per-site totals for each collection, the computed open balance, a reconciliation against the site-reported open receivables, and open installment details.',
    inputSchema: {
      type: 'object',
      properties: {
        customer_name: { type: 'string', description: 'Customer name (prefix match), e.g. PICK AND BUY TRIBECA LTD' },
        detail_level: { type: 'string', enum: ['summary', 'full'], description: 'summary (default): totals per collection + open installments. full: every record of every collection in compact form (can be very large).' },
      },
      required: ['customer_name'],
    },
  },
];

async function executeTool(name, args) {
  if (name === 'getCustomerBalance') return await getCustomerBalance(args || {});
  throw new Error(`Unknown tool: ${name}`);
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
          capabilities: { tools: {} },
          serverInfo: { name: 'AR Customer Balance MCP Server', version: '1.0.0' },
        },
      };
    }
    if (method === 'notifications/initialized' || method.startsWith('notifications/')) return null;
    if (method === 'ping') return { jsonrpc, id, result: {} };
    if (method === 'resources/list') return { jsonrpc, id, result: { resources: [] } };
    if (method === 'prompts/list') return { jsonrpc, id, result: { prompts: [] } };
    if (method === 'tools/list') return { jsonrpc, id, result: { tools: MCP_TOOLS } };
    if (method === 'tools/call') {
      const { name, arguments: toolArgs } = params || {};
      const t0 = Date.now();
      try {
        const result = await executeTool(name, toolArgs);
        logToolCall('ar-customer-balance', { tool: name, args: toolArgs, ok: true, ms: Date.now() - t0, result });
        return { jsonrpc, id, result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] } };
      } catch (e) {
        logToolCall('ar-customer-balance', { tool: name, args: toolArgs, ok: false, ms: Date.now() - t0, error: e.message });
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
  log('INFO', 'Starting AR Customer Balance MCP Server in stdio mode');
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
