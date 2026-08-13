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
    const { method = 'GET', path = '', body, companyCode = 'BUMERIC' } = req.body;

    // Get company-specific config from env
    // Env var format: REACT_APP_<COMPANY>_APEX_BASE_URL
    const baseUrl = process.env[`REACT_APP_${companyCode}_APEX_BASE_URL`]
      || process.env.REACT_APP_BUMERIC_APEX_BASE_URL;

    const url = `${baseUrl}${path}`;

    console.log(`[APEX PROXY] ${companyCode} ${method} ${url}`);

    const options: RequestInit = {
      method,
      headers: {
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
    console.error('[APEX PROXY ERROR]', error.message);
    return res
      .status(500)
      .setHeader('Content-Type', 'application/json')
      .setHeader('Access-Control-Allow-Origin', '*')
      .json({ error: error.message });
  }
}
