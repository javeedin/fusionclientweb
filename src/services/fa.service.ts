/**
 * Fixed Assets Service
 * All API calls for the FA module → reerp/fa/* endpoints
 */

import { fetchFromApex, insertToApex, putToApex } from './sync-http';
import { APEX_DB_CONFIG } from '../config/api.config';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AssetSearchParams {
  assetNumber?: string;
  description?: string;
  category?: string;
  bookTypeCode?: string;
  assetType?: string;
  status?: 'ACTIVE' | 'RETIRED' | '';
  offset?: number;
  limit?: number;
}

export interface AssetRecord {
  // Fields returned by GET_ASSETS (RR_FA_ADDITIONS_TL + RR_FA_BOOKS)
  assetId: string;
  description: string;
  creationDate: string;
  createdBy: string;
  lastUpdateDate: string;
  lastUpdatedBy: string;
  bookTypeCode: string;
  datePlacedInService: string;
  cost: string;
  originalCost: string;
  adjustedCost: string;
  salvageValue: string;
  capitalizeFlag: string;
  depreciateFlag: string;
  dateIneffective: string;
  deprnReserve: string;
  ytdDeprn: string;
  nbv: string;
  assetCategoryId?: string;
  assetCategory?: string;       // "SEGMENT1 - SEGMENT2"
  categorySegment1?: string;
  categorySegment2?: string;
  attribute3?: string;          // shown as "Type" in the search grid
  retiredFlag: string;   // 'YES' if no active book entry, else 'NO'
  accountedStatus?: string;   // 'ACCOUNTED' | 'UNACCOUNTED'
  accountedDate?: string | null;
  // Legacy / not available from current tables — kept optional for UI compat
  assetNumber?: string;
  asset_number?: string;  // snake_case from API response
  assetType?: string;
  categoryId?: string;
  tagNumber?: string;
  serialNumber?: string;
  manufacturer?: string;
  inUseFlag?: string;
  ownedLeased?: string;
  units?: string;
  currentUnits?: string;
  capitalizedFlag?: string;
}

export interface AssetDetail extends AssetRecord {
  parentAssetId: string;
  manufacturerName: string;
  modelNumber: string;
  newUsed: string;
  inventorial: string;
  pendingFlag: string;
  propertyTypeCode: string;
  feederSystemName: string;
  createdBy: string;
  lastUpdatedBy: string;
  tlDescription: string;
  // Flexfield attributes
  attribute1: string | null;
  attribute2: string | null;
  attribute3: string | null;
  attribute4: string | null;
  attribute5: string | null;
  attribute6: string | null;
  attribute7: string | null;
  attribute8: string | null;
  attribute9: string | null;
  attribute10: string | null;
}

export interface AssetBook {
  bookTypeCode: string;
  bookTypeName: string;
  companyCode: string;
  datePlacedInService: string;
  dateEffective: string;
  deprnStartDate: string;
  cost: string;
  originalCost: string;
  adjustedCost: string;
  salvageValue: string;
  recoverableCost: string;
  depreciateFlag: string;
  capitalizeFlag: string;
  dateIneffective: string;
  retirementId: string;
  methodId: string;
  methodCode: string;
  methodName: string;
  lifeInMonths: string;
  prorateDate: string;
  conventionTypeId: string;
  rateAdjustmentFactor: string;
  deprnReserve: string;
  ytdDeprn: string;
  nbv: string;
}

export interface DeprnRecord {
  assetId: string;
  bookTypeCode: string;
  periodCounter: string;
  periodName: string;
  fiscalYear: string;
  periodNum: string;
  distributionId: string;
  deprnRunId: string;
  deprnSourceCode: string;
  deprnRunDate: string;
  deprnAmount: string;
  ytdDeprn: string;
  deprnReserve: string;
  deprnAdjustmentAmount: string;
  totalDeprnAmount: string;
  cost: string;
  nbv: string;
  bonusDeprnAmount: string;
  bonusYtdDeprn: string;
  bonusDeprnReserve: string;
  bonusDeprnAdjustmentAmount: string;
  revalReserve: string;
  revalDeprnExpense: string;
  ytdRevalDeprnExpense: string;
  revalAmortization: string;
  revalAmortBalance: string;
  impairmentAmount: string;
  impairmentReserve: string;
  ytdImpairment: string;
  capitalAdjustment: string;
  generalFund: string;
  backlogDeprnReserve: string;
  ytdBacklogDeprn: string;
  accountedStatus?: string;
  accountedDate?: string | null;
}

export interface DistributionRecord {
  distributionId: string;
  bookTypeCode: string;
  unitsAssigned: string;
  transactionUnits: string;
  codeCombinationId: string;
  locationId: string;
  locationSeg1: string;
  locationSeg2: string;
  locationSeg3: string;
  transactionHeaderIdIn: string;
  transactionHeaderIdOut: string;
  dateEffective: string;
  dateIneffective: string;
}

export interface InvoiceRecord {
  assetInvoiceId: string;
  bookTypeCode: string;
  fixedAssetsCost: string;
  dateEffective: string;
  invoiceTransactionIdIn: string;
  feederSystemName: string;
  description: string;
  sourceLineId: string;
  postBatchId: string;
}

