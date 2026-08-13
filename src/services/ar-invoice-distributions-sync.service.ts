import { ORACLE_FUSION_CONFIG, APEX_DB_CONFIG } from '../config/api.config';
import { insertToApex } from './sync-http';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ARDistributionsSyncProgress {
  status: 'idle' | 'fetching' | 'inserting' | 'completed' | 'error' | 'stopped';
  totalInvoices: number;
  processedInvoices: number;
  totalDistributions: number;
  insertedDistributions: number;
  errors: number;
  lastError: string;
  startTime: Date | null;
  endTime: Date | null;
}

export type LogCallback = (type: 'info' | 'success' | 'error' | 'warning' | 'step', message: string) => void;
export type ARDistributionsProgressCallback = (progress: Partial<ARDistributionsSyncProgress>) => void;

// ─── Fetch invoices from APEX (paginated) ─────────────────────────────────────

const fetchInvoicesFromApex = async (
  log?: LogCallback,
  maxInvoices?: number
): Promise<{ CUSTOMER_TRANSACTION_ID: string }[]> => {
  log?.('step', '──── [GET] APEX AR Invoices ────');

  const baseUrl = `${APEX_DB_CONFIG.baseUrl}/ar/invoices`;
  log?.('info', `  URL: ${baseUrl}`);

  const allInvoices: { CUSTOMER_TRANSACTION_ID: string }[] = [];
  let offset = 0;
  const pageSize = 500;
  let hasMore = true;

  while (hasMore) {
    if (maxInvoices !== undefined && allInvoices.length >= maxInvoices) break;

    const url = `${baseUrl}?limit=${pageSize}&offset=${offset}`;
    const resp = await fetch(url, { headers: { Accept: 'application/json' } });

    if (!resp.ok) throw new Error(`APEX invoices fetch failed: ${resp.status} ${resp.statusText}`);

    const data = await resp.json();
    const items: any[] = data.items || [];

    if (allInvoices.length === 0 && items.length > 0) {
      log?.('info', `  APEX invoice fields: ${Object.keys(items[0]).join(', ')}`);
      log?.('info', `  First item sample: ${JSON.stringify(items[0])}`);
    }

    allInvoices.push(...items);
    offset += items.length;
    hasMore = items.length > 0 && (data.hasMore === true || items.length === pageSize);

    if (items.length === 0) break;
  }

  const result = maxInvoices !== undefined ? allInvoices.slice(0, maxInvoices) : allInvoices;
  log?.('info', `  Found ${result.length} invoices`);
  const ids = result.map((inv: any) => inv.customer_transaction_id ?? 'UNKNOWN');
  log?.('info', `  Transaction IDs: ${ids.slice(0, 10).join(', ')}${ids.length > 10 ? ` ... +${ids.length - 10} more` : ''}`);
  return result;
};

// ─── POST distributions to APEX for one invoice ───────────────────────────────

