import React, { useState } from 'react';
import {
  Modal, Button, Tag, Space, Typography, Input,
  Tooltip, Collapse, Spin, Select,
} from 'antd';
import {
  ApiOutlined, CopyOutlined, CheckOutlined,
  PlayCircleOutlined, CaretRightOutlined,
} from '@ant-design/icons';

const { Text, Paragraph } = Typography;
const { TextArea } = Input;

export interface ApiEndpoint {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  url: string;          // may contain :param placeholders
  description: string;
  params?: string;      // query param note
  body?: string;        // body field note
  sampleBody?: string;  // pre-filled JSON for POST/PUT
}

interface TestState {
  loading: boolean;
  status: number | null;
  response: string | null;
  resolvedUrl: string | null;
}

interface Props {
  title: string;
  endpoints: ApiEndpoint[];
  buttonStyle?: React.CSSProperties;
}

const METHOD_COLOR: Record<string, string> = {
  GET: 'blue', POST: 'green', PUT: 'orange', DELETE: 'red',
};

const REDWOOD_INFO = '#0572CE';

// extract :param names from a URL template
const extractParams = (url: string): string[] => {
  const matches = url.match(/:([a-zA-Z]+)/g);
  return matches ? matches.map(m => m.slice(1)) : [];
};

// replace :param in url with user-supplied values
const buildUrl = (url: string, paramValues: Record<string, string>, queryString?: string): string => {
  let resolved = url;
  Object.entries(paramValues).forEach(([k, v]) => {
    resolved = resolved.replace(`:${k}`, encodeURIComponent(v || `:${k}`));
  });
  if (queryString) resolved += (resolved.includes('?') ? '&' : '?') + queryString;
  return resolved;
};

