import { getApexBaseUrl } from './company.config';

/**
 * Build company-specific APEX URLs dynamically
 * Use these functions instead of hardcoding APEX base URLs
 */

function normalizeUrl(url: string): string {
  return url.replace(/\/+/g, '/').replace('https:/', 'https://').replace(/\/$/, '');
}

export function buildApexUrl(endpoint: string): string {
  const baseUrl = getApexBaseUrl();
  if (!endpoint) return normalizeUrl(baseUrl);
  return normalizeUrl(`${baseUrl}/${endpoint}`);
}

export function buildApexAuthUrl(endpoint: string): string {
  const baseUrl = getApexBaseUrl();
  if (!endpoint) return normalizeUrl(`${baseUrl}/auth`);
  return normalizeUrl(`${baseUrl}/auth/${endpoint}`);
}

export function buildApexAdminUrl(endpoint: string): string {
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
