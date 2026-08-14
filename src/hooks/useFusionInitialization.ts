import { useEffect, useRef } from 'react';
import { getCurrentCompany } from '../config/company.config';
import { getFusionAuthHeaders } from '../config/api.helper';

export const useFusionInitialization = () => {
  const initializingRef = useRef(false);

  useEffect(() => {
    if (initializingRef.current) return;
    initializingRef.current = true;

    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    const initializeFusion = async () => {
      try {
        const company = getCurrentCompany();
        if (!company.fusionInstances || company.fusionInstances.length === 0) {
          console.warn('No Fusion instances configured for company');
          return;
        }

        // Check if user is logged in (sessionId exists)
        const sessionId = localStorage.getItem('fusion_session_id') || localStorage.getItem('erp_token');
        if (!sessionId) {
          console.log('[Fusion Init] No active session - skipping initialization until after login');
          return;
        }

        const fusionBaseUrl = company.fusionInstances[0].url;
        const url = `${fusionBaseUrl}/fscmRestApi/resources/11.13.18.05/itemsV2?limit=1&offset=0&onlyData=true`;
        const authHeaders = getFusionAuthHeaders();

        console.log(`[Fusion Init] Starting initialization for ${fusionBaseUrl}`);
        console.log(`[Fusion Init] Window is ${window.opener ? 'child (opened from parent)' : 'parent/standalone'}`);

        // Retry logic to establish Fusion connection
        let lastError: Error | null = null;
        const maxRetries = 5;
        const delays = [500, 1000, 2000, 4000, 8000];

        for (let attempt = 0; attempt < maxRetries; attempt++) {
          try {
            console.log(`[Fusion Init] Attempt ${attempt + 1}/${maxRetries}...`);

            const response = await fetch(url, {
              method: 'GET',
              headers: {
                ...authHeaders,
                'Content-Type': 'application/json',
              },
              mode: 'cors', // Explicit CORS mode for preflight negotiation
            });

            console.log(`[Fusion Init] Response status: ${response.status}`);

            if (response.ok) {
              const data = await response.json();
              console.log('✓ [Fusion Init] Connection established successfully', {
                itemsReturned: data?.items?.length || 0,
                totalItems: data?.totalItems || 0,
              });
              return;
            } else {
              const errorText = await response.text();
              console.warn(`[Fusion Init] Status ${response.status}, retrying...`, {
                status: response.status,
                statusText: response.statusText,
                errorPreview: errorText.substring(0, 200),
              });
              lastError = new Error(`Status ${response.status}: ${response.statusText}`);
            }
          } catch (error) {
            console.warn(`[Fusion Init] Attempt ${attempt + 1} failed:`, error);
            lastError = error as Error;
          }

          // Wait before retry
          if (attempt < maxRetries - 1) {
            const delay = delays[attempt];
            console.log(`[Fusion Init] Waiting ${delay}ms before next attempt...`);
            await sleep(delay);
          }
        }

        console.error('[Fusion Init] Failed to establish connection after all retries:', {
          message: lastError?.message,
          totalAttempts: maxRetries,
        });
      } catch (error) {
        console.error('[Fusion Init] Unexpected error:', error);
      }
    };

    initializeFusion();
  }, []);
};
