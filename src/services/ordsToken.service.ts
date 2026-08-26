// ── ORDS OAuth2 token service ────────────────────────────────────────────────
// client_credentials flow against ORDS's built-in token endpoint:
//   POST <origin>/ords/<schema>/oauth/token   (Basic client_id:client_secret)
// Tokens (~3600s) are cached and refreshed 60s before expiry; concurrent
// callers share one in-flight request.
//
// Controlled entirely from .env.local (baked at build time):
//   REACT_APP_ORDS_USE_TOKEN=YES|NO   ← master switch (NO = all of this is inert)
//   REACT_APP_ORDS_CLIENT_ID / REACT_APP_ORDS_CLIENT_SECRET
import { getApexBaseUrl } from '../config/company.config';

const USE_TOKEN = String(import.meta.env.REACT_APP_ORDS_USE_TOKEN || 'NO').toUpperCase() === 'YES';
const CLIENT_ID = (import.meta.env.REACT_APP_ORDS_CLIENT_ID as string) || '';
const CLIENT_SECRET = (import.meta.env.REACT_APP_ORDS_CLIENT_SECRET as string) || '';

// From e.g. https://host/ords/bcldifc/reerp →
//   schemaRoot = https://host/ords/bcldifc   (everything under it gets the token)
//   tokenUrl   = https://host/ords/bcldifc/oauth/token
export const getOrdsSchemaRoot = (): string => {
  const base = getApexBaseUrl() || '';
  const m = base.match(/^(https?:\/\/[^/]+\/ords\/[^/]+)/i);
  return m ? m[1] : '';
};
export const getOrdsTokenUrl = (): string => {
  const root = getOrdsSchemaRoot();
  return root ? `${root}/oauth/token` : '';
};

export const ordsTokenEnabled = (): boolean => USE_TOKEN && !!CLIENT_ID && !!CLIENT_SECRET;

let cached: { token: string; expiresAt: number } | null = null;
let inflight: Promise<string> | null = null;

export const clearOrdsToken = (): void => { cached = null; };

export async function getOrdsToken(): Promise<string> {
  if (!ordsTokenEnabled()) throw new Error('ORDS token security is not enabled (REACT_APP_ORDS_USE_TOKEN / client credentials)');
  if (cached && Date.now() < cached.expiresAt) return cached.token;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch(getOrdsTokenUrl(), {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + btoa(`${CLIENT_ID}:${CLIENT_SECRET}`),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
      });
      if (!res.ok) throw new Error(`ORDS token request failed: HTTP ${res.status}`);
      const data = await res.json();
      if (!data.access_token) throw new Error('ORDS token response missing access_token');
      cached = {
        token: data.access_token,
        expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 - 60_000,
      };
      return cached.token;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