export interface TransactionRecord {
  transactionHeaderId: string;
  bookTypeCode: string;
  transactionTypeCode: string;
  transactionDate: string;
  dateEffective: string;
  callingInterface: string;
  creationDate: string;
  createdBy: string;
}

export interface AssetSearchResponse {
  totalCount: number;
  items: AssetRecord[];
  error?: string;
}

export interface CategoryRecord {
  categoryId: string;
  segment1: string;
  segment2: string;
  description: string;
  categoryType: string;
  ownedLeased: string;
  capitalizeFlag: string;
  summaryFlag: string;
  enabledFlag: string;
  // Asset cost CCID + resolved segments (populated by 19_fa_categories_with_ccid.sql)
  assetCostAccountCcid?: string;
  assetCostAccount?: string;
  segCo?: string; segLob?: string; segDept?: string; segAccount?: string;
  segSubAcc?: string; segAlys?: string; segIc?: string; segFut1?: string; segFut2?: string;
}

export interface CategoryDetail extends CategoryRecord {
  structureInstanceNumber: string;
  creationDate: string;
  createdBy: string;
  lastUpdateDate: string;
  lastUpdatedBy: string;
}

export interface CategoryBookRecord {
  categoryBookId: string;
  bookTypeCode: string;
  bookTypeName: string;
  bookClass: string;
  // Standard CCIDs
  assetCostAccountCcid: string;
  assetClearingAccountCcid: string;
  deprnExpenseAccountCcid: string;
  reserveAccountCcid: string;
  bonusExpenseAccountCcid: string;
  bonusReserveAccountCcid: string;
  // CIP CCIDs
  cipCostAccountCcid?: string;
  cipClearingAccountCcid?: string;
  // Unplanned + impairment CCIDs
  unplannedDeprnExpCcid?: string;
  impairmentExpenseAcctCcid?: string;
  impairmentReserveAcctCcid?: string;
  // Revaluation CCIDs
  revalReserveAcctCcid?: string;
  revalAmortAcctCcid?: string;
  revalLossExpAcctCcid?: string;
  // Resolved account strings (standard)
  assetCostAccount: string;
  assetClearingAccount: string;
  deprnExpenseAccount: string;
  reserveAccount: string;
  bonusExpenseAccount: string;
  bonusReserveAccount: string;
  // Resolved account strings (CIP)
  cipCostAccount?: string;
  cipClearingAccount?: string;
  // Resolved account strings (unplanned + impairment)
  unplannedDeprnExpAccount?: string;
  impairmentExpenseAccount?: string;
  impairmentReserveAccount?: string;
  // Resolved account strings (revaluation)
  revalReserveAccount?: string;
  revalAmortAccount?: string;
  revalLossExpAccount?: string;
}

export interface CategoryBookDefaultRecord {
  defaultsId?: string;
  bookTypeCode?: string;
  fromDate?: string;
  toDate?: string;
  depreciateFlag?: string;
  deprnMethodCode?: string;
  lifeInMonths?: string;
  prorateConventionCode?: string;
  retirementTypeCode?: string;
  percentSalvageValue?: string;
  deprnLimitType?: string;
  bonusRule?: string;
  ceilingName?: string;
  capitalGainsThreshYears?: string;
  capitalGainsThreshMonths?: string;
  priceIndexName?: string;
  massPropertyFlag?: string;
  subcompRuleType?: string;
  minYearsLife?: string;
  minMonthsLife?: string;
  recognizeGainLoss?: string;
  trackingMethod?: string;
  terminalGainLoss?: string;
  groupAssetNumber?: string;
}

export interface CategorySearchParams {
  description?: string;
  categoryType?: string;
  capitalizeFlag?: string;
  ownedLeased?: string;
  enabledFlag?: string;
  offset?: number;
  limit?: number;
}

export interface CategorySearchResponse {
  totalCount: number;
  items: CategoryRecord[];
  error?: string;
}

export interface MethodRecord {
  methodId: string;
  methodCode: string;
  name: string;
  lifeInMonths: string;
  stlMethodFlag: string;
  rateSourceRule: string;
  deprnBasisRule: string;
}

export interface LocationRecord {
  locationId: string;
  segment1: string;
  segment2: string;
  segment3: string;
  segment4: string;
  fullLocation: string;
}

export interface BookControlRecord {
  bookTypeCode: string;
  bookTypeName: string;
  bookClass: string;
  deprnCalendar: string;
  fiscalYearName: string;
  currentFiscalYear: string;
  deprnStatus: string;
}

export interface RetirementRecord {
  retirementId: string;
  bookTypeCode: string;
  assetId: string;
  assetNumber: string;
  description: string;
  dateRetired: string;
  costRetired: string;
  status: string;
  nbvRetired: string;
  gainLossAmount: string;
  proceedsOfSale: string;
  costOfRemoval: string;
  retirementTypeCode: string;
  soldTo: string;
  assetCostAccount?: string;
  deprnReserveAccount?: string;
  proceedsAccount?: string;
  costOfRemovalAccount?: string;
  gainAccount?: string;
  lossAccount?: string;
}

