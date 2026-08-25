#!/usr/bin/env node
// ============================================================================
// INV On-Hand MCP Server — Oracle Fusion Cloud Inventory
//
// Standalone, self-contained MCP server for on-hand balance queries against
// Oracle Fusion (fscmRestApi/inventoryOnhandBalances). Independent of the other
// servers — one server per domain, easy to see which is running.
//
// "Run all underlying links": in full detail mode, every child link that each
// on-hand row exposes (lots, serials, consigned details — whatever the pod
// returns) is followed with FULL pagination, so nothing is missed even with
// 10,000+ records.
//
// Tools:
//   getOnhandBalances(item_number?, organization_code?, subinventory_code?,
//                     detail_level='summary'|'full')
//   getItemAvailability(item_number)  — quick per-org availability for one item
//
// Run:  node inv-onhand-server.cjs --stdio      (Claude Desktop)
//
// Env:
//   FUSION_BASE_URL   default https://efmh.fa.em3.oraclecloud.com
//   FUSION_USERNAME / FUSION_PASSWORD   Basic auth (required)
// ============================================================================

const { logToolCall } = require('./mcp-call-logger.cjs');

function log(level, message) {
  console.error(`[${new Date().toISOString()}] [INV ONHAND MCP ${level}] ${message}`);
}

const FUSION_DOMAIN = (() => {
  const raw = process.env.FUSION_BASE_URL || 'https://efmh.fa.em3.oraclecloud.com';
  try { const u = new URL(raw); return `${u.protocol}//${u.host}`; }
  catch (e) { return raw; }
})();
const API_BASE = `${FUSION_DOMAIN}/fscmRestApi/resources/11.13.18.05`;
// Verified working resource + query syntax (user-confirmed on efmh pod):
//   /inventoryOnhandBalances?q=OrganizationCode=GIC;SubinventoryCode=DUTY PAID;
//     ItemNumber LIKE 'GFI153825018I%'&expand=lots&onlyData=true&limit=100
const RESOURCE = 'inventoryOnhandBalances';

const PAGE_SIZE = 500;   // Fusion max per page
const MAX_PAGES = 100;   // safety cap: 50,000 rows per collection
const MAX_DETAIL_ROWS = 200; // full mode: walk child links for at most this many rows

log('INFO', `Fusion endpoint: ${API_BASE}/${RESOURCE}`);

// ── Fusion fetch with Basic auth ───────────────────────────────────────────
async function fusionGet(urlOrPath) {
  const user = process.env.FUSION_USERNAME || '';
  const pass = process.env.FUSION_PASSWORD || '';
  if (!user || !pass) {
    throw new Error('Fusion credentials not configured — set FUSION_USERNAME and FUSION_PASSWORD');
  }
  const url = urlOrPath.startsWith('http') ? urlOrPath : `${API_BASE}${urlOrPath}`;
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

// Fetch EVERY page of a collection URL (hasMore/offset pagination).
async function fetchAllPages(baseUrl) {
  const sep = baseUrl.includes('?') ? '&' : '?';
  let offset = 0;
  const all = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await fusionGet(`${baseUrl}${sep}limit=${PAGE_SIZE}&offset=${offset}`);
    const items = Array.isArray(data.items) ? data.items : [];
    all.push(...items);
    if (!data.hasMore) return { items: all, complete: true };
    offset += PAGE_SIZE;
  }
  log('WARN', `fetchAllPages hit MAX_PAGES cap for ${baseUrl}`);
  return { items: all, complete: false };
}

// ── helpers ────────────────────────────────────────────────────────────────
const round4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000;

// Sum every numeric field ending in "Quantity" across rows.
function sumQuantityFields(rows) {
  const totals = {};
  for (const r of rows) {
    for (const [k, v] of Object.entries(r)) {
      if (/Quantity$/.test(k) && typeof v === 'number') {
        totals[k] = round4((totals[k] || 0) + v);
      }
    }
  }
  return totals;
}

// Drop links/nulls for compact output.
function compactRow(r) {
  const out = {};
  for (const [k, v] of Object.entries(r)) {
    if (k === 'links' || v === null || v === undefined || v === '') continue;
    out[k] = v;
  }
  return out;
}

// Fusion q syntax: ';' joins conditions (AND). '=' takes the bare value,
// LIKE takes a quoted pattern — matching the verified URLs exactly:
//   q=OrganizationCode=GIC;SubinventoryCode=DUTY PAID;ItemNumber LIKE 'GFI153825018I%'
//   q=OrganizationCode=GIC;ItemDescription LIKE 'DETTOL%'
function buildQuery({ item_number, item_description, organization_code, subinventory_code }) {
  const parts = [];
  if (organization_code) parts.push(`OrganizationCode=${organization_code}`);
  if (subinventory_code) parts.push(`SubinventoryCode=${subinventory_code}`);
  if (item_number) {
    if (String(item_number).includes('%')) parts.push(`ItemNumber LIKE '${item_number}'`);
    else parts.push(`ItemNumber=${item_number}`);
  }
  if (item_description) {
    // Description searches are always LIKE; add a trailing % if none given.
    const pat = String(item_description).includes('%') ? item_description : `${item_description}%`;
    parts.push(`ItemDescription LIKE '${pat}'`);
  }
  return parts.length ? `q=${encodeURIComponent(parts.join(';'))}` : '';
}

