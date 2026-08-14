/**
 * APEX API Proxy Helper
 * Automatically routes APEX API calls through localhost:3001 proxy to bypass CORS in browser
 */

export function getApexUrl(endpoint: string): string {
  // If it's already a full URL starting with http/https, route through proxy
  if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) {
    // Extract the path after the base URL
    // e.g., https://g827...com/ords/.../ap/payments → http://localhost:3001/api/apex/ap/payments
    try {
      const url = new URL(endpoint);
      const pathAndQuery = url.pathname.substring(url.pathname.lastIndexOf('/ords/') + 6);
      const actualPath = pathAndQuery.split('/').slice(3).join('/'); // Skip /test/FUSIONCLIENTERP/
      return `http://localhost:3001/api/apex/${actualPath}${url.search}`;
    } catch {
      return endpoint;
    }
  }

  // If it's a relative path, construct proxy URL
  return `http://localhost:3001/api/apex${endpoint}`;
}

/**
 * Wrapper around fetch that automatically routes APEX URLs through proxy
 * Usage: Same as fetch(), but automatically handles CORS issues
 */
export async function fetchApex(
  input: string | Request,
  init?: RequestInit
): Promise<Response> {
  let url: string;

  if (typeof input === 'string') {
    url = getApexUrl(input);
  } else {
    url = getApexUrl(input.url);
  }

  return fetch(url, init);
}
