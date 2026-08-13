import { ORACLE_FUSION_CONFIG, APEX_DB_CONFIG } from '../config/api.config';
import { fetchFromOracle, insertToApex } from './sync-http';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ARAdjSyncProgress {
  status: 'idle' | 'fetching' | 'inserting' | 'completed' | 'error' | 'stopped';
  totalAdjustments:    number;
  processedAdjustments: number;
  insertedAdjustments: number;
  updatedAdjustments:  number;
  currentPage:         number;
  totalPages:          number;
  errors:              number;
  lastError:           string;
  startTime:           Date | null;
  endTime:             Date | null;
}

export type LogCallback = (type: 'info' | 'success' | 'error' | 'warning' | 'step', message: string) => void;
export type ARAdjProgressCallback = (progress: Partial<ARAdjSyncProgress>) => void;

const APEX_BULK_ENDPOINT = 'ar/adjustments/bulk';

// ─── Oracle Fetch ─────────────────────────────────────────────────────────────

const fetchAdjustmentsFromOracle = async (
  params: Record<string, string>,
  log?: LogCallback,
  verbose = true
): Promise<{ success: boolean; items: any[]; hasMore: boolean; error?: string }> => {
  try {
    if (verbose) log?.('step', `──── [GET] Oracle Fusion AR Adjustments (offset=${params.offset ?? 0}, limit=${params.limit}) ────`);
    const data = await fetchFromOracle('receivablesAdjustments', params, log, verbose);
    if (verbose) log?.('info', `  ${(data.items || []).length} items, hasMore=${data.hasMore}`);
    return { success: true, items: data.items || [], hasMore: data.hasMore || false };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    log?.('error', `Fetch error: ${msg}`);
    return { success: false, items: [], hasMore: false, error: msg };
  }
};

// ─── APEX Insert ──────────────────────────────────────────────────────────────

