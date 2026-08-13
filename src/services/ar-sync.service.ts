import { ORACLE_FUSION_CONFIG, APEX_DB_CONFIG } from '../config/api.config';
import { fetchFromOracle, fetchAllFromOracleUrl, insertToApex } from './sync-http';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ARSyncProgress {
  status: 'idle' | 'fetching' | 'inserting' | 'completed' | 'error' | 'stopped';
  totalInvoices: number;
  processedInvoices: number;
  insertedInvoices: number;
  currentInvoiceNumber: string;
  totalLines: number;
  processedLines: number;
  totalInstallments: number;
  processedInstallments: number;
  totalDistributions: number;
  processedDistributions: number;
  currentPage: number;
  totalPages: number;
  errors: number;
  lastError: string;
  startTime: Date | null;
  endTime: Date | null;
}

export type LogCallback = (type: 'info' | 'success' | 'error' | 'warning' | 'step', message: string) => void;
export type ARProgressCallback = (progress: Partial<ARSyncProgress>) => void;

const APEX_AR_INVOICES_ENDPOINT = 'ar/invoices/bulk';

// ─── Oracle Fetch ─────────────────────────────────────────────────────────────

const fetchARInvoicesFromOracle = async (
  params: Record<string, string>,
  log?: LogCallback,
  verbose = true
): Promise<{ success: boolean; items: any[]; hasMore: boolean; totalResults?: number; error?: string }> => {
  try {
    log?.('step', `──── [GET] Oracle Fusion AR Invoices (offset=${params.offset ?? 0}, limit=${params.limit}) ────`);

    const data = await fetchFromOracle('receivablesInvoices', params, log, verbose);

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

const fetchARInvoiceLinesFromOracle = async (
  customerTransactionId: number,
  log?: LogCallback,
): Promise<{ success: boolean; items: any[]; error?: string }> => {
  try {
    const url = `${ORACLE_FUSION_CONFIG.baseUrl}/receivablesInvoices/${customerTransactionId}/child/receivablesInvoiceLines`;

    log?.('step', `──── [GET] Oracle Fusion AR Invoice Lines (Txn: ${customerTransactionId}) ────`);
    log?.('info', `  URL: ${url}`);

    const items = await fetchAllFromOracleUrl(url, log, true, 500);

    log?.('success', `  Fetched ${items.length} lines for Transaction ${customerTransactionId}`);
    log?.('step', '──── GET RESPONSE (Invoice Lines) ────');
    log?.('info', JSON.stringify({ count: items.length, items }, null, 2));

    return { success: true, items };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    log?.('error', `Fetch Lines Error: ${errorMsg}`);
    return { success: false, items: [], error: errorMsg };
  }
};

// ─── APEX Insert ──────────────────────────────────────────────────────────────

const insertARInvoicesToApex = async (
  invoices: any[],
  log?: LogCallback,
  verbose = true
): Promise<{ success: boolean; successCount: number; error?: string }> => {
  try {
    const payload = { items: invoices.map(inv => {
      const { links, ...rest } = inv as any;
      return rest;
    }) };

    if (verbose) {
      log?.('step', `──── [POST] APEX AR Invoices (${invoices.length} records) ────`);
      log?.('info', JSON.stringify(payload, null, 2));
    }

    const data = await insertToApex(APEX_AR_INVOICES_ENDPOINT, payload, log, verbose);

    if (verbose) {
      log?.('step', '──── POST RESPONSE ────');
      log?.('success', JSON.stringify(data, null, 2));
    }

    const isSuccess = data.status === 'SUCCESS';
    return {
      success: isSuccess,
      successCount: data.successCount ?? (isSuccess ? invoices.length : 0),
      error: isSuccess ? undefined : (data.message || data.error || 'Insert failed'),
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    log?.('error', `POST Error: ${errorMsg}`);
    return { success: false, successCount: 0, error: errorMsg };
  }
};

const fetchARInstallmentsFromOracle = async (
  customerTransactionId: number,
  log?: LogCallback,
): Promise<{ success: boolean; items: any[]; error?: string }> => {
  try {
    const url = `${ORACLE_FUSION_CONFIG.baseUrl}/receivablesInvoices/${customerTransactionId}/child/receivablesInvoiceInstallments`;

    log?.('step', `──── [GET] Oracle Fusion AR Installments (Txn: ${customerTransactionId}) ────`);
    log?.('info', `  URL: ${url}`);

    const items = await fetchAllFromOracleUrl(url, log, false, 500);

    log?.('success', `  Fetched ${items.length} installments for Transaction ${customerTransactionId}`);

    return { success: true, items };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    log?.('error', `Fetch Installments Error: ${errorMsg}`);
    return { success: false, items: [], error: errorMsg };
  }
};

const insertARInstallmentsToApex = async (
  installments: any[],
  customerTransactionId: number,
  log?: LogCallback,
): Promise<{ success: boolean; successCount: number; error?: string }> => {
  try {
    const endpoint = `ar/invoices/${customerTransactionId}/installments`;
    const payload = { items: installments.map(inst => {
      const { links, ...rest } = inst as any;
      return rest;
    }) };

    const fullUrl = `${APEX_DB_CONFIG.baseUrl}/${endpoint}`;
    log?.('step', `──── [POST] APEX AR Installments for Txn ${customerTransactionId} (${installments.length} installments) ────`);
    log?.('info', `  URL: ${fullUrl}`);
    log?.('info', `  Payload: ${JSON.stringify(payload, null, 2)}`);

    const data = await insertToApex(endpoint, payload, log, false);
    log?.('info', `  Response: ${JSON.stringify(data)}`);

    const isSuccess = data.status === 'SUCCESS';
    return {
      success: isSuccess,
      successCount: data.successCount ?? (isSuccess ? installments.length : 0),
      error: isSuccess ? undefined : (data.message || data.error || 'Installments insert failed'),
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    log?.('error', `POST Installments Error: ${errorMsg}`);
    return { success: false, successCount: 0, error: errorMsg };
  }
};

const fetchARDistributionsFromOracle = async (
  customerTransactionId: number,
  log?: LogCallback,
): Promise<{ success: boolean; items: any[]; error?: string }> => {
  try {
    const url = `${ORACLE_FUSION_CONFIG.baseUrl}/receivablesInvoices/${customerTransactionId}/child/receivablesInvoiceDistributions`;

    log?.('step', `──── [GET] Oracle Fusion AR Distributions (Txn: ${customerTransactionId}) ────`);
    log?.('info', `  URL: ${url}`);

    const items = await fetchAllFromOracleUrl(url, log, false, 500);

    log?.('success', `  Fetched ${items.length} distributions for Transaction ${customerTransactionId}`);

    return { success: true, items };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    log?.('error', `Fetch Distributions Error: ${errorMsg}`);
    return { success: false, items: [], error: errorMsg };
  }
};

const insertARDistributionsToApex = async (
  distributions: any[],
  customerTransactionId: number,
  log?: LogCallback,
): Promise<{ success: boolean; successCount: number; error?: string }> => {
  try {
    const endpoint = `ar/invoices/${customerTransactionId}/distributions`;
    const payload = { items: distributions.map(dist => {
      const { links, ...rest } = dist as any;
      return rest;
    }) };

    const fullUrl = `${APEX_DB_CONFIG.baseUrl}/${endpoint}`;
    log?.('step', `──── [POST] APEX AR Distributions for Txn ${customerTransactionId} (${distributions.length} distributions) ────`);
    log?.('info', `  URL: ${fullUrl}`);
    log?.('info', `  Payload: ${JSON.stringify(payload, null, 2)}`);

    const data = await insertToApex(endpoint, payload, log, false);
    log?.('info', `  Response: ${JSON.stringify(data)}`);

    const isSuccess = data.status === 'SUCCESS';
    return {
      success: isSuccess,
      successCount: data.successCount ?? (isSuccess ? distributions.length : 0),
      error: isSuccess ? undefined : (data.message || data.error || 'Distributions insert failed'),
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    log?.('error', `POST Distributions Error: ${errorMsg}`);
    return { success: false, successCount: 0, error: errorMsg };
  }
};

const insertARLinesToApex = async (
  lines: any[],
  customerTransactionId: number,
  log?: LogCallback,
): Promise<{ success: boolean; successCount: number; error?: string }> => {
  try {
    // Use the correct per-invoice lines endpoint: ar/invoices/:id/lines
    const linesEndpoint = `ar/invoices/${customerTransactionId}/lines`;
    const payload = { items: lines.map(line => {
      const { links, ...rest } = line as any;
      return rest;
    }) };

    log?.('step', `──── [POST] APEX AR Lines for Txn ${customerTransactionId} (${lines.length} lines) ────`);
    log?.('info', `  URL: ${APEX_DB_CONFIG.baseUrl}/${linesEndpoint}`);
    log?.('step', '──── POST PAYLOAD (Invoice Lines) ────');
    log?.('info', JSON.stringify(payload, null, 2));

    const data = await insertToApex(linesEndpoint, payload, log, true);

    log?.('step', '──── POST RESPONSE (Invoice Lines) ────');
    log?.('success', JSON.stringify(data, null, 2));

    const isSuccess = data.status === 'SUCCESS';
    return {
      success: isSuccess,
      successCount: data.successCount ?? (isSuccess ? lines.length : 0),
      error: isSuccess ? undefined : (data.message || data.error || 'Lines insert failed'),
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    log?.('error', `POST Lines Error: ${errorMsg}`);
    return { success: false, successCount: 0, error: errorMsg };
  }
};

// ─── Test Connection ──────────────────────────────────────────────────────────

export const testARConnection = async (log?: LogCallback): Promise<boolean> => {
  try {
    log?.('info', 'Testing Oracle Fusion AR Invoices connection...');
    const result = await fetchARInvoicesFromOracle({ limit: '1', offset: '0' }, log, true);
    if (result.success) {
      log?.('success', 'Oracle Fusion AR connection successful!');
      log?.('info', `Sample data: ${result.items?.length ?? 0} invoices`);
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

export const syncARInvoices = async (
  parameters: Record<string, string>,
  testMode: boolean | 'single' = true,
  log?: LogCallback,
  onProgress?: ARProgressCallback,
  abortSignal?: AbortSignal
): Promise<ARSyncProgress> => {
  const progress: ARSyncProgress = {
    status: 'idle',
    totalInvoices: 0,
    processedInvoices: 0,
    insertedInvoices: 0,
    currentInvoiceNumber: '',
    totalLines: 0,
    processedLines: 0,
    totalInstallments: 0,
    processedInstallments: 0,
    totalDistributions: 0,
    processedDistributions: 0,
    currentPage: 0,
    totalPages: 0,
    errors: 0,
    lastError: '',
    startTime: new Date(),
    endTime: null,
  };

  const updateProgress = (updates: Partial<ARSyncProgress>) => {
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
    pageSize = 500;  // Full sync: 500 per page
    maxRecords = null;
  }

  const verbose = testMode !== false;
  const modeLabel = testMode === 'single' ? 'SINGLE RECORD DEBUG' : (testMode ? 'TEST MODE (25 invoices)' : 'FULL SYNC (all invoices)');

  try {
    updateProgress({ status: 'fetching' });

    log?.('step', '═══════════════════════════════════════════════════════════');
    log?.('step', `  AR INVOICES SYNC - ${modeLabel}`);
    log?.('step', '═══════════════════════════════════════════════════════════');
    log?.('info', '  │ FUSION (Source):');
    log?.('info', `  │   GET  ${ORACLE_FUSION_CONFIG.baseUrl}/receivablesInvoices`);
    log?.('info', '  │ APEX (Target):');
    log?.('info', `  │   POST ${APEX_DB_CONFIG.baseUrl}/${APEX_AR_INVOICES_ENDPOINT}`);
    log?.('info', `  │   Installments:   ${APEX_DB_CONFIG.baseUrl}/ar/invoices/:id/installments`);
    log?.('step', '═══════════════════════════════════════════════════════════');

    // ── STEP 1: Fetch AR Invoices ──────────────────────────────────────────────
    let allInvoices: any[] = [];
    let currentPage = 0;
    let hasMore = true;

    while (hasMore && (maxRecords === null || allInvoices.length < maxRecords) && !abortSignal?.aborted) {
      currentPage++;
      updateProgress({ currentPage });

      const offset = (currentPage - 1) * pageSize;
      const fetchLimit = maxRecords !== null
        ? Math.min(pageSize, maxRecords - allInvoices.length)
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

      const result = await fetchARInvoicesFromOracle(queryParams, log, verbose);

      if (!result.success) {
        updateProgress({ status: 'error', lastError: result.error || 'Failed to fetch AR invoices', endTime: new Date() });
        return progress;
      }

      if (result.items.length === 0) {
        if (verbose) log?.('info', 'No more invoices to fetch');
        hasMore = false;
        break;
      }

      allInvoices = [...allInvoices, ...result.items];
      // Continue if: got a full page OR Oracle explicitly says hasMore
      // (don't rely solely on hasMore flag — some Fusion endpoints omit it on the last page)
      hasMore = result.items.length > 0 && (result.hasMore === true || result.items.length === fetchLimit);
      if (maxRecords !== null && allInvoices.length >= maxRecords) hasMore = false;

      log?.('info', `Page ${currentPage}: ${result.items.length} invoices fetched (Total so far: ${allInvoices.length}, hasMore: ${hasMore})`);

      if (hasMore) await new Promise(r => setTimeout(r, 100));
    }

    updateProgress({ totalInvoices: allInvoices.length, totalPages: currentPage });
    log?.('success', `Total AR invoices fetched: ${allInvoices.length}`);

    if (allInvoices.length === 0) {
      updateProgress({ status: 'completed', endTime: new Date() });
      log?.('warning', 'No AR invoices found for the given parameters');
      return progress;
    }

    // ── STEP 2: Insert Invoices in Batches ────────────────────────────────────
    updateProgress({ status: 'inserting' });
    log?.('step', '═══════════════════════════════════════════════════════════');
    log?.('step', '  STEP 2: Inserting AR Invoices to APEX');
    log?.('step', '═══════════════════════════════════════════════════════════');

    const batchSize = 50;
    let insertedInvoices = 0;

    for (let i = 0; i < allInvoices.length; i += batchSize) {
      if (abortSignal?.aborted) {
        updateProgress({ status: 'stopped', endTime: new Date() });
        log?.('warning', 'Sync stopped by user');
        return progress;
      }

      const batch = allInvoices.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(allInvoices.length / batchSize);

      log?.('info', `Inserting batch ${batchNum}/${totalBatches} (${batch.length} invoices)`);

      const insertResult = await insertARInvoicesToApex(batch, log, verbose);

      if (insertResult.success) {
        insertedInvoices += insertResult.successCount;
        updateProgress({ insertedInvoices, processedInvoices: Math.min(i + batch.length, allInvoices.length) });
        log?.('success', `✓ Batch ${batchNum}: ${insertResult.successCount} invoices inserted`);
      } else {
        updateProgress({
          errors: progress.errors + 1,
          lastError: insertResult.error || 'Batch insert failed',
          processedInvoices: Math.min(i + batch.length, allInvoices.length),
        });
        log?.('error', `✗ Batch ${batchNum} failed: ${insertResult.error}`);
      }
    }

    // ── STEP 3: Fetch & Insert Lines per Invoice ───────────────────────────────
    log?.('step', '═══════════════════════════════════════════════════════════');
    log?.('step', '  STEP 3: Fetching and Inserting AR Invoice Lines');
    log?.('step', '═══════════════════════════════════════════════════════════');

    let totalLines = 0;
    let processedLines = 0;

    for (let i = 0; i < allInvoices.length; i++) {
      if (abortSignal?.aborted) {
        updateProgress({ status: 'stopped', endTime: new Date() });
        log?.('warning', 'Sync stopped by user');
        return progress;
      }

      const invoice = allInvoices[i];
      const txnId: number = invoice.CustomerTransactionId;
      const txnNumber: string = invoice.TransactionNumber || String(txnId);

      if (verbose) log?.('info', `[${i + 1}/${allInvoices.length}] Lines for ${txnNumber} (ID: ${txnId})`);

      if (!txnId) {
        if (verbose) log?.('warning', `  Skipping — no CustomerTransactionId`);
        continue;
      }

      const linesResult = await fetchARInvoiceLinesFromOracle(txnId, log);

      if (!linesResult.success) {
        log?.('error', `  ✗ Failed to fetch lines for ${txnNumber}: ${linesResult.error}`);
        continue;
      }

      if (linesResult.items.length === 0) {
        log?.('info', `  No lines found for ${txnNumber} — skipping POST`);
        continue;
      }

      totalLines += linesResult.items.length;
      updateProgress({ totalLines });

      // Batch-insert lines
      const lineBatchSize = 100;
      for (let j = 0; j < linesResult.items.length; j += lineBatchSize) {
        const lineBatch = linesResult.items.slice(j, j + lineBatchSize);
        const lineInsertResult = await insertARLinesToApex(lineBatch, txnId, log);

        if (lineInsertResult.success) {
          processedLines += lineInsertResult.successCount;
          updateProgress({ processedLines });
          if (verbose) log?.('success', `  ✓ ${lineInsertResult.successCount} lines inserted for ${txnNumber}`);
        } else {
          updateProgress({ errors: progress.errors + 1, lastError: lineInsertResult.error || 'Lines insert failed' });
          log?.('error', `  ✗ Lines failed for ${txnNumber}: ${lineInsertResult.error}`);
        }
      }

      if (i < allInvoices.length - 1) await new Promise(r => setTimeout(r, 50));
    }

    // ── STEP 4: Fetch & Insert Installments per Invoice ───────────────────────
    log?.('step', '═══════════════════════════════════════════════════════════');
    log?.('step', '  STEP 4: Fetching and Inserting AR Invoice Installments');
    log?.('step', '═══════════════════════════════════════════════════════════');

    let totalInstallments = 0;
    let processedInstallments = 0;

    for (let i = 0; i < allInvoices.length; i++) {
      if (abortSignal?.aborted) {
        updateProgress({ status: 'stopped', endTime: new Date() });
        log?.('warning', 'Sync stopped by user');
        return progress;
      }

      const invoice = allInvoices[i];
      const txnId: number = invoice.CustomerTransactionId;
      const txnNumber: string = invoice.TransactionNumber || String(txnId);

      if (!txnId) continue;

      if (verbose) log?.('info', `[${i + 1}/${allInvoices.length}] Installments for ${txnNumber} (ID: ${txnId})`);

      const installmentsResult = await fetchARInstallmentsFromOracle(txnId, log);

      if (!installmentsResult.success) {
        log?.('error', `  ✗ Failed to fetch installments for ${txnNumber}: ${installmentsResult.error}`);
        continue;
      }

      if (installmentsResult.items.length === 0) {
        if (verbose) log?.('info', `  No installments found for ${txnNumber} — skipping POST`);
        continue;
      }

      totalInstallments += installmentsResult.items.length;
      updateProgress({ totalInstallments });

      const installmentInsertResult = await insertARInstallmentsToApex(installmentsResult.items, txnId, log);

      if (installmentInsertResult.success) {
        processedInstallments += installmentInsertResult.successCount;
        updateProgress({ processedInstallments });
        if (verbose) log?.('success', `  ✓ ${installmentInsertResult.successCount} installments inserted for ${txnNumber}`);
      } else {
        updateProgress({ errors: progress.errors + 1, lastError: installmentInsertResult.error || 'Installments insert failed' });
        log?.('error', `  ✗ Installments failed for ${txnNumber}: ${installmentInsertResult.error}`);
      }

      if (i < allInvoices.length - 1) await new Promise(r => setTimeout(r, 50));
    }

    // ── STEP 5: Fetch & Insert Distributions per Invoice ──────────────────────
    log?.('step', '═══════════════════════════════════════════════════════════');
    log?.('step', '  STEP 5: Fetching and Inserting AR Invoice Distributions');
    log?.('step', '═══════════════════════════════════════════════════════════');

    let totalDistributions = 0;
    let processedDistributions = 0;

    for (let i = 0; i < allInvoices.length; i++) {
      if (abortSignal?.aborted) {
        updateProgress({ status: 'stopped', endTime: new Date() });
        log?.('warning', 'Sync stopped by user');
        return progress;
      }

      const invoice = allInvoices[i];
      const txnId: number = invoice.CustomerTransactionId;
      const txnNumber: string = invoice.TransactionNumber || String(txnId);

      if (!txnId) continue;

      if (verbose) log?.('info', `[${i + 1}/${allInvoices.length}] Distributions for ${txnNumber} (ID: ${txnId})`);

      const distResult = await fetchARDistributionsFromOracle(txnId, log);

      if (!distResult.success) {
        log?.('error', `  ✗ Failed to fetch distributions for ${txnNumber}: ${distResult.error}`);
        continue;
      }

      if (distResult.items.length === 0) {
        if (verbose) log?.('info', `  No distributions found for ${txnNumber} — skipping POST`);
        continue;
      }

      totalDistributions += distResult.items.length;
      updateProgress({ totalDistributions });

      const distInsertResult = await insertARDistributionsToApex(distResult.items, txnId, log);

      if (distInsertResult.success) {
        processedDistributions += distInsertResult.successCount;
        updateProgress({ processedDistributions });
        if (verbose) log?.('success', `  ✓ ${distInsertResult.successCount} distributions inserted for ${txnNumber}`);
      } else {
        updateProgress({ errors: progress.errors + 1, lastError: distInsertResult.error || 'Distributions insert failed' });
        log?.('error', `  ✗ Distributions failed for ${txnNumber}: ${distInsertResult.error}`);
      }

      if (i < allInvoices.length - 1) await new Promise(r => setTimeout(r, 50));
    }

    // ── COMPLETE ──────────────────────────────────────────────────────────────
    updateProgress({
      status: abortSignal?.aborted ? 'stopped' : 'completed',
      endTime: new Date(),
      processedInvoices: allInvoices.length,
      processedLines,
      totalLines,
      processedInstallments,
      totalInstallments,
      processedDistributions,
      totalDistributions,
    });

    log?.('success', `✓ AR Sync completed: ${progress.insertedInvoices} invoices, ${processedLines} lines, ${processedInstallments} installments, ${processedDistributions} distributions inserted`);
    if (progress.errors > 0) log?.('warning', `⚠ ${progress.errors} errors occurred`);

    return progress;

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    updateProgress({ status: 'error', lastError: errorMsg, endTime: new Date() });
    log?.('error', `AR Sync failed: ${errorMsg}`);
    return progress;
  }
};
