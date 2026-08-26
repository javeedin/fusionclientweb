// ── Console silencer ─────────────────────────────────────────────────────────
// The app's scattered console.log/info/debug lines expose env config, ORDS
// URLs, and request/response payloads to anyone who opens DevTools. This
// module no-ops those methods UNLESS VITE_DEBUG=true in .env.local.
// console.warn / console.error stay live so real failures remain visible.
//
// IMPORTANT: this file must be the FIRST import in main.tsx — imports execute
// in order, and module-level logs in other files fire when they load.
const DEBUG = String(import.meta.env.VITE_DEBUG || '').toLowerCase() === 'true';

if (!DEBUG) {
  const noop = () => { /* silenced — set VITE_DEBUG=true in .env.local to restore */ };
  // Keep originals reachable for emergencies: window.__console.log(...)
  (window as any).__console = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    debug: console.debug.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };
  console.log = noop;
  console.info = noop;
  console.debug = noop;

  // warn/error stay live for real failures, but drop framework deprecation
  // noise: React/antd emit dev-only lines starting with "Warning:".
  const isFrameworkWarning = (args: unknown[]) =>
    typeof args[0] === 'string' && (args[0] as string).startsWith('Warning:');
  const rawWarn = console.warn.bind(console);
  const rawError = console.error.bind(console);
  console.warn = (...args: unknown[]) => { if (!isFrameworkWarning(args)) rawWarn(...args); };
  console.error = (...args: unknown[]) => { if (!isFrameworkWarning(args)) rawError(...args); };
}

export {};
