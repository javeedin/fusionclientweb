import { APEX_DB_CONFIG } from '../config/api.config';

const BASE = APEX_DB_CONFIG.baseUrl;

export interface RevenueContract {
  id: number;
  trxNumber: number | null;
  unit: string;
  location: string;
  tenant: string;
  contractStartDate: string;
  contractEndDate: string;
  status: string;
  rentTotal: number;
  scheduleCount: number;
  subaccount: string;
}

export interface RevenueSchedule {
  id: number;
  contractId: number;
  trxNumber: number | null;
  unit: string;
  location: string;
  tenant: string;
  scheduleNum: number;
  periodName: string;
  periodDate: string;
  amount: number;
  invoiceNumber: string | null;
  status: string;
  accountStatus: string;
  businessUnit: string;
  subaccount?: string;   // COA 5th segment, sourced from the parent contract
}

// ORDS json/collection folds quoted camelCase aliases to lowercase, so read
// keys case-insensitively (fall back to the lowercased variant).
const mapContract = (r: any): RevenueContract => ({
  id: r.id,
  trxNumber: r.trxNumber ?? r.trxnumber ?? null,
  unit: r.unit ?? '',
  location: r.location ?? '',
  tenant: r.tenant ?? '',
  contractStartDate: r.contractStartDate ?? r.contractstartdate ?? '',
  contractEndDate: r.contractEndDate ?? r.contractenddate ?? '',
  status: r.status ?? '',
  rentTotal: Number(r.rentTotal ?? r.renttotal ?? 0),
  scheduleCount: Number(r.scheduleCount ?? r.schedulecount ?? 0),
  subaccount: r.subaccount ?? r.subAccount ?? r.sub_account ?? '',
});

const mapSchedule = (r: any): RevenueSchedule => ({
  id: r.id,
  contractId: r.contractId ?? r.contractid,
  trxNumber: r.trxNumber ?? r.trxnumber ?? null,
  unit: r.unit ?? '',
  location: r.location ?? '',
  tenant: r.tenant ?? '',
  scheduleNum: Number(r.scheduleNum ?? r.schedulenum ?? 0),
  periodName: r.periodName ?? r.periodname ?? '',
  periodDate: r.periodDate ?? r.perioddate ?? '',
  amount: Number(r.amount ?? 0),
  invoiceNumber: r.invoiceNumber ?? r.invoicenumber ?? null,
  status: r.status ?? '',
  accountStatus: r.accountStatus ?? r.accountstatus ?? '',
  businessUnit: r.businessUnit ?? r.business_unit ?? r.businessunit ?? r.bu ?? '',
  subaccount: r.subaccount ?? r.subAccount ?? r.sub_account ?? '',
});

export const getRevenueContracts = async (): Promise<RevenueContract[]> => {
  const res = await fetch(`${BASE}/ar/revenue-contracts`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const items = Array.isArray(data) ? data : (data.items || []);
  return items.map(mapContract);
};

export const getRevenueSchedules = async (params?: { contractId?: number; trxNumber?: number }): Promise<RevenueSchedule[]> => {
  const q = new URLSearchParams();
  if (params?.contractId != null) q.append('contractId', String(params.contractId));
  if (params?.trxNumber != null) q.append('trxNumber', String(params.trxNumber));
  const qs = q.toString();
  const res = await fetch(`${BASE}/ar/revenue-schedules${qs ? '?' + qs : ''}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const items = Array.isArray(data) ? data : (data.items || []);
  return items.map(mapSchedule);
};

// Update a revenue schedule by schedule id — used after accounting is posted to
// stamp accountStatus = ACCOUNTED (+ the SLA header id). Mirrors ap/multiperiod
// mark-posted. POST ar/revenue-schedules/mark-accounted.
export const REVENUE_MARK_ACCOUNTED_URL = `${BASE}/ar/revenue-schedules/mark-accounted`;

export interface MarkAccountedResult { success: boolean; scheduleId: number; rowsUpdated?: number; error?: string }

export const markRevenueScheduleAccounted = async (
  scheduleId: number,
  opts?: { slaHeaderId?: number; accountStatus?: string; updatedBy?: string },
): Promise<MarkAccountedResult> => {
  const res = await fetch(REVENUE_MARK_ACCOUNTED_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      scheduleId,
      slaHeaderId:   opts?.slaHeaderId ?? null,
      accountStatus: opts?.accountStatus ?? 'ACCOUNTED',
      updatedBy:     opts?.updatedBy ?? 'SYSTEM',
    }),
  });
  const data = await res.json().catch(() => ({} as any));
  if (!res.ok || data?.success === false) throw new Error(data?.error || `HTTP ${res.status}`);
  return { success: true, scheduleId, rowsUpdated: data?.rowsUpdated };
};

// mode 'monthly' = equal split by inclusive month count (default, unchanged);
// mode 'daily' = day-wise proration (prorates partial first/last months).
export const generateRevenueSchedules = async (
  contractIds: number[], createdBy?: string, mode: 'monthly' | 'daily' = 'monthly',
): Promise<{ success: boolean; contracts?: number; schedules?: number; error?: string }> => {
  try {
    const path = mode === 'daily' ? 'ar/revenue-schedules/generate-daily' : 'ar/revenue-schedules/generate';
    const res = await fetch(`${BASE}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ contractIds, createdBy }),
    });
    return await res.json();
  } catch (e: any) {
    return { success: false, error: e?.message || 'Generate failed' };
  }
};
