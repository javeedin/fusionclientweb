import { ORACLE_FUSION_CONFIG, APEX_DB_CONFIG } from '../config/api.config';
import { fetchFromOracle, insertToApex } from './sync-http';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ARCMApplicationsSyncProgress {
  status: 'idle' | 'fetching' | 'inserting' | 'completed' | 'error' | 'stopped';
  totalApplications:    number;
  insertedApplications: number;
  updatedApplications:  number;
  errors:               number;
  lastError:            string;
  startTime:  Date | null;
  endTime:    Date | null;
}

export type LogCallback = (type: 'info' | 'success' | 'error' | 'warning' | 'step', message: string) => void;
export type ARCMApplicationsProgressCallback = (progress: Partial<ARCMApplicationsSyncProgress>) => void;

export interface CustomerRecord {
  cust_account_id: string;
  account_number:  string;
  account_name:    string;
}

const APEX_BULK_ENDPOINT = 'ar/cm-applications/bulk';
const APEX_CUSTOMERS_URL = `${APEX_DB_CONFIG.baseUrl}/ar/customers`;
const FUSION_CHILD_PATH  = 'receivablesCustomerAccountActivities/{custId}/child/creditMemoApplications';

// ─── Fetch all customers from APEX ───────────────────────────────────────────

export const fetchCustomersFromApex = async (
  log?: LogCallback
): Promise<CustomerRecord[]> => {
  const authHeader = 'Basic ' + btoa(`${ORACLE_FUSION_CONFIG.username}:${ORACLE_FUSION_CONFIG.password}`);
  log?.('step', `──── [GET] APEX Customers — ${APEX_CUSTOMERS_URL} ────`);

  const resp = await fetch(APEX_CUSTOMERS_URL, {
    headers: { Authorization: authHeader, Accept: 'application/json' },
  });
  if (!resp.ok) throw new Error(`APEX customers fetch failed: ${resp.status} ${resp.statusText}`);

  const data  = await resp.json();
  const items: CustomerRecord[] = data.items || [];
  log?.('info', `  Found ${items.length} customers`);
  return items;
};

// ─── Fetch CM applications from Fusion for one customer ──────────────────────

const fetchApplicationsForCustomer = async (
  custAccountId: string,
  params: Record<string, string>,
  log?: LogCallback,
  verbose = true
): Promise<{ success: boolean; items: any[]; hasMore: boolean; error?: string }> => {
  const endpoint = FUSION_CHILD_PATH.replace('{custId}', custAccountId);
  try {
    if (verbose)
      log?.('step', `  ──── [GET] Fusion CM Applications — cust ${custAccountId} offset=${params.offset ?? 0} ────`);

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
      items: applications.map(a => { const { links, ...rest } = a as any; return rest; }),
    };

    if (verbose) {
      log?.('step', `──── [POST] APEX CM Applications (${applications.length} records) ────`);
      log?.('info', `  URL: ${APEX_DB_CONFIG.baseUrl}/${APEX_BULK_ENDPOINT}`);
    }

    const data = await insertToApex(APEX_BULK_ENDPOINT, payload, log, verbose);
    const isSuccess = data.status === 'SUCCESS';
    return {
      success:  isSuccess,
      inserted: data.inserted ?? (isSuccess ? applications.length : 0),
      updated:  data.updated  ?? 0,
      error:    isSuccess ? undefined : (data.message || 'Insert failed'),
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    log?.('error', `POST Error: ${msg}`);
    return { success: false, inserted: 0, updated: 0, error: msg };
  }
};

// ─── Sync a single customer (used by the popup per-customer button) ───────────

