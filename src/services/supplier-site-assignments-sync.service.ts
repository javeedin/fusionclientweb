import { fetchFromFusion, fetchFromApex, insertToApex } from './sync-http';

// Types
export interface SiteAssignmentsSyncProgress {
  status: 'idle' | 'fetching_sites' | 'fetching_assignments' | 'inserting' | 'completed' | 'error' | 'stopped';
  totalSites: number;
  processedSites: number;
  totalAssignments: number;
  insertedAssignments: number;
  currentSite: string;
  currentSiteId: number | null;
  errors: number;
  lastError: string;
  startTime: Date | null;
  endTime: Date | null;
}

export type LogCallback = (type: 'info' | 'success' | 'error' | 'warning' | 'step', message: string) => void;
export type ProgressCallback = (progress: Partial<SiteAssignmentsSyncProgress>) => void;
export type SiteAssignmentsPayloadCallback = (
  siteId: number,
  siteName: string,
  assignmentCount: number,
  payload: any,
  result?: any,
  error?: string
) => void;

// Fetch sites from APEX (already synced), optionally filtered by supplierId
const fetchSitesFromApex = async (
  log?: LogCallback,
  verbose = true,
  supplierId?: number
): Promise<any> => {
  if (verbose) {
    log?.('step', '──── [GET] APEX Database - Sites ────');
  }
  const params: Record<string, string> = supplierId ? { supplierId: String(supplierId) } : {};
  const data = await fetchFromApex('suppliers/sites', params, log, verbose);
  return { success: true, items: data.items || [] };
};

// Fetch site assignments from Oracle Fusion
const fetchSiteAssignments = async (
  supplierId: number,
  siteId: number,
  params: Record<string, string> = {},
  log?: LogCallback,
  verbose = true
): Promise<any> => {
  if (verbose) {
    log?.('info', `Fetching assignments for site ${siteId}...`);
  }
  return fetchFromFusion(
    `fscmRestApi/resources/11.13.18.05/suppliers/${supplierId}/child/sites/${siteId}/child/assignments`,
    params,
    log,
    verbose
  );
};

