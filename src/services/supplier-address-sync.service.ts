import { fetchFromFusion, insertToApex } from './sync-http';

// Types
export interface SupplierAddressSyncProgress {
  status: 'idle' | 'fetching' | 'fetching_addresses' | 'inserting' | 'completed' | 'error' | 'stopped';
  totalSuppliers: number;
  processedSuppliers: number;
  totalAddresses: number;
  insertedAddresses: number;
  currentSupplier: string;
  currentSupplierId: number | null;
  errors: number;
  lastError: string;
  startTime: Date | null;
  endTime: Date | null;
}

export type LogCallback = (type: 'info' | 'success' | 'error' | 'warning' | 'step', message: string) => void;
export type ProgressCallback = (progress: Partial<SupplierAddressSyncProgress>) => void;
export type SupplierAddressPayloadCallback = (
  supplierId: number,
  supplierName: string,
  addressCount: number,
  payload: any,
  result?: any,
  error?: string
) => void;

// Fetch supplier addresses from Oracle Fusion
const fetchSupplierAddresses = async (
  supplierId: number,
  params: Record<string, string> = {},
  log?: LogCallback,
  verbose = true
): Promise<any> => {
  if (verbose) {
    log?.('info', `Fetching addresses for supplier ${supplierId}...`);
  }
  return fetchFromFusion(
    `fscmRestApi/resources/11.13.18.05/suppliers/${supplierId}/child/addresses`,
    params,
    log,
    verbose
  );
};

