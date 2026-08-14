import { useState, useCallback } from 'react';

interface UpdateInfo {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseNotes?: string;
  downloadUrl?: string;
  downloadName?: string;
  message?: string;
}

export const useUpdateChecker = () => {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkForUpdates = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await (window as any).electronAPI.checkForUpdates();
      if (result.success) {
        setUpdateInfo(result as UpdateInfo);
      } else {
        setError(result.error || 'Failed to check for updates');
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      setError(errMsg);
      console.error('[Update] Error:', errMsg);
    } finally {
      setLoading(false);
    }
  }, []);

  const downloadAndInstall = useCallback(async (downloadUrl: string, downloadName: string) => {
    setInstalling(true);
    setError(null);
    try {
      const result = await (window as any).electronAPI.downloadAndInstallUpdate({
        downloadUrl,
        downloadName,
      });
      if (!result.success) {
        setError(result.error || 'Failed to install update');
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      setError(errMsg);
      console.error('[Update] Install error:', errMsg);
    } finally {
      setInstalling(false);
    }
  }, []);

  return {
    updateInfo,
    loading,
    installing,
    error,
    checkForUpdates,
    downloadAndInstall,
  };
};
