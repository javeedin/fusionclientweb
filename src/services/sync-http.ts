/**
 * sync-http.ts
 * HTTP helpers for Sync services.
 * All Oracle Fusion calls use Basic Auth directly — no proxy.
 * All APEX calls go directly to the APEX base URL.
 */

import { ORACLE_FUSION_CONFIG, ORACLE_SOAP_CONFIG, APEX_DB_CONFIG } from '../config/api.config';

export type LogCallback = (type: 'info' | 'success' | 'error' | 'warning' | 'step', message: string) => void;

const FUSION_HOST = 'https://iaaobn.fa.ocs.oraclecloud.com';
const HCM_BASE    = 'https://iaaobn-test.fa.ocs.oraclecloud.com/hcmRestApi/resources/11.13.18.05';

const oracleAuth = () =>
  `Basic ${btoa(`${ORACLE_FUSION_CONFIG.username}:${ORACLE_FUSION_CONFIG.password}`)}`;

const hcmAuth = () =>
  `Basic ${btoa('javeedindia@gmail.com:Bumeric2026')}`;

const oracleHeaders = () => ({
  Authorization: oracleAuth(),
  'Content-Type': 'application/json',
  Accept: 'application/json',
});

// ── Oracle Fusion (standard endpoint) ────────────────────────────────────────

export const fetchFromOracle = async (
  endpoint: string,
  params: Record<string, string> = {},
  log?: LogCallback,
  verbose = true
): Promise<any> => {
  try {
    const queryParams = new URLSearchParams(params);
    const url = `${ORACLE_FUSION_CONFIG.baseUrl}/${endpoint}?${queryParams.toString()}`;
    if (verbose) { log?.('step', '──── [GET] Oracle Fusion ────'); log?.('info', `GET URL: ${url}`); }

    const response = await fetch(url, { headers: oracleHeaders() });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Oracle API Error: ${response.status} ${response.statusText} — ${errorText.substring(0, 200)}`);
    }
    const data = await response.json();
    if (verbose) log?.('success', `GET Response: ${data.items?.length || 0} records`);
    return { success: true, ...data };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    log?.('error', `GET Error: ${errorMsg}`);
    throw error;
  }
};

// ── Oracle Fusion (full URL) ──────────────────────────────────────────────────

export const fetchFromOracleUrl = async (
  url: string,
  log?: LogCallback,
  verbose = true,
  signal?: AbortSignal,
): Promise<any> => {
  try {
    if (verbose) { log?.('step', '──── [GET] Oracle Fusion URL ────'); log?.('info', `GET URL: ${url}`); }

    const response = await fetch(url, { headers: oracleHeaders(), signal });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Oracle API Error: ${response.status} ${response.statusText} — ${errorText.substring(0, 200)}`);
    }
    const data = await response.json();
    if (verbose) log?.('success', `GET Response: ${data.items?.length || 0} records`);
    return { success: true, ...data };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    log?.('error', `GET Error: ${errorMsg}`);
    throw error;
  }
};

// ── Oracle Fusion (full URL, all pages via pagination) ────────────────────────

export const fetchAllFromOracleUrl = async (
  baseUrl: string,
  log?: LogCallback,
  verbose = false,
  pageSize = 500,
  signal?: AbortSignal,
): Promise<any[]> => {
  const allItems: any[] = [];
  let offset = 0;
  let pageNum = 0;
  let hasMore = true;

  const [urlBase, existingQuery] = baseUrl.split('?');
  const qp = new URLSearchParams(existingQuery || '');
  qp.delete('limit');
  qp.delete('offset');
  const baseQuery = qp.toString();

  while (hasMore) {
    if (signal?.aborted) break;

    pageNum++;
    const pageQp = new URLSearchParams(baseQuery);
    pageQp.set('limit', pageSize.toString());
    pageQp.set('offset', offset.toString());
    const url = `${urlBase}?${pageQp.toString()}`;

    if (verbose) log?.('info', `  Fetching page ${pageNum} (offset ${offset}, limit ${pageSize})…`);

    const result = await fetchFromOracleUrl(url, log, verbose, signal);
    const items: any[] = result.items || [];
    allItems.push(...items);

    const apiHasMore  = result.hasMore === true;
    const gotFullPage = items.length === pageSize;
    hasMore = items.length > 0 && (apiHasMore || gotFullPage);
    offset += items.length;
  }

  if (pageNum > 1 || verbose) {
    log?.('success', `  Total fetched: ${allItems.length} records across ${pageNum} page${pageNum > 1 ? 's' : ''}`);
  }

  return allItems;
};

// ── Oracle Fusion (full path) ─────────────────────────────────────────────────

