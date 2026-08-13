import { ORACLE_FUSION_CONFIG, APEX_DB_CONFIG } from '../config/api.config';
import { insertToApex } from './sync-http';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ARInstallmentNotesProgress {
  status: 'idle' | 'fetching' | 'inserting' | 'completed' | 'error' | 'stopped';
  totalInvoices:        number;
  processedInvoices:    number;
  totalInstallments:    number;
  processedInstallments:number;
  totalNotes:           number;
  insertedNotes:        number;
  errors:               number;
  lastError:            string;
  startTime:            Date | null;
  endTime:              Date | null;
}

export type LogCallback          = (type: 'info' | 'success' | 'error' | 'warning' | 'step', message: string) => void;
export type NotesProgressCallback = (progress: Partial<ARInstallmentNotesProgress>) => void;

// ─── Step 1: Fetch invoice IDs from APEX ─────────────────────────────────────

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

// ─── Step 2: Fetch installments from Fusion for one invoice ──────────────────

const fetchInstallmentsFromFusion = async (
  customerTrxId: string,
  log?: LogCallback,
  verbose = false
): Promise<{ installmentId: string; notesHref: string }[]> => {
  const url = `${ORACLE_FUSION_CONFIG.baseUrl}/receivablesInvoices/${customerTrxId}/child/receivablesInvoiceInstallments`;
  if (verbose) log?.('info', `  [GET Fusion Installments] Invoice ${customerTrxId}`);

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (ORACLE_FUSION_CONFIG.username && ORACLE_FUSION_CONFIG.password) {
    headers['Authorization'] = 'Basic ' + btoa(`${ORACLE_FUSION_CONFIG.username}:${ORACLE_FUSION_CONFIG.password}`);
  }

  const resp = await fetch(url, { headers });
  if (resp.status === 404) return [];
  if (!resp.ok) throw new Error(`Fusion installments fetch failed for invoice ${customerTrxId}: ${resp.status}`);

  const data = await resp.json();
  const items: any[] = data.items || [];

  return items.map(inst => {
    const links: any[] = inst.links || [];
    const notesLink = links.find((l: any) => l.name === 'receivablesInvoiceInstallmentNotes' && l.rel === 'child');
    const installmentId = String(inst.InstallmentId ?? inst.installmentId ?? '');
    return { installmentId, notesHref: notesLink?.href ?? '' };
  }).filter(x => x.installmentId);
};

// ─── Step 3: Fetch notes for one installment ─────────────────────────────────

const fetchNotesForInstallment = async (
  customerTrxId: string,
  installmentId: string,
  notesHref: string,
  log?: LogCallback,
  verbose = false
): Promise<any[]> => {
  const url = notesHref ||
    `${ORACLE_FUSION_CONFIG.baseUrl}/receivablesInvoices/${customerTrxId}/child/receivablesInvoiceInstallments/${installmentId}/child/receivablesInvoiceInstallmentNotes`;

  if (verbose) log?.('info', `    [GET Notes] Installment ${installmentId}`);

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (ORACLE_FUSION_CONFIG.username && ORACLE_FUSION_CONFIG.password) {
    headers['Authorization'] = 'Basic ' + btoa(`${ORACLE_FUSION_CONFIG.username}:${ORACLE_FUSION_CONFIG.password}`);
  }

  const resp = await fetch(url, { headers });
  if (resp.status === 404) return [];
  if (!resp.ok) throw new Error(`Notes fetch failed for installment ${installmentId}: ${resp.status}`);

  const data = await resp.json();
  const items: any[] = data.items || [];

  return items.map(note => ({
    ...note,
    CustomerTrxId:   Number(customerTrxId),
    InstallmentId:   Number(installmentId),
  }));
};

// ─── POST notes to APEX ──────────────────────────────────────────────────────

