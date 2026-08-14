const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Sync status updates
  syncStarted: (syncType) => ipcRenderer.send('sync-started', syncType),
  syncProgress: (progress) => ipcRenderer.send('sync-progress', progress),
  syncCompleted: (summary) => ipcRenderer.send('sync-completed', summary),
  syncError: (error) => ipcRenderer.send('sync-error', error),

  // General notifications
  showNotification: (title, body) => ipcRenderer.send('show-notification', title, body),

  // Listen for commands from main process
  onStartSync: (callback) => ipcRenderer.on('start-sync', callback),
  onStopSync: (callback) => ipcRenderer.on('stop-sync', callback),

  // Remove listeners
  removeStartSyncListener: () => ipcRenderer.removeAllListeners('start-sync'),
  removeStopSyncListener: () => ipcRenderer.removeAllListeners('stop-sync'),

  // Send OTP email via nodemailer (main process)
  sendOtpEmail: (to, otp) =>
    ipcRenderer.invoke('send-otp-email', { to, otp }),

  // Open a file (e.g. Excel) with the OS default application
  openExcel: (buffer, filename) =>
    ipcRenderer.invoke('open-excel', { buffer, filename }),

  // Folder picker + save file directly to folder
  selectFolder: () =>
    ipcRenderer.invoke('select-folder'),
  saveFileToFolder: (buffer, folderPath, filename) =>
    ipcRenderer.invoke('save-file-to-folder', { buffer, folderPath, filename }),

  // Screen recording
  getScreenSources: () => ipcRenderer.invoke('get-screen-sources'),
  saveRecording: (buffer, metadata) => ipcRenderer.invoke('save-recording', { buffer, metadata }),

  // Training video library
  listRecordings: () => ipcRenderer.invoke('list-recordings'),
  deleteRecording: (id, filePath) => ipcRenderer.invoke('delete-recording', { id, filePath }),
  openRecordingsFolder: () => ipcRenderer.invoke('open-recordings-folder'),
  getFileUrl: (filePath) => ipcRenderer.invoke('get-file-url', filePath),

  // ERP session persistence (file-based — survives Chromium quota DB failures)
  saveErpSession: (user, token) => ipcRenderer.invoke('save-erp-session', { user, token }),
  getErpSession: () => ipcRenderer.invoke('get-erp-session'),
  clearErpSession: () => ipcRenderer.invoke('clear-erp-session'),

  // Oracle Fusion saved credentials
  saveFusionCredentials: (username, password) => ipcRenderer.invoke('save-fusion-credentials', { username, password }),
  getFusionCredentials: () => ipcRenderer.invoke('get-fusion-credentials'),
  clearFusionCredentials: () => ipcRenderer.invoke('clear-fusion-credentials'),

  // Claude AI Agents
  claudeReconAgent: (params) => ipcRenderer.invoke('claude:recon-agent', params),
  claudeTestKey:    ()       => ipcRenderer.invoke('claude:test-key'),

  // RAG Assistant
  ragIngestFile: (params)   => ipcRenderer.invoke('rag:ingest-file', params),
  ragListDocs:   ()         => ipcRenderer.invoke('rag:list-docs'),
  ragDeleteDoc:  (params)   => ipcRenderer.invoke('rag:delete-doc', params),
  ragQuery:      (params)   => ipcRenderer.invoke('rag:query', params),

  // Native Oracle Fusion (IDCS) login — opens the real sign-in window
  fusionLogin: (url) => ipcRenderer.invoke('fusion-login', { url }),

  // Open a new Electron window (for "New Window" feature)
  // Optional path parameter: navigates to that path in the new window
  openNewWindow: (path) => ipcRenderer.invoke('openNewWindow', path),

  // Update checker
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadAndInstallUpdate: (params) => ipcRenderer.invoke('download-and-install-update', params),
  onOpenUpdateChecker: (callback) => ipcRenderer.on('open-update-checker', callback),
  removeOpenUpdateCheckerListener: () => ipcRenderer.removeAllListeners('open-update-checker'),
  onOpenAbout: (callback) => ipcRenderer.on('open-about', callback),

  // Check if running in Electron
  isElectron: true,

  // Platform info
  platform: process.platform,
});

// Log that preload script loaded
console.log('Electron preload script loaded');
