import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Card, Collapse, Input, Space, Tag, Tooltip, Typography, message } from 'antd';
import {
  CaretRightOutlined, ExportOutlined, FileTextOutlined, LinkOutlined,
  PoweroffOutlined, ReloadOutlined, RobotOutlined, SettingOutlined,
} from '@ant-design/icons';

const { Text, Paragraph } = Typography;

const LS_KEY = 'librechat_url';
const DEFAULT_URL =
  (import.meta as any).env?.VITE_LIBRECHAT_URL || 'http://localhost:3080';

const readSavedUrl = (): string => {
  try { return localStorage.getItem(LS_KEY) || DEFAULT_URL; } catch { return DEFAULT_URL; }
};

interface LcStatus {
  dockerInstalled: boolean;
  dockerRunning: boolean;
  starting: boolean;
  reachable: boolean;
  url: string;
  dir: string;
  envExists: boolean;
}

const electronAPI: any = (window as any).electronAPI;
const isElectron = !!electronAPI?.libreChatStatus;

/**
 * Embeds a self-hosted LibreChat. In Electron the app manages the whole
 * lifecycle itself: Start provisions userData/librechat (.env from the saved
 * GL MCP credentials incl. the Claude key, gl-mcp-server.cjs registered as
 * MCP server "oracle-gl") and runs docker compose up -d; Open in App Window
 * shows it in a native Electron window. In a plain browser it falls back to
 * the manual librechat/ folder setup (see librechat/README.md).
 */
