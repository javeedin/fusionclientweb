import { getApexBaseUrl } from './company.config';

/**
 * Build company-specific APEX URLs dynamically
 * Use these functions instead of hardcoding APEX base URLs
 */

export function buildApexUrl(endpoint: string): string {
  const baseUrl = getApexBaseUrl();
  return `${baseUrl}/${endpoint}`.replace(/\/+/g, '/').replace('https:/', 'https://');
}

export function buildApexAuthUrl(endpoint: string): string {
  const baseUrl = getApexBaseUrl();
  return `${baseUrl}/auth/${endpoint}`.replace(/\/+/g, '/').replace('https:/', 'https://');
}

export function buildApexAdminUrl(endpoint: string): string {
  const baseUrl = getApexBaseUrl();
  return `${baseUrl}/admin/${endpoint}`.replace(/\/+/g, '/').replace('https:/', 'https://');
}

/**
 * Get company-specific API base URL
 */
export function getApiBaseUrl(): string {
  return getApexBaseUrl();
}
