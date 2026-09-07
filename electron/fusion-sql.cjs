// ── Fusion SQL (CloudMiner-style live query over Oracle Fusion SaaS) ─────────
// Runs SELECT statements against a Fusion pod through BI Publisher's SOAP
// service ExternalReportWSSService.runReport, targeting a "query runner" BIP
// report whose data model executes an arbitrary base64-encoded statement
// (OPEN cursor FOR <sql>). No JDBC — the pod exposes no direct DB access.
//
// Deploy the runner report once (see fusion/bip/README.md) and set its
// absolute catalog path in config. The schema browser bootstraps itself by
// running data-dictionary queries through the same runner, so only one BIP
// object is needed. SELECT-only by BIP's nature; runs as the configured
// Fusion user and is audited as that user.

const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

function log(...a) { console.log('[Fusion SQL]', ...a); }

const cfgFile = () => path.join(app.getPath('userData'), 'fusion-sql-config.json');
const credsFile = () => path.join(app.getPath('userData'), 'fusion-creds.json');

// ── config (pod url + report path + row cap) ────────────────────────────────
function getConfig() {
  try { return { reportPath: '/Custom/ReERP/QueryRunner.xdo', rowLimit: 100, ...JSON.parse(fs.readFileSync(cfgFile(), 'utf8')) }; }
  catch { return { baseUrl: '', reportPath: '/Custom/ReERP/QueryRunner.xdo', rowLimit: 100 }; }
}
function setConfig(patch) {
  const next = { ...getConfig(), ...(patch || {}) };
  fs.writeFileSync(cfgFile(), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

// Fusion credentials — reuse the app's stored, safeStorage-encrypted creds
function readFusionCreds() {
  try {
    const data = JSON.parse(fs.readFileSync(credsFile(), 'utf8'));
    let password;
    if (data.encrypted && safeStorage.isEncryptionAvailable()) {
      password = safeStorage.decryptString(Buffer.from(data.password, 'base64'));
    } else {
      password = Buffer.from(data.password, 'base64').toString();
    }
    return { username: data.username, password };
  } catch { return null; }
}

const xmlEscape = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const origin = (u) => { try { return new URL(u).origin; } catch { return String(u || '').replace(/\/+$/, ''); } };

// ── SOAP runReport ──────────────────────────────────────────────────────────
function buildEnvelope({ reportPath, base64Sql, user, pass, format }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:pub="http://xmlns.oracle.com/oxp/service/PublicReportService">
  <soapenv:Header/>
  <soapenv:Body>
    <pub:runReport>
      <pub:reportRequest>
        <pub:attributeFormat>${format}</pub:attributeFormat>
        <pub:attributeLocale>en-US</pub:attributeLocale>
        <pub:flattenXML>true</pub:flattenXML>
        <pub:reportAbsolutePath>${xmlEscape(reportPath)}</pub:reportAbsolutePath>
        <pub:sizeOfDataChunkDownload>-1</pub:sizeOfDataChunkDownload>
        <pub:parameterNameValues>
          <pub:listOfParamNameValues>
            <pub:item>
              <pub:name>P_QRY_STMT</pub:name>
              <pub:values><pub:item>${base64Sql}</pub:item></pub:values>
            </pub:item>
          </pub:listOfParamNameValues>
        </pub:parameterNameValues>
      </pub:reportRequest>
      <pub:userID>${xmlEscape(user)}</pub:userID>
      <pub:password>${xmlEscape(pass)}</pub:password>
    </pub:runReport>
  </soapenv:Body>
</soapenv:Envelope>`;
}

// extract <reportBytes> (base64) from a runReport SOAP response
function extractReportBytes(soap) {
  const m = soap.match(/<(?:\w+:)?reportBytes>([\s\S]*?)<\/(?:\w+:)?reportBytes>/i);
  return m ? m[1].replace(/\s+/g, '') : null;
}
function extractFault(soap) {
  const m = soap.match(/<(?:\w+:)?faultstring>([\s\S]*?)<\/(?:\w+:)?faultstring>/i)
    || soap.match(/<(?:\w+:)?message>([\s\S]*?)<\/(?:\w+:)?message>/i);
  return m ? m[1].trim() : null;
}

// ── output parsers ──────────────────────────────────────────────────────────
// CSV (RFC-4180: quoted fields, embedded commas / quotes / newlines)
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', i = 0, inQ = false;
  const t = text.replace(/^﻿/, '');
  while (i < t.length) {
    const c = t[i];
    if (inQ) {
      if (c === '"') { if (t[i + 1] === '"') { field += '"'; i += 2; continue; } inQ = false; i++; continue; }
      field += c; i++; continue;
    }
    if (c === '"') { inQ = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const header = rows[0].map(h => h.trim());
  return rows.slice(1).filter(r => r.length && !(r.length === 1 && r[0] === '')).map(r => {
    const o = {};
    header.forEach((h, ci) => { o[h] = coerce(r[ci]); });
    return o;
  });
}

// XML data rowset (BIP raw data): find the repeating group element under root
function parseXmlRows(xml) {
  const body = xml.replace(/<\?xml[\s\S]*?\?>/, '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_m, c) => xmlEscape(c));
  // count element tags to find the repeating row wrapper
  const counts = {};
  const tagRe = /<([A-Za-z_][\w.-]*)\b[^>]*>/g;
  let m;
  while ((m = tagRe.exec(body))) counts[m[1]] = (counts[m[1]] || 0) + 1;
  // the row wrapper is the most frequent non-leaf tag (appears >1 and contains child tags)
  let wrapper = null, best = 1;
  for (const [tag, n] of Object.entries(counts)) {
    if (n <= best) continue;
    const one = body.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
    if (one && /<[A-Za-z_]/.test(one[1])) { wrapper = tag; best = n; }
  }
  if (!wrapper) return [];
  const rows = [];
  const rowRe = new RegExp(`<${wrapper}\\b[^>]*>([\\s\\S]*?)</${wrapper}>`, 'gi');
  let r;
  while ((r = rowRe.exec(body))) {
    const o = {};
    const cellRe = /<([A-Za-z_][\w.-]*)\b[^>]*>([\s\S]*?)<\/\1>/g;
    let c;
    while ((c = cellRe.exec(r[1]))) {
      if (/<[A-Za-z_]/.test(c[2])) continue; // nested group, skip
      o[c[1]] = coerce(c[2].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim());
    }
    if (Object.keys(o).length) rows.push(o);
  }
  return rows;
}

const coerce = (v) => {
  if (v == null || v === '') return '';
  const s = String(v);
  if (/^-?\d{1,15}(\.\d+)?$/.test(s.replace(/,/g, ''))) {
    const n = Number(s.replace(/,/g, ''));
    if (Number.isFinite(n) && String(n).length <= 15) return n;
  }
  return s;
};

// ── execute ─────────────────────────────────────────────────────────────────
// runs one statement; returns { success, rows, columns, rowCount, raw?, error? }
async function execute({ sql, rowLimit } = {}) {
  const stmt = String(sql || '').trim().replace(/;+\s*$/, '');
  if (!stmt) return { success: false, error: 'Empty statement' };
  if (!/^\s*(select|with)\b/i.test(stmt)) {
    return { success: false, error: 'Only SELECT / WITH statements are allowed (read-only)' };
  }
  const cfg = getConfig();
  const creds = readFusionCreds();
  if (!creds || !creds.username) return { success: false, error: 'No Fusion credentials saved — set them in the app first' };
  const base = origin(cfg.baseUrl || '');
  if (!/^https?:\/\//.test(base)) return { success: false, error: 'No Fusion pod URL configured' };

  // wrap with a row cap so the pod never streams unbounded results
  const cap = Math.max(1, Math.min(100000, Number(rowLimit || cfg.rowLimit) || 100));
  const capped = `SELECT * FROM (${stmt}) WHERE ROWNUM <= ${cap}`;
  const base64Sql = Buffer.from(capped, 'utf8').toString('base64');
  const url = `${base}/xmlpserver/services/ExternalReportWSSService`;

  const attempt = async (format) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '' },
      body: buildEnvelope({ reportPath: cfg.reportPath, base64Sql, user: creds.username, pass: creds.password, format }),
    });
    const text = await res.text();
    return { status: res.status, ok: res.ok, text };
  };

  try {
    // CSV first (deterministic parse), XML as fallback
    let r = await attempt('csv');
    let bytes = extractReportBytes(r.text);
    let rows = [];
    if (bytes) rows = parseCsv(Buffer.from(bytes, 'base64').toString('utf8'));
    if (!rows.length) {
      const r2 = await attempt('xml');
      const b2 = extractReportBytes(r2.text);
      if (b2) rows = parseXmlRows(Buffer.from(b2, 'base64').toString('utf8'));
      if (!bytes) { r = r2; bytes = b2; }
    }
    if (!bytes) {
      const fault = extractFault(r.text) || `HTTP ${r.status}`;
      return { success: false, error: fault, raw: r.text.slice(0, 1200) };
    }
    const columns = rows.length ? Object.keys(rows[0]) : [];
    return { success: true, rows, columns, rowCount: rows.length, capped: rows.length >= cap };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

module.exports = { getConfig, setConfig, execute };