export interface DeprnWorkbenchRecord {
  assetId: string;
  assetNumber: string;
  description: string;
  bookTypeCode: string;
  periodCounter: string;
  periodName: string;
  fiscalYear: string;
  deprnAmount: string;
  ytdDeprn: string;
  deprnReserve: string;
  adjustedCost: string;
  nbv: string;
  salvageValue: string;
  deprnRunDate: string;
}

export interface DeprnWorkbenchSummary {
  totalCost: number;
  totalDeprnReserve: number;
  totalNbv: number;
  totalDeprnAmount: number;
}

// ── Asset Search ──────────────────────────────────────────────────────────────

export const searchAssets = async (
  params: AssetSearchParams
): Promise<AssetSearchResponse> => {
  const q = new URLSearchParams();
  if (params.assetNumber)  q.append('assetNumber',  params.assetNumber);
  if (params.description)  q.append('description',  params.description);
  if (params.category)     q.append('category',     params.category);
  if (params.bookTypeCode) q.append('bookTypeCode', params.bookTypeCode);
  if (params.assetType)    q.append('assetType',    params.assetType);
  if (params.status)       q.append('assetStatus',  params.status);
  if (params.offset !== undefined) q.append('offset', String(params.offset));
  if (params.limit  !== undefined) q.append('limit',  String(params.limit));

  const qs = q.toString();
  try {
    return await fetchFromApex(`fa/assets${qs ? '?' + qs : ''}`);
  } catch (e) {
    return { totalCount: 0, items: [], error: e instanceof Error ? e.message : 'Unknown error' };
  }
};

// ── Single Asset ──────────────────────────────────────────────────────────────

export const getAssetDetail = async (assetId: string): Promise<{ success: boolean; error?: string } & Partial<AssetDetail>> => {
  try { return await fetchFromApex(`fa/assets/${assetId}`); }
  catch (e) { return { success: false, error: e instanceof Error ? e.message : 'Unknown error' }; }
};

export const getAssetBooks = async (assetId: string): Promise<{ success: boolean; items: AssetBook[]; error?: string }> => {
  try { return await fetchFromApex(`fa/assets/${assetId}/books`); }
  catch (e) { return { success: false, items: [], error: e instanceof Error ? e.message : 'Unknown error' }; }
};

export const getAssetDeprn = async (assetId: string): Promise<{ success: boolean; items: DeprnRecord[]; error?: string }> => {
  try { return await fetchFromApex(`fa/assets/${assetId}/deprn`); }
  catch (e) { return { success: false, items: [], error: e instanceof Error ? e.message : 'Unknown error' }; }
};

export const getAssetDistributions = async (assetId: string): Promise<{ success: boolean; items: DistributionRecord[]; error?: string }> => {
  try { return await fetchFromApex(`fa/assets/${assetId}/distributions`); }
  catch (e) { return { success: false, items: [], error: e instanceof Error ? e.message : 'Unknown error' }; }
};

export const getAssetInvoices = async (assetId: string): Promise<{ success: boolean; items: InvoiceRecord[]; error?: string }> => {
  try { return await fetchFromApex(`fa/assets/${assetId}/invoices`); }
  catch (e) { return { success: false, items: [], error: e instanceof Error ? e.message : 'Unknown error' }; }
};

export const getAssetTransactions = async (assetId: string): Promise<{ success: boolean; items: TransactionRecord[]; error?: string }> => {
  try { return await fetchFromApex(`fa/assets/${assetId}/transactions`); }
  catch (e) { return { success: false, items: [], error: e instanceof Error ? e.message : 'Unknown error' }; }
};

// ── Setup Lookups ─────────────────────────────────────────────────────────────

export const searchCategories = async (
  params: CategorySearchParams
): Promise<CategorySearchResponse> => {
  const q = new URLSearchParams();
  if (params.description)   q.append('description',   params.description);
  if (params.categoryType)  q.append('categoryType',  params.categoryType);
  if (params.capitalizeFlag)q.append('capitalizeFlag',params.capitalizeFlag);
  if (params.ownedLeased)   q.append('ownedLeased',   params.ownedLeased);
  if (params.enabledFlag)   q.append('enabledFlag',   params.enabledFlag);
  if (params.offset !== undefined) q.append('offset', String(params.offset));
  if (params.limit  !== undefined) q.append('limit',  String(params.limit));
  const qs = q.toString();
  try { return await fetchFromApex(`fa/categories${qs ? '?' + qs : ''}`); }
  catch (e) { return { totalCount: 0, items: [], error: e instanceof Error ? e.message : 'Unknown error' }; }
};

export const getCategoryDetail = async (categoryId: string): Promise<{ success: boolean; error?: string } & Partial<CategoryDetail>> => {
  try { return await fetchFromApex(`fa/categories/${categoryId}`); }
  catch (e) { return { success: false, error: e instanceof Error ? e.message : 'Unknown error' }; }
};

export const getCategoryBooks = async (categoryId: string): Promise<{ success: boolean; items: CategoryBookRecord[]; error?: string }> => {
  try { return await fetchFromApex(`fa/categories/${categoryId}/books`); }
  catch (e) { return { success: false, items: [], error: e instanceof Error ? e.message : 'Unknown error' }; }
};

