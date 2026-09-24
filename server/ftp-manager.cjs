// FTP / SFTP Manager backend — powers the Administration > FTP Manager page.
// Dual-pane file transfer (local machine <-> remote server) with sessions and
// async transfer jobs. Registered by server/proxy.cjs: require('./ftp-manager.cjs')(app)
//
// Endpoints (all JSON):
//   POST /api/ftp/connect        {protocol, host, port, username, password} -> {sessionId}
//   POST /api/ftp/disconnect     {sessionId}
//   POST /api/ftp/remote/list    {sessionId, path}     -> {path, items:[{name,type,size,modified}]}
//   POST /api/ftp/remote/mkdir   {sessionId, path}
//   POST /api/ftp/remote/delete  {sessionId, path, isDir}
//   POST /api/ftp/local/list     {path}                -> {path, sep, roots, items:[...]}
//   POST /api/ftp/transfer       {sessionId, direction:'upload'|'download', localPath, remotePath}
//                                -> {jobId}  (directories transfer recursively)
//   GET  /api/ftp/job/:id        -> {status, filesDone, totalFiles, currentFile, error, note}
//   POST /api/ftp/deploy-runtime {sessionId, remoteDir, lockCompany?, restartServer?} -> {jobId}
//   POST /api/ftp/server/status  {sessionId, remoteDir} -> {running, pid, port, task, http, ...}
//   POST /api/ftp/server/stop    {sessionId, remoteDir}
//   POST /api/ftp/server/start   {sessionId, remoteDir}
//   POST /api/ftp/server/npm-install {sessionId, remoteDir} -> {code, output}
//   GET  /api/ftp/local/build-info  -> {canBuild, distBuiltAt, running}
//   POST /api/ftp/local/build       -> {jobId}   runs `npm run build` in the app folder
//   GET  /api/ftp/local/build/:id   -> {status, exitCode, startedAt, finishedAt, log}
//   POST /api/ftp/open-browser      {url} -> opens http(s) url in this PC's default browser
// Server control needs SFTP: it runs Windows commands (netstat, tasklist,
// schtasks, taskkill) over the same SSH connection, so the hosting server can
// be managed without Remote Desktop.

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const sessions = new Map(); // id -> { protocol, cfg, client, queue }
const jobs = new Map();     // id -> { status, filesDone, totalFiles, currentFile, error, startedAt }

const newId = () => crypto.randomBytes(12).toString('hex');

// serialize operations per session (both ftp libs are single-channel)
const enqueue = (session, fn) => {
  const run = session.queue.then(fn, fn);
  session.queue = run.catch(() => {});
  return run;
};

// count files in a local directory tree (for upload progress totals)
const countLocalFiles = (p) => {
  const st = fs.statSync(p);
  if (st.isFile()) return 1;
  let n = 0;
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    const full = path.join(p, e.name);
    try { n += e.isDirectory() ? countLocalFiles(full) : 1; } catch { /* skip unreadable */ }
  }
  return n;
};

// ── protocol adapters ───────────────────────────────────────────────────────

