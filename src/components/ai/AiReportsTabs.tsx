import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Empty, Input, Modal, Popconfirm, Space, Spin, Table, Tag, Tooltip, Typography, message } from 'antd';
import {
  CaretRightOutlined, DeleteOutlined, FileExcelOutlined, PrinterOutlined,
  ReloadOutlined, CodeOutlined, ClockCircleOutlined, SaveOutlined,
} from '@ant-design/icons';
import { saveAs } from 'file-saver';
import { APEX_DB_CONFIG } from '../../config/api.config';
import { buildExcel } from './assistantTools';

const { Text } = Typography;
const BASE = APEX_DB_CONFIG.baseUrl;

export interface SavedReport {
  reportId: number;
  name: string;
  category: string;
  description?: string;
  sqlText: string;
  createdBy: string;
  createdDate: string;
  lastRunDate?: string;
  lastRunRows?: number;
}

interface RunResult { columns: string[]; rows: (string | number | null)[][]; rowCount: number; truncated: boolean; elapsedMs: number }

// ── Shared helpers ──────────────────────────────────────────────────────────
export async function saveAiReport(payload: {
  name: string; category?: string; description?: string; sql: string; createdBy?: string;
}): Promise<{ success: boolean; reportId?: number; error?: string }> {
  const res = await fetch(`${BASE}/ai/reports/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { success: false, error: text.slice(0, 300) }; }
}

async function exportResultExcel(report: { name: string; category: string }, result: RunResult) {
  const blob = await buildExcel({
    filename: `${report.name.replace(/[^\w -]/g, '_')}.xlsx`,
    title: report.name,
    subtitle: `${report.category} · run ${new Date().toLocaleString()} · ${result.rowCount} rows`,
    sheets: [{ name: 'Report', columns: result.columns, rows: result.rows }],
  });
  saveAs(blob, `${report.name.replace(/[^\w -]/g, '_')}.xlsx`);
}

function exportResultPdf(report: { name: string; category: string }, result: RunResult) {
  const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const w = window.open('', '_blank', 'width=1000,height=700');
  if (!w) { message.error('Popup blocked — allow popups to print'); return; }
  w.document.write(`<html><head><title>${esc(report.name)}</title><style>
    body{font-family:Segoe UI,Arial,sans-serif;padding:20px;color:#1A1A1A}
    h2{margin:0 0 2px;color:#C74634} .sub{font-size:11px;color:#6B6B6B;margin-bottom:12px}
    table{border-collapse:collapse;width:100%;font-size:11px}
    th{background:#C74634;color:#fff;padding:5px 8px;text-align:left}
    td{border:1px solid #E5E5E5;padding:4px 8px}
    tr:nth-child(even) td{background:#FBF1EF}
    td.num{text-align:right;font-variant-numeric:tabular-nums}
  </style></head><body>
    <h2>${esc(report.name)}</h2>
    <div class="sub">${esc(report.category)} · ${new Date().toLocaleString()} · ${result.rowCount} rows</div>
    <table><tr>${result.columns.map(c => `<th>${esc(c)}</th>`).join('')}</tr>
    ${result.rows.map(r => `<tr>${r.map(v =>
      `<td${typeof v === 'number' ? ' class="num"' : ''}>${typeof v === 'number' ? v.toLocaleString() : esc(v)}</td>`).join('')}</tr>`).join('')}
    </table></body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}

// ── Saved Reports pane ──────────────────────────────────────────────────────
export const SavedReportsPane: React.FC<{ userName: string }> = ({ userName }) => {
  const [reports, setReports] = useState<SavedReport[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<SavedReport | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [runError, setRunError] = useState('');
  const [sqlOpen, setSqlOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/ai/reports/list`, { cache: 'no-store', headers: { Accept: 'application/json' } });
      const data = await res.json();
      setReports(Array.isArray(data.reports) ? data.reports : []);
    } catch { message.error('Failed to load saved reports'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const run = async (r: SavedReport) => {
    setSelected(r); setRunning(true); setResult(null); setRunError(''); setSqlOpen(false);
    try {
      const res = await fetch(`${BASE}/ai/reports/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ reportId: r.reportId, maxRows: 500, appUser: userName || 'AI_REPORT' }),
      });
      const data = await res.json();
      if (data.success) {
        setResult({ columns: data.columns || [], rows: data.rows || [], rowCount: data.rowCount ?? 0, truncated: !!data.truncated, elapsedMs: data.elapsedMs ?? 0 });
        setReports(prev => prev.map(x => x.reportId === r.reportId
          ? { ...x, lastRunDate: new Date().toISOString().slice(0, 16).replace('T', ' '), lastRunRows: data.rowCount } : x));
      } else setRunError(data.error || 'Run failed');
    } catch (e) { setRunError(e instanceof Error ? e.message : String(e)); }
    finally { setRunning(false); }
  };

  const remove = async (r: SavedReport) => {
    try {
      const res = await fetch(`${BASE}/ai/reports/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ reportId: r.reportId }),
      });
      const data = await res.json();
      if (data.success) {
        message.success('Report deleted');
        if (selected?.reportId === r.reportId) { setSelected(null); setResult(null); }
        load();
      } else message.error(data.error || 'Delete failed');
    } catch { message.error('Delete failed'); }
  };

  const q = filter.toLowerCase();
  const filtered = useMemo(() => (q
    ? reports.filter(r => r.name.toLowerCase().includes(q) || (r.category || '').toLowerCase().includes(q) || (r.description || '').toLowerCase().includes(q))
    : reports), [reports, q]);

  const resultColumns = (result?.columns || []).map((c, i) => ({
    title: c, key: c, ellipsis: true,
    render: (_: unknown, row: (string | number | null)[]) => {
      const v = row[i];
      return typeof v === 'number'
        ? <span style={{ display: 'block', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{v.toLocaleString()}</span>
        : <span>{v === null || v === undefined ? '—' : String(v)}</span>;
    },
  }));

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
      {/* left: report list */}
      <div style={{ width: 250, borderRight: '1px solid #EFEBE9', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ padding: 8, display: 'flex', gap: 6 }}>
          <Input size="small" placeholder="Filter reports…" allowClear value={filter} onChange={e => setFilter(e.target.value)} />
          <Tooltip title="Refresh"><Button size="small" icon={<ReloadOutlined />} onClick={load} /></Tooltip>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? <div style={{ textAlign: 'center', padding: 20 }}><Spin size="small" /></div>
            : !filtered.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No saved reports yet" style={{ marginTop: 24 }} />
              : Object.entries(filtered.reduce<Record<string, SavedReport[]>>((acc, r) => {
                (acc[r.category || 'General'] ||= []).push(r); return acc;
              }, {})).map(([cat, list]) => (
                <div key={cat}>
                  <div style={{ padding: '6px 10px 2px', fontSize: 10, fontWeight: 700, letterSpacing: .4, color: '#8B8580', textTransform: 'uppercase' }}>{cat}</div>
                  {list.map(r => (
                    <div key={r.reportId}
                      onClick={() => { setSelected(r); setResult(null); setRunError(''); setSqlOpen(false); }}
                      style={{
                        padding: '6px 10px', cursor: 'pointer', fontSize: 12.5,
                        background: selected?.reportId === r.reportId ? '#FBF1EF' : undefined,
                        borderLeft: selected?.reportId === r.reportId ? '3px solid #C74634' : '3px solid transparent',
                      }}>
                      <div style={{ fontWeight: 600, color: '#3A3632' }}>{r.name}</div>
                      <div style={{ fontSize: 10.5, color: '#8B8580' }}>
                        {r.lastRunDate ? `last run ${r.lastRunDate} · ${r.lastRunRows ?? '—'} rows` : `saved ${r.createdDate}`}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
        </div>
      </div>

      {/* right: detail + results */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {!selected ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Select a report, then Run" style={{ marginTop: 40 }} />
        ) : (
          <>
            <div style={{ padding: '10px 12px', borderBottom: '1px solid #EFEBE9' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Text strong style={{ fontSize: 14 }}>{selected.name}</Text>
                <Tag style={{ fontSize: 10 }}>{selected.category}</Tag>
                <span style={{ flex: 1 }} />
                <Button size="small" type="primary" icon={<CaretRightOutlined />} loading={running}
                  onClick={() => run(selected)} style={{ background: '#C74634', borderColor: '#C74634' }}>Run</Button>
                <Button size="small" icon={<CodeOutlined />} onClick={() => setSqlOpen(s => !s)}>
                  {sqlOpen ? 'Hide SQL' : 'Inspect SQL'}
                </Button>
                <Button size="small" icon={<FileExcelOutlined />} disabled={!result}
                  onClick={() => result && exportResultExcel(selected, result)}>Excel</Button>
                <Button size="small" icon={<PrinterOutlined />} disabled={!result}
                  onClick={() => result && exportResultPdf(selected, result)}>PDF</Button>
                <Popconfirm title="Delete this report?" onConfirm={() => remove(selected)}>
                  <Button size="small" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              </div>
              {selected.description && <div style={{ fontSize: 11.5, color: '#6B6B6B', marginTop: 4 }}>{selected.description}</div>}
              {sqlOpen && (
                <pre style={{
                  margin: '8px 0 0', padding: 8, background: '#F7F5F3', border: '1px solid #EFEBE9',
                  borderRadius: 6, fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 160, overflow: 'auto',
                }}>{selected.sqlText}</pre>
              )}
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: 10 }}>
              {running && <div style={{ textAlign: 'center', padding: 30 }}><Spin /></div>}
              {runError && <Text type="danger" style={{ fontSize: 12 }}>{runError}</Text>}
              {result && (
                <>
                  <div style={{ fontSize: 11, color: '#8B8580', marginBottom: 6 }}>
                    {result.rowCount} rows{result.truncated ? ' (truncated)' : ''} · {result.elapsedMs} ms
                  </div>
                  <Table
                    size="small"
                    dataSource={result.rows}
                    columns={resultColumns}
                    rowKey={(_, i) => String(i)}
                    pagination={{ pageSize: 25, size: 'small', showTotal: t => `${t} rows` }}
                    scroll={{ x: true }}
                  />
                </>
              )}
              {!running && !result && !runError && (
                <Text type="secondary" style={{ fontSize: 12 }}>Press Run to execute this report live.</Text>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

// ── Scheduled Jobs pane (placeholder — jobs engine is the next build) ───────
export const ScheduledJobsPane: React.FC = () => (
  <div style={{ padding: 30, textAlign: 'center' }}>
    <ClockCircleOutlined style={{ fontSize: 34, color: '#C7C7C7' }} />
    <div style={{ fontWeight: 700, margin: '10px 0 4px', color: '#3A3632' }}>Scheduled Jobs</div>
    <Text type="secondary" style={{ fontSize: 12.5, display: 'block', maxWidth: 420, margin: '0 auto' }}>
      Coming next: schedule a saved report or a chat-designed job to run inside the database
      (DBMS_SCHEDULER) — once, recurring, or repeat-until-done — with run history and logs,
      the same design as the WMS AI Analysis module.
    </Text>
  </div>
);

// ── Save Report dialog (used from the chat tab) ─────────────────────────────
export const SaveReportModal: React.FC<{
  open: boolean;
  sql: string;
  defaultName?: string;
  userName: string;
  onClose: (saved: boolean) => void;
}> = ({ open, sql, defaultName, userName, onClose }) => {
  const [name, setName] = useState(defaultName || '');
  const [category, setCategory] = useState('General');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) { setName(defaultName || ''); setCategory('General'); setDescription(''); } }, [open, defaultName]);

  const save = async () => {
    if (!name.trim()) { message.warning('Report name is required'); return; }
    setSaving(true);
    try {
      const r = await saveAiReport({ name: name.trim(), category: category.trim() || 'General', description: description.trim(), sql, createdBy: userName });
      if (r.success) { message.success(`Report saved (#${r.reportId})`); onClose(true); }
      else message.error(r.error || 'Save failed');
    } catch (e) { message.error(e instanceof Error ? e.message : 'Save failed'); }
    finally { setSaving(false); }
  };

  return (
    <Modal title="Save as Report" open={open} onOk={save} confirmLoading={saving}
      onCancel={() => onClose(false)} okText="Save report" width={480}>
      <Space direction="vertical" style={{ width: '100%' }} size={8}>
        <div>
          <Text strong style={{ fontSize: 12 }}>Name</Text>
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Top 10 suppliers by outstanding" maxLength={200} />
        </div>
        <div>
          <Text strong style={{ fontSize: 12 }}>Category</Text>
          <Input value={category} onChange={e => setCategory(e.target.value)} placeholder="General" maxLength={100} />
        </div>
        <div>
          <Text strong style={{ fontSize: 12 }}>Description</Text>
          <Input.TextArea value={description} onChange={e => setDescription(e.target.value)} rows={2} maxLength={1000} />
        </div>
        <div>
          <Text strong style={{ fontSize: 12 }}>SQL to save</Text>
          <pre style={{
            margin: 0, padding: 8, background: '#F7F5F3', border: '1px solid #EFEBE9', borderRadius: 6,
            fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 140, overflow: 'auto',
          }}>{sql}</pre>
        </div>
      </Space>
    </Modal>
  );
};

// ── Tables List / SQL Workbench (APEX SQL Commands style) ───────────────────
interface DbColumn { name: string; dataType: string; nullable: string; comment?: string }
interface DbObject { name: string; type: string; comment?: string; columns: DbColumn[] }

export const SqlWorkbenchPane: React.FC<{ userName: string }> = ({ userName }) => {
  const [objects, setObjects] = useState<DbObject[]>([]);
  const [objLoading, setObjLoading] = useState(false);
  const [objFilter, setObjFilter] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [sql, setSql] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [runError, setRunError] = useState('');
  const [rowFilter, setRowFilter] = useState('');
  const [saveOpen, setSaveOpen] = useState(false);

  const loadObjects = useCallback(async () => {
    setObjLoading(true);
    try {
      const res = await fetch(`${BASE}/ai/objects`, { cache: 'no-store', headers: { Accept: 'application/json' } });
      const data = await res.json();
      setObjects(Array.isArray(data.objects) ? data.objects : []);
    } catch { message.error('Failed to load tables (is GET ai/objects deployed?)'); }
    finally { setObjLoading(false); }
  }, []);
  useEffect(() => { loadObjects(); }, [loadObjects]);

  const runSql = async () => {
    if (!sql.trim()) { message.warning('Type a SELECT statement first'); return; }
    setRunning(true); setResult(null); setRunError(''); setRowFilter('');
    try {
      const res = await fetch(`${BASE}/ai/executequery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ sql: sql.trim(), maxRows: 500, appUser: userName || 'SQL_WORKBENCH' }),
      });
      const data = await res.json();
      if (data.success) {
        setResult({ columns: data.columns || [], rows: data.rows || [], rowCount: data.rowCount ?? 0, truncated: !!data.truncated, elapsedMs: data.elapsedMs ?? 0 });
      } else setRunError(data.error || 'Query failed');
    } catch (e) { setRunError(e instanceof Error ? e.message : String(e)); }
    finally { setRunning(false); }
  };

  const insertTable = (name: string) => {
    if (!sql.trim()) setSql(`SELECT * FROM ${name.toLowerCase()} FETCH FIRST 100 ROWS ONLY`);
    setExpanded(p => ({ ...p, [name]: !p[name] }));
  };

  const q = objFilter.toUpperCase();
  const visibleObjects = useMemo(
    () => (q ? objects.filter(o => o.name.includes(q)) : objects),
    [objects, q],
  );

  const filteredRows = useMemo(() => {
    if (!result) return [];
    const f = rowFilter.toLowerCase();
    if (!f) return result.rows;
    return result.rows.filter(r => r.some(v => String(v ?? '').toLowerCase().includes(f)));
  }, [result, rowFilter]);

  const resultColumns = (result?.columns || []).map((c, i) => ({
    title: c, key: c, ellipsis: true,
    render: (_: unknown, row: (string | number | null)[]) => {
      const v = row[i];
      return typeof v === 'number'
        ? <span style={{ display: 'block', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{v.toLocaleString()}</span>
        : <span>{v === null || v === undefined ? '—' : String(v)}</span>;
    },
  }));

  const exportMeta = { name: 'SQL Query', category: 'Workbench' };

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
      {/* left: tables + columns */}
      <div style={{ width: 250, borderRight: '1px solid #EFEBE9', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ padding: 8, display: 'flex', gap: 6 }}>
          <Input size="small" placeholder="Filter tables…" allowClear value={objFilter} onChange={e => setObjFilter(e.target.value)} />
          <Tooltip title="Refresh"><Button size="small" icon={<ReloadOutlined />} onClick={loadObjects} /></Tooltip>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', fontSize: 12 }}>
          {objLoading ? <div style={{ textAlign: 'center', padding: 20 }}><Spin size="small" /></div>
            : !visibleObjects.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No tables" style={{ marginTop: 24 }} />
              : visibleObjects.map(o => (
                <div key={o.name}>
                  <div onClick={() => insertTable(o.name)}
                    title={o.comment || o.name}
                    style={{ padding: '3px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: '#8B8580', fontSize: 10, width: 10 }}>{expanded[o.name] ? '▾' : '▸'}</span>
                    <span style={{ fontFamily: 'monospace', fontSize: 11.5, color: '#3A3632', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.name}</span>
                    {o.type === 'VIEW' && <Tag style={{ fontSize: 8, lineHeight: '12px', padding: '0 3px', margin: 0 }}>V</Tag>}
                  </div>
                  {expanded[o.name] && (
                    <div style={{ paddingLeft: 26, paddingBottom: 4 }}>
                      {(o.columns || []).map(c => (
                        <div key={c.name}
                          title={`${c.dataType}${c.comment ? ` — ${c.comment}` : ''} (click to copy)`}
                          onClick={() => { navigator.clipboard.writeText(c.name.toLowerCase()); message.success(`${c.name} copied`); }}
                          style={{ fontFamily: 'monospace', fontSize: 10.5, color: '#6B6B6B', cursor: 'pointer', padding: '1px 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {c.name} <span style={{ color: '#B8B2AC' }}>{c.dataType}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
        </div>
      </div>

      {/* right: SQL editor + results */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ padding: 10, borderBottom: '1px solid #EFEBE9' }}>
          <Input.TextArea
            value={sql}
            onChange={e => setSql(e.target.value)}
            onKeyDown={e => { if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); runSql(); } }}
            placeholder="Type a SELECT statement… (click a table on the left to start; Ctrl+Enter runs)"
            autoSize={{ minRows: 4, maxRows: 10 }}
            style={{ fontFamily: 'monospace', fontSize: 12 }}
          />
          <Space style={{ marginTop: 8 }} wrap>
            <Button size="small" type="primary" icon={<CaretRightOutlined />} loading={running}
              onClick={runSql} style={{ background: '#C74634', borderColor: '#C74634' }}>Run</Button>
            <Button size="small" icon={<SaveOutlined />} disabled={!sql.trim()} onClick={() => setSaveOpen(true)}>Save</Button>
            <Button size="small" icon={<FileExcelOutlined />} disabled={!result}
              onClick={() => result && exportResultExcel(exportMeta, { ...result, rows: filteredRows, rowCount: filteredRows.length })}>Excel</Button>
            <Button size="small" icon={<PrinterOutlined />} disabled={!result}
              onClick={() => result && exportResultPdf(exportMeta, { ...result, rows: filteredRows, rowCount: filteredRows.length })}>PDF</Button>
            {result && (
              <Input size="small" allowClear placeholder="Filter rows…" value={rowFilter}
                onChange={e => setRowFilter(e.target.value)} style={{ width: 170 }} />
            )}
          </Space>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: 10 }}>
          {running && <div style={{ textAlign: 'center', padding: 30 }}><Spin /></div>}
          {runError && <Text type="danger" style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>{runError}</Text>}
          {result && (
            <>
              <div style={{ fontSize: 11, color: '#8B8580', marginBottom: 6 }}>
                {filteredRows.length}{rowFilter ? ` of ${result.rowCount}` : ''} rows{result.truncated ? ' (capped at 500)' : ''} · {result.elapsedMs} ms
              </div>
              <Table
                size="small"
                dataSource={filteredRows}
                columns={resultColumns}
                rowKey={(_, i) => String(i)}
                pagination={{ pageSize: 25, size: 'small', showTotal: t => `${t} rows` }}
                scroll={{ x: true }}
              />
            </>
          )}
          {!running && !result && !runError && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              Results appear here. SELECT-only — writes are rejected by the gateway.
            </Text>
          )}
        </div>
      </div>

      <SaveReportModal
        open={saveOpen}
        sql={sql.trim()}
        userName={userName}
        onClose={() => setSaveOpen(false)}
      />
    </div>
  );
};
