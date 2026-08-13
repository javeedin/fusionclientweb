import React, { useState, useEffect, useRef } from 'react';
import { Tag, Typography } from 'antd';
import { LoadingOutlined } from '@ant-design/icons';

const { Text } = Typography;

interface LastCall {
  method: string;
  url: string;
  status: number | null;
  durationMs: number | null;
  ok: boolean | null;
  seq: number;
}

const METHOD_COLOR: Record<string, string> = {
  GET: '#1D7B4D',
  POST: '#0572CE',
  PUT: '#D4A800',
  DELETE: '#C74634',
  PATCH: '#7B52AB',
  OPTIONS: '#555',
};

let _installed = false;
let _seq = 0;
const _listeners: Set<(c: LastCall) => void> = new Set();

function install() {
  if (_installed) return;
  _installed = true;
  const orig = window.fetch;
  window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
    const seq = ++_seq;
    const url = typeof input === 'string' ? input
      : input instanceof URL ? input.href
      : (input as Request).url;
    const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    // Skip non-ORDS/non-data calls (e.g. randomuser.me for avatar)
    const pending: LastCall = { seq, method, url, status: null, durationMs: null, ok: null };
    _listeners.forEach(fn => fn(pending));
    const t0 = performance.now();
    try {
      const res = await orig.call(this, input, init);
      const durationMs = Math.round(performance.now() - t0);
      const done: LastCall = { seq, method, url, status: res.status, durationMs, ok: res.ok };
      _listeners.forEach(fn => fn(done));
      return res;
    } catch (err) {
      const durationMs = Math.round(performance.now() - t0);
      _listeners.forEach(fn => fn({ seq, method, url, status: 0, durationMs, ok: false }));
      throw err;
    }
  };
}

const statusColor = (s: number | null) => {
  if (s === null) return '#888';
  if (s >= 200 && s < 300) return '#1D7B4D';
  if (s >= 400) return '#C74634';
  return '#D4A800';
};

const APIEndpointBar: React.FC = () => {
  const [call, setCall] = useState<LastCall | null>(null);
  const latestSeq = useRef(0);

  useEffect(() => {
    install();
    const handler = (c: LastCall) => {
      // Only track the most recently started request
      if (c.seq >= latestSeq.current) {
        latestSeq.current = c.seq;
        setCall(c);
      }
    };
    _listeners.add(handler);
    return () => { _listeners.delete(handler); };
  }, []);

  if (!call) {
    return (
      <div style={barStyle}>
        <Text style={{ color: '#888', fontSize: 11, fontFamily: 'monospace' }}>
          No API calls yet — navigate or search to see the active endpoint
        </Text>
      </div>
    );
  }

  const isPending = call.status === null;

  return (
    <div style={barStyle}>
      {/* Method */}
      <Tag
        style={{
          background: METHOD_COLOR[call.method] || '#555',
          color: '#fff',
          border: 'none',
          fontSize: 10,
          fontWeight: 700,
          padding: '0 6px',
          lineHeight: '18px',
          height: 18,
          flexShrink: 0,
        }}
      >
        {call.method}
      </Tag>

      {/* Full URL */}
      <Text
        style={{
          color: '#e0e0e0',
          fontSize: 11,
          fontFamily: 'monospace',
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={call.url}
      >
        {call.url}
      </Text>

      {/* Status */}
      {isPending ? (
        <LoadingOutlined style={{ color: '#aaa', fontSize: 12, flexShrink: 0 }} />
      ) : (
        <Text
          style={{
            color: statusColor(call.status),
            fontSize: 11,
            fontFamily: 'monospace',
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          {call.status === 0 ? 'ERR' : call.status}
          {call.durationMs !== null && (
            <span style={{ color: '#888', fontWeight: 400 }}> · {call.durationMs}ms</span>
          )}
        </Text>
      )}
    </div>
  );
};

const barStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '0 16px',
  height: 28,
  background: '#1a1a2e',
  borderBottom: '1px solid #2d2d4e',
  overflow: 'hidden',
};

export default APIEndpointBar;