const makeSftp = async (cfg) => {
  const SftpClient = require('ssh2-sftp-client');
  const client = new SftpClient();
  // Some servers (notably Windows OpenSSH) may only offer keyboard-interactive
  // auth; answer its password prompt with the same password.
  client.client.on('keyboard-interactive', (_name, _instr, _lang, prompts, finish) => {
    finish(prompts.map(() => cfg.password || ''));
  });
  await client.connect({
    host: cfg.host, port: cfg.port || 22,
    username: cfg.username, password: cfg.password,
    tryKeyboard: true,
    readyTimeout: 15000,
  });
  // ssh2-sftp-client has .on() but no .removeAllListeners(); register the
  // progress listeners once and swap the active callback per transfer.
  let onUpload = null;
  let onDownload = null;
  try {
    client.on('upload', info => { if (onUpload) onUpload(info.source); });
    client.on('download', info => { if (onDownload) onDownload(info.source); });
  } catch { /* progress reporting unavailable */ }
  return {
    list: async (dir) => (await client.list(dir)).map(e => ({
      name: e.name,
      type: e.type === 'd' ? 'd' : 'f',
      size: e.size,
      modified: e.modifyTime ? new Date(e.modifyTime).toISOString() : null,
    })),
    mkdir: (dir) => client.mkdir(dir, true),
    delete: async (p, isDir) => (isDir ? client.rmdir(p, true) : client.delete(p)),
    isDir: async (p) => (await client.exists(p)) === 'd',
    uploadFile: (local, remote) => client.fastPut(local, remote),
    uploadDir: async (local, remote, onFile) => {
      onUpload = onFile;
      try { return await client.uploadDir(local, remote); }
      finally { onUpload = null; }
    },
    downloadFile: (remote, local) => client.fastGet(remote, local),
    downloadDir: async (remote, local, onFile) => {
      onDownload = onFile;
      try { return await client.downloadDir(remote, local); }
      finally { onDownload = null; }
    },
    readFile: async (remote) => (await client.get(remote)).toString('utf8'),
    // run a command on the server over SSH (Windows OpenSSH: cmd.exe or PowerShell)
    exec: (cmd, timeoutMs = 60000) => new Promise((resolve, reject) => {
      client.client.exec(cmd, (err, stream) => {
        if (err) return reject(err);
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => {
          try { stream.close(); } catch { /* ignore */ }
          reject(new Error(`Command timed out after ${Math.round(timeoutMs / 1000)}s: ${cmd}`));
        }, timeoutMs);
        stream.on('data', d => { stdout += d; });
        stream.stderr.on('data', d => { stderr += d; });
        stream.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? 0, stdout, stderr }); });
      });
    }),
    end: () => client.end().catch(() => {}),
  };
};

// ── hosting-server control (SFTP sessions only) ─────────────────────────────

const TASK_NAME = 'ReERP-Web';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// "C:/reerp" or "/C:/reerp" (SFTP form) -> "C:\reerp" (cmd form)
const toWinPath = (p) => p.replace(/^\/+(?=[A-Za-z]:)/, '').replace(/\//g, '\\');

// port.txt already on the server decides the web port (default 80)
const readServerPort = async (client, remoteDir) => {
  try {
    const n = parseInt((await client.readFile(`${remoteDir}/port.txt`)).trim(), 10);
    if (n > 0 && n < 65536) return n;
  } catch { /* no port.txt */ }
  return 80;
};

// PIDs listening on a TCP port, from `netstat -ano` (parsed here, so it works
// whether the SSH default shell is cmd.exe or PowerShell)
const pidsOnPort = (netstatOut, port) => {
  const pids = new Set();
  for (const line of netstatOut.split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 5 || cols[0].toUpperCase() !== 'TCP' || !/LISTEN/i.test(cols[3])) continue;
    if (cols[1].endsWith(`:${port}`)) pids.add(Number(cols[4]));
  }
  return [...pids].filter(n => n > 0);
};

const processName = async (client, pid) => {
  const r = await client.exec(`tasklist /fi "PID eq ${pid}" /fo csv /nh`, 20000);
  const m = r.stdout.match(/^"([^"]+)"/m);
  return m ? m[1] : null;
};

// quick HTTP probe from this machine to the hosted app
const httpProbe = (host, port) => new Promise((resolve) => {
  const http = require('http');
  const started = Date.now();
  const req = http.get({ host, port, path: '/', timeout: 5000 }, (res) => {
    res.resume();
    resolve({ ok: res.statusCode < 500, statusCode: res.statusCode, ms: Date.now() - started });
  });
  req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
  req.on('error', (e) => resolve({ ok: false, error: e.code || e.message }));
});

