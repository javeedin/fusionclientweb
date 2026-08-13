import { ORACLE_FUSION_CONFIG, APEX_DB_CONFIG } from '../config/api.config';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ARLookupsProgress {
  status:       'idle' | 'fetching' | 'inserting' | 'completed' | 'error' | 'stopped';
  totalFetched: number;
  inserted:     number;
  updated:      number;
  errors:       number;
  lastError:    string;
  startTime:    Date | null;
  endTime:      Date | null;
  objectName:   string;
}

export type LogCallback             = (type: 'info' | 'success' | 'error' | 'warning' | 'step', message: string) => void;
export type LookupsProgressCallback = (progress: Partial<ARLookupsProgress>) => void;

// ─── Lookup object config ─────────────────────────────────────────────────────

interface LookupConfig {
  objectName:     string;
  fusionEndpoint: string;   // relative to ORACLE_FUSION_CONFIG.baseUrl
  lookupType:     string;   // value passed as lookupType in POST body — matches PL/SQL CASE
}

// Single APEX bulk endpoint shared by all lookup types
const APEX_BULK_ENDPOINT = 'ar/lookups/bulk';

// ─── Generic paginated fetch from Fusion ─────────────────────────────────────

const fetchFromFusion = async (
  endpoint: string,
  params:   Record<string, string>,
  log?:     LogCallback
): Promise<any[]> => {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (ORACLE_FUSION_CONFIG.username && ORACLE_FUSION_CONFIG.password) {
    headers['Authorization'] = 'Basic ' + btoa(`${ORACLE_FUSION_CONFIG.username}:${ORACLE_FUSION_CONFIG.password}`);
  }

  const baseUrl = `${ORACLE_FUSION_CONFIG.baseUrl}/${endpoint}`;
  const limit   = ORACLE_FUSION_CONFIG.defaultLimit ?? 500;
  const allItems: any[] = [];
  let offset = 0;

  const staticQs = Object.entries(params)
    .filter(([, v]) => v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  log?.('step', `──── [GET] Fusion ${endpoint} ────`);

  while (true) {
    const qs  = [`limit=${limit}`, `offset=${offset}`, staticQs].filter(Boolean).join('&');
    const url = `${baseUrl}?${qs}`;
    log?.('info', `  URL: ${url}`);

    const resp = await fetch(url, { headers });
    if (!resp.ok) throw new Error(`Fusion ${endpoint} fetch failed: ${resp.status} ${resp.statusText}`);

    const data: any  = await resp.json();
    const items: any[] = data.items || [];
    allItems.push(...items);
    log?.('info', `  Fetched ${items.length} items (total so far: ${allItems.length})`);

    if (!data.hasMore || items.length < limit) break;
    offset += items.length;
  }

  return allItems;
};

// ─── Single bulk POST — passes lookupType + items array ──────────────────────

const postBulkToApex = async (
  lookupType: string,
  items:      any[],
  log?:       LogCallback
): Promise<{ inserted: number; updated: number; errors: number; errorDetail?: string }> => {
  const url     = `${APEX_DB_CONFIG.baseUrl}/${APEX_BULK_ENDPOINT}`;
  const payload = {
    lookupType,
    items: items.map(({ links, ...rest }) => rest),
  };

  log?.('step', `──── [POST] APEX ${APEX_BULK_ENDPOINT} — lookupType: ${lookupType} (${items.length} records) ────`);
  log?.('info', `  URL: ${url}`);

  const resp = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body:    JSON.stringify(payload),
  });

  const data: any = await resp.json();

  if (data.status === 'SUCCESS' || data.status === 'PARTIAL') {
    log?.('success', `  Inserted: ${data.inserted ?? 0}, Updated: ${data.updated ?? 0}, Errors: ${data.errors ?? 0}`);
    if (data.errorDetail) log?.('error', `  Error detail: ${data.errorDetail}`);
    return {
      inserted:    data.inserted    ?? 0,
      updated:     data.updated     ?? 0,
      errors:      data.errors      ?? 0,
      errorDetail: data.errorDetail,
    };
  }

  const msg = data.message || data.error || `APEX POST failed: ${resp.status}`;
  log?.('error', `  APEX error: ${msg}`);
  log?.('error', `  Payload: ${JSON.stringify(payload)}`);
  throw new Error(msg);
};

