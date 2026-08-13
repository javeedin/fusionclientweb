import { ORACLE_FUSION_CONFIG, APEX_DB_CONFIG } from '../config/api.config';
import { fetchFromOracle, fetchFromOracleUrl, fetchAllFromOracleUrl, insertToApex, fetchFromApex } from './sync-http';

// Handles multiple APEX response formats:
//   {success:true, inserted:N}           — new handlers (11_fix_gl_sync_rest_handlers.sql)
//   {status:"SUCCESS", syncedCount:N}    — currently deployed handler
//   {success:true, successCount:N}       — old HTP.P handler
const apexOk = (r: any): boolean =>
  r?.success === true ||
  r?.inserted > 0 ||
  r?.syncedCount > 0 ||
  r?.successCount > 0 ||
  r?.status === 'SUCCESS';

const apexErr = (r: any): string =>
  r?.error || r?.lastError || r?.message || (r?.errorCount > 0 ? `${r.errorCount} errors` : 'Insert failed');

// Types
export interface SyncProgress {
  status: 'idle' | 'fetching_batches' | 'processing_batch' | 'fetching_headers' | 'processing_header' | 'fetching_lines' | 'inserting' | 'completed' | 'error' | 'stopped';

  // Batch progress
  totalBatches: number;
  processedBatches: number;
  currentBatchId: number | null;
  currentBatchName: string;

  // Header progress
  totalHeaders: number;
  processedHeaders: number;
  currentHeaderId: number | null;
  currentHeaderName: string;

  // Line progress
  totalLines: number;
  processedLines: number;

  // Totals
  totalBatchesInserted: number;
  totalHeadersInserted: number;
  totalLinesInserted: number;

  // Errors
  errors: number;
  lastError: string;

  // Timing
  startTime: Date | null;
  endTime: Date | null;
}

export type LogCallback = (type: 'info' | 'success' | 'error' | 'warning' | 'step', message: string) => void;
export type ProgressCallback = (progress: Partial<SyncProgress>) => void;
export type BatchPayloadCallback = (batchId: number, batchName: string, payload: any, result?: any, error?: string) => void;

// Extract ID from Oracle Fusion href link
const extractIdFromHref = (href: string): number | null => {
  const matches = href.match(/\/(\d+)(?:\/child\/|$)/g);
  if (matches && matches.length > 0) {
    const lastMatch = matches[matches.length - 1];
    const id = lastMatch.match(/\/(\d+)/);
    return id ? parseInt(id[1], 10) : null;
  }
  return null;
};

// Extract batch ID from href
const extractBatchIdFromHref = (href: string): number | null => {
  const match = href.match(/journalBatches\/(\d+)/);
  return match ? parseInt(match[1], 10) : null;
};

// Extract header ID from href
const extractHeaderIdFromHref = (href: string): number | null => {
  const match = href.match(/journalHeaders\/(\d+)/);
  return match ? parseInt(match[1], 10) : null;
};

// Find child link by name
const findChildLink = (links: any[], linkName: string): string | null => {
  if (!links || !Array.isArray(links)) return null;
  const link = links.find((l: any) => l.name === linkName && l.rel === 'child');
  return link?.href || null;
};


