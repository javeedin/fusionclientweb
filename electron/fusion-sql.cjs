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
  const d = {
    baseUrl: '', reportPath: '/Custom/ReERP/QueryRunner.xdo',
    dataModelPath: '/Custom/ReERP/QueryRunnerDM.xdm', folderPath: '/Custom/ReERP',
    dataSource: 'ApplicationDB_FSCM', rowLimit: 100,
    // report-service SOAP endpoint (relative to the pod origin) — overridable
    reportServicePath: '/xmlpserver/services/v2/ReportService',
    catalogServicePath: '/xmlpserver/services/v2/CatalogService',
  };
  try { return { ...d, ...JSON.parse(fs.readFileSync(cfgFile(), 'utf8')) }; }
  catch { return d; }
}
function setConfig(patch) {
  const next = { ...getConfig(), ...(patch || {}) };
  fs.writeFileSync(cfgFile(), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

// ── schema cache (persisted to a real file, not browser storage) ────────────
// The renderer caches the object lists / column lists here so the schema
// browser never re-queries the pod unless the user refreshes. One JSON file
// per pod, keyed inside by object-type / table name.
const cacheDir = () => {
  const d = path.join(app.getPath('userData'), 'fusion-sql-cache');
  try { fs.mkdirSync(d, { recursive: true }); } catch { /* exists */ }
  return d;
};
const safeName = (s) => String(s || 'pod').replace(/[^\w.-]/g, '_').slice(0, 120);
const cacheFile = (pod) => path.join(cacheDir(), `schema-${safeName(pod)}.json`);

function cacheGet({ pod, key } = {}) {
  try {
    const all = JSON.parse(fs.readFileSync(cacheFile(pod), 'utf8'));
    return { success: true, value: key ? (all[key] ?? null) : all };
  } catch { return { success: true, value: key ? null : {} }; }
}
function cacheSet({ pod, key, value } = {}) {
  try {
    const file = cacheFile(pod);
    let all = {};
    try { all = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* new file */ }
    all[key] = value;
    fs.writeFileSync(file, JSON.stringify(all), 'utf8');
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
}
function cacheClear({ pod } = {}) {
  try { fs.unlinkSync(cacheFile(pod)); } catch { /* already gone */ }
  return { success: true };
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

// ── API call log (for the in-app inspector) ─────────────────────────────────
// last N SOAP calls with their payloads; the password is redacted so nothing
// sensitive is ever shown or kept.
const CALL_LOG = [];
const redact = (s) => String(s || '').replace(/(<[^>]*password>)[\s\S]*?(<\/[^>]*password>)/gi, '$1***$2');
function recordCall(entry) {
  CALL_LOG.unshift({
    at: Date.now(),
    ...entry,
    headers: entry.headers || {},
    request: redact(entry.request).slice(0, 20000),
    response: String(entry.response || '').slice(0, 20000),
  });
  if (CALL_LOG.length > 30) CALL_LOG.length = 30;
}
function getCalls() { return CALL_LOG; }
function clearCalls() { CALL_LOG.length = 0; }

// ── SOAP runReport ──────────────────────────────────────────────────────────
// Mirrors the app's proven customerSearchBip service: v2 ReportService,
// v2 namespace, SOAP 1.1 text/xml, credentials in the body (no Basic auth).
function buildEnvelope({ reportPath, base64Sql, user, pass, format }) {
  return `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:v2="http://xmlns.oracle.com/oxp/service/v2">
  <soapenv:Header/>
  <soapenv:Body>
    <v2:runReport>
      <v2:reportRequest>
        <v2:attributeFormat>${format}</v2:attributeFormat>
        <v2:reportAbsolutePath>${xmlEscape(reportPath)}</v2:reportAbsolutePath>
        <v2:sizeOfDataChunkDownload>-1</v2:sizeOfDataChunkDownload>
        <v2:parameterNameValues>
          <v2:listOfParamNameValues>
            <v2:item>
              <v2:name>P_QRY_STMT</v2:name>
              <v2:values><v2:item>${base64Sql}</v2:item></v2:values>
            </v2:item>
          </v2:listOfParamNameValues>
        </v2:parameterNameValues>
        <v2:reportData/>
        <v2:reportOutputPath/>
      </v2:reportRequest>
      <v2:userID>${xmlEscape(user)}</v2:userID>
      <v2:password>${xmlEscape(pass)}</v2:password>
    </v2:runReport>
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

// unescape one level of XML entities (&amp; last to avoid double-decoding)
const xmlUnescape = (s) => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(Number(d)))
  .replace(/&amp;/g, '&');

// DBMS_XMLGEN runner output: the query result is returned as an inner
// <ROWSET><ROW>...</ROW></ROWSET> document embedded (XML-escaped) inside the
// report. Pull every <ROW> regardless of how many there are (parseXmlRows
// can't — it needs a wrapper that repeats >1). Column tags are DBMS_XMLGEN's
// uppercased column names; NULL columns are simply omitted from a row.
function parseRowset(xml) {
  const rows = [];
  const rowRe = /<ROW\b[^>]*>([\s\S]*?)<\/ROW>/gi;
  let r;
  while ((r = rowRe.exec(xml))) {
    const o = {};
    const cellRe = /<([A-Za-z_][\w.-]*)\b[^>]*>([\s\S]*?)<\/\1>/g;
    let c;
    while ((c = cellRe.exec(r[1]))) {
      if (/<[A-Za-z_]/.test(c[2])) continue; // nested element, not a scalar cell
      o[c[1]] = coerce(xmlUnescape(c[2]).trim());
    }
    rows.push(o);
  }
  return rows;
}

// Detect + parse the DBMS_XMLGEN wrapper in a decoded report body. The inner
// ROWSET reaches us either with real tags (CSV output — BIP puts the CLOB in a
// field verbatim) or fully XML-escaped (XML output — BIP escapes the RESULT
// element's text). Only in the escaped case do we unescape the blob one level;
// parseRowset then unescapes cell data the remaining level. Returns null if
// this isn't the DBMS_XMLGEN shape.
function parseXmlGenRows(decoded) {
  if (!/ROWSET/i.test(decoded)) return null;
  const body = (/&lt;ROWSET/i.test(decoded) && !/<ROWSET\b/i.test(decoded))
    ? xmlUnescape(decoded)   // XML output: whole inner doc was escaped
    : decoded;               // CSV output: tags are already real
  if (!/<ROWSET\b/i.test(body) && !/<ROW\b/i.test(body)) return null;
  const rows = parseRowset(body);
  // a valid-but-empty result set (<ROWSET/> or <ROWSET></ROWSET>) is success
  const emptyRowset = /<ROWSET\b[^>]*\/>|<ROWSET\b[^>]*>\s*<\/ROWSET>/i.test(body);
  return (rows.length || emptyRowset) ? rows : null;
}

// union of every row's keys, in first-seen order (columns a NULL hid in row 0)
const unionColumns = (rows) => {
  const seen = [];
  for (const row of rows) for (const k of Object.keys(row)) if (!seen.includes(k)) seen.push(k);
  return seen;
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
  const url = `${base}${cfg.reportServicePath || '/xmlpserver/services/v2/ReportService'}`;

  // per-call timeout so a slow/hung pod fails cleanly instead of spinning
  const timeoutMs = Math.max(5000, Math.min(600000, Number(cfg.timeoutMs) || 120000));

  // v2 ReportService: SOAP 1.1 text/xml, credentials in the body — mirrors
  // the app's proven customerSearchBip service (no HTTP Basic auth needed)
  const attempt = async (format) => {
    const body = buildEnvelope({ reportPath: cfg.reportPath, base64Sql, user: creds.username, pass: creds.password, format });
    const headers = { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '"runReport"' };
    const started = Date.now();
    try {
      const res = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(timeoutMs) });
      const text = await res.text();
      recordCall({ kind: `runReport (${format})`, protocol: 'SOAP', url, status: res.status, headers, request: body, response: text });
      return { status: res.status, ok: res.ok, text };
    } catch (e) {
      const timedOut = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
      const msg = timedOut
        ? `runReport timed out after ${Math.round((Date.now() - started) / 1000)}s (limit ${Math.round(timeoutMs / 1000)}s)`
        : `runReport request failed: ${e && e.message ? e.message : e}`;
      recordCall({ kind: `runReport (${format})`, protocol: 'SOAP', url, status: timedOut ? 'timeout' : 'error', headers, request: body, response: msg });
      return { status: 0, ok: false, text: '', error: msg };
    }
  };

  try {
    // XML first — the DBMS_XMLGEN runner is XML-native, and CSV output is often
    // not enabled on the report (a CSV attempt can stall). CSV is the fallback.
    let r = await attempt('xml');
    let bytes = extractReportBytes(r.text);
    let rows = [];
    if (bytes) {
      const decoded = Buffer.from(bytes, 'base64').toString('utf8');
      rows = parseXmlGenRows(decoded) ?? parseXmlRows(decoded);
    }
    if (!rows.length && !r.error) {
      const r2 = await attempt('csv');
      const b2 = extractReportBytes(r2.text);
      if (b2) {
        const decoded2 = Buffer.from(b2, 'base64').toString('utf8');
        rows = parseXmlGenRows(decoded2) ?? parseCsv(decoded2);
      }
      if (!bytes) { r = r2; bytes = b2; }
    }
    if (!bytes) {
      const fault = r.error || extractFault(r.text) || `HTTP ${r.status}`;
      return { success: false, error: fault, raw: (r.text || '').slice(0, 1200) };
    }
    const columns = unionColumns(rows);
    return { success: true, rows, columns, rowCount: rows.length, capped: rows.length >= cap };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ── auto-deploy the runner report (CloudMiner-style) ────────────────────────
// Creates the folder + data model + report in the BI catalog via
// CatalogService.createFolder / uploadObject, so no manual BIP setup is
// needed. The account must hold BI Author/Administrator rights. Building
// catalog objects is version-sensitive; on failure the SOAP fault is
// surfaced and the manual path (fusion/bip/README.md) still works.

// minimal CRC32 (for the ZIP central directory)
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
// build a store-mode (no compression) ZIP — BIP accepts these
function buildZip(files) {
  const locals = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const data = Buffer.from(f.data, 'utf8');
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(0, 8); lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    locals.push(lh, name, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0, 8); ch.writeUInt16LE(0, 10); ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0, 14);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += lh.length + name.length + data.length;
  }
  const localBuf = Buffer.concat(locals);
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12); end.writeUInt32LE(localBuf.length, 16);
  return Buffer.concat([localBuf, centralBuf, end]);
}

// the query-runner SQL (kept in sync with fusion/bip/query_runner_datamodel.sql)
// DBMS_XMLGEN.getXML turns the decoded SELECT into an XML result in one Standard
// SQL column — Fusion SaaS BIP does not register the :xdo_cursor ref-cursor
// output bind, so a PL/SQL ref cursor is not usable here.
const RUNNER_SQL = `SELECT REGEXP_REPLACE(
         DBMS_XMLGEN.getxml(
           UTL_RAW.cast_to_varchar2(
             UTL_ENCODE.base64_decode(UTL_RAW.cast_to_raw(:P_QRY_STMT))
           )
         ),
         '<\\?xml[^>]*\\?>', ''
       ) AS result
FROM dual`;

function buildDataModelXml(dataSource) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<dataModel xmlns="http://xmlns.oracle.com/oxp/xmlp" version="2.0"
           xmlns:xdm="http://xmlns.oracle.com/oxp/xmlp" xmlns:xsd="http://www.w3.org/2001/XMLSchema"
           defaultDataSourceRef="${xmlEscape(dataSource)}">
   <description><![CDATA[Re-ERP Fusion SQL query runner]]></description>
   <dataProperties>
      <property name="include_parameters" value="true"/>
      <property name="include_null_Element" value="false"/>
      <property name="include_rowsettag" value="false"/>
      <property name="xml_tag_case" value="upper"/>
      <property name="db_fetch_size" value="500"/>
   </dataProperties>
   <parameters>
      <parameter name="P_QRY_STMT" defaultValue="" dataType="xsd:string" rowPlacement="1">
         <input label="P_QRY_STMT"/>
      </parameter>
   </parameters>
   <dataSets>
      <dataSet name="Q1" type="simple">
         <sql dataSourceRef="${xmlEscape(dataSource)}" nsQuery="false" xmlRowTagName="G_1"><![CDATA[${RUNNER_SQL}]]></sql>
      </dataSet>
   </dataSets>
   <output rootName="DATA_DS" uniqueRowName="false"><nodeList/></output>
   <eventTriggers/>
   <lexicals/>
   <valueSets/>
</dataModel>`;
}

function buildReportXml(dataModelPath) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<report xmlns="http://xmlns.oracle.com/oxp/xmlp" version="2.0"
        defaultDataModel="${xmlEscape(dataModelPath)}"
        controllableFlag="true" viewOnlineFlag="true" onLineFlag="true"
        openLinkInNewWindowFlag="true" showControls="true" autoRunFlag="false"
        defaultOutputFormat="csv">
   <templates defaultTemplate="Data">
      <template templateType="xsl-fo" default="true" active="true" viewOnlineFlag="true"
                label="Data" location="." locale="en_US" outputName="Data">
         <outputFormats>
            <outputFormat>csv</outputFormat>
            <outputFormat>xml</outputFormat>
         </outputFormats>
      </template>
   </templates>
</report>`;
}

// ── SOAP: CatalogService (folder + upload) ──────────────────────────────────
function catalogUrl(base) { return `${origin(base)}/xmlpserver/services/v2/CatalogService`; }

async function soapCatalog(base, action, innerXml, auth) {
  // v2 CatalogService uses the plain service/v2 namespace (the fault told us:
  // "Expected {http://xmlns.oracle.com/oxp/service/v2}uploadObject")
  const env = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:pub="http://xmlns.oracle.com/oxp/service/v2">
  <soapenv:Header/>
  <soapenv:Body>${innerXml}</soapenv:Body>
</soapenv:Envelope>`;
  const url = catalogUrl(base);
  const headers = { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: action, ...(auth ? { Authorization: auth } : {}) };
  const res = await fetch(url, { method: 'POST', headers, body: env });
  const text = await res.text();
  recordCall({
    kind: action, protocol: 'SOAP', url, status: res.status,
    headers: { ...headers, ...(auth ? { Authorization: 'Basic <base64 user:password>' } : {}) }, request: env, response: text,
  });
  return { ok: res.ok, status: res.status, text };
}

async function deployRunner() {
  const cfg = getConfig();
  const creds = readFusionCreds();
  if (!creds || !creds.username) return { success: false, error: 'No Fusion credentials saved' };
  const base = origin(cfg.baseUrl || '');
  if (!/^https?:\/\//.test(base)) return { success: false, error: 'No Fusion pod URL configured' };
  const u = xmlEscape(creds.username), p = xmlEscape(creds.password);
  const auth = 'Basic ' + Buffer.from(`${creds.username}:${creds.password}`).toString('base64');
  const steps = [];

  try {
    // 1) folder
    const fr = await soapCatalog(base, 'createFolder',
      `<pub:createFolder><pub:folderAbsolutePath>${xmlEscape(cfg.folderPath)}</pub:folderAbsolutePath><pub:userID>${u}</pub:userID><pub:password>${p}</pub:password></pub:createFolder>`, auth);
    steps.push(`folder ${cfg.folderPath}: HTTP ${fr.status}`);

    // 2) data model (.xdmz = zip containing _datamodel.xdm)
    const dmZip = buildZip([{ name: '_datamodel.xdm', data: buildDataModelXml(cfg.dataSource) }]).toString('base64');
    const dmr = await soapCatalog(base, 'uploadObject',
      `<pub:uploadObject><pub:reportObjectAbsolutePathURL>${xmlEscape(cfg.dataModelPath)}</pub:reportObjectAbsolutePathURL><pub:objectType>xdmz</pub:objectType><pub:objectZippedData>${dmZip}</pub:objectZippedData><pub:userID>${u}</pub:userID><pub:password>${p}</pub:password></pub:uploadObject>`, auth);
    const dmFault = extractFault(dmr.text);
    steps.push(`data model: HTTP ${dmr.status}${dmFault ? ` · ${dmFault}` : ' · ok'}`);
    if (dmFault) return { success: false, error: `Data model upload failed: ${dmFault}`, steps, raw: dmr.text.slice(0, 1200) };

    // 3) report (.xdoz = zip containing _report.xdo)
    const rpZip = buildZip([{ name: '_report.xdo', data: buildReportXml(cfg.dataModelPath) }]).toString('base64');
    const rpr = await soapCatalog(base, 'uploadObject',
      `<pub:uploadObject><pub:reportObjectAbsolutePathURL>${xmlEscape(cfg.reportPath)}</pub:reportObjectAbsolutePathURL><pub:objectType>xdoz</pub:objectType><pub:objectZippedData>${rpZip}</pub:objectZippedData><pub:userID>${u}</pub:userID><pub:password>${p}</pub:password></pub:uploadObject>`, auth);
    const rpFault = extractFault(rpr.text);
    steps.push(`report: HTTP ${rpr.status}${rpFault ? ` · ${rpFault}` : ' · ok'}`);
    if (rpFault) return { success: false, error: `Report upload failed: ${rpFault}`, steps, raw: rpr.text.slice(0, 1200) };

    return { success: true, steps, message: `Deployed ${cfg.reportPath}. Run a query to verify.` };
  } catch (e) {
    return { success: false, error: e.message, steps };
  }
}

module.exports = { getConfig, setConfig, execute, deployRunner, getCalls, clearCalls, cacheGet, cacheSet, cacheClear };
