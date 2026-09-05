const { app, BrowserWindow, Tray, Menu, dialog, ipcMain, Notification, nativeImage, utilityProcess, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
// electron-updater removed — was causing 5+ min startup delay in packaged EXE
// (bundled into app, generated app-update.yml, triggered GitHub network calls before window opened)
let autoUpdater = null;

let nodemailer = null;
try { nodemailer = require('nodemailer'); } catch (_) { /* optional */ }

const rag = require('./rag.cjs');
const updateService = require('./update-service.cjs');
const getUserDataPath = () => app.getPath('userData');

// ── Email sender (IPC) ──────────────────────────────────────────────────────
const APEX_BASE = 'https://g15d6279501ae08-buimerc.adb.me-dubai-1.oraclecloudapps.com/ords/bcldifc/reerp';

// In-memory cache so we don't hit APEX on every OTP request
let _smtpCache = null;
let _smtpCacheAt = 0;
const SMTP_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

// 1. Try APEX DB  2. Fall back to local file
async function loadSmtpConfig() {
  // Return cached value if still fresh
  if (_smtpCache && (Date.now() - _smtpCacheAt) < SMTP_CACHE_TTL) {
    return _smtpCache;
  }

  // ── Primary: fetch from APEX DB ──
  try {
    const res = await fetch(`${APEX_BASE}/config/emailsettings`, { headers: { ...(await require('./ords-token.cjs').getOrdsAuthHeader()) } });
    const data = await res.json();
    if (data.status === 'success') {
      console.log('[email] Config loaded from APEX DB');
      _smtpCache = { host: data.host, port: data.port, secure: data.secure === true || data.secure === 'true', user: data.user, pass: data.pass, fromName: data.fromName };
      _smtpCacheAt = Date.now();
      return _smtpCache;
    }
  } catch (e) {
    console.warn('[email] APEX fetch failed, trying local file:', e.message);
  }

  // ── Fallback: local email.config.json ──
  const candidates = [path.join(__dirname, 'email.config.json')];
  try { candidates.push(path.join(process.resourcesPath, 'email.config.json')); } catch (_) {}
  try { candidates.push(path.join(app.getAppPath(), 'electron', 'email.config.json')); } catch (_) {}

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
        const cfg = JSON.parse(raw);
        console.log('[email] Config loaded from local file:', p);
        return cfg;
      }
    } catch (e) {
      console.error('[email] Error reading', p, ':', e.message);
    }
  }

  console.error('[email] No config found in APEX DB or local file.');
  return null;
}