// ── Fetch all GL Journal Batches (Phase 1 only) ──────────────────────────────
export const fetchGLJournalBatches = async (
  parameters: Record<string, string>,
  testMode: boolean | 'single' = false,
  log?: LogCallback,
  abortSignal?: AbortSignal,
): Promise<any[]> => {
  const pageLimit = testMode === 'single'
    ? ORACLE_FUSION_CONFIG.singleRecordLimit
    : (testMode ? ORACLE_FUSION_CONFIG.testLimit : ORACLE_FUSION_CONFIG.defaultLimit);
  const maxRecords = testMode === 'single' ? 1 : (testMode ? 25 : null);

  const filters = Object.entries(parameters)
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}=${value}`)
    .join(';');

  log?.('step', '──── Fetching Journal Batches from Oracle Fusion ────');
  log?.('info', `Parameters: ${JSON.stringify(parameters)}`);

  let batches: any[] = [];
  let offset = 0;
  let hasMore = true;
  let pageNum = 0;

  while (hasMore && (maxRecords === null || batches.length < maxRecords)) {
    if (abortSignal?.aborted) break;
    pageNum++;
    const fetchLimit = maxRecords !== null ? Math.min(pageLimit, maxRecords - batches.length) : pageLimit;
    const batchParams: Record<string, string> = { limit: fetchLimit.toString(), offset: offset.toString() };
    if (filters) batchParams.q = filters;

    const batchResult = await fetchFromOracle('journalBatches', batchParams, log, false);
    const items = batchResult.items || [];
    batches = [...batches, ...items];

    const apiHasMore = batchResult.hasMore === true;
    const gotFullPage = items.length === fetchLimit;
    hasMore = items.length > 0 && (apiHasMore || gotFullPage);
    offset += items.length;
    if (maxRecords !== null && batches.length >= maxRecords) hasMore = false;
  }

  log?.('success', `Fetched ${batches.length} batches across ${pageNum} page(s)`);

  // Annotate each batch with _batchId pre-computed
  return batches.map(b => ({
    ...b,
    _batchId: (() => {
      const link = Array.isArray(b.links) ? b.links.find((l: any) => l.name === 'journalHeaders' && l.rel === 'child') : null;
      const href = link?.href || '';
      const match = href.match(/journalBatches\/(\d+)/);
      return match ? parseInt(match[1], 10) : 0;
    })(),
  }));
};

// ── Process a single batch (headers + lines) ─────────────────────────────────
export interface SingleBatchResult {
  batchId: number;
  batchName: string;
  headersCount: number;
  linesCount: number;
  headersInserted: number;
  linesInserted: number;
  errors: number;
  lastError: string;
}

export const processSingleGLBatch = async (
  batch: any,
  log?: LogCallback,
  abortSignal?: AbortSignal,
): Promise<SingleBatchResult> => {
  const batchId = extractBatchIdFromHref(findChildLink(batch.links, 'journalHeaders') || '') || 0;
  const batchName = batch.JournalBatchName || batch.JournalName || `Batch ${batchId}`;

  const result: SingleBatchResult = {
    batchId, batchName, headersCount: 0, linesCount: 0,
    headersInserted: 0, linesInserted: 0, errors: 0, lastError: '',
  };

  const headersHref = findChildLink(batch.links, 'journalHeaders');
  if (!headersHref) {
    result.errors++;
    result.lastError = 'No journalHeaders link';
    return result;
  }

  // Fetch all headers (with pagination)
  const headers = await fetchAllFromOracleUrl(headersHref, log, false, 500, abortSignal);
  result.headersCount = headers.length;

  // Insert batch record first
  const batchPayload = {
    items: [{
      JeBatchId: batchId,
      AccountedPeriodType: batch.AccountedPeriodType,
      DefaultPeriodName: batch.DefaultPeriodName,
      BatchName: batch.JournalBatchName || batch.JournalName,
      Status: batch.Status,
      ControlTotal: batch.ControlTotal,
      BatchDescription: batch.Description || batch.BatchDescription,
      ErrorMessage: batch.ErrorMessage,
      PostedDate: batch.PostedDate,
      PostingRunId: batch.PostingRunId,
      RequestId: batch.RequestId,
      RunningTotalAccountedCr: batch.RunningTotalAccountedCr,
      RunningTotalAccountedDr: batch.RunningTotalAccountedDr,
      RunningTotalCr: batch.RunningTotalCr,
      RunningTotalDr: batch.RunningTotalDr,
      CreatedBy: batch.CreatedBy,
      CreationDate: batch.CreationDate,
      LastUpdateDate: batch.LastUpdateDate,
      LastUpdatedBy: batch.LastUpdatedBy,
      ActualFlagMeaning: batch.ActualFlagMeaning,
      ApprovalStatusMeaning: batch.ApprovalStatusMeaning,
      ApproverEmployeeName: batch.ApproverEmployeeName,
      FundsStatusMeaning: batch.FundsStatusMeaning,
      ParentJeBatchName: batch.ParentJeBatchName,
      ChartOfAccountsName: batch.ChartOfAccountsName,
      StatusMeaning: batch.StatusMeaning,
      CompletionStatusMeaning: batch.CompletionStatusMeaning,
      UserPeriodSetName: batch.UserPeriodSetName,
      UserJeSourceName: batch.UserJeSourceName,
      ReversalDate: batch.ReversalDate,
      ReversalPeriod: batch.ReversalPeriod,
      ReversalFlag: batch.ReversalFlag,
      ReversalMethodMeaning: batch.ReversalMethodMeaning,
      LedgerId: batch.LedgerId,
      LedgerName: batch.LedgerName,
      JournalName: batch.JournalName,
    }],
  };

  try {
    const batchInsertResult = await insertToApex(APEX_DB_CONFIG.endpoints.journalBatches, batchPayload, log, false);
    if (!apexOk(batchInsertResult)) {
      log?.('warning', `Batch insert warning: ${apexErr(batchInsertResult)}`);
    }
  } catch (e) {
    log?.('warning', `Batch insert error: ${e}`);
  }

  // Process each header
  for (const header of headers) {
    if (abortSignal?.aborted) break;

    const headerId = extractHeaderIdFromHref(findChildLink(header.links, 'journalLines') || '')
      || extractIdFromHref(header.links?.[0]?.href || '')
      || 0;

    // Fetch lines (with pagination)
    const linesHref = findChildLink(header.links, 'journalLines');
    let lines: any[] = [];
    if (linesHref) {
      try {
        lines = await fetchAllFromOracleUrl(linesHref, log, false, 500, abortSignal);
        result.linesCount += lines.length;
      } catch (e) {
        log?.('warning', `Lines fetch error for header ${headerId}: ${e}`);
      }
    }

    // Insert header
    const headerPayload = { batchId, items: [{ JeHeaderId: headerId, ...header }] };
    try {
      const headerResult = await insertToApex(APEX_DB_CONFIG.endpoints.journalHeaders, headerPayload, log, false);
      if (apexOk(headerResult)) {
        result.headersInserted++;
      } else {
        result.errors++;
        result.lastError = apexErr(headerResult);
      }
    } catch (e) {
      result.errors++;
      result.lastError = String(e);
    }

    // Insert lines
    if (lines.length > 0) {
      const linesPayload = { batchId, jeHeaderId: headerId, items: lines };
      try {
        const linesResult = await insertToApex(APEX_DB_CONFIG.endpoints.journalLines, linesPayload, log, false);
        if (apexOk(linesResult)) {
          result.linesInserted += linesResult.inserted ?? linesResult.syncedCount ?? lines.length;
        } else {
          result.errors++;
          result.lastError = apexErr(linesResult);
        }
      } catch (e) {
        result.errors++;
        result.lastError = String(e);
      }
    }

    await new Promise(resolve => setTimeout(resolve, 50)); // small delay
  }

  return result;
};


// Main GL Journal Sync Function
export const syncGLJournals = async (
  parameters: Record<string, string>,
  testMode: boolean | 'single' = true, // true=25, false=full, 'single'=1
  log?: LogCallback,
  onProgress?: ProgressCallback,
  abortSignal?: AbortSignal,
  onBatchPayload?: BatchPayloadCallback
): Promise<SyncProgress> => {
  const progress: SyncProgress = {
    status: 'idle',
    totalBatches: 0,
    processedBatches: 0,
    currentBatchId: null,
    currentBatchName: '',
    totalHeaders: 0,
    processedHeaders: 0,
    currentHeaderId: null,
    currentHeaderName: '',
    totalLines: 0,
    processedLines: 0,
    totalBatchesInserted: 0,
    totalHeadersInserted: 0,
    totalLinesInserted: 0,
    errors: 0,
    lastError: '',
    startTime: new Date(),
    endTime: null,
  };

  const updateProgress = (updates: Partial<SyncProgress>) => {
    Object.assign(progress, updates);
    onProgress?.(progress);
  };

  // Verbose logging only for test/single mode, not full sync
  const verbose = testMode !== false;

  try {
    // ========================================
    // STEP 1: Fetch Journal Batches (with pagination)
    // ========================================
    updateProgress({ status: 'fetching_batches' });
    log?.('step', '═══════════════════════════════════════════════════════════');
    log?.('step', '  STEP 1: Fetching Journal Batches from Oracle Fusion');
    log?.('step', '═══════════════════════════════════════════════════════════');

    const pageLimit = testMode === 'single'
      ? ORACLE_FUSION_CONFIG.singleRecordLimit
      : (testMode ? ORACLE_FUSION_CONFIG.testLimit : ORACLE_FUSION_CONFIG.defaultLimit);

    // For test modes, limit total records; for full sync, fetch all
    const maxRecords = testMode === 'single' ? 1 : (testMode ? 25 : null);

    const modeLabel = testMode === 'single' ? 'SINGLE RECORD DEBUG' : (testMode ? 'TEST MODE (25 batches)' : 'FULL SYNC (all pages)');

    // Build filter parameters
    const filters = Object.entries(parameters)
      .filter(([, value]) => value)
      .map(([key, value]) => `${key}=${value}`)
      .join(';');

    log?.('info', `Parameters: ${JSON.stringify(parameters)}`);
    log?.('info', `Page size: ${pageLimit}, Max records: ${maxRecords ?? 'unlimited'} (${modeLabel})`);
    if (!verbose) {
      log?.('info', 'Full sync mode - detailed logging disabled for performance');
    }

    // ========================================
    // STEP 1a: Count total records first (all pages)
    // ========================================
    log?.('step', '──── Counting total records across all pages ────');

    let totalCount = 0;
    let countOffset = 0;
    let countHasMore = true;
    let countPageNum = 0;

    while (countHasMore) {
      if (abortSignal?.aborted) {
        updateProgress({ status: 'stopped' });
        log?.('warning', 'Sync stopped by user during count');
        break;
      }

      countPageNum++;
      const countParams: Record<string, string> = {
        limit: pageLimit.toString(),
        offset: countOffset.toString(),
        onlyData: 'true',  // Request minimal data for counting
      };

      if (filters) {
        countParams.q = filters;
      }

      log?.('info', `Counting page ${countPageNum} (offset: ${countOffset})...`);

      const countResult = await fetchFromOracle('journalBatches', countParams, log, false);
      const countItems = countResult.items || [];

      totalCount += countItems.length;
      log?.('info', `Page ${countPageNum}: ${countItems.length} records (Running total: ${totalCount})`);

      // Check if there are more records - use both API hasMore and item count
      const apiHasMore = countResult.hasMore === true;
      const gotFullPage = countItems.length === pageLimit;
      countHasMore = apiHasMore || gotFullPage;

      // If we got 0 items, definitely stop
      if (countItems.length === 0) {
        countHasMore = false;
      }

      countOffset += countItems.length;

      // For test modes, stop at maxRecords
      if (maxRecords !== null && totalCount >= maxRecords) {
        totalCount = Math.min(totalCount, maxRecords);
        countHasMore = false;
      }
    }

    log?.('success', `═══ TOTAL RECORDS FOUND: ${totalCount} (across ${countPageNum} pages) ═══`);

    if (totalCount === 0) {
      updateProgress({ status: 'completed', endTime: new Date() });
      log?.('warning', 'No batches found for the given parameters');
      return progress;
    }

    updateProgress({ totalBatches: totalCount });

    // ========================================
    // STEP 1b: Fetch all batches with pagination
    // ========================================
    log?.('step', '──── Fetching all batches for sync ────');

    let batches: any[] = [];
    let offset = 0;
    let hasMore = true;
    let pageNum = 0;

    while (hasMore && (maxRecords === null || batches.length < maxRecords)) {
      if (abortSignal?.aborted) {
        updateProgress({ status: 'stopped' });
        log?.('warning', 'Sync stopped by user during batch fetch');
        break;
      }

      pageNum++;
      const fetchLimit = maxRecords !== null
        ? Math.min(pageLimit, maxRecords - batches.length)
        : pageLimit;

      const batchParams: Record<string, string> = {
        limit: fetchLimit.toString(),
        offset: offset.toString(),
      };

      if (filters) {
        batchParams.q = filters;
      }

      log?.('info', `Fetching page ${pageNum}/${countPageNum} (offset: ${offset}, limit: ${fetchLimit})...`);

      const batchResult = await fetchFromOracle('journalBatches', batchParams, log, verbose);
      const items = batchResult.items || [];

      batches = [...batches, ...items];

      log?.('success', `Page ${pageNum}: fetched ${items.length} batches (Total: ${batches.length}/${totalCount})`);

      // Check if there are more records - use both API hasMore and item count
      const apiHasMore = batchResult.hasMore === true;
      const gotFullPage = items.length === fetchLimit;
      hasMore = apiHasMore || gotFullPage;

      // If we got 0 items, definitely stop
      if (items.length === 0) {
        hasMore = false;
      }

      offset += items.length;

      // Stop if we've reached maxRecords limit
      if (maxRecords !== null && batches.length >= maxRecords) {
        hasMore = false;
      }

      updateProgress({ processedBatches: batches.length, totalBatches: totalCount });
    }

    log?.('success', `Total batches fetched: ${batches.length} (${pageNum} page${pageNum > 1 ? 's' : ''})`);

    if (batches.length === 0) {
      updateProgress({ status: 'completed', endTime: new Date() });
      log?.('warning', 'No batches found for the given parameters');
      return progress;
    }

    // ========================================
    // STEP 2: Process Each Batch
    // ========================================
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      if (abortSignal?.aborted) {
        updateProgress({ status: 'stopped' });
        log?.('warning', 'Sync stopped by user');
        break;
      }

      const batch = batches[batchIndex];
      const batchId = extractBatchIdFromHref(findChildLink(batch.links, 'journalHeaders') || '') || (batchIndex + 1);

      updateProgress({
        status: 'processing_batch',
        currentBatchId: batchId,
        currentBatchName: batch.JournalName || `Batch ${batchIndex + 1}`,
        processedBatches: batchIndex,
      });

      // In full sync, only log every 10th batch or first/last for high-level progress
      const shouldLogBatch = verbose || batchIndex === 0 || batchIndex === batches.length - 1 || (batchIndex + 1) % 10 === 0;

      if (shouldLogBatch) {
        log?.('info', `Processing Batch ${batchIndex + 1}/${batches.length}: ${batch.JournalName || 'Unnamed'}`);
      }

      // Find journalHeaders child link
      const headersHref = findChildLink(batch.links, 'journalHeaders');
      if (!headersHref) {
        log?.('warning', `No journalHeaders link found for batch ${batchId}`);
        continue;
      }

      // ========================================
      // STEP 2a: Fetch Headers for this Batch
      // ========================================
      updateProgress({ status: 'fetching_headers' });

      const headers = await fetchAllFromOracleUrl(headersHref, log, verbose, 500, abortSignal);

      updateProgress({ totalHeaders: progress.totalHeaders + headers.length });
      if (verbose) {
        log?.('success', `Found ${headers.length} headers in this batch`);
      }

      // ========================================
      // STEP 2b: Process Each Header
      // ========================================
      for (let headerIndex = 0; headerIndex < headers.length; headerIndex++) {
        if (abortSignal?.aborted) {
          updateProgress({ status: 'stopped' });
          break;
        }

        const header = headers[headerIndex];
        const headerId = extractHeaderIdFromHref(findChildLink(header.links, 'journalLines') || '') || extractIdFromHref(header.links?.[0]?.href || '') || (headerIndex + 1);

        updateProgress({
          status: 'processing_header',
          currentHeaderId: headerId,
          currentHeaderName: header.JournalName || `Header ${headerIndex + 1}`,
          processedHeaders: progress.processedHeaders,
        });

        if (verbose) {
          log?.('info', `  Header ${headerIndex + 1}/${headers.length}: ${header.JournalName || 'Unnamed'} (ID: ${headerId})`);
        }

        // Find journalLines child link
        const linesHref = findChildLink(header.links, 'journalLines');

        // ========================================
        // STEP 2c: Fetch Lines for this Header
        // ========================================
        let lines: any[] = [];
        if (linesHref) {
          updateProgress({ status: 'fetching_lines' });

          try {
            lines = await fetchAllFromOracleUrl(linesHref, log, verbose, 500, abortSignal);

            updateProgress({ totalLines: progress.totalLines + lines.length });
            if (verbose) {
              log?.('success', `    Found ${lines.length} lines`);
            }
          } catch (error) {
            log?.('warning', `    Could not fetch lines: ${error}`);
          }
        }

        // ========================================
        // STEP 2d: Insert Header to APEX
        // ========================================
        updateProgress({ status: 'inserting' });

        // Prepare header payload with batchId and JeHeaderId
        const headerPayload = {
          batchId: batchId,
          items: [{
            JeHeaderId: headerId,
            ...header,
          }],
        };

        try {
          const headerInsertResult = await insertToApex(APEX_DB_CONFIG.endpoints.journalHeaders, headerPayload, log, verbose);
          if (apexOk(headerInsertResult)) {
            updateProgress({ totalHeadersInserted: progress.totalHeadersInserted + 1 });
            if (verbose) {
              log?.('success', `    ✓ Header inserted`);
            }
          } else {
            updateProgress({ errors: progress.errors + 1, lastError: apexErr(headerInsertResult) });
            log?.('error', `    ✗ Header insert failed: ${apexErr(headerInsertResult)}`);
          }
        } catch (error) {
          updateProgress({ errors: progress.errors + 1, lastError: String(error) });
        }

        // ========================================
        // STEP 2e: Insert Lines to APEX
        // ========================================
        if (lines.length > 0) {
          const linesPayload = {
            batchId: batchId,
            jeHeaderId: headerId,
            items: lines,
          };

          try {
            const linesInsertResult = await insertToApex(APEX_DB_CONFIG.endpoints.journalLines, linesPayload, log, verbose);
            if (apexOk(linesInsertResult)) {
              const insertedCount = linesInsertResult.inserted ?? linesInsertResult.syncedCount ?? lines.length;
              updateProgress({ totalLinesInserted: progress.totalLinesInserted + insertedCount });
              if (verbose) {
                log?.('success', `    ✓ ${insertedCount} lines inserted`);
              }
            } else {
              updateProgress({ errors: progress.errors + 1, lastError: apexErr(linesInsertResult) });
              log?.('error', `    ✗ Lines insert failed: ${apexErr(linesInsertResult)}`);
            }
          } catch (error) {
            updateProgress({ errors: progress.errors + 1, lastError: String(error) });
          }
        }

        updateProgress({ processedHeaders: progress.processedHeaders + 1 });

        // Small delay to prevent API throttling
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // ========================================
      // STEP 2f: Insert Batch to APEX
      // ========================================
      if (verbose) {
        log?.('step', '──── Inserting Batch to APEX ────');
      }

      // Build batch payload with all fields from Oracle Fusion response
      const batchPayload = {
        items: [{
          JeBatchId: batchId,
          AccountedPeriodType: batch.AccountedPeriodType,
          DefaultPeriodName: batch.DefaultPeriodName,
          BatchName: batch.JournalBatchName || batch.JournalName,
          Status: batch.Status,
          ControlTotal: batch.ControlTotal,
          BatchDescription: batch.Description || batch.BatchDescription,
          ErrorMessage: batch.ErrorMessage,
          PostedDate: batch.PostedDate,
          PostingRunId: batch.PostingRunId,
          RequestId: batch.RequestId,
          RunningTotalAccountedCr: batch.RunningTotalAccountedCr,
          RunningTotalAccountedDr: batch.RunningTotalAccountedDr,
          RunningTotalCr: batch.RunningTotalCr,
          RunningTotalDr: batch.RunningTotalDr,
          CreatedBy: batch.CreatedBy,
          CreationDate: batch.CreationDate,
          LastUpdateDate: batch.LastUpdateDate,
          LastUpdatedBy: batch.LastUpdatedBy,
          ActualFlagMeaning: batch.ActualFlagMeaning,
          ApprovalStatusMeaning: batch.ApprovalStatusMeaning,
          ApproverEmployeeName: batch.ApproverEmployeeName,
          FundsStatusMeaning: batch.FundsStatusMeaning,
          ParentJeBatchName: batch.ParentJeBatchName,
          ChartOfAccountsName: batch.ChartOfAccountsName,
          StatusMeaning: batch.StatusMeaning,
          CompletionStatusMeaning: batch.CompletionStatusMeaning,
          UserPeriodSetName: batch.UserPeriodSetName,
          UserJeSourceName: batch.UserJeSourceName,
          ReversalDate: batch.ReversalDate,
          ReversalPeriod: batch.ReversalPeriod,
          ReversalFlag: batch.ReversalFlag,
          ReversalMethodMeaning: batch.ReversalMethodMeaning,
          // Legacy field names for backwards compatibility
          LedgerId: batch.LedgerId,
          LedgerName: batch.LedgerName,
          JournalName: batch.JournalName,
        }],
      };

      try {
        const batchName = batch.JournalBatchName || batch.JournalName || `Batch ${batchId}`;

        // Only track batch payloads in verbose mode (test/single) to avoid memory overhead
        if (verbose) {
          onBatchPayload?.(batchId, batchName, batchPayload);
        }

        const batchInsertResult = await insertToApex(APEX_DB_CONFIG.endpoints.journalBatches, batchPayload, log, verbose);
        if (apexOk(batchInsertResult)) {
          updateProgress({ totalBatchesInserted: progress.totalBatchesInserted + 1 });
          if (verbose) {
            log?.('success', `  ✓ Batch inserted to APEX`);
            onBatchPayload?.(batchId, batchName, batchPayload, batchInsertResult);
          }
        } else {
          const errorMsg = apexErr(batchInsertResult);
          updateProgress({ errors: progress.errors + 1, lastError: errorMsg });
          log?.('error', `  ✗ Batch insert failed: ${errorMsg}`);
          if (verbose) {
            onBatchPayload?.(batchId, batchName, batchPayload, batchInsertResult, errorMsg);
          }
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        updateProgress({ errors: progress.errors + 1, lastError: errorMsg });
        log?.('error', `  ✗ Batch insert error: ${error}`);
        if (verbose) {
          const batchName = batch.JournalBatchName || batch.JournalName || `Batch ${batchId}`;
          onBatchPayload?.(batchId, batchName, batchPayload, undefined, errorMsg);
        }
      }

      updateProgress({ processedBatches: batchIndex + 1 });

      // Log batch completion - in full sync only log every 10th or last batch
      if (shouldLogBatch) {
        log?.('success', `✓ Batch ${batchIndex + 1}/${batches.length} completed`);
      }

      // Small delay between batches
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    // ========================================
    // COMPLETE
    // ========================================
    updateProgress({
      status: abortSignal?.aborted ? 'stopped' : 'completed',
      endTime: new Date(),
    });

    log?.('step', '═══════════════════════════════════════════════════════════');
    log?.('step', '  SYNC COMPLETED');
    log?.('step', '═══════════════════════════════════════════════════════════');
    log?.('success', `Total Batches Processed: ${progress.processedBatches}`);
    log?.('success', `Total Headers Inserted: ${progress.totalHeadersInserted}`);
    log?.('success', `Total Lines Inserted: ${progress.totalLinesInserted}`);
    log?.('info', `Errors: ${progress.errors}`);

    return progress;

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    updateProgress({
      status: 'error',
      lastError: errorMsg,
      endTime: new Date(),
    });
    log?.('error', `Sync failed: ${errorMsg}`);
    return progress;
  }
};

// Test connection
export const testGLConnection = async (log?: LogCallback): Promise<boolean> => {
  try {
    log?.('info', 'Testing Oracle Fusion connection...');

    const result = await fetchFromOracle('journalBatches', { limit: '1', offset: '0' }, log);

    if (result.success) {
      log?.('success', 'Oracle Fusion connection successful!');
      log?.('info', `Sample data available: ${result.items?.length || 0} items`);
      return true;
    }

    log?.('error', 'Connection test failed');
    return false;
  } catch (error) {
    log?.('error', `Connection test error: ${error}`);
    return false;
  }
};

// ============================================================
// GL BATCHES ONLY SYNC (Simplified - no headers/lines)
// ============================================================
export interface BatchOnlySyncProgress {
  status: 'idle' | 'counting' | 'fetching' | 'inserting' | 'completed' | 'error' | 'stopped';
  totalBatches: number;
  fetchedBatches: number;
  insertedBatches: number;
  currentPage: number;
  totalPages: number;
  errors: number;
  lastError: string;
  startTime: Date | null;
  endTime: Date | null;
}

export const syncGLBatchesOnly = async (
  parameters: Record<string, string>,
  testMode: boolean | 'single' = true,
  log?: LogCallback,
  onProgress?: (progress: BatchOnlySyncProgress) => void,
  abortSignal?: AbortSignal
): Promise<BatchOnlySyncProgress> => {
  const progress: BatchOnlySyncProgress = {
    status: 'idle',
    totalBatches: 0,
    fetchedBatches: 0,
    insertedBatches: 0,
    currentPage: 0,
    totalPages: 0,
    errors: 0,
    lastError: '',
    startTime: new Date(),
    endTime: null,
  };

  const updateProgress = (updates: Partial<BatchOnlySyncProgress>) => {
    Object.assign(progress, updates);
    onProgress?.(progress);
  };

  const pageLimit = testMode === 'single'
    ? ORACLE_FUSION_CONFIG.singleRecordLimit
    : (testMode ? ORACLE_FUSION_CONFIG.testLimit : ORACLE_FUSION_CONFIG.defaultLimit);

  const maxRecords = testMode === 'single' ? 1 : (testMode ? 25 : null);
  const modeLabel = testMode === 'single' ? 'SINGLE RECORD' : (testMode ? 'TEST (25)' : 'FULL SYNC');

  // Build filter parameters
  const filters = Object.entries(parameters)
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}=${value}`)
    .join(';');

  try {
    log?.('step', '═══════════════════════════════════════════════════════════');
    log?.('step', `  GL BATCHES ONLY SYNC - ${modeLabel}`);
    log?.('step', '═══════════════════════════════════════════════════════════');
    log?.('info', `Parameters: ${JSON.stringify(parameters)}`);
    log?.('info', `Page size: ${pageLimit}, Max records: ${maxRecords ?? 'unlimited'}`);

    // ========================================
    // STEP 1: Count total batches (all pages)
    // ========================================
    updateProgress({ status: 'counting' });
    log?.('step', '──── Step 1: Counting total batches ────');

    let totalCount = 0;
    let countOffset = 0;
    let countHasMore = true;
    let countPageNum = 0;

    while (countHasMore) {
      if (abortSignal?.aborted) {
        updateProgress({ status: 'stopped' });
        log?.('warning', 'Stopped by user during count');
        return progress;
      }

      countPageNum++;
      const countParams: Record<string, string> = {
        limit: pageLimit.toString(),
        offset: countOffset.toString(),
        onlyData: 'true',
      };
      if (filters) countParams.q = filters;

      log?.('info', `Counting page ${countPageNum} (offset: ${countOffset})...`);
      const result = await fetchFromOracle('journalBatches', countParams, log, false);
      const items = result.items || [];

      totalCount += items.length;
      log?.('info', `Page ${countPageNum}: ${items.length} batches (Total: ${totalCount})`);

      countHasMore = (result.hasMore === true) || (items.length === pageLimit);
      if (items.length === 0) countHasMore = false;
      countOffset += items.length;

      if (maxRecords !== null && totalCount >= maxRecords) {
        totalCount = Math.min(totalCount, maxRecords);
        countHasMore = false;
      }
    }

    updateProgress({ totalBatches: totalCount, totalPages: countPageNum });
    log?.('success', `═══ TOTAL BATCHES: ${totalCount} (${countPageNum} pages) ═══`);

    if (totalCount === 0) {
      updateProgress({ status: 'completed', endTime: new Date() });
      log?.('warning', 'No batches found');
      return progress;
    }

    // ========================================
    // STEP 2: Fetch and Insert Batches
    // ========================================
    updateProgress({ status: 'fetching' });
    log?.('step', '──── Step 2: Fetching and inserting batches ────');

    let offset = 0;
    let hasMore = true;
    let pageNum = 0;

    while (hasMore && (maxRecords === null || progress.fetchedBatches < maxRecords)) {
      if (abortSignal?.aborted) {
        updateProgress({ status: 'stopped' });
        log?.('warning', 'Stopped by user');
        break;
      }

      pageNum++;
      const fetchLimit = maxRecords !== null
        ? Math.min(pageLimit, maxRecords - progress.fetchedBatches)
        : pageLimit;

      const batchParams: Record<string, string> = {
        limit: fetchLimit.toString(),
        offset: offset.toString(),
      };
      if (filters) batchParams.q = filters;

      log?.('info', `Fetching page ${pageNum}/${countPageNum} (offset: ${offset})...`);
      const result = await fetchFromOracle('journalBatches', batchParams, log, false);
      const batches = result.items || [];

      updateProgress({ currentPage: pageNum, fetchedBatches: progress.fetchedBatches + batches.length });
      log?.('success', `Fetched ${batches.length} batches (Total: ${progress.fetchedBatches}/${totalCount})`);

      // Insert batches to APEX
      updateProgress({ status: 'inserting' });

      // Track per-batch results for test-mode summary
      type BatchResult = { index: number; batchId: number | string; name: string; status: 'ok' | 'fail'; detail: string };
      const batchResults: BatchResult[] = [];

      for (let i = 0; i < batches.length; i++) {
        if (abortSignal?.aborted) break;

        const batch = batches[i];
        const batchId = extractBatchIdFromHref(findChildLink(batch.links, 'journalHeaders') || '') || (offset + i + 1);
        const batchName = batch.JournalBatchName || batch.JournalName || `Batch ${batchId}`;
        const globalIndex = offset + i + 1;

        // ── Per-batch fetch log (test mode only) ──────────────────────
        if (testMode === true) {
          log?.('info',
            `[${globalIndex}/${totalCount}] FETCH → ID: ${batchId} | "${batchName}" | ` +
            `Period: ${batch.DefaultPeriodName || '—'} | Status: ${batch.StatusMeaning || batch.Status || '—'} | ` +
            `Source: ${batch.UserJeSourceName || '—'}`
          );
        }

        const batchPayload = {
          items: [{
            JeBatchId: batchId,
            AccountedPeriodType: batch.AccountedPeriodType,
            DefaultPeriodName: batch.DefaultPeriodName,
            BatchName: batchName,
            Status: batch.Status,
            ControlTotal: batch.ControlTotal,
            BatchDescription: batch.Description || batch.BatchDescription,
            ErrorMessage: batch.ErrorMessage,
            PostedDate: batch.PostedDate,
            PostingRunId: batch.PostingRunId,
            RequestId: batch.RequestId,
            RunningTotalAccountedCr: batch.RunningTotalAccountedCr,
            RunningTotalAccountedDr: batch.RunningTotalAccountedDr,
            RunningTotalCr: batch.RunningTotalCr,
            RunningTotalDr: batch.RunningTotalDr,
            CreatedBy: batch.CreatedBy,
            CreationDate: batch.CreationDate,
            LastUpdateDate: batch.LastUpdateDate,
            LastUpdatedBy: batch.LastUpdatedBy,
            ActualFlagMeaning: batch.ActualFlagMeaning,
            ApprovalStatusMeaning: batch.ApprovalStatusMeaning,
            ApproverEmployeeName: batch.ApproverEmployeeName,
            FundsStatusMeaning: batch.FundsStatusMeaning,
            ParentJeBatchName: batch.ParentJeBatchName,
            ChartOfAccountsName: batch.ChartOfAccountsName,
            StatusMeaning: batch.StatusMeaning,
            CompletionStatusMeaning: batch.CompletionStatusMeaning,
            UserPeriodSetName: batch.UserPeriodSetName,
            UserJeSourceName: batch.UserJeSourceName,
            ReversalDate: batch.ReversalDate,
            ReversalPeriod: batch.ReversalPeriod,
            ReversalFlag: batch.ReversalFlag,
            ReversalMethodMeaning: batch.ReversalMethodMeaning,
            LedgerId: batch.LedgerId,
            LedgerName: batch.LedgerName,
            JournalName: batch.JournalName,
          }],
        };

        try {
          const insertResult = await insertToApex(APEX_DB_CONFIG.endpoints.journalBatches, batchPayload, log, false);
          if (apexOk(insertResult)) {
            updateProgress({ insertedBatches: progress.insertedBatches + 1 });
            if (testMode === true) {
              const n = insertResult.inserted ?? insertResult.syncedCount ?? insertResult.successCount ?? 1;
              log?.('success', `[${globalIndex}/${totalCount}] ✓ INSERTED — ID: ${batchId} "${batchName}" (synced: ${n})`);
              batchResults.push({ index: globalIndex, batchId, name: batchName, status: 'ok', detail: `synced: ${n}` });
            }
          } else {
            const err = apexErr(insertResult);
            updateProgress({ errors: progress.errors + 1, lastError: err });
            if (testMode === true) {
              log?.('error', `[${globalIndex}/${totalCount}] ✗ FAILED   — ID: ${batchId} "${batchName}" → ${err}`);
              log?.('warning', `    APEX Response: ${JSON.stringify(insertResult)}`);
              batchResults.push({ index: globalIndex, batchId, name: batchName, status: 'fail', detail: err });
            } else {
              log?.('error', `Batch ${batchId} insert failed: ${err}`);
            }
          }
        } catch (error) {
          const err = String(error);
          updateProgress({ errors: progress.errors + 1, lastError: err });
          if (testMode === true) {
            log?.('error', `[${globalIndex}/${totalCount}] ✗ ERROR    — ID: ${batchId} "${batchName}" → ${err}`);
            batchResults.push({ index: globalIndex, batchId, name: batchName, status: 'fail', detail: err });
          } else {
            log?.('error', `Batch ${batchId} error: ${error}`);
          }
        }

        // Log progress every 50 batches (non-test mode)
        if (testMode !== true && (progress.insertedBatches + progress.errors) % 50 === 0) {
          log?.('info', `Progress: ${progress.insertedBatches} inserted, ${progress.errors} errors`);
        }

        // ── End-of-page summary (test mode, after all batches on this page) ──
        if (testMode === true && i === batches.length - 1 && batchResults.length > 0) {
          const failed = batchResults.filter((r) => r.status === 'fail');
          log?.('step', '══════════════════════════════════════════════════════════');
          log?.('step', `  BATCH SYNC SUMMARY — TEST MODE (${totalCount} records)`);
          log?.('step', '══════════════════════════════════════════════════════════');
          log?.('success', `  Fetched : ${batchResults.length}`);
          log?.('success', `  Inserted: ${batchResults.filter((r) => r.status === 'ok').length}`);
          if (failed.length > 0) {
            log?.('error',   `  Failed  : ${failed.length}`);
            log?.('step', '──── Failed Batches ────');
            failed.forEach((r) => {
              log?.('error', `  [${r.index}] ID: ${r.batchId}  "${r.name}"  →  ${r.detail}`);
            });
          } else {
            log?.('success', `  Failed  : 0  — all batches synced successfully!`);
          }
          log?.('step', '══════════════════════════════════════════════════════════');
        }
      }

      hasMore = (result.hasMore === true) || (batches.length === fetchLimit);
      if (batches.length === 0) hasMore = false;
      offset += batches.length;

      if (maxRecords !== null && progress.fetchedBatches >= maxRecords) {
        hasMore = false;
      }

      updateProgress({ status: 'fetching' });
    }

    // ========================================
    // COMPLETE
    // ========================================
    updateProgress({
      status: abortSignal?.aborted ? 'stopped' : 'completed',
      endTime: new Date(),
    });

    log?.('step', '═══════════════════════════════════════════════════════════');
    log?.('step', '  GL BATCHES SYNC COMPLETED');
    log?.('step', '═══════════════════════════════════════════════════════════');
    log?.('success', `Total Batches: ${totalCount}`);
    log?.('success', `Inserted: ${progress.insertedBatches}`);
    log?.('info', `Errors: ${progress.errors}`);

    return progress;

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    updateProgress({ status: 'error', lastError: errorMsg, endTime: new Date() });
    log?.('error', `Sync failed: ${errorMsg}`);
    return progress;
  }
};

