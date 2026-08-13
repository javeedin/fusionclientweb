import { ORACLE_FUSION_CONFIG, APEX_DB_CONFIG } from '../config/api.config';
import { fetchFromOracle, insertToApex } from './sync-http';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ARReceiptApplicationsSyncProgress {
  status: 'idle' | 'fetching' | 'inserting' | 'completed' | 'error' | 'stopped';
  totalCustomers: number;
  processedCustomers: number;
  totalApplications: number;
  insertedApplications: number;
  updatedApplications: number;
  currentCustomer: string;
  errors: number;
  lastError: string;
  startTime: Date | null;
  endTime: Date | null;
}

export type LogCallback = (type: 'info' | 'success' | 'error' | 'warning' | 'step', message: string) => void;
export type ARReceiptApplicationsProgressCallback = (progress: Partial<ARReceiptApplicationsSyncProgress>) => void;

interface CustomerRecord {
  cust_account_id: string;
  account_number: string;
  account_name: string;
}

const APEX_BULK_ENDPOINT  = 'ar/receipt-applications/bulk';
const APEX_CUSTOMERS_URL  = `${APEX_DB_CONFIG.baseUrl}/ar/customers`;
const FUSION_CHILD_PATH   = 'receivablesCustomerAccountActivities/{custId}/child/standardReceiptApplications';

// ─── Fetch customers from APEX ────────────────────────────────────────────────

const fetchCustomersFromApex = async (
  log?: LogCallback
): Promise<CustomerRecord[]> => {
  log?.('step', `──── [GET] APEX Customers ────`);
  log?.('info', `  URL: ${APEX_CUSTOMERS_URL}`);

  const authHeader = 'Basic ' + btoa(
    `${ORACLE_FUSION_CONFIG.username}:${ORACLE_FUSION_CONFIG.password}`
  );

  const resp = await fetch(APEX_CUSTOMERS_URL, {
    headers: { Authorization: authHeader, Accept: 'application/json' },
  });

  if (!resp.ok) throw new Error(`APEX customers fetch failed: ${resp.status} ${resp.statusText}`);

  const data = await resp.json();
  const items: CustomerRecord[] = data.items || [];
  log?.('info', `  Found ${items.length} customers`);
  return items;
};

// ─── Fetch applications from Fusion for one customer ─────────────────────────

const fetchApplicationsForCustomer = async (
  custAccountId: string,
  params: Record<string, string>,
  log?: LogCallback,
  verbose = true
): Promise<{ success: boolean; items: any[]; hasMore: boolean; error?: string }> => {
  const endpoint = FUSION_CHILD_PATH.replace('{custId}', custAccountId);
  try {
    if (verbose) log?.('step', `  ──── [GET] Fusion applications for customer ${custAccountId} (offset=${params.offset ?? 0}) ────`);

    const data = await fetchFromOracle(endpoint, params, log, verbose);

    if (verbose) log?.('info', `    ${(data.items || []).length} items, hasMore=${data.hasMore}`);

    return { success: true, items: data.items || [], hasMore: data.hasMore || false };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    log?.('error', `  Fetch error for customer ${custAccountId}: ${msg}`);
    return { success: false, items: [], hasMore: false, error: msg };
  }
};

// ─── POST batch to APEX ───────────────────────────────────────────────────────

