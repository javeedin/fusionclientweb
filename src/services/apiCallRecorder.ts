// Records the HTTP calls an action makes — method, full URL, JSON body sent, status and JSON returned —
// so a screen can show exactly what went to the server (API icon). Only GL / SLA / gateway calls are kept.

export interface ApiCall {
  step: string;
  method: string;
  url: string;
  body?: unknown;
  status?: number;          // absent = planned, not sent yet
  response?: unknown;
  ms?: number;
}

const RELEVANT = /\/(journals\/create|gl\/journals\/|sla\/accounting|ai\/executequery|gl\/revaluation)/;

/** Readable name for a call, from its method and URL. */
export function apiStepName(method: string, url: string, body?: unknown): string {
  const path = url.replace(/^https?:\/\/[^/]+/, '');
  if (/\/journals\/create/.test(path)) {
    const h = (body as any)?.header;
    const n = Array.isArray((body as any)?.lines) ? (body as any).lines.length : null;
    return `Create GL journal${h?.currencyCode ? ` — ${h.currencyCode}` : ''}${n != null ? `, ${n} lines` : ''}`;
  }
  if (/\/gl\/journals\/[^/]+\/post/.test(path)) return 'Post GL batch';
  if (method === 'DELETE' && /\/gl\/journals\/batches\//.test(path)) return 'Delete GL batch';
  if (/\/sla\/accounting\/post/.test(path)) return 'Stamp SLA header with the GL batch';
  if (/\/sla\/accounting\/exists/.test(path)) return 'Check SLA accounting';
  if (/\/sla\/accounting\/create/.test(path)) return 'Create SLA accounting';
  if (/\/gl\/revaluation\/[^/]+\/accounting/.test(path)) return 'Mark revaluation ACCOUNTED';
  if (/\/gl\/revaluation/.test(path)) return 'Load revaluation';
  if (/\/ai\/executequery/.test(path)) return 'Read the GL (query)';
  return `${method} ${path}`;
}

/** Runs `fn` while recording the relevant fetch calls it makes. */
export async function recordApiCalls<T>(fn: () => Promise<T>, onCall: (c: ApiCall) => void): Promise<T> {
  const prev = window.fetch;
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const t0 = performance.now();
    const res = await prev(input, init);
    if (RELEVANT.test(url)) {
      let body: unknown = init?.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch { /* keep text */ } }
      let response: unknown = null;
      try {
        const t = await res.clone().text();
        try { response = JSON.parse(t); } catch { response = t.slice(0, 4000); }
      } catch { /* body not readable */ }
      onCall({ step: apiStepName(method, url, body), method, url, body, status: res.status, response, ms: Math.round(performance.now() - t0) });
    }
    return res;
  }) as typeof window.fetch;
  try { return await fn(); } finally { window.fetch = prev; }
}
