import { ORACLE_FUSION_CONFIG, APEX_DB_CONFIG } from '../config/api.config';
import { fetchFromOracle, fetchFromOracleUrl, fetchAllFromOracleUrl, insertToApex, fetchFromApex } from './sync-http';

// Types
export interface APInvoice {
  InvoiceId: number;
  InvoiceNumber: string;
  InvoiceCurrency: string;
  PaymentCurrency: string;
  InvoiceAmount: number;
  InvoiceDate: string;
  BusinessUnit: string;
  Supplier: string;
  SupplierNumber: string;
  SupplierSite: string;
  InvoiceType: string;
  Description: string;
  ValidationStatus: string;
  ApprovalStatus: string;
  PaidStatus: string;
  AccountingStatus: string;
  // Child counts (from links)
  invoiceHeaders?: any[];
  invoiceLines?: any[];
  invoiceDistributions?: any[];
  links?: any[];
  [key: string]: any;
}

export interface APSyncProgress {
  status: 'idle' | 'fetching' | 'inserting' | 'completed' | 'error' | 'stopped';
  // Invoices
  totalInvoices: number;
  processedInvoices: number;
  insertedInvoices: number;
  currentInvoiceNumber: string;
  // Headers (child data)
  totalHeaders: number;
  processedHeaders: number;
  // Lines (child data)
  totalLines: number;
  processedLines: number;
  // Distributions (child data)
  totalDistributions: number;
  processedDistributions: number;
  // Installments (child data)
  totalInstallments: number;
  processedInstallments: number;
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
export type ProgressCallback = (progress: Partial<APSyncProgress>) => void;

// Invoice payload callback for debugging
export type InvoicePayloadCallback = (
  invoiceId: number,
  invoiceNumber: string,
  payload: any,
  result?: any,
  error?: string,
  linesInfo?: { fetched: number; inserted: number; linesError?: string },
  installmentsInfo?: { fetched: number; inserted: number; installmentsError?: string }
) => void;

// APEX endpoint for creating invoices
const APEX_CREATE_INVOICE_ENDPOINT = 'ap/createinvoice';
const APEX_CREATE_INVOICE_LINES_ENDPOINT = 'ap/createinvoiceslines';
const APEX_CREATE_INVOICE_INSTALLMENTS_ENDPOINT = 'ap/createinvoice/installments';

// Invoice Lines type
export interface APInvoiceLine {
  InvoiceId: number;
  InvoiceNumber?: string;
  LineNumber: number;
  LineAmount: number;
  LineType: string;
  Description: string;
  AccountingDate: string;
  DistributionCombination: string;
  [key: string]: any;
}

// Invoice Installments type
export interface APInvoiceInstallment {
  InvoiceId: number;
  InvoiceNumber?: string;
  InstallmentNumber: number;
  UnpaidAmount: number | null;
  FirstDiscountAmount: number | null;
  FirstDiscountDate: string | null;
  DueDate: string;
  GrossAmount: number;
  HoldReason: string | null;
  PaymentPriority: number;
  SecondDiscountAmount: number | null;
  SecondDiscountDate: string | null;
  ThirdDiscountAmount: number | null;
  ThirdDiscountDate: string | null;
  NetAmountOne: number | null;
  NetAmountTwo: number | null;
  NetAmountThree: number | null;
  HoldFlag: boolean;
  HeldBy: string | null;
  HoldType: string | null;
  PaymentMethod: string | null;
  PaymentMethodCode: string | null;
  HoldDate: string | null;
  BankAccount: string | null;
  ExternalBankAccountId: number | null;
  CreatedBy: string;
  CreationDate: string;
  LastUpdateDate: string;
  LastUpdatedBy: string;
  LastUpdateLogin: string | null;
  RemitToAddressName: string | null;
  RemitToSupplier: string | null;
  RemittanceMessageOne: string | null;
  RemittanceMessageTwo: string | null;
  RemittanceMessageThree: string | null;
  DigitalPaymentAccount: string | null;
  [key: string]: any;
}

// Fetch invoice lines from Oracle Fusion (paginated at 500/page to get all lines)
const fetchInvoiceLinesFromOracle = async (
  invoiceId: number,
  log?: LogCallback,
  verbose = true
): Promise<{ success: boolean; items: APInvoiceLine[]; error?: string }> => {
  try {
    if (verbose) {
      log?.('info', `Fetching lines for Invoice ${invoiceId}...`);
    }

    const items = await fetchAllFromOracleUrl(
      `${ORACLE_FUSION_CONFIG.baseUrl}/invoices/${invoiceId}/child/invoiceLines`,
      log,
      verbose,
      500
    );

    if (verbose) {
      log?.('success', `Fetched ${items.length} lines for Invoice ${invoiceId}`);
      items.forEach((line: any, idx: number) => {
        log?.('info', `  Line ${idx + 1}: LineNumber=${line.LineNumber}, Amount=${line.LineAmount}, Type=${line.LineTypeLookupCode || line.LineType}`);
      });
    }

    return {
      success: true,
      items,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    log?.('error', `Fetch Lines Error: ${errorMsg}`);
    return { success: false, items: [], error: errorMsg };
  }
};

// Insert invoice lines to APEX
const insertInvoiceLinesToApex = async (
  invoiceId: number,
  invoiceNumber: string,
  lines: APInvoiceLine[],
  log?: LogCallback,
  verbose = true
): Promise<{ success: boolean; error?: string; response?: any; successCount: number }> => {
  try {
    if (lines.length === 0) {
      return { success: true, successCount: 0 };
    }

    // Add InvoiceId and InvoiceNumber FIRST to each line, then rest of properties, remove links
    const linesWithInvoiceInfo = lines.map(line => {
      const { links, ...lineWithoutLinks } = line as any;
      return {
        InvoiceId: invoiceId,
        InvoiceNumber: invoiceNumber,
        ...lineWithoutLinks,
      };
    });

    const payload = {
      items: linesWithInvoiceInfo
    };

    if (verbose) {
      log?.('step', `──── [POST] APEX - Invoice Lines for ${invoiceNumber} (${lines.length} lines) ────`);
      log?.('info', `Lines count: ${lines.length}`);
      log?.('step', `──── POST PAYLOAD ────`);
      log?.('info', JSON.stringify(payload, null, 2));
    }

    const data = await insertToApex(APEX_CREATE_INVOICE_LINES_ENDPOINT, payload, log, verbose);

    if (verbose) {
      log?.('step', `──── POST RESPONSE ────`);
      log?.('success', `Response: ${JSON.stringify(data, null, 2)}`);
    }

    const isSuccess = data.status === 'SUCCESS' && (data.successCount > 0 || data.success === true);

    return {
      success: isSuccess,
      error: isSuccess ? undefined : (data.message || data.error || 'No lines inserted'),
      response: data,
      successCount: data.successCount || 0,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    log?.('error', `POST Lines Error: ${errorMsg}`);
    return { success: false, error: errorMsg, successCount: 0 };
  }
};

// Fetch invoice installments from Oracle Fusion (paginated at 500/page)
const fetchInvoiceInstallmentsFromOracle = async (
  invoiceId: number,
  log?: LogCallback,
  verbose = true
): Promise<{ success: boolean; items: APInvoiceInstallment[]; error?: string }> => {
  try {
    if (verbose) {
      log?.('info', `Fetching installments for Invoice ${invoiceId}...`);
    }

    const items = await fetchAllFromOracleUrl(
      `${ORACLE_FUSION_CONFIG.baseUrl}/invoices/${invoiceId}/child/invoiceInstallments`,
      log,
      verbose,
      500
    );

    if (verbose) {
      log?.('success', `Fetched ${items.length} installments for Invoice ${invoiceId}`);
      items.forEach((inst: any, idx: number) => {
        log?.('info', `  Installment ${idx + 1}: #${inst.InstallmentNumber}, DueDate=${inst.DueDate}, GrossAmount=${inst.GrossAmount}, UnpaidAmount=${inst.UnpaidAmount}`);
      });
    }

    return {
      success: true,
      items,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    log?.('error', `Fetch Installments Error: ${errorMsg}`);
    return { success: false, items: [], error: errorMsg };
  }
};

// Insert invoice installments to APEX
const insertInvoiceInstallmentsToApex = async (
  invoiceId: number,
  invoiceNumber: string,
  installments: APInvoiceInstallment[],
  log?: LogCallback,
  verbose = true
): Promise<{ success: boolean; error?: string; response?: any; successCount: number }> => {
  try {
    if (installments.length === 0) {
      return { success: true, successCount: 0 };
    }

    // Add InvoiceId and InvoiceNumber to each installment, remove links
    const installmentsWithInvoiceInfo = installments.map(inst => {
      const { links, ...instWithoutLinks } = inst as any;
      return {
        InvoiceId: invoiceId,
        InvoiceNumber: invoiceNumber,
        ...instWithoutLinks,
      };
    });

    const payload = {
      items: installmentsWithInvoiceInfo
    };

    if (verbose) {
      log?.('step', `──── [POST] APEX - Invoice Installments for ${invoiceNumber} (${installments.length} installments) ────`);
      log?.('info', `Installments count: ${installments.length}`);
      log?.('step', `──── POST PAYLOAD ────`);
      log?.('info', JSON.stringify(payload, null, 2));
    }

    const data = await insertToApex(APEX_CREATE_INVOICE_INSTALLMENTS_ENDPOINT, payload, log, verbose);

    if (verbose) {
      log?.('step', `──── POST RESPONSE ────`);
      log?.('success', `Response: ${JSON.stringify(data, null, 2)}`);
    }

    const isSuccess = data.status === 'SUCCESS' && (data.successCount > 0 || data.success === true);

    return {
      success: isSuccess,
      error: isSuccess ? undefined : (data.message || data.error || 'No installments inserted'),
      response: data,
      successCount: data.successCount || 0,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    log?.('error', `POST Installments Error: ${errorMsg}`);
    return { success: false, error: errorMsg, successCount: 0 };
  }
};

// Fetch invoices from Oracle Fusion
const fetchInvoicesFromOracle = async (
  params: Record<string, string> = {},
  log?: LogCallback,
  verbose = true
): Promise<{ success: boolean; items: APInvoice[]; hasMore: boolean; totalResults?: number; error?: string }> => {
  try {
    if (verbose) {
      log?.('step', '──── [GET] Oracle Fusion AP Invoices ────');
    }

    const data = await fetchFromOracle('invoices', params, log, verbose);

    return {
      success: true,
      items: data.items || [],
      hasMore: data.hasMore || false,
      totalResults: data.totalResults || data.count,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    log?.('error', `Fetch Error: ${errorMsg}`);
    return { success: false, items: [], hasMore: false, error: errorMsg };
  }
};

// Map a Fusion invoice to exactly the fields XXAP_INVOICES_PKG.save_invoice reads.
// Keys must match the $.FieldName paths in the package's JSON_VALUE calls.
const mapToApexInvoicePayload = (invoice: APInvoice) => ({
  InvoiceId:                invoice.InvoiceId,
  InvoiceNumber:            invoice.InvoiceNumber,
  InvoiceCurrency:          invoice.InvoiceCurrency,
  PaymentCurrency:          invoice.PaymentCurrency,
  InvoiceAmount:            invoice.InvoiceAmount,
  InvoiceDate:              invoice.InvoiceDate,
  BusinessUnit:             invoice.BusinessUnit,
  Supplier:                 invoice.Supplier,
  SupplierNumber:           invoice.SupplierNumber,
  SupplierSite:             invoice.SupplierSite,
  Party:                    invoice.Party,
  PartySite:                invoice.PartySite,
  InvoiceGroup:             invoice.InvoiceGroup,
  InvoiceSourceCode:        invoice.InvoiceSourceCode,
  InvoiceSource:            invoice.InvoiceSource,
  InvoiceType:              invoice.InvoiceType,
  Description:              invoice.Description,
  ConversionRateType:       invoice.ConversionRateType,
  ConversionDate:           invoice.ConversionDate,
  ConversionRate:           invoice.ConversionRate,
  BaseAmount:               invoice.BaseAmount,
  AccountingDate:           invoice.AccountingDate,
  TermsDate:                invoice.TermsDate,
  PayGroup:                 invoice.PayGroup,
  PaymentTerms:             invoice.PaymentTerms,
  PaymentMethodCode:        invoice.PaymentMethodCode,
  PaymentMethod:            invoice.PaymentMethod,
  PayAloneFlag:             invoice.PayAloneFlag,
  AmountPaid:               invoice.AmountPaid,
  ControlAmount:            invoice.ControlAmount,
  DeliveryChannelCode:      invoice.DeliveryChannelCode,
  DeliveryChannel:          invoice.DeliveryChannel,
  TaxationCountry:          invoice.TaxationCountry,
  LiabilityDistribution:    invoice.LiabilityDistribution,
  DocumentCategory:         invoice.DocumentCategory,
  VoucherNumber:            invoice.VoucherNumber,
  ValidationStatus:         invoice.ValidationStatus,
  ApprovalStatus:           invoice.ApprovalStatus,
  PaidStatus:               invoice.PaidStatus,
  AccountingStatus:         invoice.AccountingStatus,
  AccountCodingStatus:      invoice.AccountCodingStatus,
  FundsStatus:              invoice.FundsStatus,
  CanceledFlag:             invoice.CanceledFlag,
  CanceledDate:             invoice.CanceledDate,
  CanceledBy:               invoice.CanceledBy,
  BudgetDate:               invoice.BudgetDate,
  LegalEntity:              invoice.LegalEntity,
  LegalEntityIdentifier:    invoice.LegalEntityIdentifier,
  PurchaseOrderNumber:      invoice.PurchaseOrderNumber,
  CreatedBy:                invoice.CreatedBy,
  CreationDate:             invoice.CreationDate,
  LastUpdatedBy:            invoice.LastUpdatedBy,
  LastUpdateDate:           invoice.LastUpdateDate,
  LastUpdateLogin:          invoice.LastUpdateLogin,
});

// Insert single invoice to APEX
const insertInvoiceToApex = async (
  invoice: APInvoice,
  log?: LogCallback,
  verbose = true
): Promise<{ success: boolean; error?: string; response?: any; payload?: any }> => {
  try {
    // Guard: InvoiceId is the PK — skip if missing to avoid ORA-01400
    if (!invoice.InvoiceId) {
      const msg = `Invoice ${invoice.InvoiceNumber}: InvoiceId is missing, skipping`;
      log?.('warning', msg);
      return { success: false, error: msg };
    }

    // Send as a flat object — the PL/SQL handler reads $.InvoiceId etc. directly.
    // Wrapping in {"items":[...]} causes JSON_VALUE to return NULL → ORA-01400.
    const payload = mapToApexInvoicePayload(invoice);

    if (verbose) {
      log?.('step', `──── [POST] APEX - Invoice ${invoice.InvoiceNumber} (ID: ${invoice.InvoiceId}) ────`);
      log?.('info', `Invoice ID: ${invoice.InvoiceId}`);
      log?.('info', `Invoice Number: ${invoice.InvoiceNumber}`);
      log?.('info', `Supplier: ${invoice.Supplier}`);
      log?.('info', `Amount: ${invoice.InvoiceAmount} ${invoice.InvoiceCurrency}`);
      log?.('step', `──── POST PAYLOAD ────`);
      log?.('info', JSON.stringify(payload, null, 2));
    }

    const data = await insertToApex(APEX_CREATE_INVOICE_ENDPOINT, payload, log, verbose);

    if (verbose) {
      log?.('step', `──── POST RESPONSE ────`);
      log?.('success', JSON.stringify(data, null, 2));
    }

    // Single-invoice endpoint returns {"status":"SUCCESS","invoiceId":...} — no successCount.
    const isSuccess = data.status === 'SUCCESS';

    return {
      success: isSuccess,
      error: isSuccess ? undefined : (data.message || data.error || 'Insert failed'),
      response: data,
      payload: payload,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    log?.('error', `POST Error: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
};

// Main AP Invoices Sync Function
export const syncAPInvoices = async (
  parameters: Record<string, string>,
  testMode: boolean | 'single' = true,
  log?: LogCallback,
  onProgress?: ProgressCallback,
  abortSignal?: AbortSignal,
  onInvoicePayload?: InvoicePayloadCallback
): Promise<APSyncProgress> => {
  const progress: APSyncProgress = {
    status: 'idle',
    totalInvoices: 0,
    processedInvoices: 0,
    insertedInvoices: 0,
    currentInvoiceNumber: '',
    totalHeaders: 0,
    processedHeaders: 0,
    totalLines: 0,
    processedLines: 0,
    totalDistributions: 0,
    processedDistributions: 0,
    totalInstallments: 0,
    processedInstallments: 0,
    currentPage: 0,
    totalPages: 0,
    errors: 0,
    lastError: '',
    startTime: new Date(),
    endTime: null,
  };

  const updateProgress = (updates: Partial<APSyncProgress>) => {
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
    pageSize = 25; // Fetch 25 per page for full sync (AP has child records to process)
    maxRecords = null; // No limit - fetch all pages
  }

  const verbose = testMode !== false;
  const modeLabel = testMode === 'single' ? 'SINGLE RECORD DEBUG' : (testMode ? 'TEST MODE (25 invoices)' : 'FULL SYNC (all invoices)');

  try {
    // ========================================
    // STEP 1: Fetch Invoices from Oracle Fusion
    // ========================================
    updateProgress({ status: 'fetching' });

    // Always log API endpoints for debugging
    log?.('step', '═══════════════════════════════════════════════════════════');
    log?.('step', `  AP INVOICES SYNC - ${modeLabel}`);
    log?.('step', '═══════════════════════════════════════════════════════════');
    log?.('step', '  API ENDPOINTS:');
    log?.('info', '  ┌─────────────────────────────────────────────────────────');
    log?.('info', '  │ FUSION GET (Source):');
    log?.('info', `  │   Invoices:       ${ORACLE_FUSION_CONFIG.baseUrl}/invoices`);
    log?.('info', `  │   Invoice Lines:  ${ORACLE_FUSION_CONFIG.baseUrl}/invoices/{invoiceId}/child/invoiceLines`);
    log?.('info', `  │   Installments:   ${ORACLE_FUSION_CONFIG.baseUrl}/invoices/{invoiceId}/child/invoiceInstallments`);
    log?.('info', '  │');
    log?.('info', '  │ APEX POST (Target):');
    log?.('info', `  │   Invoices:       ${APEX_DB_CONFIG.baseUrl}/${APEX_CREATE_INVOICE_ENDPOINT}`);
    log?.('info', `  │   Invoice Lines:  ${APEX_DB_CONFIG.baseUrl}/${APEX_CREATE_INVOICE_LINES_ENDPOINT}`);
    log?.('info', `  │   Installments:   ${APEX_DB_CONFIG.baseUrl}/${APEX_CREATE_INVOICE_INSTALLMENTS_ENDPOINT}`);
    log?.('info', '  └─────────────────────────────────────────────────────────');
    log?.('step', '═══════════════════════════════════════════════════════════');

    if (verbose) {
      log?.('info', `Parameters: ${JSON.stringify(parameters)}`);
      log?.('info', `Max Records: ${maxRecords === null ? 'Unlimited (all pages)' : maxRecords}, Page Size: ${pageSize}`);
    }

    let allInvoices: APInvoice[] = [];
    let currentPage = 0;
    let hasMore = true;

    // Fetch with pagination
    while (hasMore && (maxRecords === null || allInvoices.length < maxRecords) && !abortSignal?.aborted) {
      currentPage++;
      updateProgress({ currentPage });

      const offset = (currentPage - 1) * pageSize;
      const fetchLimit = maxRecords !== null
        ? Math.min(pageSize, maxRecords - allInvoices.length)
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

      const result = await fetchInvoicesFromOracle(queryParams, log, verbose);

      if (!result.success) {
        updateProgress({
          status: 'error',
          lastError: result.error || 'Failed to fetch invoices',
          endTime: new Date()
        });
        return progress;
      }

      if (result.items.length === 0) {
        if (verbose) {
          log?.('info', 'No more invoices to fetch');
        }
        hasMore = false;
        break;
      }

      allInvoices = [...allInvoices, ...result.items];
      // Check if there are more records - also check if we got less than requested (end of data)
      hasMore = result.hasMore && result.items.length === fetchLimit;
      // Also check if we've reached maxRecords limit (for test modes)
      if (maxRecords !== null && allInvoices.length >= maxRecords) {
        hasMore = false;
      }

      if (verbose) {
        log?.('success', `Page ${currentPage}: Fetched ${result.items.length} invoices (Total: ${allInvoices.length})`);
      }

      // Small delay between pages
      if (hasMore) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    // Count child records (headers, lines, distributions) from links
    let totalHeaders = 0;
    let totalLines = 0;
    let totalDistributions = 0;

    allInvoices.forEach(invoice => {
      // Count based on links if available
      if (invoice.links && Array.isArray(invoice.links)) {
        const headerLink = invoice.links.find((l: any) => l.name === 'invoiceHeaders');
        const lineLink = invoice.links.find((l: any) => l.name === 'invoiceLines');
        const distLink = invoice.links.find((l: any) => l.name === 'invoiceDistributions');

        // Estimate 1 header per invoice, varies for lines/distributions
        if (headerLink) totalHeaders++;
        if (lineLink) totalLines++;
        if (distLink) totalDistributions++;
      } else {
        // Default estimate: 1 header, 2 lines, 2 distributions per invoice
        totalHeaders += 1;
        totalLines += 2;
        totalDistributions += 2;
      }
    });

    updateProgress({
      totalInvoices: allInvoices.length,
      totalHeaders,
      totalLines,
      totalDistributions,
    });

    if (verbose) {
      log?.('success', `Total invoices fetched: ${allInvoices.length}`);
      log?.('info', `Estimated: ${totalHeaders} headers, ${totalLines} lines, ${totalDistributions} distributions`);
    }

    if (allInvoices.length === 0) {
      updateProgress({ status: 'completed', endTime: new Date() });
      if (verbose) {
        log?.('warning', 'No invoices found for the given parameters');
      }
      return progress;
    }

    // ========================================
    // STEP 2: Insert Invoices to APEX
    // ========================================
    updateProgress({ status: 'inserting' });
    if (verbose) {
      log?.('step', '═══════════════════════════════════════════════════════════');
      log?.('step', '  STEP 2: Inserting AP Invoices to APEX Database');
      log?.('step', '═══════════════════════════════════════════════════════════');
      log?.('info', `POST Endpoint: ${APEX_DB_CONFIG.baseUrl}/${APEX_CREATE_INVOICE_ENDPOINT}`);
    }

    // Process invoices one by one
    for (let i = 0; i < allInvoices.length; i++) {
      if (abortSignal?.aborted) {
        updateProgress({ status: 'stopped' });
        log?.('warning', 'Sync stopped by user');
        break;
      }

      const invoice = allInvoices[i];
      const invoiceNum = invoice.InvoiceNumber || `Invoice ${i + 1}`;

      updateProgress({
        processedInvoices: i,
        currentInvoiceNumber: invoiceNum,
      });

      if (verbose) {
        log?.('info', `[${i + 1}/${allInvoices.length}] Processing: ${invoiceNum} (ID: ${invoice.InvoiceId})`);
      }

      // Record payload before POST for debugging
      onInvoicePayload?.(invoice.InvoiceId, invoiceNum, invoice);

      const insertResult = await insertInvoiceToApex(invoice, log, verbose);

      if (insertResult.success) {
        updateProgress({
          insertedInvoices: progress.insertedInvoices + 1,
          processedHeaders: progress.processedHeaders + 1,
        });

        if (verbose) {
          log?.('success', `✓ Invoice ${invoiceNum} (ID: ${invoice.InvoiceId}) inserted successfully`);
        }

        // ========================================
        // STEP 2b: Fetch and POST Invoice Lines
        // ========================================
        const linesResult = await fetchInvoiceLinesFromOracle(invoice.InvoiceId, log, verbose);

        // Track lines info for debug callback
        let linesInfo = { fetched: 0, inserted: 0, linesError: undefined as string | undefined };

        if (linesResult.success && linesResult.items.length > 0) {
          linesInfo.fetched = linesResult.items.length;

          // Update total lines count with actual count
          updateProgress({
            totalLines: progress.totalLines + linesResult.items.length,
          });

          // POST lines to APEX
          const linesInsertResult = await insertInvoiceLinesToApex(
            invoice.InvoiceId,
            invoiceNum,
            linesResult.items,
            log,
            verbose
          );

          if (linesInsertResult.success) {
            linesInfo.inserted = linesInsertResult.successCount;
            updateProgress({
              processedLines: progress.processedLines + linesInsertResult.successCount,
            });
            if (verbose) {
              log?.('success', `✓ ${linesInsertResult.successCount} lines inserted for ${invoiceNum}`);
            }
          } else {
            linesInfo.linesError = linesInsertResult.error || 'Lines insert failed';
            updateProgress({
              errors: progress.errors + 1,
              lastError: linesInsertResult.error || 'Lines insert failed',
            });
            log?.('error', `✗ Lines failed for ${invoiceNum}: ${linesInsertResult.error}`);
          }
        } else if (linesResult.success && linesResult.items.length === 0) {
          if (verbose) {
            log?.('info', `No lines found for ${invoiceNum}`);
          }
        } else if (!linesResult.success) {
          linesInfo.linesError = linesResult.error || 'Failed to fetch lines';
          log?.('error', `✗ Failed to fetch lines for ${invoiceNum}: ${linesResult.error}`);
        }

        // ========================================
        // STEP 2c: Fetch and POST Invoice Installments
        // ========================================
        const installmentsResult = await fetchInvoiceInstallmentsFromOracle(invoice.InvoiceId, log, verbose);

        let installmentsInfo = { fetched: 0, inserted: 0, installmentsError: undefined as string | undefined };

        if (installmentsResult.success && installmentsResult.items.length > 0) {
          installmentsInfo.fetched = installmentsResult.items.length;

          updateProgress({
            totalInstallments: progress.totalInstallments + installmentsResult.items.length,
          });

          const installmentsInsertResult = await insertInvoiceInstallmentsToApex(
            invoice.InvoiceId,
            invoiceNum,
            installmentsResult.items,
            log,
            verbose
          );

          if (installmentsInsertResult.success) {
            installmentsInfo.inserted = installmentsInsertResult.successCount;
            updateProgress({
              processedInstallments: progress.processedInstallments + installmentsInsertResult.successCount,
            });
            if (verbose) {
              log?.('success', `✓ ${installmentsInsertResult.successCount} installments inserted for ${invoiceNum}`);
            }
          } else {
            installmentsInfo.installmentsError = installmentsInsertResult.error || 'Installments insert failed';
            updateProgress({
              errors: progress.errors + 1,
              lastError: installmentsInsertResult.error || 'Installments insert failed',
            });
            log?.('error', `✗ Installments failed for ${invoiceNum}: ${installmentsInsertResult.error}`);
          }
        } else if (installmentsResult.success && installmentsResult.items.length === 0) {
          if (verbose) {
            log?.('info', `No installments found for ${invoiceNum}`);
          }
        } else if (!installmentsResult.success) {
          installmentsInfo.installmentsError = installmentsResult.error || 'Failed to fetch installments';
          log?.('error', `✗ Failed to fetch installments for ${invoiceNum}: ${installmentsResult.error}`);
        }

        // Update payload callback with success result, lines info, and installments info
        onInvoicePayload?.(invoice.InvoiceId, invoiceNum, invoice, insertResult.response, undefined, linesInfo, installmentsInfo);

      } else {
        updateProgress({
          errors: progress.errors + 1,
          lastError: insertResult.error || 'Insert failed',
        });

        // Update payload callback with error
        onInvoicePayload?.(invoice.InvoiceId, invoiceNum, invoice, insertResult.response, insertResult.error);

        log?.('error', `✗ Invoice ${invoiceNum} (ID: ${invoice.InvoiceId}) failed: ${insertResult.error}`);
      }

      // Small delay between inserts to prevent API throttling
      if (i < allInvoices.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }

    updateProgress({ processedInvoices: allInvoices.length });

    // ========================================
    // COMPLETE
    // ========================================
    updateProgress({
      status: abortSignal?.aborted ? 'stopped' : 'completed',
      endTime: new Date(),
    });

    // Always show brief completion summary
    log?.('success', `✓ Sync completed: ${progress.insertedInvoices} invoices, ${progress.processedLines} lines, ${progress.processedInstallments} installments inserted`);
    if (progress.errors > 0) {
      log?.('warning', `⚠ ${progress.errors} errors occurred`);
    }

    if (verbose) {
      log?.('step', '═══════════════════════════════════════════════════════════');
      log?.('step', '  SYNC COMPLETED');
      log?.('step', '═══════════════════════════════════════════════════════════');
      log?.('success', `Total Invoices Processed: ${progress.processedInvoices}`);
      log?.('success', `Total Invoices Inserted: ${progress.insertedInvoices}`);
      log?.('success', `Headers: ${progress.processedHeaders}, Lines: ${progress.processedLines}, Distributions: ${progress.processedDistributions}, Installments: ${progress.processedInstallments}`);
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

// Test Oracle Fusion connection for AP Invoices
export const testAPConnection = async (log?: LogCallback): Promise<boolean> => {
  try {
    log?.('info', 'Testing Oracle Fusion AP Invoices connection...');

    const result = await fetchInvoicesFromOracle({ limit: '1', offset: '0' }, log);

    if (result.success) {
      log?.('success', 'Oracle Fusion AP connection successful!');
      log?.('info', `Sample data available: ${result.items?.length || 0} invoices`);
      return true;
    }

    log?.('error', 'Connection test failed');
    return false;
  } catch (error) {
    log?.('error', `Connection test error: ${error}`);
    return false;
  }
};

// Get AP Invoice statistics from APEX
export const getAPInvoiceStats = async (log?: LogCallback): Promise<{
  totalInvoices: number;
  validatedCount: number;
  approvedCount: number;
  paidCount: number;
  unpaidCount: number;
  canceledCount: number;
  totalAmount: number;
  totalPaid: number;
  totalOutstanding: number;
  lastSyncDate: string;
} | null> => {
  try {
    log?.('info', 'Fetching AP Invoice statistics...');

    const data = await fetchFromApex(APEX_DB_CONFIG.endpoints.apInvoicesStats, {}, log, false);

    if (data.success) {
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