const insertApplicationsToApex = async (
  applications: any[],
  log?: LogCallback,
  verbose = true
): Promise<{ success: boolean; inserted: number; updated: number; error?: string }> => {
  try {
    const payload = {
      items: applications.map(a => {
        const { links, ...rest } = a as any;
        return rest;
      }),
    };

    if (verbose) {
      log?.('step', `──── [POST] APEX Receipt Applications (${applications.length} records) ────`);
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
      inserted: data.inserted ?? (isSuccess ? applications.length : 0),
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

export const testARReceiptApplicationsConnection = async (log?: LogCallback): Promise<boolean> => {
  try {
    log?.('info', 'Testing AR Receipt Applications — fetching first customer from APEX...');
    const customers = await fetchCustomersFromApex(log);
    if (!customers.length) {
      log?.('warning', 'No customers found in APEX ar/customers');
      return false;
    }
    const first = customers[0];
    log?.('info', `Using customer: ${first.account_name} (${first.cust_account_id})`);
    const result = await fetchApplicationsForCustomer(first.cust_account_id, { limit: '1', offset: '0' }, log, true);
    if (result.success) {
      log?.('success', `Oracle Fusion AR Receipt Applications connection successful! Sample: ${result.items.length} record(s)`);
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

export const syncARReceiptApplications = async (
  parameters: Record<string, string>,
  testMode: boolean | 'single' = true,
  log?: LogCallback,
  onProgress?: ARReceiptApplicationsProgressCallback,
  abortSignal?: AbortSignal
): Promise<ARReceiptApplicationsSyncProgress> => {
  const progress: ARReceiptApplicationsSyncProgress = {
    status: 'idle',
    totalCustomers: 0,
    processedCustomers: 0,
    totalApplications: 0,
    insertedApplications: 0,
    updatedApplications: 0,
    currentCustomer: '',
    errors: 0,
    lastError: '',
    startTime: new Date(),
    endTime: null,
  };

  const updateProgress = (updates: Partial<ARReceiptApplicationsSyncProgress>) => {
    Object.assign(progress, updates);
    onProgress?.(updates);
  };

  const pageSize   = testMode === 'single' ? 1 : testMode === true ? 25 : 500;
  const batchSize  = 50;
  const verbose    = testMode !== false;
  const modeLabel  = testMode === 'single'
    ? 'SINGLE RECORD DEBUG'
    : testMode ? 'TEST MODE (25 per customer)' : 'FULL SYNC (all applications)';

  // In test mode, only process first customer; in single, 1 customer 1 page
  const maxCustomers = testMode === 'single' ? 1 : testMode === true ? 3 : null;

  try {
    updateProgress({ status: 'fetching' });

    log?.('step', '═══════════════════════════════════════════════════════════');
    log?.('step', `  AR RECEIPT APPLICATIONS SYNC — ${modeLabel}`);
    log?.('step', '═══════════════════════════════════════════════════════════');
    log?.('info', '  │ Step 1: GET customers from APEX ar/customers');
    log?.('info', `  │ Step 2: GET Fusion receivablesCustomerAccountActivities/{id}/child/standardReceiptApplications`);
    log?.('info', `  │ Step 3: POST ${APEX_DB_CONFIG.baseUrl}/${APEX_BULK_ENDPOINT}`);
    log?.('step', '═══════════════════════════════════════════════════════════');

    // ── STEP 1: Get customers from APEX ───────────────────────────────────────
    let customers = await fetchCustomersFromApex(log);

    // Apply customer filter if provided
    const filterCustId = parameters['CustAccountId'];
    if (filterCustId) {
      customers = customers.filter(c => c.cust_account_id === filterCustId);
      log?.('info', `  Filtered to 1 customer: ${filterCustId}`);
    }

    if (maxCustomers !== null) {
      customers = customers.slice(0, maxCustomers);
    }

    updateProgress({ totalCustomers: customers.length });
    log?.('info', `  Processing ${customers.length} customer(s)`);

    // ── STEP 2: For each customer, page through Fusion ─────────────────────────
    let pendingBatch: any[] = [];

    const flushBatch = async () => {
      if (!pendingBatch.length) return;
      updateProgress({ status: 'inserting' });
      const result = await insertApplicationsToApex(pendingBatch, log, verbose);
      updateProgress({
        status: 'fetching',
        totalApplications: progress.totalApplications + pendingBatch.length,
        insertedApplications: progress.insertedApplications + result.inserted,
        updatedApplications:  progress.updatedApplications  + result.updated,
        errors: progress.errors + (result.success ? 0 : 1),
        lastError: result.error || progress.lastError,
      });
      if (!result.success) log?.('error', `Batch POST failed: ${result.error}`);
      pendingBatch = [];
    };

    for (let ci = 0; ci < customers.length; ci++) {
      if (abortSignal?.aborted) { updateProgress({ status: 'stopped' }); break; }

      const customer = customers[ci];
      updateProgress({ currentCustomer: `${customer.account_name} (${customer.cust_account_id})` });
      log?.('info', `\n[${ci + 1}/${customers.length}] Customer: ${customer.account_name} — ID: ${customer.cust_account_id}`);

      let offset = 0;
      let hasMore = true;

      while (hasMore && !abortSignal?.aborted) {
        const result = await fetchApplicationsForCustomer(
          customer.cust_account_id,
          { limit: String(pageSize), offset: String(offset) },
          log,
          verbose
        );

        if (!result.success) {
          updateProgress({ errors: progress.errors + 1, lastError: result.error || '' });
          break;
        }

        // Inject CustAccountId into each record for the DB package
        const tagged = result.items.map(item => ({
          ...item,
          CustAccountId: Number(customer.cust_account_id),
        }));

        pendingBatch.push(...tagged);
        offset += result.items.length;
        hasMore = result.hasMore;

        if (testMode === 'single') { hasMore = false; }

        if (pendingBatch.length >= batchSize || (!hasMore)) {
          await flushBatch();
        }

        if (!hasMore) break;
      }

      updateProgress({ processedCustomers: ci + 1 });
    }

    // Final flush
    await flushBatch();

    const finalStatus = abortSignal?.aborted ? 'stopped' : 'completed';
    updateProgress({ status: finalStatus, endTime: new Date() });

    log?.('step', '═══════════════════════════════════════════════════════════');
    log?.(finalStatus === 'completed' ? 'success' : 'warning',
      `  DONE — ${progress.totalApplications} applications | ` +
      `Inserted: ${progress.insertedApplications} | ` +
      `Updated: ${progress.updatedApplications} | ` +
      `Errors: ${progress.errors}`
    );
    log?.('step', '═══════════════════════════════════════════════════════════');

  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    log?.('error', `Sync failed: ${msg}`);
    updateProgress({ status: 'error', lastError: msg, endTime: new Date() });
  }

  return progress;
};
