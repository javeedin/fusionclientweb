import { fetchFromFusion, insertToApex } from './sync-http';
import { syncSupplierAddresses } from './supplier-address-sync.service';
import { syncSupplierSites } from './supplier-sites-sync.service';
import { syncSiteAssignments } from './supplier-site-assignments-sync.service';

// Types
export interface SuppliersSyncProgress {
  status: 'idle' | 'fetching' | 'inserting' | 'completed' | 'error' | 'stopped';
  totalRecords: number;
  processedRecords: number;
  insertedRecords: number;
  currentPage: number;
  totalPages: number;
  errors: number;
  lastError: string;
  startTime: Date | null;
  endTime: Date | null;
}

export type LogCallback = (type: 'info' | 'success' | 'error' | 'warning' | 'step', message: string) => void;
export type ProgressCallback = (progress: Partial<SuppliersSyncProgress>) => void;
export type SuppliersPayloadCallback = (
  supplierId: number,
  supplierName: string,
  payload: any,
  result?: any,
  error?: string
) => void;

// Test connection to Suppliers endpoint
export const testSuppliersConnection = async (
  log: LogCallback
): Promise<{ success: boolean; message: string; sample?: any }> => {
  try {
    log('info', 'Testing Suppliers endpoint...');

    const result = await fetchFromFusion(
      'fscmRestApi/resources/11.13.18.05/suppliers',
      { limit: '1' },
      log,
      true
    );

    if (!result.success || !result.items || result.items.length === 0) {
      return { success: false, message: 'No suppliers found' };
    }

    const supplier = result.items[0];
    return {
      success: true,
      message: `Connected! Found supplier: ${supplier.Supplier} (${supplier.SupplierNumber})`,
      sample: supplier
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    log('error', `Connection test failed: ${errorMsg}`);
    return { success: false, message: errorMsg };
  }
};

// Main sync function
export const syncSuppliers = async (
  parameters: Record<string, string>,
  testMode: boolean | 'single',
  log: LogCallback,
  onProgress: ProgressCallback,
  signal?: AbortSignal,
  onPayload?: SuppliersPayloadCallback
): Promise<SuppliersSyncProgress> => {
  const progress: SuppliersSyncProgress = {
    status: 'fetching',
    totalRecords: 0,
    processedRecords: 0,
    insertedRecords: 0,
    currentPage: 0,
    totalPages: 0,
    errors: 0,
    lastError: '',
    startTime: new Date(),
    endTime: null,
  };

  onProgress(progress);

  try {
    const pageSize = testMode === 'single' ? 1 : (testMode ? 25 : 500);
    let offset = 0;
    let hasMore = true;
    let pageNum = 0;
    const BATCH_SIZE = 50; // Records per POST
    const fetchedSuppliers: any[] = []; // track for cascade

    log('step', `═══════════════════════════════════════`);
    log('info', `Starting Suppliers sync (${testMode === 'single' ? 'Single Record Test' : testMode ? 'Test Mode - 25 records' : 'Full Sync'})`);
    log('step', `═══════════════════════════════════════`);

    while (hasMore) {
      if (signal?.aborted) {
        log('warning', 'Sync stopped by user');
        progress.status = 'stopped';
        break;
      }

      pageNum++;
      progress.currentPage = pageNum;
      onProgress({ currentPage: pageNum });

      log('step', `\n──── Page ${pageNum} ────`);

      // Fetch suppliers
      const queryParams: Record<string, string> = {
        limit: String(pageSize),
        offset: String(offset),
      };

      // Pass other parameters directly, but convert SupplierNumber to a Fusion q filter
      const { SupplierNumber, ...rest } = parameters;
      Object.assign(queryParams, rest);
      if (SupplierNumber) {
        queryParams['q'] = `SupplierNumber=${SupplierNumber}`;
      }

      const result = await fetchFromFusion('fscmRestApi/resources/11.13.18.05/suppliers', queryParams, log, true);

      if (!result.success || !result.items) {
        throw new Error('Failed to fetch suppliers');
      }

      const suppliers = result.items;

      if (suppliers.length === 0) {
        log('info', 'No more suppliers to process');
        break;
      }

      fetchedSuppliers.push(...suppliers);
      progress.totalRecords += suppliers.length;
      onProgress({ totalRecords: progress.totalRecords });

      log('info', `Processing ${suppliers.length} suppliers...`);

      // Process in batches
      for (let i = 0; i < suppliers.length; i += BATCH_SIZE) {
        if (signal?.aborted) break;

        const batch = suppliers.slice(i, i + BATCH_SIZE);
        const payload = { items: batch };

        try {
          progress.status = 'inserting';
          onProgress({ status: 'inserting' });

          const insertResult = await insertToApex('suppliers', payload, log, i === 0);

          if (insertResult.success) {
            const count = insertResult.count || batch.length;
            progress.insertedRecords += count;
            progress.processedRecords += batch.length;
            log('success', `Inserted batch of ${count} suppliers`);

            // Call payload callback for first item in batch
            if (batch.length > 0) {
              onPayload?.(batch[0].SupplierId, batch[0].Supplier, payload, insertResult);
            }
          } else {
            progress.errors++;
            progress.lastError = insertResult.error || 'Insert failed';
            progress.processedRecords += batch.length;
            log('error', `Failed to insert batch: ${progress.lastError}`);

            if (batch.length > 0) {
              onPayload?.(batch[0].SupplierId, batch[0].Supplier, payload, undefined, progress.lastError);
            }
          }
        } catch (error) {
          progress.errors++;
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          progress.lastError = errorMsg;
          progress.processedRecords += batch.length;
          log('error', `Error inserting batch: ${errorMsg}`);
        }

        onProgress({
          processedRecords: progress.processedRecords,
          insertedRecords: progress.insertedRecords,
          errors: progress.errors
        });
      }

      // Check if more pages
      hasMore = result.hasMore === true && suppliers.length === pageSize;

      if (testMode) {
        log('info', 'Test mode - stopping after first batch');
        break;
      }

      // Single-supplier filter: no need to paginate
      if (parameters.SupplierNumber) {
        break;
      }

      offset += pageSize;
    }

    // ── Cascade: sync addresses, sites, and site assignments for specific supplier ──
    const { SupplierNumber } = parameters;
    if (SupplierNumber && !signal?.aborted && fetchedSuppliers.length > 0) {
      const supplierId = fetchedSuppliers[0].SupplierId;
      log('step', `\n═══════════════════════════════════════`);
      log('info', `Cascading to related data for supplier ${SupplierNumber} (ID: ${supplierId})...`);

      log('step', `\n──── Syncing Addresses ────`);
      await syncSupplierAddresses(parameters, testMode, log, () => {}, signal);

      log('step', `\n──── Syncing Sites ────`);
      await syncSupplierSites(parameters, testMode, log, () => {}, signal);

      log('step', `\n──── Syncing Site Assignments ────`);
      await syncSiteAssignments(
        { ...parameters, SupplierId: String(supplierId) },
        testMode,
        log,
        () => {},
        signal
      );
    }

    progress.status = signal?.aborted ? 'stopped' : 'completed';
    progress.endTime = new Date();
    onProgress(progress);

    const duration = progress.endTime.getTime() - (progress.startTime?.getTime() || 0);
    log('step', `\n═══════════════════════════════════════`);
    log('success', `Sync ${progress.status}!`);
    log('info', `Total suppliers: ${progress.totalRecords}`);
    log('info', `Inserted: ${progress.insertedRecords}`);
    log('info', `Errors: ${progress.errors}`);
    log('info', `Duration: ${(duration / 1000).toFixed(1)}s`);
    log('step', `═══════════════════════════════════════`);

    return progress;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    progress.status = 'error';
    progress.lastError = errorMsg;
    progress.endTime = new Date();
    onProgress(progress);
    log('error', `Sync failed: ${errorMsg}`);
    return progress;
  }
};
