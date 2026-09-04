// ── LibreChat manager ───────────────────────────────────────────────────────
// Lets the Electron app start/stop a local LibreChat (Docker) and open it in
// an app window — no terminal needed. Everything is provisioned into
// userData/librechat: docker-compose.yml + librechat.yaml are (re)written on
// each start, the MCP server files are copied from electron/, and .env is
// generated once from the saved GL MCP credentials (Claude key fetched from
// Oracle APEX, ORDS user/password) — so it works from a packaged app too,
// where the repo's librechat/ folder doesn't exist and asar can't be mounted.

const { app, BrowserWindow, safeStorage } = require('electron');
const { spawn, execSync } = require('child_process');
const crypto = require('crypto');
const http = require('http');
const fs = require('fs');
const path = require('path');

const LIBRECHAT_PORT = 3080;
const LIBRECHAT_URL = `http://localhost:${LIBRECHAT_PORT}`;
const MCP_FILES = ['gl-mcp-server.cjs', 'mcp-call-logger.cjs', 'ords-token.cjs'];

const logs = [];
let libreChatWindow = null;
let starting = false;

function log(line) {
  const entry = `[${new Date().toISOString()}] ${line}`;
  console.log('[LibreChat]', line);
  logs.push(entry);
  if (logs.length > 500) logs.splice(0, logs.length - 500);
}

function getDir() {
  return path.join(app.getPath('userData'), 'librechat');
}

// ── Docker detection ────────────────────────────────────────────────────────

function detectCompose() {
  // returns argv prefix for compose, or null when docker CLI is missing
  try {
    execSync('docker compose version', { stdio: 'ignore' });
    return ['docker', 'compose'];
  } catch (e) { /* fall through */ }
  try {
    execSync('docker-compose --version', { stdio: 'ignore' });
    return ['docker-compose'];
  } catch (e) {
    return null;
  }
}

function dockerDaemonUp() {
  try {
    execSync('docker info', { stdio: 'ignore', timeout: 10000 });
    return true;
  } catch (e) {
    return false;
  }
}

function runCompose(args, { onLine } = {}) {
  return new Promise((resolve) => {
    const compose = detectCompose();
    if (!compose) return resolve({ code: -1, error: 'Docker is not installed' });
    const [cmd, ...pre] = compose;
    const child = spawn(cmd, [...pre, ...args], {
      cwd: getDir(),
      env: process.env,
      shell: process.platform === 'win32',
      windowsHide: true,
    });
    const handle = (buf) => {
      String(buf).split(/\r?\n/).forEach((l) => {
        if (!l.trim()) return;
        log(l.trim());
        if (onLine) onLine(l.trim());
      });
    };
    child.stdout.on('data', handle);
    child.stderr.on('data', handle);
    child.on('error', (err) => resolve({ code: -1, error: err.message }));
    child.on('close', (code) => resolve({ code }));
  });
}

// ── Reachability ────────────────────────────────────────────────────────────

