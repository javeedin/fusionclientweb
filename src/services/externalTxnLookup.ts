// One cash external transaction, read straight from RR_EXTERNAL_CASH_TRANSACTIONS through the read gateway
// (POST ai/executequery), by its EXTERNAL_TRANSACTION_ID or by its transaction number (TRANSACTION_ID).
// The GET cash/externaltransactions search is the fallback — and only a row with the asked id is ever returned.
import { APEX_DB_CONFIG } from '../config/api.config';
import { poQuery, nlit } from './po.service';

/** EXTERNAL_TRANSACTION_ID → externalTransactionId (the keys the cash screens read). */
const camel = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).map(([k, v]) =>
  [k.toLowerCase().replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase()), v]));

export async function loadExternalTransaction(by: { extId?: number | null; txnId?: number | null }): Promise<Record<string, any> | null> {
  const extId = Number(by.extId) || null;
  const txnId = extId ? null : Number(by.txnId) || null;
  if (!extId && !txnId) return null;
  try {
    const rows = await poQuery(`SELECT * FROM RR_EXTERNAL_CASH_TRANSACTIONS
      WHERE ${extId ? `EXTERNAL_TRANSACTION_ID = ${nlit(extId)}` : `TRANSACTION_ID = ${nlit(txnId)}`}
      ORDER BY EXTERNAL_TRANSACTION_ID DESC`, 1, 'CASH');
    if (rows[0]) return camel(rows[0]);
  } catch { /* gateway not available / table not allowed → the REST search */ }
  const base = APEX_DB_CONFIG.baseUrl;
  const url = extId
    ? `${base}/cash/externaltransactions?external_transaction_id=${extId}`
    : `${base}/cash/externaltransactions?transaction_number=${txnId}`;
  try {
    const d = await (await fetch(url, { headers: { Accept: 'application/json' } })).json();
    return (d?.items || []).find((t: any) => (extId ? Number(t.externalTransactionId) === extId : Number(t.transactionId) === txnId)) ?? null;
  } catch {
    return null;
  }
}