export const getCategoryBookDefaults = async (categoryId: string): Promise<{ success: boolean; items: CategoryBookDefaultRecord[]; error?: string }> => {
  try { return await fetchFromApex(`fa/categories/${categoryId}/book-defaults`); }
  catch (e) { return { success: false, items: [], error: e instanceof Error ? e.message : 'Unknown error' }; }
};

export const getCategories = async (): Promise<CategoryRecord[]> => {
  try {
    const d = await fetchFromApex('fa/categories');
    return (d.items || []).map((r: any): CategoryRecord => ({
      categoryId:          r.categoryId          ?? r.category_id          ?? '',
      segment1:            r.segment1            ?? r.SEGMENT1             ?? '',
      segment2:            r.segment2            ?? r.SEGMENT2             ?? '',
      description:         r.description         ?? '',
      categoryType:        r.categoryType        ?? r.category_type        ?? '',
      ownedLeased:         r.ownedLeased         ?? r.owned_leased         ?? '',
      capitalizeFlag:      r.capitalizeFlag      ?? r.capitalize_flag      ?? '',
      summaryFlag:         r.summaryFlag         ?? r.summary_flag         ?? '',
      enabledFlag:         r.enabledFlag         ?? r.enabled_flag         ?? '',
      assetCostAccountCcid: r.assetCostAccountCcid ?? r.asset_cost_account_ccid ?? undefined,
      assetCostAccount:    r.assetCostAccount    ?? r.asset_cost_account   ?? undefined,
      segCo:      r.segCo      ?? r.seg_co      ?? undefined,
      segLob:     r.segLob     ?? r.seg_lob     ?? undefined,
      segDept:    r.segDept    ?? r.seg_dept     ?? undefined,
      segAccount: r.segAccount ?? r.seg_account  ?? undefined,
      segSubAcc:  r.segSubAcc  ?? r.seg_sub_acc  ?? undefined,
      segAlys:    r.segAlys    ?? r.seg_alys     ?? undefined,
      segIc:      r.segIc      ?? r.seg_ic       ?? undefined,
      segFut1:    r.segFut1    ?? r.seg_fut1     ?? undefined,
      segFut2:    r.segFut2    ?? r.seg_fut2     ?? undefined,
    }));
  }
  catch { return []; }
};

export const getMethods = async (): Promise<MethodRecord[]> => {
  try {
    const d = await fetchFromApex('fa/methods');
    return (d.items || []).map((m: any): MethodRecord => ({
      methodId:      m.methodId      ?? m.method_id      ?? '',
      methodCode:    m.methodCode    ?? m.method_code    ?? '',
      name:          m.name         ?? '',
      lifeInMonths:  m.lifeInMonths  ?? m.life_in_months  ?? '',
      stlMethodFlag: m.stlMethodFlag ?? m.stl_method_flag ?? '',
      rateSourceRule: m.rateSourceRule ?? m.rate_source_rule ?? '',
      deprnBasisRule: m.deprnBasisRule ?? m.deprn_basis_rule ?? '',
    }));
  }
  catch { return []; }
};

export const getLocations = async (): Promise<LocationRecord[]> => {
  try {
    const d = await fetchFromApex('fa/locations');
    return (d.items || []).map((r: any) => ({
      locationId:   r.locationId   ?? r.location_id   ?? '',
      segment1:     r.segment1     ?? r.SEGMENT1       ?? '',
      segment2:     r.segment2     ?? r.SEGMENT2       ?? '',
      segment3:     r.segment3     ?? r.SEGMENT3       ?? '',
      segment4:     r.segment4     ?? r.SEGMENT4       ?? '',
      fullLocation: r.fullLocation ?? r.full_location  ?? '',
      summaryFlag:  r.summaryFlag  ?? r.summary_flag   ?? '',
      enabledFlag:  r.enabledFlag  ?? r.enabled_flag   ?? '',
    }));
  }
  catch { return []; }
};

export interface CcidRecord {
  ccid: string;
  label: string;
  co: string; lob: string; dept: string; account: string; subAcc: string; alys: string; ic: string; accountType: string;
}

export const getCcids = async (search?: string): Promise<CcidRecord[]> => {
  try {
    const qs = search ? `?search=${encodeURIComponent(search)}` : '';
    const d = await fetchFromApex(`fa/ccid${qs}`);
    return (d.items || []).map((r: any): CcidRecord => ({
      ccid:        String(r.ccid   ?? r.CCID   ?? ''),
      label:       r.label        ?? r.LABEL   ?? '',
      co:          r.co           ?? '',
      lob:         r.lob          ?? '',
      dept:        r.dept         ?? '',
      account:     r.account      ?? '',
      subAcc:      r.subAcc       ?? r.sub_acc ?? '',
      alys:        r.alys         ?? '',
      ic:          r.ic           ?? '',
      accountType: r.accountType  ?? r.account_type ?? '',
    }));
  }
  catch { return []; }
};

export const getBookControls = async (): Promise<BookControlRecord[]> => {
  try { const d = await fetchFromApex('fa/book-controls'); return d.items || []; }
  catch { return []; }
};

