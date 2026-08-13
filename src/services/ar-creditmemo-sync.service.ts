import { ORACLE_FUSION_CONFIG, APEX_DB_CONFIG } from '../config/api.config';
import { fetchFromOracle, fetchAllFromOracleUrl, insertToApex } from './sync-http';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ARCreditMemoSyncProgress {
  status: 'idle' | 'fetching' | 'inserting' | 'completed' | 'error' | 'stopped';
  totalCreditMemos:     number;
  processedCreditMemos: number;
  insertedCreditMemos:  number;
  updatedCreditMemos:   number;
  totalLines:           number;
  processedLines:       number;
  totalDistributions:   number;
  processedDistributions: number;
  currentPage:          number;
  totalPages:           number;
  errors:               number;
  lastError:            string;
  startTime:            Date | null;
  endTime:              Date | null;
}

export type LogCallback = (type: 'info' | 'success' | 'error' | 'warning' | 'step', message: string) => void;
export type ARCreditMemoProgressCallback = (progress: Partial<ARCreditMemoSyncProgress>) => void;

const APEX_BULK_ENDPOINT          = 'ar/credit-memos/bulk';
const APEX_LINES_ENDPOINT         = (id: number) => `ar/credit-memos/${id}/lines`;
const APEX_DISTRIBUTIONS_ENDPOINT = (id: number) => `ar/credit-memos/${id}/distributions`;

// ─── Oracle Fetch — Headers ───────────────────────────────────────────────────

const fetchCreditMemosFromOracle = async (
  params: Record<string, string>,
  log?: LogCallback,
  verbose = true
): Promise<{ success: boolean; items: any[]; hasMore: boolean; error?: string }> => {
  try {
    if (verbose) log?.('step', `──── [GET] Oracle Fusion AR Credit Memos (offset=${params.offset ?? 0}, limit=${params.limit}) ────`);
    const data = await fetchFromOracle('receivablesCreditMemos', params, log, verbose);
    if (verbose) log?.('info', `  ${(data.items || []).length} items, hasMore=${data.hasMore}`);
    return { success: true, items: data.items || [], hasMore: data.hasMore || false };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    log?.('error', `Fetch error: ${msg}`);
    return { success: false, items: [], hasMore: false, error: msg };
  }
};

// ─── Oracle Fetch — Lines per header ─────────────────────────────────────────

const fetchCreditMemoLinesFromOracle = async (
  customerTransactionId: number,
  log?: LogCallback
): Promise<{ success: boolean; items: any[]; error?: string }> => {
  try {
    const url = `${ORACLE_FUSION_CONFIG.baseUrl}/receivablesCreditMemos/${customerTransactionId}/child/receivablesCreditMemoLines`;
    log?.('step', `──── [GET] Oracle Fusion CM Lines (Txn: ${customerTransactionId}) ────`);
    const items = await fetchAllFromOracleUrl(url, log, false, 500);
    log?.('success', `  Fetched ${items.length} lines for CM ${customerTransactionId}`);
    return { success: true, items };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    log?.('error', `Fetch CM Lines Error: ${msg}`);
    return { success: false, items: [], error: msg };
  }
};

// ─── APEX Insert — Headers ────────────────────────────────────────────────────

