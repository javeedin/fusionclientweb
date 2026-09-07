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
  };
  try { return { ...d, ...JSON.parse(fs.readFileSync(cfgFile(), 'utf8')) }; }
  catch { return d; }
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

// ── API call log (for the in-app inspector) ─────────────────────────────────
// last N SOAP calls with their payloads; the password is redacted so nothing
// sensitive is ever shown or kept.
const CALL_LOG = [];
const redact = (s) => String(s || '').replace(/(<[^>]*password>)[\s\S]*?(<\/[^>]*password>)/gi, '$1***$2');
function recordCall(entry) {
  CALL_LOG.unshift({
    at: Date.now(),
    ...entry,
    request: redact(entry.request).slice(0, 20000),
    response: String(entry.response || '').slice(0, 20000),
  });
  if (CALL_LOG.length > 30) CALL_LOG.length = 30;
}
function getCalls() { return CALL_LOG; }
function clearCalls() { CALL_LOG.length = 0; }

// ── SOAP runReport ──────────────────────────────────────────────────────────
const SOAP11_NS = 'http://schemas.xmlsoap.org/soap/envelope/';
const SOAP12_NS = 'http://www.w3.org/2003/05/soap-envelope';

function buildEnvelope({ reportPath, base64Sql, user, pass, format, soap12 }) {
  const ns = soap12 ? SOAP12_NS : SOAP11_NS;
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="${ns}" xmlns:pub="http://xmlns.oracle.com/oxp/service/PublicReportService">
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

  // this pod's ExternalReportWSSService is a SOAP 1.2 endpoint (it rejects
  // text/xml with an Upgrade fault); try 1.2 first, fall back to 1.1
  // WSS endpoint: HTTP Basic auth on top of the in-body userID/password
  const basic = 'Basic ' + Buffer.from(`${creds.username}:${creds.password}`).toString('base64');
  const post = async (format, soap12) => {
    const body = buildEnvelope({ reportPath: cfg.reportPath, base64Sql, user: creds.username, pass: creds.password, format, soap12 });
    const headers = soap12
      ? { 'Content-Type': 'application/soap+xml; charset=utf-8; action="runReport"', Authorization: basic }
      : { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: 'runReport', Authorization: basic };
    const res = await fetch(url, { method: 'POST', headers, body });
    const text = await res.text();
    recordCall({ kind: `runReport (${format}, SOAP ${soap12 ? '1.2' : '1.1'})`, protocol: 'SOAP', url, status: res.status, request: body, response: text });
    return { status: res.status, ok: res.ok, text };
  };
  const versionFault = (t) => /soap.?1\.?2|not\s*compat|VersionMismatch|SupportedEnvelope/i.test(t || '');
  const attempt = async (format) => {
    let r = await post(format, true);          // SOAP 1.2
    if (!extractReportBytes(r.text) && versionFault(r.text)) r = await post(format, false); // fall back to 1.1
    return r;
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

// the query-runner PL/SQL (kept in sync with fusion/bip/query_runner_datamodel.sql)
const RUNNER_PLSQL = `DECLARE
    TYPE refcursor IS REF CURSOR;
    xdo_cursor         refcursor;
    v_blob             BLOB;
    v_result           BLOB;
    l_offset           INTEGER;
    l_buffer_size      BINARY_INTEGER := 48;
    l_buffer_varchar   VARCHAR2(48);
    l_buffer_raw       RAW(48);
    l_clob             CLOB;
    l_varchar          VARCHAR2(32767);
    l_start            PLS_INTEGER := 1;
    l_buffer           PLS_INTEGER := 32767;
BEGIN
    dbms_lob.createtemporary(v_blob, TRUE);
    l_offset := 1;
    FOR i IN 1 .. CEIL(dbms_lob.getlength(:P_QRY_STMT) / l_buffer_size) LOOP
        dbms_lob.read(:P_QRY_STMT, l_buffer_size, l_offset, l_buffer_varchar);
        l_buffer_raw := utl_raw.cast_to_raw(l_buffer_varchar);
        l_buffer_raw := utl_encode.base64_decode(l_buffer_raw);
        dbms_lob.writeappend(v_blob, utl_raw.length(l_buffer_raw), l_buffer_raw);
        l_offset := l_offset + l_buffer_size;
    END LOOP;
    v_result := v_blob;
    dbms_lob.freetemporary(v_blob);
    dbms_lob.createtemporary(l_clob, TRUE);
    FOR i IN 1 .. CEIL(dbms_lob.getlength(v_result) / l_buffer) LOOP
        l_varchar := utl_raw.cast_to_varchar2(dbms_lob.substr(v_result, l_buffer, l_start));
        dbms_lob.writeappend(l_clob, LENGTH(l_varchar), l_varchar);
        l_start := l_start + l_buffer;
    END LOOP;
    OPEN :xdo_cursor FOR l_clob;
END;`;

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
      <dataSet name="Q1" type="complex">
         <sql dataSourceRef="${xmlEscape(dataSource)}" nsQuery="false" xmlRowTagName="G_1" sqlReturnType="ref_cursor"><![CDATA[${RUNNER_PLSQL}]]></sql>
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
<report xmlns="http://xmlns.oracle.com/oxp/xmlp" version="2.0" defaultTemplateType="csv"
        target="parameterColumn" showControls="true" showReportControls="true"
        onLine="true" isDynamicPromptRequired="false">
   <title>QueryRunner</title>
   <description>Re-ERP Fusion SQL query runner</description>
   <dataModel url="${xmlEscape(dataModelPath)}"/>
   <parameters/>
   <listOfTemplates>
      <template type="csv" default="true" viewOnline="true" defaultOutputFormat="csv" label="Data">
         <outputFormats><outputFormat>csv</outputFormat><outputFormat>xml</outputFormat></outputFormats>
      </template>
   </listOfTemplates>
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
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: action, ...(auth ? { Authorization: auth } : {}) },
    body: env,
  });
  const text = await res.text();
  recordCall({ kind: action, protocol: 'SOAP', url, status: res.status, request: env, response: text });
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

module.exports = { getConfig, setConfig, execute, deployRunner, getCalls, clearCalls };
