import { APEX_DB_CONFIG } from '../config/api.config';

const BASE = `${APEX_DB_CONFIG.baseUrl}/ap/multiperiod`;

export interface MpaInvoiceSummary {
  invoiceId: number;
  invoiceNumber: string;
  supplier: string;
  supplierNumber: string;
  businessUnit: string;
  invoiceDate: string;
  currencyCode: string;         // schedule currency (may default to AED)
  invoiceCurrency?: string;     // actual invoice header currency (RR_AP_INVOICES_ALL)
  totalLines: number;
  openLines: number;
  closedLines: number;
  totalAmount: number;        // sum of MPA schedule period amounts
  invoiceAmount?: number;     // full invoice header amount (RR_AP_INVOICES_ALL)
  postedAmount: number;
  notPostedAmount: number;
  minPeriodDate: string;
  maxPeriodDate: string;
  mpaStartDate?: string;      // invoice MPA accrual window start
  mpaEndDate?: string;        // invoice MPA accrual window end
}

export interface MpaScheduleLine {
  scheduleId: number;
  lineNumber: number;
  periodDate: string;
  periodName: string;
  originalAmount: number;
  periodAmount: number;
  accrualAccount: string;
  chargeAccount: string;
  description: string;
  postingStatus: string;
  postedDate: string | null;
  postedBy: string | null;
  slaHeaderId: number | null;
}

export interface MpaInvoiceDetail {
  invoiceId: number;
  invoiceNumber: string;
  supplier: string;
  businessUnit: string;
  invoiceDate: string;
  currencyCode: string;
  invoiceAccountingStatus: string | null;
  lines: MpaScheduleLine[];
}

export async function listMpaInvoices(params: {
  invoiceNumber?: string;
  supplier?: string;
  businessUnit?: string;
  postingStatus?: string;
}): Promise<MpaInvoiceSummary[]> {
  const q = new URLSearchParams();
  if (params.invoiceNumber) q.set('invoice_number', params.invoiceNumber);
  if (params.supplier) q.set('supplier', params.supplier);
  if (params.businessUnit) q.set('business_unit', params.businessUnit);
  if (params.postingStatus) q.set('posting_status', params.postingStatus);
  const res = await fetch(`${BASE}${q.toString() ? '?' + q.toString() : ''}`, {
    headers: { Accept: 'application/json' },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data.schedules || [];
}

export async function getMpaSchedule(invoiceId: number): Promise<MpaInvoiceDetail> {
  const res = await fetch(`${BASE}/${invoiceId}`, {
    headers: { Accept: 'application/json' },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

export async function generateMpaSchedule(invoiceId: number): Promise<void> {
  const res = await fetch(`${BASE}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ invoiceId }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data?.error || `HTTP ${res.status}`);
}

export interface FusionMpaLine {
  invoiceId:               number;
  invoiceNumber:           string;
  invoiceDate:             string;
  invoiceAmount:           number;
  invoiceCurrency:         string;
  businessUnit:            string;
  supplier:                string;
  supplierNumber:          string;
  lineNumber:              number;
  lineAmount:              number;
  lineDescription:         string | null;
  chargeAccount:           string | null;
  multiperiodAccrualAccount: string | null;
  multiperiodStartDate:    string;
  multiperiodEndDate:      string;
  scheduleGenerated:       number; // 1 = yes, 0 = no
  totalScheduled:          number;
  postedAmount:            number;
  pendingAmount:           number;
  pendingFromDate:         number;
}

export interface FusionMpaSchedulePeriod {
  scheduleId:     number;
  periodName:     string;
  periodDate:     string;
  periodAmount:   number;
  originalAmount: number;
  postingStatus:  string;
  postedDate:     string | null;
  postedBy:       string | null;
  slaHeaderId:    number | null;
  accrualAccount: string | null;
  chargeAccount:  string | null;
}

export interface FusionMpaDetailLine {
  lineNumber:        number;
  lineAmount:        number;
  lineDescription:   string | null;
  chargeAccount:     string | null;
  accrualAccount:    string | null;
  mpaStartDate:      string;
  mpaEndDate:        string;
  scheduleGenerated: number;
  totalScheduled:    number;
  postedAmount:      number;
  pendingAmount:     number;
  pendingFromDate:   number;
  periods:           FusionMpaSchedulePeriod[];
}

export interface FusionMpaDetail {
  invoiceId:      number;
  invoiceNumber:  string;
  invoiceDate:    string;
  invoiceAmount:  number;
  currencyCode:   string;
  supplier:       string;
  supplierNumber: string;
  businessUnit:   string;
  openAsOf:       string | null;
  lines:          FusionMpaDetailLine[];
}

export async function listFusionMpaLines(params: {
  invoiceNumber?:   string;
  supplier?:        string;
  businessUnit?:    string;
  lineDescription?: string;
  openAsOf?:        string;  // YYYY-MM-DD — only lines with MPA end date >= this date
} = {}): Promise<FusionMpaLine[]> {
  const q = new URLSearchParams();
  if (params.invoiceNumber)   q.set('invoice_number',   params.invoiceNumber);
  if (params.supplier)        q.set('supplier',          params.supplier);
  if (params.businessUnit)    q.set('business_unit',     params.businessUnit);
  if (params.lineDescription) q.set('line_description',  params.lineDescription);
  if (params.openAsOf)        q.set('open_as_of',        params.openAsOf);
  const res = await fetch(`${BASE}/fusion-data${q.toString() ? '?' + q.toString() : ''}`, {
    headers: { Accept: 'application/json' },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return (data.items || []) as FusionMpaLine[];
}

export async function getFusionMpaDetail(
  invoiceId: number,
  openAsOf?: string,
): Promise<FusionMpaDetail> {
  const q = new URLSearchParams();
  if (openAsOf) q.set('open_as_of', openAsOf);
  const res = await fetch(`${BASE}/fusion-detail/${invoiceId}${q.toString() ? '?' + q.toString() : ''}`, {
    headers: { Accept: 'application/json' },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data as FusionMpaDetail;
}

export async function deleteMpaSchedule(invoiceId: number): Promise<{ deleted: number; postedKept: number }> {
  const res = await fetch(`${BASE}/${invoiceId}`, {
    method: 'DELETE',
    headers: { Accept: 'application/json' },
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data?.error || `HTTP ${res.status}`);
  return { deleted: data.deleted, postedKept: data.postedKept };
}

/**
 * Suspend (or resume) multiperiod schedule lines. Only NOT-accounted lines
 * ('Not Posted' / 'Suspended') are affected — 'Posted' rows are skipped.
 * Pass status='Not Posted' to resume a suspended line.
 */
export async function suspendMpaSchedules(
  scheduleIds: number[],
  updatedBy?: string,
  status: 'Suspended' | 'Not Posted' = 'Suspended',
): Promise<{ rowsUpdated: number; skipped: number; status: string }> {
  const res = await fetch(`${BASE}/suspend`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ scheduleIds, status, updatedBy }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data?.error || `HTTP ${res.status}`);
  return { rowsUpdated: data.rowsUpdated, skipped: data.skipped, status: data.status };
}

export async function markPeriodPosted(
  invoiceId: number,
  periodName: string,
  slaHeaderId: number,
  postedBy: string,
  scheduleId?: number,   // when provided, only this one schedule row is updated
): Promise<void> {
  const res = await fetch(`${BASE}/mark-posted`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ scheduleId, invoiceId, periodName, slaHeaderId, postedBy }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data?.error || `HTTP ${res.status}`);
}