const serverStatus = async (s, remoteDir) => {
  const c = s.client;
  const port = await readServerPort(c, remoteDir);
  const net = await c.exec('netstat -ano -p tcp', 30000);
  const pids = pidsOnPort(net.stdout, port);
  const pid = pids[0] || null;
  const proc = pid ? await processName(c, pid) : null;
  const q = await c.exec(`schtasks /query /tn ${TASK_NAME} /fo LIST`, 20000);
  const taskInstalled = q.code === 0;
  const taskStatus = taskInstalled ? ((q.stdout.match(/Status:\s*(.+)/i) || [])[1] || '').trim() : null;
  const http = await httpProbe(s.cfg.host, port);
  return {
    port, pid, process: proc,
    running: !!pid && /node/i.test(proc || ''),
    portBusyByOther: !!pid && !/node/i.test(proc || ''),
    taskInstalled, taskStatus, http,
    checkedAt: new Date().toISOString(),
  };
};

const stopServer = async (s, remoteDir) => {
  const st = await serverStatus(s, remoteDir);
  if (st.portBusyByOther) throw new Error(`Port ${st.port} is used by ${st.process} (PID ${st.pid}), not Re-ERP — not stopping it`);
  if (st.taskInstalled) await s.client.exec(`schtasks /end /tn ${TASK_NAME}`, 20000);
  if (st.pid) {
    // only the Re-ERP node process tree on the web port — other node apps keep running
    const k = await s.client.exec(`taskkill /f /t /pid ${st.pid}`, 20000);
    if (k.code !== 0 && !/not found/i.test(k.stderr + k.stdout)) {
      throw new Error(`taskkill failed: ${(k.stderr || k.stdout).trim()}`);
    }
  }
  for (let i = 0; i < 10; i++) {
    await sleep(1000);
    const again = await serverStatus(s, remoteDir);
    if (!again.running) return again;
  }
  throw new Error('Server is still running after stop');
};

const startServer = async (s, remoteDir) => {
  let st = await serverStatus(s, remoteDir);
  if (st.running) return st;
  if (st.portBusyByOther) throw new Error(`Port ${st.port} is used by ${st.process} (PID ${st.pid}) — free it first`);
  if (!st.taskInstalled) {
    // same task 3-install-autostart.bat creates: starts at boot as SYSTEM
    const dir = toWinPath(remoteDir);
    const cmd = `schtasks /create /f /tn ${TASK_NAME} /sc onstart /ru SYSTEM `
      + `/tr "cmd /c cd /d ${dir} && set REERP_PORT=${st.port} && node server\\proxy.cjs"`;
    const c = await s.client.exec(cmd, 30000);
    if (c.code !== 0) {
      throw new Error(`Could not create the startup task (the SSH user must be an Administrator): ${(c.stderr || c.stdout).trim()}`);
    }
  }
  const r = await s.client.exec(`schtasks /run /tn ${TASK_NAME}`, 20000);
  if (r.code !== 0) throw new Error(`schtasks /run failed: ${(r.stderr || r.stdout).trim()}`);
  for (let i = 0; i < 20; i++) {
    await sleep(1500);
    st = await serverStatus(s, remoteDir);
    if (st.running) return st;
  }
  throw new Error(`Server did not start listening on port ${st.port} within 30s — check the server folder and run 1-setup.bat once`);
};

const makeFtp = async (cfg) => {
  const ftp = require('basic-ftp');
  const client = new ftp.Client(30000);
  await client.access({
    host: cfg.host, port: cfg.port || 21,
    user: cfg.username, password: cfg.password,
    secure: cfg.protocol === 'ftps',
  });
  return {
    list: async (dir) => (await client.list(dir)).map(e => ({
      name: e.name,
      type: e.isDirectory ? 'd' : 'f',
      size: e.size,
      modified: e.modifiedAt ? e.modifiedAt.toISOString() : null,
    })),
    mkdir: (dir) => client.ensureDir(dir),
    delete: async (p, isDir) => (isDir ? client.removeDir(p) : client.remove(p)),
    isDir: async (p) => {
      try { await client.cd(p); await client.cd('/'); return true; } catch { return false; }
    },
    uploadFile: (local, remote) => client.uploadFrom(local, remote),
    uploadDir: async (local, remote, onFile) => {
      client.trackProgress(info => { if (info.name) onFile(info.name); });
      try { await client.uploadFromDir(local, remote); }
      finally { client.trackProgress(); }
    },
    downloadFile: (remote, local) => client.downloadTo(local, remote),
    downloadDir: async (remote, local, onFile) => {
      client.trackProgress(info => { if (info.name) onFile(info.name); });
      try { await client.downloadToDir(local, remote); }
      finally { client.trackProgress(); }
    },
    end: () => { try { client.close(); } catch { /* noop */ } },
  };
};