export const syncCustomerCMApplications = async (
  customer: CustomerRecord,
  log?: LogCallback,
  onProgress?: ARCMApplicationsProgressCallback,
  abortSignal?: AbortSignal
): Promise<ARCMApplicationsSyncProgress> => {
  const progress: ARCMApplicationsSyncProgress = {
    status: 'fetching',
    totalApplications: 0, insertedApplications: 0, updatedApplications: 0,
    errors: 0, lastError: '', startTime: new Date(), endTime: null,
  };

  const update = (p: Partial<ARCMApplicationsSyncProgress>) => {
    Object.assign(progress, p);
    onProgress?.(p);
  };

  const batchSize = 50;
  let pendingBatch: any[] = [];

  const flushBatch = async () => {
    if (!pendingBatch.length) return;
    update({ status: 'inserting' });
    const r = await insertApplicationsToApex(pendingBatch, log, true);
    update({
      status:               'fetching',
      totalApplications:    progress.totalApplications    + pendingBatch.length,
      insertedApplications: progress.insertedApplications + r.inserted,
      updatedApplications:  progress.updatedApplications  + r.updated,
      errors:               progress.errors + (r.success ? 0 : 1),
      lastError:            r.error || progress.lastError,
    });
    pendingBatch = [];
  };

  try {
    log?.('step', `═══ Syncing CM Applications — ${customer.account_name} (${customer.cust_account_id}) ═══`);
    let offset = 0;
    let hasMore = true;

    while (hasMore && !abortSignal?.aborted) {
      const result = await fetchApplicationsForCustomer(
        customer.cust_account_id,
        { limit: '500', offset: String(offset) },
        log, true
      );

      if (!result.success) {
        update({ errors: progress.errors + 1, lastError: result.error || '' });
        break;
      }

      const tagged = result.items.map(item => ({
        ...item,
        CustAccountId: Number(customer.cust_account_id),
      }));

      pendingBatch.push(...tagged);
      offset  += result.items.length;
      hasMore  = result.hasMore;

      if (pendingBatch.length >= batchSize || !hasMore) {
        await flushBatch();
      }
    }

    await flushBatch();
    update({ status: abortSignal?.aborted ? 'stopped' : 'completed', endTime: new Date() });

  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    log?.('error', `Sync failed: ${msg}`);
    update({ status: 'error', lastError: msg, endTime: new Date() });
  }

  return progress;
};

// ─── Sync all customers ───────────────────────────────────────────────────────

export interface ARCMAllCustomersSyncProgress {
  status: 'idle' | 'running' | 'completed' | 'stopped' | 'error';
  totalCustomers:      number;
  processedCustomers:  number;
  currentCustomer:     string;
  totalApplications:   number;
  insertedApplications:number;
  updatedApplications: number;
  errors:              number;
  lastError:           string;
  customerResults:     Record<string, { inserted: number; updated: number; errors: number; done: boolean }>;
  startTime:  Date | null;
  endTime:    Date | null;
}

export type ARCMAllProgressCallback = (progress: Partial<ARCMAllCustomersSyncProgress>) => void;

export const syncAllCustomersCMApplications = async (
  customers: CustomerRecord[],
  log?: LogCallback,
  onProgress?: ARCMAllProgressCallback,
  abortSignal?: AbortSignal
): Promise<ARCMAllCustomersSyncProgress> => {
  const progress: ARCMAllCustomersSyncProgress = {
    status: 'running',
    totalCustomers: customers.length, processedCustomers: 0,
    currentCustomer: '', totalApplications: 0,
    insertedApplications: 0, updatedApplications: 0,
    errors: 0, lastError: '', customerResults: {},
    startTime: new Date(), endTime: null,
  };

  const update = (p: Partial<ARCMAllCustomersSyncProgress>) => {
    Object.assign(progress, p);
    onProgress?.(p);
  };

  for (let i = 0; i < customers.length; i++) {
    if (abortSignal?.aborted) { update({ status: 'stopped' }); break; }

    const cust = customers[i];
    update({ currentCustomer: `${cust.account_name} (${cust.cust_account_id})` });
    log?.('step', `\n[${i + 1}/${customers.length}] ${cust.account_name}`);

    const r = await syncCustomerCMApplications(cust, log, undefined, abortSignal);

    update({
      processedCustomers:   i + 1,
      totalApplications:    progress.totalApplications    + r.totalApplications,
      insertedApplications: progress.insertedApplications + r.insertedApplications,
      updatedApplications:  progress.updatedApplications  + r.updatedApplications,
      errors:               progress.errors + r.errors,
      lastError:            r.lastError || progress.lastError,
      customerResults: {
        ...progress.customerResults,
        [cust.cust_account_id]: {
          inserted: r.insertedApplications,
          updated:  r.updatedApplications,
          errors:   r.errors,
          done:     true,
        },
      },
    });
  }

  update({ status: abortSignal?.aborted ? 'stopped' : 'completed', endTime: new Date() });
  return progress;
};

// ─── Test connection ──────────────────────────────────────────────────────────

export const testARCMApplicationsConnection = async (log?: LogCallback): Promise<boolean> => {
  try {
    log?.('info', 'Testing AR CM Applications — fetching first customer from APEX...');
    const customers = await fetchCustomersFromApex(log);
    if (!customers.length) { log?.('warning', 'No customers found'); return false; }
    const first = customers[0];
    log?.('info', `Using customer: ${first.account_name} (${first.cust_account_id})`);
    const result = await fetchApplicationsForCustomer(
      first.cust_account_id, { limit: '1', offset: '0' }, log, true
    );
    if (result.success) {
      log?.('success', `Connection OK — sample: ${result.items.length} record(s)`);
      return true;
    }
    log?.('error', 'Connection test failed');
    return false;
  } catch (error) {
    log?.('error', `Connection test error: ${error}`);
    return false;
  }
};