// ─────────────────────────────────────────────────────────────────────────────
// Single endpoint row
// ─────────────────────────────────────────────────────────────────────────────
const EndpointRow: React.FC<{ ep: ApiEndpoint }> = ({ ep }) => {
  const [copied, setCopied]           = useState(false);
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [queryString, setQueryString] = useState('');
  const [bodyText, setBodyText]       = useState(ep.sampleBody || '');
  const [test, setTest]               = useState<TestState>({ loading: false, status: null, response: null, resolvedUrl: null });

  const pathParams = extractParams(ep.url);

  const copy = () => {
    navigator.clipboard.writeText(ep.url).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const runTest = async () => {
    const url = buildUrl(ep.url, paramValues, queryString || undefined);
    setTest({ loading: true, status: null, response: null, resolvedUrl: url });
    try {
      const opts: RequestInit = {
        method: ep.method,
        headers: { Accept: 'application/json', ...(ep.method !== 'GET' && ep.method !== 'DELETE' ? { 'Content-Type': 'application/json' } : {}) },
        ...(ep.method !== 'GET' && ep.method !== 'DELETE' && bodyText ? { body: bodyText } : {}),
      };
      const res = await fetch(url, opts);
      const text = await res.text();
      let pretty = text;
      try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch { /* keep raw */ }
      setTest({ loading: false, status: res.status, response: pretty, resolvedUrl: url });
    } catch (e: any) {
      setTest({ loading: false, status: 0, response: `Network error: ${e?.message}`, resolvedUrl: url });
    }
  };

  const statusColor = test.status
    ? test.status >= 200 && test.status < 300 ? '#52c41a' : '#ff4d4f'
    : REDWOOD_INFO;

  return (
    <div style={{
      border: '1px solid #e8e8e8', borderRadius: 8,
      marginBottom: 10, overflow: 'hidden',
    }}>
      {/* Header row */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 12px', background: '#fafafa',
        borderBottom: '1px solid #f0f0f0',
      }}>
        <Tag color={METHOD_COLOR[ep.method]}
          style={{ fontWeight: 700, fontSize: 11, minWidth: 52, textAlign: 'center', margin: 0 }}>
          {ep.method}
        </Tag>
        <Text style={{ fontFamily: 'monospace', fontSize: 12, flex: 1, wordBreak: 'break-all' }}>
          {ep.url}
        </Text>
        <Tooltip title={copied ? 'Copied!' : 'Copy URL'}>
          <Button type="text" size="small"
            icon={copied ? <CheckOutlined style={{ color: '#52c41a' }} /> : <CopyOutlined />}
            onClick={copy} />
        </Tooltip>
      </div>

      {/* Description + params note */}
      <div style={{ padding: '6px 12px', background: '#fff' }}>
        <Text style={{ fontSize: 12, color: '#555' }}>{ep.description}</Text>
        {ep.params && (
          <div style={{ marginTop: 2, fontSize: 11, color: '#888' }}>
            <b>Params:</b> {ep.params}
          </div>
        )}
        {ep.body && (
          <div style={{ fontSize: 11, color: '#888' }}>
            <b>Body:</b> {ep.body}
          </div>
        )}
      </div>

      {/* Test inputs */}
      <div style={{ padding: '8px 12px', background: '#f9f9f9', borderTop: '1px dashed #e8e8e8' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
          {/* Path param inputs */}
          {pathParams.map(p => (
            <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Text style={{ fontSize: 11, color: '#888' }}>:{p}</Text>
              <Input
                size="small"
                placeholder={p}
                style={{ width: 120, fontSize: 12 }}
                value={paramValues[p] || ''}
                onChange={e => setParamValues(prev => ({ ...prev, [p]: e.target.value }))}
              />
            </div>
          ))}
          {/* Query string for GET */}
          {ep.method === 'GET' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Text style={{ fontSize: 11, color: '#888' }}>?query</Text>
              <Input
                size="small"
                placeholder="e.g. q=test&status=ACTIVE"
                style={{ width: 220, fontSize: 12 }}
                value={queryString}
                onChange={e => setQueryString(e.target.value)}
              />
            </div>
          )}
        </div>

        {/* Body textarea for POST/PUT */}
        {(ep.method === 'POST' || ep.method === 'PUT') && (
          <TextArea
            rows={4}
            style={{ fontFamily: 'monospace', fontSize: 11, marginBottom: 8 }}
            placeholder='{"key": "value"}'
            value={bodyText}
            onChange={e => setBodyText(e.target.value)}
          />
        )}

        {/* Test button + status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Button
            size="small"
            type="primary"
            icon={test.loading ? <Spin size="small" /> : <PlayCircleOutlined />}
            onClick={runTest}
            disabled={test.loading}
            style={{ background: REDWOOD_INFO, borderColor: REDWOOD_INFO }}
          >
            Test
          </Button>
          {test.status !== null && (
            <Tag color={test.status >= 200 && test.status < 300 ? 'success' : 'error'}>
              HTTP {test.status}
            </Tag>
          )}
          {test.resolvedUrl && (
            <Text style={{ fontSize: 10, color: '#aaa', fontFamily: 'monospace', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {test.resolvedUrl}
            </Text>
          )}
        </div>

        {/* Response */}
        {test.response !== null && (
          <div style={{ marginTop: 8 }}>
            <pre style={{
              background: test.status && test.status >= 200 && test.status < 300 ? '#f6ffed' : '#fff2f0',
              border: `1px solid ${test.status && test.status >= 200 && test.status < 300 ? '#b7eb8f' : '#ffa39e'}`,
              borderRadius: 4, padding: '8px 10px',
              fontSize: 11, maxHeight: 220, overflowY: 'auto',
              margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            }}>
              {test.response}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Modal
// ─────────────────────────────────────────────────────────────────────────────
const ApiDocsModal: React.FC<Props> = ({ title, endpoints, buttonStyle }) => {
  const [open, setOpen]   = useState(false);
  const [filter, setFilter] = useState('');

  const filtered = filter
    ? endpoints.filter(e =>
        e.url.toLowerCase().includes(filter.toLowerCase()) ||
        e.description.toLowerCase().includes(filter.toLowerCase()) ||
        e.method.toLowerCase().includes(filter.toLowerCase()))
    : endpoints;

  return (
    <>
      <Tooltip title="View & test API endpoints">
        <Button size="small" icon={<ApiOutlined />}
          onClick={() => setOpen(true)} style={buttonStyle}>
          API
        </Button>
      </Tooltip>

      <Modal
        title={
          <Space>
            <ApiOutlined style={{ color: REDWOOD_INFO }} />
            <span>API Endpoints — {title}</span>
            <Tag color="blue" style={{ fontSize: 11 }}>{endpoints.length} endpoints</Tag>
          </Space>
        }
        open={open}
        onCancel={() => { setOpen(false); setFilter(''); }}
        footer={<Button onClick={() => { setOpen(false); setFilter(''); }}>Close</Button>}
        width={860}
        styles={{ body: { maxHeight: '75vh', overflowY: 'auto', padding: '12px 24px' } }}
        destroyOnClose
      >
        <Input
          placeholder="Filter by URL, method or description…"
          allowClear
          size="small"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          style={{ marginBottom: 14, width: 320 }}
        />
        {filtered.map(ep => (
          <EndpointRow key={`${ep.method}-${ep.url}`} ep={ep} />
        ))}
        {filtered.length === 0 && (
          <Text type="secondary">No endpoints match your filter.</Text>
        )}
      </Modal>
    </>
  );
};

export default ApiDocsModal;