const insertAdjustmentsToApex = async (
  adjustments: any[],
  log?: LogCallback,
  verbose = true
): Promise<{ success: boolean; inserted: number; updated: number; error?: string }> => {
  try {
    const payload = {
      items: adjustments.map(a => {
        const { links, ...rest } = a as any;
        return rest;
      }),
    };

    if (verbose) {
      log?.('step', `──── [POST] APEX AR Adjustments (${adjustments.length} records) ────`);
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
      inserted: data.inserted ?? (isSuccess ? adjustments.length : 0),
      updated:  data.updated  ?? 0,
      error: isSuccess ? undefined : (data.message || data.error || 'Insert failed'),
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    log?.('error', `POST Error: ${msg}`);
    return { success: false, inserted: 0, updated: 0, error: msg };
  }
};

// ─── Test Connection ──────────────────────────────────────────────────────────

export const testARAdjConnection = async (log?: LogCallback): Promise<boolean> => {
  try {
    log?.('info', 'Testing Oracle Fusion AR Adjustments connection...');
    const result = await fetchAdjustmentsFromOracle({ limit: '1', offset: '0' }, log, true);
    if (result.success) {
      log?.('success', `Oracle Fusion AR Adjustments connection successful! Sample: ${result.items.length} record(s)`);
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

export const syncARAdj = async (
  parameters: Record<string, string>,
  testMode: boolean | 'single' = true,
  log?: LogCallback,
  onProgress?: ARAdjProgressCallback,
  abortSignal?: AbortSignal
): Promise<ARAdjSyncProgress> => {
  const progress: ARAdjSyncProgress = {
    status: 'idle',
    totalAdjustments: 0, processedAdjustments: 0,
    insertedAdjustments: 0, updatedAdjustments: 0,
    currentPage: 0, totalPages: 0,
    errors: 0, lastError: '',
    startTime: new Date(), endTime: null,
  };

  const updateProgress = (updates: Partial<ARAdjSyncProgress>) => {
    Object.assign(progress, updates);
    onProgress?.(updates);
  };

  const pageSize   = testMode === 'single' ? 1 : testMode === true ? 25 : 500;
  const maxRecords = testMode === 'single' ? 1 : testMode === true ? 25 : null;
  const verbose    = testMode !== false;
  const modeLabel  = testMode === 'single'
    ? 'SINGLE RECORD DEBUG'
    : testMode ? 'TEST MODE (25 adjustments)' : 'FULL SYNC (all adjustments)';

  try {
    updateProgress({ status: 'fetching' });

    log?.('step', '═══════════════════════════════════════════════════════════');
    log?.('step', `  AR ADJUSTMENTS SYNC — ${modeLabel}`);
    log?.('step', '═══════════════════════════════════════════════════════════');
    log?.('info', `  │ FUSION : GET  ${ORACLE_FUSION_CONFIG.baseUrl}/receivablesAdjustments`);
    log?.('info', `  │ APEX   : POST ${APEX_DB_CONFIG.baseUrl}/${APEX_BULK_ENDPOINT}`);
    log?.('step', '═══════════════════════════════════════════════════════════');

    // ── STEP 1: Fetch from Oracle ─────────────────────────────────────────────
    let all: any[] = [];
    let currentPage = 0;
    let hasMore = true;

    while (hasMore && (maxRecords === null || all.length < maxRecords) && !abortSignal?.aborted) {
      currentPage++;
      updateProgress({ currentPage });

      const offset = (currentPage - 1) * pageSize;
      const fetchLimit = maxRecords !== null ? Math.min(pageSize, maxRecords - all.length) : pageSize;

      const queryParams: Record<string, string> = {
        limit:  String(fetchLimit),
        offset: String(offset),
      };

      // Build q filter from parameters (BusinessUnit, Status, AdjustmentType, etc.)
      const filters = Object.entries(parameters)
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}=${v}`)
        .join(';');
      if (filters) queryParams.q = filters;

      const result = await fetchAdjustmentsFromOracle(queryParams, log, verbose);

      if (!result.success) {
        updateProgress({ status: 'error', lastError: result.error || 'Fetch failed', endTime: new Date() });
        return progress;
      }

      if (result.items.length === 0) { hasMore = false; break; }

      all = [...all, ...result.items];
      hasMore = result.hasMore && (maxRecords === null || all.length < maxRecords);

      if (hasMore) await new Promise(r => setTimeout(r, 100));
    }

    updateProgress({ totalAdjustments: all.length, totalPages: currentPage });
    log?.('success', `Total adjustments fetched: ${all.length}`);

    if (all.length === 0) {
      updateProgress({ status: 'completed', endTime: new Date() });
      log?.('warning', 'No adjustments found for the given parameters');
      return progress;
    }

    // ── STEP 2: Insert in Batches ─────────────────────────────────────────────
    updateProgress({ status: 'inserting' });

    const batchSize = 50;
    let inserted = 0;
    let updated  = 0;

    for (let i = 0; i < all.length; i += batchSize) {
      if (abortSignal?.aborted) {
        updateProgress({ status: 'stopped', endTime: new Date() });
        return progress;
      }

      const batch    = all.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;
      const total    = Math.ceil(all.length / batchSize);

      log?.('info', `Inserting batch ${batchNum}/${total} (${batch.length} records)`);

      const r = await insertAdjustmentsToApex(batch, log, verbose);

      if (r.success) {
        inserted += r.inserted;
        updated  += r.updated;
        updateProgress({
          insertedAdjustments: inserted,
          updatedAdjustments:  updated,
          processedAdjustments: Math.min(i + batch.length, all.length),
        });
        log?.('success', `✓ Batch ${batchNum}: ${r.inserted} inserted, ${r.updated} updated`);
      } else {
        updateProgress({
          errors: progress.errors + 1,
          lastError: r.error || 'Batch insert failed',
          processedAdjustments: Math.min(i + batch.length, all.length),
        });
        log?.('error', `✗ Batch ${batchNum} failed: ${r.error}`);
      }

      if (i + batchSize < all.length) await new Promise(r => setTimeout(r, 50));
    }

    const finalStatus = abortSignal?.aborted ? 'stopped' : 'completed';
    updateProgress({ status: finalStatus, endTime: new Date(), processedAdjustments: all.length, insertedAdjustments: inserted, updatedAdjustments: updated });

    log?.('step', '═══════════════════════════════════════════════════════════');
    log?.(finalStatus === 'completed' ? 'success' : 'warning',
      `  DONE — ${all.length} adjustments | Inserted: ${inserted} | Updated: ${updated} | Errors: ${progress.errors}`
    );
    log?.('step', '═══════════════════════════════════════════════════════════');

  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    log?.('error', `Sync failed: ${msg}`);
    updateProgress({ status: 'error', lastError: msg, endTime: new Date() });
  }

  return progress;
};