// Test connection to Site Assignments endpoint
export const testSiteAssignmentsConnection = async (
  log: LogCallback
): Promise<{ success: boolean; message: string; sample?: any }> => {
  try {
    log('info', 'Testing Site Assignments endpoint...');
    log('info', 'Step 1: Fetching sites from APEX...');

    // First get sites from APEX
    const sitesResult = await fetchSitesFromApex(log, true);

    if (!sitesResult.success || !sitesResult.items || sitesResult.items.length === 0) {
      return { success: false, message: 'No sites found in APEX. Please sync Supplier Sites first.' };
    }

    const site = sitesResult.items[0];
    const supplierId = site.supplierid;
    const siteId = site.suppliersiteid;
    const siteName = site.suppliersite || `Site ${siteId}`;
    log('info', `Step 2: Fetching assignments for ${siteName} (Supplier: ${supplierId}, Site: ${siteId})...`);

    // Then get assignments from Fusion (per site)
    const assignmentsResult = await fetchSiteAssignments(
      supplierId,
      siteId,
      { limit: '5' },
      log,
      true
    );

    if (!assignmentsResult.success) {
      return { success: false, message: assignmentsResult.error || 'Failed to fetch assignments' };
    }

    if (assignmentsResult.items.length === 0) {
      return {
        success: true,
        message: `Connected! Site ${siteName} has no assignments.`,
        sample: { supplierId, siteId, assignments: [] }
      };
    }

    const assignment = assignmentsResult.items[0];
    return {
      success: true,
      message: `Connected! Found ${assignmentsResult.items.length} assignment(s) for site ${siteName}`,
      sample: { supplierId, siteId, assignment }
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    log('error', `Connection test failed: ${errorMsg}`);
    return { success: false, message: errorMsg };
  }
};

// Main sync function
export const syncSiteAssignments = async (
  parameters: Record<string, string>,
  testMode: boolean | 'single',
  log: LogCallback,
  onProgress: ProgressCallback,
  signal?: AbortSignal,
  onPayload?: SiteAssignmentsPayloadCallback
): Promise<SiteAssignmentsSyncProgress> => {
  const progress: SiteAssignmentsSyncProgress = {
    status: 'fetching_sites',
    totalSites: 0,
    processedSites: 0,
    totalAssignments: 0,
    insertedAssignments: 0,
    currentSite: '',
    currentSiteId: null,
    errors: 0,
    lastError: '',
    startTime: new Date(),
    endTime: null,
  };

  onProgress(progress);

  try {
    log('step', `═══════════════════════════════════════`);
    log('info', `Starting Site Assignments sync (${testMode === 'single' ? 'Single Site Test' : testMode ? 'Test Mode - 25 sites' : 'Full Sync'})`);
    log('step', `═══════════════════════════════════════`);

    // Step 1: Fetch sites from APEX (filter by supplierId when provided)
    log('step', `\n──── Fetching Sites from APEX ────`);
    const filterSupplierId = parameters.SupplierId ? Number(parameters.SupplierId) : undefined;
    if (filterSupplierId) {
      log('info', `Filtering sites for SupplierId: ${filterSupplierId}`);
    }
    const sitesResult = await fetchSitesFromApex(log, true, filterSupplierId);

    if (!sitesResult.success || !sitesResult.items) {
      throw new Error('Failed to fetch sites from APEX');
    }

    if (sitesResult.items.length === 0) {
      throw new Error('No sites found in APEX. Please sync Supplier Sites first.');
    }

    // Limit sites based on test mode
    const maxSites = testMode === 'single' ? 1 : (testMode ? 25 : sitesResult.items.length);
    const sitesToProcess = sitesResult.items.slice(0, maxSites);

    progress.totalSites = sitesToProcess.length;
    onProgress({ totalSites: progress.totalSites });

    log('info', `Found ${sitesResult.items.length} sites in APEX, processing ${sitesToProcess.length}`);

    // Step 2: For each site, fetch assignments from Fusion and sync
    progress.status = 'fetching_assignments';
    onProgress({ status: 'fetching_assignments' });

    for (const site of sitesToProcess) {
      if (signal?.aborted) {
        log('warning', 'Sync stopped by user');
        progress.status = 'stopped';
        break;
      }

      const supplierId = site.supplierid;
      const siteId = site.suppliersiteid;
      const siteName = site.suppliersite || `Site ${siteId}`;

      progress.currentSite = siteName;
      progress.currentSiteId = siteId;
      onProgress({
        currentSite: siteName,
        currentSiteId: siteId
      });

      log('step', `\n──── Processing: ${siteName} (Supplier: ${supplierId}, Site: ${siteId}) ────`);

      // Fetch all assignments for this site
      let assignmentOffset = 0;
      let assignmentHasMore = true;
      const siteAssignments: any[] = [];

      while (assignmentHasMore) {
        if (signal?.aborted) break;

        const assignmentResult = await fetchSiteAssignments(
          supplierId,
          siteId,
          { limit: '100', offset: String(assignmentOffset) },
          log,
          assignmentOffset === 0 // Only verbose on first page
        );

        if (!assignmentResult.success) {
          progress.errors++;
          progress.lastError = assignmentResult.error || 'Failed to fetch assignments';
          log('error', `Error fetching assignments for ${siteName}: ${progress.lastError}`);
          break;
        }

        if (assignmentResult.items.length === 0) {
          if (assignmentOffset === 0) {
            log('info', `No assignments for ${siteName}`);
          }
          break;
        }

        // Add SupplierId and SupplierSiteId to each assignment
        const assignmentsWithIds = assignmentResult.items.map((assignment: any) => ({
          ...assignment,
          SupplierId: supplierId,
          SupplierSiteId: siteId
        }));

        siteAssignments.push(...assignmentsWithIds);
        assignmentHasMore = assignmentResult.hasMore === true || assignmentResult.items.length === 100;
        assignmentOffset += 100;
      }

      if (siteAssignments.length > 0) {
        progress.totalAssignments += siteAssignments.length;
        onProgress({ totalAssignments: progress.totalAssignments });

        // POST assignments to APEX
        progress.status = 'inserting';
        onProgress({ status: 'inserting' });

        const payload = { items: siteAssignments };

        try {
          const insertResult = await insertToApex('suppliers/sites/assignments', payload, log, true);

          if (insertResult.success) {
            const count = insertResult.inserted || siteAssignments.length;
            progress.insertedAssignments += count;
            log('success', `Inserted ${count} assignments for ${siteName}`);
            onPayload?.(siteId, siteName, siteAssignments.length, payload, insertResult);
          } else {
            progress.errors++;
            progress.lastError = insertResult.error || 'Insert failed';
            log('error', `Failed to insert assignments for ${siteName}: ${progress.lastError}`);
            onPayload?.(siteId, siteName, siteAssignments.length, payload, undefined, progress.lastError);
          }
        } catch (error) {
          progress.errors++;
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          progress.lastError = errorMsg;
          log('error', `Error inserting assignments for ${siteName}: ${errorMsg}`);
          onPayload?.(siteId, siteName, siteAssignments.length, payload, undefined, errorMsg);
        }

        onProgress({
          insertedAssignments: progress.insertedAssignments,
          errors: progress.errors
        });
      }

      progress.processedSites++;
      onProgress({ processedSites: progress.processedSites });

      // Reset status for next site
      if (!signal?.aborted) {
        progress.status = 'fetching_assignments';
        onProgress({ status: 'fetching_assignments' });
      }
    }

    progress.status = signal?.aborted ? 'stopped' : 'completed';
    progress.endTime = new Date();
    onProgress(progress);

    const duration = progress.endTime.getTime() - (progress.startTime?.getTime() || 0);
    log('step', `\n═══════════════════════════════════════`);
    log('success', `Sync ${progress.status}!`);
    log('info', `Total sites processed: ${progress.processedSites}`);
    log('info', `Total assignments found: ${progress.totalAssignments}`);
    log('info', `Assignments inserted: ${progress.insertedAssignments}`);
    log('info', `Errors: ${progress.errors}`);
    log('info', `Duration: ${(duration / 1000).toFixed(1)}s`);
    log('step', `═══════════════════════════════════════`);

    return progress;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    progress.status = 'error';
    progress.lastError = errorMsg;
    progress.endTime = new Date();
    onProgress(progress);
    log('error', `Sync failed: ${errorMsg}`);
    return progress;
  }
};