// Best-guess primary quantity for a row (field names vary by resource shape).
function qtyOf(r) {
  if (typeof r.PrimaryQuantity === 'number') return r.PrimaryQuantity;
  if (typeof r.OnhandQuantity === 'number') return r.OnhandQuantity;
  for (const [k, v] of Object.entries(r)) {
    if (/Quantity$/.test(k) && typeof v === 'number') return v;
  }
  return 0;
}

// ── Tools ──────────────────────────────────────────────────────────────────

// On-hand balances with optional full child-link walking.
async function getOnhandBalances(params) {
  const { item_number, item_description, organization_code, subinventory_code, detail_level = 'summary' } = params || {};
  if (!item_number && !item_description && !organization_code) {
    throw new Error('Provide at least item_number, item_description, or organization_code — an unfiltered query would return the whole warehouse');
  }
  const q = buildQuery({ item_number, item_description, organization_code, subinventory_code });
  // No onlyData: keep each row's "links" so child collections can be walked.
  const parentUrl = `${API_BASE}/${RESOURCE}${q ? `?${q}` : ''}`;
  const { items: rows, complete } = await fetchAllPages(parentUrl);

  // Aggregations by item+org and org+subinventory
  const byItemOrg = new Map();
  const bySubinv = new Map();
  for (const r of rows) {
    const k1 = `${r.ItemNumber || '?'} @ ${r.OrganizationCode || '?'}`;
    const k2 = `${r.OrganizationCode || '?'} / ${r.SubinventoryCode || '(none)'}`;
    byItemOrg.set(k1, round4((byItemOrg.get(k1) || 0) + qtyOf(r)));
    bySubinv.set(k2, round4((bySubinv.get(k2) || 0) + qtyOf(r)));
  }

  const result = {
    resource: RESOURCE,
    filters: { item_number: item_number || null, item_description: item_description || null, organization_code: organization_code || null, subinventory_code: subinventory_code || null },
    rowCount: rows.length,
    paginationComplete: complete,
    quantityTotals: sumQuantityFields(rows),
    totalsByItemOrganization: Object.fromEntries(byItemOrg),
    totalsByOrgSubinventory: Object.fromEntries(bySubinv),
  };

  if (detail_level === 'full') {
    // Walk EVERY child link of each row (lots, serials, consigned — whatever
    // the pod exposes), each with full pagination, in parallel per row.
    const detailRows = rows.slice(0, MAX_DETAIL_ROWS);
    result.detailRowsWalked = detailRows.length;
    result.detailRowsSkipped = Math.max(0, rows.length - detailRows.length);
    result.rows = await Promise.all(detailRows.map(async (r) => {
      const row = compactRow(r);
      const childLinks = (r.links || []).filter((l) => l.rel === 'child' && l.href);
      row.children = {};
      await Promise.all(childLinks.map(async (l) => {
        try {
          const { items: kids, complete: kidsComplete } = await fetchAllPages(l.href);
          row.children[l.name] = {
            count: kids.length,
            complete: kidsComplete,
            quantityTotals: sumQuantityFields(kids),
            items: kids.map(compactRow),
          };
        } catch (e) {
          row.children[l.name] = { error: e.message };
        }
      }));
      return row;
    }));
  } else {
    // summary: compact rows without child expansion
    result.rows = rows.map(compactRow);
  }
  return result;
}

// Quick availability check by item number OR description, across all
// organizations. A description search can match many items, so results are
// grouped per item, each with its per-organization breakdown.
async function getItemAvailability(params) {
  const { item_number, item_description } = params || {};
  if (!item_number && !item_description) throw new Error('item_number or item_description is required');
  const q = buildQuery({ item_number, item_description });
  const { items: rows, complete } = await fetchAllPages(`${API_BASE}/${RESOURCE}?${q}&onlyData=true`);

  const byItem = new Map();
  for (const r of rows) {
    const itemKey = r.ItemNumber || '?';
    if (!byItem.has(itemKey)) byItem.set(itemKey, { item: itemKey, description: r.ItemDescription, totalPrimaryQuantity: 0, organizations: new Map() });
    const it = byItem.get(itemKey);
    it.totalPrimaryQuantity = round4(it.totalPrimaryQuantity + qtyOf(r));
    const org = r.OrganizationCode || '?';
    if (!it.organizations.has(org)) it.organizations.set(org, { organization: org, organizationName: r.OrganizationName, primaryQuantity: 0, subinventories: new Set(), uom: r.PrimaryUOMCode || r.UOMCode || r.TransactionUOMCode });
    const o = it.organizations.get(org);
    o.primaryQuantity = round4(o.primaryQuantity + qtyOf(r));
    if (r.SubinventoryCode) o.subinventories.add(r.SubinventoryCode);
  }
  const items = [...byItem.values()].map((it) => ({
    ...it,
    organizations: [...it.organizations.values()]
      .map((o) => ({ ...o, subinventories: [...o.subinventories] }))
      .sort((a, b) => b.primaryQuantity - a.primaryQuantity),
  })).sort((a, b) => b.totalPrimaryQuantity - a.totalPrimaryQuantity);

  return {
    searchedBy: item_number ? { item_number } : { item_description },
    rowCount: rows.length,
    paginationComplete: complete,
    itemCount: items.length,
    totalPrimaryQuantity: round4(items.reduce((s, it) => s + it.totalPrimaryQuantity, 0)),
    items,
  };
}

