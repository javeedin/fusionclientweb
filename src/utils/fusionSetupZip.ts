// Parse an Oracle Fusion FSM "Setup Data Export" zip entirely in the browser.
//
// Shape of the export:
//   OuterExport.zip
//     ├─ <Setup Task A>.zip
//     │    ├─ SOMETHING.xls        ← an HTML table (BI Publisher output)
//     │    └─ …                    (empty <body> = task not configured)
//     ├─ <Setup Task B>.zip
//     │    └─ Something/1_BATCH.zip ← batch-import format (treated as "has data")
//     └─ …
//
// Each inner zip is one setup task; the .xls files are HTML tables whose rows are
// the configured records. We categorise every task into a functional module.
import JSZip from 'jszip';

export type SetupModule = 'Financials' | 'Supply Chain' | 'Common';

export interface SetupFile { name: string; sdoTitle?: string; headers: string[]; rows: string[][]; }
export interface SetupTask {
  name: string;
  module: SetupModule;
  files: SetupFile[];
  recordCount: number;
  hasData: boolean;
  batch: boolean;
  businessUnits: string[];   // distinct BUs found in this task's data (BU-scoped tasks)
}

// Keyword-based module classification of a setup-task name. Supply-Chain terms are
// checked first (they're specific), then the broad Financials set, else Common.
export const moduleOf = (name: string): SetupModule => {
  const n = name.toLowerCase();
  if (/^item\b|item class|item status|item attribute|item lifecycle|revenue management item|inventory|subinventory|unit of measure|interorganization|intersubinventory|min-?max|packing|pick\b|picking|pick wave|pick sequence|ship confirm|shipping|receiving|carrier|\broute\b|transportation|transit|warehouse|source organization|landed cost|contract manufacturing|\bcost\b|costing|cost book|cost element|cost component|cost organization|cost profile|cost analysis|cost valuation|default cost|transfer pricing|\babc\b|supply |manufacturing|profit center|financial orchestration|barcode|planning|material|charge reference|supplier number|supplier user|enable new supplier|procurement agent/.test(n)) return 'Supply Chain';
  if (/receivable|payable|payment|\btax\b|subledger|\bledger\b|journal|legal|business unit|fixed asset|expense|collection|revenue management|\bbank\b|intercompany|chart of account|general ledger|conversion rate|aging|autoinvoice|funds capture|credit card|credit case|\bcash\b|distribution|jurisdiction|approval|accounting|financials|internal payer|disbursement|reporting entity|interest rate|\bperiod\b|1099|segment value|data access|balancing|suspense|statistical|reconciliation|remit-to|\bmemo\b|dunning|collector|lockbox|card issuer|corporate card|configuration owner|country tax|customer tax|application tax|revaluation|invoice|scoring|contingency|autocash|automatch|balance forward|late charge|statement|reversal|standard message/.test(n)) return 'Financials';
  return 'Common';
};

// Parse one HTML-table .xls into headers + data rows (via the DOM — these files
// are real HTML). Skips the SDO title row and sub-section markers.
const BU_HEADER = /^(business\s*unit(\s*name)?|bu(\s*name)?)$/i;
const parseHtmlTable = (html: string, fileName: string): SetupFile & { businessUnits: string[] } => {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const cellsOf = (tr: Element) => Array.from(tr.querySelectorAll('td,th'));
  const txt = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  const tableEls = Array.from(doc.querySelectorAll('table'));
  const blocks = tableEls.length ? tableEls.map(t => Array.from(t.querySelectorAll('tr'))) : [Array.from(doc.querySelectorAll('tr'))];
  let sdoTitle: string | undefined;
  let primary: { headers: string[]; rows: string[][] } = { headers: [], rows: [] };
  const buSet = new Set<string>();
  for (const trs of blocks) {
    const hi = trs.findIndex(tr => cellsOf(tr).length > 1);
    if (hi < 0) { const one = trs[0] && cellsOf(trs[0]); if (one && one.length === 1 && !sdoTitle) sdoTitle = txt(one[0]) || undefined; continue; }
    const headers = cellsOf(trs[hi]).map(txt);
    const rows: string[][] = [];
    for (let i = hi + 1; i < trs.length; i++) {
      const cells = cellsOf(trs[i]);
      if (cells.length < 2) continue;
      const vals = cells.map(txt);
      if (vals.every(v => !v)) continue;
      if (vals.join('') === headers.join('')) continue;
      rows.push(vals);
    }
    headers.forEach((h, idx) => {
      if (!BU_HEADER.test((h || '').trim())) return;
      for (const r of rows) { const v = (r[idx] || '').trim(); if (v && !/^\d+$/.test(v) && v.length < 80 && !/^business ?unit$/i.test(v)) buSet.add(v); }
    });
    if (rows.length > primary.rows.length) primary = { headers, rows };
  }
  return { name: fileName, sdoTitle, headers: primary.headers, rows: primary.rows, businessUnits: [...buSet] };
};