const insertDistributionsToApex = async (
  customerTransactionId: string,
  distributions: any[],
  log?: LogCallback,
  verbose = true
): Promise<{ success: boolean; inserted: number; error?: string }> => {
  try {
    const endpoint = `ar/invoices/${customerTransactionId}/distributions`;
    const payload = {
      items: distributions.map(item => {
        const { links, ...rest } = item as any;
        return rest;
      }),
    };

    if (verbose) {
      log?.('step', `──── [POST] APEX Distributions for invoice ${customerTransactionId} (${distributions.length} records) ────`);
      log?.('info', `  URL: ${APEX_DB_CONFIG.baseUrl}/${endpoint}`);
      log?.('info', JSON.stringify(payload, null, 2));
    }

    const data = await insertToApex(endpoint, payload, log, verbose);

    if (verbose) {
      log?.('step', '──── POST RESPONSE ────');
      log?.('success', JSON.stringify(data, null, 2));
    }

    const isSuccess = data.status === 'SUCCESS';
    return {
      success: isSuccess,
      inserted: data.inserted ?? (isSuccess ? distributions.length : 0),
      error: isSuccess ? undefined : (data.message || data.error || 'Insert failed'),
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    log?.('error', `POST Error: ${msg}`);
    return { success: false, inserted: 0, error: msg };
  }
};

// ─── Main Sync ────────────────────────────────────────────────────────────────

export const syncARDistributions = async (
  parameters: Record<string, string>,
  testMode: boolean | 'single' = true,
  log?: LogCallback,
  onProgress?: ARDistributionsProgressCallback,
  abortSignal?: AbortSignal
): Promise<ARDistributionsSyncProgress> => {
  const progress: ARDistributionsSyncProgress = {
    status: 'idle',
    totalInvoices: 0,
    processedInvoices: 0,
    totalDistributions: 0,
    insertedDistributions: 0,
    errors: 0,
    lastError: '',
    startTime: new Date(),
    endTime: null,
  };

  const updateProgress = (updates: Partial<ARDistributionsSyncProgress>) => {
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
    log?.('step', `  AR INVOICE DISTRIBUTIONS SYNC — ${modeLabel}`);
    log?.('step', '═══════════════════════════════════════════════════════════');
    if (specificTxnId) {
      log?.('info', `  │ CustomerTransactionId filter: ${specificTxnId}`);
      log?.('info', '  │ Skipping APEX invoice list — using provided ID directly');
    } else {
      log?.('info', '  │ Step 1: GET invoices from APEX ar/invoices');
    }
    log?.('info', `  │ Step 2: GET Fusion receivablesInvoices/{id}/child/receivablesInvoiceDistributions`);
    log?.('info', `  │ Step 3: POST APEX ar/invoices/{id}/distributions`);
    log?.('step', '═══════════════════════════════════════════════════════════');

    // ── STEP 1: Get invoice list ──────────────────────────────────────────────
    let invoices: { CUSTOMER_TRANSACTION_ID: string }[];
    if (specificTxnId) {
      invoices = [{ customer_transaction_id: specificTxnId } as any];
    } else {
      invoices = await fetchInvoicesFromApex(log, maxInvoices);
    }
    updateProgress({ totalInvoices: invoices.length });

    if (invoices.length === 0) {
      updateProgress({ status: 'completed', endTime: new Date() });
      log?.('warning', 'No invoices found in APEX');
      return progress;
    }

    log?.('info', `  Processing ${invoices.length} invoice(s)`);

    // ── STEP 2 & 3: For each invoice, fetch distributions then insert ─────────
    let totalDistributions = 0;
    let insertedDistributions = 0;

    for (let i = 0; i < invoices.length; i++) {
      if (abortSignal?.aborted) {
        updateProgress({ status: 'stopped', endTime: new Date() });
        log?.('warning', 'Sync stopped by user');
        return progress;
      }

      const invoice = invoices[i];
      const txnId = (invoice as any).customer_transaction_id
                 ?? (invoice as any).CUSTOMER_TRANSACTION_ID;

      if (!txnId) {
        log?.('warning', `  [${i + 1}/${invoices.length}] Skipping — no customer_transaction_id in: ${JSON.stringify(invoice)}`);
        updateProgress({ processedInvoices: i + 1 });
        continue;
      }

      log?.('info', `\n[${i + 1}/${invoices.length}] Invoice: ${txnId}`);

      // ── GET Fusion distributions ──────────────────────────────────────────────
      const fusionUrl = `${ORACLE_FUSION_CONFIG.baseUrl}/receivablesInvoices/${txnId}/child/receivablesInvoiceDistributions?limit=500&offset=0`;
      log?.('step', `──── [GET] Fusion: ${fusionUrl} ────`);

      let fusionRes: Response;
      let fusionText: string;
      try {
        fusionRes = await fetch(fusionUrl, {
          headers: {
            Authorization: 'Basic ' + btoa(`${ORACLE_FUSION_CONFIG.username}:${ORACLE_FUSION_CONFIG.password}`),
            'Content-Type': 'application/json',
          },
          signal: abortSignal,
        });
        fusionText = await fusionRes.text();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        log?.('error', `  Network error fetching distributions for ${txnId}: ${msg}`);
        updateProgress({ errors: progress.errors + 1, lastError: msg, endTime: new Date(), status: 'error' });
        return progress;
      }

      log?.('info', `  HTTP Status: ${fusionRes.status}`);
      log?.('info', `  Fusion GET Response:\n${fusionText.substring(0, 2000)}`);

      if (!fusionRes.ok) {
        const msg = `Oracle API Error: ${fusionRes.status} — ${fusionText.substring(0, 300)}`;
        log?.('error', `  ✗ ${msg}`);
        updateProgress({ errors: progress.errors + 1, lastError: `Oracle API Error: ${fusionRes.status} —`, status: 'error', endTime: new Date() });
        return progress;
      }

      let fusionJson: { items?: any[]; hasMore?: boolean };
      try {
        fusionJson = JSON.parse(fusionText);
      } catch {
        const msg = `Non-JSON response from Fusion for txn ${txnId}`;
        log?.('error', `  ✗ ${msg}`);
        updateProgress({ errors: progress.errors + 1, lastError: msg, status: 'error', endTime: new Date() });
        return progress;
      }

      const distributions: any[] = fusionJson.items || [];
      log?.('success', `  Found ${distributions.length} distribution(s)`);
      totalDistributions += distributions.length;
      updateProgress({ totalDistributions });

      if (distributions.length === 0) {
        updateProgress({ processedInvoices: i + 1 });
        continue;
      }

      // ── POST to APEX ──────────────────────────────────────────────────────────
      const apexEndpoint = `ar/invoices/${txnId}/distributions`;
      const apexUrl = `${APEX_DB_CONFIG.baseUrl}/${apexEndpoint}`;
      const apexPayload = { items: distributions.map(({ links, ...rest }: any) => rest) };
      log?.('step', `──── [POST] APEX: ${apexUrl} ────`);
      log?.('info', `  POST Body:\n${JSON.stringify(apexPayload, null, 2).substring(0, 2000)}`);

      updateProgress({ status: 'inserting' });
      const insertResult = await insertDistributionsToApex(txnId, distributions, log, verbose);
      updateProgress({ status: 'fetching' });

      if (insertResult.success) {
        insertedDistributions += insertResult.inserted;
        updateProgress({ insertedDistributions });
        if (verbose) log?.('success', `  ✓ Invoice ${txnId}: ${insertResult.inserted} distributions inserted`);
      } else {
        updateProgress({ errors: progress.errors + 1, lastError: insertResult.error || 'Insert failed' });
        log?.('error', `  ✗ Invoice ${txnId} failed: ${insertResult.error}`);
      }

      updateProgress({ processedInvoices: i + 1 });
    }

    const finalStatus = abortSignal?.aborted ? 'stopped' : 'completed';
    updateProgress({ status: finalStatus, endTime: new Date() });

    log?.('step', '═══════════════════════════════════════════════════════════');
    log?.(finalStatus === 'completed' ? 'success' : 'warning',
      `  DONE — ${progress.totalDistributions} distributions | ` +
      `Inserted: ${progress.insertedDistributions} | ` +
      `Errors: ${progress.errors}`
    );
    log?.('step', '═══════════════════════════════════════════════════════════');

  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    log?.('error', `AR Distributions Sync failed: ${msg}`);
    updateProgress({ status: 'error', lastError: msg, endTime: new Date() });
  }

  return progress;
};
