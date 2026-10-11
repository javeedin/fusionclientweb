// Cash Management — one archived bank reconciliation: header (business unit, bank account, period,
// reconciled date, comments, attachments), reconciliation summary, and tabs for the account analysis
// of the bank's cash account and the manual reconciled data pasted by the user.
// Used by the Archive popup on Bank Reconciliation (create) and the Archived Statements record tab (view / edit).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';
import {
  Alert, Button, Card, DatePicker, Empty, Input, Modal, Popconfirm, Segmented, Space, Spin, Table, Tabs, Tag,
  Tooltip, Typography, Upload, message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  CheckCircleFilled, CloudDownloadOutlined, DeleteOutlined, FileExcelOutlined, InboxOutlined,
  PaperClipOutlined, ReloadOutlined, SaveOutlined, SnippetsOutlined, StopOutlined, SyncOutlined, ClearOutlined,
} from '@ant-design/icons';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import {
  ARCHIVE_PROC, ArchiveAttachment, ArchiveHeader, GlLine, INSTALL_SCRIPT, MAX_ATTACHMENT_BYTES, archiveNotInstalled, cmExec,
  downloadAttachment, fileToBase64, loadArchive, loadArchiveAttachments, loadArchiveGlLines, loadArchiveManualText,
  parseManual, previewAccountAnalysis,
} from '../../../services/cmArchive.service';

const { Text } = Typography;
const RED = '#C74634';
const GREEN = '#1D7B4D';
const BLUE = '#0572CE';

/** The statement being archived (create mode). */
export interface StatementSeed {
  statementId: number; statementNumber: string; statementDate: string;
  businessUnitName?: string | null; bankAccountName: string; bankAccountNumber?: string | null; currencyCode?: string | null;
  cashAccount?: string | null; openingBalance?: number | null; closingBalance?: number | null;
  totalLines?: number | null; reconLines?: number | null; unreconLines?: number | null;
  defaultFrom: string; defaultTo: string;
}

const fmt = (v: number | null | undefined, dp = 2) =>
  v === null || v === undefined || Number.isNaN(v) ? '—' : Number(v).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
const fmtDate = (v?: string | null) => (v ? dayjs(String(v).slice(0, 10)).format('DD-MMM-YYYY') : '—');
const kb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

const Field: React.FC<{ label: string; children: React.ReactNode; span?: number }> = ({ label, children, span }) => (
  <div style={{ gridColumn: span ? `span ${span}` : undefined, minWidth: 0 }}>
    <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 2 }}>{label}</Text>
    <div style={{ fontSize: 13, minHeight: 24, overflow: 'hidden', textOverflow: 'ellipsis' }}>{children}</div>
  </div>
);

const Stat: React.FC<{ label: string; value: React.ReactNode; color?: string; sub?: React.ReactNode }> = ({ label, value, color, sub }) => (
  <div style={{ background: '#fff', border: '1px solid #eef0f3', borderRadius: 8, padding: '8px 12px', minWidth: 0 }}>
    <Text type="secondary" style={{ fontSize: 11 }}>{label}</Text>
    <div style={{ fontSize: 16, fontWeight: 700, color: color || '#262626', whiteSpace: 'nowrap' }}>{value}</div>
    {sub && <div style={{ fontSize: 11, color: '#8c8c8c' }}>{sub}</div>}
  </div>
);

