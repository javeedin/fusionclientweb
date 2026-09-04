// ── Global API capture for Teach AI ─────────────────────────────────────────
// Patches window.fetch once and records recent successful calls to the APEX
// REST API (any page, no per-page wiring). The global Teach AI button lets
// the user pick one of these and save it as a training recipe.

export interface CapturedCall {
  method: string;
  path: string;                     // /cash/externaltransactions
  params: Record<string, string>;   // query parameters used
  route: string;                    // app route active when the call ran
  at: number;
}

const MAX_CALLS = 10;
const buffer: CapturedCall[] = [];
let installed = false;

// noise we never want to teach
const EXCLUDED = [
  '/ai/training', '/settings/claudekey', '/auth/', '/approvals/requests',
];

const currentRoute = (): string => {
  const h = window.location.hash;
  if (h && h.length > 1) return h.slice(1).split('?')[0];
  return window.location.pathname;
};

export function installApiCapture(apexBase: string): void {
  if (installed) return;
  installed = true;
  const base = apexBase.replace(/\/+$/, '');
  const origFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const res = await origFetch(input, init);
    try {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = (init?.method || (typeof input === 'object' && 'method' in input ? (input as Request).method : 'GET') || 'GET').toUpperCase();
      if (res.ok && url.startsWith(base) && method !== 'OPTIONS') {
        const rest = url.slice(base.length);
        const [path, qs] = rest.split('?');
        if (path && path.startsWith('/') && !EXCLUDED.some(x => path.startsWith(x))) {
          const params: Record<string, string> = {};
          new URLSearchParams(qs || '').forEach((v, k) => { if (v) params[k] = v; });
          // replace an identical earlier capture instead of stacking duplicates
          const dupe = buffer.findIndex(c => c.method === method && c.path === path);
          if (dupe >= 0) buffer.splice(dupe, 1);
          buffer.unshift({ method, path, params, route: currentRoute(), at: Date.now() });
          if (buffer.length > MAX_CALLS) buffer.length = MAX_CALLS;
        }
      }
    } catch { /* capture must never break the app's own calls */ }
    return res;
  };
}

export const getCapturedCalls = (): CapturedCall[] => buffer.slice();
