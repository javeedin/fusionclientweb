import { useEffect, useRef } from 'react';
import { getCurrentCompany } from '../config/company.config';

export const useFusionInitialization = () => {
  const initializingRef = useRef(false);

  useEffect(() => {
    if (initializingRef.current) return;
    initializingRef.current = true;

    const initializeFusion = async () => {
      try {
        const company = getCurrentCompany();
        if (!company.fusionInstances || company.fusionInstances.length === 0) {
          console.warn('No Fusion instances configured for company');
          return;
        }

        const fusionBaseUrl = company.fusionInstances[0].url;
        const auth = 'Basic ' + btoa('emparun:Fusion@1234');

        // Perform a simple HEAD request to establish CORS preflight cache
        // This gives the browser time to negotiate CORS before actual data requests
        const response = await fetch(`${fusionBaseUrl}/fscmRestApi/resources/11.13.18.05/itemsV2?limit=1&offset=0&onlyData=true`, {
          method: 'GET',
          headers: {
            'Authorization': auth,
            'Content-Type': 'application/json',
          },
          credentials: 'include',
        });

        if (response.ok) {
          console.log('✓ Fusion API connection established');
        } else {
          console.warn(`Fusion connection returned status ${response.status}`);
        }
      } catch (error) {
        console.warn('Fusion initialization preflight failed, retries will handle connection:', error);
        // Retries in ItemMaster will handle the actual connection
      }
    };

    initializeFusion();
  }, []);
};