const LibreChatPage: React.FC = () => {
  const [url, setUrl] = useState<string>(readSavedUrl);
  const [draftUrl, setDraftUrl] = useState<string>(readSavedUrl);
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [frameKey, setFrameKey] = useState(0);
  const [lcStatus, setLcStatus] = useState<LcStatus | null>(null);
  const [startBusy, setStartBusy] = useState(false);
  const [stopBusy, setStopBusy] = useState(false);
  const [lcLogs, setLcLogs] = useState('');
  const startBusyRef = useRef(false);

  const refreshStatus = useCallback(async () => {
    if (isElectron) {
      try {
        const s = await electronAPI.libreChatStatus();
        if (s?.success !== false) {
          setLcStatus(s);
          setReachable(!!s.reachable);
          return;
        }
      } catch { /* fall back to fetch check below */ }
    }
    try {
      await fetch(url, { mode: 'no-cors', cache: 'no-store' });
      setReachable(true);
    } catch {
      setReachable(false);
    }
  }, [url]);

  const refreshLogs = useCallback(async () => {
    if (!isElectron) return;
    try {
      const r = await electronAPI.libreChatGetLogs();
      if (r?.success) setLcLogs(r.logs || '');
    } catch { /* ignore */ }
  }, []);

  // poll status (faster while a start is in flight)
  useEffect(() => {
    refreshStatus();
    const t = setInterval(() => {
      refreshStatus();
      if (startBusyRef.current) refreshLogs();
    }, 5000);
    return () => clearInterval(t);
  }, [refreshStatus, refreshLogs]);

  const handleStart = async () => {
    setStartBusy(true);
    startBusyRef.current = true;
    message.info('Starting LibreChat — the first run downloads Docker images and can take a few minutes…');
    try {
      const r = await electronAPI.libreChatStart({});
      if (r?.success) {
        message.success('LibreChat is running');
        if (!r.hasClaudeKey) {
          message.warning('No saved Claude key found — set your Anthropic key inside LibreChat (Settings → API keys), or save credentials under Admin → GL MCP first.', 8);
        }
        setFrameKey(k => k + 1);
      } else {
        message.error(r?.error || 'Failed to start LibreChat', 8);
      }
    } catch (e: any) {
      message.error(e?.message || 'Failed to start LibreChat');
    } finally {
      setStartBusy(false);
      startBusyRef.current = false;
      refreshStatus();
      refreshLogs();
    }
  };

  const handleStop = async () => {
    setStopBusy(true);
    try {
      const r = await electronAPI.libreChatStop();
      if (r?.success) message.success('LibreChat stopped');
      else message.error(r?.error || 'Failed to stop LibreChat');
    } finally {
      setStopBusy(false);
      refreshStatus();
    }
  };

  const openExternal = () => {
    if (isElectron) electronAPI.libreChatOpenWindow();
    else window.open(url, '_blank', 'noopener');
  };

  const applyUrl = () => {
    const clean = draftUrl.trim().replace(/\/+$/, '');
    if (!clean) return;
    try { localStorage.setItem(LS_KEY, clean); } catch { /* ignore */ }
    setUrl(clean);
    setFrameKey(k => k + 1);
  };

  const dockerProblem = isElectron && lcStatus && (!lcStatus.dockerInstalled || !lcStatus.dockerRunning);

  const helpItems = useMemo(() => ([
    {
      key: 'setup',
      label: isElectron ? 'What the Start button does / manual setup' : 'How to start LibreChat (one-time setup)',
      children: (
        <Paragraph style={{ marginBottom: 0 }}>
          {isElectron && (
            <>
              <Text strong>Start LibreChat</Text> provisions everything automatically: it writes the
              LibreChat config into your app data folder, generates <Text code>.env</Text> from the saved
              GL MCP credentials (including the Claude API key fetched from Oracle), registers{' '}
              <Text code>gl-mcp-server.cjs</Text> as MCP server <Tag style={{ marginInlineEnd: 0 }}>oracle-gl</Tag>,
              and runs <Text code>docker compose up -d</Text>. Requirement: <Text strong>Docker Desktop</Text> must
              be installed and running.
              <br /><br />
              Manual alternative (from the repo):
            </>
          )}
          <ol style={{ paddingLeft: 18, marginBottom: 8, marginTop: isElectron ? 8 : 0 }}>
            <li><Text code>cd librechat</Text> (folder in this repo)</li>
            <li><Text code>cp .env.example .env</Text> — set <Text code>ANTHROPIC_API_KEY</Text> (your sk-ant-… key),
              ORDS credentials, and regenerate the secrets (commands are in the file)</li>
            <li><Text code>docker compose up -d</Text></li>
            <li>Open <Text code>{DEFAULT_URL}</Text>, register a local account, pick the
              <Text strong> Claude (Oracle ERP)</Text> endpoint</li>
            <li>In the chat input, open the tools selector and enable <Tag style={{ marginInlineEnd: 0 }}>oracle-gl</Tag></li>
          </ol>
          Full details: <Text code>librechat/README.md</Text>.
        </Paragraph>
      ),
    },
    ...(isElectron ? [{
      key: 'logs',
      label: 'Startup logs',
      children: (
        <pre style={{ maxHeight: 240, overflow: 'auto', fontSize: 11, background: '#1e1e1e', color: '#d4d4d4', padding: 10, borderRadius: 6, marginBottom: 0 }}>
          {lcLogs || 'No logs yet — press Start LibreChat.'}
        </pre>
      ),
    }] : []),
  ]), [lcLogs]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 112px)', gap: 8 }}>
      <Card size="small" styles={{ body: { padding: '8px 12px' } }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <RobotOutlined style={{ fontSize: 18, color: '#7B5EA7' }} />
          <Text strong>LibreChat AI Chat</Text>
          <Tag color={reachable === true ? 'green' : reachable === false ? 'red' : 'default'}>
            {reachable === true ? 'Running' : reachable === false ? 'Not running' : 'Checking…'}
          </Tag>
          {isElectron && lcStatus && !lcStatus.dockerInstalled && <Tag color="red">Docker not installed</Tag>}
          {isElectron && lcStatus?.dockerInstalled && !lcStatus.dockerRunning && <Tag color="orange">Docker Desktop not running</Tag>}
          <div style={{ flex: 1 }} />
          {isElectron && !reachable && (
            <Tooltip title="Provision config + credentials and run docker compose up -d">
              <Button type="primary" icon={<CaretRightOutlined />} loading={startBusy} disabled={!!dockerProblem} onClick={handleStart}>
                Start LibreChat
              </Button>
            </Tooltip>
          )}
          {isElectron && reachable && (
            <Tooltip title="docker compose down">
              <Button danger icon={<PoweroffOutlined />} loading={stopBusy} onClick={handleStop}>Stop</Button>
            </Tooltip>
          )}
          {!isElectron && (
            <Space.Compact>
              <Input
                prefix={<LinkOutlined />}
                style={{ width: 260 }}
                value={draftUrl}
                onChange={e => setDraftUrl(e.target.value)}
                onPressEnter={applyUrl}
                placeholder={DEFAULT_URL}
              />
              <Tooltip title="Save URL and reload the embedded chat">
                <Button icon={<SettingOutlined />} onClick={applyUrl}>Apply</Button>
              </Tooltip>
            </Space.Compact>
          )}
          <Tooltip title="Reload the embedded chat">
            <Button icon={<ReloadOutlined />} onClick={() => { setFrameKey(k => k + 1); refreshStatus(); }} />
          </Tooltip>
          <Button icon={<ExportOutlined />} onClick={openExternal} disabled={!reachable}>
            {isElectron ? 'Open in App Window' : 'Open in New Window'}
          </Button>
          {isElectron && (
            <Tooltip title="Show startup logs">
              <Button icon={<FileTextOutlined />} onClick={refreshLogs} />
            </Tooltip>
          )}
        </div>
      </Card>

      {reachable === false && (
        <Alert
          type={dockerProblem ? 'error' : 'warning'}
          showIcon
          message={
            dockerProblem
              ? (lcStatus!.dockerInstalled
                  ? 'Docker Desktop is installed but not running — start it, then press Start LibreChat.'
                  : 'Docker is not installed — install Docker Desktop from docker.com, then press Start LibreChat.')
              : isElectron
                ? 'LibreChat is not running — press Start LibreChat above.'
                : `LibreChat is not running at ${url}`
          }
          description={<Collapse ghost items={helpItems} defaultActiveKey={startBusy ? ['logs'] : ['setup']} />}
        />
      )}

      <div style={{ flex: 1, minHeight: 0, border: '1px solid #E8E8E8', borderRadius: 10, overflow: 'hidden', background: '#fff' }}>
        {reachable ? (
          <iframe
            key={frameKey}
            src={url}
            title="LibreChat"
            style={{ width: '100%', height: '100%', border: 'none' }}
            allow="clipboard-read; clipboard-write; microphone"
          />
        ) : (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, color: '#999' }}>
            <RobotOutlined style={{ fontSize: 48 }} />
            <Text type="secondary">
              {startBusy ? 'Starting LibreChat — first run downloads Docker images, please wait…' : 'The chat will appear here once LibreChat is running.'}
            </Text>
          </div>
        )}
      </div>
    </div>
  );
};

export default LibreChatPage;