const postNotesToApex = async (
  noteItems: any[],
  log?: LogCallback,
  verbose = false
): Promise<{ success: boolean; inserted: number; updated: number; error?: string }> => {
  try {
    const endpoint = 'ar/invoices/installments/notes/bulk';
    const payload  = { items: noteItems.map(({ links, ...rest }) => rest) };

    if (verbose) {
      log?.('step', `──── [POST] APEX Notes bulk (${noteItems.length} records) ────`);
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
    log?.('error', JSON.stringify({ items: noteItems.map(({ links, ...rest }) => rest) }, null, 2));
    return { success: false, inserted: 0, updated: 0, error: msg };
  }
};

// ─── Main Sync ───────────────────────────────────────────────────────────────

export const syncARInstallmentNotes = async (
  parameters:  Record<string, string>,
  testMode:    boolean | 'single' = true,
  log?:        LogCallback,
  onProgress?: NotesProgressCallback,
  abortSignal?: AbortSignal
): Promise<ARInstallmentNotesProgress> => {
  const progress: ARInstallmentNotesProgress = {
    status: 'idle',
    totalInvoices: 0, processedInvoices: 0,
    totalInstallments: 0, processedInstallments: 0,
    totalNotes: 0, insertedNotes: 0,
    errors: 0, lastError: '',
    startTime: new Date(), endTime: null,
  };

  const updateProgress = (updates: Partial<ARInstallmentNotesProgress>) => {
    Object.assign(progress, updates);
    onProgress?.(updates);
  };

  const specificTxnId  = parameters['CustomerTransactionId']?.trim() || '';
  const maxInvoices    = testMode === 'single' ? 1 : testMode === true ? 3 : undefined;
  const verbose        = testMode !== false;
  const modeLabel      = specificTxnId
    ? `SINGLE TRANSACTION (${specificTxnId})`
    : testMode === 'single' ? 'SINGLE RECORD DEBUG'
    : testMode ? 'TEST MODE (3 invoices)' : 'FULL SYNC (all invoices)';

  try {
    updateProgress({ status: 'fetching' });

    log?.('step', '═══════════════════════════════════════════════════════════');
    log?.('step', `  AR INSTALLMENT NOTES SYNC — ${modeLabel}`);
    log?.('step', '═══════════════════════════════════════════════════════════');
    log?.('info', '  │ Step 1: GET invoices from APEX ar/invoices');
    log?.('info', '  │ Step 2: GET Fusion receivablesInvoiceInstallments per invoice');
    log?.('info', '  │ Step 3: GET receivablesInvoiceInstallmentNotes per installment');
    log?.('info', '  │ Step 4: POST APEX ar/invoices/installments/notes/bulk');
    log?.('step', '───────────────────────────────────────────────────────────');

    // Step 1: invoice IDs
    let invoiceIds = await fetchInvoicesFromApex(specificTxnId || undefined, log);
    if (maxInvoices !== undefined) invoiceIds = invoiceIds.slice(0, maxInvoices);
    updateProgress({ totalInvoices: invoiceIds.length });

    if (invoiceIds.length === 0) {
      log?.('warning', 'No invoices found — nothing to sync');
      updateProgress({ status: 'completed', endTime: new Date() });
      return progress;
    }

    updateProgress({ status: 'inserting' });
    const BATCH_SIZE = 50;
    let batch: any[] = [];

    const flushBatch = async () => {
      if (batch.length === 0) return;
      const result = await postNotesToApex(batch, log, verbose);
      if (result.success) {
        updateProgress({ insertedNotes: progress.insertedNotes + result.inserted + result.updated });
      } else {
        updateProgress({ errors: progress.errors + 1, lastError: result.error || '' });
        log?.('error', `  Batch POST failed: ${result.error}`);
      }
      batch = [];
    };

    let processedInvoices    = 0;
    let totalInstallments    = 0;
    let processedInstallments = 0;

    for (const txnId of invoiceIds) {
      if (abortSignal?.aborted) {
        log?.('warning', 'Sync stopped by user');
        updateProgress({ status: 'stopped', endTime: new Date() });
        return progress;
      }

      try {
        // Step 2: installments for this invoice
        const installments = await fetchInstallmentsFromFusion(txnId, log, verbose);
        totalInstallments += installments.length;
        updateProgress({ totalInstallments });

        if (installments.length === 0) {
          log?.('info', `  Invoice ${txnId}: no installments`);
        } else {
          log?.('info', `  Invoice ${txnId}: ${installments.length} installment(s)`);

          for (const inst of installments) {
            if (abortSignal?.aborted) {
              log?.('warning', 'Sync stopped by user');
              updateProgress({ status: 'stopped', endTime: new Date() });
              return progress;
            }

            try {
              // Step 3: notes for this installment
              const notes = await fetchNotesForInstallment(txnId, inst.installmentId, inst.notesHref, log, verbose);
              if (notes.length > 0) {
                batch.push(...notes);
                updateProgress({ totalNotes: progress.totalNotes + notes.length });
                log?.('info', `    Installment ${inst.installmentId}: ${notes.length} note(s)`);
              } else {
                if (verbose) log?.('info', `    Installment ${inst.installmentId}: no notes`);
              }
            } catch (e: any) {
              updateProgress({ errors: progress.errors + 1, lastError: e.message });
              log?.('error', `    Installment ${inst.installmentId}: ${e.message}`);
            }

            processedInstallments++;
            updateProgress({ processedInstallments });

            if (batch.length >= BATCH_SIZE) await flushBatch();
          }
        }
      } catch (e: any) {
        updateProgress({ errors: progress.errors + 1, lastError: e.message });
        log?.('error', `  Invoice ${txnId}: ${e.message}`);
      }

      processedInvoices++;
      updateProgress({ processedInvoices });
    }

    await flushBatch();

    const finalStatus = progress.errors === 0 ? 'completed' : 'error';
    updateProgress({ status: finalStatus, endTime: new Date() });

    log?.('step', '───────────────────────────────────────────────────────────');
    log?.(finalStatus === 'completed' ? 'success' : 'warning',
      `  DONE — ${progress.insertedNotes} notes synced across ${progress.processedInstallments} installments, ${progress.errors} errors`);
    log?.('step', '═══════════════════════════════════════════════════════════');

    return progress;
  } catch (e: any) {
    const msg = e instanceof Error ? e.message : String(e);
    updateProgress({ status: 'error', lastError: msg, endTime: new Date() });
    log?.('error', `Fatal error: ${msg}`);
    return progress;
  }
};
