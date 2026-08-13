/**
 * Manage Journals Service
 * Service for querying journals from APEX REST API
 */

import { fetchFromApex, putToApex } from './sync-http';
import { APEX_DB_CONFIG } from '../config/api.config';
import type { SlaGetResult } from './sla.service';

// Endpoint constant for posting a journal batch (used in API icon tooltips)
export const POST_JOURNAL_ENDPOINT = 'gl/journals/{jeBatchId}/post';

// Types
export interface JournalSearchParams {
  journal?: string;
  journalOperator?: 'Starts with' | 'Equals' | 'Contains' | 'Ends with';
  batch?: string;
  batchOperator?: 'Starts with' | 'Equals' | 'Contains' | 'Ends with';
  accountingPeriod?: string;
  source?: string;
  category?: string;
  ledger?: string;
  batchStatus?: string;
  offset?: number;
  limit?: number;
}

export interface JournalRecord {
  key: string;
  headerSyncId: number;
  jeHeaderId: number;
  jeBatchId: number;
  journal: string;
  journalBatch: string;
  batchName: string;
  accountingPeriod: string;
  source: string;
  category: string;
  journalEnteredDebit: number;
  journalEnteredCredit: number;
  journalAccountedDebit: number;
  journalAccountedCredit: number;
  currency: string;
  batchStatus: 'Posted' | 'Unposted' | 'Error' | 'Pending' | string;
  statusCode: string;
  reference: string;
  approvalStatus: 'Approved' | 'Pending' | 'Rejected' | 'Not required' | string;
  ledgerName: string;
  effectiveDate: string;
  postedDate: string;
  creationDate: string;
}

export interface JournalLine {
  key: string;
  lineSyncId: number;
  lineNum: number;
  jeHeaderId: number;
  account: string;
  description: string;
  enteredDr: number;
  enteredCr: number;
  accountedDr: number;
  accountedCr: number;
  currency: string;
  status: string;
}

export interface JournalSearchResponse {
  success: boolean;
  totalCount: number;
  offset: number;
  limit: number;
  items: JournalRecord[];
  error?: string;
}

export interface JournalLinesResponse {
  success: boolean;
  jeHeaderId: number;
  lines: JournalLine[];
  error?: string;
}

export interface LookupItem {
  value: string;
  label: string;
}

export interface LookupResponse {
  items: LookupItem[];
}

/**
 * Build query string from search parameters
 */
const buildQueryString = (params: JournalSearchParams): string => {
  const queryParams = new URLSearchParams();

  if (params.journal) queryParams.append('journal', params.journal);
  if (params.journalOperator) queryParams.append('journalOperator', params.journalOperator);
  if (params.batch) queryParams.append('batch', params.batch);
  if (params.batchOperator) queryParams.append('batchOperator', params.batchOperator);
  if (params.accountingPeriod) queryParams.append('accountingPeriod', params.accountingPeriod);
  if (params.source) queryParams.append('source', params.source);
  if (params.category) queryParams.append('category', params.category);
  if (params.ledger) queryParams.append('ledger', params.ledger);
  if (params.batchStatus) queryParams.append('batchStatus', params.batchStatus);
  if (params.offset !== undefined) queryParams.append('offset', params.offset.toString());
  if (params.limit !== undefined) queryParams.append('limit', params.limit.toString());

  return queryParams.toString();
};

/**
 * Search journals with parameters
 */