// Peek: reads LAST_NUMBER from sequence dictionary — does NOT consume NEXTVAL
// NEXTVAL is called inside the POST procedure at submit time
export const peekAssetNumber = async (): Promise<string> => {
  try {
    const d = await fetchFromApex('fa/peek-asset-number');
    return d.assetNumber ?? d.asset_number ?? '';
  }
  catch { return ''; }
};

export const postAssetDeprn = async (payload: {
  assetId: string;
  bookTypeCode: string;
  periodName: string;
  deprnAmount: number;
  createdBy?: string;
}): Promise<{ success: boolean; status?: string; periodCounter?: number; newReserve?: number; newNbv?: number; error?: string }> => {
  try {
    const res = await fetch(`${APEX_DB_CONFIG.baseUrl}/fa/deprn-post-asset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    return await res.json();
  } catch (e: any) {
    return { success: false, error: e.message };
  }
};

export const postSingleDeprn = async (payload: {
  assetId: string;
  bookTypeCode: string;
  periodName: string;
  deprnAmount?: number;
  createdBy?: string;
}): Promise<{ success: boolean; status?: string; message?: string; distributionId?: number; error?: string }> => {
  try {
    const res = await fetch(`${APEX_DB_CONFIG.baseUrl}/fa/deprn-post-single`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    return { ...data, error: data.success === false ? (data.message || data.error) : undefined };
  } catch (e: any) {
    return { success: false, status: 'ERROR', error: e.message };
  }
};

export const deleteAssetDeprn = async (payload: {
  assetId: string;
  bookTypeCode: string;
  periodName: string;
}): Promise<{ success: boolean; status?: string; error?: string }> => {
  try {
    const res = await fetch(`${APEX_DB_CONFIG.baseUrl}/fa/deprn-post-asset`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    return await res.json();
  } catch (e: any) {
    return { success: false, error: e.message };
  }
};

// Apply a depreciation adjustment to one posted period. Adds the amount to
// YTD Deprn + Deprn Reserve, stores it in Deprn Adjustment, marks ACCOUNTED —
// on RR_FA_DEPRN_DETAIL and RR_FA_DEPRN_SUMMARY (keyed by asset+book+period).
export const adjustDeprn = async (payload: {
  assetId: string;
  bookTypeCode: string;
  periodCounter: number | string;
  distributionId?: number | string | null;
  deprnAdjustmentAmount: number;
  updatedBy?: string;
}): Promise<{
  success: boolean; detailRowsUpdated?: number; summaryRowsUpdated?: number;
  deprnAdjustmentAmount?: number; ytdDeprn?: number; deprnReserve?: number;
  accountedStatus?: string; error?: string;
}> => {
  try {
    const res = await fetch(`${APEX_DB_CONFIG.baseUrl}/fa/deprn-adjust`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    return await res.json();
  } catch (e: any) {
    return { success: false, error: e.message };
  }
};

// Adjust the asset cost (+ increase / - decrease), effective from a period
// forward. Bumps RR_FA_BOOKS.COST + ADJUSTED_COST and, for period_counter >=
// periodCounter, COST and DEPRN_RESERVE on the depreciation detail/summary.
export const adjustCost = async (payload: {
  assetId: string;
  bookTypeCode: string;
  periodCounter: number | string;
  adjustmentAmount: number;
  adjustDate?: string;
  updatedBy?: string;
}): Promise<{
  success: boolean; booksRowsUpdated?: number; detailRowsUpdated?: number;
  summaryRowsUpdated?: number; newCost?: number; newDeprnReserve?: number;
  newNbv?: number; error?: string;
}> => {
  try {
    const res = await fetch(`${APEX_DB_CONFIG.baseUrl}/fa/cost-adjust`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    return await res.json();
  } catch (e: any) {
    return { success: false, error: e.message };
  }
};

// ── Asset retirement ─────────────────────────────────────────────────────────
export interface RetirementPreview {
  success: boolean;
  assetId?: number; assetNumber?: string; bookTypeCode?: string;
  cost?: number; deprnReserve?: number; nbv?: number;
  assetCostAccount?: string; accumDeprnAccount?: string;
  error?: string;
}

export const getRetirementPreview = async (
  assetId: string | number, bookTypeCode: string,
): Promise<RetirementPreview> => {
  try {
    const res = await fetch(
      `${APEX_DB_CONFIG.baseUrl}/fa/assets/${assetId}/retirement-preview?bookTypeCode=${encodeURIComponent(bookTypeCode)}`,
    );
    return await res.json();
  } catch (e: any) {
    return { success: false, error: e.message };
  }
};

export interface RetireLine {
  lineType: string;
  accountCombination: string;
  enteredDr: number;
  enteredCr: number;
}

export const retireAssetWithAccounting = async (payload: {
  assetId: string | number;
  bookTypeCode: string;
  dateRetired?: string;
  costRetired?: number;
  proceedsOfSale?: number;
  costOfRemoval?: number;
  soldTo?: string;
  retirementTypeCode?: string;
  createdBy?: string;
  lines: RetireLine[];
}): Promise<{ success: boolean; retirementId?: number; nbvRetired?: number; gainLoss?: number; error?: string }> => {
  try {
    return await insertToApex('fa/retirements', payload);
  } catch (e: any) {
    return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
  }
};

export const getDeprnPeriods = async (bookTypeCode?: string): Promise<any[]> => {
  try {
    const qs = bookTypeCode ? `?bookTypeCode=${encodeURIComponent(bookTypeCode)}` : '';
    const d = await fetchFromApex(`fa/deprn-periods${qs}`);
    return d.items || [];
  } catch { return []; }
};

export const getDeprnPeriodsCurrent = async (bookTypeCode?: string): Promise<any[]> => {
  try {
    const qs = bookTypeCode ? `?bookTypeCode=${encodeURIComponent(bookTypeCode)}` : '';
    const d = await fetchFromApex(`fa/deprn-periods/current${qs}`);
    return d.items || [];
  } catch { return []; }
};

export const getDeprnLastPeriod = async (bookTypeCode?: string): Promise<any | null> => {
  try {
    const qs = bookTypeCode ? `?bookTypeCode=${encodeURIComponent(bookTypeCode)}` : '';
    const d = await fetchFromApex(`fa/deprn-periods/last${qs}`);
    const items = d.items || [];
    return items.length > 0 ? items[0] : null;
  } catch { return null; }
};

/**
 * Per-asset depreciation for a period — sourced from RR_FA_DEPRN_DETAIL (same
 * table as GET /fa/assets/:assetId/deprn). Returns ALL active assets for the
 * book: those with depreciation for the period show status 'Posted' + the
 * amount; the rest show 'Not Posted'.
 */
export const getDeprnStatus = async (params: {
  bookTypeCode: string;
  periodCounter?: number | string;
  periodName?: string;
  assetNumber?: string;
  limit?: number;
}): Promise<any> => {
  try {
    const q = new URLSearchParams();
    q.append('bookTypeCode', params.bookTypeCode);
    if (params.periodCounter != null) q.append('periodCounter', String(params.periodCounter));
    if (params.periodName) q.append('periodName', params.periodName);
    if (params.assetNumber) q.append('assetNumber', params.assetNumber);
    q.append('limit', String(params.limit ?? 2000));
    return await fetchFromApex(`fa/deprn-by-period?${q.toString()}`);
  } catch (e: any) {
    return { success: false, items: [], summary: null, error: e?.message };
  }
};

// View Depreciation — read straight from RR_FA_DEPRN_DETAIL (no open/max-period
// gating, no calculation). Filter by a single period name and/or a fiscal year.
export const getDeprnView = async (params: {
  bookTypeCode: string;
  periodName?: string;
  fiscalYear?: string;
  assetNumber?: string;
  limit?: number;
}): Promise<any> => {
  try {
    const q = new URLSearchParams();
    q.append('bookTypeCode', params.bookTypeCode);
    if (params.periodName) q.append('periodName', params.periodName);
    if (params.fiscalYear) q.append('fiscalYear', params.fiscalYear);
    if (params.assetNumber) q.append('assetNumber', params.assetNumber);
    q.append('limit', String(params.limit ?? 5000));
    return await fetchFromApex(`fa/deprn-view?${q.toString()}`);
  } catch (e: any) {
    return { success: false, items: [], summary: null, error: e?.message };
  }
};

export const getDeprnPreview = async (bookTypeCode: string, periodName: string): Promise<any> => {
  try {
    const qs = `?bookTypeCode=${encodeURIComponent(bookTypeCode)}&periodName=${encodeURIComponent(periodName)}`;
    return await fetchFromApex(`fa/deprn-calculate/preview${qs}`);
  } catch { return { success: false, items: [], summary: null }; }
};

export const postDeprnCalculate = async (params: {
  bookTypeCode: string;
  periodName: string;
  periodCounter: number;
}): Promise<any> => {
  try {
    return await insertToApex('fa/deprn-calculate', params);
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
  }
};

export const getRetirements = async (bookTypeCode?: string): Promise<RetirementRecord[]> => {
  try {
    const qs = bookTypeCode ? `?bookTypeCode=${encodeURIComponent(bookTypeCode)}` : '';
    const d = await fetchFromApex(`fa/retirements${qs}`);
    return d.items || [];
  } catch { return []; }
};

export const getRetirementAccountingPreview = async (retirementId: string): Promise<any> => {
  try {
    const res = await fetch(`${APEX_DB_CONFIG.baseUrl}/fa/retirements/${encodeURIComponent(retirementId)}/accounting-preview`, {
      headers: { Accept: 'application/json' },
    });
    return await res.json();
  } catch (e: any) {
    return { success: false, error: e.message };
  }
};

export const updateRetirementStatus = async (retirementId: string, status: string): Promise<any> => {
  try {
    const res = await fetch(`${APEX_DB_CONFIG.baseUrl}/fa/retirements/${encodeURIComponent(retirementId)}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ status }),
    });
    return await res.json();
  } catch (e: any) {
    return { success: false, error: e.message };
  }
};