// Parse the whole export. onProgress fires as each task finishes.
export const parseSetupExport = async (
  file: File | ArrayBuffer,
  onProgress?: (done: number, total: number) => void,
): Promise<SetupTask[]> => {
  let zip = await JSZip.loadAsync(file);
  // Full ASM package? The human-readable per-task report is nested as
  // SETUP_DATA_REPORT.zip alongside businessObjectData/ — recurse into it.
  const report = Object.values(zip.files).find(f => !f.dir && /setup_?data_?report\.zip$/i.test(f.name));
  if (report) zip = await JSZip.loadAsync(await report.async('arraybuffer'));
  const taskEntries = Object.values(zip.files).filter(f => !f.dir && /\.zip$/i.test(f.name) && !/businessobjectdata\/|tasklistdata\//i.test(f.name));
  const tasks: SetupTask[] = [];
  let done = 0;
  for (const entry of taskEntries) {
    const name = entry.name.replace(/\.zip$/i, '').replace(/^.*\//, '');
    const files: SetupFile[] = [];
    const buSet = new Set<string>();
    let batch = false;
    try {
      const inner = await JSZip.loadAsync(await entry.async('arraybuffer'));
      for (const [fn, fe] of Object.entries(inner.files)) {
        if ((fe as JSZip.JSZipObject).dir) continue;
        if (/\.zip$/i.test(fn)) { batch = true; continue; }   // nested *_BATCH.zip
        if (/\.xls$/i.test(fn)) {
          const parsed = parseHtmlTable(await (fe as JSZip.JSZipObject).async('string'), fn.replace(/^.*\//, ''));
          parsed.businessUnits.forEach(b => buSet.add(b));
          if (parsed.headers.length || parsed.rows.length || parsed.sdoTitle) files.push({ name: parsed.name, sdoTitle: parsed.sdoTitle, headers: parsed.headers, rows: parsed.rows });
        }
      }
    } catch { /* skip unreadable task */ }
    const recordCount = files.reduce((s, f) => s + f.rows.length, 0);
    tasks.push({ name, module: moduleOf(name), files, recordCount, hasData: recordCount > 0 || batch, batch, businessUnits: [...buSet].sort() });
    done++; onProgress?.(done, taskEntries.length);
  }
  return tasks.sort((a, b) => a.name.localeCompare(b.name));
};

// In-memory cache so switching between the Financials / Supply Chain tabs (and
// routes) keeps the uploaded export(s) without re-uploading.
let _cache: { fileNames: string[]; tasks: SetupTask[] } | null = null;
export const getSetupCache = () => _cache;
export const setSetupCache = (fileNames: string[], tasks: SetupTask[]) => { _cache = { fileNames, tasks }; };
export const clearSetupCache = () => { _cache = null; };

// Merge a freshly-parsed export into an existing task set. Dedup by task name,
// keeping the richer copy (more records / configured) and unioning business units.
export const mergeSetupTasks = (existing: SetupTask[], incoming: SetupTask[]): SetupTask[] => {
  const byName = new Map(existing.map(t => [t.name, t]));
  for (const t of incoming) {
    const cur = byName.get(t.name);
    if (!cur) { byName.set(t.name, t); continue; }
    const better = (t.recordCount > cur.recordCount || (t.hasData && !cur.hasData)) ? t : cur;
    byName.set(t.name, { ...better, businessUnits: Array.from(new Set([...cur.businessUnits, ...t.businessUnits])).sort() });
  }
  return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
};
