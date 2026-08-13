import { APEX_DB_CONFIG } from '../config/api.config';

const BASE = `${APEX_DB_CONFIG.baseUrl}/pc`;

export interface PCRegister {
  registerId: number;
  registerName: string;
  businessUnit: string;
  startDate: string | null;
  endDate: string | null;
  comments: string | null;
  cashAccountCcid: number | null;
  cashAccountDesc: string | null;
  currency: string;
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'CLOSED' | 'Transferred';
  balance: number;
  totalDebit: number;
  totalCredit: number;
  ownedBy: string | null;
  limit: number | null;
  createdBy: string | null;
  creationDate: string | null;
}

export interface PCTransaction {
  transactionId: number;
  registerId: number;
  lineNumber: number;
  transactionDate: string;
  transactionType: 'Balance Refill' | 'Balance Refund' | 'Opening Fund Balance' | 'Expense' | 'Adjustment' | 'Balance Return' | 'Balance Brought Fwd';
  expenseType: string | null;
  chargeAccountCcid: number | null;
  chargeAccountDesc: string | null;
  accountingDate: string | null;
  accountingPeriod: string | null;
  postingStatus: 'Unposted' | 'Posted' | 'Error';
  currency: string;
  debitAmount: number;
  creditAmount: number;
  suspenseAmount: number;
  originalSuspenseAmount?: number | null;
  comments: string | null;
  referenceDescription: string | null;
  referenceNo: string | null;
  attachment: string | null;
  hasAttachment: 'Y' | 'N' | null;
  employeeName: string | null;
  receiptStatus: 'YES' | 'NO' | null;
  bankTxnId: number | null;
  createdBy: string | null;
  creationDate: string | null;
  runningBalance: number;
  attachmentCount?: number;
}

export interface PCAttachment {
  attachmentId: number;
  registerId: number;
  transactionId: number | null;
  referenceNo: string | null;
  fileName: string;
  mimeType: string | null;
  createdBy: string | null;
  creationDate: string | null;
  fileData?: string; // only present in single-get response
}

export interface APPeriod {
  periodName: string;
  startDate: string;    // YYYY-MM-DD
  endDate: string;      // YYYY-MM-DD
  periodYear: number;
  periodNumber: number;
  status: string;
}

export interface SearchRegistersParams {
  q?: string;
  status?: string;
  bu?: string;
  dateFrom?: string;
  dateTo?: string;
}

export async function searchRegisters(params: SearchRegistersParams = {}): Promise<PCRegister[]> {
  const qs = new URLSearchParams();
  if (params.q)        qs.set('q',        params.q);
  if (params.status)   qs.set('status',   params.status);
  if (params.bu)       qs.set('bu',       params.bu);
  if (params.dateFrom) qs.set('dateFrom', params.dateFrom);
  if (params.dateTo)   qs.set('dateTo',   params.dateTo);
  const url = `${BASE}/registers${qs.toString() ? '?' + qs.toString() : ''}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || `HTTP ${res.status}`);
  return (data.items || []) as PCRegister[];
}

export async function getRegister(registerId: number): Promise<PCRegister> {
  const res = await fetch(`${BASE}/registers/${registerId}`, { headers: { Accept: 'application/json' } });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || `HTTP ${res.status}`);
  return data as PCRegister;
}

export async function createRegister(payload: Partial<PCRegister> & { createdBy?: string }): Promise<{ registerId: number }> {
  const res = await fetch(`${BASE}/registers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data?.message || `HTTP ${res.status}`);
  return data;
}

