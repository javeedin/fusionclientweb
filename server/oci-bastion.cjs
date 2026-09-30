// OCI Bastion sessions for the FTP Manager — create a port-forwarding session and
// check whether one is still ACTIVE, using the OCI REST API with the API key from
// the standard OCI config file (~/.oci/config, same as the OCI CLI / SDKs).
//
// Requests are signed per the OCI "Request Signatures" spec (HTTP Signatures,
// rsa-sha256) with Node's crypto — no SDK dependency.
//   GET/DELETE sign: x-date (request-target) host
//   POST/PUT   sign: x-date (request-target) host content-type content-length x-content-sha256
// (verified byte-for-byte against oci-common's DefaultRequestSigner)
// Bastion API: https://bastion.<region>.oci.oraclecloud.com/20210331/…
//
// The OCI user needs a policy such as
//   allow group <group> to manage bastion-session in compartment <compartment>
//   allow group <group> to read bastion in compartment <compartment>

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const https = require('https');

const expandHome = (p) => (p && p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p);

// ~/.oci/config (INI). Returns the profile's keys; key_file resolved.
const readOciConfig = (file, profile = 'DEFAULT') => {
  const cfgPath = expandHome(String(file || '').trim().replace(/^"(.*)"$/, '$1')) || path.join(os.homedir(), '.oci', 'config');
  let text;
  try { text = fs.readFileSync(cfgPath, 'utf8'); }
  catch (e) { throw new Error(`OCI config not found at ${cfgPath} — create it with "oci setup config" or the Console (Profile → API keys → Add API key) (${e.code || e.message})`); }
  const profiles = {};
  let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const sec = /^\[(.+)\]$/.exec(line);
    if (sec) { cur = sec[1].trim(); profiles[cur] = profiles[cur] || {}; continue; }
    const kv = /^([^=]+)=(.*)$/.exec(line);
    if (kv && cur) profiles[cur][kv[1].trim()] = kv[2].trim();
  }
  const p = profiles[profile || 'DEFAULT'];
  if (!p) throw new Error(`Profile [${profile || 'DEFAULT'}] not found in ${cfgPath}`);
  for (const k of ['user', 'fingerprint', 'tenancy', 'key_file']) {
    if (!p[k]) throw new Error(`"${k}" is missing in profile [${profile || 'DEFAULT'}] of ${cfgPath}`);
  }
  let keyPem;
  const keyFile = expandHome(p.key_file);
  try { keyPem = fs.readFileSync(keyFile, 'utf8'); }
  catch (e) { throw new Error(`OCI API private key not readable: ${keyFile} (${e.code || e.message})`); }
  return {
    user: p.user, fingerprint: p.fingerprint, tenancy: p.tenancy, region: p.region,
    privateKey: crypto.createPrivateKey({ key: keyPem, passphrase: p.pass_phrase || undefined }),
    configPath: cfgPath,
  };
};

// Sign one request; returns the headers to send (incl. authorization). Header set,
// order and naming follow the official OCI SDK (oci-common) exactly: the time goes in
// x-date, and the signed names are lower-cased in the signing string.
const signRequest = ({ method, url, body, oci, date }) => {
  const u = new URL(url);
  const m = method.toUpperCase();
  const headers = {
    'x-date': date || new Date().toUTCString(),
    host: u.host,
  };
  const names = ['x-date', '(request-target)', 'host'];
  if (m === 'POST' || m === 'PUT' || m === 'PATCH') {
    const buf = Buffer.from(body || '', 'utf8');
    headers['content-type'] = 'application/json';
    headers['content-length'] = String(buf.length);
    headers['x-content-sha256'] = crypto.createHash('sha256').update(buf).digest('base64');
    names.push('Content-Type', 'Content-Length', 'x-content-sha256');
  }
  const target = `${m.toLowerCase()} ${u.pathname}${u.search}`;
  const signingString = names.map((n) => {
    const k = n.toLowerCase();
    return k === '(request-target)' ? `(request-target): ${target}` : `${k}: ${headers[k]}`;
  }).join('\n');
  const signature = crypto.sign('sha256', Buffer.from(signingString, 'utf8'), oci.privateKey).toString('base64');
  headers.authorization = `Signature version="1",keyId="${oci.tenancy}/${oci.user}/${oci.fingerprint}",`
    + `algorithm="rsa-sha256",headers="${names.join(' ')}",signature="${signature}"`;
  return headers;
};

const ociRequest = (oci, method, url, bodyObj) => new Promise((resolve, reject) => {
  const body = bodyObj === undefined ? '' : JSON.stringify(bodyObj);
  const headers = { ...signRequest({ method, url, body, oci }), accept: 'application/json' };
  const lib = url.startsWith('http://') ? require('http') : https;
  const req = lib.request(url, { method, headers, timeout: 30000 }, (res) => {
    let data = '';
    res.on('data', (c) => { data += c; });
    res.on('end', () => {
      let json = null;
      try { json = data ? JSON.parse(data) : null; } catch { /* not JSON */ }
      if (res.statusCode >= 200 && res.statusCode < 300) return resolve(json);
      const msg = json?.message || data || `HTTP ${res.statusCode}`;
      const err = new Error(`OCI ${method} ${new URL(url).pathname}: ${res.statusCode} ${json?.code || ''} ${msg}`.replace(/\s+/g, ' ').trim());
      err.status = res.statusCode;
      err.code = json?.code;
      reject(err);
    });
  });
  req.on('timeout', () => req.destroy(new Error('OCI request timed out')));
  req.on('error', reject);
  if (body) req.write(body);
  req.end();
});