// ── Depreciation Workbench ────────────────────────────────────────────────────

export const getDeprnWorkbench = async (params: {
  bookTypeCode?: string;
  periodCounter?: string;
  assetNumber?: string;
  offset?: number;
  limit?: number;
}): Promise<{ success: boolean; totalCount: number; items: DeprnWorkbenchRecord[]; summary: DeprnWorkbenchSummary; error?: string }> => {
  const q = new URLSearchParams();
  if (params.bookTypeCode)  q.append('bookTypeCode',  params.bookTypeCode);
  if (params.periodCounter) q.append('periodCounter', params.periodCounter);
  if (params.assetNumber)   q.append('assetNumber',   params.assetNumber);
  if (params.offset !== undefined) q.append('offset', String(params.offset));
  if (params.limit  !== undefined) q.append('limit',  String(params.limit));
  try {
    const qs = q.toString();
    return await fetchFromApex(`fa/deprn-workbench${qs ? '?' + qs : ''}`);
  } catch (e) {
    return { success: false, totalCount: 0, items: [],
             summary: { totalCost: 0, totalDeprnReserve: 0, totalNbv: 0, totalDeprnAmount: 0 },
             error: e instanceof Error ? e.message : 'Unknown error' };
  }
};

// ── Write operations ──────────────────────────────────────────────────────────