const insertCreditMemosToApex = async (
  creditMemos: any[],
  log?: LogCallback,
  verbose = true
): Promise<{ success: boolean; inserted: number; updated: number; error?: string }> => {
  try {
    const payload = {
      items: creditMemos.map(cm => {
        const { links, ...rest } = cm as any;
        return rest;
      }),
    };

    if (verbose) {
      log?.('step', `──── [POST] APEX AR Credit Memos (${creditMemos.length} records) ────`);
      log?.('info', `  URL: ${APEX_DB_CONFIG.baseUrl}/${APEX_BULK_ENDPOINT}`);
      log?.('info', JSON.stringify(payload, null, 2));
    }

    const data = await insertToApex(APEX_BULK_ENDPOINT, payload, log, verbose);

    if (verbose) {
      log?.('step', '──── POST RESPONSE ────');
      log?.('success', JSON.stringify(data, null, 2));
    }

    const isSuccess = data.status === 'SUCCESS';
    return {
      success: isSuccess,
      inserted: data.inserted ?? (isSuccess ? creditMemos.length : 0),
      updated:  data.updated  ?? 0,
      error: isSuccess ? undefined : (data.message || data.error || 'Insert failed'),
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    log?.('error', `POST Error: ${msg}`);
    return { success: false, inserted: 0, updated: 0, error: msg };
  }
};

// ─── Oracle Fetch — Distributions per header ─────────────────────────────────

const fetchCreditMemoDistributionsFromOracle = async (
  customerTransactionId: number,
  log?: LogCallback
): Promise<{ success: boolean; items: any[]; error?: string }> => {
  try {
    const url = `${ORACLE_FUSION_CONFIG.baseUrl}/receivablesCreditMemos/${customerTransactionId}/child/receivablesCreditMemoDistributions`;
    log?.('step', `──── [GET] Oracle Fusion CM Distributions (Txn: ${customerTransactionId}) ────`);
    const items = await fetchAllFromOracleUrl(url, log, false, 500);
    log?.('success', `  Fetched ${items.length} distributions for CM ${customerTransactionId}`);
    return { success: true, items };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    log?.('error', `Fetch CM Distributions Error: ${msg}`);
    return { success: false, items: [], error: msg };
  }
};

// ─── APEX Insert — Lines ──────────────────────────────────────────────────────

const insertCreditMemoLinesToApex = async (
  lines: any[],
  customerTransactionId: number,
  log?: LogCallback
): Promise<{ success: boolean; successCount: number; error?: string }> => {
  try {
    const endpoint = APEX_LINES_ENDPOINT(customerTransactionId);
    const payload  = { items: lines.map(l => { const { links, ...rest } = l as any; return rest; }) };

    log?.('step', `──── [POST] APEX CM Lines for Txn ${customerTransactionId} (${lines.length} lines) ────`);
    const data = await insertToApex(endpoint, payload, log, false);

    const isSuccess = data.status === 'SUCCESS';
    return {
      success: isSuccess,
      successCount: isSuccess ? lines.length : 0,
      error: isSuccess ? undefined : (data.message || data.error || 'Lines insert failed'),
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    log?.('error', `POST Lines Error: ${msg}`);
    return { success: false, successCount: 0, error: msg };
  }
};

// ─── APEX Insert — Distributions ─────────────────────────────────────────────

const insertCreditMemoDistributionsToApex = async (
  distributions: any[],
  customerTransactionId: number,
  log?: LogCallback
): Promise<{ success: boolean; successCount: number; error?: string }> => {
  try {
    const endpoint = APEX_DISTRIBUTIONS_ENDPOINT(customerTransactionId);
    const payload  = { items: distributions.map(d => { const { links, ...rest } = d as any; return rest; }) };

    log?.('step', `──── [POST] APEX CM Distributions for Txn ${customerTransactionId} (${distributions.length} records) ────`);
    const data = await insertToApex(endpoint, payload, log, false);

    const isSuccess = data.status === 'SUCCESS';
    return {
      success: isSuccess,
      successCount: isSuccess ? distributions.length : 0,
      error: isSuccess ? undefined : (data.message || data.error || 'Distributions insert failed'),
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    log?.('error', `POST Distributions Error: ${msg}`);
    return { success: false, successCount: 0, error: msg };
  }
};

// ─── Test Connection ──────────────────────────────────────────────────────────

export const testARCreditMemoConnection = async (log?: LogCallback): Promise<boolean> => {
  try {
    log?.('info', 'Testing Oracle Fusion AR Credit Memos connection...');
    const result = await fetchCreditMemosFromOracle({ limit: '1', offset: '0' }, log, true);
    if (result.success) {
      log?.('success', `Oracle Fusion AR Credit Memos connection successful! Sample: ${result.items.length} record(s)`);
      return true;
    }
    log?.('error', 'Connection test failed');
    return false;
  } catch (error) {
    log?.('error', `Connection test error: ${error}`);
    return false;
  }
};

// ─── Main Sync ────────────────────────────────────────────────────────────────

export const syncARCreditMemos = async (
  parameters: Record<string, string>,
  testMode: boolean | 'single' = true,
  log?: LogCallback,
  onProgress?: ARCreditMemoProgressCallback,
  abortSignal?: AbortSignal
): Promise<ARCreditMemoSyncProgress> => {
  const progress: ARCreditMemoSyncProgress = {
    status: 'idle',
    totalCreditMemos: 0, processedCreditMemos: 0,
    insertedCreditMemos: 0, updatedCreditMemos: 0,
    totalLines: 0, processedLines: 0,
    totalDistributions: 0, processedDistributions: 0,
    currentPage: 0, totalPages: 0,
    errors: 0, lastError: '',
    startTime: new Date(), endTime: null,
  };

  const updateProgress = (updates: Partial<ARCreditMemoSyncProgress>) => {
    Object.assign(progress, updates);
    onProgress?.(updates);
  };

  const pageSize   = testMode === 'single' ? 1 : testMode === true ? 25 : 500;
  const maxRecords = testMode === 'single' ? 1 : testMode === true ? 25 : null;
  const verbose    = testMode !== false;
  const modeLabel  = testMode === 'single'
    ? 'SINGLE RECORD DEBUG'
    : testMode ? 'TEST MODE (25 credit memos)' : 'FULL SYNC (all credit memos)';

  try {
    updateProgress({ status: 'fetching' });

    log?.('step', '═══════════════════════════════════════════════════════════');
    log?.('step', `  AR CREDIT MEMOS SYNC — ${modeLabel}`);
    log?.('step', '═══════════════════════════════════════════════════════════');
    log?.('info', `  │ FUSION : GET  ${ORACLE_FUSION_CONFIG.baseUrl}/receivablesCreditMemos`);
    log?.('info', `  │ APEX   : POST ${APEX_DB_CONFIG.baseUrl}/${APEX_BULK_ENDPOINT}`);
    log?.('step', '═══════════════════════════════════════════════════════════');

    // ── STEP 1: Fetch & Insert Headers (streaming — fetch 500 → insert → next page) ──
    log?.('step', '  STEP 1: Fetching & Inserting AR Credit Memo Headers');

    // Collect only IDs needed for STEP 2 & STEP 3
    const allCMs: Array<{ txnId: number; txnNum: string }> = [];
    let currentPage = 0;
    let hasMore     = true;
    let offset      = 0;
    let inserted    = 0;
    let updated     = 0;
    const batchSize = 50;

    while (hasMore && (maxRecords === null || allCMs.length < maxRecords) && !abortSignal?.aborted) {
      currentPage++;
      updateProgress({ currentPage, status: 'fetching' });

      const fetchLimit = maxRecords !== null ? Math.min(pageSize, maxRecords - allCMs.length) : pageSize;
      const queryParams: Record<string, string> = {
        limit:  String(fetchLimit),
        offset: String(offset),
      };

      const filters = Object.entries(parameters)
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}=${v}`)
        .join(';');
      if (filters) queryParams.q = filters;

      const result = await fetchCreditMemosFromOracle(queryParams, log, verbose);

      if (!result.success) {
        updateProgress({ status: 'error', lastError: result.error || 'Fetch failed', endTime: new Date() });
        return progress;
      }

      if (result.items.length === 0) { hasMore = false; break; }

      // Collect IDs for steps 2 & 3
      for (const item of result.items) {
        if (item.CustomerTransactionId) {
          allCMs.push({
            txnId:  item.CustomerTransactionId,
            txnNum: item.TransactionNumber || String(item.CustomerTransactionId),
          });
        }
      }

      offset  += result.items.length;
      hasMore  = result.hasMore && (maxRecords === null || allCMs.length < maxRecords);
      updateProgress({ totalCreditMemos: allCMs.length });

      // Insert this page immediately in batches of 50
      updateProgress({ status: 'inserting' });
      for (let i = 0; i < result.items.length; i += batchSize) {
        if (abortSignal?.aborted) {
          updateProgress({ status: 'stopped', endTime: new Date() });
          return progress;
        }

        const batch    = result.items.slice(i, i + batchSize);
        const batchNum = Math.floor(i / batchSize) + 1;
        const totalB   = Math.ceil(result.items.length / batchSize);

        log?.('info', `  Page ${currentPage} — batch ${batchNum}/${totalB} (${batch.length} records, offset=${offset - result.items.length + i})`);

        const r = await insertCreditMemosToApex(batch, log, verbose);

        if (r.success) {
          inserted += r.inserted;
          updated  += r.updated;
          updateProgress({
            insertedCreditMemos:  inserted,
            updatedCreditMemos:   updated,
            processedCreditMemos: allCMs.length - result.items.length + i + batch.length,
          });
          log?.('success', `  ✓ Batch ${batchNum}: ${r.inserted} inserted, ${r.updated} updated`);
        } else {
          updateProgress({
            errors:               progress.errors + 1,
            lastError:            r.error || 'Batch insert failed',
            processedCreditMemos: allCMs.length - result.items.length + i + batch.length,
          });
          log?.('error', `  ✗ Batch ${batchNum} failed: ${r.error}`);
        }

        if (i + batchSize < result.items.length) await new Promise(r => setTimeout(r, 50));
      }

      if (hasMore) await new Promise(r => setTimeout(r, 100));
    }

    updateProgress({ totalCreditMemos: allCMs.length, totalPages: currentPage });
    log?.('success', `Total credit memos fetched & inserted: ${allCMs.length} (${inserted} ins / ${updated} upd)`);

    if (allCMs.length === 0) {
      updateProgress({ status: 'completed', endTime: new Date() });
      log?.('warning', 'No credit memos found for the given parameters');
      return progress;
    }

    // ── STEP 2: Fetch & Insert Lines per Credit Memo ──────────────────────────
    log?.('step', '═══════════════════════════════════════════════════════════');
    log?.('step', '  STEP 2: Fetching and Inserting AR Credit Memo Lines');
    log?.('step', '═══════════════════════════════════════════════════════════');

    let totalLines     = 0;
    let processedLines = 0;

    for (let i = 0; i < allCMs.length; i++) {
      if (abortSignal?.aborted) {
        updateProgress({ status: 'stopped', endTime: new Date() });
        return progress;
      }

      const { txnId, txnNum } = allCMs[i];

      if (verbose) log?.('info', `[${i + 1}/${allCMs.length}] Lines for CM ${txnNum} (ID: ${txnId})`);

      const linesResult = await fetchCreditMemoLinesFromOracle(txnId, log);

      if (!linesResult.success) {
        log?.('error', `  ✗ Failed to fetch lines for ${txnNum}: ${linesResult.error}`);
        continue;
      }

      if (linesResult.items.length === 0) {
        if (verbose) log?.('info', `  No lines for ${txnNum} — skipping`);
        continue;
      }

      totalLines += linesResult.items.length;
      updateProgress({ totalLines });

      const lineBatchSize = 100;
      for (let j = 0; j < linesResult.items.length; j += lineBatchSize) {
        const lineBatch = linesResult.items.slice(j, j + lineBatchSize);
        const lineResult = await insertCreditMemoLinesToApex(lineBatch, txnId, log);

        if (lineResult.success) {
          processedLines += lineResult.successCount;
          updateProgress({ processedLines });
          if (verbose) log?.('success', `  ✓ ${lineResult.successCount} lines inserted for ${txnNum}`);
        } else {
          updateProgress({ errors: progress.errors + 1, lastError: lineResult.error || 'Lines insert failed' });
          log?.('error', `  ✗ Lines failed for ${txnNum}: ${lineResult.error}`);
        }
      }

      if (i < allCMs.length - 1) await new Promise(r => setTimeout(r, 50));
    }

    // ── STEP 3: Fetch & Insert Distributions per Credit Memo ─────────────────
    log?.('step', '═══════════════════════════════════════════════════════════');
    log?.('step', '  STEP 3: Fetching and Inserting AR Credit Memo Distributions');
    log?.('step', '═══════════════════════════════════════════════════════════');

    let totalDistributions     = 0;
    let processedDistributions = 0;

    for (let i = 0; i < allCMs.length; i++) {
      if (abortSignal?.aborted) {
        updateProgress({ status: 'stopped', endTime: new Date() });
        return progress;
      }

      const { txnId, txnNum } = allCMs[i];

      if (verbose) log?.('info', `[${i + 1}/${allCMs.length}] Distributions for CM ${txnNum} (ID: ${txnId})`);

      const distResult = await fetchCreditMemoDistributionsFromOracle(txnId, log);

      if (!distResult.success) {
        log?.('error', `  ✗ Failed to fetch distributions for ${txnNum}: ${distResult.error}`);
        continue;
      }

      if (distResult.items.length === 0) {
        if (verbose) log?.('info', `  No distributions for ${txnNum} — skipping`);
        continue;
      }

      totalDistributions += distResult.items.length;
      updateProgress({ totalDistributions });

      const distInsertResult = await insertCreditMemoDistributionsToApex(distResult.items, txnId, log);

      if (distInsertResult.success) {
        processedDistributions += distInsertResult.successCount;
        updateProgress({ processedDistributions });
        if (verbose) log?.('success', `  ✓ ${distInsertResult.successCount} distributions inserted for ${txnNum}`);
      } else {
        updateProgress({ errors: progress.errors + 1, lastError: distInsertResult.error || 'Distributions insert failed' });
        log?.('error', `  ✗ Distributions failed for ${txnNum}: ${distInsertResult.error}`);
      }

      if (i < allCMs.length - 1) await new Promise(r => setTimeout(r, 50));
    }

    const finalStatus = abortSignal?.aborted ? 'stopped' : 'completed';
    updateProgress({
      status: finalStatus,
      endTime: new Date(),
      processedCreditMemos: allCMs.length,
      insertedCreditMemos: inserted,
      updatedCreditMemos: updated,
    });

    log?.('step', '═══════════════════════════════════════════════════════════');
    log?.(finalStatus === 'completed' ? 'success' : 'warning',
      `  DONE — ${allCMs.length} CMs | Headers: ${inserted} ins/${updated} upd | Lines: ${processedLines}/${totalLines} | Dists: ${processedDistributions}/${totalDistributions} | Errors: ${progress.errors}`
    );
    log?.('step', '═══════════════════════════════════════════════════════════');

  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    log?.('error', `Sync failed: ${msg}`);
    updateProgress({ status: 'error', lastError: msg, endTime: new Date() });
  }

  return progress;
};