// region from any OCID: ocid1.<type>.<realm>.<region>.<id>
const regionFromOcid = (ocid) => {
  const m = /^ocid1\.[a-z0-9]+\.[^.]+\.([a-z0-9-]+)\./i.exec(String(ocid || '').trim());
  return m ? m[1].toLowerCase() : null;
};
// REERP_OCI_BASTION_API overrides the endpoint (tests only)
const bastionApi = (region) => process.env.REERP_OCI_BASTION_API || `https://bastion.${region}.oci.oraclecloud.com/20210331`;

// OpenSSH public key ("ssh-rsa AAAA…") from the Bastion private key file, so the
// same key the tunnel uses is registered on the new session. OpenSSH and PKCS#1 keys
// via ssh2; any PEM (incl. PKCS#8 "BEGIN PRIVATE KEY", as OCI's "Generate key pair"
// downloads) via Node crypto.
const sshString = (buf) => { const len = Buffer.alloc(4); len.writeUInt32BE(buf.length); return Buffer.concat([len, buf]); };
const sshMpint = (b64url) => {
  let b = Buffer.from(b64url, 'base64url');
  while (b.length > 1 && b[0] === 0) b = b.subarray(1);
  if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]);   // keep it positive
  return sshString(b);
};
const publicKeyFromPrivate = (keyPath, passphrase) => {
  const raw = fs.readFileSync(keyPath);
  try {
    const { utils } = require('ssh2'); // installed with ssh2-sftp-client
    const parsed = utils.parseKey(raw, passphrase || undefined);
    const key = Array.isArray(parsed) ? parsed[0] : parsed;
    if (key && !(key instanceof Error)) return `${key.type} ${key.getPublicSSH().toString('base64')}`;
  } catch { /* fall through to Node crypto */ }
  let jwk;
  try {
    jwk = crypto.createPublicKey(crypto.createPrivateKey({ key: raw, passphrase: passphrase || undefined })).export({ format: 'jwk' });
  } catch (e) {
    throw new Error(`Cannot read the Bastion private key ${keyPath}: ${e.message}`);
  }
  if (jwk.kty === 'RSA') {
    const blob = Buffer.concat([sshString(Buffer.from('ssh-rsa')), sshMpint(jwk.e), sshMpint(jwk.n)]);
    return `ssh-rsa ${blob.toString('base64')}`;
  }
  if (jwk.kty === 'OKP' && jwk.crv === 'Ed25519') {
    const blob = Buffer.concat([sshString(Buffer.from('ssh-ed25519')), sshString(Buffer.from(jwk.x, 'base64url'))]);
    return `ssh-ed25519 ${blob.toString('base64')}`;
  }
  throw new Error(`Unsupported Bastion key type ${jwk.kty}${jwk.crv ? `/${jwk.crv}` : ''} — use an RSA key`);
};

// GET a session → {lifecycleState, …} or null when it no longer exists
const getSession = async (oci, sessionOcid) => {
  const region = regionFromOcid(sessionOcid) || oci.region;
  try {
    return await ociRequest(oci, 'GET', `${bastionApi(region)}/sessions/${encodeURIComponent(sessionOcid)}`);
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Create a PORT_FORWARDING session to targetIp:targetPort and wait until ACTIVE.
const createPortForwardingSession = async (oci, { bastionOcid, targetIp, targetPort = 22, keyPath, displayName, onState }) => {
  if (!/^ocid1\.bastion\./i.test(String(bastionOcid || ''))) throw new Error('Bastion OCID is missing or invalid (it starts with ocid1.bastion.)');
  const region = regionFromOcid(bastionOcid) || oci.region;
  if (!region) throw new Error('Cannot tell the OCI region — set "region" in the OCI config');
  const api = bastionApi(region);
  const bastion = await ociRequest(oci, 'GET', `${api}/bastions/${encodeURIComponent(bastionOcid)}`);
  const ttl = Math.min(Number(bastion?.maxSessionTtlInSeconds) || 10800, 10800);
  const publicKeyContent = publicKeyFromPrivate(keyPath);
  const created = await ociRequest(oci, 'POST', `${api}/sessions`, {
    bastionId: bastionOcid,
    displayName: displayName || `reerp-ftp-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}`,
    keyDetails: { publicKeyContent },
    targetResourceDetails: {
      sessionType: 'PORT_FORWARDING',
      targetResourcePrivateIpAddress: targetIp,
      targetResourcePort: Number(targetPort) || 22,
    },
    sessionTtlInSeconds: ttl,
  });
  const id = created?.id;
  if (!id) throw new Error('OCI did not return a session id');
  // CREATING → ACTIVE usually takes 10–60 s
  const until = Date.now() + 3 * 60 * 1000;
  let s = created;
  while (Date.now() < until) {
    if (onState) onState(s?.lifecycleState);
    if (s?.lifecycleState === 'ACTIVE') break;
    if (s?.lifecycleState === 'FAILED' || s?.lifecycleState === 'DELETED') {
      throw new Error(`New Bastion session ${s.lifecycleState}: ${s.lifecycleDetails || ''}`.trim());
    }
    await sleep(4000);
    s = await getSession(oci, id);
  }
  if (s?.lifecycleState !== 'ACTIVE') throw new Error(`The new Bastion session is still ${s?.lifecycleState || 'CREATING'} after 3 minutes — try Connect again shortly (${id})`);
  return {
    sessionOcid: id,
    bastionHost: `host.bastion.${region}.oci.oraclecloud.com`,
    ttlSeconds: ttl,
    expiresAt: new Date(Date.parse(s.timeCreated || created.timeCreated || new Date().toISOString()) + ttl * 1000).toISOString(),
    sshCommand: s?.sshMetadata?.command || null,
  };
};

module.exports = {
  readOciConfig, signRequest, ociRequest, getSession, createPortForwardingSession,
  publicKeyFromPrivate, regionFromOcid,
};
