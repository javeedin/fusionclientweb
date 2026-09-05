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

  // POS receipt printing — hidden window sized for 80mm thermal rolls
  printReceipt: (html, opts) =>
    ipcRenderer.invoke('pos:print-receipt', { html, ...(opts || {}) }),

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

  // GL MCP Server
  glMcpSaveCredentials: (params)    => ipcRenderer.invoke('gl-mcp:save-credentials', params),
  glMcpGetCredentials: ()           => ipcRenderer.invoke('gl-mcp:get-credentials'),
  glMcpStart: (credentials)         => ipcRenderer.invoke('gl-mcp:start', credentials),
  glMcpStop: ()                     => ipcRenderer.invoke('gl-mcp:stop'),
  glMcpStatus: ()                   => ipcRenderer.invoke('gl-mcp:status'),
  glMcpGetLogs: ()                  => ipcRenderer.invoke('gl-mcp:get-logs'),
  glMcpAddToClaudeDesktop: (params) => ipcRenderer.invoke('gl-mcp:add-to-claude-desktop', params),
  mcpRegistryAddToClaudeDesktop: (params) => ipcRenderer.invoke('mcp-registry:add-to-claude-desktop', params),
  mcpRegistryKillClaudeDesktop: () => ipcRenderer.invoke('mcp-registry:kill-claude-desktop'),
  mcpRegistryStartClaudeDesktop: () => ipcRenderer.invoke('mcp-registry:start-claude-desktop'),
  glMcpChat: (params)               => ipcRenderer.invoke('gl-mcp:chat', params),
  glMcpFetchClaudeKey: (params)     => ipcRenderer.invoke('gl-mcp:fetch-claude-key', params),
  onGlMcpStatus: (callback)         => ipcRenderer.on('gl-mcp-status', callback),
  removeGlMcpStatusListener: ()     => ipcRenderer.removeAllListeners('gl-mcp-status'),

  // Claude Code CLI — embedded subscription-billed terminal with MCP
  claudeCliStatus: ()            => ipcRenderer.invoke('claude-cli:status'),
  claudeCliStart:  (opts)        => ipcRenderer.invoke('claude-cli:start', opts),
  claudeCliStop:   ()            => ipcRenderer.invoke('claude-cli:stop'),
  claudeCliOpenExternal: (opts)  => ipcRenderer.invoke('claude-cli:open-external', opts),

  // Claude Chat — chat bubbles over the headless CLI (subscription-billed)
  claudeChatSend:   (opts)       => ipcRenderer.invoke('claude-chat:send', opts),
  claudeChatCancel: ()           => ipcRenderer.invoke('claude-chat:cancel'),
  claudeChatOpenWorkspace: ()    => ipcRenderer.invoke('claude-chat:open-workspace'),
  claudeChatCatalog: ()          => ipcRenderer.invoke('claude-chat:catalog'),
  claudeChatRecipes: (opts)      => ipcRenderer.invoke('claude-chat:recipes', opts),
  claudeChatLov: (opts)          => ipcRenderer.invoke('claude-chat:lov', opts),
  claudeChatApiGet: (opts)       => ipcRenderer.invoke('claude-chat:apiget', opts),
  claudeChatSaveDirect: (opts)   => ipcRenderer.invoke('claude-chat:save-direct', opts),
  claudeChatListFiles: ()        => ipcRenderer.invoke('claude-chat:list-files'),
  claudeChatReadFile: (relPath)  => ipcRenderer.invoke('claude-chat:read-file', { relPath }),
  claudeChatOpenFile: (relPath)  => ipcRenderer.invoke('claude-chat:open-file', { relPath }),
  onClaudeChatEvent: (cb)        => ipcRenderer.on('claude-chat:event', cb),
  removeClaudeChatListeners: ()  => ipcRenderer.removeAllListeners('claude-chat:event'),
  claudeCliInput:  (data)        => ipcRenderer.send('claude-cli:input', data),
  claudeCliResize: (cols, rows)  => ipcRenderer.send('claude-cli:resize', { cols, rows }),
  onClaudeCliData: (cb)          => ipcRenderer.on('claude-cli:data', cb),
  onClaudeCliExit: (cb)          => ipcRenderer.on('claude-cli:exit', cb),
  removeClaudeCliListeners: ()   => {
    ipcRenderer.removeAllListeners('claude-cli:data');
    ipcRenderer.removeAllListeners('claude-cli:exit');
  },

  // MCP bridge — in-app AI Assistant access to the local MCP servers
  mcpBridgeListTools: ()                      => ipcRenderer.invoke('mcp-bridge:list-tools'),
  mcpBridgeCallTool:  (server, tool, args)    => ipcRenderer.invoke('mcp-bridge:call-tool', { server, tool, args }),

  // LibreChat — local Docker deployment managed by the app
  libreChatStatus:     ()     => ipcRenderer.invoke('librechat:status'),
  libreChatStart:      (opts) => ipcRenderer.invoke('librechat:start', opts),
  libreChatStop:       ()     => ipcRenderer.invoke('librechat:stop'),
  libreChatOpenWindow: ()     => ipcRenderer.invoke('librechat:open-window'),
  libreChatGetLogs:    ()     => ipcRenderer.invoke('librechat:get-logs'),

  // Native Oracle Fusion (IDCS) login — opens the real sign-in window
  fusionLogin: (url) => ipcRenderer.invoke('fusion-login', { url }),

  // Open a new Electron window (for "New Window" feature)
  // Optional path parameter: navigates to that path in the new window
  openNewWindow: (path) => ipcRenderer.invoke('openNewWindow', path),

  // Update checker
  checkForUpdates: (companyName) => ipcRenderer.invoke('check-for-updates', companyName),
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