// Test connection to Supplier Address endpoint
export const testSupplierAddressConnection = async (
  log: LogCallback
): Promise<{ success: boolean; message: string; sample?: any }> => {
  try {
    log('info', 'Testing Supplier Address endpoint...');
    log('info', 'Step 1: Fetching first supplier...');

    // First get a supplier
    const suppliersResult = await fetchFromFusion(
      'fscmRestApi/resources/11.13.18.05/suppliers',
      { limit: '1' },
      log,
      true
    );

    if (!suppliersResult.success || !suppliersResult.items || suppliersResult.items.length === 0) {
      return { success: false, message: 'No suppliers found' };
    }

    const supplier = suppliersResult.items[0];
    log('info', `Step 2: Fetching addresses for ${supplier.Supplier} (ID: ${supplier.SupplierId})...`);

    // Then get addresses for that supplier
    const addressResult = await fetchSupplierAddresses(
      supplier.SupplierId,
      { limit: '1' },
      log,
      true
    );

    if (!addressResult.success) {
      return { success: false, message: addressResult.error || 'Failed to fetch addresses' };
    }

    if (addressResult.items.length === 0) {
      return {
        success: true,
        message: `Connected! Supplier ${supplier.Supplier} has no addresses.`,
        sample: { supplier, addresses: [] }
      };
    }

    const address = addressResult.items[0];
    return {
      success: true,
      message: `Connected! Found address: ${address.AddressName} in ${address.City}, ${address.Country}`,
      sample: { supplier, address }
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    log('error', `Connection test failed: ${errorMsg}`);
    return { success: false, message: errorMsg };
  }
};

// Main sync function
export const syncSupplierAddresses = async (
  parameters: Record<string, string>,
  testMode: boolean | 'single',
  log: LogCallback,
  onProgress: ProgressCallback,
  signal?: AbortSignal,
  onPayload?: SupplierAddressPayloadCallback
): Promise<SupplierAddressSyncProgress> => {
  const progress: SupplierAddressSyncProgress = {
    status: 'fetching',
    totalSuppliers: 0,
    processedSuppliers: 0,
    totalAddresses: 0,
    insertedAddresses: 0,
    currentSupplier: '',
    currentSupplierId: null,
    errors: 0,
    lastError: '',
    startTime: new Date(),
    endTime: null,
  };

  onProgress(progress);

  try {
    // Limit suppliers based on test mode
    // Use smaller page size for reliable pagination
    const pageSize = 100; // Smaller page size for better pagination
    const maxSuppliers = testMode === 'single' ? 1 : (testMode ? 25 : 10000); // Increased full sync limit
    let offset = 0;
    let hasMore = true;
    let pageNum = 0;

    log('step', `═══════════════════════════════════════`);
    log('info', `Starting Supplier Address sync (${testMode === 'single' ? 'Single Supplier Test' : testMode ? 'Test Mode - 25 suppliers' : 'Full Sync - up to 10000 suppliers'})`);
    log('step', `═══════════════════════════════════════`);

    // Step 1: Fetch all suppliers (paginated)
    const allSuppliers: any[] = [];

    while (hasMore) {
      if (signal?.aborted) {
        log('warning', 'Sync stopped by user');
        progress.status = 'stopped';
        break;
      }

      pageNum++;
      log('step', `\n──── Fetching Suppliers Page ${pageNum} ────`);

      const queryParams: Record<string, string> = {
        limit: String(pageSize),
        offset: String(offset),
      };

      const { SupplierNumber, ...rest } = parameters;
      Object.assign(queryParams, rest);
      if (SupplierNumber) {
        queryParams['q'] = `SupplierNumber=${SupplierNumber}`;
      }

      const result = await fetchFromFusion('fscmRestApi/resources/11.13.18.05/suppliers', queryParams, log, true);

      if (!result.success || !result.items) {
        throw new Error('Failed to fetch suppliers');
      }

      if (result.items.length === 0) {
        log('info', 'No more suppliers to process');
        break;
      }

      allSuppliers.push(...result.items);
      progress.totalSuppliers = allSuppliers.length;
      onProgress({ totalSuppliers: progress.totalSuppliers });

      log('info', `Total suppliers fetched so far: ${allSuppliers.length}`);

      // Check if more pages - continue if we got a full page OR hasMore is true
      hasMore = result.hasMore === true || result.items.length === pageSize;

      // Stop if we've reached max suppliers limit
      if (allSuppliers.length >= maxSuppliers) {
        log('info', `Reached max suppliers limit (${maxSuppliers})`);
        break;
      }

      if (testMode) {
        log('info', 'Test mode - stopping supplier fetch after first page');
        break;
      }

      // Single-supplier filter: no need to paginate
      if (parameters.SupplierNumber) {
        break;
      }

      offset += pageSize;
    }

    if (allSuppliers.length === 0) {
      throw new Error('No suppliers found');
    }

    log('info', `Found ${allSuppliers.length} suppliers to process`);

    // Step 2: For each supplier, fetch addresses and sync
    progress.status = 'fetching_addresses';
    onProgress({ status: 'fetching_addresses' });

    for (const supplier of allSuppliers) {
      if (signal?.aborted) {
        log('warning', 'Sync stopped by user');
        progress.status = 'stopped';
        break;
      }

      const supplierId = supplier.SupplierId;
      const supplierName = supplier.Supplier || `Supplier ${supplierId}`;

      progress.currentSupplier = supplierName;
      progress.currentSupplierId = supplierId;
      onProgress({
        currentSupplier: supplierName,
        currentSupplierId: supplierId
      });

      log('step', `\n──── Processing: ${supplierName} (ID: ${supplierId}) ────`);

      // Fetch all addresses for this supplier
      let addressOffset = 0;
      let addressHasMore = true;
      const supplierAddresses: any[] = [];

      while (addressHasMore) {
        if (signal?.aborted) break;

        const addressResult = await fetchSupplierAddresses(
          supplierId,
          { limit: '100', offset: String(addressOffset) },
          log,
          addressOffset === 0 // Only verbose on first page
        );

        if (!addressResult.success) {
          progress.errors++;
          progress.lastError = addressResult.error || 'Failed to fetch addresses';
          log('error', `Error fetching addresses for ${supplierName}: ${progress.lastError}`);
          break;
        }

        if (addressResult.items.length === 0) {
          if (addressOffset === 0) {
            log('info', `No addresses for ${supplierName}`);
          }
          break;
        }

        // Add SupplierId to each address
        const addressesWithSupplierId = addressResult.items.map((addr: any) => ({
          ...addr,
          SupplierId: supplierId
        }));

        supplierAddresses.push(...addressesWithSupplierId);
        addressHasMore = addressResult.hasMore === true;
        addressOffset += 100;
      }

      if (supplierAddresses.length > 0) {
        progress.totalAddresses += supplierAddresses.length;
        onProgress({ totalAddresses: progress.totalAddresses });

        // POST addresses to APEX
        progress.status = 'inserting';
        onProgress({ status: 'inserting' });

        const payload = { items: supplierAddresses };

        try {
          const insertResult = await insertToApex('suppliers/address', payload, log, true);

          if (insertResult.success) {
            const count = insertResult.inserted || supplierAddresses.length;
            progress.insertedAddresses += count;
            log('success', `Inserted ${count} addresses for ${supplierName}`);
            onPayload?.(supplierId, supplierName, supplierAddresses.length, payload, insertResult);
          } else {
            progress.errors++;
            progress.lastError = insertResult.error || 'Insert failed';
            log('error', `Failed to insert addresses for ${supplierName}: ${progress.lastError}`);
            onPayload?.(supplierId, supplierName, supplierAddresses.length, payload, undefined, progress.lastError);
          }
        } catch (error) {
          progress.errors++;
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          progress.lastError = errorMsg;
          log('error', `Error inserting addresses for ${supplierName}: ${errorMsg}`);
          onPayload?.(supplierId, supplierName, supplierAddresses.length, payload, undefined, errorMsg);
        }

        onProgress({
          insertedAddresses: progress.insertedAddresses,
          errors: progress.errors
        });
      }

      progress.processedSuppliers++;
      onProgress({ processedSuppliers: progress.processedSuppliers });

      // Reset status for next supplier
      if (!signal?.aborted) {
        progress.status = 'fetching_addresses';
        onProgress({ status: 'fetching_addresses' });
      }
    }

    progress.status = signal?.aborted ? 'stopped' : 'completed';
    progress.endTime = new Date();
    onProgress(progress);

    const duration = progress.endTime.getTime() - (progress.startTime?.getTime() || 0);
    log('step', `\n═══════════════════════════════════════`);
    log('success', `Sync ${progress.status}!`);
    log('info', `Total suppliers processed: ${progress.processedSuppliers}`);
    log('info', `Total addresses found: ${progress.totalAddresses}`);
    log('info', `Addresses inserted: ${progress.insertedAddresses}`);
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
