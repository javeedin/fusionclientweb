// ── ORDS fetch interceptor ───────────────────────────────────────────────────
// Installed once at app startup (imported from main.tsx). When
// REACT_APP_ORDS_USE_TOKEN=YES, every fetch to the active company's ORDS
// schema (<origin>/ords/<schema>/…) automatically carries
// "Authorization: Bearer <token>" — no per-page changes anywhere in the app.
// Fusion pod calls, the currency proxy, localhost, and the token endpoint
// itself are untouched. On a 401 from ORDS the cached token is dropped and
// the request retried once with a fresh one.
// With the switch on NO (or credentials unset) this module changes nothing.
import { ordsTokenEnabled, getOrdsToken, getOrdsSchemaRoot, getOrdsTokenUrl, clearOrdsToken } from './ordsToken.service';

const urlOf = (input: RequestInfo | URL): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

const isOrdsApiUrl = (url: string): boolean => {
  const root = getOrdsSchemaRoot();
  if (!root || !url.startsWith(root)) return false;
  return !url.startsWith(getOrdsTokenUrl()); // never intercept the token call itself
};

export function installOrdsFetchInterceptor(): void {
  if (!ordsTokenEnabled()) return;                 // switch is NO → leave fetch alone
  const w = window as any;
  if (w.__ordsFetchIntercepted) return;            // idempotent (HMR / double import)
  w.__ordsFetchIntercepted = true;

  const rawFetch = window.fetch.bind(window);

  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = urlOf(input);
    if (!isOrdsApiUrl(url)) return rawFetch(input, init);

    const withToken = async (): Promise<RequestInit> => {
      let token = '';
      try { token = await getOrdsToken(); } catch { /* token service down — send as-is */ }
      if (!token) return init ?? {};
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      headers.set('Authorization', `Bearer ${token}`);
      return { ...init, headers };
    };

    let res = await rawFetch(input, await withToken());
    if (res.status === 401) {
      // Token expired/revoked mid-flight → refresh once and retry.
      clearOrdsToken();
      res = await rawFetch(input, await withToken());
    }
    return res;
  }) as typeof window.fetch;

  console.log('[ords-token] fetch interceptor active for', getOrdsSchemaRoot());
}