export const createAsset = async (payload: any): Promise<{ success: boolean; assetId?: string; assetNumber?: string; message?: string; error?: string }> => {
  try { return await insertToApex('fa/assets', payload); }
  catch (e) { return { success: false, error: e instanceof Error ? e.message : 'Unknown error' }; }
};

export const retireAsset = async (assetId: string, payload: any): Promise<{ success: boolean; message?: string; gainLoss?: string; error?: string }> => {
  try { return await insertToApex('fa/retirements', payload); }
  catch (e) { return { success: false, error: e instanceof Error ? e.message : 'Unknown error' }; }
};

export const adjustAsset = async (assetId: string, payload: any): Promise<{ success: boolean; message?: string; newCost?: string; error?: string }> => {
  try { return await putToApex(`fa/assets/${assetId}/adjust`, payload); }
  catch (e) { return { success: false, error: e instanceof Error ? e.message : 'Unknown error' }; }
};

// ── FA Accounting ─────────────────────────────────────────────────────────────

export interface AccountingPreviewLine {
  lineNumber: number;
  lineType: 'DR' | 'CR';
  accountingClass: string;
  description: string;
  accountedDr: number;
  accountedCr: number;
  enteredDr: number;
  enteredCr: number;
  ccid: number | null;
  accountCombination: string | null;
  reference1: string;
  reference2: string;
  reference5: string;
}

export interface AccountingPreviewHeader {
  moduleName: string;
  sourceTable: string;
  sourceId: number;
  sourceNumber: string;
  sourceType: string;
  eventTypeCode: string;
  eventDate: string;
  accountingDate: string;
  periodName: string;
  ledgerId: number;
  ledgerName: string;
  currencyCode: string;
  ledgerCurrency: string;
  description: string;
  bookTypeCode: string;
  assetNumber: string;
  cost: number;
}

export interface AccountingPreview {
  success: boolean;
  accountedStatus: string;
  accountedDate: string | null;
  header: AccountingPreviewHeader;
  lines: AccountingPreviewLine[];
  error?: string;
}

export interface SlaExistsResult {
  exists: boolean;
  headerId?: number;
  accountingStatus?: string;
  glHeaderId?: number;
  glBatchId?: number;
  glBatchName?: string;
  error?: string;
}

// FA-specific: build preview with Dr/Cr accounts from category books
export const getAdditionsAccountingPreview = async (
  assetId: string,
  bookTypeCode: string,
): Promise<AccountingPreview> => {
  try {
    const qs = `assetId=${encodeURIComponent(assetId)}&bookTypeCode=${encodeURIComponent(bookTypeCode)}`;
    const res = await fetch(`${APEX_DB_CONFIG.baseUrl}/fa/accounting/additions-preview?${qs}`, {
      headers: { Accept: 'application/json' },
    });
    return await res.json();
  } catch (e: any) {
    return { success: false, accountedStatus: 'UNACCOUNTED', accountedDate: null, header: {} as any, lines: [], error: e.message };
  }
};

// Check if SLA accounting already exists for this source record
export const checkSlaAccountingExists = async (
  sourceTable: string,
  sourceId: string,
  eventType?: string,
): Promise<SlaExistsResult> => {
  try {
    let qs = `sourceTable=${encodeURIComponent(sourceTable)}&sourceId=${encodeURIComponent(sourceId)}`;
    if (eventType) qs += `&eventType=${encodeURIComponent(eventType)}`;
    const res = await fetch(`${APEX_DB_CONFIG.baseUrl}/sla/accounting/exists?${qs}`, {
      headers: { Accept: 'application/json' },
    });
    return await res.json();
  } catch (e: any) {
    return { exists: false, error: e.message };
  }
};

// Get existing SLA header + lines for a source record
export const getSlaAccounting = async (sourceTable: string, sourceId: string) => {
  try {
    const qs = `sourceTable=${encodeURIComponent(sourceTable)}&sourceId=${encodeURIComponent(sourceId)}`;
    const res = await fetch(`${APEX_DB_CONFIG.baseUrl}/sla/accounting?${qs}`, {
      headers: { Accept: 'application/json' },
    });
    return await res.json();
  } catch (e: any) {
    return { success: false, error: e.message };
  }
};

