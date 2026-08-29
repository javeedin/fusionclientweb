// ─────────────────────────────────────────────────────────────────────────────
// Report Designer service
// CRUD against the RR_REPORTS ORDS endpoints (reports/designer) plus the
// run-time plumbing: fetching report data from Fusion REST / APEX ORDS,
// deriving ReportBro parameters from sample rows, and rendering PDF/XLSX
// through a ReportBro render server (reportbro-lib).
// ─────────────────────────────────────────────────────────────────────────────
import { buildApexUrl, getFusionAuthHeaders } from '../config/api.helper';
import { getCurrentCompany } from '../config/company.config';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ReportSummary {
  id: number;
  name: string;
  description?: string;
  module: string;
  output_format: string;
  status: string;
  created_by?: string;
  created_on?: string;
  updated_by?: string;
  updated_on?: string;
}

export interface ReportUserParam {
  name: string;          // placeholder name used in the query template, e.g. org
  label: string;         // prompt label shown when running the report
  type: 'string' | 'number' | 'date';
  testValue?: string;    // value used for designer preview / test fetch
}

export interface ReportDataSource {
  sourceType: 'fusion' | 'ords' | 'static';
  path: string;          // fusion: resource name (e.g. shipmentLines); ords: endpoint path (e.g. gl/fiscalperiods)
  query?: string;        // q= template with {param} placeholders (fusion) or extra query params (ords)
  extraQuery?: string;   // appended verbatim, e.g. fields=...&orderBy=...
  limit?: number;
  dataParameter?: string; // name of the array parameter in the report (default: items)
  userParams?: ReportUserParam[];
  staticData?: unknown[]; // rows for sourceType = static
}

export interface ReportRecord extends ReportSummary {
  data_source?: ReportDataSource | null;
  template?: Record<string, unknown> | null;
}

export const REPORT_MODULES = ['GENERAL', 'GL', 'AP', 'AR', 'FA', 'CASH', 'SCM', 'INV', 'OM'];

export const DEFAULT_DATA_SOURCE: ReportDataSource = {
  sourceType: 'fusion',
  path: '',
  query: '',
  extraQuery: '',
  limit: 500,
  dataParameter: 'items',
  userParams: [],
};

// ReportBro render service. reportbro-lib is Python; until a self-hosted
// service is deployed this falls back to the public ReportBro demo server —
// fine for layout testing, not for sensitive data.
export const REPORTBRO_SERVER_URL: string =
  (import.meta.env.REACT_APP_REPORTBRO_SERVER_URL as string) || 'https://www.reportbro.com/report/run';

export const usingDemoRenderServer = (): boolean =>
  REPORTBRO_SERVER_URL.includes('reportbro.com');

// ── CRUD ─────────────────────────────────────────────────────────────────────

const asJson = async (res: Response): Promise<any> => {
  const text = await res.text();
  let body: any = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { error: text }; }
  if (!res.ok || body.success === false) {
    throw new Error(body.error || `HTTP ${res.status}: ${res.statusText}`);
  }
  return body;
};

export async function listReports(search?: string, module?: string, status?: string): Promise<ReportSummary[]> {
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (module) params.set('module', module);
  if (status) params.set('status', status);
  const qs = params.toString();
  const url = buildApexUrl('reports/designer') + (qs ? `?${qs}` : '');
  const body = await asJson(await fetch(url));
  return body.items ?? [];
}

export async function getReport(id: number): Promise<ReportRecord> {
  const body = await asJson(await fetch(buildApexUrl(`reports/designer/${id}`)));
  const row = (body.items ?? [])[0];
  if (!row) throw new Error(`Report ${id} not found`);
  // ORDS returns the CLOB columns as JSON strings — parse them here
  const parse = (v: unknown) => {
    if (v == null || v === '') return null;
    if (typeof v === 'object') return v;
    try { return JSON.parse(String(v)); } catch { return null; }
  };
  return { ...row, data_source: parse(row.data_source), template: parse(row.template) };
}

export async function saveReport(payload: {
  id?: number | null;
  name: string;
  description?: string;
  module?: string;
  output_format?: string;
  status?: string;
  data_source?: ReportDataSource | null;
  template?: Record<string, unknown> | null;
  user?: string;
}): Promise<number> {
  const body = await asJson(await fetch(buildApexUrl('reports/designer'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }));
  return body.id as number;
}

export async function deleteReport(id: number): Promise<void> {
  await asJson(await fetch(buildApexUrl(`reports/designer/${id}`), { method: 'DELETE' }));
}