// ── local build (npm run build in this machine's app folder) ─────────────────

const { spawn } = require('child_process');
const APP_ROOT = path.join(__dirname, '..');
const buildJobs = new Map(); // id -> { status, exitCode, startedAt, finishedAt, log: string[] }
let activeBuildId = null;

const distBuiltAt = () => {
  try { return fs.statSync(path.join(APP_ROOT, 'dist', 'index.html')).mtime.toISOString(); }
  catch { return null; }
};

// a source checkout with a build script (not a packaged desktop install)
const canBuild = () => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'package.json'), 'utf8'));
    return !!pkg.scripts?.build && fs.existsSync(path.join(APP_ROOT, 'src'))
      && fs.existsSync(path.join(APP_ROOT, 'node_modules'));
  } catch { return false; }
};

// start `npm run build`; resolves when it finishes (job keeps the log either way)
const startBuild = () => {
  if (activeBuildId) {
    const running = buildJobs.get(activeBuildId);
    if (running?.status === 'running') return { id: activeBuildId, done: running.done };
  }
  const id = newId();
  const job = { status: 'running', exitCode: null, startedAt: Date.now(), finishedAt: null, log: [] };
  const push = (chunk) => {
    // strip ANSI colours; keep the last 500 lines
    for (const line of String(chunk).replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/)) {
      if (line.trim()) job.log.push(line);
    }
    if (job.log.length > 500) job.log.splice(0, job.log.length - 500);
  };
  job.done = new Promise((resolve) => {
    push(`> npm run build   (in ${APP_ROOT})`);
    let child;
    try {
      child = spawn('npm', ['run', 'build'], { cwd: APP_ROOT, shell: true, env: process.env, windowsHide: true });
    } catch (e) {
      push(`Could not start npm: ${e.message}`);
      Object.assign(job, { status: 'error', exitCode: -1, finishedAt: Date.now() });
      return resolve(job);
    }
    child.stdout.on('data', push);
    child.stderr.on('data', push);
    child.on('error', (e) => push(`npm error: ${e.message}`));
    child.on('close', (code) => {
      Object.assign(job, { status: code === 0 ? 'done' : 'error', exitCode: code, finishedAt: Date.now() });
      push(code === 0 ? `Build finished in ${Math.round((job.finishedAt - job.startedAt) / 1000)}s` : `Build failed (exit code ${code})`);
      resolve(job);
    });
  });
  buildJobs.set(id, job);
  activeBuildId = id;
  return { id, done: job.done };
};

// ── express wiring ──────────────────────────────────────────────────────────

