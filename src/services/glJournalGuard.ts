// ── GL journal guard ─────────────────────────────────────────────────────────
// Installed once at app startup (main.tsx). RR_INSERT_GL_JOURNALS_POST
// (POST …/journals/create) rejects unbalanced journals and other validation
// failures by answering HTTP 200 with {"status":"ERROR", ...}. Many screens
// only check response.ok, so they would treat a rejected journal as created
// (and e.g. stamp the SLA header as posted). This interceptor turns such a
// reply into HTTP 422 with the same JSON body, so every caller sees a failure,
// and shows the rejection message on screen so it can never fail silently.
import { message } from 'antd';

const urlOf = (input: RequestInfo | URL): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

const isJournalCreate = (url: string, init?: RequestInit, input?: RequestInfo | URL): boolean => {
  const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
  return method === 'POST' && /\/journals\/create(\?|$)/.test(url);
};

export function installGlJournalGuard(): void {
  const w = window as any;
  if (w.__glJournalGuard) return;                  // idempotent (HMR / double import)
  w.__glJournalGuard = true;

  const prevFetch = window.fetch.bind(window);

  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const res = await prevFetch(input, init);
    if (!res.ok || !isJournalCreate(urlOf(input), init, input)) return res;

    let body = '';
    try { body = await res.clone().text(); } catch { return res; }
    let data: any = null;
    try { data = JSON.parse(body); } catch { return res; }
    if (!data || String(data.status).toUpperCase() !== 'ERROR') return res;

    const text = data.message || data.error || 'GL journal rejected';
    message.error({
      content: data.validationError === 'UNBALANCED_JOURNAL' ? `Unbalanced journal not posted — ${text}` : `GL journal not created — ${text}`,
      duration: 12,
      key: `gl-guard-${data.validationError || 'error'}`,
    });
    const headers = new Headers(res.headers);
    headers.set('X-GL-Validation', String(data.validationError || 'ERROR'));
    return new Response(body, { status: 422, statusText: 'GL journal rejected', headers });
  }) as typeof window.fetch;
}
