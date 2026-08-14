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
    console.log('[Fusion Login] Authenticating via proxy...');

    const response = await fetch('http://localhost:3001/api/fusion/soap-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instanceUrl: fusionInstanceUrl,
        username,
        password,
      }),
    });

    const data = await response.json();

    if (data.success && data.sessionId) {
      console.log('[Fusion Login] SUCCESS - Session ID obtained via proxy');
      return { success: true, sessionId: data.sessionId };
    } else {
      console.warn('[Fusion Login] Failed:', data.error);
      return { success: false, error: data.error || 'Login failed' };
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[Fusion Login] Exception:', errorMsg);
    return { success: false, error: errorMsg };
  }
};