function checkReachable(timeoutMs = 2500) {
  return new Promise((resolve) => {
    const req = http.get(LIBRECHAT_URL, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

// ── Provisioning ────────────────────────────────────────────────────────────

const COMPOSE_YML = `# Managed by Re-ERP (LibreChat page) — regenerated on every start.
services:
  api:
    image: ghcr.io/danny-avila/librechat:latest
    container_name: librechat-api
    ports:
      - '\${PORT:-3080}:3080'
    depends_on:
      - mongodb
    restart: unless-stopped
    env_file:
      - .env
    environment:
      - HOST=0.0.0.0
      - MONGO_URI=mongodb://mongodb:27017/LibreChat
      - CONFIG_PATH=/app/librechat.yaml
    volumes:
      - ./librechat.yaml:/app/librechat.yaml:ro
      - ./mcp:/app/mcp:ro
      - librechat_images:/app/client/public/images
      - librechat_logs:/app/api/logs

  mongodb:
    image: mongo:7
    container_name: librechat-mongodb
    restart: unless-stopped
    command: mongod --noauth
    volumes:
      - librechat_mongo:/data/db

volumes:
  librechat_mongo:
  librechat_images:
  librechat_logs:
`;

const LIBRECHAT_YAML = `# Managed by Re-ERP (LibreChat page) — regenerated on every start.
version: 1.2.1
cache: true

interface:
  customWelcome: 'Oracle ERP Assistant — Claude with live GL tools (MCP)'

endpoints:
  anthropic:
    titleConvo: true
    titleModel: claude-3-5-haiku-20241022
    models:
      default:
        - claude-sonnet-4-5
        - claude-opus-4-5
        - claude-3-5-haiku-20241022
      fetch: true
    modelDisplayLabel: 'Claude (Oracle ERP)'

mcpServers:
  oracle-gl:
    type: stdio
    command: node
    args:
      - /app/mcp/gl-mcp-server.cjs
      - --stdio
    env:
      ORACLE_BASE_URL: '\${ORACLE_BASE_URL}'
      ORACLE_USERNAME: '\${ORACLE_USERNAME}'
      ORACLE_PASSWORD: '\${ORACLE_PASSWORD}'
      SKIP_AUTH: '\${SKIP_AUTH}'
    timeout: 120000
    initTimeout: 30000
    chatMenu: true
`;

// Read the GL MCP credentials the app already stores (Claude key fetched from
// Oracle APEX settings/claudekey + ORDS user/password) — same file the
// gl-mcp:* handlers in main.cjs use.
function readGlCreds() {
  try {
    const file = path.join(app.getPath('userData'), 'gl-api-creds.json');
    if (!fs.existsSync(file)) return {};
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const dec = (val, wasEncrypted) => {
      if (!val) return '';
      if (wasEncrypted && safeStorage.isEncryptionAvailable()) {
        return safeStorage.decryptString(Buffer.from(val, 'base64'));
      }
      return Buffer.from(val, 'base64').toString();
    };
    return {
      oracleBaseUrl: data.oracleBaseUrl || '',
      username: data.username || '',
      password: dec(data.password, data.encrypted),
      skipAuth: !!data.skipAuth,
      claudeKey: dec(data.claudeKey, data.claudeKeyEncrypted),
    };
  } catch (e) {
    log(`Could not read GL credentials: ${e.message}`);
    return {};
  }
}

function buildEnv(creds) {
  const hex = (n) => crypto.randomBytes(n).toString('hex');
  return [
    '# Managed by Re-ERP — generated from the saved GL MCP credentials.',
    '# Safe to edit; delete this file to regenerate it on the next start.',
    `PORT=${LIBRECHAT_PORT}`,
    `ANTHROPIC_API_KEY=${creds.claudeKey || 'user_provided'}`,
    'ENDPOINTS=anthropic',
    `ORACLE_BASE_URL=${creds.oracleBaseUrl || 'https://g15d6279501ae08-buimerc.adb.me-dubai-1.oraclecloudapps.com'}`,
    `ORACLE_USERNAME=${creds.username || ''}`,
    `ORACLE_PASSWORD=${creds.password || ''}`,
    `SKIP_AUTH=${creds.skipAuth === false ? '' : '1'}`,
    `CREDS_KEY=${hex(32)}`,
    `CREDS_IV=${hex(16)}`,
    `JWT_SECRET=${hex(32)}`,
    `JWT_REFRESH_SECRET=${hex(32)}`,
    'ALLOW_REGISTRATION=true',
    'ALLOW_SOCIAL_LOGIN=false',
    'APP_TITLE=Oracle ERP Assistant',
    'NO_INDEX=true',
    'SEARCH=false',
    '',
  ].join('\n');
}

function provision({ refreshEnv = false } = {}) {
  const dir = getDir();
  const mcpDir = path.join(dir, 'mcp');
  fs.mkdirSync(mcpDir, { recursive: true });

  fs.writeFileSync(path.join(dir, 'docker-compose.yml'), COMPOSE_YML, 'utf8');
  fs.writeFileSync(path.join(dir, 'librechat.yaml'), LIBRECHAT_YAML, 'utf8');

  // Copy the MCP server + its sibling modules (readable even from app.asar)
  for (const f of MCP_FILES) {
    fs.writeFileSync(path.join(mcpDir, f), fs.readFileSync(path.join(__dirname, f)));
  }

  const envFile = path.join(dir, '.env');
  const creds = readGlCreds();
  if (!fs.existsSync(envFile) || refreshEnv) {
    fs.writeFileSync(envFile, buildEnv(creds), 'utf8');
    log(`Provisioned .env (Claude key: ${creds.claudeKey ? 'from saved credentials' : 'user_provided — set it in LibreChat settings'})`);
  }
  log(`Provisioned LibreChat files in ${dir}`);
  return { dir, hasClaudeKey: !!creds.claudeKey };
}

// ── Public operations ───────────────────────────────────────────────────────

async function getStatus() {
  const compose = detectCompose();
  const reachable = await checkReachable();
  return {
    dockerInstalled: !!compose,
    dockerRunning: compose ? dockerDaemonUp() : false,
    starting,
    reachable,
    url: LIBRECHAT_URL,
    dir: getDir(),
    envExists: fs.existsSync(path.join(getDir(), '.env')),
  };
}

async function start({ refreshEnv = false } = {}) {
  if (starting) return { success: false, error: 'LibreChat is already starting' };
  const compose = detectCompose();
  if (!compose) {
    return { success: false, error: 'Docker is not installed. Install Docker Desktop (docker.com) and try again.' };
  }
  if (!dockerDaemonUp()) {
    return { success: false, error: 'Docker is installed but not running. Start Docker Desktop and try again.' };
  }
  starting = true;
  try {
    const { hasClaudeKey } = provision({ refreshEnv });
    log('Running docker compose up -d (first run downloads images — can take a few minutes)…');
    const res = await runCompose(['up', '-d']);
    if (res.code !== 0) {
      return { success: false, error: res.error || `docker compose exited with code ${res.code} — see logs` };
    }
    // wait for the web UI to answer (image boot takes a moment)
    for (let i = 0; i < 30; i++) {
      if (await checkReachable()) {
        log(`LibreChat is up at ${LIBRECHAT_URL}`);
        return { success: true, url: LIBRECHAT_URL, hasClaudeKey };
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    return { success: false, error: `Containers started but ${LIBRECHAT_URL} is not answering yet — give it a minute and press Refresh` };
  } catch (e) {
    log(`Start failed: ${e.message}`);
    return { success: false, error: e.message };
  } finally {
    starting = false;
  }
}

async function stop() {
  const res = await runCompose(['down']);
  return res.code === 0
    ? { success: true }
    : { success: false, error: res.error || `docker compose down exited with code ${res.code}` };
}

function openWindow() {
  try {
    if (libreChatWindow && !libreChatWindow.isDestroyed()) {
      libreChatWindow.focus();
      return { success: true };
    }
    libreChatWindow = new BrowserWindow({
      width: 1280,
      height: 860,
      minWidth: 900,
      minHeight: 600,
      title: 'LibreChat — Oracle ERP Assistant',
      icon: path.join(__dirname, '../public/icons/icon-512.png'),
      webPreferences: { nodeIntegration: false, contextIsolation: true },
      autoHideMenuBar: true,
    });
    libreChatWindow.loadURL(LIBRECHAT_URL);
    libreChatWindow.on('closed', () => { libreChatWindow = null; });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function getLogs() {
  return logs.join('\n');
}

module.exports = { getStatus, start, stop, openWindow, getLogs, LIBRECHAT_URL };
