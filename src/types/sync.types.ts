export interface SyncLog {
  id: string;
  timestamp: Date;
  type: 'info' | 'success' | 'error' | 'warning';
  message: string;
}

export interface SyncProgress {
  status: 'idle' | 'fetching' | 'inserting' | 'completed' | 'error';
  totalRecordsInSource: number;
  totalFetched: number;
  totalInserted: number;
  totalFailed: number;
  currentOffset: number;
  currentBatch: number;
  totalBatches: number;
  startTime?: Date;
  endTime?: Date;
  errorMessage?: string;
}

export interface SyncResult {
  success: boolean;
  data?: unknown[];
  count?: number;
  hasMore?: boolean;
  offset?: number;
  limit?: number;
  totalCount?: number;
  error?: string;
}