ipcMain.handle('send-otp-email', async (_event, { to, otp }) => {
  const cfg = await loadSmtpConfig();
  if (!cfg) return { success: false, error: 'Email config not found. Please add SMTP settings to RR_EMAIL_CONFIG table in APEX.' };
  try {
    // Use Brevo HTTP API — same approach as the proxy server (avoids SMTP auth issues)
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': cfg.pass },
      body: JSON.stringify({
        sender: { name: cfg.fromName || 'ReactERP', email: cfg.user },
        to: [{ email: to }],
        subject: 'ReactERP — Your One-Time Password (OTP)',
        htmlContent: `
          <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:32px;border:1px solid #e0e0e0;border-radius:8px">
            <h2 style="color:#1a1a2e;margin-top:0">ReactERP</h2>
            <p>Your one-time password (OTP) is:</p>
            <div style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#1677ff;background:#f0f5ff;padding:16px 24px;border-radius:6px;text-align:center;margin:24px 0">
              ${otp}
            </div>
            <p style="color:#666;font-size:13px">Valid for <strong>15 minutes</strong>. Enter this code along with your new password.</p>
            <p style="color:#999;font-size:12px">If you did not request this, please ignore this email.</p>
            <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
            <p style="color:#aaa;font-size:11px;margin:0">ReactERP System</p>
          </div>`,
      }),
    });
    const data = await response.json();
    if (!response.ok) return { success: false, error: data.message || 'Brevo API error' };
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Open new window (for "New Window" feature)
// Optional path parameter: if provided, navigate to that path in the new window
ipcMain.handle('openNewWindow', async (event, pathParam) => {
  console.log('[New Window] Handler called with path:', pathParam);
  try {
    const newWindow = new BrowserWindow({
      width: 1400,
      height: 900,
      minWidth: 1024,
      minHeight: 768,
      icon: path.join(__dirname, '../public/icons/icon-512.png'),
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.cjs'),
        webSecurity: false, // Allow cross-origin requests to Oracle Fusion API
        webviewTag: true,   // Enable <webview> tag for Oracle Fusion embedded browser
      },
      show: false, // Don't show until ready
    });

    console.log('[New Window] BrowserWindow created');

    // Load the same URL as main window, optionally with a path hash
    if (mainWindow) {
      const currentUrl = mainWindow.webContents.getURL();
      const baseUrl = currentUrl.replace(/#.*$/, ''); // Remove any existing hash
      const urlToLoad = pathParam ? `${baseUrl}#${pathParam}` : currentUrl;
      console.log('[New Window] Loading URL:', urlToLoad);
      newWindow.loadURL(urlToLoad);
    } else {
      // Fallback: use app root
      const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
      const baseUrl = isDev ? 'http://localhost:5173' : `file://${path.join(app.getAppPath(), 'dist', 'index.html')}`;
      const urlToLoad = pathParam ? `${baseUrl}#${pathParam}` : baseUrl;

      console.log('[New Window] Fallback mode - isDev:', isDev, 'URL:', urlToLoad);

      if (isDev) {
        newWindow.loadURL(urlToLoad);
      } else {
        newWindow.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'));
        // If path provided, use URL hash navigation after load
        if (pathParam) {
          newWindow.webContents.once('did-finish-load', () => {
            newWindow.webContents.executeJavaScript(`window.location.hash = '${pathParam}'`);
          });
        }
      }
    }

    // Show and maximize window once ready
    newWindow.once('ready-to-show', () => {
      console.log('[New Window] Window ready to show');
      newWindow.show();
      newWindow.maximize();
      newWindow.focus();
    });

    console.log('[New Window] Opened successfully', pathParam ? `(path: ${pathParam})` : '');
    return true;
  } catch (err) {
    console.error('[New Window] Error details:', {
      message: err.message,
      stack: err.stack,
      path: pathParam,
    });
    return false;
  }
});

let mainWindow;
let tray = null;
let isQuitting = false;
let isSyncing = false;
let proxyServer = null;
let glMcpServer = null; // GL MCP Server process
const glMcpLogs = []; // Store recent logs (max 100 lines)
const MAX_LOGS = 100;

function addGLLog(level, message) {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] [${level}] ${message}`;
  glMcpLogs.push(logEntry);
  if (glMcpLogs.length > MAX_LOGS) {
    glMcpLogs.shift();
  }
}

// Start the proxy server.
// Primary: utilityProcess.fork() — uses Electron's bundled Node, no system Node needed.
// Fallback: spawn('node', ...) — for dev environments where node is on PATH.
function startProxyServer() {
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

  const serverPath = isDev
    ? path.join(__dirname, '../server/proxy.cjs')
    : path.join(app.getAppPath(), 'server', 'proxy.cjs');

  console.log('Starting proxy server from:', serverPath);

  if (!fs.existsSync(serverPath)) {
    console.error('Proxy server not found at:', serverPath);
    return;
  }

  // Primary: utilityProcess (packaged build — no external Node required)
  if (app.isPackaged && utilityProcess) {
    try {
      proxyServer = utilityProcess.fork(serverPath, [], {
        cwd: app.getAppPath(),
        stdio: 'pipe',
      });
      proxyServer.stdout?.on('data', (d) => console.log('Proxy:', d.toString().trim()));
      proxyServer.stderr?.on('data', (d) => console.error('Proxy Error:', d.toString().trim()));
      proxyServer.on('exit', (code) => { console.log('Proxy exited:', code); proxyServer = null; });
      console.log('Proxy server started via utilityProcess');
      return;
    } catch (err) {
      console.warn('utilityProcess.fork failed, trying spawn fallback:', err.message);
    }
  }

  // Fallback: spawn node (dev or if utilityProcess failed)
  try {
    proxyServer = spawn('node', [serverPath], {
      cwd: isDev ? path.join(__dirname, '..') : app.getAppPath(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    proxyServer.stdout.on('data', (d) => console.log('Proxy:', d.toString().trim()));
    proxyServer.stderr.on('data', (d) => console.error('Proxy Error:', d.toString().trim()));
    proxyServer.on('close', (code) => { console.log('Proxy exited:', code); proxyServer = null; });
    proxyServer.on('error', (err) => { console.error('Proxy spawn error:', err); proxyServer = null; });
    console.log('Proxy server started via spawn');
  } catch (err) {
    console.error('Failed to start proxy server:', err);
    proxyServer = null;
  }
}

// Stop the proxy server
function stopProxyServer() {
  if (proxyServer) {
    console.log('Stopping proxy server...');
    proxyServer.kill();
    proxyServer = null;
  }
}

// ── GL MCP Server Management ────────────────────────────────────────────────
function startGLMcpServer(credentials) {
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

  const serverPath = isDev
    ? path.join(__dirname, 'gl-mcp-server.cjs')
    : path.join(app.getAppPath(), 'electron', 'gl-mcp-server.cjs');

  console.log(`[GL MCP] ${new Date().toISOString()} Starting GL MCP Server from: ${serverPath}`);

  if (!fs.existsSync(serverPath)) {
    console.error(`[GL MCP] ${new Date().toISOString()} GL MCP Server not found at: ${serverPath}`);
    return false;
  }

  if (glMcpServer) {
    console.warn(`[GL MCP] ${new Date().toISOString()} GL MCP Server already running (PID: ${glMcpServer.pid})`);
    return false;
  }

  // Set environment variables for GL API authentication
  const env = {
    ...process.env,
    ORACLE_BASE_URL: credentials?.oracleBaseUrl || 'https://g15d6279501ae08-buimerc.adb.me-dubai-1.oraclecloudapps.com',
    ORACLE_USERNAME: credentials?.username || '',
    ORACLE_PASSWORD: credentials?.password || '',
    SKIP_AUTH: credentials?.skipAuth ? 'true' : 'false',
    GL_MCP_HTTP_PORT: credentials?.httpPort ? String(credentials.httpPort) : '3001',
  };

  console.log(`[GL MCP] ${new Date().toISOString()} Environment config: SKIP_AUTH=${env.SKIP_AUTH}, HTTP_PORT=${env.GL_MCP_HTTP_PORT}`);

  try {
    glMcpServer = spawn('node', [serverPath], {
      cwd: isDev ? path.join(__dirname, '..') : app.getAppPath(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: env,
    });

    let serverStarted = false;
    const startTimeout = setTimeout(() => {
      if (!serverStarted && glMcpServer) {
        const msg = 'Server startup timeout (5s) - check logs';
        console.warn(`[GL MCP] ${new Date().toISOString()} ${msg}`);
        addGLLog('WARN', msg);
      }
    }, 5000);

    glMcpServer.stdout?.on('data', (d) => {
      const message = d.toString().trim();
      if (message) {
        console.log(`[GL MCP] ${new Date().toISOString()} STDOUT: ${message}`);
        addGLLog('STDOUT', message);
        if (message.includes('started successfully') || message.includes('listening')) {
          serverStarted = true;
          clearTimeout(startTimeout);
        }
      }
    });

    glMcpServer.stderr?.on('data', (d) => {
      const message = d.toString().trim();
      if (message) {
        console.error(`[GL MCP] ${new Date().toISOString()} STDERR: ${message}`);
        addGLLog('STDERR', message);
        if (message.includes('started successfully') || message.includes('listening')) {
          serverStarted = true;
          clearTimeout(startTimeout);
        }
      }
    });

    glMcpServer.on('close', (code) => {
      console.log(`[GL MCP] ${new Date().toISOString()} Server exited with code: ${code}`);
      glMcpServer = null;
      if (mainWindow) {
        mainWindow.webContents.send('gl-mcp-status', { running: false, code });
      }
    });

    glMcpServer.on('error', (err) => {
      console.error(`[GL MCP] ${new Date().toISOString()} Spawn error: ${err.message}`);
      glMcpServer = null;
    });

    console.log(`[GL MCP] ${new Date().toISOString()} Server spawned successfully (PID: ${glMcpServer.pid})`);
    return true;
  } catch (err) {
    console.error(`[GL MCP] ${new Date().toISOString()} Failed to start server: ${err.message}`);
    glMcpServer = null;
    return false;
  }
}

// Stop GL MCP Server
function stopGLMcpServer() {
  if (glMcpServer) {
    console.log('Stopping GL MCP Server...');
    glMcpServer.kill();
    glMcpServer = null;
    return true;
  }
  return false;
}

// Get GL MCP Server status
function getGLMcpServerStatus() {
  return {
    running: glMcpServer !== null,
    pid: glMcpServer?.pid || null,
  };
}

// Get config file path
function getConfigPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

// Configure remote URL (prompt user)
function configureRemoteUrl() {
  const { BrowserWindow } = require('electron');

  // Create a simple prompt dialog
  const prompt = new BrowserWindow({
    width: 500,
    height: 200,
    parent: mainWindow,
    modal: true,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Configure Remote URL</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 20px; background: #f5f5f5; }
        h3 { margin-top: 0; color: #333; }
        input { width: 100%; padding: 10px; margin: 10px 0; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box; }
        .buttons { text-align: right; margin-top: 15px; }
        button { padding: 8px 20px; margin-left: 10px; cursor: pointer; border-radius: 4px; }
        .save { background: #C74634; color: white; border: none; }
        .cancel { background: #ddd; border: none; }
        .hint { font-size: 12px; color: #666; }
      </style>
    </head>
    <body>
      <h3>Configure Remote URL</h3>
      <p class="hint">Enter the URL where ReactERP is hosted (e.g., GitHub Pages, Vercel, or your server)</p>
      <input type="text" id="url" placeholder="https://your-domain.com/reacterp" />
      <div class="buttons">
        <button class="cancel" onclick="window.close()">Cancel</button>
        <button class="save" onclick="save()">Save & Restart</button>
      </div>
      <script>
        const { ipcRenderer } = require('electron');
        function save() {
          const url = document.getElementById('url').value;
          if (url) {
            ipcRenderer.send('save-remote-url', url);
          }
        }
        // Load existing URL
        ipcRenderer.on('load-url', (e, url) => {
          if (url) document.getElementById('url').value = url;
        });
      </script>
    </body>
    </html>
  `;

  prompt.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(htmlContent));
  prompt.once('ready-to-show', () => {
    prompt.show();
    // Send existing URL to the prompt
    try {
      const config = JSON.parse(fs.readFileSync(getConfigPath(), 'utf8'));
      prompt.webContents.send('load-url', config.remoteUrl || '');
    } catch (e) {
      // No config
    }
  });
}

// Save remote URL and restart
ipcMain.on('save-remote-url', (event, url) => {
  const configPath = getConfigPath();
  fs.writeFileSync(configPath, JSON.stringify({ remoteUrl: url }, null, 2));
  dialog.showMessageBox({
    type: 'info',
    title: 'Configuration Saved',
    message: 'Remote URL saved. The app will now restart.',
  }).then(() => {
    app.relaunch();
    app.exit(0);
  });
});

// Clear remote URL (use local files)
function clearRemoteUrl() {
  const configPath = getConfigPath();
  try {
    if (fs.existsSync(configPath)) {
      fs.unlinkSync(configPath);
      dialog.showMessageBox({
        type: 'info',
        title: 'Configuration Cleared',
        message: 'Remote URL cleared. The app will restart and use local files.',
      }).then(() => {
        app.relaunch();
        app.exit(0);
      });
    } else {
      dialog.showMessageBox({
        type: 'info',
        title: 'Already Using Local Files',
        message: 'The app is already configured to use local files.',
      });
    }
  } catch (e) {
    console.error('Error clearing config:', e);
  }
}

