import { ORACLE_FUSION_CONFIG, APEX_DB_CONFIG } from '../config/api.config';
import { fetchFromOracleUrl, insertToApex, fetchFromApex } from './sync-http';

// Types
export interface APPayment {
  CheckId: number;
  CheckNumber: number;
  PaymentNumber: string;
  PaymentAmount: number;
  PaymentCurrency: string;
  PaymentDate: string;
  PaymentStatus: string;
  Payee: string;
  PayeeNumber: string;
  SupplierNumber: string;
  SupplierSite: string;
  BusinessUnit: string;
  BankAccountNumber: string;
  BankAccountName: string;
  PaymentMethod: string;
  PaymentDocument: string;
  VoidDate: string;
  ClearedDate: string;
  ClearedAmount: number;
  MaturityDate: string;
  ExchangeRate: number;
  ExchangeRateType: string;
  ExchangeDate: string;
  BaseCurrencyCode: string;
  CreatedBy: string;
  CreationDate: string;
  LastUpdatedBy: string;
  LastUpdateDate: string;
  LastUpdateLogin: string;
  links?: any[];
  [key: string]: any;
}

export interface APPaymentRelatedInvoice {
  InvoicePaymentId: number;
  CheckId: number;
  InvoiceId: number;
  InvoiceBusinessUnit: string;
  InvoiceNumber: string;
  InstallmentNumber: number;
  AmountPaidPaymentCurrency: number;
  AmountPaidInvoiceCurrency: number;
  InvoicePaymentAmount: number;
  InvoiceAmount: number;
  InvoiceBaseAmount: number;
  PaymentBaseAmount: number;
  DiscountLost: number;
  DiscountTaken: number;
  InvoiceCurrency: string;
  CrossCurrencyRate: number;
  InvoicePaymentStatus: string;
  CreatedBy: string;
  CreationDate: string;
  LastUpdatedBy: string;
  LastUpdateDate: string;
  LastUpdateLogin: string;
  [key: string]: any;
}

export interface APPaymentsSyncProgress {
  status: 'idle' | 'fetching' | 'inserting' | 'completed' | 'error' | 'stopped';
  // Payments
  totalPayments: number;
  processedPayments: number;
  insertedPayments: number;
  currentPaymentNumber: string;
  // Related Invoices
  totalRelatedInvoices: number;
  processedRelatedInvoices: number;
  // Pagination
  currentPage: number;
  totalPages: number;
  // Errors
  errors: number;
  lastError: string;
  // Timing
  startTime: Date | null;
  endTime: Date | null;
}

export type LogCallback = (type: 'info' | 'success' | 'error' | 'warning' | 'step', message: string) => void;
export type ProgressCallback = (progress: Partial<APPaymentsSyncProgress>) => void;

// Payment payload callback for debugging
export type PaymentPayloadCallback = (
  checkId: number,
  paymentNumber: string,
  payload: any,
  result?: any,
  error?: string,
  relatedInvoicesInfo?: { fetched: number; inserted: number; error?: string }
) => void;

// APEX endpoints for AP Payments
const APEX_PAYMENTS_ENDPOINT = 'ap/payments';
const APEX_RELATED_INVOICES_ENDPOINT = 'ap/payments/related-invoices';