// Create SLA accounting entries (header + lines)
export const createSlaAccounting = async (body: {
  header: Record<string, any>;
  lines: Record<string, any>[];
}): Promise<{ headerId?: number; lineCount?: number; status?: string; message?: string; error?: string; success?: boolean }> => {
  try {
    const res = await fetch(`${APEX_DB_CONFIG.baseUrl}/sla/accounting/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    return await res.json();
  } catch (e: any) {
    return { error: e.message };
  }
};

// Create GL journal header entry
export const createGlJournalHeader = async (batchId: number, header: Record<string, any>) => {
  try {
    const res = await fetch(`${APEX_DB_CONFIG.baseUrl}/gl/journals/headers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ batchId, items: [header] }),
    });
    return await res.json();
  } catch (e: any) {
    return { success: false, error: e.message };
  }
};

// Create GL journal lines
export const createGlJournalLines = async (headerId: number, lines: Record<string, any>[]) => {
  try {
    const res = await fetch(`${APEX_DB_CONFIG.baseUrl}/gl/journals/lines`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ jeHeaderId: headerId, items: lines }),
    });
    return await res.json();
  } catch (e: any) {
    return { success: false, error: e.message };
  }
};

// Post SLA accounting to GL
export const postSlaAccounting = async (payload: {
  headerId: number;
  postedBy?: string;
  glBatchId: number;
  glBatchName: string;
  glHeaderId: number;
}): Promise<{ headerId?: number; glHeaderId?: number; status?: string; message?: string; error?: string }> => {
  try {
    const res = await fetch(`${APEX_DB_CONFIG.baseUrl}/sla/accounting/post`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    return await res.json();
  } catch (e: any) {
    return { error: e.message };
  }
};

// Mark the FA Addition as ACCOUNTED in RR_FA_ADDITIONS
export const markFaAdditionAccounted = async (payload: {
  assetId: string;
  slaHeaderId: number;
  glHeaderId?: number;
  createdBy?: string;
}): Promise<{ success: boolean; status?: string; message?: string; error?: string }> => {
  try {
    const res = await fetch(`${APEX_DB_CONFIG.baseUrl}/fa/accounting/mark-accounted`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    return await res.json();
  } catch (e: any) {
    return { success: false, error: e.message };
  }
};

// GET depreciation accounting preview for one period
export const getDeprnAccountingPreview = async (
  assetId: string,
  bookTypeCode: string,
  periodName: string,
  distributionId?: string | null,
): Promise<AccountingPreview> => {
  try {
    const qs = new URLSearchParams({
      assetId, bookTypeCode, periodName,
      ...(distributionId ? { distributionId } : {}),
    });
    const res = await fetch(`${APEX_DB_CONFIG.baseUrl}/fa/accounting/deprn-preview?${qs}`, {
      headers: { Accept: 'application/json' },
    });
    return await res.json();
  } catch (e: any) {
    return { success: false, accountedStatus: 'UNACCOUNTED', accountedDate: null, header: {} as any, lines: [], error: e.message };
  }
};

// Mark depreciation period as ACCOUNTED in RR_FA_DEPRN_DETAIL
export const markFaDeprnAccounted = async (payload: {
  assetId: string;
  bookTypeCode: string;
  distributionId?: string | null;
  periodName: string;
  slaHeaderId: number;
  glHeaderId?: number;
  createdBy?: string;
}): Promise<{ success: boolean; rowsUpdated?: number; status?: string; message?: string; error?: string }> => {
  try {
    const res = await fetch(`${APEX_DB_CONFIG.baseUrl}/fa/accounting/mark-deprn-accounted`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    return await res.json();
  } catch (e: any) {
    return { success: false, error: e.message };
  }
};

// ── Update asset attributes ───────────────────────────────────────────────────
export interface AssetAttributesPayload {
  attribute1?: string | null;
  attribute2?: string | null;
  attribute3?: string | null;
  attribute4?: string | null;
  attribute5?: string | null;
  attribute6?: string | null;
  attribute7?: string | null;
  attribute8?: string | null;
  attribute9?: string | null;
  attribute10?: string | null;
  updatedBy?: string;
}

export const updateAssetAttributes = async (
  assetId: string,
  payload: AssetAttributesPayload,
): Promise<{ success: boolean; error?: string; rowsUpdated?: number }> => {
  try {
    const res = await fetch(`${APEX_DB_CONFIG.baseUrl}/fa/assets/${assetId}/attributes`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    return await res.json();
  } catch (e: any) {
    return { success: false, error: e.message };
  }
};

// ── Formatting helpers ────────────────────────────────────────────────────────

export const formatCurrency = (value: string | number, decimals = 2): string => {
  const n = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(n)) return '—';
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(n);
};

export const assetTypeLabel = (type: string): string =>
  ({ CAPITALIZED: 'Capitalized', CIP: 'CIP', EXPENSED: 'Expensed' }[type] || type || '—');

export const assetStatusColor = (retiredFlag: string): string =>
  retiredFlag === 'YES' ? '#cf1322' : '#1D7B4D';

export const assetStatusLabel = (retiredFlag: string): string =>
  retiredFlag === 'YES' ? 'Retired' : 'Active';
