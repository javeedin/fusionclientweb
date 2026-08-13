import { fetchFromOracle, insertToApex } from './sync-http';

export interface BankAccountTransfersSyncProgress {
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
export type ProgressCallback = (progress: Partial<BankAccountTransfersSyncProgress>) => void;
export type BankAccountTransfersPayloadCallback = (
  transferId: number,
  transferNumber: number,
  payload: any,
  result?: any,
  error?: string
) => void;

export const testBankAccountTransfersConnection = async (log: LogCallback): Promise<boolean> => {
  try {
    log('info', 'Testing Bank Account Transfers endpoint...');
    const result = await fetchFromOracle('cashBankAccountTransfers', { limit: '1' }, log, true);
    if (result.success && result.items) {
      log('success', `Connection successful! Sample: ${JSON.stringify(result.items[0])}`);
      return true;
    }
    log('error', 'Connection failed: No data returned');
    return false;
  } catch (error) {
    log('error', `Connection test failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return false;
  }
};

export const syncBankAccountTransfers = async (
  parameters: Record<string, string>,
  testMode: boolean | 'single',
  log: LogCallback,
  onProgress: ProgressCallback,
  signal?: AbortSignal,
  onPayload?: BankAccountTransfersPayloadCallback
): Promise<BankAccountTransfersSyncProgress> => {
  const FETCH_LIMIT = testMode === 'single' ? 1 : testMode ? 25 : 500;
  const BATCH_SIZE  = 50;

  const progress: BankAccountTransfersSyncProgress = {
    status: 'fetching', totalRecords: 0, processedRecords: 0,
    insertedRecords: 0, currentPage: 0, totalPages: 0,
    errors: 0, lastError: '', startTime: new Date(), endTime: null,
  };

  onProgress({ ...progress });

  const buildQueryParams = (limit: number, offset: number): Record<string, string> => {
    const p: Record<string, string> = { limit: String(limit), offset: String(offset) };
    if (parameters.TransactionDateFrom && parameters.TransactionDateTo) {
      p['q'] = `TransactionDate>="${parameters.TransactionDateFrom}";TransactionDate<="${parameters.TransactionDateTo}"`;
    } else if (parameters.TransactionDateFrom) {
      p['q'] = `TransactionDate>="${parameters.TransactionDateFrom}"`;
    }
    if (parameters.Status)       p['q'] = (p['q'] ? p['q'] + ';' : '') + `Status="${parameters.Status}"`;
    if (parameters.BusinessUnit) p['q'] = (p['q'] ? p['q'] + ';' : '') + `Businessunit="${parameters.BusinessUnit}"`;
    return p;
  };

  const processPage = async (items: any[], pageNum: number, totalBatches: number) => {
    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      if (signal?.aborted) break;
      const batch     = items.slice(i, i + BATCH_SIZE);
      const batchNum  = Math.floor(i / BATCH_SIZE) + 1;

      log('step', `──── POST Batch ${batchNum}/${totalBatches} — Page ${pageNum} (${batch.length} records) ────`);

      const payload = {
        items: batch.map(item => ({
          BankAccountTransferId:     item.BankAccountTransferId,
          BankAccountTransferNumber: item.BankAccountTransferNumber,
          TransactionDate:           item.TransactionDate,
          Memo:                      item.Memo,
          PaymentRequestId:          item.PaymentRequestId,
          PaymentAmount:             item.PaymentAmount,
          FromAmount:                item.FromAmount,
          FromExternalTrxId:         item.FromExternalTrxId,
          ToExternalTrxId:           item.ToExternalTrxId,
          ConversionRate:            item.ConversionRate,
          FromBankAccountName:       item.FromBankAccountName,
          ToBankAccountName:         item.ToBankAccountName,
          FromCurrencyCode:          item.FromCurrencyCode,
          ToCurrencyCode:            item.ToCurrencyCode,
          PaymentCurrencyCode:       item.PaymentCurrencyCode,
          ConversionRateType:        item.ConversionRateType,
          Status:                    item.Status,
          PaymentStatus:             item.PaymentStatus,
          PaymentMethod:             item.PaymentMethod,
          PaymentProfileName:        item.PaymentProfileName,
          Businessunit:              item.Businessunit,
          PaymentFile:               item.PaymentFile,
          IsSettledWithIbyFlag:      item.IsSettledWithIbyFlag,
          CreatedBy:                 item.CreatedBy,
          CreationDate:              item.CreationDate,
          LastUpdatedBy:             item.LastUpdatedBy,
          LastUpdateDate:            item.LastUpdateDate,
          LastUpdateLogin:           item.LastUpdateLogin,
        })),
      };

      try {
        const result = await insertToApex('cash/banktransfers', payload, log, true);
        if (result.status === 'success') {
          const inserted = result.count || batch.length;
          progress.insertedRecords += inserted;
          log('success', `Batch ${batchNum} inserted: ${inserted} records`);
          batch.forEach(item => onPayload?.(item.BankAccountTransferId, item.BankAccountTransferNumber, item, result));
        } else {
          progress.errors++;
          progress.lastError = result.message || 'Insert failed';
          log('error', `Batch ${batchNum} failed: ${result.message || JSON.stringify(result)}`);
          batch.forEach(item => onPayload?.(item.BankAccountTransferId, item.BankAccountTransferNumber, item, result, result.message));
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        progress.errors++;
        progress.lastError = msg;
        log('error', `Batch ${batchNum} error: ${msg}`);
        batch.forEach(item => onPayload?.(item.BankAccountTransferId, item.BankAccountTransferNumber, item, undefined, msg));
      }

      progress.processedRecords += batch.length;
      onProgress({ ...progress });
    }
  };

  const modeLabel = testMode === 'single' ? 'SINGLE RECORD DEBUG' : testMode ? 'TEST MODE (25 records)' : 'FULL SYNC (all records)';

  try {
    log('step', '═══════════════════════════════════════════════════════════');
    log('step', `  BANK ACCOUNT TRANSFERS SYNC — ${modeLabel}`);
    log('step', '═══════════════════════════════════════════════════════════');

    let offset  = 0;
    let pageNum = 0;
    let hasMore = true;

    while (hasMore) {
      if (signal?.aborted) {
        log('warning', 'Sync aborted by user');
        progress.status  = 'stopped';
        progress.endTime = new Date();
        onProgress({ ...progress });
        return progress;
      }

      pageNum++;
      progress.currentPage = pageNum;
      onProgress({ currentPage: pageNum });

      log('step', `──── Fetching Page ${pageNum} (offset: ${offset}, limit: ${FETCH_LIMIT}) ────`);

      const result = await fetchFromOracle(
        'cashBankAccountTransfers',
        buildQueryParams(FETCH_LIMIT, offset),
        log,
        true
      );

      if (!result.success || !result.items) {
        throw new Error(result.error || 'Failed to fetch bank account transfers');
      }

      const items: any[] = result.items;
      log('success', `Page ${pageNum}: ${items.length} records fetched (total so far: ${progress.totalRecords + items.length})`);

      if (items.length === 0) break;

      progress.totalRecords += items.length;
      onProgress({ totalRecords: progress.totalRecords });

      const totalBatches = Math.ceil(items.length / BATCH_SIZE);
      await processPage(items, pageNum, totalBatches);

      if (signal?.aborted) break;

      // Oracle returns hasMore=true when more pages exist;
      // fall back to checking if we got a full page
      hasMore = result.hasMore === true || items.length === FETCH_LIMIT;
      offset += items.length;

      // In test mode only fetch one page
      if (testMode) hasMore = false;
    }

    progress.totalPages = pageNum;
    progress.status     = signal?.aborted ? 'stopped' : 'completed';
    progress.endTime    = new Date();
    onProgress({ ...progress });

    log('step', '═══════════════════════════════════════════════════════════');
    log('success', '  SYNC COMPLETED');
    log('success', `    Pages:    ${pageNum}`);
    log('success', `    Records:  ${progress.totalRecords}`);
    log('success', `    Inserted: ${progress.insertedRecords}`);
    log('success', `    Errors:   ${progress.errors}`);
    log('step', '═══════════════════════════════════════════════════════════');

    return progress;

  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    progress.status    = 'error';
    progress.lastError = msg;
    progress.endTime   = new Date();
    onProgress({ ...progress });

    log('error', '═══════════════════════════════════════════════════════════');
    log('error', `  SYNC FAILED: ${msg}`);
    log('error', '═══════════════════════════════════════════════════════════');

    return progress;
  }
};