// ─── Generic lookup sync ──────────────────────────────────────────────────────

const syncARLookup = async (
  config:      LookupConfig,
  parameters:  Record<string, string>,
  testMode:    boolean | 'single',
  log?:        LogCallback,
  onProgress?: LookupsProgressCallback,
  signal?:     AbortSignal
): Promise<ARLookupsProgress> => {
  const progress: ARLookupsProgress = {
    status: 'idle', totalFetched: 0, inserted: 0, updated: 0,
    errors: 0, lastError: '', startTime: new Date(), endTime: null,
    objectName: config.objectName,
  };

  const update = (p: Partial<ARLookupsProgress>) => { Object.assign(progress, p); onProgress?.(p); };

  try {
    update({ status: 'fetching' });
    log?.('step', '═══════════════════════════════════════════════════════════');
    log?.('step', `  ${config.objectName.toUpperCase()} SYNC  [lookupType: ${config.lookupType}]`);
    log?.('step', '═══════════════════════════════════════════════════════════');

    if (signal?.aborted) { update({ status: 'stopped', endTime: new Date() }); return progress; }

    let items = await fetchFromFusion(config.fusionEndpoint, parameters, log);

    if (testMode === 'single')    items = items.slice(0, 1);
    else if (testMode === true)   items = items.slice(0, ORACLE_FUSION_CONFIG.testLimit ?? 25);

    update({ totalFetched: items.length });
    log?.('info', `  Total records to sync: ${items.length}`);

    if (items.length === 0) {
      log?.('warning', '  No records found — nothing to sync');
      update({ status: 'completed', endTime: new Date() });
      return progress;
    }

    if (signal?.aborted) { update({ status: 'stopped', endTime: new Date() }); return progress; }

    update({ status: 'inserting' });
    const result = await postBulkToApex(config.lookupType, items, log);

    update({ inserted: result.inserted, updated: result.updated, errors: result.errors, lastError: result.errorDetail ?? '' });

    const finalStatus = result.errors === 0 ? 'completed' : 'error';
    update({ status: finalStatus, endTime: new Date() });

    log?.('step', '───────────────────────────────────────────────────────────');
    log?.(finalStatus === 'completed' ? 'success' : 'warning',
      `  DONE — ${result.inserted} inserted, ${result.updated} updated, ${result.errors} errors`);
    log?.('step', '═══════════════════════════════════════════════════════════');
    return progress;
  } catch (e: any) {
    const msg = e instanceof Error ? e.message : String(e);
    update({ status: 'error', lastError: msg, endTime: new Date() });
    log?.('error', `Fatal error: ${msg}`);
    return progress;
  }
};

// ─── Combined: run all 5 lookups in one sync pass ────────────────────────────

export interface ARAllLookupsProgress {
  status:       'idle' | 'running' | 'completed' | 'error' | 'stopped';
  currentObject: string;
  completedCount: number;
  totalInserted: number;
  totalUpdated:  number;
  totalErrors:   number;
}

const ALL_LOOKUP_CONFIGS: LookupConfig[] = [
  { objectName: 'AR Payment Terms',           fusionEndpoint: 'paymentTermsLOV',           lookupType: 'PAYMENT_TERMS' },
  { objectName: 'AR Transaction Sources',      fusionEndpoint: 'transactionSourcesLOV',     lookupType: 'TXN_SOURCES'   },
  { objectName: 'AR Transaction Types',        fusionEndpoint: 'transactionTypesLOV',       lookupType: 'TXN_TYPES'     },
  { objectName: 'AR Memo Lines',               fusionEndpoint: 'memoLinesLOV',              lookupType: 'MEMO_LINES'    },
  { objectName: 'AR Revenue Scheduling Rules', fusionEndpoint: 'revenueSchedulingRulesLOV', lookupType: 'REVENUE_RULES' },
];

