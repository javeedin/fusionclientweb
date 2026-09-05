import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Space, Tag, Tooltip, Typography, message } from 'antd';
import {
  CaretRightOutlined, CodeOutlined, CopyOutlined, PoweroffOutlined, ReloadOutlined,
} from '@ant-design/icons';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

const { Text, Paragraph } = Typography;

interface CliStatus {
  installed?: boolean; version?: string; running?: boolean; workspace?: string;
  ptyReady?: boolean; ptyError?: string;
}

interface ClaudeCliApi {
  claudeCliStatus: () => Promise<CliStatus & { success: boolean; error?: string }>;
  claudeCliStart: (opts: { cols: number; rows: number }) => Promise<{ success: boolean; error?: string; alreadyRunning?: boolean }>;
  claudeCliStop: () => Promise<{ success: boolean }>;
  claudeCliInput: (data: string) => void;
  claudeCliResize: (cols: number, rows: number) => void;
  onClaudeCliData: (cb: (e: unknown, data: string) => void) => void;
  onClaudeCliExit: (cb: (e: unknown, code: number) => void) => void;
  removeClaudeCliListeners: () => void;
}

const getApi = (): ClaudeCliApi | undefined => {
  const api = (window as unknown as { electronAPI?: Partial<ClaudeCliApi> }).electronAPI;
  return api?.claudeCliStatus ? (api as ClaudeCliApi) : undefined;
};

const INSTALL_CMD = 'npm install -g @anthropic-ai/claude-code';

/**
 * Embedded Claude Code CLI terminal — Claude on your Pro/Max SUBSCRIPTION
 * (no API tokens), wired to the app's local MCP servers (.mcp.json in the
 * provisioned workspace) so it can query live ERP data.
 */
const ClaudeCliTerminal: React.FC = () => {
  const api = getApi();
  const termHostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [status, setStatus] = useState<CliStatus | null>(null);
  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);

  const refreshStatus = useCallback(async () => {
    if (!api) return;
    const s = await api.claudeCliStatus();
    setStatus(s);
    setRunning(!!s.running);
  }, [api]);

  useEffect(() => { refreshStatus(); }, [refreshStatus]);

  // build the terminal once
  useEffect(() => {
    if (!termHostRef.current || termRef.current) return;
    const term = new Terminal({
      fontSize: 13,
      fontFamily: 'Consolas, "Cascadia Mono", Menlo, monospace',
      cursorBlink: true,
      theme: { background: '#1e1e1e', foreground: '#d4d4d4', cursor: '#C74634' },
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(termHostRef.current);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    term.onData(data => getApi()?.claudeCliInput(data));

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
        getApi()?.claudeCliResize(term.cols, term.rows);
      } catch { /* ignore */ }
    });
    ro.observe(termHostRef.current);

    return () => {
      ro.disconnect();
      term.dispose();
      termRef.current = null;
    };
  }, []);

  // pty → terminal
  useEffect(() => {
    if (!api) return;
    api.onClaudeCliData((_e, data) => termRef.current?.write(data));
    api.onClaudeCliExit((_e, code) => {
      termRef.current?.writeln(`\r\n\x1b[31m[claude exited (code ${code}) — press Start to relaunch]\x1b[0m`);
      setRunning(false);
    });
    return () => api.removeClaudeCliListeners();
  }, [api]);

  const start = async () => {
    if (!api || !termRef.current) return;
    setStarting(true);
    try {
      fitRef.current?.fit();
      const r = await api.claudeCliStart({ cols: termRef.current.cols, rows: termRef.current.rows });
      if (!r.success) { message.error(r.error || 'Could not start claude'); return; }
      if (!r.alreadyRunning) termRef.current.clear();
      setRunning(true);
      termRef.current.focus();
    } finally {
      setStarting(false);
      refreshStatus();
    }
  };

  const stop = async () => {
    await api?.claudeCliStop();
    setRunning(false);
    refreshStatus();
  };

  if (!api) {
    return (
      <div style={{ padding: 24 }}>
        <Alert type="warning" showIcon message="Claude Code CLI is only available in the desktop (Electron) app"
          description="Open Re-ERP as the desktop application to use the embedded Claude terminal." />
      </div>
    );
  }

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', height: 'calc(100vh - 96px)', gap: 10 }}>
      <Card size="small" styles={{ body: { padding: '8px 12px' } }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <CodeOutlined style={{ fontSize: 18, color: '#C74634' }} />
          <Text strong>Claude Code CLI</Text>
          <Tag color={status?.installed ? 'green' : 'red'}>
            {status === null ? 'checking…' : status.installed ? (status.version || 'installed') : 'not installed'}
          </Tag>
          <Tag color={running ? 'green' : 'default'}>{running ? 'running' : 'stopped'}</Tag>
          <Text type="secondary" style={{ fontSize: 11 }}>
            Subscription-billed · MCP: oracle-gl, ar, ar-balances, inventory, registry
          </Text>
          <div style={{ flex: 1 }} />
          {!running ? (
            <Button type="primary" icon={<CaretRightOutlined />} loading={starting}
              disabled={status !== null && !status.installed} onClick={start}>
              Start
            </Button>
          ) : (
            <Button danger icon={<PoweroffOutlined />} onClick={stop}>Stop</Button>
          )}
          <Tooltip title="Refresh status"><Button icon={<ReloadOutlined />} onClick={refreshStatus} /></Tooltip>
        </div>
      </Card>

      {status !== null && status.ptyReady === false && (
        <Alert
          type="error"
          showIcon
          message="Terminal module not installed"
          description={
            <span>
              Run <Text code>npm install</Text> in the project folder and restart the app
              (this installs the embedded-terminal native module). Error: {status.ptyError}
            </span>
          }
        />
      )}

      {status !== null && !status.installed && (
        <Alert
          type="info"
          showIcon
          message="Install the Claude Code CLI first (one time)"
          description={
            <Paragraph style={{ marginBottom: 0 }}>
              Run this in any terminal, then press Refresh:
              <br />
              <Text code>{INSTALL_CMD}</Text>
              <Button size="small" type="text" icon={<CopyOutlined />}
                onClick={() => { navigator.clipboard.writeText(INSTALL_CMD); message.success('Copied'); }} />
              <br />
              <Text type="secondary" style={{ fontSize: 12 }}>
                Needs Node.js 18+. On first Start, run <Text code>/login</Text> inside the terminal to sign in with
                your Claude (Pro/Max) account — usage bills to the subscription, not API tokens. Type{' '}
                <Text code>/mcp</Text> to see the ERP tools; approve them when prompted.
              </Text>
            </Paragraph>
          }
        />
      )}

      <div
        ref={termHostRef}
        style={{ flex: 1, minHeight: 0, background: '#1e1e1e', borderRadius: 10, padding: 8, overflow: 'hidden' }}
        onClick={() => termRef.current?.focus()}
      />
    </div>
  );
};

export default ClaudeCliTerminal;
