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
    const res = await fetch(`${APEX_BASE}/config/emailsettings`);
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

let mainWindow;
let tray = null;
let isQuitting = false;
let isSyncing = false;
let proxyServer = null;

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
  const res  = await fetch(`${APEX_BASE}/settings/claudekey`);
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
ipcMain.handle('check-for-updates', async () => {
  try {
    console.log('[Update] Checking for updates...');
    const result = await updateService.checkForUpdates();
    return { success: true, ...result };
  } catch (err) {
    console.error('[Update] Check failed:', err.message);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('download-and-install-update', async (_event, { downloadUrl, downloadName }) => {
  try {
    console.log('[Update] Starting download and install...');
    const tempDir = app.getPath('temp');
    const destPath = path.join(tempDir, downloadName || 'FusionClient-Update.exe');

    // Download
    await updateService.downloadFile(downloadUrl, destPath);
    console.log('[Update] Download complete, installing...');

    // Install (replaces exe and restarts)
    await updateService.installUpdate(destPath);
    return { success: true, message: 'Update installed, restarting app...' };
  } catch (err) {
    console.error('[Update] Install failed:', err.message);
    return { success: false, error: err.message };
  }
});
