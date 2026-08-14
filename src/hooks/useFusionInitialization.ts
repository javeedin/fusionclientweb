import { useEffect, useRef } from 'react';
import { getCurrentCompany } from '../config/company.config';

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

        const fusionBaseUrl = company.fusionInstances[0].url;
        const auth = 'Basic ' + btoa('emparun:Fusion@1234');
        const url = `${fusionBaseUrl}/fscmRestApi/resources/11.13.18.05/itemsV2?limit=1&offset=0&onlyData=true`;

        // Retry logic to establish Fusion connection
        let lastError: Error | null = null;
        const maxRetries = 4;
        const delays = [500, 1000, 2000, 4000];

        for (let attempt = 0; attempt < maxRetries; attempt++) {
          try {
            console.log(`[Fusion Init] Attempt ${attempt + 1}/${maxRetries}...`);

            const response = await fetch(url, {
              method: 'GET',
              headers: {
                'Authorization': auth,
                'Content-Type': 'application/json',
              },
              credentials: 'include',
            });

            if (response.ok) {
              console.log('✓ [Fusion Init] Connection established successfully');
              return;
            } else {
              console.warn(`[Fusion Init] Status ${response.status}, retrying...`);
              lastError = new Error(`Status ${response.status}`);
            }
          } catch (error) {
            console.warn(`[Fusion Init] Attempt ${attempt + 1} failed:`, error);
            lastError = error as Error;
          }

          // Wait before retry
          if (attempt < maxRetries - 1) {
            await sleep(delays[attempt]);
          }
        }

        console.error('[Fusion Init] Failed to establish connection after retries:', lastError?.message);
      } catch (error) {
        console.error('[Fusion Init] Unexpected error:', error);
      }
    };

    initializeFusion();
  }, []);
};
