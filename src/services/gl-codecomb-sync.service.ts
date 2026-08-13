import { fetchFromOracle, insertToApex } from './sync-http';

// Types
export interface CodeCombSyncProgress {
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
export type ProgressCallback = (progress: Partial<CodeCombSyncProgress>) => void;
export type CodeCombPayloadCallback = (
  ccId: number,
  concatenatedSegments: string,
  payload: any,
  result?: any,
  error?: string
) => void;

// Test connection to Oracle Fusion accountCombinationsLOV endpoint
export const testGLCodeCombConnection = async (log: LogCallback): Promise<boolean> => {
  try {
    log('info', 'Testing GL Code Combinations endpoint...');

    const result = await fetchFromOracle(
      'accountCombinationsLOV',
      { limit: '1' },
      log,
      true
    );

    if (result.success && result.items) {
      log('success', `✓ Connection successful! Sample record: ${JSON.stringify(result.items[0])}`);
      return true;
    } else {
      log('error', '✗ Connection failed: No data returned');
      return false;
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    log('error', `✗ Connection test failed: ${errorMsg}`);
    return false;
  }
};

// Main sync function for GL Code Combinations
export const syncGLCodeCombinations = async (
  parameters: Record<string, string>,
  testMode: boolean | 'single',
  log: LogCallback,
  onProgress: ProgressCallback,
  signal?: AbortSignal,
  onPayload?: CodeCombPayloadCallback
): Promise<CodeCombSyncProgress> => {
  const progress: CodeCombSyncProgress = {
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

  // Determine limit based on mode
  let pageLimit: number;
  let maxRecords: number | null; // null means no limit (fetch all)
  if (testMode === 'single') {
    pageLimit = 1;
    maxRecords = 1;
  } else if (testMode === true) {
    pageLimit = 25;
    maxRecords = 25;
  } else {
    pageLimit = 500; // Fetch 500 per page for full sync
    maxRecords = null; // No limit - fetch all pages
  }

  const modeLabel = testMode === 'single' ? 'SINGLE RECORD DEBUG' : (testMode ? 'TEST MODE (25 records)' : 'FULL SYNC (all records)');
  log('step', '═══════════════════════════════════════════════════════════');
  log('step', `  GL CODE COMBINATIONS SYNC - ${modeLabel}`);
  log('step', '═══════════════════════════════════════════════════════════');

  try {
    let allRecords: any[] = [];
    let offset = 0;
    let hasMore = true;
    let pageNum = 0;

    // Fetch records with pagination
    while (hasMore && (maxRecords === null || allRecords.length < maxRecords)) {
      if (signal?.aborted) {
        log('warning', '⚠ Sync aborted by user');
        progress.status = 'stopped';
        progress.endTime = new Date();
        onProgress(progress);
        return progress;
      }

      pageNum++;
      const fetchLimit = maxRecords !== null
        ? Math.min(pageLimit, maxRecords - allRecords.length)
        : pageLimit;

      log('info', '');
      log('step', `──── Fetching Page ${pageNum} (offset: ${offset}, limit: ${fetchLimit}) ────`);

      const queryParams: Record<string, string> = {
        limit: String(fetchLimit),
        offset: String(offset),
      };

      // Add filter parameters if provided
      if (parameters.ChartOfAccountsId) {
        queryParams.q = `_CHART_OF_ACCOUNTS_ID=${parameters.ChartOfAccountsId}`;
      }
      if (parameters.EnabledFlag) {
        if (queryParams.q) {
          queryParams.q += `;EnabledFlag=${parameters.EnabledFlag}`;
        } else {
          queryParams.q = `EnabledFlag=${parameters.EnabledFlag}`;
        }
      }

      const result = await fetchFromOracle('accountCombinationsLOV', queryParams, log, true);

      if (!result.success || !result.items) {
        throw new Error(result.error || 'Failed to fetch code combinations');
      }

      const items = result.items;
      allRecords = [...allRecords, ...items];

      log('success', `Fetched ${items.length} records (Total: ${allRecords.length})`);

      // Check if there are more records - stop if we got less than requested
      hasMore = items.length === fetchLimit;
      offset += items.length;

      // Also check if we've reached maxRecords limit (for test modes)
      if (maxRecords !== null && allRecords.length >= maxRecords) {
        hasMore = false;
      }

      progress.currentPage = pageNum;
      progress.totalRecords = allRecords.length;
      onProgress(progress);
    }

    progress.totalRecords = allRecords.length;
    progress.totalPages = pageNum;
    log('success', `Total records fetched: ${allRecords.length}`);

    if (allRecords.length === 0) {
      log('warning', 'No records to sync');
      progress.status = 'completed';
      progress.endTime = new Date();
      onProgress(progress);
      return progress;
    }

    // Insert to APEX
    log('info', '');
    log('step', '══════════════════════════════════════════════════════════');
    log('step', '  INSERTING TO APEX DATABASE');
    log('step', '══════════════════════════════════════════════════════════');

    progress.status = 'inserting';
    onProgress(progress);

    // Process in batches of 50 for POST
    const batchSize = 50;
    const totalBatches = Math.ceil(allRecords.length / batchSize);

    for (let i = 0; i < allRecords.length; i += batchSize) {
      if (signal?.aborted) {
        log('warning', '⚠ Sync aborted by user');
        progress.status = 'stopped';
        progress.endTime = new Date();
        onProgress(progress);
        return progress;
      }

      const batch = allRecords.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;

      log('info', '');
      log('step', `──── POST Batch ${batchNum}/${totalBatches} (${batch.length} records) ────`);

      // Build payload matching the expected JSON structure
      const payload = {
        items: batch.map(item => ({
          AccountType: item.AccountType,
          DetailBudgetingAllowedFlag: item.DetailBudgetingAllowedFlag,
          JgzzReconFlag: item.JgzzReconFlag,
          FinancialCategory: item.FinancialCategory,
          DetailPostingAllowedFlag: item.DetailPostingAllowedFlag,
          Reference3: item.Reference3,
          SummaryFlag: item.SummaryFlag,
          StartDateActive: item.StartDateActive,
          EndDateActive: item.EndDateActive,
          EnabledFlag: item.EnabledFlag,
          _CODE_COMBINATION_ID: item._CODE_COMBINATION_ID,
          _CHART_OF_ACCOUNTS_ID: item._CHART_OF_ACCOUNTS_ID,
          buimercFinGlbCoaCo: item.buimercFinGlbCoaCo,
          buimercFinGlbCoaLob: item.buimercFinGlbCoaLob,
          buimercFinGlbCoaDepartment: item.buimercFinGlbCoaDepartment,
          buimercFinGlbCoaAccount: item.buimercFinGlbCoaAccount,
          buimercFinGlbCoaSubAcc: item.buimercFinGlbCoaSubAcc,
          buimercFinGlbCoaAlys: item.buimercFinGlbCoaAlys,
          buimercFinGlbCoaIc: item.buimercFinGlbCoaIc,
          buimercFinGlbCoaFut1: item.buimercFinGlbCoaFut1,
          buimercFinGlbCoaFut2: item.buimercFinGlbCoaFut2,
        }))
      };

      try {
        const result = await insertToApex('glcodecombinations/create', payload, log, true);

        if (result.status === 'SUCCESS') {
          const inserted = result.successCount || batch.length;
          progress.insertedRecords += inserted;
          log('success', `✓ Batch ${batchNum} inserted: ${inserted} records`);

          // Call payload callback for each record
          if (onPayload) {
            batch.forEach(item => {
              const concatenated = `${item.buimercFinGlbCoaCo}-${item.buimercFinGlbCoaLob}-${item.buimercFinGlbCoaDepartment}-${item.buimercFinGlbCoaAccount}`;
              onPayload(item._CODE_COMBINATION_ID, concatenated, item, result);
            });
          }
        } else {
          progress.errors++;
          progress.lastError = result.message || 'Insert failed';
          log('error', `✗ Batch ${batchNum} failed: ${result.message || JSON.stringify(result)}`);

          if (onPayload) {
            batch.forEach(item => {
              const concatenated = `${item.buimercFinGlbCoaCo}-${item.buimercFinGlbCoaLob}-${item.buimercFinGlbCoaDepartment}-${item.buimercFinGlbCoaAccount}`;
              onPayload(item._CODE_COMBINATION_ID, concatenated, item, result, result.message);
            });
          }
        }
      } catch (error) {
        progress.errors++;
        progress.lastError = error instanceof Error ? error.message : 'Unknown error';
        log('error', `✗ Batch ${batchNum} error: ${progress.lastError}`);

        if (onPayload) {
          batch.forEach(item => {
            const concatenated = `${item.buimercFinGlbCoaCo}-${item.buimercFinGlbCoaLob}-${item.buimercFinGlbCoaDepartment}-${item.buimercFinGlbCoaAccount}`;
            onPayload(item._CODE_COMBINATION_ID, concatenated, item, undefined, progress.lastError);
          });
        }
      }

      progress.processedRecords = i + batch.length;
      onProgress(progress);
    }

    // Complete
    progress.status = 'completed';
    progress.endTime = new Date();
    onProgress(progress);

    log('info', '');
    log('step', '═══════════════════════════════════════════════════════════');
    log('success', `  ✓ SYNC COMPLETED`);
    log('success', `    Total Records: ${progress.totalRecords}`);
    log('success', `    Inserted: ${progress.insertedRecords}`);
    log('success', `    Errors: ${progress.errors}`);
    log('step', '═══════════════════════════════════════════════════════════');

    return progress;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    progress.status = 'error';
    progress.lastError = errorMsg;
    progress.endTime = new Date();
    onProgress(progress);

    log('error', '');
    log('error', '═══════════════════════════════════════════════════════════');
    log('error', `  ✗ SYNC FAILED: ${errorMsg}`);
    log('error', '═══════════════════════════════════════════════════════════');

    return progress;
  }
};
