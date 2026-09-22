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
//   GET  /api/ftp/job/:id        -> {status, filesDone, totalFiles, currentFile, error}

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
    uploadDir: (local, remote, onFile) => {
      client.removeAllListeners('upload');
      client.on('upload', info => onFile(info.source));
      return client.uploadDir(local, remote);
    },
    downloadFile: (remote, local) => client.fastGet(remote, local),
    downloadDir: (remote, local, onFile) => {
      client.removeAllListeners('download');
      client.on('download', info => onFile(info.source));
      return client.downloadDir(remote, local);
    },
    end: () => client.end().catch(() => {}),
  };
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

  app.get('/api/ftp/job/:id', (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return fail(res, 'Unknown job', 404);
    ok(res, job);
  });

  console.log('FTP Manager routes registered (/api/ftp/*)');
};