// Create the main application window
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 768,
    icon: path.join(__dirname, '../public/icons/icon-512.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
      webSecurity: false, // Allow cross-origin requests to Oracle Fusion API
      webviewTag: true,   // Enable <webview> tag for Oracle Fusion embedded browser
    },
    show: true, // Show immediately — avoids window getting stuck invisible
  });

  // Load the app
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

  // Check for remote config (Git-based loading)
  const configPath = getConfigPath();
  let remoteUrl = null;

  try {
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      remoteUrl = config.remoteUrl;
      console.log('Loaded remote URL from config:', remoteUrl);
    }
  } catch (e) {
    console.log('No remote config found, using local files');
  }

  if (remoteUrl) {
    // Load from remote URL (Git Pages, Vercel, etc.)
    console.log('Loading from remote URL:', remoteUrl);
    mainWindow.loadURL(remoteUrl);
  } else if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    // In production, load from the dist folder relative to app root
    const indexPath = path.join(app.getAppPath(), 'dist', 'index.html');
    const appPath = app.getAppPath();

    // Create debug info
    const debugInfo = {
      appPath: appPath,
      indexPath: indexPath,
      indexExists: fs.existsSync(indexPath),
      dirname: __dirname,
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath || 'N/A',
    };

    // List files in app directory
    try {
      debugInfo.appFiles = fs.readdirSync(appPath);
      const distPath = path.join(appPath, 'dist');
      if (fs.existsSync(distPath)) {
        debugInfo.distFiles = fs.readdirSync(distPath);
      } else {
        debugInfo.distFiles = 'dist folder NOT FOUND';
      }
    } catch (e) {
      debugInfo.error = e.message;
    }

    console.log('Debug Info:', JSON.stringify(debugInfo, null, 2));

    if (fs.existsSync(indexPath)) {
      mainWindow.loadFile(indexPath);
    } else {
      // Show debug page if index.html not found
      const debugHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>ReactERP - Debug Info</title>
          <style>
            body { font-family: monospace; padding: 20px; background: #1a1a1a; color: #00ff00; }
            h1 { color: #ff6b6b; }
            pre { background: #2a2a2a; padding: 15px; border-radius: 5px; overflow: auto; }
            .error { color: #ff6b6b; }
            .success { color: #00ff00; }
          </style>
        </head>
        <body>
          <h1>⚠️ ReactERP - Loading Error</h1>
          <p class="error">Could not find index.html</p>
          <h2>Debug Information:</h2>
          <pre>${JSON.stringify(debugInfo, null, 2)}</pre>
          <h2>Possible Solutions:</h2>
          <ul>
            <li>Make sure 'dist' folder is included in the build</li>
            <li>Run 'npm run build' before 'npm run electron:build:win'</li>
            <li>Check electron-builder 'files' configuration in package.json</li>
          </ul>
        </body>
        </html>
      `;
      mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(debugHtml));
    }
  }

  // Open DevTools only in development
  if (!app.isPackaged && process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  // Enable right-click → Inspect Element in all builds
  mainWindow.webContents.on('context-menu', (_event, params) => {
    const { Menu, MenuItem } = require('electron');
    const menu = new Menu();
    menu.append(new MenuItem({
      label: 'Inspect Element',
      click: () => {
        mainWindow.webContents.inspectElement(params.x, params.y);
        if (!mainWindow.webContents.isDevToolsOpened()) {
          mainWindow.webContents.openDevTools();
        }
      },
    }));
    if (params.selectionText) {
      menu.append(new MenuItem({ label: 'Copy', role: 'copy' }));
    }
    if (params.isEditable) {
      menu.append(new MenuItem({ label: 'Cut',   role: 'cut'   }));
      menu.append(new MenuItem({ label: 'Copy',  role: 'copy'  }));
      menu.append(new MenuItem({ label: 'Paste', role: 'paste' }));
    }
    menu.popup({ window: mainWindow });
  });

  // Log any load errors
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error('Failed to load:', validatedURL);
    console.error('Error:', errorCode, errorDescription);
  });

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('Page loaded successfully');
  });

  // Ensure window is visible and focused once content is loaded
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  // Handle close button - ask for confirmation or minimize to tray
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();

      if (isSyncing) {
        // If syncing, ask for confirmation
        const choice = dialog.showMessageBoxSync(mainWindow, {
          type: 'warning',
          buttons: ['Minimize to Tray', 'Stop Sync & Close', 'Cancel'],
          defaultId: 2,
          cancelId: 2,
          title: 'Sync in Progress',
          message: 'A sync operation is currently running.',
          detail: 'What would you like to do?',
        });

        if (choice === 0) {
          // Minimize to tray
          mainWindow.hide();
        } else if (choice === 1) {
          // Stop sync and close
          mainWindow.webContents.send('stop-sync');
          isQuitting = true;
          app.quit();
        }
        // choice === 2: Cancel - do nothing
      } else {
        // Not syncing, ask if they want to close or minimize
        const choice = dialog.showMessageBoxSync(mainWindow, {
          type: 'question',
          buttons: ['Minimize to Tray', 'Close App', 'Cancel'],
          defaultId: 0,
          cancelId: 2,
          title: 'Close ReactERP',
          message: 'What would you like to do?',
          detail: 'You can minimize to system tray to keep the app running in background.',
        });

        if (choice === 0) {
          // Minimize to tray
          mainWindow.hide();
        } else if (choice === 1) {
          // Close app
          isQuitting = true;
          app.quit();
        }
        // choice === 2: Cancel - do nothing
      }
    }
  });

  // Handle minimize - optionally minimize to tray
  mainWindow.on('minimize', (event) => {
    // Uncomment below to always minimize to tray
    // event.preventDefault();
    // mainWindow.hide();
  });

  // Setup application menu
  setupAppMenu();
}

// Setup application menu with Help → Check for Updates
function setupAppMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Exit',
          accelerator: 'CmdOrCtrl+Q',
          click: () => {
            isQuitting = true;
            app.quit();
          }
        }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Check for Updates',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('open-update-checker');
            }
          }
        },
        { type: 'separator' },
        {
          label: 'About FusionClient',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('open-about');
            }
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// Create system tray icon
function createTray() {
  // Use the smallest available icon directly — avoids loading 512px image and resizing on startup
  const iconPath = path.join(
    app.isPackaged ? app.getAppPath() : path.join(__dirname, '..'),
    'public', 'icons', 'icon-16.png'
  );
  const fallbackPath = path.join(
    app.isPackaged ? app.getAppPath() : path.join(__dirname, '..'),
    'public', 'icons', 'icon-128.png'
  );
  let trayIcon;

  try {
    const p = fs.existsSync(iconPath) ? iconPath : fallbackPath;
    trayIcon = nativeImage.createFromPath(p);
    // Only resize if we loaded a large icon
    if (!iconPath.includes('icon-16')) {
      trayIcon = trayIcon.resize({ width: 16, height: 16 });
    }
  } catch (e) {
    console.error('Failed to load tray icon:', e);
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('ReactERP - Oracle Fusion Sync');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open ReactERP',
      click: () => {
        mainWindow.show();
        mainWindow.focus();
      },
    },
    {
      label: 'Sync Status',
      enabled: false,
      id: 'sync-status',
    },
    { type: 'separator' },
    {
      label: 'Start Sync',
      click: () => {
        mainWindow.show();
        mainWindow.webContents.send('start-sync');
      },
    },
    {
      label: 'Stop Sync',
      click: () => {
        mainWindow.webContents.send('stop-sync');
      },
    },
    { type: 'separator' },
    {
      label: 'Configure Remote URL...',
      click: () => {
        configureRemoteUrl();
      },
    },
    {
      label: 'Use Local Files',
      click: () => {
        clearRemoteUrl();
      },
    },
    { type: 'separator' },
    {
      label: 'Check for Updates',
      click: () => {
        if (autoUpdater && app.isPackaged) {
          autoUpdater.checkForUpdates();
        } else {
          require('electron').shell.openExternal('https://github.com/javeedin/reacterp/releases');
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  // Double-click on tray icon opens window
  tray.on('double-click', () => {
    mainWindow.show();
    mainWindow.focus();
  });
}

// Update tray tooltip and menu based on sync status
function updateTrayStatus(status, details = '') {
  if (!tray) return;

  isSyncing = status === 'syncing';

  let tooltip = 'ReactERP';
  let statusLabel = 'Idle';

  switch (status) {
    case 'syncing':
      tooltip = `ReactERP - Syncing... ${details}`;
      statusLabel = `Syncing: ${details}`;
      break;
    case 'completed':
      tooltip = 'ReactERP - Sync Completed';
      statusLabel = 'Last sync: Completed';
      break;
    case 'error':
      tooltip = 'ReactERP - Sync Error';
      statusLabel = 'Last sync: Error';
      break;
    default:
      tooltip = 'ReactERP - Ready';
      statusLabel = 'Ready';
  }

  tray.setToolTip(tooltip);

  // Update context menu
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open ReactERP',
      click: () => {
        mainWindow.show();
        mainWindow.focus();
      },
    },
    {
      label: statusLabel,
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Start Sync',
      enabled: !isSyncing,
      click: () => {
        mainWindow.show();
        mainWindow.webContents.send('start-sync');
      },
    },
    {
      label: 'Stop Sync',
      enabled: isSyncing,
      click: () => {
        mainWindow.webContents.send('stop-sync');
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
}

// Show notification
function showNotification(title, body, type = 'info') {
  if (Notification.isSupported()) {
    const notification = new Notification({
      title: title,
      body: body,
      icon: path.join(__dirname, '../public/icons/icon-512.png'),
      silent: false,
    });

    notification.on('click', () => {
      mainWindow.show();
      mainWindow.focus();
    });

    notification.show();
  }
}

// IPC Handlers
ipcMain.on('sync-status', (event, status, details) => {
  updateTrayStatus(status, details);
});

ipcMain.on('sync-started', (event, syncType) => {
  isSyncing = true;
  updateTrayStatus('syncing', syncType);
});

ipcMain.on('sync-progress', (event, progress) => {
  updateTrayStatus('syncing', progress);
});

ipcMain.on('sync-completed', (event, summary) => {
  isSyncing = false;
  updateTrayStatus('completed');
  showNotification(
    'Sync Completed',
    summary || 'Data synchronization completed successfully.',
    'success'
  );
});

ipcMain.on('sync-error', (event, error) => {
  isSyncing = false;
  updateTrayStatus('error');
  showNotification(
    'Sync Error',
    error || 'An error occurred during synchronization.',
    'error'
  );
});

ipcMain.on('show-notification', (event, title, body) => {
  showNotification(title, body);
});

// ── Open Excel file ─────────────────────────────────────────────────────────
const { shell } = require('electron');
const os = require('os');

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Select Export Folder',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths.length) return { cancelled: true };
  return { cancelled: false, folderPath: result.filePaths[0] };
});

ipcMain.handle('save-file-to-folder', async (_event, { buffer, folderPath, filename }) => {
  try {
    fs.mkdirSync(folderPath, { recursive: true });
    const filePath = path.join(folderPath, filename);
    fs.writeFileSync(filePath, Buffer.from(buffer));
    return { success: true, filePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('open-excel', async (_event, { buffer, filename }) => {
  try {
    const tmpPath = path.join(os.tmpdir(), filename);
    fs.writeFileSync(tmpPath, Buffer.from(buffer));
    await shell.openPath(tmpPath);
    return { success: true };
  } catch (err) {
    console.error('[open-excel] Error:', err.message);
    return { success: false, error: err.message };
  }
});

// ── POS receipt printing ───────────────────────────────────────────────────
// Renders the receipt HTML in a hidden window and prints it with an 80mm
// page size (microns), so thermal roll printers get the right width. The
// renderer's iframe + window.print() path shows Electron's dialog but sends
// an empty job, hence this dedicated handler.
// silent=true prints straight to the default (or named) printer — no dialog.
ipcMain.handle('pos:print-receipt', async (_event, { html, silent, deviceName }) => {
  return new Promise((resolve) => {
    let win = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, javascript: false },
    });
    const done = (success, failureReason) => {
      try { if (win && !win.isDestroyed()) win.destroy(); } catch { /* already gone */ }
      win = null;
      resolve({ success: !!success, failureReason: failureReason || '' });
    };
    win.webContents.once('did-finish-load', () => {
      win.webContents.print({
        silent: !!silent,
        printBackground: true,
        margins: { marginType: 'none' },
        pageSize: { width: 80000, height: 297000 }, // 80mm roll (microns)
        ...(deviceName ? { deviceName } : {}),
      }, (success, failureReason) => done(success, failureReason));
    });
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(String(html)))
      .catch((err) => done(false, err && err.message));
  });
});

// ── Screen Recording ───────────────────────────────────────────────────────
ipcMain.handle('get-screen-sources', async () => {
  const { desktopCapturer } = require('electron');
  const sources = await desktopCapturer.getSources({
    types: ['window', 'screen'],
    thumbnailSize: { width: 160, height: 100 },
  });
  return sources.map(s => ({
    id: s.id,
    name: s.name,
    thumbnail: s.thumbnail.toDataURL(),
  }));
});

// ── Training: recordings library ───────────────────────────────────────────
function getRecordingsDir() {
  const dir = path.join(app.getPath('userData'), 'recordings');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function readManifest(dir) {
  const p = path.join(dir, 'manifest.json');
  if (!fs.existsSync(p)) return [];
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return []; }
}
function writeManifest(dir, data) {
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(data, null, 2));
}

ipcMain.handle('save-recording', async (_event, { buffer, metadata }) => {
  try {
    const dir = getRecordingsDir();
    const { filePath } = await dialog.showSaveDialog({
      title: 'Save Screen Recording',
      defaultPath: path.join(dir, metadata.defaultName || 'recording.webm'),
      filters: [{ name: 'WebM Video', extensions: ['webm'] }],
    });
    if (!filePath) return { success: false, cancelled: true };
    fs.writeFileSync(filePath, Buffer.from(buffer));
    const stats = fs.statSync(filePath);
    const manifest = readManifest(dir);
    manifest.unshift({
      id: Date.now().toString(),
      title:       metadata.title       || path.basename(filePath, '.webm'),
      description: metadata.description || '',
      category:    metadata.category    || 'General',
      filePath,
      fileName:    path.basename(filePath),
      duration:    metadata.duration    || 0,
      fileSize:    stats.size,
      createdAt:   new Date().toISOString(),
      createdBy:   metadata.createdBy   || '',
    });
    writeManifest(dir, manifest);
    return { success: true, filePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('list-recordings', async () => {
  const dir = getRecordingsDir();
  const manifest = readManifest(dir).filter(r => {
    try { return fs.existsSync(r.filePath); } catch { return false; }
  });
  return manifest;
});

ipcMain.handle('delete-recording', async (_event, { id, filePath }) => {
  try {
    const dir = getRecordingsDir();
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    writeManifest(dir, readManifest(dir).filter(r => r.id !== id));
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('open-recordings-folder', async () => {
  await shell.openPath(getRecordingsDir());
});

ipcMain.handle('get-file-url', (_event, filePath) => {
  return 'file://' + filePath.split(path.sep).join('/');
});

// ── ERP session storage (plain JSON file — bypasses Chromium quota DB issues) ──
const ERP_SESSION_FILE = path.join(app.getPath('userData'), 'erp-session.json');

ipcMain.handle('save-erp-session', (_event, { user, token }) => {
  try {
    fs.writeFileSync(ERP_SESSION_FILE, JSON.stringify({ user, token }), 'utf8');
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('get-erp-session', () => {
  try {
    if (!fs.existsSync(ERP_SESSION_FILE)) return null;
    return JSON.parse(fs.readFileSync(ERP_SESSION_FILE, 'utf8'));
  } catch (e) {
    return null;
  }
});

ipcMain.handle('clear-erp-session', () => {
  try {
    if (fs.existsSync(ERP_SESSION_FILE)) fs.unlinkSync(ERP_SESSION_FILE);
    return { success: true };
  } catch (e) {
    return { success: false };
  }
});

// ── Oracle Fusion credential storage (OS-level encryption via safeStorage) ──
const CREDS_FILE = path.join(app.getPath('userData'), 'fusion-creds.json');

ipcMain.handle('save-fusion-credentials', (_event, { username, password }) => {
  try {
    let storedPassword, encrypted;
    if (safeStorage.isEncryptionAvailable()) {
      storedPassword = safeStorage.encryptString(password).toString('base64');
      encrypted = true;
    } else {
      // Fallback: base64 only (no OS keychain available)
      storedPassword = Buffer.from(password).toString('base64');
      encrypted = false;
    }
    fs.writeFileSync(CREDS_FILE, JSON.stringify({ username, password: storedPassword, encrypted }), 'utf8');
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('get-fusion-credentials', () => {
  try {
    if (!fs.existsSync(CREDS_FILE)) return null;
    const data = JSON.parse(fs.readFileSync(CREDS_FILE, 'utf8'));
    let password;
    if (data.encrypted && safeStorage.isEncryptionAvailable()) {
      password = safeStorage.decryptString(Buffer.from(data.password, 'base64'));
    } else {
      password = Buffer.from(data.password, 'base64').toString();
    }
    return { username: data.username, password };
  } catch (e) {
    return null;
  }
});

ipcMain.handle('clear-fusion-credentials', () => {
  try {
    if (fs.existsSync(CREDS_FILE)) fs.unlinkSync(CREDS_FILE);
    return { success: true };
  } catch (e) {
    return { success: false };
  }
});

// ── LibreChat IPC Handlers (start/stop local LibreChat via Docker) ─────────
const libreChat = require('./librechat-manager.cjs');

ipcMain.handle('librechat:status', async () => {
  try { return { success: true, ...(await libreChat.getStatus()) }; }
  catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('librechat:start', async (_event, opts) => {
  try { return await libreChat.start(opts || {}); }
  catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('librechat:stop', async () => {
  try { return await libreChat.stop(); }
  catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('librechat:open-window', async () => {
  try { return libreChat.openWindow(); }
  catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('librechat:get-logs', async () => {
  try { return { success: true, logs: libreChat.getLogs() }; }
  catch (e) { return { success: false, error: e.message }; }
});

// ── Claude Code CLI (embedded terminal) ────────────────────────────────────
const claudeCli = require('./claude-cli-manager.cjs');

ipcMain.handle('claude-cli:status', async () => {
  try { return { success: true, ...claudeCli.getStatus() }; }
  catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('claude-cli:start', async (event, opts) => {
  try { return claudeCli.start(event.sender, opts || {}); }
  catch (e) { return { success: false, error: e.message }; }
});
ipcMain.on('claude-cli:input', (_event, data) => { try { claudeCli.input(data); } catch { /* ignore */ } });
ipcMain.on('claude-cli:resize', (_event, { cols, rows } = {}) => { try { claudeCli.resize(cols, rows); } catch { /* ignore */ } });
ipcMain.handle('claude-cli:stop', async () => {
  try { return claudeCli.stop(); }
  catch (e) { return { success: false, error: e.message }; }
});

// ── MCP bridge for the in-app AI Assistant ─────────────────────────────────
const mcpBridge = require('./mcp-bridge.cjs');

ipcMain.handle('mcp-bridge:list-tools', async () => {
  try { return { success: true, ...(await mcpBridge.listTools()) }; }
  catch (e) { return { success: false, error: e.message, servers: [] }; }
});

ipcMain.handle('mcp-bridge:call-tool', async (_event, { server, tool, args } = {}) => {
  try { return { success: true, ...(await mcpBridge.callTool(server, tool, args)) }; }
  catch (e) { return { success: false, error: e.message }; }
});

// ── GL MCP Server IPC Handlers ─────────────────────────────────────────────
const GL_CREDS_FILE = path.join(app.getPath('userData'), 'gl-api-creds.json');

// Extract just the protocol + host from whatever the user pasted — they often
// paste a full endpoint URL (with /ords/... path and query params) into the
// Base URL field, which would otherwise produce a garbled endpoint.
function extractOracleDomain(urlStr) {
  try {
    const u = new URL(urlStr);
    return `${u.protocol}//${u.host}`;
  } catch (e) {
    const match = String(urlStr || '').match(/^https?:\/\/[^/]+/);
    return match ? match[0] : urlStr;
  }
}

async function fetchClaudeKeyFromOracleAPEX(oracleBaseUrl) {
  try {
    if (!oracleBaseUrl) {
      console.warn('[GL MCP] No Oracle base URL provided for Claude key fetch');
      return null;
    }

    const domain = extractOracleDomain(oracleBaseUrl);
    const endpoint = `${domain}/ords/bcldifc/reerp/settings/claudekey`;
    console.log('[GL MCP] Fetching Claude key from:', endpoint);

    const response = await fetch(endpoint, { headers: { ...(await require('./ords-token.cjs').getOrdsAuthHeader()) } });
    if (!response.ok) {
      console.warn('[GL MCP] Failed to fetch Claude key, status:', response.status);
      return null;
    }

    const data = await response.json();
    // rr_claude_key.sql returns { "status": "success", "apiKey": "sk-ant-..." }
    const key = data.apiKey || data.claudeKey || data.key;
    if (key) {
      console.log('[GL MCP] Successfully fetched Claude key from Oracle APEX');
      return key;
    } else {
      console.warn('[GL MCP] No Claude key in response:', Object.keys(data));
      return null;
    }
  } catch (err) {
    console.error('[GL MCP] Error fetching Claude key from Oracle APEX:', err.message);
    return null;
  }
}

ipcMain.handle('gl-mcp:save-credentials', async (_event, { oracleBaseUrl, username, password, skipAuth, httpPort }) => {
  try {
    // Clean a pasted full endpoint URL down to just the domain
    oracleBaseUrl = oracleBaseUrl ? extractOracleDomain(oracleBaseUrl.trim()) : oracleBaseUrl;
    let storedPassword, encrypted;
    if (!skipAuth && password) {
      if (safeStorage.isEncryptionAvailable()) {
        storedPassword = safeStorage.encryptString(password).toString('base64');
        encrypted = true;
      } else {
        storedPassword = Buffer.from(password).toString('base64');
        encrypted = false;
      }
    } else {
      storedPassword = '';
      encrypted = true;
    }

    // Fetch Claude key from Oracle APEX
    let claudeKey = null;
    if (oracleBaseUrl) {
      claudeKey = await fetchClaudeKeyFromOracleAPEX(oracleBaseUrl);
    }

    let storedClaudeKey = '';
    let claudeKeyEncrypted = true;
    if (claudeKey) {
      if (safeStorage.isEncryptionAvailable()) {
        storedClaudeKey = safeStorage.encryptString(claudeKey).toString('base64');
        claudeKeyEncrypted = true;
      } else {
        storedClaudeKey = Buffer.from(claudeKey).toString('base64');
        claudeKeyEncrypted = false;
      }
    }

    const creds = {
      oracleBaseUrl,
      username: skipAuth ? '' : (username || ''),
      password: storedPassword,
      skipAuth: skipAuth || false,
      httpPort: httpPort || 3001,
      encrypted,
      claudeKey: storedClaudeKey,
      claudeKeyEncrypted,
    };
    fs.writeFileSync(GL_CREDS_FILE, JSON.stringify(creds, null, 2), 'utf8');
    console.log(`[GL MCP] Credentials saved: skipAuth=${creds.skipAuth}, httpPort=${creds.httpPort}, hasClaudeKey=${!!claudeKey}`);
    return { success: true, claudeKeyFetched: !!claudeKey };
  } catch (e) {
    console.error('[GL MCP] Failed to save credentials:', e.message);
    return { success: false, error: e.message };
  }
});

ipcMain.handle('gl-mcp:get-credentials', () => {
  try {
    if (!fs.existsSync(GL_CREDS_FILE)) return null;
    const data = JSON.parse(fs.readFileSync(GL_CREDS_FILE, 'utf8'));
    let password = '';
    if (data.password) {
      if (data.encrypted && safeStorage.isEncryptionAvailable()) {
        password = safeStorage.decryptString(Buffer.from(data.password, 'base64'));
      } else if (data.password) {
        password = Buffer.from(data.password, 'base64').toString();
      }
    }

    let claudeKey = '';
    if (data.claudeKey) {
      if (data.claudeKeyEncrypted && safeStorage.isEncryptionAvailable()) {
        claudeKey = safeStorage.decryptString(Buffer.from(data.claudeKey, 'base64'));
      } else if (data.claudeKey) {
        claudeKey = Buffer.from(data.claudeKey, 'base64').toString();
      }
    }

    return {
      oracleBaseUrl: data.oracleBaseUrl,
      username: data.username || '',
      password,
      skipAuth: data.skipAuth || false,
      httpPort: data.httpPort || 3001,
      claudeApiKey: claudeKey,
    };
  } catch (e) {
    console.error('[GL MCP] Error reading credentials:', e.message);
    return null;
  }
});

ipcMain.handle('gl-mcp:fetch-claude-key', async (_event, { oracleBaseUrl } = {}) => {
  try {
    console.log('[GL MCP] Manually fetching Claude key from Oracle APEX');
    const claudeKey = await fetchClaudeKeyFromOracleAPEX(oracleBaseUrl);

    if (claudeKey) {
      // Save to credentials file
      if (fs.existsSync(GL_CREDS_FILE)) {
        const data = JSON.parse(fs.readFileSync(GL_CREDS_FILE, 'utf8'));

        let storedClaudeKey = '';
        if (safeStorage.isEncryptionAvailable()) {
          storedClaudeKey = safeStorage.encryptString(claudeKey).toString('base64');
          data.claudeKeyEncrypted = true;
        } else {
          storedClaudeKey = Buffer.from(claudeKey).toString('base64');
          data.claudeKeyEncrypted = false;
        }

        data.claudeKey = storedClaudeKey;
        fs.writeFileSync(GL_CREDS_FILE, JSON.stringify(data, null, 2), 'utf8');
      }

      return {
        success: true,
        message: 'Claude key fetched and saved successfully',
        claudeKey,
      };
    } else {
      return {
        success: false,
        error: 'Failed to fetch Claude key from Oracle APEX endpoint'
      };
    }
  } catch (err) {
    console.error('[GL MCP] Error fetching Claude key:', err.message);
    return {
      success: false,
      error: err.message
    };
  }
});

ipcMain.handle('gl-mcp:start', async (_event, credentials) => {
  try {
    const success = startGLMcpServer(credentials);
    if (success) {
      return { success: true, status: getGLMcpServerStatus() };
    } else {
      return { success: false, error: 'Failed to start GL MCP Server' };
    }
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('gl-mcp:stop', async () => {
  try {
    const stopped = stopGLMcpServer();
    return { success: stopped, status: getGLMcpServerStatus() };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('gl-mcp:status', async () => {
  try {
    return { success: true, status: getGLMcpServerStatus() };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('gl-mcp:get-logs', async () => {
  try {
    return { success: true, logs: glMcpLogs };
  } catch (e) {
    return { success: false, error: e.message, logs: [] };
  }
});

function getClaudeDesktopConfigPath() {
  const platform = process.platform;
  let configDir;

  if (platform === 'darwin') {
    configDir = path.join(process.env.HOME, 'Library', 'Application Support', 'Claude');
  } else if (platform === 'win32') {
    configDir = path.join(process.env.APPDATA, 'Claude');
  } else {
    configDir = path.join(process.env.HOME, '.config', 'Claude');
  }

  return path.join(configDir, 'claude_desktop_config.json');
}

ipcMain.handle('gl-mcp:add-to-claude-desktop', async (_event, { httpPort = 3001 } = {}) => {
  console.log('[GL MCP] add-to-claude-desktop handler called with httpPort:', httpPort);

  try {
    const configPath = getClaudeDesktopConfigPath();
    console.log('[GL MCP] Claude Desktop config path:', configPath);

    const configDir = path.dirname(configPath);
    console.log('[GL MCP] Config directory:', configDir);

    let config = {};
    if (fs.existsSync(configPath)) {
      console.log('[GL MCP] Config file exists, reading...');
      const content = fs.readFileSync(configPath, 'utf8');
      config = JSON.parse(content);
      console.log('[GL MCP] Existing config mcpServers:', Object.keys(config.mcpServers || {}));
    } else {
      console.log('[GL MCP] Config file does not exist, creating new');
    }

    if (!config.mcpServers) {
      config.mcpServers = {};
      console.log('[GL MCP] Created mcpServers object');
    }

    // Spawn the GL MCP server directly in stdio mode — no HTTP port, no TLS,
    // no wrapper, and the Electron app does not need to be running.
    const serverPath = path.join(__dirname, 'gl-mcp-server.cjs');
    console.log('[GL MCP] Server script path:', serverPath);

    // Pass Oracle connection settings from the saved credentials file
    const mcpEnv = {};
    try {
      if (fs.existsSync(GL_CREDS_FILE)) {
        const data = JSON.parse(fs.readFileSync(GL_CREDS_FILE, 'utf8'));
        if (data.oracleBaseUrl) mcpEnv.ORACLE_BASE_URL = data.oracleBaseUrl;
        mcpEnv.SKIP_AUTH = data.skipAuth ? 'true' : 'false';
        if (!data.skipAuth && data.username) {
          mcpEnv.ORACLE_USERNAME = data.username;
          if (data.password) {
            mcpEnv.ORACLE_PASSWORD = data.encrypted && safeStorage.isEncryptionAvailable()
              ? safeStorage.decryptString(Buffer.from(data.password, 'base64'))
              : Buffer.from(data.password, 'base64').toString();
          }
        }
      }
    } catch (e) {
      console.warn('[GL MCP] Could not read saved credentials for Claude Desktop config:', e.message);
    }

    // ORDS OAuth2 token env — keeps the server working once REERP is protected
    if (process.env.ORDS_USE_TOKEN)     mcpEnv.ORDS_USE_TOKEN     = process.env.ORDS_USE_TOKEN;
    if (process.env.ORDS_CLIENT_ID)     mcpEnv.ORDS_CLIENT_ID     = process.env.ORDS_CLIENT_ID;
    if (process.env.ORDS_CLIENT_SECRET) mcpEnv.ORDS_CLIENT_SECRET = process.env.ORDS_CLIENT_SECRET;

    const mcpConfig = {
      command: 'node',
      args: [serverPath, '--stdio'],
      env: mcpEnv
    };

    console.log('[GL MCP] MCP Server config:', JSON.stringify(mcpConfig, null, 2));
    config.mcpServers['gl-server'] = mcpConfig;

    if (!fs.existsSync(configDir)) {
      console.log('[GL MCP] Creating config directory:', configDir);
      fs.mkdirSync(configDir, { recursive: true });
    }

    console.log('[GL MCP] Writing config to:', configPath);
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    console.log('[GL MCP] Successfully wrote config file');
    console.log('[GL MCP] New config mcpServers:', Object.keys(config.mcpServers));

    return {
      success: true,
      message: `GL server added to Claude Desktop config at ${configPath}`,
      configPath,
      mcpConfig
    };
  } catch (e) {
    console.error('[GL MCP] Failed to add GL server to Claude Desktop config:', e.message);
    console.error('[GL MCP] Stack trace:', e.stack);
    return {
      success: false,
      error: e.message,
      stack: e.stack
    };
  }
});

// ── MCP Registry server → Claude Desktop config ─────────────────────────────
// Merges an 'mcp-registry' entry into claude_desktop_config.json, preserving
// every other server (gl-server included).
ipcMain.handle('mcp-registry:add-to-claude-desktop', async (_event, { fusionUsername, fusionPassword } = {}) => {
  try {
    const configPath = getClaudeDesktopConfigPath();
    const configDir = path.dirname(configPath);

    let config = {};
    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
    if (!config.mcpServers) config.mcpServers = {};

    // Independent per-domain servers (standalone, like gl-server — easy to
    // track which is running in Claude Desktop's Developer panel).
    const env = {};
    if (fusionUsername) env.FUSION_USERNAME = fusionUsername;
    if (fusionPassword) env.FUSION_PASSWORD = fusionPassword;
    // ORDS OAuth2 token env — passed through so Claude Desktop-spawned servers
    // keep working once the REERP module is token-protected.
    if (process.env.ORDS_USE_TOKEN)     env.ORDS_USE_TOKEN     = process.env.ORDS_USE_TOKEN;
    if (process.env.ORDS_CLIENT_ID)     env.ORDS_CLIENT_ID     = process.env.ORDS_CLIENT_ID;
    if (process.env.ORDS_CLIENT_SECRET) env.ORDS_CLIENT_SECRET = process.env.ORDS_CLIENT_SECRET;

    // Clean up entries from earlier iterations of this feature
    delete config.mcpServers['mcp-registry'];
    delete config.mcpServers['erp-tools'];

    config.mcpServers['ar-server'] = {
      command: 'node',
      args: [path.join(__dirname, 'ar-mcp-server.cjs'), '--stdio'],
      env,
    };
    config.mcpServers['ar-customer-balance'] = {
      command: 'node',
      args: [path.join(__dirname, 'ar-customer-balance-server.cjs'), '--stdio'],
      env,
    };
    config.mcpServers['inv-onhand-server'] = {
      command: 'node',
      args: [path.join(__dirname, 'inv-onhand-server.cjs'), '--stdio'],
      env,
    };
    // Conversation/document archive + call-log destination (Level 1 + 2 recording)
    config.mcpServers['archive-server'] = {
      command: 'node',
      args: [path.join(__dirname, 'archive-server.cjs'), '--stdio'],
      env: {},
    };

    if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    console.log('[MCP Registry] Added mcp-registry to Claude Desktop config at', configPath);

    return { success: true, configPath, servers: Object.keys(config.mcpServers) };
  } catch (e) {
    console.error('[MCP Registry] Failed to update Claude Desktop config:', e.message);
    return { success: false, error: e.message };
  }
});

// ── Kill Claude Desktop ─────────────────────────────────────────────────────
// Force-quits the Claude Desktop client so it reloads claude_desktop_config.json
// on next launch. Windows: taskkill /F /IM claude.exe; macOS/Linux: pkill.
ipcMain.handle('mcp-registry:kill-claude-desktop', async () => {
  const { exec } = require('child_process');
  const run = (cmd) => new Promise((resolve) => {
    exec(cmd, (error, stdout, stderr) => resolve({ error, stdout: stdout || '', stderr: stderr || '' }));
  });

  if (process.platform === 'win32') {
    // Image name can vary by install (claude.exe, Claude.exe, "Claude Desktop.exe").
    // /T kills the whole Electron process tree; wildcard catches name variants.
    const attempts = [
      'taskkill /F /T /IM claude.exe',
      'taskkill /F /T /IM "Claude Desktop.exe"',
      'taskkill /F /T /IM claude*',
    ];
    let killed = false;
    let lastMsg = '';
    for (const cmd of attempts) {
      const r = await run(cmd);
      const out = `${r.stdout} ${r.stderr}`.trim();
      if (!r.error || /SUCCESS/i.test(out)) {
        killed = true;
        console.log('[MCP Registry] Kill succeeded via:', cmd, '—', out);
      }
      lastMsg = out || (r.error ? r.error.message : '');
    }
    // Report what claude processes remain (empty = all gone)
    const check = await run('tasklist /FI "IMAGENAME eq claude.exe" /FO CSV /NH');
    const stillRunning = /claude/i.test(check.stdout);
    if (killed && !stillRunning) {
      return { success: true, notRunning: false, message: 'Claude Desktop terminated' };
    }
    if (!killed && /not found|no tasks/i.test(lastMsg)) {
      return { success: true, notRunning: true, message: 'Claude Desktop was not running' };
    }
    return {
      success: killed,
      notRunning: false,
      message: killed ? 'Kill sent, but a claude process may remain — check Task Manager' : lastMsg,
    };
  }

  // macOS / Linux
  const r = await run('pkill -f "Claude"');
  if (!r.error) return { success: true, notRunning: false, message: 'Claude Desktop terminated' };
  return { success: true, notRunning: true, message: 'Claude Desktop was not running' };
});

// ── Start Claude Desktop ────────────────────────────────────────────────────
ipcMain.handle('mcp-registry:start-claude-desktop', async () => {
  try {
    if (process.platform === 'win32') {
      const localAppData = process.env.LOCALAPPDATA || '';
      const candidates = [
        path.join(localAppData, 'AnthropicClaude', 'claude.exe'),
        path.join(localAppData, 'AnthropicClaude', 'Claude.exe'),
        path.join(localAppData, 'Programs', 'Claude', 'Claude.exe'),
        path.join(localAppData, 'Programs', 'claude-desktop', 'Claude.exe'),
      ];
      const exe = candidates.find((p) => fs.existsSync(p));
      if (exe) {
        const child = spawn(exe, [], { detached: true, stdio: 'ignore' });
        child.unref();
        console.log('[MCP Registry] Started Claude Desktop:', exe);
        return { success: true, message: `Claude Desktop starting (${exe})` };
      }
      // Fall back to the claude:// protocol handler registered by the installer
      const { exec } = require('child_process');
      return await new Promise((resolve) => {
        exec('start "" "claude://"', (error) => {
          if (error) {
            resolve({ success: false, message: 'Claude Desktop executable not found. Checked: ' + candidates.join(' ; ') });
          } else {
            resolve({ success: true, message: 'Claude Desktop starting (via claude:// protocol)' });
          }
        });
      });
    }
    if (process.platform === 'darwin') {
      const { exec } = require('child_process');
      return await new Promise((resolve) => {
        exec('open -a "Claude"', (error) => resolve(
          error ? { success: false, message: error.message }
                : { success: true, message: 'Claude Desktop starting' }));
      });
    }
    return { success: false, message: 'Unsupported platform: ' + process.platform };
  } catch (e) {
    return { success: false, message: e.message };
  }
});

// ── GL MCP Chat with Claude API ─────────────────────────────────────────────
ipcMain.handle('gl-mcp:chat', async (_event, { message, glData, apiKey } = {}) => {
  try {
    if (!apiKey) {
      return {
        success: false,
        error: 'Claude API key not configured'
      };
    }

    console.log('[GL MCP Chat] Processing message:', message.substring(0, 50) + '...');

    // Build context for Claude
    const systemPrompt = `You are an AI assistant specialized in analyzing General Ledger (GL) data from Oracle applications.
Your role is to help users understand their GL transactions, accounts, and financial data.

Current GL Context:
- Query Parameters: ${JSON.stringify(glData.queryParams)}
- Total Records: ${glData.totalRecords}
- Summary: ${glData.summary ? `Total Debit: AED ${glData.summary.totalDebit.toFixed(2)}, Transaction Count: ${glData.summary.count}` : 'No data queried'}
${glData.recentTransactions && glData.recentTransactions.length > 0 ? `\nRecent Transactions:\n${glData.recentTransactions.map(t => `- Batch: ${t.batch}, JE: ${t.jeHeader}, Date: ${t.date}, Amount: AED ${t.amount.toFixed(2)}`).join('\n')}` : ''}

Provide clear, concise analysis focused on the GL data context.`;

    // Call Claude API
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-5',
        max_tokens: 4096,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: message,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error('[GL MCP Chat] API Error:', response.status, errorData);
      return {
        success: false,
        error: `Claude API error: ${response.status} - ${errorData.substring(0, 100)}`
      };
    }

    const data = await response.json();
    console.log('[GL MCP Chat] Claude response received');

    // content is an array of blocks (thinking, text, ...) — collect the text
    // blocks; content[0] may be a thinking block with no .text field.
    const responseText = (data.content || [])
      .filter((b) => b.type === 'text' && b.text)
      .map((b) => b.text)
      .join('\n');

    if (responseText) {
      return {
        success: true,
        response: responseText,
      };
    } else {
      return {
        success: false,
        error: 'No text response from Claude API (stop_reason: ' + (data.stop_reason || 'unknown') + ')'
      };
    }
  } catch (err) {
    console.error('[GL MCP Chat] Error:', err.message);
    return {
      success: false,
      error: err.message
    };
  }
});

// ── Native Oracle Fusion login ──────────────────────────────────────────────
// Opens the real Oracle Cloud (IDCS) sign-in in a child window. The user
// authenticates natively; when the browser lands back on the Fusion app domain
// (…fa.ocs.oraclecloud.com) login has succeeded. The username the user typed on
// the IDCS page is captured and returned to the renderer.
ipcMain.handle('fusion-login', async (_event, { url } = {}) => {
  const { BrowserWindow } = require('electron');
  const loginUrl = url || 'https://iacney-test.fa.ocs.oraclecloud.com/';
  return await new Promise((resolve) => {
    let capturedUser = null;
    let settled = false;
    const win = new BrowserWindow({
      width: 520,
      height: 720,
      parent: mainWindow,
      modal: true,
      show: true,
      title: 'Sign in to Oracle Fusion',
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        partition: 'persist:fusion',   // keep the Fusion session between logins
      },
    });

    const finish = (result) => {
      if (settled) return;
      settled = true;
      try { if (!win.isDestroyed()) win.close(); } catch (_) { /* ignore */ }
      resolve(result);
    };

    // Capture the username typed on the IDCS sign-in page (via console channel).
    win.webContents.on('did-finish-load', () => {
      win.webContents.executeJavaScript(`(function(){
        function grab(){
          var e = document.querySelector('input[name="username"], #idcs-signin-basic-signin-form-username, input[type="email"], input[type="text"]');
          if (e && e.value) { console.log('FUSION_USER:' + e.value); }
        }
        document.addEventListener('input', grab, true);
        document.addEventListener('click', grab, true);
        document.addEventListener('keyup', grab, true);
      })();`).catch(() => {});
    });
    win.webContents.on('console-message', (_e, _level, message) => {
      if (typeof message === 'string' && message.indexOf('FUSION_USER:') === 0) {
        capturedUser = message.slice('FUSION_USER:'.length).trim();
      }
    });

    // Success = navigation settled on the Fusion app domain (not the IDCS
    // identity domain). The initial redirect to IDCS settles on identity.* so
    // it does not count; SSO that lands straight on fa.ocs also counts.
    win.webContents.on('did-stop-loading', () => {
      if (settled) return;
      let u = '';
      try { u = win.webContents.getURL(); } catch (_) { return; }
      if (/identity\.oraclecloud\.com/i.test(u)) return;          // still on IDCS sign-in
      if (/\.fa\.ocs\.oraclecloud\.com/i.test(u)) {
        finish({ success: true, username: capturedUser });
      }
    });

    win.on('closed', () => finish({ success: false, cancelled: true }));
    win.loadURL(loginUrl).catch(() => finish({ success: false, error: 'Failed to open Oracle sign-in' }));
  });
});

// ── Auto-update ────────────────────────────────────────────────────────────
function setupAutoUpdater() {
  // Only run in production with autoUpdater available
  if (!app.isPackaged || !autoUpdater) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    console.log('Checking for updates...');
  });

  autoUpdater.on('update-available', (info) => {
    console.log('Update available:', info.version);
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update Available',
      message: `Version ${info.version} is available.`,
      detail: 'Downloading update in the background. You will be notified when it is ready to install.',
      buttons: ['OK'],
    });
  });

  autoUpdater.on('update-not-available', () => {
    console.log('App is up to date.');
  });

  autoUpdater.on('download-progress', (progress) => {
    const percent = Math.round(progress.percent);
    console.log(`Downloading update: ${percent}%`);
    if (mainWindow) {
      mainWindow.setProgressBar(progress.percent / 100);
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('Update downloaded:', info.version);
    if (mainWindow) mainWindow.setProgressBar(-1);

    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update Ready',
      message: `Version ${info.version} has been downloaded.`,
      detail: 'Restart the app now to apply the update, or it will be applied on next launch.',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
    }).then(({ response }) => {
      if (response === 0) {
        autoUpdater.quitAndInstall();
      }
    });
  });

  autoUpdater.on('error', (err) => {
    console.error('Auto-updater error:', err.message);
  });

  // Check for updates after app starts (disabled — was slowing startup due to background auto-download)
  // setTimeout(() => {
  //   autoUpdater.checkForUpdates();
  // }, 5000);

  // Check again every 4 hours (disabled)
  // setInterval(() => {
  //   autoUpdater.checkForUpdates();
  // }, 4 * 60 * 60 * 1000);
}

// App lifecycle
app.whenReady().then(() => {
  // Start proxy and show window immediately — tray + updater deferred to after load
  startProxyServer();
  createWindow();

  // Defer non-critical startup to after window is painted (keeps open time fast)
  mainWindow.webContents.once('did-finish-load', () => {
    createTray();
    // setupAutoUpdater(); // Disabled: auto-update check was slowing down startup (auto-downloads in background)
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      mainWindow.show();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  stopProxyServer();
  stopGLMcpServer();
});

// Handle certificate errors in development
app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  // In development, ignore certificate errors
  if (!app.isPackaged) {
    event.preventDefault();
    callback(true);
  } else {
    callback(false);
  }
});

// ── Claude AI Agent ────────────────────────────────────────────────────────
const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
let _claudeKeyCache = null;
let _claudeKeyCacheAt = 0;
const CLAUDE_KEY_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getClaudeKey() {
  if (_claudeKeyCache && (Date.now() - _claudeKeyCacheAt) < CLAUDE_KEY_CACHE_TTL) {
    return _claudeKeyCache;
  }
  const res  = await fetch(`${APEX_BASE}/settings/claudekey`, { headers: { ...(await require('./ords-token.cjs').getOrdsAuthHeader()) } });
  const text = await res.text();

  // If APEX returned an HTML page the endpoint is not deployed yet
  if (text.trimStart().startsWith('<')) {
    throw new Error(
      `APEX endpoint not found (HTTP ${res.status}). ` +
      'Please run database/cash/rr_claude_key.sql in Oracle APEX SQL Workshop, ' +
      'then go to Administration → Claude AI Key Settings to add your key.'
    );
  }

  let data;
  try { data = JSON.parse(text); } catch {
    throw new Error('Unexpected response from /settings/claudekey: ' + text.substring(0, 120));
  }

  if (data.status === 'success' && data.apiKey) {
    _claudeKeyCache = data.apiKey.trim();
    _claudeKeyCacheAt = Date.now();
    return _claudeKeyCache;
  }
  throw new Error(
    data.message ||
    'No active Claude API key found. Go to Administration → Claude AI Key Settings to add your key.'
  );
}

ipcMain.handle('claude:test-key', async () => {
  try {
    const apiKey = await getClaudeKey();
    const res = await fetch(CLAUDE_API_URL, {
      method: 'POST',
      headers: {
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 32,
        messages:   [{ role: 'user', content: 'Reply with exactly: OK' }],
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      return { success: false, error: `Claude API ${res.status}: ${err.substring(0, 200)}` };
    }
    const data = await res.json();
    const reply = data.content?.[0]?.text?.trim() ?? '(empty)';
    return { success: true, reply };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('claude:recon-agent', async (_event, { stmtLines, sysTxns, bankAccount }) => {
  try {
    const apiKey = await getClaudeKey();

    const systemPrompt = `You are a bank reconciliation assistant for an Oracle ERP system.
Your job is to match unreconciled bank statement lines with unreconciled system transactions.

Matching rules:
- Amount must match exactly or within 0.01 rounding difference
- Date can be up to 3 days apart (bank processing lag is normal)
- Reference/description similarity increases confidence but is not required
- Each statement line matches at most one system transaction (and vice versa)

Confidence scoring:
- 95-100: Exact amount + date within 1 day + reference matches
- 80-94:  Exact amount + date within 3 days
- 65-79:  Exact amount + date more than 3 days apart
- Below 65: Do not include — too uncertain

Return ONLY valid JSON, no explanation outside the JSON:
{
  "matches": [
    {
      "stmtLineId": <number>,
      "stmtAmount": <number>,
      "stmtDate": "<YYYY-MM-DD>",
      "stmtRef": "<string>",
      "txnId": <number>,
      "txnSource": "<string>",
      "txnNumber": "<string>",
      "txnAmount": <number>,
      "txnDate": "<YYYY-MM-DD>",
      "txnRef": "<string>",
      "confidence": <number>,
      "reason": "<one sentence>"
    }
  ],
  "unmatchedStmt": [<lineId>, ...],
  "unmatchedTxn": [<txnId>, ...],
  "summary": "<one sentence summary>"
}`;

    const userContent = `Bank Account: ${bankAccount || 'Unknown'}

BANK STATEMENT LINES (unreconciled, ${stmtLines.length} lines):
${JSON.stringify(stmtLines.map(l => ({
  lineId:      l.lineId,
  amount:      l.amount,
  date:        l.transactionDate,
  ref:         l.referenceNumber || l.transactionRef || l.reference || '',
  description: l.description || '',
})), null, 2)}

SYSTEM TRANSACTIONS (unreconciled, ${sysTxns.length} transactions):
${JSON.stringify(sysTxns.map(t => ({
  txnId:     t.txnId,
  txnNumber: t.txnNumber,
  source:    t.source,
  amount:    t.amount,
  date:      t.txnDate,
  ref:       t.reference || t.referenceText || '',
  payee:     t.payee || '',
})), null, 2)}

Find the best matches. Only include confident matches (65+).`;

    const claudeRes = await fetch(CLAUDE_API_URL, {
      method: 'POST',
      headers: {
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-6',
        max_tokens: 4096,
        system:     systemPrompt,
        messages:   [{ role: 'user', content: userContent }],
      }),
    });

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      throw new Error(`Claude API ${claudeRes.status}: ${errText}`);
    }

    const claudeData = await claudeRes.json();
    const text = claudeData.content?.[0]?.text ?? '';

    // Extract JSON block from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Claude returned no JSON. Response: ' + text.substring(0, 200));

    const parsed = JSON.parse(jsonMatch[0]);
    console.log(`[claude:recon-agent] Found ${parsed.matches?.length ?? 0} matches`);
    return { success: true, ...parsed };

  } catch (err) {
    console.error('[claude:recon-agent]', err.message);
    return { success: false, error: err.message };
  }
});

// ── RAG: Ingest file ─────────────────────────────────────────────────────────
ipcMain.handle('rag:ingest-file', async (_event, { buffer, filename, mimeType }) => {
  try {
    const buf = Buffer.from(buffer);
    const result = await rag.ingestFile(getUserDataPath(), buf, filename, mimeType);
    return { success: true, ...result };
  } catch (err) {
    console.error('[rag:ingest-file]', err.message);
    return { success: false, error: err.message };
  }
});

// ── RAG: List documents ──────────────────────────────────────────────────────
ipcMain.handle('rag:list-docs', async () => {
  try {
    return { success: true, docs: rag.listDocuments(getUserDataPath()) };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ── RAG: Delete document ─────────────────────────────────────────────────────
ipcMain.handle('rag:delete-doc', async (_event, { docId }) => {
  try {
    rag.deleteDocument(getUserDataPath(), docId);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ── RAG: Query (chat) ────────────────────────────────────────────────────────
ipcMain.handle('rag:query', async (_event, { question, mode, history }) => {
  try {
    const apiKey = await getClaudeKey();
    const result = await rag.ragQuery(getUserDataPath(), APEX_BASE, apiKey, { question, mode, history });
    return { success: true, ...result };
  } catch (err) {
    console.error('[rag:query]', err.message);
    return { success: false, error: err.message };
  }
});

// ─── Update Checker (IPC) ───────────────────────────────────────────────────────
ipcMain.handle('check-for-updates', async (_event, companyName) => {
  try {
    console.log('[Update] Checking for updates for company:', companyName);
    const result = await updateService.checkForUpdates(companyName);
    return { success: true, ...result };
  } catch (err) {
    console.error('[Update] Check failed:', err.message);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('download-and-install-update', async (_event, { downloadUrl, downloadName, customFolder }) => {
  try {
    console.log('[Update] Starting download...');

    // Use custom folder if provided, otherwise use temp directory
    const destDir = customFolder || app.getPath('temp');
    const destPath = path.join(destDir, downloadName || 'FusionClient-Update.exe');

    console.log('[Update] Destination:', destPath);

    // Download only
    await updateService.downloadFile(downloadUrl, destPath);
    console.log('[Update] Download complete:', destPath);

    return { success: true, message: `Update downloaded to:\n${destPath}` };
  } catch (err) {
    console.error('[Update] Download failed:', err.message);
    return { success: false, error: err.message };
  }
});