export const syncAllARLookups = async (
  parameters:  Record<string, string>,
  testMode:    boolean | 'single',
  log?:        LogCallback,
  onProgress?: (p: Partial<ARAllLookupsProgress>) => void,
  signal?:     AbortSignal
): Promise<ARAllLookupsProgress> => {
  const summary: ARAllLookupsProgress = {
    status: 'running', currentObject: '', completedCount: 0,
    totalInserted: 0, totalUpdated: 0, totalErrors: 0,
  };
  const update = (p: Partial<ARAllLookupsProgress>) => { Object.assign(summary, p); onProgress?.(p); };

  update({ status: 'running' });

  for (const config of ALL_LOOKUP_CONFIGS) {
    if (signal?.aborted) { update({ status: 'stopped' }); return summary; }
    update({ currentObject: config.objectName });
    const result = await syncARLookup(config, parameters, testMode, log, undefined, signal);
    update({
      completedCount: summary.completedCount + 1,
      totalInserted:  summary.totalInserted  + result.inserted,
      totalUpdated:   summary.totalUpdated   + result.updated,
      totalErrors:    summary.totalErrors    + result.errors,
    });
  }

  update({ status: summary.totalErrors > 0 ? 'error' : 'completed', currentObject: '' });
  return summary;
};

// ─── Named exports for the 5 lookup objects ──────────────────────────────────

export const syncPaymentTerms = (
  parameters: Record<string, string>, testMode: boolean | 'single' = true,
  log?: LogCallback, onProgress?: LookupsProgressCallback, signal?: AbortSignal
): Promise<ARLookupsProgress> =>
  syncARLookup({ objectName: 'AR Payment Terms',            fusionEndpoint: 'paymentTermsLOV',          lookupType: 'PAYMENT_TERMS'  }, parameters, testMode, log, onProgress, signal);

export const syncTxnSources = (
  parameters: Record<string, string>, testMode: boolean | 'single' = true,
  log?: LogCallback, onProgress?: LookupsProgressCallback, signal?: AbortSignal
): Promise<ARLookupsProgress> =>
  syncARLookup({ objectName: 'AR Transaction Sources',       fusionEndpoint: 'transactionSourcesLOV',    lookupType: 'TXN_SOURCES'    }, parameters, testMode, log, onProgress, signal);

export const syncTxnTypes = (
  parameters: Record<string, string>, testMode: boolean | 'single' = true,
  log?: LogCallback, onProgress?: LookupsProgressCallback, signal?: AbortSignal
): Promise<ARLookupsProgress> =>
  syncARLookup({ objectName: 'AR Transaction Types',         fusionEndpoint: 'transactionTypesLOV',      lookupType: 'TXN_TYPES'      }, parameters, testMode, log, onProgress, signal);

export const syncMemoLines = (
  parameters: Record<string, string>, testMode: boolean | 'single' = true,
  log?: LogCallback, onProgress?: LookupsProgressCallback, signal?: AbortSignal
): Promise<ARLookupsProgress> =>
  syncARLookup({ objectName: 'AR Memo Lines',                fusionEndpoint: 'memoLinesLOV',             lookupType: 'MEMO_LINES'     }, parameters, testMode, log, onProgress, signal);

export const syncRevenueRules = (
  parameters: Record<string, string>, testMode: boolean | 'single' = true,
  log?: LogCallback, onProgress?: LookupsProgressCallback, signal?: AbortSignal
): Promise<ARLookupsProgress> =>
  syncARLookup({ objectName: 'AR Revenue Scheduling Rules',  fusionEndpoint: 'revenueSchedulingRulesLOV', lookupType: 'REVENUE_RULES'  }, parameters, testMode, log, onProgress, signal);
