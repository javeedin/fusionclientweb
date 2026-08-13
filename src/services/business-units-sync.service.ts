import { fetchFromOracle, insertToApex } from './sync-http';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BusinessUnitsSyncProgress {
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
export type ProgressCallback = (progress: Partial<BusinessUnitsSyncProgress>) => void;

// ─── Public API ───────────────────────────────────────────────────────────────

// Test connection to Oracle Fusion finBusinessUnitsLOV endpoint
export const testBusinessUnitsConnection = async (log: LogCallback): Promise<boolean> => {
  try {
    log('info', 'Testing Business Units endpoint...');

    const result = await fetchFromOracle(
      'finBusinessUnitsLOV',
      { limit: '1' },
      log,
      true
    );

    if (result.success && result.items) {
      log('success', `Connection successful! Sample record: ${JSON.stringify(result.items[0])}`);
      return true;
    } else {
      log('error', 'Connection failed: No data returned');
      return false;
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    log('error', `Connection test failed: ${errorMsg}`);
    return false;
  }
};

// Main sync: GET finBusinessUnitsLOV → POST gl/businessunits
export const syncBusinessUnits = async (
  _parameters: Record<string, string>,
  testMode: boolean | 'single',
  log: LogCallback,
  onProgress: ProgressCallback,
  signal?: AbortSignal
): Promise<BusinessUnitsSyncProgress> => {

  const progress: BusinessUnitsSyncProgress = {
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

  // Determine fetch limit based on mode
  let pageLimit: number;
  let maxRecords: number | null;
  if (testMode === 'single') {
    pageLimit = 1;
    maxRecords = 1;
  } else if (testMode === true) {
    pageLimit = 25;
    maxRecords = 25;
  } else {
    pageLimit = 500;
    maxRecords = null;
  }

  const modeLabel = testMode === 'single'
    ? 'SINGLE RECORD DEBUG'
    : testMode
      ? 'TEST MODE (25 records)'
      : 'FULL SYNC (all records)';

  log('step', '═══════════════════════════════════════════════════════════');
  log('step', `  BUSINESS UNITS SYNC - ${modeLabel}`);
  log('step', '═══════════════════════════════════════════════════════════');

  try {
    // ── Phase 1: Fetch from Oracle Fusion ──────────────────────────────────
    let allRecords: any[] = [];
    let offset = 0;
    let hasMore = true;
    let pageNum = 0;

    while (hasMore && (maxRecords === null || allRecords.length < maxRecords)) {
      if (signal?.aborted) {
        log('warning', 'Sync aborted by user');
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

      const result = await fetchFromOracle(
        'finBusinessUnitsLOV',
        { limit: String(fetchLimit), offset: String(offset) },
        log,
        true
      );

      if (!result.success || !result.items) {
        throw new Error(result.error || 'Failed to fetch business units');
      }

      const items = result.items;
      allRecords = [...allRecords, ...items];

      log('success', `Fetched ${items.length} records (Total: ${allRecords.length})`);

      hasMore = items.length === fetchLimit;
      offset += items.length;

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

    // ── Phase 2: POST batches to APEX ──────────────────────────────────────
    log('info', '');
    log('step', '══════════════════════════════════════════════════════════');
    log('step', '  INSERTING TO APEX DATABASE');
    log('step', '══════════════════════════════════════════════════════════');

    progress.status = 'inserting';
    onProgress(progress);

    const batchSize = 50;
    const totalBatches = Math.ceil(allRecords.length / batchSize);

    for (let i = 0; i < allRecords.length; i += batchSize) {
      if (signal?.aborted) {
        log('warning', 'Sync aborted by user');
        progress.status = 'stopped';
        progress.endTime = new Date();
        onProgress(progress);
        return progress;
      }

      const batch = allRecords.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;

      log('info', '');
      log('step', `──── POST Batch ${batchNum}/${totalBatches} (${batch.length} records) ────`);

      // Map Fusion field names exactly as returned by finBusinessUnitsLOV
      const payload = {
        items: batch.map(item => ({
          BusinessUnitId:    item.BusinessUnitId,
          BusinessUnitName:  item.BusinessUnitName,
          ActiveFlag:        item.ActiveFlag,
          PrimaryLedgerId:   item.PrimaryLedgerId,
          LocationId:        item.LocationId,
          ManagerId:         item.ManagerId,
          LegalEntityId:     item.LegalEntityId,
          ProfitCenterFlag:  item.ProfitCenterFlag,
          Company:           item.Company,
        })),
      };

      try {
        const result = await insertToApex('gl/businessunits', payload, log, true);

        if (result.status === 'success') {
          const inserted = result.count || batch.length;
          progress.insertedRecords += inserted;
          log('success', `Batch ${batchNum} inserted: ${inserted} records`);
        } else {
          progress.errors++;
          progress.lastError = result.message || 'Insert failed';
          log('error', `Batch ${batchNum} failed: ${result.message || JSON.stringify(result)}`);
        }
      } catch (error) {
        progress.errors++;
        progress.lastError = error instanceof Error ? error.message : 'Unknown error';
        log('error', `Batch ${batchNum} error: ${progress.lastError}`);
      }

      progress.processedRecords = i + batch.length;
      onProgress(progress);
    }

    // ── Complete ────────────────────────────────────────────────────────────
    progress.status = 'completed';
    progress.endTime = new Date();
    onProgress(progress);

    log('info', '');
    log('step', '═══════════════════════════════════════════════════════════');
    log('success', '  SYNC COMPLETED');
    log('success', `    Total Records  : ${progress.totalRecords}`);
    log('success', `    Inserted       : ${progress.insertedRecords}`);
    log('success', `    Errors         : ${progress.errors}`);
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
    log('error', `  SYNC FAILED: ${errorMsg}`);
    log('error', '═══════════════════════════════════════════════════════════');

    return progress;
  }
};
