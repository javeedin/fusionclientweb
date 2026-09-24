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
  Checkbox, Descriptions, Badge, Alert,
} from 'antd';
import {
  HomeOutlined, CloudServerOutlined, FolderOutlined, FileOutlined,
  ArrowUpOutlined, ReloadOutlined, FolderAddOutlined, DeleteOutlined,
  DoubleLeftOutlined, DoubleRightOutlined, LinkOutlined, DisconnectOutlined,
  LaptopOutlined, SaveOutlined, CheckCircleOutlined, CloseCircleOutlined,
  LoadingOutlined, RocketOutlined, PoweroffOutlined, PlayCircleOutlined,
  SyncOutlined, DashboardOutlined, BuildOutlined, GlobalOutlined,
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
  note?: string | null;
}
interface ServerStatus {
  port: number; pid: number | null; process: string | null;
  running: boolean; portBusyByOther: boolean;
  taskInstalled: boolean; taskStatus: string | null;
  http: { ok: boolean; statusCode?: number; ms?: number; error?: string };
  checkedAt: string;
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
  const [connProtocol, setConnProtocol] = useState('');
  const [connHost, setConnHost] = useState('');
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
  const persistConnection = useCallback((v: { protocol: string; host: string; port?: string | number; username: string; password?: string }) => {
    const entry: SavedConn = {
      name: `${v.username.trim()}@${v.host.trim()}`,
      protocol: v.protocol,
      host: v.host.trim(),
      port: v.port ? Number(v.port) : undefined,
      username: v.username.trim(),
      password: v.password || undefined,
    };
    setSaved(prev => {
      const next = [...prev.filter(s => s.name !== entry.name), entry];
      try {
        localStorage.setItem(SAVED_KEY, JSON.stringify(next));
        localStorage.setItem(`${SAVED_KEY}_last`, entry.name);
      } catch { /* storage full/blocked */ }
      return next;
    });
    return entry;
  }, []);

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
      setConnProtocol(v.protocol);
      setConnHost(v.host.trim());
      // remember the full connection (incl. password and port) on every
      // successful connect, so next time one click reconnects
      persistConnection(v);
      message.success('Connected');
      await loadRemote('/', d.sessionId);
    } catch (e: any) {
      message.error(`Connect failed: ${e.message}`);
    }
    setConnecting(false);
  };

  const handleDisconnect = async () => {
    if (sessionId) { try { await post(`${API}/disconnect`, { sessionId }); } catch { /* gone */ } }
    setSessionId(null); setConnLabel(''); setConnProtocol(''); setConnHost(''); setSrvStatus(null);
    setRemoteItems([]); setRemotePath('/'); setRemotePathInput('/'); setRemoteSel([]);
  };

  const saveConnection = async () => {
    await connForm.validateFields(['protocol', 'host', 'username']);
    const all = connForm.getFieldsValue(true);
    const entry = persistConnection(all);
    message.success(`Saved "${entry.name}" with port and credentials (stored locally on this computer)`);
  };

  const applySaved = (name: string) => {
    const s = saved.find(x => x.name === name);
    if (!s) return;
    connForm.setFieldsValue({
      protocol: s.protocol, host: s.host,
      port: s.port != null ? String(s.port) : undefined,
      username: s.username, password: s.password,
    });
    try { localStorage.setItem(`${SAVED_KEY}_last`, s.name); } catch { /* ignore */ }
  };

  // restore the last-used connection into the form on page load
  useEffect(() => {
    try {
      const last = localStorage.getItem(`${SAVED_KEY}_last`);
      if (!last) return;
      const all: SavedConn[] = JSON.parse(localStorage.getItem(SAVED_KEY) || '[]');
      const s = all.find(x => x.name === last);
      if (s) connForm.setFieldsValue({
        protocol: s.protocol, host: s.host,
        port: s.port != null ? String(s.port) : undefined,
        username: s.username, password: s.password,
      });
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // ── deploy runtime (dist + server + package.json) ─────────────────────────
  const [deployOpen, setDeployOpen] = useState(false);
  const [deployDir, setDeployDir] = useState<string>(() => {
    try { return localStorage.getItem('reerp_ftp_deploy_dir') || 'C:/reerp'; } catch { return 'C:/reerp'; }
  });
  const [deployRestart, setDeployRestart] = useState<boolean>(() => {
    try { return localStorage.getItem('reerp_ftp_deploy_restart') !== 'N'; } catch { return true; }
  });
  const isSftp = connProtocol === 'sftp';
  const [deployBuildFirst, setDeployBuildFirst] = useState<boolean>(() => {
    try { return localStorage.getItem('reerp_ftp_deploy_build') === 'Y'; } catch { return false; }
  });

  // ── local build (npm run build on this machine) ────────────────────────────
  const [buildInfo, setBuildInfo] = useState<{ canBuild: boolean; distBuiltAt: string | null } | null>(null);
  const [buildOpen, setBuildOpen] = useState(false);
  const [buildJob, setBuildJob] = useState<{ id: string; status: 'running' | 'done' | 'error'; log: string[]; startedAt: number; finishedAt: number | null } | null>(null);
  const buildLogRef = useRef<HTMLPreElement>(null);

  const loadBuildInfo = useCallback(async () => {
    try {
      const d = await (await fetch(`${API}/local/build-info`)).json();
      if (d.success) {
        setBuildInfo({ canBuild: d.canBuild, distBuiltAt: d.distBuiltAt });
        if (d.running) setBuildJob(prev => prev?.id === d.running ? prev : { id: d.running, status: 'running', log: [], startedAt: Date.now(), finishedAt: null });
      }
    } catch { /* proxy not reachable */ }
  }, []);
  useEffect(() => { loadBuildInfo(); }, [loadBuildInfo]);

  const startBuild = async () => {
    setBuildOpen(true);
    try {
      const d = await post(`${API}/local/build`, {});
      setBuildJob({ id: d.jobId, status: 'running', log: [], startedAt: Date.now(), finishedAt: null });
    } catch (e: any) {
      message.error(`Build failed to start: ${e.message}`);
    }
  };

  // poll the running build
  useEffect(() => {
    if (!buildJob || buildJob.status !== 'running') return;
    const t = setInterval(async () => {
      try {
        const d = await (await fetch(`${API}/local/build/${buildJob.id}`)).json();
        if (!d.success) return;
        setBuildJob(prev => prev && prev.id === buildJob.id
          ? { ...prev, status: d.status, log: d.log, startedAt: d.startedAt, finishedAt: d.finishedAt }
          : prev);
        if (d.status !== 'running') {
          setBuildInfo(prev => ({ canBuild: prev?.canBuild ?? true, distBuiltAt: d.distBuiltAt }));
          if (d.status === 'done') message.success('Build finished — dist/ is ready to deploy');
          else message.error('Build failed — see the build log');
        }
      } catch { /* poll again */ }
    }, 1500);
    return () => clearInterval(t);
  }, [buildJob?.id, buildJob?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // keep the log scrolled to the newest line
  useEffect(() => {
    if (buildLogRef.current) buildLogRef.current.scrollTop = buildLogRef.current.scrollHeight;
  }, [buildJob?.log.length]);

  const buildRunning = buildJob?.status === 'running';
  const lastBuiltLabel = buildInfo?.distBuiltAt ? fmtDate(buildInfo.distBuiltAt) : 'never';
  const [deployLockCompany, setDeployLockCompany] = useState<string>(() => {
    try { return localStorage.getItem('reerp_ftp_deploy_lock_company') || ''; } catch { return ''; }
  });
  const startDeploy = async () => {
    if (!sessionId) { message.warning('Connect to a server first'); return; }
    const dir = deployDir.trim();
    if (!dir) { message.warning('Enter the remote target folder'); return; }
    const restartServer = isSftp && deployRestart;
    try {
      localStorage.setItem('reerp_ftp_deploy_dir', dir);
      localStorage.setItem('reerp_ftp_deploy_restart', deployRestart ? 'Y' : 'N');
      localStorage.setItem('reerp_ftp_deploy_build', deployBuildFirst ? 'Y' : 'N');
      localStorage.setItem('reerp_ftp_deploy_lock_company', deployLockCompany);
    } catch { /* ignore */ }
    try {
      const d = await post(`${API}/deploy-runtime`, { sessionId, remoteDir: dir, restartServer, buildFirst: deployBuildFirst && !!buildInfo?.canBuild, lockCompany: deployLockCompany || undefined });
      setJobs(prev => [{
        jobId: d.jobId,
        label: `Deploy runtime → ${dir}`,
        direction: 'upload', status: 'running', filesDone: 0, totalFiles: null, currentFile: '',
      }, ...prev]);
      setDeployOpen(false);
      const steps = [deployBuildFirst && buildInfo?.canBuild ? 'build' : '', restartServer ? 'stop server' : '', 'upload', restartServer ? 'start server' : ''].filter(Boolean);
      message.info(`Deploying: ${steps.join(' → ')}…`);
    } catch (e: any) {
      message.error(`Deploy failed to start: ${e.message}`);
    }
  };

  // ── hosting-server control (SSH commands over the SFTP connection) ────────
  const [srvOpen, setSrvOpen] = useState(false);
  const [srvStatus, setSrvStatus] = useState<ServerStatus | null>(null);
  const [srvBusy, setSrvBusy] = useState<string | null>(null); // 'status' | 'stop' | 'start' | 'restart' | 'npm'
  const [srvError, setSrvError] = useState<string | null>(null);
  const [srvNpmOutput, setSrvNpmOutput] = useState<string>('');

  const serverAction = useCallback(async (action: 'status' | 'stop' | 'start' | 'restart' | 'npm') => {
    if (!sessionId) { message.warning('Connect to the server first'); return; }
    const remoteDir = deployDir.trim();
    if (!remoteDir) { message.warning('Enter the server folder'); return; }
    setSrvBusy(action); setSrvError(null);
    try {
      if (action === 'npm') {
        setSrvNpmOutput('');
        const d = await post(`${API}/server/npm-install`, { sessionId, remoteDir });
        setSrvNpmOutput(d.output || '');
        message.success('npm install finished on the server');
      } else {
        if (action === 'stop' || action === 'restart') {
          setSrvStatus(await post(`${API}/server/stop`, { sessionId, remoteDir }));
        }
        if (action === 'start' || action === 'restart') {
          setSrvStatus(await post(`${API}/server/start`, { sessionId, remoteDir }));
        }
        if (action === 'status') {
          setSrvStatus(await post(`${API}/server/status`, { sessionId, remoteDir }));
        }
        if (action !== 'status') message.success(`Server ${action === 'restart' ? 'restarted' : action === 'stop' ? 'stopped' : 'started'}`);
      }
      try { localStorage.setItem('reerp_ftp_deploy_dir', remoteDir); } catch { /* ignore */ }
    } catch (e: any) {
      setSrvError(e.message);
      // refresh the picture after a failed stop/start
      if (action !== 'status' && action !== 'npm') {
        try { setSrvStatus(await post(`${API}/server/status`, { sessionId, remoteDir })); } catch { /* ignore */ }
      }
    }
    setSrvBusy(null);
  }, [sessionId, deployDir]);

  // ── open the hosted Re-ERP web portal in the browser ────────────────────────
  const portalUrl = (port: number) => `http://${connHost}${port && port !== 80 ? `:${port}` : ''}/`;
  const openPortal = async () => {
    if (!connHost) { message.warning('Connect to the server first'); return; }
    let port = srvStatus?.port;
    if (!port && isSftp && sessionId && deployDir.trim()) {
      // port.txt on the server decides the port — ask once
      try { port = (await post(`${API}/server/status`, { sessionId, remoteDir: deployDir.trim() })).port; } catch { /* default 80 */ }
    }
    const url = portalUrl(port || 80);
    try {
      await post(`${API}/open-browser`, { url });   // system default browser (works in the desktop app)
      message.success(`Opening ${url}`);
    } catch {
      window.open(url, '_blank', 'noopener');
    }
  };

  const openServerControl = () => {
    setSrvOpen(true);
    setSrvNpmOutput('');
    serverAction('status');
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
              ? { ...p, status: d.status, filesDone: d.filesDone, totalFiles: d.totalFiles, currentFile: d.currentFile, error: d.error, note: d.note }
              : p));
            if (d.status === 'done') {
              message.success(`Transfer complete: ${j.label}`);
              loadBuildInfo(); // a deploy may have run a build first
              if (d.note) {
                if (/did not start/i.test(d.note)) message.warning(d.note, 8);
                else message.success(d.note, 5);
              }
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
            <Tooltip placement="left" title={buildInfo?.canBuild === false
              ? 'Build needs the source folder with node_modules (not available in the packaged desktop app)'
              : `Run npm run build on this machine — last built: ${lastBuiltLabel}`}>
              <Button icon={buildRunning ? <LoadingOutlined /> : <BuildOutlined />}
                disabled={buildInfo?.canBuild === false}
                onClick={() => (buildRunning ? setBuildOpen(true) : startBuild())}>
                {buildRunning ? 'Building…' : 'Build'}
              </Button>
            </Tooltip>
            <Tooltip title="Push the web runtime (dist + server + package.json) from this machine's app folder to the server" placement="left">
              <Button icon={<RocketOutlined />} danger
                disabled={!sessionId}
                onClick={() => setDeployOpen(true)}>
                Deploy Runtime
              </Button>
            </Tooltip>
            <Tooltip title={isSftp ? 'Check, stop and start the Re-ERP web server on this host (no Remote Desktop needed)' : 'Server control needs an SFTP (SSH) connection'} placement="left">
              <Button icon={<DashboardOutlined />}
                disabled={!sessionId || !isSftp}
                onClick={openServerControl}>
                Server Control
              </Button>
            </Tooltip>
            <Tooltip title={connHost ? `Open the Re-ERP web portal (${portalUrl(srvStatus?.port || 80)}) in the browser` : 'Connect to the server first'} placement="left">
              <Button icon={<GlobalOutlined />} disabled={!connHost} onClick={openPortal}>
                Open Re-ERP Web Portal
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
                  {j.status === 'done' && (
                    <Text type={j.note && /did not start/i.test(j.note) ? 'warning' : 'secondary'} style={{ fontSize: 10 }}>
                      {j.filesDone} file{j.filesDone !== 1 ? 's' : ''} transferred{j.note ? ` — ${j.note}` : ''}
                    </Text>
                  )}
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

      {/* ── Deploy Runtime modal ── */}
      <Modal
        title={<Space><RocketOutlined style={{ color: REDWOOD.primary }} /> Deploy Runtime to Server</Space>}
        open={deployOpen}
        onCancel={() => setDeployOpen(false)}
        onOk={startDeploy}
        okText="Deploy"
        okButtonProps={{ style: { background: REDWOOD.primary, borderColor: REDWOOD.primary } }}
      >
        <Text style={{ fontSize: 12 }}>
          Uploads only what the hosting server needs to run the web app:
        </Text>
        <ul style={{ fontSize: 12, margin: '8px 0 12px', paddingLeft: 20 }}>
          <li><Text code>dist/</Text> — the built web application (run <Text code>npm run build</Text> first)</li>
          <li><Text code>server/</Text> — the proxy server (serves the app + APIs)</li>
          <li><Text code>package.json</Text> — for <Text code>npm install --omit=dev</Text> on the server</li>
          <li><Text code>1-setup.bat … 4-restart.bat</Text> — server-side helper scripts</li>
          <li><Text code>deploy-config.json</Text> — company lock below (<Text code>port.txt</Text> on the server is left as is)</li>
        </ul>
        <Form layout="vertical">
          <Form.Item label="Remote target folder" style={{ marginBottom: 8 }}>
            <Input value={deployDir} onChange={e => setDeployDir(e.target.value)} placeholder="C:/reerp" />
          </Form.Item>
          <Form.Item style={{ marginBottom: 4 }}>
            <Checkbox checked={deployBuildFirst && !!buildInfo?.canBuild} disabled={!buildInfo?.canBuild}
              onChange={e => setDeployBuildFirst(e.target.checked)}>
              Build first (<Text code>npm run build</Text>) — last built: <b>{lastBuiltLabel}</b>
            </Checkbox>
          </Form.Item>
          <Form.Item style={{ marginBottom: 8 }}>
            <Checkbox checked={isSftp && deployRestart} disabled={!isSftp} onChange={e => setDeployRestart(e.target.checked)}>
              Stop the server before upload and start it again after
            </Checkbox>
            {!isSftp && <div><Text type="secondary" style={{ fontSize: 11 }}>Needs an SFTP connection</Text></div>}
          </Form.Item>
          <Form.Item label="Lock company (users on this server cannot switch)" style={{ marginBottom: 4 }}>
            <Select
              value={deployLockCompany}
              onChange={v => setDeployLockCompany(v)}
              style={{ width: 220 }}
              options={[
                { value: '', label: 'No lock — selectable' },
                { value: 'BUIMERC', label: 'BUIMERC' },
                { value: 'GRAYSINC', label: 'GRAYS INC' },
              ]}
            />
          </Form.Item>
        </Form>
        <Text type="secondary" style={{ fontSize: 11 }}>
          First deploy to a new server: run <Text code>1-setup.bat</Text> there once (as Administrator).
          After that, use <b>Server Control</b> here to stop / start / check the server.
        </Text>
      </Modal>

      {/* ── Build modal ── */}
      <Modal
        title={<Space><BuildOutlined style={{ color: REDWOOD.info }} /> Build web app (npm run build)</Space>}
        open={buildOpen}
        onCancel={() => setBuildOpen(false)}
        width={760}
        footer={[
          <Button key="again" icon={<BuildOutlined />} disabled={buildRunning || buildInfo?.canBuild === false} onClick={startBuild}>
            Build again
          </Button>,
          <Button key="deploy" type="primary" icon={<RocketOutlined />}
            disabled={buildRunning || buildJob?.status !== 'done' || !sessionId}
            style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}
            onClick={() => { setBuildOpen(false); setDeployOpen(true); }}>
            {sessionId ? 'Deploy now…' : 'Connect to deploy'}
          </Button>,
          <Button key="close" onClick={() => setBuildOpen(false)}>Close</Button>,
        ]}
      >
        <Space style={{ marginBottom: 8 }} wrap>
          {buildRunning && <Tag icon={<LoadingOutlined />} color="processing">Building…</Tag>}
          {buildJob?.status === 'done' && <Tag icon={<CheckCircleOutlined />} color="success">Build succeeded</Tag>}
          {buildJob?.status === 'error' && <Tag icon={<CloseCircleOutlined />} color="error">Build failed</Tag>}
          {buildJob && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {Math.round(((buildJob.finishedAt ?? Date.now()) - buildJob.startedAt) / 1000)}s
            </Text>
          )}
          <Text type="secondary" style={{ fontSize: 12 }}>dist/ last built: <b>{lastBuiltLabel}</b></Text>
        </Space>
        <pre ref={buildLogRef} style={{
          height: 320, overflow: 'auto', margin: 0, padding: 10, fontSize: 11, lineHeight: 1.45,
          background: '#1e1e1e', color: '#d4d4d4', borderRadius: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
        }}>
          {buildJob?.log.length ? buildJob.log.join('\n') : (buildRunning ? 'Starting npm run build…' : 'No build output yet.')}
        </pre>
        <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 8 }}>
          Runs in this machine's app folder. Pull the latest code first (<Text code>git pull</Text>) — the build uses whatever source is on disk.
        </Text>
      </Modal>

      {/* ── Server Control modal ── */}
      <Modal
        title={<Space><DashboardOutlined style={{ color: REDWOOD.info }} /> Server Control — {connLabel}</Space>}
        open={srvOpen}
        onCancel={() => setSrvOpen(false)}
        footer={<Button onClick={() => setSrvOpen(false)}>Close</Button>}
        width={640}
      >
        <Form layout="vertical">
          <Form.Item label="Re-ERP folder on the server" style={{ marginBottom: 12 }}>
            <Input value={deployDir} onChange={e => setDeployDir(e.target.value)} placeholder="C:/reerp"
              onPressEnter={() => serverAction('status')} />
          </Form.Item>
        </Form>

        {srvError && <Alert type="error" showIcon message={srvError} style={{ marginBottom: 12 }} closable onClose={() => setSrvError(null)} />}

        <Card size="small" loading={srvBusy === 'status' && !srvStatus} style={{ marginBottom: 12 }}>
          {srvStatus ? (
            <Descriptions size="small" column={2} labelStyle={{ fontSize: 12 }} contentStyle={{ fontSize: 12 }}>
              <Descriptions.Item label="Server" span={2}>
                {srvStatus.running
                  ? <Badge status="success" text={<b style={{ color: REDWOOD.success }}>Running</b>} />
                  : srvStatus.portBusyByOther
                    ? <Badge status="warning" text={`Port used by ${srvStatus.process}`} />
                    : <Badge status="error" text={<b style={{ color: REDWOOD.primary }}>Stopped</b>} />}
              </Descriptions.Item>
              <Descriptions.Item label="Port">{srvStatus.port} <Text type="secondary" style={{ fontSize: 11 }}>(port.txt)</Text></Descriptions.Item>
              <Descriptions.Item label="Process">{srvStatus.pid ? `${srvStatus.process} · PID ${srvStatus.pid}` : '—'}</Descriptions.Item>
              <Descriptions.Item label="Web check">
                {srvStatus.http.ok
                  ? <Tag color="green">HTTP {srvStatus.http.statusCode} · {srvStatus.http.ms} ms</Tag>
                  : <Tag color="red">{srvStatus.http.error || `HTTP ${srvStatus.http.statusCode}`}</Tag>}
              </Descriptions.Item>
              <Descriptions.Item label="Startup task">
                {srvStatus.taskInstalled ? <Tag>{srvStatus.taskStatus || 'Installed'}</Tag> : <Tag color="orange">Not installed</Tag>}
              </Descriptions.Item>
              <Descriptions.Item label="Checked" span={2}>
                <Text type="secondary" style={{ fontSize: 11 }}>{fmtDate(srvStatus.checkedAt)}</Text>
              </Descriptions.Item>
            </Descriptions>
          ) : !srvBusy && <Text type="secondary" style={{ fontSize: 12 }}>Press Refresh to check the server.</Text>}
        </Card>

        <Space wrap>
          <Button icon={<SyncOutlined spin={srvBusy === 'status'} />} disabled={!!srvBusy} onClick={() => serverAction('status')}>
            Refresh
          </Button>
          <Button type="primary" icon={<PlayCircleOutlined />} loading={srvBusy === 'start'}
            disabled={!!srvBusy || !!srvStatus?.running}
            style={{ background: REDWOOD.success, borderColor: REDWOOD.success }}
            onClick={() => serverAction('start')}>
            Start
          </Button>
          <Popconfirm title="Stop the Re-ERP web server?" description="Users on this server lose access until it is started again."
            okText="Stop" okButtonProps={{ danger: true }} onConfirm={() => serverAction('stop')}>
            <Button danger icon={<PoweroffOutlined />} loading={srvBusy === 'stop'} disabled={!!srvBusy || srvStatus?.running === false}>
              Stop
            </Button>
          </Popconfirm>
          <Popconfirm title="Restart the Re-ERP web server?" okText="Restart" onConfirm={() => serverAction('restart')}>
            <Button icon={<ReloadOutlined />} loading={srvBusy === 'restart'} disabled={!!srvBusy}>
              Restart
            </Button>
          </Popconfirm>
          <Button icon={<GlobalOutlined />} disabled={!srvStatus?.running} onClick={openPortal}>
            Open Web Portal
          </Button>
          <Tooltip title="Only needed when package.json dependencies changed (same as 1-setup.bat)">
            <Button loading={srvBusy === 'npm'} disabled={!!srvBusy} onClick={() => serverAction('npm')}>
              npm install
            </Button>
          </Tooltip>
        </Space>

        {srvNpmOutput && (
          <pre style={{ marginTop: 12, maxHeight: 180, overflow: 'auto', fontSize: 11, background: '#fafafa', padding: 8, border: `1px solid ${REDWOOD.border}` }}>
            {srvNpmOutput}
          </pre>
        )}
        <div style={{ marginTop: 12 }}>
          <Text type="secondary" style={{ fontSize: 11 }}>
            Runs Windows commands over this SSH connection. Stop ends only the Re-ERP process on the web port;
            Start uses the <Text code>ReERP-Web</Text> startup task (creates it if missing — SSH user must be an Administrator).
          </Text>
        </div>
      </Modal>

      <FloatingMenu />
    </Layout>
  );
};

export default FTPManager;
