import { getApexBaseUrl, getBuimercApexBaseUrl } from './company.config';

/**
 * Build company-specific APEX URLs dynamically
 * Use these functions instead of hardcoding APEX base URLs
 */

function normalizeUrl(url: string): string {
  return url.replace(/\/+/g, '/').replace('https:/', 'https://').replace(/\/$/, '');
}

export function buildApexUrl(endpoint: string): string {
  // APEX REST API calls use direct URLs (not proxied)
  // Only login/auth endpoints use proxy
  const baseUrl = getApexBaseUrl();
  if (!endpoint) return normalizeUrl(baseUrl);
  return normalizeUrl(`${baseUrl}/${endpoint}`);
}

export function buildApexAuthUrl(endpoint: string): string {
  // Use direct APEX URLs (no proxy needed)
  const baseUrl = getApexBaseUrl();
  if (!endpoint) return normalizeUrl(`${baseUrl}/auth`);
  return normalizeUrl(`${baseUrl}/auth/${endpoint}`);
}

export function buildApexAdminUrl(endpoint: string): string {
  // Use direct APEX URLs (no proxy needed)
  const baseUrl = getApexBaseUrl();
  if (!endpoint) return normalizeUrl(`${baseUrl}/admin`);
  return normalizeUrl(`${baseUrl}/admin/${endpoint}`);
}

/**
 * Get company-specific API base URL
 */
export function getApiBaseUrl(): string {
  return normalizeUrl(getApexBaseUrl());
}

/**
 * Build currency rate URLs using BUIMERC (shared currency service)
 * NOTE: Currency rates webservice is centralized in BUIMERC
 */
export function buildCurrencyUrl(endpoint: string): string {
  const baseUrl = getBuimercApexBaseUrl();
  if (!endpoint) return normalizeUrl(baseUrl);
  return normalizeUrl(`${baseUrl}/${endpoint}`);
}
