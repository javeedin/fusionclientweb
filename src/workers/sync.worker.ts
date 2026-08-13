/**
 * Web Worker for Background Sync Operations
 * Runs sync tasks in a separate thread to keep UI responsive
 */

// Worker context
const ctx: Worker = self as unknown as Worker;

// Configuration (will be set from main thread)
let PROXY_BASE_URL = '';
let APEX_BASE_URL = '';

// Message types
interface WorkerMessage {
  type: 'START_SYNC' | 'STOP_SYNC' | 'CONFIG';
  payload?: any;
}

interface ProgressMessage {
  type: 'PROGRESS' | 'LOG' | 'COMPLETE' | 'ERROR';
  payload: any;
}

// State
let aborted = false;

// Send progress to main thread
const sendProgress = (progress: any) => {
  ctx.postMessage({ type: 'PROGRESS', payload: progress } as ProgressMessage);
};

// Send log to main thread
const sendLog = (logType: string, message: string) => {
  ctx.postMessage({ type: 'LOG', payload: { logType, message } } as ProgressMessage);
};

// Send completion to main thread
const sendComplete = (result: any) => {
  ctx.postMessage({ type: 'COMPLETE', payload: result } as ProgressMessage);
};

// Send error to main thread
const sendError = (error: string) => {
  ctx.postMessage({ type: 'ERROR', payload: error } as ProgressMessage);
};

// Fetch from Fusion API
const fetchFromFusion = async (
  endpoint: string,
  params: Record<string, string> = {},
  verbose = true
): Promise<any> => {
  try {
    const queryParams = new URLSearchParams(params);
    const fusionPath = `fscmRestApi/resources/11.13.18.05/${endpoint}`;
    const proxyUrl = `${PROXY_BASE_URL}/fusion/${fusionPath}?${queryParams.toString()}`;

    if (verbose) {
      sendLog('step', '──── [GET] Oracle Fusion ────');
      sendLog('info', `Proxy URL: ${proxyUrl}`);
    }

    const response = await fetch(proxyUrl);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || `Fetch failed: ${response.status}`);
    }

    if (verbose) {
      sendLog('success', `GET Response: ${data.items?.length || 0} records fetched`);
    }
    return { success: true, items: data.items || [], hasMore: data.hasMore, count: data.count };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    sendLog('error', `GET Error: ${errorMsg}`);
    throw error;
  }
};

// Fetch supplier addresses
const fetchSupplierAddresses = async (
  supplierId: number,
  params: Record<string, string> = {},
  verbose = true
): Promise<any> => {
  try {
    const queryParams = new URLSearchParams(params);
    const fusionPath = `fscmRestApi/resources/11.13.18.05/suppliers/${supplierId}/child/addresses`;
    const proxyUrl = `${PROXY_BASE_URL}/fusion/${fusionPath}?${queryParams.toString()}`;

    if (verbose) {
      sendLog('info', `Fetching addresses for supplier ${supplierId}...`);
    }

    const response = await fetch(proxyUrl);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || `Fetch failed: ${response.status}`);
    }

    if (verbose) {
      sendLog('success', `Found ${data.items?.length || 0} addresses`);
    }
    return { success: true, items: data.items || [], hasMore: data.hasMore };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    sendLog('error', `Error fetching addresses: ${errorMsg}`);
    return { success: false, items: [], error: errorMsg };
  }
};

