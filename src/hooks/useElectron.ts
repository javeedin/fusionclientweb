import { useCallback, useEffect, useRef } from 'react';
import type { BackgroundSyncConfig, BackgroundSyncProgress, BackgroundSyncLog, BackgroundSyncResult } from '../types/electron';

// Check if running in Electron
export const isElectron = (): boolean => {
  return !!(window.electronAPI?.isElectron);
};

// Hook to use Electron features with fallback for browser
export const useElectron = () => {
  const electron = window.electronAPI;

  // Notify that sync has started
  const notifySyncStarted = useCallback((syncType: string) => {
    if (electron) {
      electron.syncStarted(syncType);
    }
  }, [electron]);

  // Update sync progress
  const notifySyncProgress = useCallback((progress: string) => {
    if (electron) {
      electron.syncProgress(progress);
    }
  }, [electron]);

  // Notify that sync completed
  const notifySyncCompleted = useCallback((summary: string) => {
    if (electron) {
      electron.syncCompleted(summary);
    } else {
      // Fallback: use browser notification if available
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('Sync Completed', { body: summary });
      }
    }
  }, [electron]);

  // Notify sync error
  const notifySyncError = useCallback((error: string) => {
    if (electron) {
      electron.syncError(error);
    } else {
      // Fallback: use browser notification if available
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('Sync Error', { body: error });
      }
    }
  }, [electron]);

  // Show a general notification
  const showNotification = useCallback((title: string, body: string) => {
    if (electron) {
      electron.showNotification(title, body);
    } else {
      // Fallback: use browser notification if available
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(title, { body });
      }
    }
  }, [electron]);

  // Request notification permission (for browser fallback)
  const requestNotificationPermission = useCallback(async () => {
    if (!electron && 'Notification' in window) {
      const permission = await Notification.requestPermission();
      return permission === 'granted';
    }
    return true; // Electron handles permissions differently
  }, [electron]);

  // Start background sync (Electron main process)
  const startBackgroundSync = useCallback(async (config: BackgroundSyncConfig) => {
    if (electron?.startBackgroundSync) {
      await electron.startBackgroundSync(config);
    } else {
      throw new Error('Background sync not available - not running in Electron');
    }
  }, [electron]);

  // Stop background sync
  const stopBackgroundSync = useCallback(async () => {
    if (electron?.stopBackgroundSync) {
      await electron.stopBackgroundSync();
    }
  }, [electron]);

  // Check if background sync is supported
  const isBackgroundSyncSupported = !!electron?.startBackgroundSync;

  return {
    isElectron: !!electron,
    isBackgroundSyncSupported,
    notifySyncStarted,
    notifySyncProgress,
    notifySyncCompleted,
    notifySyncError,
    showNotification,
    requestNotificationPermission,
    startBackgroundSync,
    stopBackgroundSync,
  };
};

// Hook for Electron background sync with callbacks
export const useElectronBackgroundSync = (
  onProgress?: (progress: BackgroundSyncProgress) => void,
  onLog?: (log: BackgroundSyncLog) => void,
  onComplete?: (result: BackgroundSyncResult) => void,
  onError?: (error: string) => void
) => {
  const electron = window.electronAPI;
  const isRunningRef = useRef(false);

  useEffect(() => {
    if (!electron) return;

    if (onProgress && electron.onBackgroundSyncProgress) {
      electron.onBackgroundSyncProgress(onProgress);
    }
    if (onLog && electron.onBackgroundSyncLog) {
      electron.onBackgroundSyncLog(onLog);
    }
    if (onComplete && electron.onBackgroundSyncComplete) {
      electron.onBackgroundSyncComplete((result) => {
        isRunningRef.current = false;
        onComplete(result);
      });
    }
    if (onError && electron.onBackgroundSyncError) {
      electron.onBackgroundSyncError((error) => {
        isRunningRef.current = false;
        onError(error);
      });
    }

    return () => {
      if (electron.removeBackgroundSyncListeners) {
        electron.removeBackgroundSyncListeners();
      }
    };
  }, [electron, onProgress, onLog, onComplete, onError]);

  const startSync = useCallback(async (config: BackgroundSyncConfig) => {
    if (!electron?.startBackgroundSync) {
      throw new Error('Background sync not available');
    }
    isRunningRef.current = true;
    await electron.startBackgroundSync(config);
  }, [electron]);

  const stopSync = useCallback(async () => {
    if (electron?.stopBackgroundSync) {
      await electron.stopBackgroundSync();
      isRunningRef.current = false;
    }
  }, [electron]);

  return {
    isSupported: !!electron?.startBackgroundSync,
    isRunning: isRunningRef.current,
    startSync,
    stopSync,
  };
};

// Hook to listen for Electron commands
export const useElectronCommands = (
  onStartSync?: () => void,
  onStopSync?: () => void
) => {
  useEffect(() => {
    const electron = window.electronAPI;
    if (!electron) return;

    if (onStartSync) {
      electron.onStartSync(onStartSync);
    }
    if (onStopSync) {
      electron.onStopSync(onStopSync);
    }

    return () => {
      electron.removeStartSyncListener();
      electron.removeStopSyncListener();
    };
  }, [onStartSync, onStopSync]);
};

export default useElectron;
