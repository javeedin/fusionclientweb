// Full journal preview — read-only version of the Delete Journals "Preview"
// dialog, reusable from any page that knows a JE header id (e.g. Account
// Analysis v2 drill). Loads the whole batch (batch row + all journal headers
// + all lines) through the guarded SQL gateway (POST ai/executequery), plus
// linked external transactions and the journal attachments stored against the
// batch id (cash/externaltransactions/:batchId/attachments — same store the
// Manage Journals page uses).
import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal, Button, Table, Tag, Space, Typography, Alert, Spin, Card, Empty, message,
} from 'antd';
import {
  EyeOutlined, BugOutlined, CheckCircleOutlined, PaperClipOutlined,
  DownloadOutlined, FileOutlined,
} from '@ant-design/icons';
import { APEX_DB_CONFIG } from '../config/api.config';

const { Text } = Typography;

const REDWOOD = {
  primary: '#C74634', primaryDark: '#A33B2C', success: '#1D7B4D',
  warning: '#D4A800', info: '#0572CE',
  neutral200: '#E5E5E5', neutral600: '#6B6B6B',
};

const APEX_BASE = APEX_DB_CONFIG.baseUrl;

interface QR { columns: string[]; rows: (string | number | null)[][] }
interface QSection { res?: QR; err?: string }
type Rec = Record<string, string | number | null>;

const runSql = async (sql: string): Promise<QR> => {
  const res = await fetch(`${APEX_BASE}/ai/executequery`, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ sql, maxRows: 1000, appUser: 'JOURNAL_PREVIEW' }),
  });
  const text = await res.text();
  let data: any = null;
  try { data = JSON.parse(text); } catch { /* non-JSON error page */ }
  if (!res.ok || data?.success === false || !data) {
    const detail = data?.error || data?.message
      || (text ? text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300) : '');
    throw new Error(detail ? `HTTP ${res.status} — ${detail}` : `HTTP ${res.status}`);
  }
  return { columns: data.columns || [], rows: data.rows || [] };
};

const recOf = (r: QR, rowIdx: number): Rec => {
  const rec: Rec = {};
  r.columns.forEach((c, i) => { rec[c.toUpperCase()] = r.rows[rowIdx][i]; });
  return rec;
};
const pick = (rec: Rec | null, keys: string[]): string => {
  if (!rec) return '';
  for (const k of keys) {
    const v = rec[k];
    if (v !== null && v !== undefined && String(v) !== '') return String(v);
  }
  return '';
};
const num = (v: string | number | null | undefined): number =>
  typeof v === 'number' ? v : Number(v) || 0;
const fmtAmt = (n: number) =>
  n === 0 ? '' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const isPostedStatus = (s: string) => s === 'P' || /post/i.test(s);
const fmtBytes = (n: number) => {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};

const EXT_TXN_REF5 = 'BANK_EXTERNAL_TRANSACTIONS';
const extTxnIdsOf = (lines: Rec[]): string[] => {
  const ids = new Set<string>();
  lines.forEach(l => {
    const r5 = String(l.REFERENCE5 ?? '').toUpperCase();
    const r2 = String(l.REFERENCE2 ?? '').trim();
    if (r5 === EXT_TXN_REF5 && /^\d+$/.test(r2)) ids.add(r2);
  });
  return Array.from(ids);
};

interface AttRow {
  id: number;
  name: string;
  fileType: string;
  fileSize: number;
}

interface Props {
  open: boolean;
  /** JE header id to start from — the batch is resolved from it. */
  jeHeaderId?: number | null;
  /** Or the batch id directly. */
  batchId?: number | null;
  onClose: () => void;
}

