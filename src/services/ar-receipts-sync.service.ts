import { ORACLE_FUSION_CONFIG, APEX_DB_CONFIG } from '../config/api.config';
import { fetchFromOracle, insertToApex } from './sync-http';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ARReceiptsSyncProgress {
  status: 'idle' | 'fetching' | 'inserting' | 'completed' | 'error' | 'stopped';
  totalReceipts: number;
  processedReceipts: number;
  insertedReceipts: number;
  updatedReceipts: number;
  currentPage: number;
  totalPages: number;
  errors: number;
  lastError: string;
  startTime: Date | null;
  endTime: Date | null;
}

export type LogCallback = (type: 'info' | 'success' | 'error' | 'warning' | 'step', message: string) => void;
export type ARReceiptsProgressCallback = (progress: Partial<ARReceiptsSyncProgress>) => void;

const APEX_AR_RECEIPTS_BULK_ENDPOINT = 'ar/receipts/bulk';

// ─── Oracle Fetch ─────────────────────────────────────────────────────────────

const fetchARReceiptsFromOracle = async (
  params: Record<string, string>,
  log?: LogCallback,
  verbose = true
): Promise<{ success: boolean; items: any[]; hasMore: boolean; totalResults?: number; error?: string }> => {
  try {
    log?.('step', `──── [GET] Oracle Fusion AR Receipts (offset=${params.offset ?? 0}, limit=${params.limit}) ────`);

    const data = await fetchFromOracle('standardReceipts', params, log, verbose);

    log?.('info', `  Oracle response: ${(data.items || []).length} items, hasMore=${data.hasMore}, totalResults=${data.totalResults ?? data.count ?? 'N/A'}`);

    return {
      success: true,
      items: data.items || [],
      hasMore: data.hasMore || false,
      totalResults: data.totalResults || data.count,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    log?.('error', `Fetch Error: ${errorMsg}`);
    return { success: false, items: [], hasMore: false, error: errorMsg };
  }
};

// ─── APEX Insert ──────────────────────────────────────────────────────────────

const insertARReceiptsToApex = async (
  receipts: any[],
  log?: LogCallback,
  verbose = true
): Promise<{ success: boolean; inserted: number; updated: number; error?: string }> => {
  try {
    const payload = {
      items: receipts.map(r => {
        const { links, ...rest } = r as any;
        return rest;
      }),
    };

    const fullUrl = `${APEX_DB_CONFIG.baseUrl}/${APEX_AR_RECEIPTS_BULK_ENDPOINT}`;
    if (verbose) {
      log?.('step', `──── [POST] APEX AR Receipts (${receipts.length} records) ────`);
      log?.('info', `  URL: ${fullUrl}`);
      log?.('info', JSON.stringify(payload, null, 2));
    }

    const data = await insertToApex(APEX_AR_RECEIPTS_BULK_ENDPOINT, payload, log, verbose);

    if (verbose) {
      log?.('step', '──── POST RESPONSE ────');
      log?.('success', JSON.stringify(data, null, 2));
    }

    const isSuccess = data.status === 'SUCCESS';
    return {
      success: isSuccess,
      inserted: data.inserted ?? (isSuccess ? receipts.length : 0),
      updated:  data.updated  ?? 0,
      error: isSuccess ? undefined : (data.message || data.error || 'Insert failed'),
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    log?.('error', `POST Error: ${errorMsg}`);
    return { success: false, inserted: 0, updated: 0, error: errorMsg };
  }
};

// ─── Test Connection ──────────────────────────────────────────────────────────

export const testARReceiptsConnection = async (log?: LogCallback): Promise<boolean> => {
  try {
    log?.('info', 'Testing Oracle Fusion AR Receipts connection...');
    const result = await fetchARReceiptsFromOracle({ limit: '1', offset: '0' }, log, true);
    if (result.success) {
      log?.('success', 'Oracle Fusion AR Receipts connection successful!');
      log?.('info', `Sample data: ${result.items?.length ?? 0} receipts`);
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

export const syncARReceipts = async (
  parameters: Record<string, string>,
  testMode: boolean | 'single' = true,
  log?: LogCallback,
  onProgress?: ARReceiptsProgressCallback,
  abortSignal?: AbortSignal
): Promise<ARReceiptsSyncProgress> => {
  const progress: ARReceiptsSyncProgress = {
    status: 'idle',
    totalReceipts: 0,
    processedReceipts: 0,
    insertedReceipts: 0,
    updatedReceipts: 0,
    currentPage: 0,
    totalPages: 0,
    errors: 0,
    lastError: '',
    startTime: new Date(),
    endTime: null,
  };

  const updateProgress = (updates: Partial<ARReceiptsSyncProgress>) => {
    Object.assign(progress, updates);
    onProgress?.(updates);
  };

  let pageSize: number;
  let maxRecords: number | null;

  if (testMode === 'single') {
    pageSize = 1;
    maxRecords = 1;
  } else if (testMode === true) {
    pageSize = 25;
    maxRecords = 25;
  } else {
    pageSize = 500;
    maxRecords = null;
  }

  const verbose = testMode !== false;
  const modeLabel = testMode === 'single'
    ? 'SINGLE RECORD DEBUG'
    : (testMode ? 'TEST MODE (25 receipts)' : 'FULL SYNC (all receipts)');

  try {
    updateProgress({ status: 'fetching' });

    log?.('step', '═══════════════════════════════════════════════════════════');
    log?.('step', `  AR RECEIPTS SYNC - ${modeLabel}`);
    log?.('step', '═══════════════════════════════════════════════════════════');
    log?.('info', '  │ FUSION (Source):');
    log?.('info', `  │   GET  ${ORACLE_FUSION_CONFIG.baseUrl}/standardReceipts`);
    log?.('info', '  │ APEX (Target):');
    log?.('info', `  │   POST ${APEX_DB_CONFIG.baseUrl}/${APEX_AR_RECEIPTS_BULK_ENDPOINT}`);
    log?.('step', '═══════════════════════════════════════════════════════════');

    // ── STEP 1: Fetch Receipts from Oracle ────────────────────────────────────
    let allReceipts: any[] = [];
    let currentPage = 0;
    let hasMore = true;

    while (hasMore && (maxRecords === null || allReceipts.length < maxRecords) && !abortSignal?.aborted) {
      currentPage++;
      updateProgress({ currentPage });

      const offset = (currentPage - 1) * pageSize;
      const fetchLimit = maxRecords !== null
        ? Math.min(pageSize, maxRecords - allReceipts.length)
        : pageSize;

      if (verbose) log?.('info', `Page ${currentPage}: offset=${offset}, limit=${fetchLimit}`);

      const queryParams: Record<string, string> = {
        limit: String(fetchLimit),
        offset: String(offset),
      };

      // Build filter from parameters
      const filters = Object.entries(parameters)
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}=${v}`)
        .join(';');
      if (filters) queryParams.q = filters;

      const result = await fetchARReceiptsFromOracle(queryParams, log, verbose);

      if (!result.success) {
        updateProgress({ status: 'error', lastError: result.error || 'Failed to fetch AR receipts', endTime: new Date() });
        return progress;
      }

      if (result.items.length === 0) {
        if (verbose) log?.('info', 'No more receipts to fetch');
        hasMore = false;
        break;
      }

      allReceipts = [...allReceipts, ...result.items];
      hasMore = result.items.length > 0 && (result.hasMore === true || result.items.length === fetchLimit);
      if (maxRecords !== null && allReceipts.length >= maxRecords) hasMore = false;

      log?.('info', `Page ${currentPage}: ${result.items.length} receipts fetched (Total: ${allReceipts.length}, hasMore: ${hasMore})`);

      if (hasMore) await new Promise(r => setTimeout(r, 100));
    }

    updateProgress({ totalReceipts: allReceipts.length, totalPages: currentPage });
    log?.('success', `Total AR receipts fetched: ${allReceipts.length}`);

    if (allReceipts.length === 0) {
      updateProgress({ status: 'completed', endTime: new Date() });
      log?.('warning', 'No AR receipts found for the given parameters');
      return progress;
    }

    // ── STEP 2: Insert Receipts in Batches ────────────────────────────────────
    updateProgress({ status: 'inserting' });
    log?.('step', '═══════════════════════════════════════════════════════════');
    log?.('step', '  STEP 2: Inserting AR Receipts to APEX');
    log?.('step', '═══════════════════════════════════════════════════════════');

    const batchSize = 50;
    let insertedReceipts = 0;
    let updatedReceipts = 0;

    for (let i = 0; i < allReceipts.length; i += batchSize) {
      if (abortSignal?.aborted) {
        updateProgress({ status: 'stopped', endTime: new Date() });
        log?.('warning', 'Sync stopped by user');
        return progress;
      }

      const batch = allReceipts.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(allReceipts.length / batchSize);

      log?.('info', `Inserting batch ${batchNum}/${totalBatches} (${batch.length} receipts)`);

      const insertResult = await insertARReceiptsToApex(batch, log, verbose);

      if (insertResult.success) {
        insertedReceipts += insertResult.inserted;
        updatedReceipts  += insertResult.updated;
        updateProgress({
          insertedReceipts,
          updatedReceipts,
          processedReceipts: Math.min(i + batch.length, allReceipts.length),
        });
        log?.('success', `✓ Batch ${batchNum}: ${insertResult.inserted} inserted, ${insertResult.updated} updated`);
      } else {
        updateProgress({
          errors: progress.errors + 1,
          lastError: insertResult.error || 'Batch insert failed',
          processedReceipts: Math.min(i + batch.length, allReceipts.length),
        });
        log?.('error', `✗ Batch ${batchNum} failed: ${insertResult.error}`);
      }

      if (i + batchSize < allReceipts.length) await new Promise(r => setTimeout(r, 50));
    }

    // ── COMPLETE ──────────────────────────────────────────────────────────────
    updateProgress({
      status: abortSignal?.aborted ? 'stopped' : 'completed',
      endTime: new Date(),
      processedReceipts: allReceipts.length,
      insertedReceipts,
      updatedReceipts,
    });

    log?.('success', `✓ AR Receipts Sync completed: ${insertedReceipts} inserted, ${updatedReceipts} updated`);
    if (progress.errors > 0) log?.('warning', `⚠ ${progress.errors} errors occurred`);

    return progress;

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    updateProgress({ status: 'error', lastError: errorMsg, endTime: new Date() });
    log?.('error', `AR Receipts Sync failed: ${errorMsg}`);
    return progress;
  }
};
