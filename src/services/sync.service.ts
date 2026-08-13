import { PROXY_CONFIG, ORACLE_FUSION_CONFIG, type SyncObjectConfig } from '../config/api.config';
import type { SyncResult } from '../types/sync.types';

// Logger callback type
type LogCallback = (type: 'info' | 'success' | 'error' | 'warning', message: string) => void;

// Check if proxy is available
export const checkProxyHealth = async (): Promise<boolean> => {
  try {
    const response = await fetch(`${PROXY_CONFIG.baseUrl}/health`);
    return response.ok;
  } catch {
    return false;
  }
};

// Build Oracle URL (for display purposes)
export const buildOracleUrl = (
  objectConfig: SyncObjectConfig,
  parameters: Record<string, string>,
  offset: number = 0,
  limit: number = ORACLE_FUSION_CONFIG.defaultLimit
): string => {
  const queryParams = new URLSearchParams();

  const filters = Object.entries(parameters)
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}=${value}`)
    .join(';');

  if (filters) {
    queryParams.append('q', filters);
  }

  queryParams.append('offset', offset.toString());
  queryParams.append('limit', limit.toString());

  return `${ORACLE_FUSION_CONFIG.baseUrl}/${objectConfig.oracleEndpoint}?${queryParams.toString()}`;
};

// Test Oracle connection via proxy
export const testOracleConnection = async (
  _objectConfig: SyncObjectConfig,
  _parameters: Record<string, string>,
  log?: LogCallback,
  verboseConsole: boolean = false
): Promise<SyncResult> => {
  log?.('info', 'Testing connection via proxy server...');
  log?.('info', `Proxy URL: ${PROXY_CONFIG.baseUrl}`);

  // First check if proxy is running
  const proxyHealthy = await checkProxyHealth();
  if (!proxyHealthy) {
    log?.('error', 'Proxy server is not running!');
    log?.('warning', 'Please start the proxy server with: npm run server');
    log?.('info', 'Run in a separate terminal: node server/proxy.js');
    return {
      success: false,
      error: 'Proxy server is not running. Start it with: npm run server',
    };
  }

  log?.('success', 'Proxy server is running');

  try {
    const url = `${PROXY_CONFIG.baseUrl}/test/oracle`;
    log?.('info', `Testing Oracle via: ${url}`);

    const response = await fetch(url);
    const data = await response.json();
    if (verboseConsole) console.log('Test Oracle Response:', data);

    if (data.success) {
      log?.('success', `Oracle connection successful! (${data.duration}ms)`);
      log?.('success', `Found ${data.count} records, hasMore: ${data.hasMore}`);
      if (data.sampleKeys?.length > 0) {
        log?.('info', `Sample fields: ${data.sampleKeys.slice(0, 5).join(', ')}...`);
      }
      return { success: true, totalCount: data.count };
    } else {
      log?.('error', `Oracle connection failed: ${data.error}`);
      log?.('error', `Status: ${data.status} ${data.statusText}`);
      return { success: false, error: data.error };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log?.('error', `Connection test failed: ${errorMessage}`);
    return { success: false, error: errorMessage };
  }
};

// Fetch from Oracle via proxy
export const fetchFromOracle = async (
  objectConfig: SyncObjectConfig,
  parameters: Record<string, string>,
  offset: number = 0,
  limit: number = ORACLE_FUSION_CONFIG.defaultLimit,
  log?: LogCallback,
  verboseConsole: boolean = false
): Promise<SyncResult> => {
  try {
    // Build query params
    const queryParams = new URLSearchParams();

    const filters = Object.entries(parameters)
      .filter(([, value]) => value)
      .map(([key, value]) => `${key}=${value}`)
      .join(';');

    if (filters) {
      queryParams.append('q', filters);
    }

    queryParams.append('offset', offset.toString());
    queryParams.append('limit', limit.toString());

    const url = `${PROXY_CONFIG.baseUrl}/oracle/${objectConfig.oracleEndpoint}?${queryParams.toString()}`;

    if (verboseConsole) {
      console.log('=== FETCH FROM ORACLE (via proxy) ===');
      console.log('URL:', url);
    }

    log?.('info', `Fetching via proxy: ${objectConfig.oracleEndpoint}`);
    log?.('info', `Params: offset=${offset}, limit=${limit}`);

    const startTime = Date.now();
    const response = await fetch(url);
    const duration = Date.now() - startTime;

    const data = await response.json();
    if (verboseConsole) console.log('Response:', { success: data.success, items: data.items?.length, hasMore: data.hasMore });

    if (!data.success) {
      log?.('error', `Fetch failed: ${data.error}`);
      return { success: false, error: data.error };
    }

    const items = data.items || [];
    const hasMore = data.hasMore || false;
    const totalCount = data.totalResults || data.count || items.length;

    log?.('success', `Fetched ${items.length} records in ${duration}ms (hasMore: ${hasMore})`);

    return {
      success: true,
      data: items,
      count: items.length,
      hasMore,
      offset,
      limit,
      totalCount,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    if (verboseConsole) console.error('Fetch error:', error);
    log?.('error', `Fetch error: ${errorMessage}`);
    return { success: false, error: errorMessage };
  }
};

// Insert to APEX via proxy
export const insertToApex = async (
  objectConfig: SyncObjectConfig,
  records: unknown[],
  log?: LogCallback,
  verboseConsole: boolean = false
): Promise<SyncResult> => {
  try {
    const url = `${PROXY_CONFIG.baseUrl}/apex/${objectConfig.apexEndpoint}`;

    if (verboseConsole) {
      console.log('=== INSERT TO APEX (via proxy) ===');
      console.log('URL:', url);
      console.log('Records:', records.length);
    }

    log?.('info', `Inserting via proxy: ${objectConfig.apexEndpoint}`);
    log?.('info', `Payload: ${records.length} records`);

    const startTime = Date.now();
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ items: records }),
    });
    const duration = Date.now() - startTime;

    const data = await response.json();
    if (verboseConsole) console.log('Response:', data);

    if (!data.success) {
      log?.('error', `Insert failed: ${data.error}`);
      if (data.details) {
        log?.('error', `Details: ${data.details.substring(0, 200)}`);
      }
      return { success: false, error: data.error };
    }

    log?.('success', `Inserted ${records.length} records in ${duration}ms`);

    return {
      success: true,
      count: records.length,
      data: data,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    if (verboseConsole) console.error('Insert error:', error);
    log?.('error', `Insert error: ${errorMessage}`);
    return { success: false, error: errorMessage, count: 0 };
  }
};

// Get total count from Oracle via proxy
export const getOracleTotalCount = async (
  objectConfig: SyncObjectConfig,
  parameters: Record<string, string>,
  log?: LogCallback,
  verboseConsole: boolean = false
): Promise<number> => {
  try {
    const queryParams = new URLSearchParams();

    const filters = Object.entries(parameters)
      .filter(([, value]) => value)
      .map(([key, value]) => `${key}=${value}`)
      .join(';');

    if (filters) {
      queryParams.append('q', filters);
    }

    queryParams.append('offset', '0');
    queryParams.append('limit', '1');
    queryParams.append('onlyData', 'true');

    const url = `${PROXY_CONFIG.baseUrl}/oracle/${objectConfig.oracleEndpoint}?${queryParams.toString()}`;

    if (verboseConsole) {
      console.log('=== GET ORACLE COUNT (via proxy) ===');
      console.log('URL:', url);
    }

    log?.('info', `Getting count via proxy...`);

    const response = await fetch(url);
    const data = await response.json();

    if (!data.success) {
      log?.('error', `Failed to get count: ${data.error}`);
      return 0;
    }

    const count = data.totalResults || data.count || 0;
    log?.('success', `Total records in Oracle: ${count}`);

    return count;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    if (verboseConsole) console.error('Get count error:', error);
    log?.('error', `Failed to get count: ${errorMessage}`);
    return 0;
  }
};
