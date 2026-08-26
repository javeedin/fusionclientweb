// ── Shared ORDS OAuth2 token helper (Electron main + MCP servers) ────────────
// client_credentials against ORDS's built-in token endpoint, cached and
// refreshed 60s before the ~3600s expiry. Controlled by env (machine config /
// claude_desktop_config.json env block):
//   ORDS_USE_TOKEN=YES|NO   (default NO → getOrdsAuthHeader() returns {})
//   ORDS_CLIENT_ID / ORDS_CLIENT_SECRET
//   ORACLE_BASE_URL (host, already used by the MCP servers), ORDS_SCHEMA (default bcldifc)
// While the switch is NO this module is inert, so requiring it changes nothing.

function extractDomain(urlStr) {
  const match = String(urlStr || '').match(/^https?:\/\/[^/]+/);
  return match ? match[0] : '';
}

const DOMAIN = extractDomain(process.env.ORACLE_BASE_URL || 'https://g15d6279501ae08-buimerc.adb.me-dubai-1.oraclecloudapps.com');
const SCHEMA = process.env.ORDS_SCHEMA || 'bcldifc';
const TOKEN_URL = `${DOMAIN}/ords/${SCHEMA}/oauth/token`;
const CLIENT_ID = process.env.ORDS_CLIENT_ID || '';
const CLIENT_SECRET = process.env.ORDS_CLIENT_SECRET || '';
const USE_TOKEN = String(process.env.ORDS_USE_TOKEN || 'NO').toUpperCase() === 'YES';

let cached = null;   // { token, expiresAt }
let inflight = null;

function ordsTokenEnabled() {
  return USE_TOKEN && !!CLIENT_ID && !!CLIENT_SECRET;
}

async function getOrdsToken() {
  if (cached && Date.now() < cached.expiresAt) return cached.token;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
      });
      if (!res.ok) throw new Error(`ORDS token request failed: HTTP ${res.status}`);
      const data = await res.json();
      if (!data.access_token) throw new Error('ORDS token response missing access_token');
      cached = {
        token: data.access_token,
        expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 - 60000,
      };
      return cached.token;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

// Header fragment to spread into fetch headers. {} when the switch is off or
// the token can't be obtained (the call then proceeds exactly as today).
async function getOrdsAuthHeader() {
  if (!ordsTokenEnabled()) return {};
  try {
    return { Authorization: `Bearer ${await getOrdsToken()}` };
  } catch (e) {
    console.error('[ords-token] token fetch failed:', e.message);
    return {};
  }
}

// True when this URL belongs to the protected ORDS schema (vs. Fusion, Anthropic…)
function isOrdsUrl(url) {
  return String(url || '').startsWith(`${DOMAIN}/ords/${SCHEMA}/`);
}

function clearOrdsToken() { cached = null; }

module.exports = { getOrdsAuthHeader, ordsTokenEnabled, isOrdsUrl, clearOrdsToken, ORDS_TOKEN_URL: TOKEN_URL };
