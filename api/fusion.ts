import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(200).send('');
  }

  try {
    const { method = 'GET', path = '', body, companyCode = 'BUMERIC', fusionInstanceUrl } = req.body;

    // Use selected instance URL if provided, otherwise use env config
    let baseUrl = fusionInstanceUrl;

    if (!baseUrl) {
      baseUrl = process.env[`FUSION_BASE_URL_${companyCode}`]
        || process.env.FUSION_BASE_URL
        || 'https://iacney-test.fa.ocs.oraclecloud.com';
    }

    // Ensure base URL doesn't include resource path (it will be added to path param)
    if (baseUrl && baseUrl.includes('/fscmRestApi')) {
      baseUrl = baseUrl.split('/fscmRestApi')[0];
    }

    const username = process.env[`FUSION_USER_${companyCode}`]
      || process.env.FUSION_USER
      || '';

    const password = process.env[`FUSION_PASSWORD_${companyCode}`]
      || process.env.FUSION_PASSWORD
      || '';

    const resourcePath = '/fscmRestApi/resources/11.13.18.05';
    const url = `${baseUrl}${resourcePath}${path}`;
    const auth = Buffer.from(`${username}:${password}`).toString('base64');

    console.log(`[FUSION PROXY] ${companyCode} ${method} ${url}`);

    const options: RequestInit = {
      method,
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    };

    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));

    return res
      .status(response.status)
      .setHeader('Content-Type', 'application/json')
      .setHeader('Access-Control-Allow-Origin', '*')
      .json(data);
  } catch (error: any) {
    console.error('[FUSION PROXY ERROR]', error.message);
    return res
      .status(500)
      .setHeader('Content-Type', 'application/json')
      .setHeader('Access-Control-Allow-Origin', '*')
      .json({ error: error.message });
  }
}
