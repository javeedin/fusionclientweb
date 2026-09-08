// ── Fusion schema SQLite store (sql.js / WASM — no native build) ─────────────
// Persists the Fusion schema (tables, indexes, foreign keys) to a real SQLite
// file at <userData>/fusion-schema.db. sql.js is pure WebAssembly, so nothing
// is compiled per Electron version and it works in every packaged build.
//
// The .db is NOT bundled in the exe — it lives in the writable userData folder,
// created on demand. It can be Exported (copied out) or Imported (a .db placed
// from anywhere copied in), so a schema pulled once can be shared to other
// laptops without each one re-pulling.

const path = require('path');
const fs = require('fs');
const { app } = require('electron');

let SQL = null;
async function getSQL() {
  if (SQL) return SQL;
  const initSqlJs = require('sql.js');
  const dir = path.dirname(require.resolve('sql.js')); // .../sql.js/dist
  SQL = await initSqlJs({ locateFile: (f) => path.join(dir, f) });
  return SQL;
}

function dbPath() {
  return path.join(app.getPath('userData'), 'fusion-schema.db');
}

async function openDb() {
  const S = await getSQL();
  const p = dbPath();
  return fs.existsSync(p) ? new S.Database(fs.readFileSync(p)) : new S.Database();
}
function persist(db) {
  fs.writeFileSync(dbPath(), Buffer.from(db.export()));
}

// Save the schema for one owner. Rows are pre-normalised by the renderer:
//   tables:  ['NAME', ...]
//   indexes: [{ table_name, index_name, uniqueness, columns }, ...]
//   fks:     [{ table_name, fk_name, fk_columns, ref_table }, ...]
// Each owner's rows are replaced (delete+insert), other owners untouched.
async function saveSchema({ owner, tables = [], indexes = [], fks = [] } = {}) {
  if (!owner) return { ok: false, error: 'owner required' };
  const db = await openDb();
  try {
    db.run(`CREATE TABLE IF NOT EXISTS fusion_tables (owner TEXT, table_name TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS fusion_indexes (owner TEXT, table_name TEXT, index_name TEXT, uniqueness TEXT, columns TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS fusion_foreign_keys (owner TEXT, table_name TEXT, fk_name TEXT, fk_columns TEXT, ref_table TEXT)`);

    if (tables.length) {
      db.run('DELETE FROM fusion_tables WHERE owner=?', [owner]);
      const st = db.prepare('INSERT INTO fusion_tables VALUES (?,?)');
      for (const t of tables) st.run([owner, String(t)]);
      st.free();
    }
    if (indexes.length) {
      db.run('DELETE FROM fusion_indexes WHERE owner=?', [owner]);
      const st = db.prepare('INSERT INTO fusion_indexes VALUES (?,?,?,?,?)');
      for (const r of indexes) st.run([owner, r.table_name || '', r.index_name || '', r.uniqueness || '', r.columns || '']);
      st.free();
    }
    if (fks.length) {
      db.run('DELETE FROM fusion_foreign_keys WHERE owner=?', [owner]);
      const st = db.prepare('INSERT INTO fusion_foreign_keys VALUES (?,?,?,?,?)');
      for (const r of fks) st.run([owner, r.table_name || '', r.fk_name || '', r.fk_columns || '', r.ref_table || '']);
      st.free();
    }
    persist(db);
    return { ok: true, path: dbPath(), counts: { tables: tables.length, indexes: indexes.length, fks: fks.length } };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    db.close();
  }
}

async function info() {
  const p = dbPath();
  if (!fs.existsSync(p)) return { ok: true, exists: false, path: p, sizeKB: 0, tables: [] };
  const db = await openDb();
  try {
    const res = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
    const names = res.length ? res[0].values.map((v) => v[0]) : [];
    const tables = names.map((nm) => {
      const c = db.exec('SELECT COUNT(*) FROM "' + String(nm).replace(/"/g, '""') + '"');
      return { name: nm, rows: c.length ? c[0].values[0][0] : 0 };
    });
    let sizeKB = 0;
    try { sizeKB = Math.round(fs.statSync(p).size / 1024); } catch { /* ignore */ }
    return { ok: true, exists: true, path: p, sizeKB, tables };
  } catch (e) {
    return { ok: false, error: e.message, path: p, tables: [] };
  } finally {
    db.close();
  }
}

// Optional read-only query (for verification / ad-hoc use)
async function query(sql, rowLimit = 500) {
  if (!fs.existsSync(dbPath())) return { ok: false, error: 'No fusion-schema.db yet' };
  const db = await openDb();
  try {
    const res = db.exec(sql);
    if (!res.length) return { ok: true, columns: [], rows: [] };
    const { columns, values } = res[0];
    return { ok: true, columns, rows: values.slice(0, rowLimit) };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    db.close();
  }
}

module.exports = { dbPath, saveSchema, info, query };
