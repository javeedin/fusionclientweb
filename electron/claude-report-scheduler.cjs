// ── Scheduled Claude reports ────────────────────────────────────────────────
// Stores report schedules (daily/weekly, HH:mm) in userData and, once a
// minute, fires due ones through the headless chat engine with a wrapper
// prompt instructing Claude to save the result as an Excel file in the
// workspace. One run at a time — a due schedule waits while the chat is busy
// and fires on the next minute tick. Windows are notified on completion.

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');
const chat = require('./claude-chat-manager.cjs');

function log(...args) { console.log('[Report Scheduler]', ...args); }

const file = () => path.join(app.getPath('userData'), 'claude-report-schedules.json');

let schedules = null; // lazy-loaded

function load() {
  if (schedules) return schedules;
  try { schedules = JSON.parse(fs.readFileSync(file(), 'utf8')) || []; }
  catch { schedules = []; }
  return schedules;
}

function persist() {
  try { fs.writeFileSync(file(), JSON.stringify(schedules || [], null, 2), 'utf8'); }
  catch (e) { log('could not persist schedules:', e.message); }
}

// next fire time for a schedule: freq 'daily' (every day at time) or
// 'weekly' (day 0-6 = Sun-Sat at time)
function computeNext(s, from = new Date()) {
  const [h, m] = String(s.time || '08:00').split(':').map(Number);
  const d = new Date(from);
  d.setHours(h || 0, m || 0, 0, 0);
  if (s.freq === 'weekly') {
    const target = Number(s.day) || 0;
    let delta = (target - d.getDay() + 7) % 7;
    if (delta === 0 && d <= from) delta = 7;
    d.setDate(d.getDate() + delta);
  } else if (d <= from) {
    d.setDate(d.getDate() + 1);
  }
  return d.getTime();
}

function broadcast(channel, payload) {
  for (const w of BrowserWindow.getAllWindows()) {
    try { w.webContents.send(channel, payload); } catch { /* window closing */ }
  }
}

let running = false; // one scheduled run at a time

function runSchedule(s) {
  if (running || chat.isBusy()) return false;
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const safe = String(s.name || 'report').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40);
  const prompt = `${s.prompt}\n\n(Automated scheduled run of report "${s.name}". ` +
    `Produce the final report as a formatted Excel file using tools/make-excel.cjs, ` +
    `named ${safe}-${stamp}.xlsx, saved in the workspace. Keep the chat answer to a short summary.)`;
  const sender = {
    send: (channel, payload) => {
      if (channel !== 'claude-chat:event' || !payload) return;
      if (payload.kind === 'result') s.lastResult = String(payload.resultText || '').slice(0, 500);
      if (payload.kind === 'done') {
        running = false;
        s.lastRun = Date.now();
        s.lastStatus = payload.code === 0 ? 'ok' : 'error';
        s.nextRun = computeNext(s);
        persist();
        log(`"${s.name}" finished: ${s.lastStatus}`);
        broadcast('claude-report:done', { id: s.id, name: s.name, status: s.lastStatus });
      }
    },
  };
  const r = chat.send(sender, { text: prompt, sessionId: null, ctx: s.ctx || {} });
  if (!r.success) {
    log(`"${s.name}" could not start: ${r.error}`);
    return false;
  }
  running = true;
  log(`"${s.name}" started`);
  return true;
}

function tick() {
  try {
    const now = Date.now();
    for (const s of load()) {
      if (s.enabled === false) continue;
      if (!s.nextRun) { s.nextRun = computeNext(s); persist(); }
      if (now >= s.nextRun) {
        // stays due until it actually starts (busy chat = retry next minute)
        if (runSchedule(s)) break;
      }
    }
  } catch (e) { log('tick error:', e.message); }
}

let timer = null;
function init() {
  if (timer) return;
  timer = setInterval(tick, 60000);
  log('started (checking every minute)');
}

function list() {
  return load().map(s => ({ ...s, nextRun: s.enabled === false ? null : (s.nextRun || computeNext(s)) }));
}

function save(input) {
  const s = { ...input };
  load();
  if (!s.id) s.id = `sch${Date.now()}`;
  s.nextRun = computeNext(s);
  const i = schedules.findIndex(x => x.id === s.id);
  if (i >= 0) schedules[i] = { ...schedules[i], ...s };
  else schedules.push(s);
  persist();
  return s;
}

function remove(id) {
  load();
  schedules = schedules.filter(x => x.id !== id);
  persist();
}

function runNow(id) {
  const s = load().find(x => x.id === id);
  if (!s) return { success: false, error: 'Schedule not found' };
  if (!runSchedule(s)) return { success: false, error: 'Chat is busy — try again in a moment' };
  return { success: true };
}

module.exports = { init, list, save, remove, runNow };