// ── ORDS web service catalog (RR_WEBSERVICES) ────────────────────────────────

export interface WebServiceParam {
  name: string;
  bind_name?: string;
  source_type?: string;   // URI / HEADER
  param_type?: string;    // STRING / INT / DOUBLE
  access_method?: string; // IN / OUT / INOUT
  origin?: string;        // DEFINED / URITPL / BIND
  comments?: string;
}

export interface WebServiceDef {
  id: number;
  module_name: string;
  pattern: string;        // e.g. gl/fiscalperiods or reports/designer/:id
  method: string;
  source_type?: string;
  comments?: string;
  params: WebServiceParam[];
}

// List the ORDS endpoints catalogued in RR_WEBSERVICES (GET services only —
// those are the ones a report can read data from).
export async function listWebServices(): Promise<WebServiceDef[]> {
  const body = await asJson(await fetch(buildApexUrl('reports/webservices') + '?method=GET'));
  const items: any[] = body.items ?? [];
  return items.map(row => {
    let params: WebServiceParam[] = [];
    try { params = typeof row.params === 'string' ? JSON.parse(row.params) : (row.params ?? []); }
    catch { params = []; }
    return { ...row, params } as WebServiceDef;
  });
}

// Re-scan the ORDS dictionary (USER_ORDS_* views) into RR_WEBSERVICES.
export async function refreshWebServices(): Promise<{ services: number; params: number }> {
  const body = await asJson(await fetch(buildApexUrl('reports/webservices/refresh'), { method: 'POST' }));
  return { services: body.services ?? 0, params: body.params ?? 0 };
}

// ── Data source execution ────────────────────────────────────────────────────

// Replace {param} placeholders with the supplied values
const substitute = (templateStr: string, values: Record<string, string>): string =>
  templateStr.replace(/\{(\w+)\}/g, (_m, name) => values[name] ?? '');

// Names of {placeholders} appearing in the query template
export function extractPlaceholders(query?: string): string[] {
  const names = new Set<string>();
  for (const m of (query || '').matchAll(/\{(\w+)\}/g)) names.add(m[1]);
  return Array.from(names);
}

