// ─────────────────────────────────────────────────────────────────────────────
// Fusion instance / POD selector
// Shared source of truth for the Oracle Fusion POD used by all Purchase
// (Fusion Client) modules. The instance is chosen from the dropdown on the
// Fusion Client landing page; the choice is persisted in localStorage and the
// app reloads so every module's web-service base URL re-resolves to the new POD.
// ─────────────────────────────────────────────────────────────────────────────

export interface FusionInstance {
  key: string;
  label: string;
  host: string;       // POD host, e.g. https://iacney-test.fa.ocs.oraclecloud.com
  username: string;
  password: string;
}

// Add / edit instances here. `host` has NO trailing slash and NO /fscmRestApi path.
export const FUSION_INSTANCES: FusionInstance[] = [
  { key: 'TEST',  label: 'TEST',  host: 'https://iacney-test.fa.ocs.oraclecloud.com', username: 'emparun', password: 'Fusion@1234' },
  { key: 'TEST1', label: 'TEST1', host: 'https://efmh-test.fa.em3.oraclecloud.com',   username: 'shaik',   password: 'fusion1234' },
  { key: 'PROD',  label: 'PROD',  host: 'https://efmh.fa.em3.oraclecloud.com',        username: 'shaik',   password: 'fusion1234' },
];

const STORAGE_KEY = 'fusionInstanceKey';

export const getFusionInstanceKey = (): string => {
  try { return localStorage.getItem(STORAGE_KEY) || FUSION_INSTANCES[0].key; }
  catch { return FUSION_INSTANCES[0].key; }
};

export const getFusionInstance = (): FusionInstance =>
  FUSION_INSTANCES.find(i => i.key === getFusionInstanceKey()) || FUSION_INSTANCES[0];

// Persist the selection. Callers should reload the app afterwards so the
// module-level constants below re-resolve to the new POD across every group.
export const setFusionInstanceKey = (key: string): void => {
  try { localStorage.setItem(STORAGE_KEY, key); } catch { /* ignore */ }
};

// ── Resolved once at module load — every Purchase page reads these at import ──
const _instance = getFusionInstance();

export const FUSION_POD_HOST   = _instance.host;
export const FUSION_POD_BASE   = `${FUSION_POD_HOST}/fscmRestApi/resources/11.13.18.05`;
export const FUSION_POD_LATEST = `${FUSION_POD_HOST}/fscmRestApi/resources/latest`;
export const FUSION_POD_COA    = `${FUSION_POD_HOST}/fscmRestApi/resources/11.13.18.05/valueSets`;
export const FUSION_POD_AUTH   = 'Basic ' + btoa(`${_instance.username}:${_instance.password}`);
