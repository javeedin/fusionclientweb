import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Collapse, Input, Space, Tag, Tooltip, Typography } from 'antd';
import {
  ExportOutlined, LinkOutlined, ReloadOutlined, RobotOutlined, SettingOutlined,
} from '@ant-design/icons';

const { Text, Paragraph } = Typography;

const LS_KEY = 'librechat_url';
const DEFAULT_URL =
  (import.meta as any).env?.VITE_LIBRECHAT_URL || 'http://localhost:3080';

const readSavedUrl = (): string => {
  try { return localStorage.getItem(LS_KEY) || DEFAULT_URL; } catch { return DEFAULT_URL; }
};

/**
 * Embeds a self-hosted LibreChat instance (librechat/ folder in this repo:
 * docker compose up -d). LibreChat talks to Claude with the Anthropic API key
 * and runs electron/gl-mcp-server.cjs as an MCP server, so the chat has the
 * same GL tools as Claude Desktop.
 */
const LibreChatPage: React.FC = () => {
  const [url, setUrl] = useState<string>(readSavedUrl);
  const [draftUrl, setDraftUrl] = useState<string>(readSavedUrl);
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [frameKey, setFrameKey] = useState(0);

  const checkReachable = useCallback(async (target: string) => {
    setReachable(null);
    try {
      // no-cors: an opaque response still resolves if the server is up
      await fetch(target, { mode: 'no-cors', cache: 'no-store' });
      setReachable(true);
    } catch {
      setReachable(false);
    }
  }, []);

  useEffect(() => { checkReachable(url); }, [url, checkReachable]);

  const applyUrl = () => {
    const clean = draftUrl.trim().replace(/\/+$/, '');
    if (!clean) return;
    try { localStorage.setItem(LS_KEY, clean); } catch { /* ignore */ }
    setUrl(clean);
    setFrameKey(k => k + 1);
  };

  const helpItems = useMemo(() => ([
    {
      key: 'setup',
      label: 'How to start LibreChat (one-time setup)',
      children: (
        <Paragraph style={{ marginBottom: 0 }}>
          <ol style={{ paddingLeft: 18, marginBottom: 8 }}>
            <li><Text code>cd librechat</Text> (folder in this repo)</li>
            <li><Text code>cp .env.example .env</Text> — set <Text code>ANTHROPIC_API_KEY</Text> (your sk-ant-… key),
              ORDS credentials, and regenerate the secrets (commands are in the file)</li>
            <li><Text code>docker compose up -d</Text></li>
            <li>Open <Text code>{DEFAULT_URL}</Text>, register a local account, pick the
              <Text strong> Claude (Oracle ERP)</Text> endpoint</li>
            <li>In the chat input, open the tools selector and enable <Tag style={{ marginInlineEnd: 0 }}>oracle-gl</Tag> —
              that is <Text code>electron/gl-mcp-server.cjs</Text> running as an MCP server inside LibreChat</li>
          </ol>
          Full details: <Text code>librechat/README.md</Text>. If the embedded view stays blank
          (some browsers block iframes), use <Text strong>Open in New Window</Text>.
        </Paragraph>
      ),
    },
  ]), []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 112px)', gap: 8 }}>
      <Card size="small" styles={{ body: { padding: '8px 12px' } }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <RobotOutlined style={{ fontSize: 18, color: '#7B5EA7' }} />
          <Text strong>LibreChat AI Chat</Text>
          <Tag color={reachable === true ? 'green' : reachable === false ? 'red' : 'default'}>
            {reachable === true ? 'Server reachable' : reachable === false ? 'Server not reachable' : 'Checking…'}
          </Tag>
          <div style={{ flex: 1 }} />
          <Space.Compact>
            <Input
              prefix={<LinkOutlined />}
              style={{ width: 280 }}
              value={draftUrl}
              onChange={e => setDraftUrl(e.target.value)}
              onPressEnter={applyUrl}
              placeholder={DEFAULT_URL}
            />
            <Tooltip title="Save URL and reload the embedded chat">
              <Button icon={<SettingOutlined />} onClick={applyUrl}>Apply</Button>
            </Tooltip>
          </Space.Compact>
          <Tooltip title="Reload the embedded chat">
            <Button icon={<ReloadOutlined />} onClick={() => { setFrameKey(k => k + 1); checkReachable(url); }} />
          </Tooltip>
          <Button type="primary" icon={<ExportOutlined />} onClick={() => window.open(url, '_blank', 'noopener')}>
            Open in New Window
          </Button>
        </div>
      </Card>

      {reachable === false && (
        <Alert
          type="warning"
          showIcon
          message={`LibreChat is not running at ${url}`}
          description={<Collapse ghost items={helpItems} defaultActiveKey={['setup']} />}
        />
      )}

      <div style={{ flex: 1, minHeight: 0, border: '1px solid #E8E8E8', borderRadius: 10, overflow: 'hidden', background: '#fff' }}>
        <iframe
          key={frameKey}
          src={url}
          title="LibreChat"
          style={{ width: '100%', height: '100%', border: 'none' }}
          allow="clipboard-read; clipboard-write; microphone"
        />
      </div>
    </div>
  );
};

export default LibreChatPage;
