import React, { useState, useEffect, useRef } from 'react';
import { Drawer, Badge, Button, Tag, Tooltip, Typography, Space, Divider } from 'antd';
import { ApiOutlined, ClearOutlined, CloseOutlined, WifiOutlined } from '@ant-design/icons';
import { APEX_DB_CONFIG } from '../config/api.config';

const { Text } = Typography;

interface APICall {
  id: number;
  method: string;
  url: string;
  path: string;
  status: number | null;   // null = in-flight or network error
  durationMs: number | null;
  timestamp: Date;
  ok: boolean | null;
}

const METHOD_COLOR: Record<string, string> = {
  GET: '#1D7B4D',
  POST: '#0572CE',
  PUT: '#D4A800',
  DELETE: '#C74634',
  PATCH: '#7B52AB',
  OPTIONS: '#888',
};

let _interceptInstalled = false;
let _listeners: ((call: APICall) => void)[] = [];
let _callSeq = 0;

function installInterceptor() {
  if (_interceptInstalled) return;
  _interceptInstalled = true;

  const original = window.fetch;
  window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
    const id = ++_callSeq;
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();

    let path = url;
    try { path = new URL(url).pathname + new URL(url).search; } catch { /* relative URL */ }

    const start = performance.now();
    const pending: APICall = { id, method, url, path, status: null, durationMs: null, timestamp: new Date(), ok: null };
    _listeners.forEach(fn => fn(pending));

    try {
      const response = await original.call(this, input, init);
      const durationMs = Math.round(performance.now() - start);
      const done: APICall = { ...pending, status: response.status, durationMs, ok: response.ok };
      _listeners.forEach(fn => fn(done));
      return response;
    } catch (err) {
      const durationMs = Math.round(performance.now() - start);
      const failed: APICall = { ...pending, status: 0, durationMs, ok: false };
      _listeners.forEach(fn => fn(failed));
      throw err;
    }
  };
}

function subscribe(fn: (call: APICall) => void) {
  _listeners.push(fn);
  return () => { _listeners = _listeners.filter(l => l !== fn); };
}

const MAX_CALLS = 50;

const statusBadgeColor = (status: number | null) => {
  if (status === null) return 'processing';
  if (status >= 200 && status < 300) return 'success';
  if (status >= 400 && status < 500) return 'warning';
  return 'error';
};

const statusText = (status: number | null) => {
  if (status === null) return '…';
  if (status === 0) return 'ERR';
  return String(status);
};

const dotColor = (calls: APICall[]) => {
  if (calls.length === 0) return '#888';
  const last = calls.find(c => c.status !== null);
  if (!last) return '#1D7B4D';
  return last.ok ? '#1D7B4D' : '#C74634';
};

const APIMonitor: React.FC = () => {
  const [calls, setCalls] = useState<APICall[]>([]);
  const [open, setOpen] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const drawerOpen = useRef(open);
  drawerOpen.current = open;

  useEffect(() => {
    installInterceptor();
    const unsub = subscribe((call) => {
      setCalls(prev => {
        const existing = prev.findIndex(c => c.id === call.id);
        let next: APICall[];
        if (existing >= 0) {
          next = [...prev];
          next[existing] = call;
        } else {
          next = [call, ...prev].slice(0, MAX_CALLS);
        }
        return next;
      });
      if (!drawerOpen.current && call.status !== null) {
        setNewCount(n => n + 1);
      }
    });
    return unsub;
  }, []);

  const handleOpen = () => { setOpen(true); setNewCount(0); };
  const handleClose = () => setOpen(false);
  const handleClear = () => setCalls([]);

  const baseUrl = APEX_DB_CONFIG.baseUrl;

  return (
    <>
      {/* Floating pill button — bottom-left */}
      <div
        style={{
          position: 'fixed',
          bottom: 24,
          left: 24,
          zIndex: 1100,
        }}
      >
        <Tooltip title="API Monitor" placement="right">
          <Badge count={newCount} size="small" offset={[-4, 4]} overflowCount={99}>
            <button
              onClick={handleOpen}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 14px',
                borderRadius: 20,
                border: '1px solid rgba(0,0,0,0.15)',
                background: '#1f1f2e',
                color: '#fff',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
                boxShadow: '0 2px 8px rgba(0,0,0,0.28)',
              }}
            >
              <ApiOutlined style={{ fontSize: 16 }} />
              <span>API</span>
              <span
                style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: dotColor(calls),
                  display: 'inline-block',
                  boxShadow: calls.length > 0 ? `0 0 4px ${dotColor(calls)}` : 'none',
                }}
              />
            </button>
          </Badge>
        </Tooltip>
      </div>

      <Drawer
        title={
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Space>
              <ApiOutlined />
              <span>API Monitor</span>
              <Tag style={{ marginLeft: 4 }}>{calls.length} calls</Tag>
            </Space>
            <Button
              size="small"
              icon={<ClearOutlined />}
              onClick={handleClear}
              danger
            >
              Clear
            </Button>
          </Space>
        }
        placement="right"
        width={460}
        open={open}
        onClose={handleClose}
        closeIcon={<CloseOutlined />}
        bodyStyle={{ padding: '0', overflowY: 'auto' }}
      >
        {/* Connection info panel */}
        <div style={{ padding: '12px 16px', background: '#f7f7f7', borderBottom: '1px solid #e5e5e5' }}>
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            <Space>
              <WifiOutlined style={{ color: '#0572CE' }} />
              <Text strong style={{ fontSize: 12 }}>APEX Base URL</Text>
            </Space>
            <Text code style={{ fontSize: 11, wordBreak: 'break-all' }}>{baseUrl}</Text>
          </Space>
        </div>

        <Divider style={{ margin: 0 }} />

        {/* Call list */}
        {calls.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#aaa' }}>
            <ApiOutlined style={{ fontSize: 32, marginBottom: 8 }} />
            <div>No API calls yet</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>Calls will appear as you navigate the app</div>
          </div>
        ) : (
          <div>
            {calls.map(c => (
              <div
                key={c.id}
                style={{
                  padding: '8px 16px',
                  borderBottom: '1px solid #f0f0f0',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                }}
              >
                {/* Method badge */}
                <Tag
                  style={{
                    minWidth: 54,
                    textAlign: 'center',
                    fontWeight: 700,
                    fontSize: 11,
                    background: METHOD_COLOR[c.method] || '#888',
                    color: '#fff',
                    border: 'none',
                    marginRight: 0,
                    flexShrink: 0,
                  }}
                >
                  {c.method}
                </Tag>

                {/* URL path */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Text
                    style={{ fontSize: 12, wordBreak: 'break-all', display: 'block' }}
                    title={c.url}
                  >
                    {c.path}
                  </Text>
                  <Text style={{ fontSize: 11, color: '#aaa' }}>
                    {c.timestamp.toLocaleTimeString()}
                    {c.durationMs !== null && ` · ${c.durationMs}ms`}
                  </Text>
                </div>

                {/* Status */}
                <Badge
                  status={statusBadgeColor(c.status)}
                  text={
                    <Text style={{ fontSize: 12, fontWeight: 600 }}>
                      {statusText(c.status)}
                    </Text>
                  }
                  style={{ flexShrink: 0 }}
                />
              </div>
            ))}
          </div>
        )}
      </Drawer>
    </>
  );
};

export default APIMonitor;
