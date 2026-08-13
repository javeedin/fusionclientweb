// Type declarations for Electron API exposed via preload script
export interface ElectronAPI {
  // Sync status updates
  syncStarted: (syncType: string) => void;
  syncProgress: (progress: string) => void;
  syncCompleted: (summary: string) => void;
  syncError: (error: string) => void;

  // General notifications
  showNotification: (title: string, body: string) => void;

  // Email (used by AuthContext for OTP)
  sendOtpEmail: (to: string, otp: string) => Promise<{ success: boolean; error?: string }>;

  // Listen for commands from main process
  onStartSync: (callback: () => void) => void;
  onStopSync: (callback: () => void) => void;

  // Remove listeners
  removeStartSyncListener: () => void;
  removeStopSyncListener: () => void;

  // Background sync (runs in main process)
  startBackgroundSync: (config: BackgroundSyncConfig) => Promise<void>;
  stopBackgroundSync: () => Promise<void>;
  onBackgroundSyncProgress: (callback: (progress: BackgroundSyncProgress) => void) => void;
  onBackgroundSyncLog: (callback: (log: BackgroundSyncLog) => void) => void;
  onBackgroundSyncComplete: (callback: (result: BackgroundSyncResult) => void) => void;
  onBackgroundSyncError: (callback: (error: string) => void) => void;
  removeBackgroundSyncListeners: () => void;

  // Native Oracle Fusion (IDCS) login — resolves once sign-in lands back on the
  // Fusion app domain; returns the username captured from the sign-in page.
  fusionLogin: (url?: string) => Promise<{ success: boolean; username?: string | null; cancelled?: boolean; error?: string }>;

  // Check if running in Electron
  isElectron: boolean;

  // Platform info
  platform: string;
}

// Background sync types
export interface BackgroundSyncConfig {
  syncType: 'supplier-addresses' | 'suppliers' | 'gl-journals' | 'ap-invoices';
  parameters: Record<string, string>;
  testMode: boolean | 'single';
  proxyBaseUrl: string;
  apexBaseUrl: string;
}

export interface BackgroundSyncProgress {
  status: string;
  totalSuppliers?: number;
  processedSuppliers?: number;
  totalAddresses?: number;
  insertedAddresses?: number;
  currentSupplier?: string;
  errors?: number;
}

export interface BackgroundSyncLog {
  type: 'info' | 'success' | 'error' | 'warning' | 'step';
  message: string;
  timestamp: string;
}

export interface BackgroundSyncResult {
  success: boolean;
  insertedRecords: number;
  errors: number;
  duration: number;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