export const fetchFromFusion = async (
  fusionPath: string,
  params: Record<string, string> = {},
  log?: LogCallback,
  verbose = true
): Promise<any> => {
  try {
    const queryParams = new URLSearchParams(params);
    const url = `${FUSION_HOST}/${fusionPath}?${queryParams.toString()}`;
    if (verbose) { log?.('step', '──── [GET] Oracle Fusion ────'); log?.('info', `GET URL: ${url}`); }

    const response = await fetch(url, { headers: oracleHeaders() });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Fusion API Error: ${response.status} ${response.statusText} — ${errorText.substring(0, 200)}`);
    }
    const data = await response.json();
    if (verbose) log?.('success', `GET Response: ${data.items?.length || 0} records`);
    return { success: true, items: data.items || [], hasMore: data.hasMore, count: data.count };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    log?.('error', `GET Error: ${errorMsg}`);
    throw error;
  }
};

// ── Oracle HCM ────────────────────────────────────────────────────────────────

export const fetchFromHcm = async (
  endpoint: string,
  params: Record<string, string> = {},
  log?: LogCallback,
  verbose = true
): Promise<any> => {
  try {
    const queryParams = new URLSearchParams(params);
    const url = `${HCM_BASE}/${endpoint}?${queryParams.toString()}`;
    if (verbose) { log?.('step', '──── [GET] Oracle HCM ────'); log?.('info', `GET URL: ${url}`); }

    const response = await fetch(url, {
      headers: { Authorization: hcmAuth(), 'Content-Type': 'application/json', Accept: 'application/json' },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HCM API Error: ${response.status} ${response.statusText} — ${errorText.substring(0, 200)}`);
    }
    const data = await response.json();
    if (verbose) log?.('success', `GET Response: ${data.items?.length || 0} records`);
    return { success: true, items: data.items || [], hasMore: data.hasMore, count: data.count };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    log?.('error', `GET Error: ${errorMsg}`);
    throw error;
  }
};

// ── APEX POST ─────────────────────────────────────────────────────────────────

export const insertToApex = async (
  endpoint: string,
  payload: any,
  log?: LogCallback,
  verbose = true
): Promise<any> => {
  try {
    const url = `${APEX_DB_CONFIG.baseUrl}/${endpoint}`;

    if (verbose) {
      log?.('step', '──── [POST] APEX Database ────');
      log?.('info', `APEX URL: ${url}`);
      log?.('info', `POST Payload: ${JSON.stringify(payload).substring(0, 200)}`);
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const responseText = await response.text();
    let data: any;
    try {
      data = JSON.parse(responseText);
    } catch {
      log?.('error', `POST non-JSON response (HTTP ${response.status}): ${responseText.substring(0, 300)}`);
      return { success: false, error: `HTTP ${response.status}: ${responseText.substring(0, 200)}` };
    }
    if (verbose) log?.('success', `POST Response: ${JSON.stringify(data).substring(0, 200)}`);
    return data;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    log?.('error', `POST Error: ${errorMsg}`);
    throw error;
  }
};

// ── APEX PUT ──────────────────────────────────────────────────────────────────

export const putToApex = async (
  endpoint: string,
  payload: any = {},
  log?: LogCallback,
  verbose = true
): Promise<any> => {
  try {
    const url = `${APEX_DB_CONFIG.baseUrl}/${endpoint}`;
    if (verbose) {
      log?.('step', '──── [PUT] APEX Database ────');
      log?.('info', `APEX URL: ${url}`);
    }
    const response = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const responseText = await response.text();
    let data: any;
    try {
      data = JSON.parse(responseText);
    } catch {
      log?.('error', `PUT non-JSON response (HTTP ${response.status}): ${responseText.substring(0, 300)}`);
      return { success: false, error: `HTTP ${response.status}: ${responseText.substring(0, 200)}` };
    }
    if (verbose) log?.('success', `PUT Response: ${JSON.stringify(data).substring(0, 200)}`);
    return data;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    log?.('error', `PUT Error: ${errorMsg}`);
    throw error;
  }
};

// ── APEX GET ──────────────────────────────────────────────────────────────────

export const fetchFromApex = async (
  endpoint: string,
  params: Record<string, string> = {},
  log?: LogCallback,
  verbose = true
): Promise<any> => {
  try {
    const queryParams = new URLSearchParams(params);
    const qs = queryParams.toString();
    const url = qs
      ? `${APEX_DB_CONFIG.baseUrl}/${endpoint}${endpoint.includes('?') ? '&' : '?'}${qs}`
      : `${APEX_DB_CONFIG.baseUrl}/${endpoint}`;

    if (verbose) {
      log?.('step', '──── [GET] APEX Database ────');
      log?.('info', `APEX URL: ${url}`);
    }

    const response = await fetch(url);
    const text = await response.text();
    if (text.trimStart().startsWith('<')) {
      const errMsg = `HTTP ${response.status}: endpoint returned HTML (not JSON). Check the ORDS route exists.`;
      log?.('error', `GET Error: ${errMsg}`);
      throw new Error(errMsg);
    }
    const data = JSON.parse(text);
    if (verbose) log?.('success', `GET Response: ${data.items?.length || 0} items`);
    return data;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    log?.('error', `GET Error: ${errorMsg}`);
    throw error;
  }
};

// ── SOAP — Oracle BI Publisher ────────────────────────────────────────────────

export const callSoapBip = async (
  url: string,
  envelope: string,
  log?: LogCallback
): Promise<{ success: boolean; decodedXml?: string; recordCount?: number; duration?: number; error?: string; details?: string }> => {
  try {
    const startTime = Date.now();
    log?.('info', 'Sending SOAP request...');

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': '"runReport"' },
      body: envelope,
    });

    const duration = Date.now() - startTime;
    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, error: `SOAP Error: ${response.status} ${response.statusText}`, details: errorText.substring(0, 500) };
    }

    const soapResponse = await response.text();
    const match = soapResponse.match(/<reportBytes[^>]*>([^<]+)<\/reportBytes>/);
    if (!match) return { success: false, error: 'No reportBytes found in SOAP response' };

    const binaryString = atob(match[1].trim());
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
    const decodedXml = new TextDecoder('utf-8').decode(bytes);
    const recordCount = (decodedXml.match(/<G_1>/g) || []).length;

    log?.('success', `SOAP decoded — records: ${recordCount}`);
    return { success: true, duration, decodedXml, recordCount };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    log?.('error', `SOAP Error: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
};