module.exports = function registerFtpRoutes(app) {
  const ok = (res, data) => res.json({ success: true, ...data });
  const fail = (res, e, code = 500) =>
    res.status(code).json({ success: false, error: e instanceof Error ? e.message : String(e) });

  const getSession = (req, res) => {
    const s = sessions.get(req.body?.sessionId);
    if (!s) { fail(res, 'Not connected (invalid or expired session) — connect again', 400); return null; }
    return s;
  };

  app.post('/api/ftp/connect', async (req, res) => {
    const { protocol = 'sftp', host, port, username, password } = req.body || {};
    if (!host || !username) return fail(res, 'host and username are required', 400);
    try {
      const cfg = { protocol, host, port: Number(port) || undefined, username, password };
      const client = protocol === 'sftp' ? await makeSftp(cfg) : await makeFtp(cfg);
      const id = newId();
      sessions.set(id, { protocol, cfg, client, queue: Promise.resolve() });
      ok(res, { sessionId: id });
    } catch (e) {
      fail(res, e);
    }
  });

  app.post('/api/ftp/disconnect', (req, res) => {
    const s = sessions.get(req.body?.sessionId);
    if (s) { s.client.end(); sessions.delete(req.body.sessionId); }
    ok(res, {});
  });

  app.post('/api/ftp/remote/list', async (req, res) => {
    const s = getSession(req, res); if (!s) return;
    const dir = req.body.path || '/';
    try { ok(res, { path: dir, items: await enqueue(s, () => s.client.list(dir)) }); }
    catch (e) { fail(res, e); }
  });

  app.post('/api/ftp/remote/mkdir', async (req, res) => {
    const s = getSession(req, res); if (!s) return;
    try { await enqueue(s, () => s.client.mkdir(req.body.path)); ok(res, {}); }
    catch (e) { fail(res, e); }
  });

  app.post('/api/ftp/remote/delete', async (req, res) => {
    const s = getSession(req, res); if (!s) return;
    try { await enqueue(s, () => s.client.delete(req.body.path, !!req.body.isDir)); ok(res, {}); }
    catch (e) { fail(res, e); }
  });

  // Local filesystem browser (runs on the user's machine)
  app.post('/api/ftp/local/list', (req, res) => {
    try {
      const roots = [{ label: 'Home', path: os.homedir() }, { label: 'App', path: process.cwd() }];
      if (process.platform === 'win32') {
        for (let c = 67; c <= 90; c++) { // C: .. Z:
          const drive = `${String.fromCharCode(c)}:\\`;
          try { if (fs.existsSync(drive)) roots.push({ label: drive, path: drive }); } catch { /* skip */ }
        }
      }
      const dir = req.body?.path || os.homedir();
      const items = [];
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        let st = null;
        try { st = fs.statSync(path.join(dir, e.name)); } catch { /* permission */ }
        items.push({
          name: e.name,
          type: e.isDirectory() ? 'd' : 'f',
          size: st && !e.isDirectory() ? st.size : null,
          modified: st ? st.mtime.toISOString() : null,
        });
      }
      ok(res, { path: dir, sep: path.sep, roots, items });
    } catch (e) {
      fail(res, e);
    }
  });

  app.post('/api/ftp/transfer', async (req, res) => {
    const s = getSession(req, res); if (!s) return;
    const { direction, localPath, remotePath } = req.body || {};
    if (!direction || !localPath || !remotePath) return fail(res, 'direction, localPath and remotePath are required', 400);

    const jobId = newId();
    const job = { status: 'running', filesDone: 0, totalFiles: null, currentFile: '', error: null, startedAt: Date.now() };
    jobs.set(jobId, job);
    const onFile = (name) => { job.filesDone += 1; job.currentFile = name; };

    // run in the session queue but respond immediately with the job id
    enqueue(s, async () => {
      try {
        if (direction === 'upload') {
          const st = fs.statSync(localPath);
          if (st.isDirectory()) {
            try { job.totalFiles = countLocalFiles(localPath); } catch { /* best effort */ }
            await s.client.uploadDir(localPath, remotePath, onFile);
          } else {
            job.totalFiles = 1;
            await s.client.uploadFile(localPath, remotePath);
            onFile(path.basename(localPath));
          }
        } else {
          const isDir = await s.client.isDir(remotePath);
          if (isDir) {
            fs.mkdirSync(localPath, { recursive: true });
            await s.client.downloadDir(remotePath, localPath, onFile);
          } else {
            job.totalFiles = 1;
            fs.mkdirSync(path.dirname(localPath), { recursive: true });
            await s.client.downloadFile(remotePath, localPath);
            onFile(path.basename(remotePath));
          }
        }
        job.status = 'done';
      } catch (e) {
        job.status = 'error';
        job.error = e instanceof Error ? e.message : String(e);
      }
    });

    ok(res, { jobId });
  });

  // Deploy the web runtime (dist + server + package.json) from this machine's
  // app folder to a remote folder, as one tracked job.
  app.post('/api/ftp/deploy-runtime', async (req, res) => {
    const s = getSession(req, res); if (!s) return;
    const remoteDir = String(req.body?.remoteDir || '').trim().replace(/[\\/]+$/, '');
    if (!remoteDir) return fail(res, 'remoteDir is required', 400);
    const restartServer = !!req.body?.restartServer;
    const buildFirst = !!req.body?.buildFirst;
    if (buildFirst && !canBuild()) return fail(res, 'Build is not available here (needs the source folder with node_modules)', 400);
    if (restartServer && !s.client.exec) return fail(res, 'Stop/start during deploy needs an SFTP connection', 400);
    const lockCompany = String(req.body?.lockCompany || '').trim().toUpperCase();
    if (lockCompany && !/^[A-Z0-9_]{1,40}$/.test(lockCompany)) return fail(res, 'invalid lockCompany', 400);

    const appRoot = path.join(__dirname, '..');
    const distDir = path.join(appRoot, 'dist');
    const serverDir = path.join(appRoot, 'server');
    const pkgFile = path.join(appRoot, 'package.json');
    if (!buildFirst && !fs.existsSync(path.join(distDir, 'index.html'))) {
      return fail(res, 'dist/index.html not found — run "npm run build" first, then deploy', 400);
    }
    if (!fs.existsSync(pkgFile)) return fail(res, 'package.json not found in app folder', 400);

    const jobId = newId();
    const job = { status: 'running', filesDone: 0, totalFiles: null, currentFile: '', error: null, note: null, startedAt: Date.now() };
    jobs.set(jobId, job);
    const onFile = (name) => { job.filesDone += 1; job.currentFile = name; };

    const batDir = path.join(appRoot, 'deploy'); // server-side helper .bat files

    enqueue(s, async () => {
      try {
        if (buildFirst) {
          job.currentFile = 'Building (npm run build)…';
          const b = await startBuild().done;
          if (b.status !== 'done') throw new Error(`Build failed — nothing was deployed. ${b.log.slice(-3).join(' | ')}`);
        }
        const batCount = fs.existsSync(batDir) ? countLocalFiles(batDir) : 0;
        try { job.totalFiles = countLocalFiles(distDir) + countLocalFiles(serverDir) + 1 + batCount; } catch { /* best effort */ }
        if (restartServer) {
          job.currentFile = 'Stopping server…';
          try {
            if ((await serverStatus(s, remoteDir)).running) await stopServer(s, remoteDir);
          } catch (e) {
            throw new Error(`Could not stop the server before upload: ${e instanceof Error ? e.message : e}`);
          }
        }
        try { await s.client.mkdir(remoteDir); } catch { /* may already exist */ }
        await s.client.uploadDir(distDir, `${remoteDir}/dist`, onFile);
        await s.client.uploadDir(serverDir, `${remoteDir}/server`, onFile);
        await s.client.uploadFile(pkgFile, `${remoteDir}/package.json`);
        onFile('package.json');
        if (batCount) {
          // .bat helpers land in the remote root so they can be double-clicked
          for (const f of fs.readdirSync(batDir)) {
            await s.client.uploadFile(path.join(batDir, f), `${remoteDir}/${f}`);
            onFile(f);
          }
        }
        // deploy-config.json carries per-deployment app settings (company lock).
        // port.txt is NOT uploaded — the server keeps its own.
        const cfgTmp = path.join(os.tmpdir(), `reerp-cfg-${jobId}.json`);
        fs.writeFileSync(cfgTmp, JSON.stringify(lockCompany ? { lockCompany } : {}, null, 2));
        try {
          await s.client.uploadFile(cfgTmp, `${remoteDir}/deploy-config.json`);
          onFile('deploy-config.json');
        } finally {
          try { fs.unlinkSync(cfgTmp); } catch { /* ignore */ }
        }
        if (restartServer) {
          job.currentFile = 'Starting server…';
          try {
            const st = await startServer(s, remoteDir);
            job.note = `Server running on port ${st.port} (PID ${st.pid})`;
          } catch (e) {
            // files are deployed; report the start problem without failing the upload
            job.note = `Files deployed, but the server did not start: ${e instanceof Error ? e.message : e}`;
          }
        }
        job.status = 'done';
      } catch (e) {
        job.status = 'error';
        job.error = e instanceof Error ? e.message : String(e);
      }
    });

    ok(res, { jobId });
  });

  // ── hosting-server control over SSH ────────────────────────────────────────
  const serverRoute = (name, fn) => app.post(`/api/ftp/server/${name}`, async (req, res) => {
    const s = getSession(req, res); if (!s) return;
    if (!s.client.exec) return fail(res, 'Server control needs an SFTP (SSH) connection — FTP cannot run commands', 400);
    const remoteDir = String(req.body?.remoteDir || '').trim().replace(/[\\/]+$/, '');
    if (!remoteDir) return fail(res, 'remoteDir is required', 400);
    try { ok(res, await enqueue(s, () => fn(s, remoteDir))); }
    catch (e) { fail(res, e); }
  });

  serverRoute('status', serverStatus);
  serverRoute('stop', stopServer);
  serverRoute('start', startServer);
  serverRoute('npm-install', async (s, remoteDir) => {
    // needed only when package.json dependencies changed (same as 1-setup.bat)
    const r = await s.client.exec(`cd /d ${toWinPath(remoteDir)} && npm install --omit=dev`, 10 * 60000);
    const output = (r.stdout + (r.stderr ? `\n${r.stderr}` : '')).trim().slice(-4000);
    if (r.code !== 0) throw new Error(`npm install failed (exit ${r.code}): ${output.slice(-800)}`);
    return { code: r.code, output };
  });

  // Open a URL in the default browser of the machine running this proxy.
  // Local callers only — a hosted proxy must not pop browsers on the server.
  app.post('/api/ftp/open-browser', (req, res) => {
    const url = String(req.body?.url || '');
    if (!/^https?:\/\/[^\s"'<>^&|]+$/i.test(url)) return fail(res, 'Only plain http(s) URLs can be opened', 400);
    const ip = req.socket?.remoteAddress || '';
    if (!/^(::1|127\.|::ffff:127\.)/.test(ip)) return fail(res, 'Not a local request', 403);
    const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
    try {
      const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true });
      child.on('error', (e) => console.warn(`[open-browser] ${e.message}`)); // e.g. no xdg-open — never crash the proxy
      child.unref();
      ok(res, {});
    } catch (e) { fail(res, e); }
  });

  // ── local build ────────────────────────────────────────────────────────────
  app.get('/api/ftp/local/build-info', (_req, res) => {
    const running = activeBuildId && buildJobs.get(activeBuildId)?.status === 'running' ? activeBuildId : null;
    ok(res, { canBuild: canBuild(), distBuiltAt: distBuiltAt(), running });
  });

  app.post('/api/ftp/local/build', (_req, res) => {
    if (!canBuild()) return fail(res, 'Build is not available here (needs the source folder with node_modules — run npm install first)', 400);
    ok(res, { jobId: startBuild().id });
  });

  app.get('/api/ftp/local/build/:id', (req, res) => {
    const job = buildJobs.get(req.params.id);
    if (!job) return fail(res, 'Unknown build', 404);
    const { done: _done, ...rest } = job;
    ok(res, { ...rest, distBuiltAt: distBuiltAt() });
  });

  app.get('/api/ftp/job/:id', (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return fail(res, 'Unknown job', 404);
    ok(res, job);
  });

  console.log('FTP Manager routes registered (/api/ftp/*)');
};
