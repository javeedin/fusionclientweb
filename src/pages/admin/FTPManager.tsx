// Administration > FTP Manager — FileZilla-style dual-pane file transfer.
// LEFT pane: the remote FTP/SFTP server. RIGHT pane: local files (this
// machine, browsed through the local proxy server). Transfers run as async
// jobs on the proxy (server/ftp-manager.cjs) with live progress polling.
// Directories transfer recursively, so the whole app build can be pushed to
// the hosting server in one click.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Layout, Card, Table, Button, Space, Typography, Breadcrumb, Tag, Input,
  Select, Tooltip, Modal, Form, Progress, Empty, message, Popconfirm,
} from 'antd';
import {
  HomeOutlined, CloudServerOutlined, FolderOutlined, FileOutlined,
  ArrowUpOutlined, ReloadOutlined, FolderAddOutlined, DeleteOutlined,
  DoubleLeftOutlined, DoubleRightOutlined, LinkOutlined, DisconnectOutlined,
  LaptopOutlined, SaveOutlined, CheckCircleOutlined, CloseCircleOutlined,
  LoadingOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { PROXY_CONFIG } from '../../config/api.config';
import FloatingMenu from '../../components/FloatingMenu';

const { Content } = Layout;
const { Title, Text } = Typography;

const REDWOOD = {
  primary: '#C74634', info: '#0572CE', success: '#1D7B4D', warning: '#D4A800',
  border: '#E5E5E5', textSecondary: '#6B6B6B', surface: '#FFFFFF',
};

const API = `${PROXY_CONFIG.baseUrl}/ftp`;

interface FsItem { name: string; type: 'd' | 'f'; size: number | null; modified: string | null }
interface TransferJob {
  jobId: string; label: string; direction: 'upload' | 'download';
  status: 'running' | 'done' | 'error';
  filesDone: number; totalFiles: number | null; currentFile: string; error?: string | null;
}
interface SavedConn { name: string; protocol: string; host: string; port?: number; username: string; password?: string }

const fmtSize = (n: number | null) => {
  if (n === null || n === undefined) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
};
const fmtDate = (v: string | null) =>
  v ? new Date(v).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

const post = async (url: string, body: unknown) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
};

// join paths for each side
const joinRemote = (dir: string, name: string) => (dir.endsWith('/') ? dir + name : `${dir}/${name}`);
const parentRemote = (dir: string) => {
  const parts = dir.split('/').filter(Boolean);
  parts.pop();
  return '/' + parts.join('/');
};

const SAVED_KEY = 'reerp_ftp_connections';