export const searchJournals = async (
  params: JournalSearchParams,
  _useProxy: boolean = true
): Promise<JournalSearchResponse> => {
  const queryString = buildQueryString(params);
  const endpoint = `gl/journals${queryString ? '?' + queryString : ''}`;

  try {
    const data = await fetchFromApex(endpoint);
    return data;
  } catch (error) {
    console.error('Error searching journals:', error);
    return {
      success: false,
      totalCount: 0,
      offset: params.offset || 0,
      limit: params.limit || 25,
      items: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
};

/**
 * Get journal lines by header ID
 */
export const getJournalLines = async (
  jeHeaderId: number,
  _useProxy: boolean = true
): Promise<JournalLinesResponse> => {
  try {
    const data = await fetchFromApex(`gl/journals/${jeHeaderId}/lines`);
    return data;
  } catch (error) {
    console.error('Error fetching journal lines:', error);
    return {
      success: false,
      jeHeaderId,
      lines: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
};

/**
 * Get lookup values for dropdowns
 */
export const getLookupValues = async (
  lookupType: 'periods' | 'sources' | 'categories' | 'ledgers' | 'batch-statuses',
  _useProxy: boolean = true
): Promise<LookupItem[]> => {
  try {
    const data: LookupResponse = await fetchFromApex(`gl/lookups/${lookupType}`);
    return data.items || [];
  } catch (error) {
    console.error(`Error fetching ${lookupType} lookup:`, error);
    return [];
  }
};

/**
 * Get all lookup values for the search form
 */
export const getAllLookups = async (useProxy: boolean = true): Promise<{
  periods: LookupItem[];
  sources: LookupItem[];
  categories: LookupItem[];
  ledgers: LookupItem[];
  batchStatuses: LookupItem[];
}> => {
  const [periods, sources, categories, ledgers, batchStatuses] = await Promise.all([
    getLookupValues('periods', useProxy),
    getLookupValues('sources', useProxy),
    getLookupValues('categories', useProxy),
    getLookupValues('ledgers', useProxy),
    getLookupValues('batch-statuses', useProxy),
  ]);

  return {
    periods,
    sources,
    categories,
    ledgers,
    batchStatuses,
  };
};

/**
 * Format currency value
 */
export const formatCurrency = (value: number, currency: string = 'INR'): string => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 2,
  }).format(value);
};

/**
 * Format date
 */
export const formatDate = (dateString: string): string => {
  if (!dateString) return '-';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

/**
 * Post a journal batch — updates STATUS to 'P' / 'Posted'
 * Returns server-side validation errors in the errors[] array when validation fails.
 */
export const postJournal = async (
  jeBatchId: number
): Promise<{ success: boolean; message?: string; error?: string; errors?: string[] }> => {
  try {
    const url = `${APEX_DB_CONFIG.baseUrl}/gl/journals/${jeBatchId}/post`;
    // No request body — send only Accept. Sending Content-Type: application/json
    // with an empty body makes the ORDS handler try to parse an empty JSON body
    // and fail ("An unexpected error occurred"). This mirrors the working
    // putPostJournal in glPosting.service used by payments/MPA posting.
    const res  = await fetch(url, { method: 'PUT', headers: { Accept: 'application/json' } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok && data && data.success === undefined) {
      return { success: false, error: `HTTP ${res.status}`, errors: Array.isArray(data.errors) ? data.errors : undefined };
    }
    return data;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
};

/**
 * Update an existing journal header and its lines
 */
export const updateJournal = async (
  jeHeaderId: number,
  payload: any
): Promise<{ success: boolean; message?: string; error?: string }> => {
  try {
    const endpoint = `gl/journals/${jeHeaderId}`;
    const data = await putToApex(endpoint, payload);
    return data;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
};

/**
 * Look up a GL journal by PC transaction ID.
 * Queries RR_GL_LINES_ALL (and RR_GL_JE_LINES_ALL as fallback) via REFERENCE1.
 * Returns a SlaGetResult-compatible shape so the view-accounting modal works unchanged.
 */
export async function getGlJournalByTxnId(txnId: number): Promise<SlaGetResult> {
  const url = `${APEX_DB_CONFIG.baseUrl}/gl/journals/by-txn?txn_id=${txnId}`;
  try {
    const res  = await fetch(url, { headers: { Accept: 'application/json' } });
    const data = await res.json();
    if (!res.ok || !data.found) {
      return { found: false, headerId: null, moduleName: null, eventTypeCode: null,
               accountingStatus: null, postingStatus: null, accountingDate: null,
               periodName: null, description: null, creationDate: null,
               postedDate: null, postedBy: null, glBatchId: null, glBatchName: null,
               glHeaderId: null, lines: [] };
    }
    return data as SlaGetResult;
  } catch {
    return { found: false, headerId: null, moduleName: null, eventTypeCode: null,
             accountingStatus: null, postingStatus: null, accountingDate: null,
             periodName: null, description: null, creationDate: null,
             postedDate: null, postedBy: null, glBatchId: null, glBatchName: null,
             glHeaderId: null, lines: [] };
  }
}
