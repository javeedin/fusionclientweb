import { APEX_DB_CONFIG } from '../config/api.config';

const BASE = `${APEX_DB_CONFIG.baseUrl}/distributions`;

export interface DistCombination {
  combinationId: number;
  combinationName: string;
  businessUnit: string | null;
  glAccountCcid: number | null;
  glAccountDesc: string | null;
  module: string;
  description: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  createdBy: string | null;
  creationDate: string | null;
  lastUpdatedBy: string | null;
  lastUpdateDate: string | null;
}

export interface SearchCombinationsParams {
  q?: string;
  module?: string;
  status?: string;
  bu?: string;
}

export async function searchCombinations(params: SearchCombinationsParams = {}): Promise<DistCombination[]> {
  const qs = new URLSearchParams();
  if (params.q)      qs.set('q',      params.q);
  if (params.module) qs.set('module', params.module);
  if (params.status) qs.set('status', params.status);
  if (params.bu)     qs.set('bu',     params.bu);
  const url = `${BASE}/combinations${qs.toString() ? '?' + qs.toString() : ''}`;
  const res  = await fetch(url, { headers: { Accept: 'application/json' } });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || `HTTP ${res.status}`);
  return (data.items || []) as DistCombination[];
}

export async function createCombination(
  payload: Partial<DistCombination> & { createdBy?: string }
): Promise<{ combinationId: number }> {
  const res = await fetch(`${BASE}/combinations`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body:    JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data?.message || `HTTP ${res.status}`);
  return data;
}

export async function updateCombination(
  combinationId: number,
  payload: Partial<DistCombination> & { updatedBy?: string }
): Promise<void> {
  const res = await fetch(`${BASE}/combinations/${combinationId}`, {
    method:  'PUT',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body:    JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data?.message || `HTTP ${res.status}`);
}

export async function deleteCombination(combinationId: number): Promise<void> {
  const res = await fetch(`${BASE}/combinations/${combinationId}`, {
    method:  'DELETE',
    headers: { Accept: 'application/json' },
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data?.message || `HTTP ${res.status}`);
}

export const MODULES = ['AP', 'PC', 'GL', 'FA', 'AR', 'CASH', 'ALL', 'GL Revaluation'] as const;
export type ModuleType = typeof MODULES[number];