// Fetch related invoices for a payment from Oracle Fusion
const fetchRelatedInvoicesFromOracle = async (
  checkId: number,
  relatedInvoicesLink?: string,
  log?: LogCallback,
  verbose = true
): Promise<{ success: boolean; items: APPaymentRelatedInvoice[]; error?: string }> => {
  try {
    // Use provided link or construct URL
    const oracleUrl = relatedInvoicesLink ||
      `${ORACLE_FUSION_CONFIG.baseUrl}/payablesPayments/${checkId}/child/relatedInvoices`;

    if (verbose) {
      log?.('info', `Fetching related invoices for Payment ${checkId}...`);
      log?.('info', `Oracle URL: ${oracleUrl}`);
    }

    const data = await fetchFromOracleUrl(oracleUrl, log, verbose);

    if (verbose) {
      log?.('step', `──── [GET] Related Invoices Response for Payment ${checkId} ────`);
    }

    const items = data.items || [];

    if (verbose) {
      log?.('success', `Fetched ${items.length} related invoices for Payment ${checkId}`);
      items.slice(0, 5).forEach((inv: any, idx: number) => {
        log?.('info', `  Invoice ${idx + 1}: ${inv.InvoiceNumber}, Amount=${inv.AmountPaidPaymentCurrency}`);
      });
      if (items.length > 5) {
        log?.('info', `  ... and ${items.length - 5} more invoices`);
      }
    }

    return {
      success: true,
      items: Array.isArray(items) ? items : [],
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    log?.('error', `Fetch Related Invoices Error: ${errorMsg}`);
    return { success: false, items: [], error: errorMsg };
  }
};

// Insert related invoices to APEX
const insertRelatedInvoicesToApex = async (
  checkId: number,
  invoices: APPaymentRelatedInvoice[],
  log?: LogCallback,
  verbose = true
): Promise<{ success: boolean; error?: string; response?: any; successCount: number }> => {
  try {
    if (invoices.length === 0) {
      return { success: true, successCount: 0 };
    }

    // Remove links from each invoice and ensure CheckId is set
    const invoicesWithCheckId = invoices.map(inv => {
      const { links, ...invWithoutLinks } = inv as any;
      return {
        CheckId: checkId,
        ...invWithoutLinks,
      };
    });

    const payload = {
      items: invoicesWithCheckId
    };

    if (verbose) {
      log?.('step', `──── [POST] APEX - Related Invoices for Payment ${checkId} (${invoices.length} invoices) ────`);
      log?.('info', `Invoices count: ${invoices.length}`);
      log?.('step', `──── POST PAYLOAD ────`);
      log?.('info', JSON.stringify(payload, null, 2));
    }

    const data = await insertToApex(APEX_RELATED_INVOICES_ENDPOINT, payload, log, verbose);

    if (verbose) {
      log?.('step', `──── POST RESPONSE ────`);
      log?.('success', `Response: ${JSON.stringify(data, null, 2)}`);
    }

    const isSuccess = data.status === 'success' || data.status === 'SUCCESS' ||
                      (data.saved !== undefined && data.saved > 0);

    return {
      success: isSuccess,
      error: isSuccess ? undefined : (data.message || data.error || 'No invoices inserted'),
      response: data,
      successCount: data.saved || data.successCount || 0,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    log?.('error', `POST Related Invoices Error: ${errorMsg}`);
    return { success: false, error: errorMsg, successCount: 0 };
  }
};

// Fetch payments from Oracle Fusion
const fetchPaymentsFromOracle = async (
  params: Record<string, string> = {},
  log?: LogCallback,
  verbose = true
): Promise<{ success: boolean; items: APPayment[]; hasMore: boolean; totalResults?: number; error?: string }> => {
  try {
    const queryParams = new URLSearchParams(params);
    const oracleUrl = `${ORACLE_FUSION_CONFIG.baseUrl}/payablesPayments?${queryParams.toString()}`;

    if (verbose) {
      log?.('step', '──── [GET] Oracle Fusion AP Payments ────');
      log?.('info', `Oracle URL: ${oracleUrl}`);
    }

    const data = await fetchFromOracleUrl(oracleUrl, log, verbose);
    const items = data.items || [];

    if (verbose) {
      log?.('success', `Fetched ${items.length} payments`);
    }

    return {
      success: true,
      items: items,
      hasMore: data.hasMore || false,
      totalResults: data.totalResults || data.count || items.length,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    log?.('error', `Fetch Error: ${errorMsg}`);
    return { success: false, items: [], hasMore: false, error: errorMsg };
  }
};

// Insert single payment to APEX
const insertPaymentToApex = async (
  payment: APPayment,
  log?: LogCallback,
  verbose = true
): Promise<{ success: boolean; error?: string; response?: any; payload?: any }> => {
  try {
    // Remove links property from payment (not needed for insert)
    const { links, ...paymentWithoutLinks } = payment as any;

    // Wrap payment in expected format (items array)
    const payload = {
      items: [paymentWithoutLinks]
    };

    // ALWAYS log the payment being posted (for debugging)
    log?.('step', `════════════════════════════════════════════════════════════`);
    log?.('step', `  POSTING PAYMENT: ${payment.PaymentNumber || payment.CheckNumber} (ID: ${payment.CheckId})`);
    log?.('step', `════════════════════════════════════════════════════════════`);
    log?.('info', `Check ID: ${payment.CheckId}`);
    log?.('info', `Payment Number: ${payment.PaymentNumber || payment.CheckNumber}`);
    log?.('info', `Payee: ${payment.Payee}`);
    log?.('info', `Supplier Number: ${payment.SupplierNumber}`);
    log?.('info', `Amount: ${payment.PaymentAmount} ${payment.PaymentCurrency}`);
    log?.('info', `Payment Date: ${payment.PaymentDate}`);
    log?.('info', `Payment Status: ${payment.PaymentStatus}`);
    log?.('info', `Business Unit: ${payment.BusinessUnit}`);

    if (verbose) {
      log?.('step', `──── POST PAYLOAD (Full JSON) ────`);
      log?.('info', JSON.stringify(payload, null, 2));
    }

    log?.('info', `Sending POST request...`);

    const data = await insertToApex(APEX_PAYMENTS_ENDPOINT, payload, log, verbose);

    log?.('step', `──── POST RESPONSE ────`);
    log?.('success', `Response: ${JSON.stringify(data, null, 2)}`);

    // Check for success
    const isSuccess = data.status === 'success' || data.status === 'SUCCESS' ||
                      (data.saved !== undefined && data.saved > 0) ||
                      (data.successCount !== undefined && data.successCount > 0);

    return {
      success: isSuccess,
      error: isSuccess ? undefined : (data.message || data.error || data.details || 'No payments inserted'),
      response: data,
      payload: payload,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    log?.('error', `POST Error: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
};

// Main AP Payments Sync Function
export const syncAPPayments = async (
  parameters: Record<string, string>,
  testMode: boolean | 'single' = true,
  log?: LogCallback,
  onProgress?: ProgressCallback,
  abortSignal?: AbortSignal,
  onPaymentPayload?: PaymentPayloadCallback
): Promise<APPaymentsSyncProgress> => {
  const progress: APPaymentsSyncProgress = {
    status: 'idle',
    totalPayments: 0,
    processedPayments: 0,
    insertedPayments: 0,
    currentPaymentNumber: '',
    totalRelatedInvoices: 0,
    processedRelatedInvoices: 0,
    currentPage: 0,
    totalPages: 0,
    errors: 0,
    lastError: '',
    startTime: new Date(),
    endTime: null,
  };

  const updateProgress = (updates: Partial<APPaymentsSyncProgress>) => {
    Object.assign(progress, updates);
    onProgress?.(progress);
  };

  // Determine limits based on mode
  let pageSize: number;
  let maxRecords: number | null; // null means no limit (fetch all)

  if (testMode === 'single') {
    pageSize = 1;
    maxRecords = 1;
  } else if (testMode === true) {
    pageSize = 25;
    maxRecords = 25;
  } else {
    pageSize = 25; // Fetch 25 per page for full sync
    maxRecords = null; // No limit - fetch all pages
  }

  const verbose = testMode !== false;
  const modeLabel = testMode === 'single' ? 'SINGLE RECORD DEBUG' : (testMode ? 'TEST MODE (25 payments)' : 'FULL SYNC (all payments)');

  try {
    // ========================================
    // STEP 1: Fetch Payments from Oracle Fusion
    // ========================================
    updateProgress({ status: 'fetching' });

    // Always log API endpoints for debugging
    log?.('step', '═══════════════════════════════════════════════════════════');
    log?.('step', `  AP PAYMENTS SYNC - ${modeLabel}`);
    log?.('step', '═══════════════════════════════════════════════════════════');
    log?.('step', '  API ENDPOINTS:');
    log?.('info', '  ┌─────────────────────────────────────────────────────────');
    log?.('info', '  │ FUSION GET (Source):');
    log?.('info', `  │   Payments:         ${ORACLE_FUSION_CONFIG.baseUrl}/payablesPayments`);
    log?.('info', `  │   Related Invoices: ${ORACLE_FUSION_CONFIG.baseUrl}/payablesPayments/{checkId}/child/relatedInvoices`);
    log?.('info', '  │');
    log?.('info', '  │ APEX POST (Target):');
    log?.('info', `  │   Payments:         ${APEX_DB_CONFIG.baseUrl}/${APEX_PAYMENTS_ENDPOINT}`);
    log?.('info', `  │   Related Invoices: ${APEX_DB_CONFIG.baseUrl}/${APEX_RELATED_INVOICES_ENDPOINT}`);
    log?.('info', '  └─────────────────────────────────────────────────────────');
    log?.('step', '═══════════════════════════════════════════════════════════');

    if (verbose) {
      log?.('info', `Parameters: ${JSON.stringify(parameters)}`);
      log?.('info', `Max Records: ${maxRecords === null ? 'Unlimited (all pages)' : maxRecords}, Page Size: ${pageSize}`);
    } else {
      log?.('info', `Starting AP Payments sync - ${modeLabel}`);
    }

    let allPayments: APPayment[] = [];
    let currentPage = 0;
    let hasMore = true;

    // Fetch with pagination
    while (hasMore && (maxRecords === null || allPayments.length < maxRecords) && !abortSignal?.aborted) {
      currentPage++;
      updateProgress({ currentPage });

      const offset = (currentPage - 1) * pageSize;
      const fetchLimit = maxRecords !== null
        ? Math.min(pageSize, maxRecords - allPayments.length)
        : pageSize;

      if (verbose) {
        log?.('info', `Page ${currentPage}: Fetching offset=${offset}, limit=${fetchLimit}`);
      }

      // Build query parameters
      const queryParams: Record<string, string> = {
        limit: fetchLimit.toString(),
        offset: offset.toString(),
      };

      // Add filter parameters
      const filters = Object.entries(parameters)
        .filter(([, value]) => value)
        .map(([key, value]) => `${key}=${value}`)
        .join(';');

      if (filters) {
        queryParams.q = filters;
      }

      const result = await fetchPaymentsFromOracle(queryParams, log, verbose);

      if (!result.success) {
        updateProgress({
          status: 'error',
          lastError: result.error || 'Failed to fetch payments',
          endTime: new Date()
        });
        return progress;
      }

      if (result.items.length === 0) {
        if (verbose) {
          log?.('info', 'No more payments to fetch');
        }
        hasMore = false;
        break;
      }

      allPayments = [...allPayments, ...result.items];
      // Check if there are more records - also check if we got less than requested (end of data)
      hasMore = result.hasMore && result.items.length === fetchLimit;
      // Also check if we've reached maxRecords limit (for test modes)
      if (maxRecords !== null && allPayments.length >= maxRecords) {
        hasMore = false;
      }

      if (verbose) {
        log?.('success', `Page ${currentPage}: Fetched ${result.items.length} payments (Total: ${allPayments.length})`);
      }

      // Small delay between pages
      if (hasMore) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    updateProgress({
      totalPayments: allPayments.length,
    });

    if (verbose) {
      log?.('success', `Total payments fetched: ${allPayments.length}`);
    } else {
      log?.('info', `Fetched ${allPayments.length} payments from Oracle Fusion`);
    }

    if (allPayments.length === 0) {
      updateProgress({ status: 'completed', endTime: new Date() });
      log?.('warning', 'No payments found for the given parameters');
      return progress;
    }

    // ========================================
    // STEP 2: Insert Payments to APEX
    // ========================================
    updateProgress({ status: 'inserting' });
    if (verbose) {
      log?.('step', '═══════════════════════════════════════════════════════════');
      log?.('step', '  STEP 2: Inserting AP Payments to APEX Database');
      log?.('step', '═══════════════════════════════════════════════════════════');
      log?.('info', `POST Endpoint: ${APEX_DB_CONFIG.baseUrl}/${APEX_PAYMENTS_ENDPOINT}`);
    }

    // Process payments one by one
    for (let i = 0; i < allPayments.length; i++) {
      if (abortSignal?.aborted) {
        updateProgress({ status: 'stopped' });
        log?.('warning', 'Sync stopped by user');
        break;
      }

      const payment = allPayments[i];
      const paymentNum = payment.PaymentNumber || payment.CheckNumber?.toString() || `Payment ${i + 1}`;

      updateProgress({
        processedPayments: i,
        currentPaymentNumber: paymentNum,
      });

      if (verbose) {
        log?.('info', `[${i + 1}/${allPayments.length}] Processing: ${paymentNum} (ID: ${payment.CheckId})`);
      }

      // Record payload before POST for debugging
      onPaymentPayload?.(payment.CheckId, paymentNum, payment);

      const insertResult = await insertPaymentToApex(payment, log, verbose);

      if (insertResult.success) {
        updateProgress({
          insertedPayments: progress.insertedPayments + 1,
        });

        if (verbose) {
          log?.('success', `✓ Payment ${paymentNum} (ID: ${payment.CheckId}) inserted successfully`);
        }

        // ========================================
        // STEP 2b: Fetch and POST Related Invoices
        // ========================================
        // Find the related invoices link from payment.links
        let relatedInvoicesLink: string | undefined;
        if (payment.links && Array.isArray(payment.links)) {
          const relInvLink = payment.links.find((l: any) =>
            l.name === 'relatedInvoices' || l.rel === 'child' && l.href?.includes('relatedInvoices')
          );
          if (relInvLink?.href) {
            relatedInvoicesLink = relInvLink.href;
          }
        }

        const invoicesResult = await fetchRelatedInvoicesFromOracle(
          payment.CheckId,
          relatedInvoicesLink,
          log,
          verbose
        );

        // Track related invoices info for debug callback
        let relInvInfo = { fetched: 0, inserted: 0, error: undefined as string | undefined };

        if (invoicesResult.success && invoicesResult.items.length > 0) {
          relInvInfo.fetched = invoicesResult.items.length;

          // Update total related invoices count
          updateProgress({
            totalRelatedInvoices: progress.totalRelatedInvoices + invoicesResult.items.length,
          });

          // POST related invoices to APEX
          const invInsertResult = await insertRelatedInvoicesToApex(
            payment.CheckId,
            invoicesResult.items,
            log,
            verbose
          );

          if (invInsertResult.success) {
            relInvInfo.inserted = invInsertResult.successCount || invoicesResult.items.length;
            updateProgress({
              processedRelatedInvoices: progress.processedRelatedInvoices + relInvInfo.inserted,
            });
            if (verbose) {
              log?.('success', `✓ ${relInvInfo.inserted} related invoices inserted for ${paymentNum}`);
            }
          } else {
            relInvInfo.error = invInsertResult.error || 'Related invoices insert failed';
            updateProgress({
              errors: progress.errors + 1,
              lastError: invInsertResult.error || 'Related invoices insert failed',
            });
            log?.('error', `✗ Related invoices failed for ${paymentNum}: ${invInsertResult.error}`);
          }
        } else if (invoicesResult.success && invoicesResult.items.length === 0) {
          if (verbose) {
            log?.('info', `No related invoices found for ${paymentNum}`);
          }
        } else if (!invoicesResult.success) {
          relInvInfo.error = invoicesResult.error || 'Failed to fetch related invoices';
          log?.('error', `✗ Failed to fetch related invoices for ${paymentNum}: ${invoicesResult.error}`);
        }

        // Update payload callback with success result AND related invoices info
        onPaymentPayload?.(payment.CheckId, paymentNum, payment, insertResult.response, undefined, relInvInfo);

      } else {
        updateProgress({
          errors: progress.errors + 1,
          lastError: insertResult.error || 'Insert failed',
        });

        // Update payload callback with error
        onPaymentPayload?.(payment.CheckId, paymentNum, payment, insertResult.response, insertResult.error);

        log?.('error', `✗ Payment ${paymentNum} (ID: ${payment.CheckId}) failed: ${insertResult.error}`);
      }

      // Small delay between inserts to prevent API throttling
      if (i < allPayments.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }

    updateProgress({ processedPayments: allPayments.length });

    // ========================================
    // COMPLETE
    // ========================================
    updateProgress({
      status: abortSignal?.aborted ? 'stopped' : 'completed',
      endTime: new Date(),
    });

    // Always show brief completion summary
    log?.('success', `✓ Sync completed: ${progress.insertedPayments} payments, ${progress.processedRelatedInvoices} related invoices inserted`);
    if (progress.errors > 0) {
      log?.('warning', `⚠ ${progress.errors} errors occurred`);
    }

    if (verbose) {
      log?.('step', '═══════════════════════════════════════════════════════════');
      log?.('step', '  SYNC COMPLETED');
      log?.('step', '═══════════════════════════════════════════════════════════');
      log?.('success', `Total Payments Processed: ${progress.processedPayments}`);
      log?.('success', `Total Payments Inserted: ${progress.insertedPayments}`);
      log?.('success', `Related Invoices Inserted: ${progress.processedRelatedInvoices}`);
      log?.('info', `Errors: ${progress.errors}`);
    }

    return progress;

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    updateProgress({
      status: 'error',
      lastError: errorMsg,
      endTime: new Date(),
    });
    log?.('error', `Sync failed: ${errorMsg}`);
    return progress;
  }
};

// Test Oracle Fusion connection for AP Payments
export const testAPPaymentsConnection = async (log?: LogCallback): Promise<boolean> => {
  try {
    log?.('info', 'Testing Oracle Fusion AP Payments connection...');

    const result = await fetchPaymentsFromOracle({ limit: '1', offset: '0' }, log);

    if (result.success) {
      log?.('success', 'Oracle Fusion AP Payments connection successful!');
      log?.('info', `Sample data available: ${result.items?.length || 0} payments`);
      return true;
    }

    log?.('error', 'Connection test failed');
    return false;
  } catch (error) {
    log?.('error', `Connection test error: ${error}`);
    return false;
  }
};

// Get AP Payments statistics from APEX
export const getAPPaymentsStats = async (log?: LogCallback): Promise<{
  totalPayments: number;
  negotiableCount: number;
  voidedCount: number;
  clearedCount: number;
  reconciledCount: number;
  totalAmount: number;
  lastSyncDate: string;
} | null> => {
  try {
    log?.('info', 'Fetching AP Payments statistics...');

    const data = await fetchFromApex('ap/payments/stats', {}, log, false);

    if (data.success || data.items) {
      log?.('success', 'Statistics retrieved successfully');
      return data.items?.[0] || null;
    }

    log?.('error', `Failed to get statistics: ${data.error}`);
    return null;
  } catch (error) {
    log?.('error', `Stats error: ${error}`);
    return null;
  }
};