export async function updateRegister(registerId: number, payload: Partial<PCRegister> & { updatedBy?: string }): Promise<void> {
  const res = await fetch(`${BASE}/registers/${registerId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data?.message || `HTTP ${res.status}`);
}

export async function deleteRegister(registerId: number): Promise<void> {
  const res = await fetch(`${BASE}/registers/${registerId}`, {
    method: 'DELETE',
    headers: { Accept: 'application/json' },
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data?.message || `HTTP ${res.status}`);
}

export async function getOpenAPPeriods(): Promise<APPeriod[]> {
  const res = await fetch(`${BASE}/openperiods`, { headers: { Accept: 'application/json' } });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || `HTTP ${res.status}`);
  return (data.items || []) as APPeriod[];
}

export async function getTransaction(transactionId: number): Promise<PCTransaction> {
  const res = await fetch(`${BASE}/transactions/${transactionId}`, { headers: { Accept: 'application/json' } });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || `HTTP ${res.status}`);
  return data as PCTransaction;
}

export async function getTransactions(registerId: number): Promise<PCTransaction[]> {
  const res = await fetch(`${BASE}/registers/${registerId}/transactions`, { headers: { Accept: 'application/json' } });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || `HTTP ${res.status}`);
  return (data.items || []) as PCTransaction[];
}

export async function createTransaction(payload: Partial<PCTransaction> & { createdBy?: string }): Promise<{ transactionId: number; lineNumber: number }> {
  const res = await fetch(`${BASE}/transactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data?.message || `HTTP ${res.status}`);
  return data;
}

export async function updateTransaction(transactionId: number, payload: Partial<PCTransaction> & { updatedBy?: string }): Promise<void> {
  const res = await fetch(`${BASE}/transactions/${transactionId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data?.message || `HTTP ${res.status}`);
}

export async function getTransactionAttachment(transactionId: number): Promise<{ fileName: string; attachmentData: string }> {
  const res = await fetch(`${BASE}/transactions/${transactionId}/attachment`, { headers: { Accept: 'application/json' } });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data?.message || `HTTP ${res.status}`);
  return data;
}

export async function deleteTransaction(transactionId: number): Promise<void> {
  const res = await fetch(`${BASE}/transactions/${transactionId}`, {
    method: 'DELETE',
    headers: { Accept: 'application/json' },
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data?.message || `HTTP ${res.status}`);
}

export async function updateTransactionStatus(
  transactionId: number,
  postingStatus: 'Unposted' | 'Posted' | 'Error',
  updatedBy?: string,
): Promise<void> {
  const res = await fetch(`${BASE}/transactions/${transactionId}/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ postingStatus, updatedBy: updatedBy ?? 'SYSTEM' }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data?.message || `HTTP ${res.status}`);
}

export async function getNextVoucherNo(registerId: number): Promise<string> {
  const res = await fetch(`${BASE}/registers/${registerId}/nextvoucherno`, { headers: { Accept: 'application/json' } });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || `HTTP ${res.status}`);
  return data.voucherNo as string;
}

export async function addAttachment(payload: {
  registerId: number;
  transactionId?: number;
  referenceNo?: string;
  fileName: string;
  fileData: string;
  mimeType?: string;
  createdBy?: string;
}): Promise<{ attachmentId: number }> {
  const res = await fetch(`${BASE}/attachments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data?.message || `HTTP ${res.status}`);
  return data;
}

export async function getAttachments(
  registerId: number,
  transactionId?: number,
  referenceNo?: string,
): Promise<PCAttachment[]> {
  const qs = new URLSearchParams();
  if (transactionId != null) qs.set('transactionId', String(transactionId));
  else {
    qs.set('registerId', String(registerId));
    if (referenceNo) qs.set('referenceNo', referenceNo);
  }
  const res = await fetch(`${BASE}/attachments?${qs.toString()}`, { headers: { Accept: 'application/json' } });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || `HTTP ${res.status}`);
  return (data.items || []) as PCAttachment[];
}

export async function getAttachmentData(attachmentId: number): Promise<{ fileName: string; fileData: string; mimeType: string | null }> {
  const res = await fetch(`${BASE}/attachments/${attachmentId}`, { headers: { Accept: 'application/json' } });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data?.message || `HTTP ${res.status}`);
  return { fileName: data.fileName, fileData: data.fileData, mimeType: data.mimeType ?? null };
}

export async function deleteAttachment(attachmentId: number): Promise<void> {
  const res = await fetch(`${BASE}/attachments/${attachmentId}`, {
    method: 'DELETE',
    headers: { Accept: 'application/json' },
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data?.message || `HTTP ${res.status}`);
}