const FTPManager: React.FC = () => {
  // connection
  const [connForm] = Form.useForm();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connLabel, setConnLabel] = useState('');
  const [saved, setSaved] = useState<SavedConn[]>(() => {
    try { return JSON.parse(localStorage.getItem(SAVED_KEY) || '[]'); } catch { return []; }
  });

  // remote pane
  const [remotePath, setRemotePath] = useState('/');
  const [remotePathInput, setRemotePathInput] = useState('/');
  const [remoteItems, setRemoteItems] = useState<FsItem[]>([]);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteSel, setRemoteSel] = useState<string[]>([]);

  // local pane
  const [localPath, setLocalPath] = useState('');
  const [localPathInput, setLocalPathInput] = useState('');
  const [localItems, setLocalItems] = useState<FsItem[]>([]);
  const [localSep, setLocalSep] = useState('/');
  const [localRoots, setLocalRoots] = useState<{ label: string; path: string }[]>([]);
  const [localLoading, setLocalLoading] = useState(false);
  const [localSel, setLocalSel] = useState<string[]>([]);

  // transfers
  const [jobs, setJobs] = useState<TransferJob[]>([]);
  const jobsRef = useRef<TransferJob[]>([]);
  jobsRef.current = jobs;

  const joinLocal = useCallback(
    (dir: string, name: string) => (dir.endsWith(localSep) ? dir + name : dir + localSep + name),
    [localSep]);
  const parentLocal = useCallback((dir: string) => {
    const trimmed = dir.endsWith(localSep) && dir.length > 1 ? dir.slice(0, -1) : dir;
    const idx = trimmed.lastIndexOf(localSep);
    if (idx <= 0) return localSep === '\\' ? trimmed.slice(0, 3) : '/';
    const p = trimmed.slice(0, idx);
    return localSep === '\\' && p.endsWith(':') ? p + '\\' : (p || '/');
  }, [localSep]);

  // ── loading panes ─────────────────────────────────────────────────────────
  const loadLocal = useCallback(async (dir?: string) => {
    setLocalLoading(true);
    try {
      const d = await post(`${API}/local/list`, { path: dir || undefined });
      setLocalPath(d.path); setLocalPathInput(d.path);
      setLocalSep(d.sep || '/');
      setLocalRoots(d.roots || []);
      setLocalItems((d.items as FsItem[]).sort((a, b) =>
        a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'd' ? -1 : 1));
      setLocalSel([]);
    } catch (e: any) {
      message.error(`Local browse failed: ${e.message}`);
    }
    setLocalLoading(false);
  }, []);

  const loadRemote = useCallback(async (dir: string, sid?: string) => {
    const s = sid ?? sessionId;
    if (!s) return;
    setRemoteLoading(true);
    try {
      const d = await post(`${API}/remote/list`, { sessionId: s, path: dir });
      setRemotePath(d.path); setRemotePathInput(d.path);
      setRemoteItems((d.items as FsItem[])
        .filter(i => i.name !== '.' && i.name !== '..')
        .sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'd' ? -1 : 1));
      setRemoteSel([]);
    } catch (e: any) {
      message.error(`Remote browse failed: ${e.message}`);
    }
    setRemoteLoading(false);
  }, [sessionId]);

  useEffect(() => { loadLocal(); }, [loadLocal]);

  // ── connect / disconnect ──────────────────────────────────────────────────
  const handleConnect = async () => {
    const v = await connForm.validateFields();
    setConnecting(true);
    try {
      const d = await post(`${API}/connect`, {
        protocol: v.protocol, host: v.host.trim(), port: v.port || undefined,
        username: v.username.trim(), password: v.password,
      });
      setSessionId(d.sessionId);
      setConnLabel(`${v.protocol.toUpperCase()} ${v.username}@${v.host}`);
      message.success('Connected');
      await loadRemote('/', d.sessionId);
    } catch (e: any) {
      message.error(`Connect failed: ${e.message}`);
    }
    setConnecting(false);
  };

  const handleDisconnect = async () => {
    if (sessionId) { try { await post(`${API}/disconnect`, { sessionId }); } catch { /* gone */ } }
    setSessionId(null); setConnLabel('');
    setRemoteItems([]); setRemotePath('/'); setRemotePathInput('/'); setRemoteSel([]);
  };

  const saveConnection = async () => {
    const v = await connForm.validateFields(['protocol', 'host', 'username']);
    const all = connForm.getFieldsValue();
    const entry: SavedConn = {
      name: `${v.username}@${v.host}`, protocol: v.protocol, host: v.host,
      port: all.port || undefined, username: v.username, password: all.password || undefined,
    };
    const next = [...saved.filter(s => s.name !== entry.name), entry];
    setSaved(next);
    try { localStorage.setItem(SAVED_KEY, JSON.stringify(next)); } catch { /* full */ }
    message.success(`Saved "${entry.name}" (password stored locally in this browser)`);
  };

  const applySaved = (name: string) => {
    const s = saved.find(x => x.name === name);
    if (s) connForm.setFieldsValue({ protocol: s.protocol, host: s.host, port: s.port, username: s.username, password: s.password });
  };

  // ── transfers ─────────────────────────────────────────────────────────────
  const startTransfer = async (direction: 'upload' | 'download', names: string[]) => {
    if (!sessionId) { message.warning('Connect to a server first'); return; }
    if (!names.length) { message.warning(`Select ${direction === 'upload' ? 'local' : 'remote'} files or folders first`); return; }
    for (const name of names) {
      const localP = direction === 'upload' ? joinLocal(localPath, name) : joinLocal(localPath, name);
      const remoteP = joinRemote(remotePath, name);
      try {
        const d = await post(`${API}/transfer`, {
          sessionId, direction,
          localPath: localP,
          remotePath: remoteP,
        });
        setJobs(prev => [{
          jobId: d.jobId,
          label: direction === 'upload' ? `${name} → ${remoteP}` : `${remoteP} → ${localP}`,
          direction, status: 'running', filesDone: 0, totalFiles: null, currentFile: '',
        }, ...prev]);
      } catch (e: any) {
        message.error(`Transfer failed to start (${name}): ${e.message}`);
      }
    }
  };

  // poll running jobs
  useEffect(() => {
    const t = setInterval(async () => {
      const running = jobsRef.current.filter(j => j.status === 'running');
      if (!running.length) return;
      for (const j of running) {
        try {
          const res = await fetch(`${API}/job/${j.jobId}`);
          const d = await res.json();
          if (d.success) {
            setJobs(prev => prev.map(p => p.jobId === j.jobId
              ? { ...p, status: d.status, filesDone: d.filesDone, totalFiles: d.totalFiles, currentFile: d.currentFile, error: d.error }
              : p));
            if (d.status === 'done') {
              message.success(`Transfer complete: ${j.label}`);
              if (j.direction === 'upload') loadRemote(remotePath);
              else loadLocal(localPath);
            }
            if (d.status === 'error') message.error(`Transfer failed: ${d.error}`);
          }
        } catch { /* poll again */ }
      }
    }, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remotePath, localPath]);

  // ── pane rendering ────────────────────────────────────────────────────────
  const cols = (side: 'remote' | 'local') => ([
    {
      title: 'Name', dataIndex: 'name', ellipsis: true,
      render: (name: string, r: FsItem) => (
        <Space size={6} style={{ cursor: r.type === 'd' ? 'pointer' : 'default' }}>
          {r.type === 'd'
            ? <FolderOutlined style={{ color: REDWOOD.warning }} />
            : <FileOutlined style={{ color: REDWOOD.textSecondary }} />}
          <Text style={{ fontSize: 12 }}>{name}</Text>
        </Space>
      ),
    },
    { title: 'Size', dataIndex: 'size', width: 90, align: 'right' as const,
      render: (v: number | null, r: FsItem) => <Text type="secondary" style={{ fontSize: 11 }}>{r.type === 'd' ? '—' : fmtSize(v)}</Text> },
    { title: 'Modified', dataIndex: 'modified', width: 150,
      render: (v: string | null) => <Text type="secondary" style={{ fontSize: 11 }}>{fmtDate(v)}</Text> },
    ...(side === 'remote' ? [{
      title: '', key: 'del', width: 40,
      render: (_: unknown, r: FsItem) => (
        <Popconfirm title={`Delete ${r.name}?`} okText="Delete" okType="danger"
          onConfirm={async () => {
            try {
              await post(`${API}/remote/delete`, { sessionId, path: joinRemote(remotePath, r.name), isDir: r.type === 'd' });
              loadRemote(remotePath);
            } catch (e: any) { message.error(e.message); }
          }}>
          <Button type="text" size="small" danger icon={<DeleteOutlined />} />
        </Popconfirm>
      ),
    }] : []),
  ]);

  const pane = (side: 'remote' | 'local') => {
    const isRemote = side === 'remote';
    const items = isRemote ? remoteItems : localItems;
    const loading = isRemote ? remoteLoading : localLoading;
    const sel = isRemote ? remoteSel : localSel;
    const setSel = isRemote ? setRemoteSel : setLocalSel;
    const pathVal = isRemote ? remotePathInput : localPathInput;
    const setPathVal = isRemote ? setRemotePathInput : setLocalPathInput;
    const go = (p: string) => (isRemote ? loadRemote(p) : loadLocal(p));
    const up = () => (isRemote ? loadRemote(parentRemote(remotePath)) : loadLocal(parentLocal(localPath)));

    return (
      <Card
        size="small"
        style={{ flex: 1, minWidth: 0, borderRadius: 8, border: `1px solid ${REDWOOD.border}`, display: 'flex', flexDirection: 'column' }}
        styles={{ body: { padding: 10, display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 } }}
        title={
          <Space size={6}>
            {isRemote ? <CloudServerOutlined style={{ color: REDWOOD.info }} /> : <LaptopOutlined style={{ color: REDWOOD.success }} />}
            <Text strong style={{ fontSize: 13 }}>{isRemote ? 'Remote Server' : 'My Files (this computer)'}</Text>
            {isRemote && (sessionId
              ? <Tag color="green" style={{ fontSize: 10 }}>{connLabel}</Tag>
              : <Tag style={{ fontSize: 10 }}>not connected</Tag>)}
          </Space>
        }
        extra={!isRemote && localRoots.length > 0 && (
          <Select size="small" placeholder="Go to…" style={{ width: 110 }} value={undefined}
            options={localRoots.map(r => ({ value: r.path, label: r.label }))}
            onChange={(p) => loadLocal(p)} />
        )}
      >
        <Space.Compact style={{ width: '100%', marginBottom: 8 }}>
          <Tooltip title="Up one level">
            <Button size="small" icon={<ArrowUpOutlined />} onClick={up} disabled={isRemote && !sessionId} />
          </Tooltip>
          <Input size="small" value={pathVal} onChange={e => setPathVal(e.target.value)}
            onPressEnter={() => go(pathVal)} style={{ fontFamily: 'monospace', fontSize: 11 }}
            disabled={isRemote && !sessionId} />
          <Tooltip title="Refresh">
            <Button size="small" icon={<ReloadOutlined />} onClick={() => go(pathVal)} disabled={isRemote && !sessionId} />
          </Tooltip>
          {isRemote && (
            <Tooltip title="New remote folder">
              <Button size="small" icon={<FolderAddOutlined />} disabled={!sessionId}
                onClick={() => {
                  let name = '';
                  Modal.confirm({
                    title: 'New folder on server',
                    content: <Input placeholder="Folder name" onChange={e => { name = e.target.value; }} />,
                    onOk: async () => {
                      if (!name.trim()) return;
                      try { await post(`${API}/remote/mkdir`, { sessionId, path: joinRemote(remotePath, name.trim()) }); loadRemote(remotePath); }
                      catch (e: any) { message.error(e.message); }
                    },
                  });
                }} />
            </Tooltip>
          )}
        </Space.Compact>
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          <Table
            size="small"
            dataSource={items}
            columns={cols(side)}
            rowKey="name"
            loading={loading}
            pagination={false}
            rowSelection={{
              selectedRowKeys: sel,
              onChange: keys => setSel(keys as string[]),
            }}
            onRow={(r) => ({
              onDoubleClick: () => {
                if (r.type !== 'd') return;
                if (isRemote) loadRemote(joinRemote(remotePath, r.name));
                else loadLocal(joinLocal(localPath, r.name));
              },
            })}
            locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={isRemote && !sessionId ? 'Connect to browse the server' : 'Empty folder'} /> }}
          />
        </div>
      </Card>
    );
  };

  // ── page ──────────────────────────────────────────────────────────────────
  return (
    <Layout style={{ minHeight: '100vh', background: '#F7F7F7' }}>
      <Content style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
        <div style={{ padding: '10px 16px 0', flexShrink: 0 }}>
          <Breadcrumb items={[
            { title: <Link to="/home"><HomeOutlined /> Home</Link> },
            { title: <Link to="/admin">Administration</Link> },
            { title: 'FTP Manager' },
          ]} />
          <Space align="center" style={{ margin: '8px 0' }}>
            <div style={{ width: 34, height: 34, borderRadius: 6, background: REDWOOD.info, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <CloudServerOutlined style={{ fontSize: 17, color: '#fff' }} />
            </div>
            <div>
              <Title level={4} style={{ margin: 0 }}>FTP Manager</Title>
              <Text type="secondary" style={{ fontSize: 12 }}>Transfer application files to the hosting server (SFTP / FTP / FTPS)</Text>
            </div>
          </Space>

          {/* ── Connection bar ── */}
          <Card size="small" style={{ borderRadius: 8, marginBottom: 10 }} styles={{ body: { padding: '8px 12px' } }}>
            <Form form={connForm} layout="inline" size="small"
              initialValues={{ protocol: 'sftp' }}>
              {saved.length > 0 && (
                <Form.Item label="Saved">
                  <Select size="small" placeholder="Load…" style={{ width: 190 }} value={undefined}
                    options={saved.map(s => ({ value: s.name, label: s.name }))}
                    onChange={applySaved} allowClear />
                </Form.Item>
              )}
              <Form.Item name="protocol" rules={[{ required: true }]}>
                <Select style={{ width: 90 }} options={[
                  { value: 'sftp', label: 'SFTP' },
                  { value: 'ftp', label: 'FTP' },
                  { value: 'ftps', label: 'FTPS' },
                ]} />
              </Form.Item>
              <Form.Item name="host" rules={[{ required: true, message: 'Host required' }]}>
                <Input placeholder="Host / IP (e.g. 145.241.119.134)" style={{ width: 220 }} />
              </Form.Item>
              <Form.Item name="port">
                <Input placeholder="Port" style={{ width: 80 }} />
              </Form.Item>
              <Form.Item name="username" rules={[{ required: true, message: 'User required' }]}>
                <Input placeholder="Username" style={{ width: 130 }} autoComplete="off" />
              </Form.Item>
              <Form.Item name="password">
                <Input.Password placeholder="Password" style={{ width: 150 }} autoComplete="new-password" />
              </Form.Item>
              <Form.Item>
                <Space size={6}>
                  {!sessionId ? (
                    <Button type="primary" size="small" icon={<LinkOutlined />} loading={connecting}
                      onClick={handleConnect} style={{ background: REDWOOD.primary }}>
                      Connect
                    </Button>
                  ) : (
                    <Button size="small" danger icon={<DisconnectOutlined />} onClick={handleDisconnect}>
                      Disconnect
                    </Button>
                  )}
                  <Tooltip title="Save this connection in this browser">
                    <Button size="small" icon={<SaveOutlined />} onClick={saveConnection} />
                  </Tooltip>
                </Space>
              </Form.Item>
            </Form>
          </Card>
        </div>

        {/* ── Dual panes ── */}
        <div style={{ display: 'flex', gap: 10, padding: '0 16px', flex: 1, minHeight: 0 }}>
          {pane('remote')}

          {/* transfer buttons */}
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 10, flexShrink: 0 }}>
            <Tooltip title="Upload selected local files/folders to the current remote folder" placement="left">
              <Button type="primary" icon={<DoubleLeftOutlined />} style={{ background: REDWOOD.info }}
                disabled={!sessionId || localSel.length === 0}
                onClick={() => startTransfer('upload', localSel)}>
                Upload
              </Button>
            </Tooltip>
            <Tooltip title="Download selected remote files/folders to the current local folder" placement="left">
              <Button icon={<DoubleRightOutlined />}
                disabled={!sessionId || remoteSel.length === 0}
                onClick={() => startTransfer('download', remoteSel)}>
                Download
              </Button>
            </Tooltip>
          </div>

          {pane('local')}
        </div>

        {/* ── Transfer queue ── */}
        <div style={{ padding: '8px 16px 12px', flexShrink: 0 }}>
          <Card size="small" style={{ borderRadius: 8 }} styles={{ body: { padding: '6px 12px', maxHeight: 150, overflow: 'auto' } }}
            title={<Text strong style={{ fontSize: 12 }}>Transfers ({jobs.filter(j => j.status === 'running').length} active)</Text>}
            extra={jobs.length > 0 && (
              <Button size="small" type="text" onClick={() => setJobs(prev => prev.filter(j => j.status === 'running'))}>
                Clear finished
              </Button>
            )}>
            {jobs.length === 0 && <Text type="secondary" style={{ fontSize: 11 }}>No transfers yet — select files and press Upload or Download.</Text>}
            {jobs.map(j => (
              <div key={j.jobId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '3px 0', borderBottom: '1px solid #f5f5f5' }}>
                {j.status === 'running' && <LoadingOutlined style={{ color: REDWOOD.info }} />}
                {j.status === 'done' && <CheckCircleOutlined style={{ color: REDWOOD.success }} />}
                {j.status === 'error' && <CloseCircleOutlined style={{ color: REDWOOD.primary }} />}
                <Tag color={j.direction === 'upload' ? 'blue' : 'green'} style={{ fontSize: 9 }}>{j.direction.toUpperCase()}</Tag>
                <Text style={{ fontSize: 11, fontFamily: 'monospace', flex: '0 1 auto', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {j.label}
                </Text>
                <div style={{ flex: 1, minWidth: 120 }}>
                  {j.status === 'running' && (
                    j.totalFiles
                      ? <Progress size="small" percent={Math.min(99, Math.round((j.filesDone / j.totalFiles) * 100))} />
                      : <Progress size="small" percent={99} status="active" showInfo={false} />
                  )}
                  {j.status === 'done' && <Text type="secondary" style={{ fontSize: 10 }}>{j.filesDone} file{j.filesDone !== 1 ? 's' : ''} transferred</Text>}
                  {j.status === 'error' && <Text type="danger" style={{ fontSize: 10 }}>{j.error}</Text>}
                </div>
                {j.status === 'running' && j.currentFile && (
                  <Text type="secondary" style={{ fontSize: 10, maxWidth: 220, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {j.currentFile}
                  </Text>
                )}
              </div>
            ))}
          </Card>
        </div>
      </Content>
      <FloatingMenu />
    </Layout>
  );
};

export default FTPManager;