const JournalFullPreview: React.FC<Props> = ({ open, jeHeaderId, batchId, onClose }) => {
  const [resolvedBatchId, setResolvedBatchId] = useState<number | null>(null);
  const [prevBatch, setPrevBatch]     = useState<QSection>({});
  const [prevHeaders, setPrevHeaders] = useState<QSection>({});
  const [prevLines, setPrevLines]     = useState<QSection>({});
  const [prevExt, setPrevExt]         = useState<QSection>({});
  const [loading, setLoading]         = useState(false);
  const [sqls, setSqls]               = useState<string[]>([]);
  const [sqlOpen, setSqlOpen]         = useState(false);
  const [attachments, setAttachments] = useState<AttRow[]>([]);
  const [attErr, setAttErr]           = useState<string>('');
  const [attBusy, setAttBusy]         = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!open) return;
    (async () => {
      setPrevBatch({}); setPrevHeaders({}); setPrevLines({}); setPrevExt({});
      setAttachments([]); setAttErr('');
      setSqlOpen(false);
      setResolvedBatchId(null);
      setLoading(true);
      const allSqls: string[] = [];
      try {
        // 1) resolve batch id
        let bId = batchId ?? null;
        if (!bId && jeHeaderId) {
          const sql = `SELECT batch_id FROM rr_gl_je_headers WHERE je_header_id = ${jeHeaderId}`;
          allSqls.push(sql);
          const r = await runSql(sql);
          bId = r.rows.length ? num(r.rows[0][0]) : null;
        }
        if (!bId) {
          setPrevBatch({ err: `No batch found for JE header ${jeHeaderId}` });
          setSqls(allSqls);
          setLoading(false);
          return;
        }
        setResolvedBatchId(bId);

        // 2) batch + headers + lines
        const coreSqls = [
          `SELECT * FROM rr_gl_journal_batches WHERE je_batch_id = ${bId}`,
          `SELECT * FROM rr_gl_je_headers WHERE batch_id = ${bId} ORDER BY je_header_id`,
          `SELECT * FROM rr_gl_je_lines_all WHERE je_header_id IN (SELECT je_header_id FROM rr_gl_je_headers WHERE batch_id = ${bId}) ORDER BY je_header_id`,
        ];
        allSqls.push(...coreSqls);
        setSqls([...allSqls]);
        const settled = await Promise.allSettled(coreSqls.map(s => runSql(s)));
        const toSection = (r: PromiseSettledResult<QR>): QSection =>
          r.status === 'fulfilled' ? { res: r.value } : { err: r.reason instanceof Error ? r.reason.message : String(r.reason) };
        setPrevBatch(toSection(settled[0]));
        setPrevHeaders(toSection(settled[1]));
        setPrevLines(toSection(settled[2]));

        // 3) linked external transactions
        const linesQR = settled[2].status === 'fulfilled' ? settled[2].value : null;
        const extIdList = linesQR ? extTxnIdsOf(linesQR.rows.map((_, i) => recOf(linesQR, i))) : [];
        if (extIdList.length) {
          const extSql =
            `SELECT external_transaction_id, transaction_date, transaction_type, bank_account_name, ` +
            `amount, currency_code, status, accounting_flag, description ` +
            `FROM rr_external_cash_transactions WHERE external_transaction_id IN (${extIdList.join(', ')})`;
          allSqls.push(extSql);
          setSqls([...allSqls]);
          try {
            setPrevExt({ res: await runSql(extSql) });
          } catch (e) {
            setPrevExt({ err: e instanceof Error ? e.message : String(e) });
          }
        }

        // 4) journal attachments (stored against the batch id)
        try {
          const res = await fetch(`${APEX_BASE}/cash/externaltransactions/${bId}/attachments`, {
            headers: { Accept: 'application/json' },
          });
          const data = await res.json();
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          setAttachments(((data.items || []) as any[]).map(a => ({
            id: a.id ?? a.ID,
            name: a.fileName || a.file_name || 'attachment',
            fileType: a.fileType || a.file_type || 'application/octet-stream',
            fileSize: Number(a.fileSize || a.file_size || 0),
          })));
        } catch (e: any) {
          setAttErr(e?.message ?? 'Failed to load attachments');
        }
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, jeHeaderId, batchId]);

  // fetch one attachment's base64 content and return it as a blob URL
  const fetchAttachmentBlob = async (att: AttRow): Promise<string> => {
    const res = await fetch(`${APEX_BASE}/cash/externaltransactions/${resolvedBatchId}/attachments/${att.id}`, {
      headers: { Accept: 'application/json' },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const content = data.content || data.CONTENT || '';
    const fileType = data.fileType || data.FILE_TYPE || att.fileType;
    const blob = new Blob([Uint8Array.from(atob(content), c => c.charCodeAt(0))], { type: fileType });
    return URL.createObjectURL(blob);
  };

  const withAttBusy = async (att: AttRow, fn: () => Promise<void>) => {
    setAttBusy(prev => new Set([...prev, att.id]));
    try { await fn(); }
    catch (e: any) { message.error(`Attachment failed: ${e?.message ?? e}`); }
    setAttBusy(prev => { const s = new Set(prev); s.delete(att.id); return s; });
  };

  const downloadAttachment = (att: AttRow) => withAttBusy(att, async () => {
    const url = await fetchAttachmentBlob(att);
    const a = document.createElement('a');
    a.href = url; a.download = att.name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  });

  const openAttachment = (att: AttRow) => withAttBusy(att, async () => {
    const url = await fetchAttachmentBlob(att);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  });

  // shaped records
  const batchRec = useMemo(
    () => (prevBatch.res?.rows.length ? recOf(prevBatch.res, 0) : null), [prevBatch]);
  const headerRecs = useMemo(
    () => (prevHeaders.res ? prevHeaders.res.rows.map((_, i) => recOf(prevHeaders.res!, i)) : []), [prevHeaders]);
  const lineRecs = useMemo(
    () => (prevLines.res ? prevLines.res.rows.map((_, i) => recOf(prevLines.res!, i)) : []), [prevLines]);
  const linesByHeader = useMemo(() => {
    const m = new Map<string, Rec[]>();
    lineRecs.forEach(l => {
      const k = String(l.JE_HEADER_ID ?? '');
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(l);
    });
    return m;
  }, [lineRecs]);
  const overallTotals = useMemo(
    () => lineRecs.reduce<{ dr: number; cr: number }>(
      (a, l) => ({ dr: a.dr + num(l.ACCOUNTED_DR), cr: a.cr + num(l.ACCOUNTED_CR) }),
      { dr: 0, cr: 0 }),
    [lineRecs]);
  const extIds = useMemo(() => extTxnIdsOf(lineRecs), [lineRecs]);
  const extRecs = useMemo(
    () => (prevExt.res ? prevExt.res.rows.map((_, i) => recOf(prevExt.res!, i)) : []), [prevExt]);

  const journalLineCols = [
    { title: '#', key: 'n', width: 44, align: 'center' as const,
      render: (_: unknown, l: Rec) => <Text type="secondary" style={{ fontSize: 11 }}>{pick(l, ['JE_LINE_NUMBER', 'LINE_NUM', 'LINE_ID'])}</Text> },
    { title: 'Account Combination', key: 'acct', width: 230,
      render: (_: unknown, l: Rec) => <span style={{ fontFamily: 'monospace', fontSize: 11.5, color: REDWOOD.info }}>{pick(l, ['ACCOUNT_COMBINATION']) || '—'}</span> },
    { title: 'Description', key: 'desc', ellipsis: true,
      render: (_: unknown, l: Rec) => <span style={{ fontSize: 11.5 }}>{pick(l, ['DESCRIPTION']) || '—'}</span> },
    { title: 'Ccy', key: 'ccy', width: 52, align: 'center' as const,
      render: (_: unknown, l: Rec) => <Tag style={{ fontSize: 10, margin: 0 }}>{pick(l, ['CURRENCY_CODE']) || '—'}</Tag> },
    { title: 'Entered Dr', key: 'edr', width: 110, align: 'right' as const,
      render: (_: unknown, l: Rec) => <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 11.5 }}>{fmtAmt(num(l.ENTERED_DR))}</span> },
    { title: 'Entered Cr', key: 'ecr', width: 110, align: 'right' as const,
      render: (_: unknown, l: Rec) => <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 11.5 }}>{fmtAmt(num(l.ENTERED_CR))}</span> },
    { title: 'Accounted Dr', key: 'adr', width: 120, align: 'right' as const,
      render: (_: unknown, l: Rec) => <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 11.5, fontWeight: 600, color: REDWOOD.success }}>{fmtAmt(num(l.ACCOUNTED_DR))}</span> },
    { title: 'Accounted Cr', key: 'acr', width: 120, align: 'right' as const,
      render: (_: unknown, l: Rec) => <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 11.5, fontWeight: 600, color: REDWOOD.primary }}>{fmtAmt(num(l.ACCOUNTED_CR))}</span> },
    { title: 'References', key: 'refs', width: 170,
      render: (_: unknown, l: Rec) => {
        const r1 = pick(l, ['REFERENCE1']); const r2 = pick(l, ['REFERENCE2']); const r5 = pick(l, ['REFERENCE5']);
        if (!r1 && !r2 && !r5) return <span style={{ fontSize: 10.5, color: '#bbb' }}>—</span>;
        return (
          <div style={{ fontSize: 10, color: REDWOOD.neutral600, lineHeight: 1.5 }}>
            {r5 && <Tag color="purple" style={{ fontSize: 9, lineHeight: '14px', padding: '0 4px', margin: 0 }}>{r5}</Tag>}
            {(r1 || r2) && <div style={{ fontFamily: 'monospace' }}>{[r1, r2].filter(Boolean).join(' · ')}</div>}
          </div>
        );
      } },
  ];

  return (
    <Modal
      open={open}
      onCancel={onClose}
      width={1100}
      title={
        <span>
          <EyeOutlined style={{ color: REDWOOD.info, marginRight: 8 }} />
          Full Journal — Batch {resolvedBatchId ?? '…'}
          {jeHeaderId ? <Tag style={{ marginLeft: 8, fontFamily: 'monospace' }}>from JE {jeHeaderId}</Tag> : null}
        </span>
      }
      footer={[
        <Button key="sql" icon={<BugOutlined />} onClick={() => setSqlOpen(s => !s)}>
          {sqlOpen ? 'Hide SQL' : 'Show SQL'}
        </Button>,
        <Button key="close" onClick={onClose}>Close</Button>,
      ]}
    >
      {loading && <div style={{ textAlign: 'center', padding: 30 }}><Spin /></div>}
      {!loading && (
        <div style={{ maxHeight: '68vh', overflowY: 'auto', paddingRight: 4 }}>
          {sqlOpen && sqls.map((s, i) => (
            <pre key={i} style={{ margin: '4px 0', padding: 8, background: '#F7F5F3', border: '1px solid #EFEBE9', borderRadius: 6, fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{s}</pre>
          ))}

          {(prevBatch.err || prevHeaders.err || prevLines.err) && (
            <Alert type="error" showIcon style={{ marginBottom: 10 }}
              message="Some data could not be loaded"
              description={[prevBatch.err, prevHeaders.err, prevLines.err].filter(Boolean).join(' · ')} />
          )}

          {/* ── Batch banner ── */}
          <div style={{
            background: `linear-gradient(135deg, ${REDWOOD.primary}, ${REDWOOD.primaryDark})`,
            borderRadius: 10, padding: '14px 18px', color: '#fff', marginBottom: 14,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 16, fontWeight: 700 }}>
                {pick(batchRec, ['NAME', 'BATCH_NAME']) || `Batch ${resolvedBatchId ?? ''}`}
              </span>
              <Tag style={{ background: 'rgba(255,255,255,.18)', color: '#fff', border: 'none', fontFamily: 'monospace' }}>
                ID {resolvedBatchId}
              </Tag>
              {pick(batchRec, ['STATUS']) && (
                <Tag color={isPostedStatus(pick(batchRec, ['STATUS'])) ? 'green' : 'gold'} style={{ fontWeight: 600 }}>
                  {pick(batchRec, ['STATUS'])}
                </Tag>
              )}
              {pick(batchRec, ['PERIOD_NAME', 'DEFAULT_PERIOD_NAME']) && (
                <Tag color="geekblue">{pick(batchRec, ['PERIOD_NAME', 'DEFAULT_PERIOD_NAME'])}</Tag>
              )}
              {pick(batchRec, ['ACTUAL_FLAG']) === 'A' && <Tag color="cyan">Actual</Tag>}
              {attachments.length > 0 && (
                <Tag color="blue" style={{ fontWeight: 600 }}>
                  <PaperClipOutlined /> {attachments.length} attachment{attachments.length > 1 ? 's' : ''}
                </Tag>
              )}
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 11, opacity: .85 }}>
                {pick(batchRec, ['CREATED_BY']) && <>by {pick(batchRec, ['CREATED_BY'])}</>}
                {pick(batchRec, ['CREATION_DATE']) && <> · {pick(batchRec, ['CREATION_DATE'])}</>}
              </span>
            </div>
            {pick(batchRec, ['DESCRIPTION']) && (
              <div style={{ fontSize: 12, opacity: .9, marginTop: 6 }}>{pick(batchRec, ['DESCRIPTION'])}</div>
            )}
            <div style={{ display: 'flex', gap: 24, marginTop: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12 }}>Journals <b style={{ fontSize: 15 }}>{headerRecs.length}</b></span>
              <span style={{ fontSize: 12 }}>Lines <b style={{ fontSize: 15 }}>{lineRecs.length}</b></span>
              <span style={{ fontSize: 12 }}>Total Dr <b style={{ fontSize: 15, fontVariantNumeric: 'tabular-nums' }}>{overallTotals.dr.toLocaleString('en-US', { minimumFractionDigits: 2 })}</b></span>
              <span style={{ fontSize: 12 }}>Total Cr <b style={{ fontSize: 15, fontVariantNumeric: 'tabular-nums' }}>{overallTotals.cr.toLocaleString('en-US', { minimumFractionDigits: 2 })}</b></span>
              {Math.abs(overallTotals.dr - overallTotals.cr) < 0.01
                ? <Tag color="green" style={{ fontWeight: 700 }}><CheckCircleOutlined /> Balanced</Tag>
                : <Tag color="red" style={{ fontWeight: 700 }}>Out of balance Δ {(overallTotals.dr - overallTotals.cr).toLocaleString('en-US', { minimumFractionDigits: 2 })}</Tag>}
            </div>
          </div>

          {!batchRec && prevBatch.res && (
            <Alert type="warning" showIcon style={{ marginBottom: 10 }}
              message="No batch row found for this id in RR_GL_JE_BATCHES (headers/lines shown below if any)" />
          )}

          {/* ── One card per journal header, with its lines ── */}
          {headerRecs.length === 0 && prevHeaders.res && (
            <Alert type="warning" showIcon message="No journal headers for this batch" />
          )}
          {headerRecs.map((h, hi) => {
            const hid = String(h.JE_HEADER_ID ?? '');
            const isDrilled = jeHeaderId != null && hid === String(jeHeaderId);
            const hLines = linesByHeader.get(hid) ?? [];
            const dr = hLines.reduce((s, l) => s + num(l.ACCOUNTED_DR), 0);
            const cr = hLines.reduce((s, l) => s + num(l.ACCOUNTED_CR), 0);
            const status = pick(h, ['POSTING_STATUS', 'STATUS']);
            return (
              <Card
                key={hid || hi}
                size="small"
                style={{
                  marginBottom: 12, borderRadius: 10,
                  border: isDrilled ? `2px solid ${REDWOOD.info}` : `1px solid ${REDWOOD.neutral200}`,
                }}
                title={
                  <Space wrap size={6}>
                    <Text strong style={{ fontSize: 13 }}>
                      {pick(h, ['JOURNAL_NAME', 'NAME']) || `Journal ${hid}`}
                    </Text>
                    <Tag style={{ fontFamily: 'monospace', fontSize: 10 }}>HDR {hid}</Tag>
                    {isDrilled && <Tag color="blue" style={{ fontSize: 10, fontWeight: 600 }}>drilled from</Tag>}
                    {status && (
                      <Tag color={isPostedStatus(status) ? 'green' : 'gold'} style={{ fontSize: 10 }}>
                        {isPostedStatus(status) ? 'Posted' : status}
                      </Tag>
                    )}
                    {pick(h, ['PERIOD_NAME']) && <Tag color="geekblue" style={{ fontSize: 10 }}>{pick(h, ['PERIOD_NAME'])}</Tag>}
                    {pick(h, ['LEDGER_NAME']) && <Tag color="purple" style={{ fontSize: 10 }}>{pick(h, ['LEDGER_NAME'])}</Tag>}
                    {pick(h, ['CURRENCY_CODE', 'LEDGER_CURRENCY_CODE']) && (
                      <Tag style={{ fontSize: 10 }}>{pick(h, ['CURRENCY_CODE', 'LEDGER_CURRENCY_CODE'])}</Tag>
                    )}
                    {pick(h, ['USER_JE_CATEGORY_NAME']) && (
                      <Tag color="cyan" style={{ fontSize: 10 }}>{pick(h, ['USER_JE_CATEGORY_NAME'])}</Tag>
                    )}
                  </Space>
                }
                extra={
                  Math.abs(dr - cr) < 0.01
                    ? <Tag color="green" style={{ fontWeight: 600 }}>Dr = Cr</Tag>
                    : <Tag color="red" style={{ fontWeight: 600 }}>Δ {(dr - cr).toLocaleString('en-US', { minimumFractionDigits: 2 })}</Tag>
                }
              >
                {pick(h, ['JOURNAL_DESCRIPTION', 'DESCRIPTION']) && (
                  <Text type="secondary" style={{ fontSize: 11.5, display: 'block', marginBottom: 6 }}>
                    {pick(h, ['JOURNAL_DESCRIPTION', 'DESCRIPTION'])}
                  </Text>
                )}
                <Table
                  size="small"
                  dataSource={hLines}
                  columns={journalLineCols}
                  rowKey={(_, i) => `${hid}-${i}`}
                  pagination={hLines.length > 12 ? { pageSize: 12, size: 'small' } : false}
                  scroll={{ x: 1050 }}
                  summary={() => (
                    <Table.Summary fixed>
                      <Table.Summary.Row style={{ background: '#FBF4F2', fontWeight: 700 }}>
                        <Table.Summary.Cell index={0} colSpan={4} align="right">
                          <Text strong style={{ fontSize: 11.5 }}>TOTAL ({hLines.length} lines)</Text>
                        </Table.Summary.Cell>
                        <Table.Summary.Cell index={4} align="right">
                          <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 11.5 }}>{fmtAmt(hLines.reduce((s, l) => s + num(l.ENTERED_DR), 0))}</span>
                        </Table.Summary.Cell>
                        <Table.Summary.Cell index={5} align="right">
                          <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 11.5 }}>{fmtAmt(hLines.reduce((s, l) => s + num(l.ENTERED_CR), 0))}</span>
                        </Table.Summary.Cell>
                        <Table.Summary.Cell index={6} align="right">
                          <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 11.5, color: REDWOOD.success }}>{fmtAmt(dr)}</span>
                        </Table.Summary.Cell>
                        <Table.Summary.Cell index={7} align="right">
                          <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 11.5, color: REDWOOD.primary }}>{fmtAmt(cr)}</span>
                        </Table.Summary.Cell>
                        <Table.Summary.Cell index={8} />
                      </Table.Summary.Row>
                    </Table.Summary>
                  )}
                />
              </Card>
            );
          })}

          {/* lines whose header row is missing still show */}
          {(() => {
            const known = new Set(headerRecs.map(h => String(h.JE_HEADER_ID ?? '')));
            const orphans = lineRecs.filter(l => !known.has(String(l.JE_HEADER_ID ?? '')));
            if (!orphans.length) return null;
            return (
              <Card size="small" title={<Text strong style={{ fontSize: 12.5, color: REDWOOD.warning }}>Lines without a header row ({orphans.length})</Text>}
                style={{ marginBottom: 12, borderRadius: 10, borderColor: REDWOOD.warning }}>
                <Table size="small" dataSource={orphans} columns={journalLineCols}
                  rowKey={(_, i) => `o${i}`} pagination={{ pageSize: 10, size: 'small' }} scroll={{ x: 1050 }} />
              </Card>
            );
          })()}

          {/* ── External transactions referenced by the journal lines ── */}
          {extIds.length > 0 && (
            <Card
              size="small"
              style={{ marginBottom: 12, borderRadius: 10, border: `1px solid ${REDWOOD.info}` }}
              title={
                <Space size={6}>
                  <Text strong style={{ fontSize: 12.5, color: REDWOOD.info }}>
                    Linked External Transactions ({extIds.length})
                  </Text>
                  <Tag color="purple" style={{ fontSize: 9 }}>{EXT_TXN_REF5}</Tag>
                </Space>
              }
            >
              {prevExt.err && (
                <Alert type="error" showIcon style={{ marginBottom: 8 }}
                  message="Could not load external transaction details" description={prevExt.err} />
              )}
              {extRecs.length > 0 && (
                <Table
                  size="small"
                  dataSource={extRecs}
                  rowKey={(r) => String(r.EXTERNAL_TRANSACTION_ID ?? '')}
                  pagination={false}
                  scroll={{ x: 900 }}
                  columns={[
                    { title: 'Txn ID', key: 'id', width: 110,
                      render: (_: unknown, r: Rec) => <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{pick(r, ['EXTERNAL_TRANSACTION_ID'])}</span> },
                    { title: 'Date', key: 'dt', width: 110,
                      render: (_: unknown, r: Rec) => <span style={{ fontSize: 11 }}>{pick(r, ['TRANSACTION_DATE'])}</span> },
                    { title: 'Type', key: 'ty', width: 90,
                      render: (_: unknown, r: Rec) => <Tag style={{ fontSize: 10 }}>{pick(r, ['TRANSACTION_TYPE'])}</Tag> },
                    { title: 'Bank Account', key: 'ba', ellipsis: true,
                      render: (_: unknown, r: Rec) => <span style={{ fontSize: 11 }}>{pick(r, ['BANK_ACCOUNT_NAME'])}</span> },
                    { title: 'Amount', key: 'am', width: 120, align: 'right' as const,
                      render: (_: unknown, r: Rec) => <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 11 }}>{fmtAmt(num(r.AMOUNT))} {pick(r, ['CURRENCY_CODE'])}</span> },
                    { title: 'Status', key: 'st', width: 100,
                      render: (_: unknown, r: Rec) => <Tag color="blue" style={{ fontSize: 10 }}>{pick(r, ['STATUS'])}</Tag> },
                    { title: 'Accounted', key: 'af', width: 90, align: 'center' as const,
                      render: (_: unknown, r: Rec) => <Tag color={pick(r, ['ACCOUNTING_FLAG']) === 'Y' ? 'green' : 'default'} style={{ fontSize: 10 }}>{pick(r, ['ACCOUNTING_FLAG']) || '—'}</Tag> },
                  ]}
                />
              )}
            </Card>
          )}

          {/* ── Journal attachments ── */}
          <Card
            size="small"
            style={{ marginBottom: 4, borderRadius: 10, border: `1px solid ${REDWOOD.neutral200}` }}
            title={
              <Space size={6}>
                <PaperClipOutlined style={{ color: REDWOOD.info }} />
                <Text strong style={{ fontSize: 12.5 }}>Attachments ({attachments.length})</Text>
              </Space>
            }
          >
            {attErr && (
              <Alert type="warning" showIcon style={{ marginBottom: 8 }}
                message="Could not load attachments" description={attErr} />
            )}
            {!attErr && attachments.length === 0 && (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No attachments on this journal" style={{ margin: '8px 0' }} />
            )}
            {attachments.map(att => (
              <div key={att.id} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                border: '1px solid #f0f0f0', borderRadius: 6, padding: '6px 10px', marginBottom: 6,
              }}>
                <FileOutlined style={{ color: REDWOOD.info }} />
                <Button type="link" size="small" style={{ padding: 0, height: 'auto', fontSize: 12 }}
                  loading={attBusy.has(att.id)} onClick={() => openAttachment(att)}>
                  {att.name}
                </Button>
                <Tag style={{ fontSize: 9 }}>{att.fileType?.split('/')[1]?.toUpperCase() || 'FILE'}</Tag>
                <Text type="secondary" style={{ fontSize: 11 }}>{fmtBytes(att.fileSize)}</Text>
                <span style={{ flex: 1 }} />
                <Button size="small" icon={<DownloadOutlined />}
                  loading={attBusy.has(att.id)} onClick={() => downloadAttachment(att)}>
                  Download
                </Button>
              </div>
            ))}
          </Card>
        </div>
      )}
    </Modal>
  );
};

export default JournalFullPreview;
