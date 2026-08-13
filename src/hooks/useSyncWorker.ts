/**
 * Hook for managing Web Worker sync operations
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { PROXY_CONFIG, APEX_DB_CONFIG } from '../config/api.config';

export interface WorkerSyncProgress {
  status: string;
  totalSuppliers: number;
  processedSuppliers: number;
  totalAddresses: number;
  insertedAddresses: number;
  currentSupplier: string;
  currentSupplierId: number | null;
  errors: number;
  lastError: string;
  startTime: string | null;
  endTime: string | null;
}

export interface WorkerLog {
  id: string;
  timestamp: Date;
  type: 'info' | 'success' | 'error' | 'warning' | 'step';
  message: string;
}

interface UseSyncWorkerProps {
  onProgress?: (progress: WorkerSyncProgress) => void;
  onLog?: (log: WorkerLog) => void;
  onComplete?: (result: WorkerSyncProgress) => void;
  onError?: (error: string) => void;
}

export const useSyncWorker = ({
  onProgress,
  onLog,
  onComplete,
  onError,
}: UseSyncWorkerProps = {}) => {
  const workerRef = useRef<Worker | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [isSupported, setIsSupported] = useState(true);
  const logCounterRef = useRef(0);

  // Check if Web Workers are supported
  useEffect(() => {
    if (typeof Worker === 'undefined') {
      setIsSupported(false);
      console.warn('Web Workers are not supported in this environment');
    }
  }, []);

  // Initialize worker
  const initWorker = useCallback(() => {
    if (!isSupported) return null;

    try {
      // Create worker from the worker file
      const worker = new Worker(
        new URL('../workers/sync.worker.ts', import.meta.url),
        { type: 'module' }
      );

      // Configure the worker
      worker.postMessage({
        type: 'CONFIG',
        payload: {
          proxyBaseUrl: PROXY_CONFIG.baseUrl,
          apexBaseUrl: APEX_DB_CONFIG.baseUrl,
        },
      });

      // Handle messages from worker
      worker.onmessage = (event) => {
        const { type, payload } = event.data;

        switch (type) {
          case 'PROGRESS':
            onProgress?.(payload);
            break;

          case 'LOG':
            logCounterRef.current++;
            const log: WorkerLog = {
              id: `worker-${logCounterRef.current}-${Date.now()}`,
              timestamp: new Date(),
              type: payload.logType,
              message: payload.message,
            };
            onLog?.(log);
            break;

          case 'COMPLETE':
            setIsRunning(false);
            onComplete?.(payload);
            break;

          case 'ERROR':
            setIsRunning(false);
            onError?.(payload);
            break;
        }
      };

      worker.onerror = (error) => {
        console.error('Worker error:', error);
        setIsRunning(false);
        onError?.(error.message || 'Worker error occurred');
      };

      return worker;
    } catch (error) {
      console.error('Failed to create worker:', error);
      setIsSupported(false);
      return null;
    }
  }, [isSupported, onProgress, onLog, onComplete, onError]);

  // Start sync
  const startSync = useCallback((
    syncType: string,
    parameters: Record<string, string> = {},
    testMode: boolean | 'single' = false
  ) => {
    if (!isSupported) {
      onError?.('Web Workers not supported');
      return false;
    }

    // Create new worker for this sync
    const worker = initWorker();
    if (!worker) {
      onError?.('Failed to initialize worker');
      return false;
    }

    workerRef.current = worker;
    setIsRunning(true);
    logCounterRef.current = 0;

    // Start the sync
    worker.postMessage({
      type: 'START_SYNC',
      payload: {
        syncType,
        parameters,
        testMode,
      },
    });

    return true;
  }, [isSupported, initWorker, onError]);

  // Stop sync
  const stopSync = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.postMessage({ type: 'STOP_SYNC' });
    }
  }, []);

  // Terminate worker
  const terminate = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
      setIsRunning(false);
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
      }
    };
  }, []);

  return {
    isSupported,
    isRunning,
    startSync,
    stopSync,
    terminate,
  };
};

export default useSyncWorker;