export function buildDataSourceUrl(ds: ReportDataSource, paramValues: Record<string, string>): string {
  const limit = ds.limit && ds.limit > 0 ? ds.limit : 500;
  // {param} placeholders are valid in the path too (ORDS URI templates like
  // reports/designer/{id})
  const path = substitute(ds.path.replace(/^\//, ''), paramValues);
  if (ds.sourceType === 'fusion') {
    const base = `${getCurrentCompany().fusionBaseUrl}/fscmRestApi/resources/11.13.18.05`;
    const parts: string[] = [];
    const q = substitute(ds.query || '', paramValues).trim();
    if (q) parts.push(`q=${encodeURIComponent(q)}`);
    if (ds.extraQuery) parts.push(substitute(ds.extraQuery, paramValues));
    parts.push('onlyData=true', `limit=${limit}`);
    return `${base}/${path}?${parts.join('&')}`;
  }
  // ords
  const parts: string[] = [];
  if (ds.query) parts.push(substitute(ds.query, paramValues));
  if (ds.extraQuery) parts.push(substitute(ds.extraQuery, paramValues));
  const qs = parts.filter(Boolean).join('&');
  return buildApexUrl(path) + (qs ? `?${qs}` : '');
}

// Fetch the data rows for a report. Fusion sources use the logged-in user's
// Basic auth; ORDS sources go through the app-wide ORDS token interceptor.
export async function fetchDataSourceRows(
  ds: ReportDataSource,
  paramValues: Record<string, string> = {},
): Promise<unknown[]> {
  if (ds.sourceType === 'static') return ds.staticData ?? [];
  if (!ds.path) throw new Error('Data source path is empty — configure the data source first.');

  const url = buildDataSourceUrl(ds, paramValues);
  const headers = ds.sourceType === 'fusion' ? getFusionAuthHeaders() : { Accept: 'application/json' };
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status} from ${ds.sourceType.toUpperCase()}: ${text.slice(0, 400)}`);
  }
  const body = await res.json();
  return Array.isArray(body) ? body : (body.items ?? []);
}

// ── ReportBro parameter derivation ───────────────────────────────────────────

interface RbParameter {
  id: number;
  name: string;
  type: string;
  arrayItemType: string;
  eval: boolean;
  nullable: boolean;
  pattern: string;
  expression: string;
  showOnlyNameType: boolean;
  testData: string;
  children?: RbParameter[];
}

const rbParam = (id: number, name: string, type: string, extra?: Partial<RbParameter>): RbParameter => ({
  id, name, type,
  arrayItemType: 'string',
  eval: false,
  nullable: true,
  pattern: '',
  expression: '',
  showOnlyNameType: false,
  testData: '',
  ...extra,
});

const fieldType = (v: unknown): string => {
  if (typeof v === 'number') return 'number';
  if (typeof v === 'boolean') return 'boolean';
  return 'string';
};

/**
 * Merge derived data parameters into an existing ReportBro report definition.
 * Builds one array parameter (named by dataParameter, default "items") whose
 * children are the fields of the first sample row, plus one simple parameter
 * per user param. Existing parameters with other names (page_number, custom
 * ones the user added) are preserved.
 */
export function mergeDataParameters(
  reportDef: Record<string, any>,
  rows: unknown[],
  ds: ReportDataSource,
): Record<string, any> {
  const dataName = ds.dataParameter || 'items';
  const sample = (rows[0] ?? {}) as Record<string, unknown>;
  const existing: RbParameter[] = Array.isArray(reportDef.parameters) ? reportDef.parameters : [];

  // find a safe id range above everything already in the definition
  let maxId = 0;
  const scanIds = (obj: unknown): void => {
    if (Array.isArray(obj)) { obj.forEach(scanIds); return; }
    if (obj && typeof obj === 'object') {
      const rec = obj as Record<string, unknown>;
      if (typeof rec.id === 'number' && rec.id > maxId) maxId = rec.id;
      Object.values(rec).forEach(v => { if (v && typeof v === 'object') scanIds(v); });
    }
  };
  scanIds(reportDef);
  let nextId = maxId + 1;

  const managedNames = new Set<string>([dataName, ...(ds.userParams ?? []).map(p => p.name)]);
  const kept = existing.filter(p => !managedNames.has(p.name));

  const children = Object.entries(sample)
    .filter(([, v]) => typeof v !== 'object' || v === null)
    .map(([k, v]) => rbParam(nextId++, k, fieldType(v)));

  const dataParam = rbParam(nextId++, dataName, 'array', {
    children,
    testData: JSON.stringify(rows.slice(0, 5)),
  });

  const userParamDefs = (ds.userParams ?? []).map(p =>
    rbParam(nextId++, p.name, p.type === 'number' ? 'number' : p.type === 'date' ? 'date' : 'string', {
      testData: p.testValue ?? '',
    }),
  );

  return { ...reportDef, parameters: [...kept, dataParam, ...userParamDefs] };
}

// ── Rendering (ReportBro server protocol) ────────────────────────────────────

/**
 * Render a report through the ReportBro render service.
 * Protocol (same one the designer preview uses): PUT the report definition +
 * data; the server replies either with "key:<id>" (fetch the file with a GET)
 * or with the binary file directly.
 */
export async function renderReport(
  reportDef: Record<string, unknown>,
  data: Record<string, unknown>,
  outputFormat: 'pdf' | 'xlsx' = 'pdf',
): Promise<Blob> {
  const res = await fetch(REPORTBRO_SERVER_URL, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ report: reportDef, outputFormat, data, isTestData: false }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Render service error (HTTP ${res.status}): ${text.slice(0, 400)}`);
  }
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/pdf') || contentType.includes('officedocument')) {
    return res.blob();
  }
  const text = await res.text();
  if (text.startsWith('key:')) {
    const key = text.substring(4);
    const fileRes = await fetch(`${REPORTBRO_SERVER_URL}?key=${encodeURIComponent(key)}&outputFormat=${outputFormat}`);
    if (!fileRes.ok) throw new Error(`Render service error fetching file (HTTP ${fileRes.status})`);
    return fileRes.blob();
  }
  // some servers return the error details as plain text
  throw new Error(`Unexpected render service response: ${text.slice(0, 400)}`);
}

/** Run a saved report end-to-end: fetch data, render, return the output blob. */
export async function runReport(
  report: ReportRecord,
  paramValues: Record<string, string> = {},
  outputFormat?: 'pdf' | 'xlsx',
): Promise<Blob> {
  if (!report.template) throw new Error('This report has no saved layout yet.');
  const ds = report.data_source || DEFAULT_DATA_SOURCE;
  const rows = await fetchDataSourceRows(ds, paramValues);
  const data: Record<string, unknown> = { [ds.dataParameter || 'items']: rows, ...paramValues };
  return renderReport(report.template, data, outputFormat || (report.output_format as 'pdf' | 'xlsx') || 'pdf');
}
