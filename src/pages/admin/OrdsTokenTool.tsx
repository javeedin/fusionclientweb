import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Card, Checkbox, Col, Input, Row, Space, Tag, Tooltip, Typography, message } from 'antd';
import { CopyOutlined, KeyOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { getOrdsTokenUrl } from '../../services/ordsToken.service';

const { Text, Title, Paragraph } = Typography;

// Credentials: env defaults (same vars ordsToken.service uses), overridable
// per-browser. The secret is never committed to the repo — set it in
// .env.local (REACT_APP_ORDS_CLIENT_ID / REACT_APP_ORDS_CLIENT_SECRET) or
// type it here and tick "Remember".
const LS_CREDS = 'reerp.admin.ordsTokenCreds';
const metaEnv = (import.meta as unknown as { env?: Record<string, string> }).env || {};
const ENV_ID = metaEnv.REACT_APP_ORDS_CLIENT_ID || '';
const ENV_SECRET = metaEnv.REACT_APP_ORDS_CLIENT_SECRET || '';

interface TokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  [k: string]: unknown;
}

const OrdsTokenTool: React.FC = () => {
  const saved = useMemo(() => {
    try { return JSON.parse(localStorage.getItem(LS_CREDS) || 'null') as { id?: string; secret?: string; url?: string } | null; }
    catch { return null; }
  }, []);

  const [tokenUrl, setTokenUrl]   = useState(saved?.url || getOrdsTokenUrl() || '');
  const [clientId, setClientId]   = useState(saved?.id || ENV_ID);
  const [clientSecret, setClientSecret] = useState(saved?.secret || ENV_SECRET);
  const [remember, setRemember]   = useState(!!saved);
  const [loading, setLoading]     = useState(false);
  const [resp, setResp]           = useState<TokenResponse | null>(null);
  const [rawError, setRawError]   = useState('');
  const [fetchedAt, setFetchedAt] = useState<number>(0);
  const [now, setNow]             = useState<number>(Date.now());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  const secondsLeft = resp?.expires_in
    ? Math.max(0, Math.round(resp.expires_in - (now - fetchedAt) / 1000))
    : 0;

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => message.success(`${label} copied`));
  };

  const getToken = async () => {
    if (!tokenUrl.trim() || !clientId.trim() || !clientSecret.trim()) {
      message.warning('Token URL, Client ID and Client Secret are all required');
      return;
    }
    setLoading(true);
    setResp(null);
    setRawError('');
    try {
      if (remember) {
        localStorage.setItem(LS_CREDS, JSON.stringify({ id: clientId, secret: clientSecret, url: tokenUrl }));
      } else {
        localStorage.removeItem(LS_CREDS);
      }
      const res = await fetch(tokenUrl.trim(), {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + btoa(`${clientId.trim()}:${clientSecret.trim()}`),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
      });
      const text = await res.text();
      let data: TokenResponse;
      try { data = JSON.parse(text); } catch { data = {}; }
      if (!res.ok || !data.access_token) {
        setRawError(`HTTP ${res.status} — ${text.slice(0, 800) || '(empty response)'}`);
        message.error(`Token request failed (HTTP ${res.status})`);
        return;
      }
      setResp(data);
      setFetchedAt(Date.now());
      setNow(Date.now());
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => setNow(Date.now()), 1000);
      message.success('Token retrieved');
    } catch (e) {
      setRawError(e instanceof Error ? e.message : String(e));
      message.error('Network error requesting token');
    } finally {
      setLoading(false);
    }
  };

  const curl = `curl -X POST "${tokenUrl.trim()}" \\\n  -u "CLIENT_ID:CLIENT_SECRET" \\\n  -H "Content-Type: application/x-www-form-urlencoded" \\\n  -d "grant_type=client_credentials"`;

  return (
    <div style={{ padding: 24, maxWidth: 860 }}>
      <Title level={4} style={{ marginBottom: 4 }}><KeyOutlined /> ORDS OAuth Token</Title>
      <Paragraph type="secondary" style={{ marginBottom: 16 }}>
        Requests a bearer token from the ORDS token endpoint using the client-credentials flow
        (the same mechanism the app uses when <Text code>REACT_APP_ORDS_USE_TOKEN=YES</Text>).
        Use the token as <Text code>Authorization: Bearer &lt;token&gt;</Text> when testing secured REST calls.
      </Paragraph>

      <Card size="small" title="Request" style={{ marginBottom: 16 }}>
        <Space direction="vertical" style={{ width: '100%' }} size={10}>
          <div>
            <Text strong style={{ fontSize: 12 }}>Token URL</Text>
            <Input value={tokenUrl} onChange={e => setTokenUrl(e.target.value)}
              placeholder="https://<host>/ords/<schema>/oauth/token"
              style={{ fontFamily: 'monospace', fontSize: 12 }} />
          </div>
          <Row gutter={12}>
            <Col xs={24} md={12}>
              <Text strong style={{ fontSize: 12 }}>Client ID</Text>
              <Input value={clientId} onChange={e => setClientId(e.target.value)}
                placeholder="client_id" style={{ fontFamily: 'monospace', fontSize: 12 }} />
            </Col>
            <Col xs={24} md={12}>
              <Text strong style={{ fontSize: 12 }}>Client Secret</Text>
              <Input.Password value={clientSecret} onChange={e => setClientSecret(e.target.value)}
                placeholder="client_secret" style={{ fontFamily: 'monospace', fontSize: 12 }} />
            </Col>
          </Row>
          <Space wrap>
            <Button type="primary" icon={<ThunderboltOutlined />} loading={loading} onClick={getToken}>
              Get Token
            </Button>
            <Checkbox checked={remember} onChange={e => setRemember(e.target.checked)}>
              Remember credentials in this browser
            </Checkbox>
            <Tooltip title="Copy a curl command for this request (credentials NOT included — replace the placeholders)">
              <Button size="small" icon={<CopyOutlined />} onClick={() => copy(curl, 'curl command')}>curl</Button>
            </Tooltip>
          </Space>
          <Text type="secondary" style={{ fontSize: 11 }}>
            Defaults come from <Text code>.env.local</Text> (REACT_APP_ORDS_CLIENT_ID / REACT_APP_ORDS_CLIENT_SECRET).
            Credentials are kept only in this browser — never in the repo.
          </Text>
        </Space>
      </Card>

      {rawError && (
        <Alert type="error" showIcon style={{ marginBottom: 16 }} message="Token request failed"
          description={<pre style={{ margin: 0, fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{rawError}</pre>} />
      )}

      {resp?.access_token && (
        <Card size="small"
          title={<Space>Token
            <Tag color={secondsLeft > 60 ? 'green' : secondsLeft > 0 ? 'orange' : 'red'}>
              {secondsLeft > 0
                ? `expires in ${Math.floor(secondsLeft / 60)}m ${secondsLeft % 60}s`
                : 'expired'}
            </Tag>
          </Space>}>
          <Space direction="vertical" style={{ width: '100%' }} size={10}>
            <div>
              <Space style={{ marginBottom: 4 }}>
                <Text strong style={{ fontSize: 12 }}>access_token</Text>
                <Button size="small" icon={<CopyOutlined />} onClick={() => copy(resp.access_token!, 'Token')}>Copy token</Button>
                <Button size="small" icon={<CopyOutlined />}
                  onClick={() => copy(`Authorization: Bearer ${resp.access_token}`, 'Bearer header')}>
                  Copy as Bearer header
                </Button>
              </Space>
              <Input.TextArea value={resp.access_token} readOnly autoSize={{ minRows: 2, maxRows: 4 }}
                style={{ fontFamily: 'monospace', fontSize: 11 }} />
            </div>
            <Space size={16} wrap>
              <Text style={{ fontSize: 12 }}>token_type: <Text code>{String(resp.token_type ?? '—')}</Text></Text>
              <Text style={{ fontSize: 12 }}>expires_in: <Text code>{String(resp.expires_in ?? '—')}s</Text></Text>
              <Text style={{ fontSize: 12 }}>fetched: <Text code>{new Date(fetchedAt).toLocaleTimeString()}</Text></Text>
            </Space>
            <details>
              <summary style={{ fontSize: 12, cursor: 'pointer' }}>Raw response</summary>
              <pre style={{ fontSize: 11, background: '#fafafa', padding: 8, borderRadius: 4, overflow: 'auto', margin: '6px 0 0' }}>
                {JSON.stringify(resp, null, 2)}
              </pre>
            </details>
          </Space>
        </Card>
      )}
    </div>
  );
};

export default OrdsTokenTool;