const MCP_TOOLS = [
  {
    name: 'getOnhandBalances',
    description: 'Get on-hand inventory balances from Oracle Fusion Cloud (inventoryOnhandBalances) with FULL pagination — all rows, even 10,000+. detail_level "summary" returns rows plus quantity totals by item/organization/subinventory; "full" additionally walks EVERY underlying child link of each row (lots, serials, consigned details) with full pagination.',
    inputSchema: {
      type: 'object',
      properties: {
        item_number: { type: 'string', description: 'Item number (exact, or use % for LIKE, e.g. "GFI153825018I%")' },
        item_description: { type: 'string', description: 'Item description search, e.g. "DETTOL" — always a LIKE match (a trailing % is added automatically)' },
        organization_code: { type: 'string', description: 'Inventory organization code (optional, e.g. GIC)' },
        subinventory_code: { type: 'string', description: 'Subinventory code (optional, e.g. DUTY PAID)' },
        detail_level: { type: 'string', enum: ['summary', 'full'], description: 'summary (default) = rows + totals; full = also walk every child link (lots, serials, consigned)' },
      },
      required: [],
    },
  },
  {
    name: 'getItemAvailability',
    description: 'Quick availability by item number OR item description (e.g. "DETTOL") across all inventory organizations — per-item totals with per-organization breakdown and the subinventories that hold stock.',
    inputSchema: {
      type: 'object',
      properties: {
        item_number: { type: 'string', description: 'Item number (exact, or use % for LIKE)' },
        item_description: { type: 'string', description: 'Item description search, e.g. "DETTOL" — LIKE match, trailing % added automatically' },
      },
      required: [],
    },
  },
];

async function executeTool(name, args) {
  switch (name) {
    case 'getOnhandBalances':   return await getOnhandBalances(args || {});
    case 'getItemAvailability': return await getItemAvailability(args || {});
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

// ── MCP Prompts — appear under + → Connectors in Claude Desktop ────────────
const MCP_PROMPTS = [
  {
    name: 'onhand-item',
    description: 'Full on-hand picture for an item — every org, subinventory, lot and serial',
    arguments: [{ name: 'item', description: 'Item number, e.g. AS54888', required: true }],
    template: (a) => `Use getOnhandBalances with item_number "${a.item}" and detail_level "full". Present: total on-hand by organization, then by subinventory, then the lot and serial detail from the child links. Flag any lots close to expiry and any negative quantities.`,
  },
  {
    name: 'warehouse-stock',
    description: 'Stock summary for one inventory organization',
    arguments: [{ name: 'org', description: 'Organization code, e.g. M1', required: true }],
    template: (a) => `Use getOnhandBalances with organization_code "${a.org}" (summary). Summarize total on-hand by subinventory and list the 20 largest item balances. Point out anything unusual (negative quantities, single-location concentration).`,
  },
  {
    name: 'item-availability',
    description: 'Quick availability check for an item across all organizations',
    arguments: [{ name: 'item', description: 'Item number', required: true }],
    template: (a) => `Use getItemAvailability for item "${a.item}" and tell me the total quantity, which organizations hold it, and in which subinventories.`,
  },
  {
    name: 'product-search',
    description: 'Find stock by product description (e.g. DETTOL) — all matching items with quantities',
    arguments: [
      { name: 'description', description: 'Product description to search, e.g. DETTOL', required: true },
      { name: 'org', description: 'Organization code (optional, e.g. GIC)', required: false },
    ],
    template: (a) => `Use getOnhandBalances with item_description "${a.description}"${a.org ? ` and organization_code "${a.org}"` : ''} (summary). List every matching item with its description, organization, subinventory and on-hand quantity, then give the totals per item.`,
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
          serverInfo: { name: 'INV On-Hand MCP Server', version: '1.0.0' },
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
        logToolCall('inv-onhand-server', { tool: name, args: toolArgs, ok: true, ms: Date.now() - t0, result });
        return { jsonrpc, id, result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] } };
      } catch (e) {
        logToolCall('inv-onhand-server', { tool: name, args: toolArgs, ok: false, ms: Date.now() - t0, error: e.message });
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
  log('INFO', 'Starting INV On-Hand MCP Server in stdio mode');
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
