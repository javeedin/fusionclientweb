import { getCurrentCompany } from './company.config';

// Get base URL based on environment
const getBaseUrl = () => {
  if (typeof window === 'undefined') {
    return ''; // SSR
  }

  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) {
    return 'http://localhost:3000'; // Local dev server
  }

  return process.env.REACT_APP_VERCEL_URL
    ? `https://${process.env.REACT_APP_VERCEL_URL}`
    : window.location.origin;
};

/**
 * Call Fusion Cloud REST API through Vercel proxy
 * @param path API path (e.g., '/suppliers?limit=10')
 * @param method HTTP method (GET, POST, PUT, DELETE)
 * @param body Request body for POST/PUT
 * @returns API response
 */
export async function callFusionApi(
  path: string,
  method: string = 'GET',
  body?: any
): Promise<any> {
  const company = getCurrentCompany();
  const baseUrl = getBaseUrl();
  const proxyUrl = `${baseUrl}/api/fusion`;

  // Get selected Fusion instance URL if user logged in with Fusion
  const fusionInstanceUrl = typeof window !== 'undefined'
    ? sessionStorage.getItem('fusionInstanceUrl')
    : null;

  try {
    const response = await fetch(proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method,
        path,
        body,
        companyCode: company.code,
        fusionInstanceUrl, // Pass selected instance URL if available
      }),
    });

    if (!response.ok) {
      throw new Error(`Fusion API error: ${response.status}`);
    }

    return response.json();
  } catch (error: any) {
    console.error(`[FUSION API] ${method} ${path}`, error);
    throw error;
  }
}

/**
 * Call Oracle APEX ORDS API through Vercel proxy
 * @param path API path (e.g., '/gl/journals')
 * @param method HTTP method (GET, POST, PUT, DELETE)
 * @param body Request body for POST/PUT
 * @returns API response
 */
export async function callApexApi(
  path: string,
  method: string = 'GET',
  body?: any
): Promise<any> {
  const company = getCurrentCompany();
  const baseUrl = getBaseUrl();
  const proxyUrl = `${baseUrl}/api/apex`;

  try {
    const response = await fetch(proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method,
        path,
        body,
        companyCode: company.code,
      }),
    });

    if (!response.ok) {
      throw new Error(`APEX API error: ${response.status}`);
    }

    return response.json();
  } catch (error: any) {
    console.error(`[APEX API] ${method} ${path}`, error);
    throw error;
  }
}

/**
 * Construct full Fusion API URL (for logging/debugging)
 */
export function buildFusionUrl(path: string): string {
  const company = getCurrentCompany();
  return `${company.fusionBaseUrl}${path}`;
}

/**
 * Construct full APEX API URL (for logging/debugging)
 */
export function buildApexUrl(path: string): string {
  const company = getCurrentCompany();
  return `${company.apexBaseUrl}${path}`;
}
