import { ORACLE_FUSION_CONFIG, APEX_DB_CONFIG } from '../config/api.config';
import { insertToApex } from './sync-http';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ARInvoiceDffProgress {
  status: 'idle' | 'fetching' | 'inserting' | 'completed' | 'error' | 'stopped';
  totalInvoices: number;
  processedInvoices: number;
  totalDff: number;
  insertedDff: number;
  errors: number;
  lastError: string;
  startTime: Date | null;
  endTime: Date | null;
}

export type LogCallback = (type: 'info' | 'success' | 'error' | 'warning' | 'step', message: string) => void;
export type DffProgressCallback = (progress: Partial<ARInvoiceDffProgress>) => void;

// ─── Fetch invoices from APEX (paginated) ────────────────────────────────────

const fetchInvoicesFromApex = async (
  specificTxnId?: string,
  log?: LogCallback
): Promise<string[]> => {
  if (specificTxnId) {
    log?.('info', `  Using provided CustomerTransactionId: ${specificTxnId}`);
    return [specificTxnId];
  }

  log?.('step', '──── [GET] APEX AR Invoices ────');
  const baseUrl = `${APEX_DB_CONFIG.baseUrl}/ar/invoices`;
  log?.('info', `  URL: ${baseUrl}`);

  const ids: string[] = [];
  let offset = 0;
  const pageSize = 500;

  while (true) {
    const url = `${baseUrl}?limit=${pageSize}&offset=${offset}`;
    const resp = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!resp.ok) throw new Error(`APEX invoices fetch failed: ${resp.status}`);

    const data = await resp.json();
    const items: any[] = data.items || [];
    if (items.length === 0) break;

    items.forEach(item => {
      const id = item.customer_transaction_id ?? item.CUSTOMER_TRANSACTION_ID;
      if (id) ids.push(String(id));
    });

    offset += items.length;
    if (!data.hasMore && items.length < pageSize) break;
  }

  log?.('info', `  Found ${ids.length} invoices in APEX`);
  return ids;
};

// ─── Fetch DFF from Fusion for one invoice ───────────────────────────────────

const fetchDffFromFusion = async (
  customerTrxId: string,
  log?: LogCallback,
  verbose = false
): Promise<any[]> => {
  const fusionBase = ORACLE_FUSION_CONFIG.baseUrl;
  const url = `${fusionBase}/receivablesInvoices/${customerTrxId}/child/receivablesInvoiceDFF`;

  if (verbose) log?.('info', `  [GET Fusion DFF] ${url}`);

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (ORACLE_FUSION_CONFIG.username && ORACLE_FUSION_CONFIG.password) {
    headers['Authorization'] = 'Basic ' + btoa(`${ORACLE_FUSION_CONFIG.username}:${ORACLE_FUSION_CONFIG.password}`);
  }

  const resp = await fetch(url, { headers });
  if (resp.status === 404) return [];
  if (!resp.ok) throw new Error(`Fusion DFF fetch failed for ${customerTrxId}: ${resp.status}`);

  const data = await resp.json();
  const items: any[] = data.items || [];

  // Attach the CustomerTrxId to each item
  return items.map(item => ({ ...item, CustomerTrxId: Number(customerTrxId) }));
};

// ─── POST DFF to APEX ────────────────────────────────────────────────────────