export const ArchiveDetail: React.FC<{
  archiveId?: number | null;
  seed?: StatementSeed;
  user: string;
  /** an archive was created / saved */
  onSaved?: (id: number, number: string | null) => void;
  /** close the popup / tab */
  onClose?: () => void;
  /** the archive header was loaded */
  onLoaded?: (h: ArchiveHeader) => void;
}> = ({ archiveId: initialId, seed, user, onSaved, onClose, onLoaded }) => {
  const [archiveId, setArchiveId] = useState<number | null>(initialId ?? null);
  const [hdr, setHdr] = useState<ArchiveHeader | null>(null);
  const [loading, setLoading] = useState(!!initialId);
  const [installed, setInstalled] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState(seed?.defaultFrom || '');
  const [dateTo, setDateTo] = useState(seed?.defaultTo || '');
  const [reconciledDate, setReconciledDate] = useState(dayjs().format('YYYY-MM-DD'));
  const [comments, setComments] = useState('');
  const [manual, setManual] = useState('');
  const [manualSaved, setManualSaved] = useState('');
  const [headerMode, setHeaderMode] = useState<'auto' | 'yes' | 'no'>('auto');
  const [gl, setGl] = useState<GlLine[]>([]);
  const [glLoading, setGlLoading] = useState(false);
  const [glError, setGlError] = useState<string | null>(null);
  const [glFilter, setGlFilter] = useState('');
  const [atts, setAtts] = useState<ArchiveAttachment[]>([]);
  const [queued, setQueued] = useState<File[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState('analysis');
  const saved = useRef({ dateFrom: '', dateTo: '', reconciledDate: '', comments: '' });
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;

  const isNew = !archiveId;
  const cancelled = hdr?.STATUS === 'CANCELLED';
  const readOnly = cancelled;
  const cashAccount = hdr?.CASH_ACCOUNT || seed?.cashAccount || '';
  const currency = hdr?.CURRENCY_CODE || seed?.currencyCode || '';

  // ── loading ────────────────────────────────────────────────────────────────
  const loadAll = useCallback(async (id: number) => {
    setLoading(true); setError(null);
    try {
      const h = await loadArchive(id);
      if (!h) { setError('Archive not found'); return; }
      const [lines, text, files] = await Promise.all([loadArchiveGlLines(id), loadArchiveManualText(id), loadArchiveAttachments(id)]);
      setHdr(h); setGl(lines); setManual(text); setManualSaved(text); setAtts(files);
      onLoadedRef.current?.(h);
      const df = String(h.DATE_FROM || '').slice(0, 10); const dt = String(h.DATE_TO || '').slice(0, 10);
      const rd = String(h.RECONCILED_DATE || '').slice(0, 10);
      setDateFrom(df); setDateTo(dt); setReconciledDate(rd); setComments(h.COMMENTS || '');
      saved.current = { dateFrom: df, dateTo: dt, reconciledDate: rd, comments: h.COMMENTS || '' };
      setInstalled(true);
    } catch (e: any) {
      if (archiveNotInstalled(e)) setInstalled(false); else setError(e.message);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { if (archiveId) loadAll(archiveId); }, [archiveId, loadAll]);

  // create mode: live account analysis of the cash account for the chosen period
  const preview = useCallback(async () => {
    if (!isNew || !cashAccount || !dateFrom || !dateTo) return;
    setGlLoading(true); setGlError(null);
    try { setGl(await previewAccountAnalysis(cashAccount, dateFrom, dateTo)); }
    catch (e: any) { setGl([]); setGlError(e.message); }
    finally { setGlLoading(false); }
  }, [isNew, cashAccount, dateFrom, dateTo]);
  useEffect(() => { const t = setTimeout(preview, 300); return () => clearTimeout(t); }, [preview]);

  // ── derived ────────────────────────────────────────────────────────────────
  const totals = useMemo(() => gl.reduce((t, l) => ({ dr: t.dr + l.enteredDr, cr: t.cr + l.enteredCr }), { dr: 0, cr: 0 }), [gl]);
  const shownGl = useMemo(() => {
    const q = glFilter.trim().toLowerCase();
    return q ? gl.filter(l => [l.description, l.batchName, l.journalName, l.source, l.category, l.periodName, l.accountingDate,
      ...l.references, String(l.enteredDr), String(l.enteredCr)].some(v => String(v || '').toLowerCase().includes(q))) : gl;
  }, [gl, glFilter]);
  const grid = useMemo(() => parseManual(manual, headerMode === 'auto' ? undefined : headerMode === 'yes'), [manual, headerMode]);
  const difference = hdr?.DIFFERENCE ?? null;
  const tiesOut = (t: number | null) => t !== null && difference !== null && Math.abs(Math.abs(t) - Math.abs(difference)) < 0.005 && Math.abs(difference) >= 0.005;
  const dirty = !isNew && !readOnly && (manual !== manualSaved || dateFrom !== saved.current.dateFrom || dateTo !== saved.current.dateTo
    || reconciledDate !== saved.current.reconciledDate || comments !== saved.current.comments);
  const datesChanged = !isNew && (dateFrom !== saved.current.dateFrom || dateTo !== saved.current.dateTo);

  // ── actions ────────────────────────────────────────────────────────────────
  const addFiles = (files: File[]) => {
    const ok = files.filter(f => {
      if (f.size > MAX_ATTACHMENT_BYTES) { message.error(`${f.name} is larger than 20 MB`); return false; }
      return true;
    });
    if (!ok.length) return;
    if (isNew) setQueued(q => [...q, ...ok]);
    else uploadFiles(archiveId!, ok).then(() => loadArchiveAttachments(archiveId!).then(setAtts));
  };
  const uploadFiles = async (id: number, files: File[]) => {
    let done = 0;
    for (const f of files) {
      setBusy(`Uploading ${f.name}…`);
      try {
        const fileContent = await fileToBase64(f);
        await cmExec(ARCHIVE_PROC.addAttachment, { p_archive_id: id, p_json: { fileName: f.name, mimeType: f.type || null, fileContent } }, user);
        done++;
      } catch (e: any) { message.error(`${f.name}: ${e.message}`, 8); }
    }
    setBusy(null);
    if (done) message.success(`${done} file(s) attached`);
  };

  const create = async () => {
    if (!seed) return;
    if (!dateFrom || !dateTo) { message.warning('Enter the period (date from and date to)'); return; }
    if (dateFrom > dateTo) { message.warning('Date from must not be after date to'); return; }
    setBusy('Archiving…');
    try {
      const r = await cmExec(ARCHIVE_PROC.create, { p_json: {
        statementId: seed.statementId, dateFrom, dateTo, reconciledDate: reconciledDate || null, comments: comments.trim() || null,
        cashAccount: seed.cashAccount || null, manualText: manual,
      } }, user);
      message.success(r.message || 'Archived', 6);
      if (r.id && queued.length) await uploadFiles(r.id, queued);
      setQueued([]);
      if (r.id) { setArchiveId(r.id); onSaved?.(r.id, r.number); }
    } catch (e: any) { message.error(e.message, 10); } finally { setBusy(null); }
  };

  const save = async () => {
    if (!archiveId) return;
    if (dateFrom > dateTo) { message.warning('Date from must not be after date to'); return; }
    setBusy('Saving…');
    try {
      const r = await cmExec(ARCHIVE_PROC.update, { p_archive_id: archiveId, p_json: {
        dateFrom, dateTo, reconciledDate: reconciledDate || null, comments: comments.trim() || null, manualText: manual,
      } }, user);
      message.success(r.message || 'Saved', 6);
      await loadAll(archiveId);
      onSaved?.(archiveId, r.number);
    } catch (e: any) { message.error(e.message, 10); } finally { setBusy(null); }
  };

  const refresh = async () => {
    if (!archiveId) return;
    setBusy('Taking the account analysis again…');
    try {
      const r = await cmExec(ARCHIVE_PROC.refresh, { p_archive_id: archiveId }, user);
      message.success(r.message || 'Refreshed');
      await loadAll(archiveId);
    } catch (e: any) { message.error(e.message, 10); } finally { setBusy(null); }
  };

  const cancelArchive = () => {
    let reason = '';
    Modal.confirm({
      title: `Cancel archive ${hdr?.ARCHIVE_NUMBER}?`, okText: 'Cancel archive', okButtonProps: { danger: true }, cancelText: 'Keep it',
      content: <div>
        <p style={{ marginBottom: 8 }}>The archive is kept for audit but marked cancelled, and the statement can be archived again.</p>
        <Input.TextArea rows={3} placeholder="Reason (required)" onChange={e => { reason = e.target.value; }} />
      </div>,
      onOk: async () => {
        if (!reason.trim()) { message.warning('Enter the reason'); throw new Error('reason'); }
        const r = await cmExec(ARCHIVE_PROC.cancel, { p_archive_id: archiveId, p_reason: reason.trim() }, user).catch((e: any) => { message.error(e.message, 8); throw e; });
        message.success(r.message || 'Cancelled');
        await loadAll(archiveId!);
        onSaved?.(archiveId!, hdr?.ARCHIVE_NUMBER ?? null);
      },
    });
  };

  const removeAttachment = async (a: ArchiveAttachment) => {
    try { await cmExec(ARCHIVE_PROC.deleteAttachment, { p_attachment_id: a.ATTACHMENT_ID }, user); message.success(`${a.FILE_NAME} removed`); setAtts(x => x.filter(y => y.ATTACHMENT_ID !== a.ATTACHMENT_ID)); }
    catch (e: any) { message.error(e.message, 8); }
  };
  const download = async (a: ArchiveAttachment) => {
    const key = `dl${a.ATTACHMENT_ID}`;
    message.loading({ content: `Downloading ${a.FILE_NAME}…`, key, duration: 0 });
    try {
      const blob = await downloadAttachment(a, pct => message.loading({ content: `Downloading ${a.FILE_NAME}… ${pct}%`, key, duration: 0 }));
      saveAs(blob, a.FILE_NAME);
      message.success({ content: `${a.FILE_NAME} downloaded`, key });
    } catch (e: any) { message.error({ content: e.message, key, duration: 8 }); }
  };

  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    const head: [string, unknown][] = [
      ['Archive', hdr?.ARCHIVE_NUMBER || '(not archived yet)'], ['Status', hdr?.STATUS || ''],
      ['Business unit', hdr?.BUSINESS_UNIT_NAME ?? seed?.businessUnitName ?? ''], ['Bank account', hdr?.BANK_ACCOUNT_NAME ?? seed?.bankAccountName ?? ''],
      ['Account number', hdr?.BANK_ACCOUNT_NUMBER ?? seed?.bankAccountNumber ?? ''], ['Cash account', cashAccount],
      ['Statement', hdr?.STATEMENT_NUMBER ?? seed?.statementNumber ?? ''], ['Statement date', (hdr?.STATEMENT_DATE ?? seed?.statementDate ?? '').slice(0, 10)],
      ['Date from', dateFrom], ['Date to', dateTo], ['Reconciled date', reconciledDate], ['Comments', comments],
      ['Statement opening balance', hdr?.STMT_OPENING_BALANCE ?? seed?.openingBalance ?? ''], ['Statement closing balance', hdr?.STMT_CLOSING_BALANCE ?? seed?.closingBalance ?? ''],
      ['GL opening balance', hdr?.GL_OPENING_BALANCE ?? ''], ['GL debits', totals.dr], ['GL credits', totals.cr],
      ['GL closing balance', hdr?.GL_CLOSING_BALANCE ?? ''], ['Difference (bank − GL)', difference ?? ''],
      ['Archived by', hdr?.CREATED_BY ?? ''], ['Archived on', String(hdr?.CREATION_DATE ?? '').replace('T', ' ').slice(0, 16)],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Field', 'Value'], ...head]), 'Archive');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(gl.map(l => ({
      Date: l.accountingDate, Period: l.periodName, Source: l.source, Category: l.category, Batch: l.batchName, Journal: l.journalName,
      Description: l.description, 'Ref 1': l.references[0] || '', 'Ref 2': l.references[1] || '', 'Ref 3': l.references[2] || '',
      'Ref 4': l.references[3] || '', 'Ref 5': l.references[4] || '', Currency: l.currency, 'Entered Dr': l.enteredDr, 'Entered Cr': l.enteredCr,
      'Accounted Dr': l.accountedDr, 'Accounted Cr': l.accountedCr, Account: l.account, 'Header ID': l.jeHeaderId, Line: l.jeLineNumber,
    }))), 'Account Analysis');
    const cells = manual.replace(/\r\n?/g, '\n').split('\n').map(r => r.split('\t'));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(cells.length ? cells : [['']]), 'Manual Reconciled Data');
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    saveAs(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      `${hdr?.ARCHIVE_NUMBER || 'Archive'}_${(hdr?.STATEMENT_NUMBER || seed?.statementNumber || '').replace(/[^\w-]+/g, '_')}.xlsx`);
  };

  // ── render ─────────────────────────────────────────────────────────────────
  if (loading) return <div style={{ padding: 60, textAlign: 'center' }}><Spin /></div>;
  if (!installed) {
    return <Alert type="warning" showIcon message="Bank reconciliation archive is not installed in the database"
      description={<span>Run <code>{INSTALL_SCRIPT}</code>. It creates the archive tables and the <code>cash/execute</code> service.</span>} />;
  }
  if (error) return <Alert type="error" showIcon message={error} />;

  const bu = hdr?.BUSINESS_UNIT_NAME ?? seed?.businessUnitName;
  const stmtOpen = hdr?.STMT_OPENING_BALANCE ?? seed?.openingBalance ?? null;
  const stmtClose = hdr?.STMT_CLOSING_BALANCE ?? seed?.closingBalance ?? null;
  const unrecon = hdr?.STMT_UNRECON_LINES ?? seed?.unreconLines ?? null;
  const date = (v: string, set: (s: string) => void, disabled = false) => (
    <DatePicker size="small" style={{ width: '100%' }} format="DD-MMM-YYYY" allowClear={false} disabled={disabled || readOnly}
      value={v ? dayjs(v) : null} onChange={d => set(d ? d.format('YYYY-MM-DD') : '')} />
  );

  const glColumns: ColumnsType<GlLine> = [
    { title: 'Date', dataIndex: 'accountingDate', width: 116, render: v => <span style={{ whiteSpace: 'nowrap' }}>{fmtDate(v)}</span>, sorter: (a, b) => a.accountingDate.localeCompare(b.accountingDate) },
    { title: 'Period', dataIndex: 'periodName', width: 80 },
    { title: 'Source / category', width: 170, ellipsis: true, render: (_, l) => <Tooltip title={`${l.source} · ${l.category}`}><span style={{ fontSize: 12 }}>{l.source}<br /><Text type="secondary" style={{ fontSize: 11 }}>{l.category}</Text></span></Tooltip> },
    { title: 'Batch / journal', width: 200, ellipsis: true, render: (_, l) => <Tooltip title={l.journalName || l.batchName}><span style={{ fontSize: 12 }}>{l.batchName}{l.journalName && <><br /><Text type="secondary" style={{ fontSize: 11 }}>{l.journalName}</Text></>}</span></Tooltip> },
    { title: 'Description', dataIndex: 'description', ellipsis: true, render: v => <Tooltip title={v}><span style={{ fontSize: 12 }}>{v || '—'}</span></Tooltip> },
    { title: 'References', width: 170, ellipsis: true, render: (_, l) => { const r = l.references.filter(Boolean).join(' · '); return r ? <Tooltip title={r}><span style={{ fontSize: 11 }}>{r}</span></Tooltip> : <Text type="secondary">—</Text>; } },
    { title: 'Debit', dataIndex: 'enteredDr', width: 120, align: 'right', render: v => (v ? <span style={{ color: GREEN }}>{fmt(v)}</span> : <Text type="secondary">—</Text>), sorter: (a, b) => a.enteredDr - b.enteredDr },
    { title: 'Credit', dataIndex: 'enteredCr', width: 120, align: 'right', render: v => (v ? <span style={{ color: RED }}>{fmt(v)}</span> : <Text type="secondary">—</Text>), sorter: (a, b) => a.enteredCr - b.enteredCr },
    { title: 'Ccy', dataIndex: 'currency', width: 55 },
  ];

  const attachmentsBlock = (
    <div>
      {!readOnly && (
        <Upload.Dragger multiple showUploadList={false} beforeUpload={(_, list) => { if (_ === list[0]) addFiles(list as unknown as File[]); return false; }}
          style={{ padding: 0 }} disabled={!!busy}>
          <div style={{ padding: '4px 0', fontSize: 12 }}><InboxOutlined style={{ color: BLUE, marginRight: 6 }} />Drop files here or click to attach (up to 20 MB each)</div>
        </Upload.Dragger>
      )}
      <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {queued.map((f, i) => (
          <Tag key={`q${i}`} icon={<PaperClipOutlined />} color="gold" closable onClose={e => { e.preventDefault(); setQueued(q => q.filter((_, j) => j !== i)); }}>
            {f.name} · {kb(f.size)} <Text type="secondary" style={{ fontSize: 10 }}>(uploads on archive)</Text>
          </Tag>
        ))}
        {atts.map(a => (
          <Tag key={a.ATTACHMENT_ID} icon={<PaperClipOutlined />} color="blue" style={{ paddingRight: 2 }}>
            <a onClick={() => download(a)} title={`Download · ${a.UPLOADED_BY || ''} ${String(a.UPLOAD_DATE || '').replace('T', ' ').slice(0, 16)}`}>{a.FILE_NAME}</a> · {kb(a.FILE_SIZE)}
            <Button type="text" size="small" icon={<CloudDownloadOutlined />} onClick={() => download(a)} style={{ height: 18 }} />
            {!readOnly && <Popconfirm title={`Remove ${a.FILE_NAME}?`} okText="Remove" okButtonProps={{ danger: true }} onConfirm={() => removeAttachment(a)}>
              <Button type="text" size="small" danger icon={<DeleteOutlined />} style={{ height: 18 }} /></Popconfirm>}
          </Tag>
        ))}
        {!queued.length && !atts.length && readOnly && <Text type="secondary" style={{ fontSize: 12 }}>No attachments</Text>}
      </div>
    </div>
  );

  return (
    <Spin spinning={!!busy} tip={busy || undefined}>
      {cancelled && <Alert type="error" showIcon style={{ marginBottom: 10 }} message={`Cancelled${hdr?.CANCEL_REASON ? `: ${hdr.CANCEL_REASON}` : ''}`}
        description="Kept for audit. The statement can be archived again." />}
      {isNew && !seed?.cashAccount && <Alert type="warning" showIcon style={{ marginBottom: 10 }}
        message="No cash account found for this bank account in the bank list"
        description="The database looks it up again by the account number when you archive. The preview below needs it, so it stays empty." />}
      {isNew && !!unrecon && unrecon > 0 && <Alert type="info" showIcon style={{ marginBottom: 10 }}
        message={`${unrecon} statement line(s) are still unreconciled`} description="You can archive anyway — explain the open items in the manual reconciled data." />}

      {/* ── header ── */}
      <Card size="small" style={{ borderRadius: 10, marginBottom: 10 }} styles={{ body: { padding: '10px 14px' } }}
        title={<Space size={8} wrap>
          <Text strong>{hdr ? hdr.ARCHIVE_NUMBER : 'New archive'}</Text>
          {hdr && <Tag color={cancelled ? 'red' : 'green'}>{hdr.STATUS}</Tag>}
          <Text type="secondary" style={{ fontSize: 12 }}>Statement {hdr?.STATEMENT_NUMBER ?? seed?.statementNumber} · {fmtDate(hdr?.STATEMENT_DATE ?? seed?.statementDate)}</Text>
          {hdr && <Text type="secondary" style={{ fontSize: 12 }}>· archived {fmtDate(hdr.CREATION_DATE)} by {hdr.CREATED_BY}</Text>}
        </Space>}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '8px 16px' }}>
          <Field label="Business unit">{bu || '—'}</Field>
          <Field label="Bank account" span={2}><Tooltip title={hdr?.BANK_ACCOUNT_NAME ?? seed?.bankAccountName}>{hdr?.BANK_ACCOUNT_NAME ?? seed?.bankAccountName}</Tooltip></Field>
          <Field label="Account number">{hdr?.BANK_ACCOUNT_NUMBER ?? seed?.bankAccountNumber ?? '—'} {currency && <Tag style={{ marginLeft: 4 }}>{currency}</Tag>}</Field>
          <Field label="Date from">{date(dateFrom, setDateFrom)}</Field>
          <Field label="Date to">{date(dateTo, setDateTo)}</Field>
          <Field label="Reconciled date">{date(reconciledDate, setReconciledDate)}</Field>
          <Field label="Cash account"><Text code style={{ fontSize: 11 }}>{cashAccount || '—'}</Text></Field>
          <Field label="Comments" span={2}>
            <Input.TextArea value={comments} onChange={e => setComments(e.target.value)} autoSize={{ minRows: 2, maxRows: 5 }} maxLength={4000}
              disabled={readOnly} placeholder="Reconciliation notes, sign-off, open items…" />
          </Field>
          <Field label="Attachments" span={2}>{attachmentsBlock}</Field>
        </div>
        {datesChanged && <Alert type="warning" showIcon style={{ marginTop: 8 }} message="The period changed — saving takes the account analysis again for the new dates." />}
      </Card>

      {/* ── reconciliation summary ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: 8, marginBottom: 10 }}>
        <Stat label="Bank opening" value={fmt(stmtOpen)} />
        <Stat label="Bank closing" value={fmt(stmtClose)} color={BLUE} />
        <Stat label="GL opening" value={fmt(hdr?.GL_OPENING_BALANCE)} sub={isNew ? 'worked out when archived' : 'before date from'} />
        <Stat label="GL movement" value={fmt(totals.dr - totals.cr)} sub={`Dr ${fmt(totals.dr)} · Cr ${fmt(totals.cr)}`} />
        <Stat label="GL closing" value={fmt(hdr?.GL_CLOSING_BALANCE)} color={BLUE} sub={isNew ? 'worked out when archived' : `as of ${fmtDate(dateTo)}`} />
        <Stat label="Difference (bank − GL)" value={fmt(difference)}
          color={difference === null ? undefined : Math.abs(difference) < 0.005 ? GREEN : RED}
          sub={difference === null ? (isNew ? 'after archiving' : '—') : Math.abs(difference) < 0.005 ? 'Bank agrees with GL' : 'explain in manual data'} />
      </div>

      {/* ── details ── */}
      <Card size="small" style={{ borderRadius: 10 }} styles={{ body: { padding: '4px 12px 12px' } }}>
        <Tabs activeKey={tab} onChange={setTab} items={[
          {
            key: 'analysis', label: <span>Account Analysis <Tag style={{ marginLeft: 4 }}>{gl.length}</Tag></span>,
            children: (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                  <Space wrap size={6}>
                    <Input.Search size="small" allowClear placeholder="Filter lines" style={{ width: 220 }} value={glFilter} onChange={e => setGlFilter(e.target.value)} />
                    {isNew
                      ? <Button size="small" icon={<ReloadOutlined />} loading={glLoading} onClick={preview} disabled={!cashAccount}>Reload preview</Button>
                      : !readOnly && <Tooltip title="Query the account analysis again and replace the archived lines">
                          <Button size="small" icon={<SyncOutlined />} onClick={refresh}>Take again</Button></Tooltip>}
                  </Space>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {isNew ? 'Live preview from GL Account Analysis — archived as shown when you click Archive'
                      : `Snapshot taken ${String(hdr?.ANALYSIS_DATE || '').replace('T', ' ').slice(0, 16)}`}
                  </Text>
                </div>
                {glError && <Alert type="error" showIcon style={{ marginBottom: 8 }} message={glError} />}
                <Table<GlLine> size="small" rowKey="key" loading={glLoading} dataSource={shownGl} columns={glColumns}
                  pagination={{ pageSize: 50, showSizeChanger: true, pageSizeOptions: ['25', '50', '100', '200'], showTotal: t => `${t} line(s)` }}
                  scroll={{ x: 1150, y: 380 }}
                  locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={cashAccount ? 'No GL lines on the cash account in this period' : 'No cash account'} /> }}
                  summary={() => shownGl.length ? (
                    <Table.Summary fixed="bottom">
                      <Table.Summary.Row style={{ background: '#fafafa', fontWeight: 600 }}>
                        <Table.Summary.Cell index={0} colSpan={6}>Total{glFilter ? ' (filtered)' : ''} · net {fmt(shownGl.reduce((s, l) => s + l.enteredDr - l.enteredCr, 0))}</Table.Summary.Cell>
                        <Table.Summary.Cell index={6} align="right"><span style={{ color: GREEN }}>{fmt(shownGl.reduce((s, l) => s + l.enteredDr, 0))}</span></Table.Summary.Cell>
                        <Table.Summary.Cell index={7} align="right"><span style={{ color: RED }}>{fmt(shownGl.reduce((s, l) => s + l.enteredCr, 0))}</span></Table.Summary.Cell>
                        <Table.Summary.Cell index={8} />
                      </Table.Summary.Row>
                    </Table.Summary>
                  ) : null} />
              </div>
            ),
          },
          {
            key: 'manual', label: <span>Manual Reconciled Data <Tag style={{ marginLeft: 4 }}>{grid.rows.length}</Tag>{manual !== manualSaved && !isNew ? ' •' : ''}</span>,
            children: (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                  <Space wrap size={6}>
                    {!readOnly && <Button size="small" icon={<SnippetsOutlined />} onClick={async () => {
                      try { const t = await navigator.clipboard.readText(); setManual(m => (m && !m.endsWith('\n') ? `${m}\n${t}` : `${m}${t}`)); }
                      catch { message.info('Click in the box and press Ctrl+V to paste'); }
                    }}>Paste from clipboard</Button>}
                    {!readOnly && manual && <Popconfirm title="Clear the manual data?" onConfirm={() => setManual('')}><Button size="small" icon={<ClearOutlined />}>Clear</Button></Popconfirm>}
                    <Text type="secondary" style={{ fontSize: 12 }}>First row is a heading</Text>
                    <Segmented size="small" value={headerMode} onChange={v => setHeaderMode(v as typeof headerMode)}
                      options={[{ value: 'auto', label: 'Auto' }, { value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} />
                  </Space>
                  <Text type="secondary" style={{ fontSize: 12 }}>Copy the cells of your reconciliation working in Excel and paste them here. Columns are kept.</Text>
                </div>
                <Input.TextArea value={manual} onChange={e => setManual(e.target.value)} disabled={readOnly}
                  autoSize={{ minRows: 5, maxRows: 10 }} style={{ fontFamily: 'Consolas, Menlo, monospace', fontSize: 12, whiteSpace: 'pre', overflowX: 'auto' }}
                  placeholder={'Date\tReference\tDescription\tAmount\n30-Sep-2026\tCHQ 1042\tCheque issued, not yet presented\t-12,500.00'} />
                {grid.rows.length > 0 ? (
                  <div style={{ marginTop: 10, maxHeight: 340, overflow: 'auto', border: '1px solid #f0f0f0', borderRadius: 8 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead style={{ position: 'sticky', top: 0, background: '#fafafa', zIndex: 1 }}>
                        <tr>
                          <th style={{ padding: '4px 8px', borderBottom: '1px solid #f0f0f0', color: '#8c8c8c', width: 36 }}>#</th>
                          {Array.from({ length: grid.columns }, (_, c) => (
                            <th key={c} style={{ padding: '4px 8px', borderBottom: '1px solid #f0f0f0', textAlign: grid.totals[c] !== null ? 'right' : 'left', whiteSpace: 'nowrap' }}>
                              {grid.header?.[c] || String.fromCharCode(65 + (c % 26)) + (c >= 26 ? Math.floor(c / 26) : '')}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {grid.rows.map((r, i) => (
                          <tr key={i} style={{ background: i % 2 ? '#fcfcfc' : '#fff' }}>
                            <td style={{ padding: '3px 8px', color: '#bfbfbf' }}>{i + 1}</td>
                            {Array.from({ length: grid.columns }, (_, c) => (
                              <td key={c} style={{ padding: '3px 8px', textAlign: grid.totals[c] !== null ? 'right' : 'left', whiteSpace: 'nowrap' }}>{r[c] ?? ''}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                      {grid.totals.some(t => t !== null) && (
                        <tfoot style={{ position: 'sticky', bottom: 0, background: '#fafafa' }}>
                          <tr>
                            <td style={{ padding: '4px 8px', fontWeight: 600 }}>Σ</td>
                            {grid.totals.map((t, c) => (
                              <td key={c} style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>
                                {t === null ? '' : <Tooltip title={tiesOut(t) ? 'Equals the difference between bank and GL' : undefined}>
                                  <span style={{ color: tiesOut(t) ? GREEN : undefined }}>{tiesOut(t) && <CheckCircleFilled style={{ marginRight: 4 }} />}{fmt(t)}</span>
                                </Tooltip>}
                              </td>
                            ))}
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nothing pasted yet" style={{ marginTop: 16 }} />}
                {grid.totals.some(tiesOut) && <Alert type="success" showIcon style={{ marginTop: 8 }} message="A column of the manual data adds up to the difference between bank and GL — the reconciliation ties out." />}
              </div>
            ),
          },
        ]} />
      </Card>

      {/* ── actions ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
        <Space wrap>
          <Button icon={<FileExcelOutlined />} onClick={exportExcel} disabled={!gl.length && !manual}>Export to Excel</Button>
          {!isNew && !readOnly && <Button danger icon={<StopOutlined />} onClick={cancelArchive}>Cancel archive</Button>}
        </Space>
        <Space wrap>
          {onClose && <Button onClick={onClose}>{isNew ? 'Close' : 'Close tab'}</Button>}
          {isNew
            ? <Button type="primary" icon={<InboxOutlined />} onClick={create} disabled={!dateFrom || !dateTo}
                style={{ background: RED, borderColor: RED }}>Archive</Button>
            : !readOnly && <Button type="primary" icon={<SaveOutlined />} onClick={save} disabled={!dirty}>Save</Button>}
        </Space>
      </div>
      {!isNew && dirty && <div style={{ textAlign: 'right', marginTop: 4 }}><Text type="warning" style={{ fontSize: 12 }}>Unsaved changes</Text></div>}
    </Spin>
  );
};

export default ArchiveDetail;