// ============================================================
// GL HEADERS ONLY SYNC
// Flow: APEX GET batches → Fusion GET headers → APEX POST headers
// ============================================================
export interface HeadersOnlySyncProgress {
  status: 'idle' | 'fetching_batches' | 'fetching_headers' | 'inserting' | 'completed' | 'error' | 'stopped';
  totalBatches: number;
  processedBatches: number;
  currentBatchId: number | null;
  totalHeaders: number;
  insertedHeaders: number;
  errors: number;
  lastError: string;
  startTime: Date | null;
  endTime: Date | null;
}

export const syncGLHeadersOnly = async (
  parameters: Record<string, string>,
  testMode: boolean | 'single' = true,
  log?: LogCallback,
  onProgress?: (progress: HeadersOnlySyncProgress) => void,
  abortSignal?: AbortSignal
): Promise<HeadersOnlySyncProgress> => {
  const progress: HeadersOnlySyncProgress = {
    status: 'idle',
    totalBatches: 0,
    processedBatches: 0,
    currentBatchId: null,
    totalHeaders: 0,
    insertedHeaders: 0,
    errors: 0,
    lastError: '',
    startTime: new Date(),
    endTime: null,
  };

  const updateProgress = (updates: Partial<HeadersOnlySyncProgress>) => {
    Object.assign(progress, updates);
    onProgress?.(progress);
  };

  const maxBatches = testMode === 'single' ? 1 : (testMode ? 25 : null);
  const modeLabel = testMode === 'single' ? 'SINGLE BATCH' : (testMode ? 'TEST (25 batches)' : 'FULL SYNC');

  try {
    log?.('step', '═══════════════════════════════════════════════════════════');
    log?.('step', `  GL HEADERS ONLY SYNC - ${modeLabel}`);
    log?.('step', '═══════════════════════════════════════════════════════════');
    log?.('info', `Parameters: ${JSON.stringify(parameters)}`);

    // ========================================
    // STEP 1: Get batch IDs from APEX
    // ========================================
    updateProgress({ status: 'fetching_batches' });
    log?.('step', '──── Step 1: Fetching batch IDs from APEX ────');

    const apexParams: Record<string, string> = {};
    if (parameters.DefaultPeriodName) {
      apexParams.PERIOD_NAME = parameters.DefaultPeriodName;
    }

    const apexResult = await fetchFromApex('SYNC/jebatches', apexParams, log, true);
    let batchIds: number[] = (apexResult.items || []).map((item: any) => item.je_batch_id);

    if (batchIds.length === 0) {
      updateProgress({ status: 'completed', endTime: new Date() });
      log?.('warning', 'No batch IDs found in APEX');
      return progress;
    }

    // Limit batches for test modes
    if (maxBatches !== null && batchIds.length > maxBatches) {
      batchIds = batchIds.slice(0, maxBatches);
      log?.('info', `Limited to ${maxBatches} batches for ${modeLabel}`);
    }

    updateProgress({ totalBatches: batchIds.length });
    log?.('success', `Found ${batchIds.length} batch IDs to process`);

    // ========================================
    // STEP 2: For each batch, fetch headers from Fusion and insert to APEX
    // ========================================
    log?.('step', '──── Step 2: Fetching headers from Fusion & inserting to APEX ────');

    for (let i = 0; i < batchIds.length; i++) {
      if (abortSignal?.aborted) {
        updateProgress({ status: 'stopped' });
        log?.('warning', 'Stopped by user');
        break;
      }

      const batchId = batchIds[i];
      updateProgress({
        status: 'fetching_headers',
        currentBatchId: batchId,
        processedBatches: i,
      });

      log?.('info', `Processing batch ${i + 1}/${batchIds.length} (ID: ${batchId})...`);

      // Fetch headers from Fusion using the batch ID
      // URL pattern: journalBatches/{batchId}/child/journalHeaders
      const headersUrl = `${ORACLE_FUSION_CONFIG.baseUrl}/journalBatches/${batchId}/child/journalHeaders`;

      try {
        const headers = await fetchAllFromOracleUrl(headersUrl, log, false, 500, abortSignal);

        if (headers.length === 0) {
          log?.('info', `  No headers found for batch ${batchId}`);
          updateProgress({ processedBatches: i + 1 });
          continue;
        }

        log?.('success', `  Found ${headers.length} headers for batch ${batchId}`);
        updateProgress({ totalHeaders: progress.totalHeaders + headers.length });

        // Insert each header to APEX
        updateProgress({ status: 'inserting' });
        for (const header of headers) {
          if (abortSignal?.aborted) break;

          // Extract header ID from links
          const headerId = extractHeaderIdFromHref(findChildLink(header.links, 'journalLines') || '')
            || extractIdFromHref(header.links?.[0]?.href || '')
            || 0;

          const headerPayload = {
            batchId: batchId,
            items: [{
              JeHeaderId: headerId,
              ...header,
            }],
          };

          try {
            const insertResult = await insertToApex(APEX_DB_CONFIG.endpoints.journalHeaders, headerPayload, log, false);
            if (apexOk(insertResult)) {
              updateProgress({ insertedHeaders: progress.insertedHeaders + 1 });
            } else {
              updateProgress({ errors: progress.errors + 1, lastError: apexErr(insertResult) });
              log?.('error', `  Header ${headerId} insert failed: ${apexErr(insertResult)}`);
            }
          } catch (error) {
            updateProgress({ errors: progress.errors + 1, lastError: String(error) });
            log?.('error', `  Header ${headerId} error: ${error}`);
          }
        }

        log?.('success', `  ✓ Batch ${batchId}: ${headers.length} headers processed`);

      } catch (error) {
        updateProgress({ errors: progress.errors + 1, lastError: String(error) });
        log?.('error', `  Error fetching headers for batch ${batchId}: ${error}`);
      }

      updateProgress({ processedBatches: i + 1 });

      // Log progress every 10 batches
      if ((i + 1) % 10 === 0 || i === batchIds.length - 1) {
        log?.('info', `Progress: ${i + 1}/${batchIds.length} batches, ${progress.insertedHeaders} headers inserted`);
      }

      // Small delay between batches
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // ========================================
    // COMPLETE
    // ========================================
    updateProgress({
      status: abortSignal?.aborted ? 'stopped' : 'completed',
      endTime: new Date(),
    });

    log?.('step', '═══════════════════════════════════════════════════════════');
    log?.('step', '  GL HEADERS SYNC COMPLETED');
    log?.('step', '═══════════════════════════════════════════════════════════');
    log?.('success', `Total Batches: ${progress.processedBatches}`);
    log?.('success', `Total Headers: ${progress.totalHeaders}`);
    log?.('success', `Inserted: ${progress.insertedHeaders}`);
    log?.('info', `Errors: ${progress.errors}`);

    return progress;

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    updateProgress({ status: 'error', lastError: errorMsg, endTime: new Date() });
    log?.('error', `Sync failed: ${errorMsg}`);
    return progress;
  }
};

// ============================================================
// GL LINES ONLY SYNC
// Flow: APEX GET headers → Fusion GET lines → APEX POST lines
// ============================================================
export interface LinesOnlySyncProgress {
  status: 'idle' | 'fetching_headers' | 'fetching_lines' | 'inserting' | 'completed' | 'error' | 'stopped';
  totalHeaders: number;
  processedHeaders: number;
  currentHeaderId: number | null;
  currentBatchId: number | null;
  totalLines: number;
  insertedLines: number;
  errors: number;
  lastError: string;
  startTime: Date | null;
  endTime: Date | null;
}

export const syncGLLinesOnly = async (
  parameters: Record<string, string>,
  testMode: boolean | 'single' = true,
  log?: LogCallback,
  onProgress?: (progress: LinesOnlySyncProgress) => void,
  abortSignal?: AbortSignal
): Promise<LinesOnlySyncProgress> => {
  const progress: LinesOnlySyncProgress = {
    status: 'idle',
    totalHeaders: 0,
    processedHeaders: 0,
    currentHeaderId: null,
    currentBatchId: null,
    totalLines: 0,
    insertedLines: 0,
    errors: 0,
    lastError: '',
    startTime: new Date(),
    endTime: null,
  };

  const updateProgress = (updates: Partial<LinesOnlySyncProgress>) => {
    Object.assign(progress, updates);
    onProgress?.(progress);
  };

  const maxHeaders = testMode === 'single' ? 1 : (testMode ? 25 : null);
  const modeLabel = testMode === 'single' ? 'SINGLE HEADER' : (testMode ? 'TEST (25 headers)' : 'FULL SYNC');

  try {
    log?.('step', '═══════════════════════════════════════════════════════════');
    log?.('step', `  GL LINES ONLY SYNC - ${modeLabel}`);
    log?.('step', '═══════════════════════════════════════════════════════════');
    log?.('info', `Parameters: ${JSON.stringify(parameters)}`);

    // ========================================
    // STEP 1: Get header IDs and batch IDs from APEX
    // ========================================
    updateProgress({ status: 'fetching_headers' });
    log?.('step', '──── Step 1: Fetching header IDs from APEX ────');

    const apexParams: Record<string, string> = {};
    if (parameters.DefaultPeriodName) {
      apexParams.P_PERIOD_NAME = parameters.DefaultPeriodName;
    }

    const apexResult = await fetchFromApex('sync/journallines', apexParams, log, true);
    let headerRecords: Array<{ je_header_id: number; batch_id: number }> = (apexResult.items || []).map((item: any) => ({
      je_header_id: item.je_header_id,
      batch_id: item.batch_id,
    }));

    if (headerRecords.length === 0) {
      updateProgress({ status: 'completed', endTime: new Date() });
      log?.('warning', 'No header IDs found in APEX');
      return progress;
    }

    // Limit headers for test modes
    if (maxHeaders !== null && headerRecords.length > maxHeaders) {
      headerRecords = headerRecords.slice(0, maxHeaders);
      log?.('info', `Limited to ${maxHeaders} headers for ${modeLabel}`);
    }

    updateProgress({ totalHeaders: headerRecords.length });
    log?.('success', `Found ${headerRecords.length} header IDs to process`);

    // ========================================
    // STEP 2: For each header, fetch lines from Fusion and insert to APEX
    // ========================================
    log?.('step', '──── Step 2: Fetching lines from Fusion & inserting to APEX ────');

    for (let i = 0; i < headerRecords.length; i++) {
      if (abortSignal?.aborted) {
        updateProgress({ status: 'stopped' });
        log?.('warning', 'Stopped by user');
        break;
      }

      const { je_header_id: headerId, batch_id: batchId } = headerRecords[i];
      updateProgress({
        status: 'fetching_lines',
        currentHeaderId: headerId,
        currentBatchId: batchId,
        processedHeaders: i,
      });

      log?.('info', `Processing header ${i + 1}/${headerRecords.length} (Batch: ${batchId}, Header: ${headerId})...`);

      // Fetch lines from Fusion using batch ID and header ID
      // URL pattern: journalBatches/{batch_id}/child/journalHeaders/{je_header_id}/child/journalLines
      const linesUrl = `${ORACLE_FUSION_CONFIG.baseUrl}/journalBatches/${batchId}/child/journalHeaders/${headerId}/child/journalLines`;

      try {
        const lines = await fetchAllFromOracleUrl(linesUrl, log, false, 500, abortSignal);

        if (lines.length === 0) {
          log?.('info', `  No lines found for header ${headerId}`);
          updateProgress({ processedHeaders: i + 1 });
          continue;
        }

        log?.('success', `  Found ${lines.length} lines for header ${headerId}`);
        updateProgress({ totalLines: progress.totalLines + lines.length });

        // Insert lines to APEX
        updateProgress({ status: 'inserting' });

        const linesPayload = {
          batchId: batchId,
          jeHeaderId: headerId,
          items: lines,
        };

        try {
          const insertResult = await insertToApex(APEX_DB_CONFIG.endpoints.journalLines, linesPayload, log, false);
          if (apexOk(insertResult)) {
            const insertedCount = insertResult.inserted ?? insertResult.syncedCount ?? lines.length;
            updateProgress({ insertedLines: progress.insertedLines + insertedCount });
            log?.('success', `  ✓ Header ${headerId}: ${insertedCount} lines inserted`);
          } else {
            updateProgress({ errors: progress.errors + 1, lastError: apexErr(insertResult) });
            log?.('error', `  Lines insert failed: ${apexErr(insertResult)}`);
          }
        } catch (error) {
          updateProgress({ errors: progress.errors + 1, lastError: String(error) });
          log?.('error', `  Lines insert error: ${error}`);
        }

      } catch (error) {
        updateProgress({ errors: progress.errors + 1, lastError: String(error) });
        log?.('error', `  Error fetching lines for header ${headerId}: ${error}`);
      }

      updateProgress({ processedHeaders: i + 1 });

      // Log progress every 10 headers
      if ((i + 1) % 10 === 0 || i === headerRecords.length - 1) {
        log?.('info', `Progress: ${i + 1}/${headerRecords.length} headers, ${progress.insertedLines} lines inserted`);
      }

      // Small delay between headers
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // ========================================
    // COMPLETE
    // ========================================
    updateProgress({
      status: abortSignal?.aborted ? 'stopped' : 'completed',
      endTime: new Date(),
    });

    log?.('step', '═══════════════════════════════════════════════════════════');
    log?.('step', '  GL LINES SYNC COMPLETED');
    log?.('step', '═══════════════════════════════════════════════════════════');
    log?.('success', `Total Headers: ${progress.processedHeaders}`);
    log?.('success', `Total Lines: ${progress.totalLines}`);
    log?.('success', `Inserted: ${progress.insertedLines}`);
    log?.('info', `Errors: ${progress.errors}`);

    return progress;

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    updateProgress({ status: 'error', lastError: errorMsg, endTime: new Date() });
    log?.('error', `Sync failed: ${errorMsg}`);
    return progress;
  }
};
// ── Step-by-step debug exports (GL Journal Full Sync Debug Modal) ─────────────

export interface DebugBatchInfo {
  batchId: number;
  batchName: string;
  status: string;
  period: string;
  ledger: string;
  headersHref: string | null;
  rawBatch: any;
}

export interface DebugHeaderInfo {
  headerId: number;
  headerName: string;
  linesHref: string | null;
  rawHeader: any;
}

export const debugStep1_FetchBatches = async (
  parameters: Record<string, string>,
  log?: LogCallback,
): Promise<{ batches: DebugBatchInfo[]; hasMore: boolean; totalCount: number; rawResponse: any }> => {
  const filters = Object.entries(parameters)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${v}`)
    .join(';');

  const params: Record<string, string> = { limit: '500', offset: '0' };
  if (filters) params.q = filters;

  log?.('step', '── Step 1: Fetch Batches from Oracle Fusion ──');
  log?.('info', `Filter: ${filters || '(none)'}`);

  const raw = await fetchFromOracle('journalBatches', params, log, true);
  const items: any[] = raw.items || [];

  const batches: DebugBatchInfo[] = items.map((b: any) => ({
    batchId: extractBatchIdFromHref(findChildLink(b.links, 'journalHeaders') || '') || 0,
    batchName: b.JournalBatchName || b.JournalName || 'Unnamed',
    status: b.Status || b.StatusMeaning || '',
    period: b.DefaultPeriodName || '',
    ledger: b.LedgerName || '',
    headersHref: findChildLink(b.links, 'journalHeaders'),
    rawBatch: b,
  }));

  log?.('success', `Found ${batches.length} batch(es)${raw.hasMore ? ' — hasMore=true (more pages exist)' : ''}`);
  return { batches, hasMore: raw.hasMore === true, totalCount: batches.length, rawResponse: raw };
};

export const debugStep2_FetchHeaders = async (
  batch: DebugBatchInfo,
  log?: LogCallback,
): Promise<{ headers: DebugHeaderInfo[]; rawItems: any[] }> => {
  if (!batch.headersHref) throw new Error('No journalHeaders link found in batch');

  log?.('step', `── Step 2: Fetch Headers for Batch ${batch.batchId} ──`);
  log?.('info', `Headers URL: ${batch.headersHref}`);

  const rawItems = await fetchAllFromOracleUrl(batch.headersHref, log, true, 500);

  const headers: DebugHeaderInfo[] = rawItems.map((h: any) => ({
    headerId: extractHeaderIdFromHref(findChildLink(h.links, 'journalLines') || '')
      || extractIdFromHref(h.links?.[0]?.href || '') || 0,
    headerName: h.JournalName || 'Unnamed',
    linesHref: findChildLink(h.links, 'journalLines'),
    rawHeader: h,
  }));

  log?.('success', `Found ${headers.length} header(s)`);
  return { headers, rawItems };
};

export const debugStep3_FetchLines = async (
  headers: DebugHeaderInfo[],
  log?: LogCallback,
): Promise<{ headerId: number; headerName: string; lines: any[]; linesHref: string | null }[]> => {
  log?.('step', `── Step 3: Fetch Lines for ${headers.length} Header(s) ──`);
  const results = [];
  for (const h of headers) {
    if (!h.linesHref) {
      log?.('warning', `Header ${h.headerId} (${h.headerName}): no journalLines link`);
      results.push({ headerId: h.headerId, headerName: h.headerName, lines: [], linesHref: null });
      continue;
    }
    log?.('info', `Fetching lines for header ${h.headerId} (${h.headerName})…`);
    const lines = await fetchAllFromOracleUrl(h.linesHref, log, true, 500);
    log?.('success', `  → ${lines.length} line(s)`);
    results.push({ headerId: h.headerId, headerName: h.headerName, lines, linesHref: h.linesHref });
  }
  return results;
};

export const debugStep4_InsertBatch = async (
  batch: DebugBatchInfo,
  log?: LogCallback,
): Promise<{ result: any; payload: any }> => {
  log?.('step', `── Step 4: Insert Batch ${batch.batchId} to APEX ──`);
  const b = batch.rawBatch;
  const payload = {
    items: [{
      JeBatchId: batch.batchId,
      AccountedPeriodType: b.AccountedPeriodType,
      DefaultPeriodName: b.DefaultPeriodName,
      BatchName: b.JournalBatchName || b.JournalName,
      Status: b.Status,
      ControlTotal: b.ControlTotal,
      BatchDescription: b.Description || b.BatchDescription,
      ErrorMessage: b.ErrorMessage,
      PostedDate: b.PostedDate,
      PostingRunId: b.PostingRunId,
      RequestId: b.RequestId,
      RunningTotalAccountedCr: b.RunningTotalAccountedCr,
      RunningTotalAccountedDr: b.RunningTotalAccountedDr,
      RunningTotalCr: b.RunningTotalCr,
      RunningTotalDr: b.RunningTotalDr,
      CreatedBy: b.CreatedBy,
      CreationDate: b.CreationDate,
      LastUpdateDate: b.LastUpdateDate,
      LastUpdatedBy: b.LastUpdatedBy,
      ActualFlagMeaning: b.ActualFlagMeaning,
      ApprovalStatusMeaning: b.ApprovalStatusMeaning,
      LedgerId: b.LedgerId,
      LedgerName: b.LedgerName,
      JournalName: b.JournalName,
    }],
  };
  const result = await insertToApex(APEX_DB_CONFIG.endpoints.journalBatches, payload, log, true);
  log?.(apexOk(result) ? 'success' : 'error', `Batch insert: ${apexOk(result) ? 'OK' : apexErr(result)}`);
  return { result, payload };
};

export const debugStep5_InsertHeaders = async (
  headers: DebugHeaderInfo[],
  batchId: number,
  log?: LogCallback,
): Promise<{ headerId: number; headerName: string; result: any; payload: any; ok: boolean }[]> => {
  log?.('step', `── Step 5: Insert ${headers.length} Header(s) to APEX ──`);
  const results = [];
  for (const h of headers) {
    const payload = { batchId, items: [{ JeHeaderId: h.headerId, ...h.rawHeader }] };
    const res = await insertToApex(APEX_DB_CONFIG.endpoints.journalHeaders, payload, log, true);
    const ok = apexOk(res);
    log?.(ok ? 'success' : 'error', `  Header ${h.headerId} (${h.headerName}): ${ok ? 'OK' : apexErr(res)}`);
    results.push({ headerId: h.headerId, headerName: h.headerName, result: res, payload, ok });
  }
  return results;
};

export const debugStep6_InsertLines = async (
  linesData: { headerId: number; headerName: string; lines: any[] }[],
  batchId: number,
  log?: LogCallback,
): Promise<{ headerId: number; headerName: string; result: any; payload: any; ok: boolean; count: number }[]> => {
  log?.('step', `── Step 6: Insert Lines to APEX ──`);
  const results = [];
  for (const ld of linesData) {
    if (!ld.lines.length) {
      log?.('warning', `  Header ${ld.headerId}: no lines to insert`);
      results.push({ headerId: ld.headerId, headerName: ld.headerName, result: null, payload: null, ok: true, count: 0 });
      continue;
    }
    const payload = { batchId, jeHeaderId: ld.headerId, items: ld.lines };
    const res = await insertToApex(APEX_DB_CONFIG.endpoints.journalLines, payload, log, true);
    const ok = apexOk(res);
    log?.(ok ? 'success' : 'error', `  Header ${ld.headerId} (${ld.headerName}): ${ld.lines.length} lines → ${ok ? 'OK' : apexErr(res)}`);
    results.push({ headerId: ld.headerId, headerName: ld.headerName, result: res, payload, ok, count: ld.lines.length });
  }
  return results;
};