// Insert to APEX
const insertToApex = async (
  endpoint: string,
  payload: any,
  verbose = true
): Promise<any> => {
  try {
    const url = `${PROXY_BASE_URL}/apex/${endpoint}`;

    if (verbose) {
      sendLog('step', '──── [POST] APEX Database ────');
      sendLog('info', `APEX URL: ${APEX_BASE_URL}/${endpoint}`);
      sendLog('info', `Payload: ${JSON.stringify(payload).substring(0, 200)}...`);
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (verbose) {
      sendLog('success', `POST Response: ${JSON.stringify(data)}`);
    }

    return data;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    sendLog('error', `POST Error: ${errorMsg}`);
    throw error;
  }
};

// Sync Supplier Addresses
const syncSupplierAddresses = async (
  parameters: Record<string, string>,
  testMode: boolean | 'single'
) => {
  const progress = {
    status: 'fetching',
    totalSuppliers: 0,
    processedSuppliers: 0,
    totalAddresses: 0,
    insertedAddresses: 0,
    currentSupplier: '',
    currentSupplierId: null as number | null,
    errors: 0,
    lastError: '',
    startTime: new Date().toISOString(),
    endTime: null as string | null,
  };

  sendProgress(progress);

  try {
    // Use smaller page size for reliable pagination
    const pageSize = 100;
    const maxSuppliers = testMode === 'single' ? 1 : (testMode ? 25 : 10000);
    let offset = 0;
    let hasMore = true;
    let pageNum = 0;

    sendLog('step', `═══════════════════════════════════════`);
    sendLog('info', `Starting Supplier Address sync (${testMode === 'single' ? 'Single Supplier Test' : testMode ? 'Test Mode - 25 suppliers' : 'Full Sync - up to 10000 suppliers'})`);
    sendLog('info', `Running in Web Worker (background thread)`);
    sendLog('step', `═══════════════════════════════════════`);

    // Step 1: Fetch all suppliers
    const allSuppliers: any[] = [];

    while (hasMore && !aborted) {
      pageNum++;
      sendLog('step', `\n──── Fetching Suppliers Page ${pageNum} ────`);

      const queryParams: Record<string, string> = {
        limit: String(pageSize),
        offset: String(offset),
        ...parameters,
      };

      const result = await fetchFromFusion('suppliers', queryParams, true);

      if (!result.success || !result.items) {
        throw new Error('Failed to fetch suppliers');
      }

      if (result.items.length === 0) {
        sendLog('info', 'No more suppliers to process');
        break;
      }

      allSuppliers.push(...result.items);
      progress.totalSuppliers = allSuppliers.length;
      sendProgress({ ...progress });

      sendLog('info', `Total suppliers fetched so far: ${allSuppliers.length}`);

      // Check if more pages - continue if we got a full page OR hasMore is true
      hasMore = result.hasMore === true || result.items.length === pageSize;

      // Stop if we've reached max suppliers limit
      if (allSuppliers.length >= maxSuppliers) {
        sendLog('info', `Reached max suppliers limit (${maxSuppliers})`);
        break;
      }

      if (testMode) {
        sendLog('info', 'Test mode - stopping supplier fetch after first page');
        break;
      }

      offset += pageSize;
    }

    if (allSuppliers.length === 0) {
      throw new Error('No suppliers found');
    }

    sendLog('info', `Found ${allSuppliers.length} suppliers to process`);

    // Step 2: For each supplier, fetch and sync addresses
    progress.status = 'fetching_addresses';
    sendProgress({ ...progress });

    for (const supplier of allSuppliers) {
      if (aborted) {
        sendLog('warning', 'Sync stopped by user');
        progress.status = 'stopped';
        break;
      }

      const supplierId = supplier.SupplierId;
      const supplierName = supplier.Supplier || `Supplier ${supplierId}`;

      progress.currentSupplier = supplierName;
      progress.currentSupplierId = supplierId;
      sendProgress({ ...progress });

      sendLog('step', `\n──── Processing: ${supplierName} (ID: ${supplierId}) ────`);

      // Fetch addresses for this supplier
      let addressOffset = 0;
      let addressHasMore = true;
      const supplierAddresses: any[] = [];

      while (addressHasMore && !aborted) {
        const addressResult = await fetchSupplierAddresses(
          supplierId,
          { limit: '100', offset: String(addressOffset) },
          addressOffset === 0
        );

        if (!addressResult.success) {
          progress.errors++;
          progress.lastError = addressResult.error || 'Failed to fetch addresses';
          sendLog('error', `Error fetching addresses for ${supplierName}: ${progress.lastError}`);
          break;
        }

        if (addressResult.items.length === 0) {
          if (addressOffset === 0) {
            sendLog('info', `No addresses for ${supplierName}`);
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

      if (supplierAddresses.length > 0 && !aborted) {
        progress.totalAddresses += supplierAddresses.length;
        sendProgress({ ...progress });

        // POST to APEX
        progress.status = 'inserting';
        sendProgress({ ...progress });

        const payload = { items: supplierAddresses };

        try {
          const insertResult = await insertToApex('suppliers/address', payload, true);

          if (insertResult.success) {
            const count = insertResult.inserted || supplierAddresses.length;
            progress.insertedAddresses += count;
            sendLog('success', `Inserted ${count} addresses for ${supplierName}`);
          } else {
            progress.errors++;
            progress.lastError = insertResult.error || 'Insert failed';
            sendLog('error', `Failed to insert addresses for ${supplierName}: ${progress.lastError}`);
          }
        } catch (error) {
          progress.errors++;
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          progress.lastError = errorMsg;
          sendLog('error', `Error inserting addresses for ${supplierName}: ${errorMsg}`);
        }

        sendProgress({ ...progress });
      }

      progress.processedSuppliers++;
      sendProgress({ ...progress });

      if (!aborted) {
        progress.status = 'fetching_addresses';
        sendProgress({ ...progress });
      }
    }

    progress.status = aborted ? 'stopped' : 'completed';
    progress.endTime = new Date().toISOString();
    sendProgress({ ...progress });

    const startTime = new Date(progress.startTime).getTime();
    const endTime = new Date(progress.endTime).getTime();
    const duration = (endTime - startTime) / 1000;

    sendLog('step', `\n═══════════════════════════════════════`);
    sendLog('success', `Sync ${progress.status}!`);
    sendLog('info', `Total suppliers processed: ${progress.processedSuppliers}`);
    sendLog('info', `Total addresses found: ${progress.totalAddresses}`);
    sendLog('info', `Addresses inserted: ${progress.insertedAddresses}`);
    sendLog('info', `Errors: ${progress.errors}`);
    sendLog('info', `Duration: ${duration.toFixed(1)}s`);
    sendLog('step', `═══════════════════════════════════════`);

    sendComplete(progress);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    progress.status = 'error';
    progress.lastError = errorMsg;
    progress.endTime = new Date().toISOString();
    sendProgress({ ...progress });
    sendLog('error', `Sync failed: ${errorMsg}`);
    sendError(errorMsg);
  }
};

// Handle messages from main thread
ctx.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const { type, payload } = event.data;

  switch (type) {
    case 'CONFIG':
      PROXY_BASE_URL = payload.proxyBaseUrl;
      APEX_BASE_URL = payload.apexBaseUrl;
      sendLog('info', 'Worker configured');
      break;

    case 'START_SYNC':
      aborted = false;
      const { syncType, parameters, testMode } = payload;

      if (syncType === 'supplier-addresses') {
        syncSupplierAddresses(parameters, testMode);
      } else {
        sendError(`Unknown sync type: ${syncType}`);
      }
      break;

    case 'STOP_SYNC':
      aborted = true;
      sendLog('warning', 'Stop signal received');
      break;

    default:
      sendError(`Unknown message type: ${type}`);
  }
};

// Export empty object for TypeScript module
export {};
