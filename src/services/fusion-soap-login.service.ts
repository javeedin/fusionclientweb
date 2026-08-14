/**
 * Fusion SOAP Login Service
 * Handles Oracle Fusion authentication via SOAP (xmlpserver SecurityService)
 */

export interface FusionLoginResult {
  success: boolean;
  sessionId?: string;
  error?: string;
}

const buildSOAPEnvelope = (username: string, password: string): string => {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:v2="http://xmlns.oracle.com/oxp/service/v2">
  <soapenv:Header/>
  <soapenv:Body>
    <v2:login>
      <v2:userID>${escapeXml(username)}</v2:userID>
      <v2:password>${escapeXml(password)}</v2:password>
    </v2:login>
  </soapenv:Body>
</soapenv:Envelope>`;
};

const escapeXml = (unsafe: string): string => {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
};

const extractSessionId = (soapResponse: string): string | null => {
  try {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(soapResponse, 'text/xml');

    // Check for parsing errors
    if (xmlDoc.getElementsByTagName('parsererror').length > 0) {
      console.error('[Fusion Login] XML Parse Error:', soapResponse);
      return null;
    }

    // Look for loginReturn element
    const loginReturnElements = xmlDoc.getElementsByTagName('loginReturn');
    if (loginReturnElements.length === 0) {
      console.warn('[Fusion Login] No loginReturn element found in response');
      return null;
    }

    const sessionId = loginReturnElements[0].textContent;
    return sessionId && sessionId.trim().length > 0 ? sessionId.trim() : null;
  } catch (error) {
    console.error('[Fusion Login] Failed to parse SOAP response:', error);
    return null;
  }
};

/**
 * Authenticate with Oracle Fusion via SOAP
 * @param fusionInstanceUrl - Full Fusion instance URL (e.g., https://efmh-test.fa.em3.oraclecloud.com)
 * @param username - Fusion username
 * @param password - Fusion password
 * @returns Login result with session ID if successful
 */
export const fusionSOAPLogin = async (
  fusionInstanceUrl: string,
  username: string,
  password: string
): Promise<FusionLoginResult> => {
  try {
    const isElectron = !!(window as any).electronAPI?.isElectron;
    const soapUrl = `${fusionInstanceUrl.replace(/\/$/, '')}/xmlpserver/services/v2/SecurityService`;
    const soapBody = buildSOAPEnvelope(username, password);

    console.log('[Fusion Login] Authenticating...', { isElectron, soapUrl });

    const response = await fetch(soapUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=UTF-8',
        'SOAPAction': '',
      },
      body: soapBody,
    });

    if (!response.ok) {
      const text = await response.text();
      console.error('[Fusion Login] HTTP Error:', response.status, text);
      return { success: false, error: `HTTP ${response.status}: ${response.statusText}` };
    }

    const soapResponse = await response.text();
    console.log('[Fusion Login] SOAP Response received');

    const sessionId = extractSessionId(soapResponse);
    if (sessionId) {
      console.log('[Fusion Login] SUCCESS - Session ID obtained');
      return { success: true, sessionId };
    } else {
      console.warn('[Fusion Login] Failed - No session ID in response');
      return { success: false, error: 'No session ID in SOAP response' };
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[Fusion Login] Exception:', errorMsg);
    return { success: false, error: errorMsg };
  }
};