const postDffToApex = async (
  dffItems: any[],
  log?: LogCallback,
  verbose = false
): Promise<{ success: boolean; inserted: number; updated: number; error?: string }> => {
  try {
    const endpoint = 'ar/invoices/dff/bulk';
    const payload = { items: dffItems.map(({ links, ...rest }) => rest) };

    if (verbose) {
      log?.('step', `──── [POST] APEX DFF bulk (${dffItems.length} records) ────`);
      log?.('info', `  URL: ${APEX_DB_CONFIG.baseUrl}/${endpoint}`);
      log?.('info', JSON.stringify(payload, null, 2));
    }

    const data = await insertToApex(endpoint, payload, log, verbose);

    if (verbose) {
      log?.('step', '──── POST RESPONSE ────');
      log?.('success', JSON.stringify(data, null, 2));
    }

    const isSuccess = data.status === 'SUCCESS' || data.status === 'PARTIAL';
    if (!isSuccess) {
      log?.('error', '  ── FAILED PAYLOAD ──');
      log?.('error', JSON.stringify(payload, null, 2));
      log?.('error', '  ── RESPONSE ──');
      log?.('error', JSON.stringify(data, null, 2));
    }
    return {
      success: isSuccess,
      inserted: data.inserted ?? 0,
      updated:  data.updated  ?? 0,
      error: isSuccess ? undefined : (data.message || data.error || 'Insert failed'),
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    log?.('error', `POST Error: ${msg}`);
    log?.('error', '  ── FAILED PAYLOAD ──');
    log?.('error', JSON.stringify({ items: dffItems.map(({ links, ...rest }) => rest) }, null, 2));
    return { success: false, inserted: 0, updated: 0, error: msg };
  }
};

// ─── Main Sync ───────────────────────────────────────────────────────────────

export const syncARInvoiceDff = async (
  parameters: Record<string, string>,
  testMode: boolean | 'single' = true,
  log?: LogCallback,
  onProgress?: DffProgressCallback,
  abortSignal?: AbortSignal
): Promise<ARInvoiceDffProgress> => {
  const progress: ARInvoiceDffProgress = {
    status: 'idle',
    totalInvoices: 0,
    processedInvoices: 0,
    totalDff: 0,
    insertedDff: 0,
    errors: 0,
    lastError: '',
    startTime: new Date(),
    endTime: null,
  };

  const updateProgress = (updates: Partial<ARInvoiceDffProgress>) => {
    Object.assign(progress, updates);
    onProgress?.(updates);
  };

  const specificTxnId = parameters['CustomerTransactionId']?.trim() || '';
  const maxInvoices = testMode === 'single' ? 1 : testMode === true ? 5 : undefined;
  const verbose = testMode !== false;
  const modeLabel = specificTxnId
    ? `SINGLE TRANSACTION (${specificTxnId})`
    : testMode === 'single' ? 'SINGLE RECORD DEBUG'
    : testMode ? 'TEST MODE (5 invoices)' : 'FULL SYNC (all invoices)';

  try {
    updateProgress({ status: 'fetching' });

    log?.('step', '═══════════════════════════════════════════════════════════');
    log?.('step', `  AR INVOICE DFF SYNC — ${modeLabel}`);
    log?.('step', '═══════════════════════════════════════════════════════════');
    log?.('info', '  │ Step 1: GET invoices from APEX ar/invoices');
    log?.('info', '  │ Step 2: GET Fusion receivablesInvoices/{id}/child/receivablesInvoiceDFF');
    log?.('info', '  │ Step 3: POST APEX ar/invoices/dff/bulk');
    log?.('step', '───────────────────────────────────────────────────────────');

    // Step 1: get invoice IDs
    let invoiceIds = await fetchInvoicesFromApex(specificTxnId || undefined, log);
    if (maxInvoices !== undefined) invoiceIds = invoiceIds.slice(0, maxInvoices);
    updateProgress({ totalInvoices: invoiceIds.length });

    if (invoiceIds.length === 0) {
      log?.('warning', 'No invoices found — nothing to sync');
      updateProgress({ status: 'completed', endTime: new Date() });
      return progress;
    }

    // Step 2+3: fetch DFF per invoice and batch-post
    updateProgress({ status: 'inserting' });
    const BATCH_SIZE = 50;
    let batch: any[] = [];
    let processedInvoices = 0;

    const flushBatch = async () => {
      if (batch.length === 0) return;
      const result = await postDffToApex(batch, log, verbose);
      if (result.success) {
        updateProgress({ insertedDff: progress.insertedDff + result.inserted + result.updated });
      } else {
        updateProgress({ errors: progress.errors + 1, lastError: result.error || '' });
        log?.('error', `  Batch POST failed: ${result.error}`);
      }
      batch = [];
    };

    for (const txnId of invoiceIds) {
      if (abortSignal?.aborted) {
        log?.('warning', 'Sync stopped by user');
        updateProgress({ status: 'stopped', endTime: new Date() });
        return progress;
      }

      try {
        const dffItems = await fetchDffFromFusion(txnId, log, verbose);
        if (dffItems.length > 0) {
          batch.push(...dffItems);
          updateProgress({ totalDff: progress.totalDff + dffItems.length });
          log?.('info', `  Invoice ${txnId}: ${dffItems.length} DFF record(s)`);
        } else {
          log?.('info', `  Invoice ${txnId}: no DFF`);
        }
      } catch (e: any) {
        updateProgress({ errors: progress.errors + 1, lastError: e.message });
        log?.('error', `  Invoice ${txnId}: ${e.message}`);
      }

      processedInvoices++;
      updateProgress({ processedInvoices });

      if (batch.length >= BATCH_SIZE) await flushBatch();
    }

    await flushBatch();

    const finalStatus = progress.errors === 0 ? 'completed' : 'error';
    updateProgress({ status: finalStatus, endTime: new Date() });

    log?.('step', '───────────────────────────────────────────────────────────');
    log?.(finalStatus === 'completed' ? 'success' : 'warning',
      `  DONE — ${progress.insertedDff} DFF records synced, ${progress.errors} errors`);
    log?.('step', '═══════════════════════════════════════════════════════════');

    return progress;
  } catch (e: any) {
    const msg = e instanceof Error ? e.message : String(e);
    updateProgress({ status: 'error', lastError: msg, endTime: new Date() });
    log?.('error', `Fatal error: ${msg}`);
    return progress;
  }
};
