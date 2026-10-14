// API icon content: every call an action makes (or will make) — method, full URL, JSON request body and the
// response — each copyable. Gateway reads are folded away unless asked for.
import React, { useState } from 'react';
import { Button, Checkbox, Empty, Tag, Tooltip, Typography, message } from 'antd';
import { CopyOutlined } from '@ant-design/icons';
import type { ApiCall } from '../services/apiCallRecorder';

const { Text } = Typography;
const METHOD_COLOR: Record<string, string> = { GET: 'blue', POST: 'green', PUT: 'orange', DELETE: 'red' };
const pretty = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v, null, 2));
const copy = (t: string) => navigator.clipboard?.writeText(t).then(() => message.success('Copied'), () => message.error('Copy failed'));
const isRead = (c: ApiCall) => /^Read the GL|^Check SLA|^Load revaluation/.test(c.step);

const Block: React.FC<{ title: string; value: unknown; open?: boolean }> = ({ title, value, open }) => (
  <details open={open} style={{ marginTop: 8 }}>
    <summary style={{ cursor: 'pointer', fontSize: 12, color: '#595959', userSelect: 'none' }}>
      {title}
      <Tooltip title="Copy"><Button size="small" type="text" icon={<CopyOutlined />} style={{ marginLeft: 4 }}
        onClick={e => { e.preventDefault(); copy(pretty(value)); }} /></Tooltip>
    </summary>
    <pre style={{ margin: '6px 0 0', background: '#1f1f1f', color: '#d4d4d4', padding: 10, borderRadius: 6, fontSize: 11,
      maxHeight: 360, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{pretty(value)}</pre>
  </details>
);

const ApiCallList: React.FC<{ calls: ApiCall[] }> = ({ calls }) => {
  const [showReads, setShowReads] = useState(false);
  const reads = calls.filter(isRead).length;
  const shown = showReads ? calls : calls.filter(c => !isRead(c));
  return (
    <div>
      {reads > 0 && (
        <Checkbox checked={showReads} onChange={e => setShowReads(e.target.checked)} style={{ marginBottom: 10, fontSize: 12 }}>
          Show the {reads} read{reads === 1 ? '' : 's'} (GL queries, SLA check)
        </Checkbox>
      )}
      {!shown.length && <Empty description="No calls" />}
      {shown.map((c, i) => {
        const ok = c.status == null ? null : c.status < 400;
        return (
          <div key={i} style={{ border: '1px solid #e5e5e5', borderRadius: 8, marginBottom: 10, overflow: 'hidden' }}>
            <div style={{ padding: '6px 12px', background: '#fafafa', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Text strong style={{ fontSize: 13 }}>{i + 1}. {c.step}</Text>
              <span style={{ flex: 1 }} />
              {c.status != null
                ? <Tag color={ok ? 'success' : 'error'} style={{ marginInlineEnd: 0 }}>HTTP {c.status}{c.ms != null ? ` · ${c.ms} ms` : ''}</Tag>
                : <Tag style={{ marginInlineEnd: 0 }}>will be sent</Tag>}
            </div>
            <div style={{ padding: '8px 12px' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <Tag color={METHOD_COLOR[c.method] || 'default'} style={{ fontFamily: 'monospace', marginInlineEnd: 0 }}>{c.method}</Tag>
                <Text style={{ fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all', flex: 1 }}>{c.url}</Text>
                <Tooltip title="Copy URL"><Button size="small" icon={<CopyOutlined />} onClick={() => copy(c.url)} /></Tooltip>
              </div>
              {c.body !== undefined && <Block title="Request body (JSON)" value={c.body} open={c.method === 'POST' && !isRead(c)} />}
              {c.response !== undefined && c.response !== null && <Block title="Response" value={c.response} open={ok === false} />}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default ApiCallList;
