// Posted GL journals of a source document, found by the reference stamped on every GL line
// (REFERENCE2 = source id, narrowed by REFERENCE5 / REFERENCE1 so another module's id never matches).
// Reads RR_GL_JE_LINES_ALL → RR_GL_JE_HEADERS → RR_GL_JOURNAL_BATCHES through the read gateway and
// shows each journal the way Manage Journals does (header, conversion, lines, totals). With `loadExpected`
// it also checks the source's own lines against the GL, so lines that never reached the ledger stand out.
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Empty, Modal, Segmented, Space, Spin, Table, Tag, Tooltip, Typography, message } from 'antd';
import {
  AccountBookOutlined, CheckCircleFilled, CloseCircleFilled, CodeOutlined, ExclamationCircleFilled,
  ExpandOutlined, ReloadOutlined, WarningFilled,
} from '@ant-design/icons';
import { poQuery, lit, nlit, n, money, day, type Row } from '../services/po.service';
import { useAccountDescriptions } from '../hooks/useAccountDescriptions';
import JournalFullPreview from './JournalFullPreview';

const { Text } = Typography;

const C = { primary: '#C74634', success: '#1D7B4D', warning: '#D4A800', info: '#0572CE', muted: '#8c8c8c', line: '#f0f0f0' };

/** One line of the source document, to check against the GL. */
export interface ExpectedLine { lineNum?: number; combo: string; dr: number; cr: number; description?: string }

const pick = (r: Row | null | undefined, keys: string[]): any => {
  if (!r) return null;
  for (const k of keys) { const v = r[k]; if (v !== null && v !== undefined && v !== '') return v; }
  return null;
};
const isPosted = (s: unknown) => { const v = String(s ?? '').toUpperCase(); return v === 'P' || v === 'POSTED'; };
// RR_POST_JOURNAL marks the BATCH posted (STATUS 'P', STATUS_MEANING 'Posted'); headers may keep their create-time status
const journalPosted = (j: { header: Row | null; batch: Row | null }) =>
  [j.batch?.STATUS, j.batch?.STATUS_MEANING, j.header?.STATUS, j.header?.POSTING_STATUS].some(isPosted);
const journalStatus = (j: { header: Row | null; batch: Row | null }) =>
  pick(j.batch, ['STATUS_MEANING', 'STATUS']) ?? pick(j.header, ['POSTING_STATUS', 'STATUS']);
const normAcct = (s: unknown) => String(s ?? '').trim().toUpperCase();
const amt = (v: unknown) => (v === null || v === undefined || v === '' ? null : n(v));
const TOL = 0.015;

interface Journal { headerId: number; header: Row | null; batch: Row | null; lines: Row[] }
type CheckState = 'POSTED' | 'ACCOUNT_DIFFERS' | 'MISSING';
interface CheckRow { key: string; exp: ExpectedLine | null; gl: Row | null; journal: Journal | null; state: CheckState | 'EXTRA' }

/** Pairs each expected line with a GL line: same account and side first, then same side and amount. */
function reconcile(expected: ExpectedLine[], journals: Journal[]): CheckRow[] {
  const pool = journals.flatMap(j => j.lines.map(l => ({ l, j, used: false })));
  const side = (dr: number) => (dr > 0 ? 'DR' : 'CR');
  const glSide = (l: Row) => (n(pick(l, ['ACCOUNTED_DR'])) > 0 ? 'DR' : 'CR');
  const glAmt = (l: Row) => n(pick(l, ['ACCOUNTED_DR'])) || n(pick(l, ['ACCOUNTED_CR']));
  const rows: CheckRow[] = expected.map((e, i) => ({ key: `e${i}`, exp: e, gl: null, journal: null, state: 'MISSING' as CheckState }));
  for (const pass of [0, 1] as const) {
    rows.forEach(r => {
      if (r.gl || !r.exp) return;
      const a = r.exp.dr || r.exp.cr;
      const hit = pool.find(p => !p.used && glSide(p.l) === side(r.exp!.dr) && Math.abs(glAmt(p.l) - a) <= TOL
        && (pass === 1 || normAcct(p.l.ACCOUNT_COMBINATION) === normAcct(r.exp!.combo)));
      if (hit) { hit.used = true; r.gl = hit.l; r.journal = hit.j; r.state = pass === 0 ? 'POSTED' : 'ACCOUNT_DIFFERS'; }
    });
  }
  pool.filter(p => !p.used).forEach((p, i) => rows.push({ key: `x${i}`, exp: null, gl: p.l, journal: p.j, state: 'EXTRA' }));
  return rows;
}

const SourceJournalsModal: React.FC<{
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  reference2: string | number;
  /** accepted REFERENCE5 values (case-insensitive) … */
  reference5?: string[];
  /** … or lines whose REFERENCE1 starts with this */
  reference1Prefix?: string;
  /** the source document's own lines, to check the posting against */
  loadExpected?: () => Promise<ExpectedLine[]>;
  sourceLabel?: string;
  /** offered when source lines are missing from the GL: posts them, resolves to a summary */
  repairMissing?: () => Promise<string>;
}> = ({ open, onClose, title, reference2, reference5, reference1Prefix, loadExpected, sourceLabel = 'source', repairMissing }) => {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [journals, setJournals] = useState<Journal[]>([]);
  const [expected, setExpected] = useState<ExpectedLine[] | null>(null);
  const [expErr, setExpErr] = useState('');
  const [sqls, setSqls] = useState<string[]>([]);
  const [showSql, setShowSql] = useState(false);
  const [view, setView] = useState<'J' | 'C'>('J');
  const [full, setFull] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const [repairing, setRepairing] = useState(false);

  const where = useMemo(() => {
    const alt: string[] = [];
    if (reference5?.length) alt.push(`UPPER(l.reference5) IN (${reference5.map(s => lit(s.toUpperCase())).join(', ')})`);
    if (reference1Prefix) alt.push(`l.reference1 LIKE ${lit(reference1Prefix + '%')}`);
    return `l.reference2 = ${lit(String(reference2))}${alt.length ? ` AND (${alt.join(' OR ')})` : ''}`;
  }, [reference2, reference5, reference1Prefix]);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setLoading(true); setErr(''); setJournals([]); setExpected(null); setExpErr(''); setView('J');
    (async () => {
      const used: string[] = [];
      const q = async (sql: string) => { used.push(sql); return poQuery(sql, 2000, 'GL_SOURCE_JOURNALS'); };
      const expP = loadExpected ? loadExpected().catch(e => { if (live) setExpErr(e?.message || String(e)); return null; }) : Promise.resolve(null);
      try {
        const lines = await q(`SELECT l.* FROM rr_gl_je_lines_all l WHERE ${where} ORDER BY l.je_header_id`);
        const hids = [...new Set(lines.map(l => n(l.JE_HEADER_ID)).filter(Boolean))];
        let headers: Row[] = [];
        let batches: Row[] = [];
        if (hids.length) {
          headers = await q(`SELECT * FROM rr_gl_je_headers WHERE je_header_id IN (${hids.map(nlit).join(', ')})`);
          const bids = [...new Set(headers.map(h => n(pick(h, ['BATCH_ID', 'JE_BATCH_ID']))).filter(Boolean))];
          if (bids.length) {
            try { batches = await q(`SELECT * FROM rr_gl_journal_batches WHERE je_batch_id IN (${bids.map(nlit).join(', ')})`); }
            catch { /* batch name is a nicety */ }
          }
        }
        const lineNo = (l: Row) => n(pick(l, ['JE_LINE_NUMBER', 'LINE_NUM', 'LINE_ID']));
        const js: Journal[] = hids.map(id => {
          const header = headers.find(h => n(h.JE_HEADER_ID) === id) || null;
          const bid = n(pick(header, ['BATCH_ID', 'JE_BATCH_ID']));
          return {
            headerId: id, header,
            batch: batches.find(b => n(pick(b, ['JE_BATCH_ID', 'BATCH_ID'])) === bid) || null,
            lines: lines.filter(l => n(l.JE_HEADER_ID) === id).sort((a, b) => lineNo(a) - lineNo(b)),
          };
        });
        const exp = await expP;
        if (!live) return;
        setJournals(js); setExpected(exp); setSqls(used);
      } catch (e: any) {
        if (live) { setErr(e?.message || String(e)); setSqls(used); }
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => { live = false; };
  }, [open, where, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const allLines = useMemo(() => journals.flatMap(j => j.lines), [journals]);
  const acctDescs = useAccountDescriptions(useMemo(() => allLines.map(l => l.ACCOUNT_COMBINATION), [allLines]));
  const check = useMemo(() => (expected ? reconcile(expected, journals) : null), [expected, journals]);
  const missing = check?.filter(r => r.state === 'MISSING') ?? [];
  const differs = check?.filter(r => r.state === 'ACCOUNT_DIFFERS') ?? [];
  const extra = check?.filter(r => r.state === 'EXTRA') ?? [];
  const totDr = allLines.reduce((s, l) => s + n(l.ACCOUNTED_DR), 0);
  const totCr = allLines.reduce((s, l) => s + n(l.ACCOUNTED_CR), 0);
  const unposted = journals.filter(j => !journalPosted(j));
  const ccys = [...new Set(journals.map(j => pick(j.header, ['CURRENCY_CODE'])).filter(Boolean))];
  const missDr = missing.reduce((s, r) => s + r.exp!.dr, 0);
  const missCr = missing.reduce((s, r) => s + r.exp!.cr, 0);

  const Stat: React.FC<{ label: string; children: React.ReactNode; color?: string }> = ({ label, children, color }) => (
    <div style={{ padding: '8px 14px', borderRight: `1px solid ${C.line}`, minWidth: 0 }}>
      <div style={{ fontSize: 11, color: C.muted, whiteSpace: 'nowrap' }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 600, color, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{children}</div>
    </div>
  );

  const Fact: React.FC<{ k: string; v: React.ReactNode }> = ({ k, v }) => (
    <div style={{ display: 'flex', gap: 8, fontSize: 12, lineHeight: '20px', minWidth: 0 }}>
      <span style={{ color: C.muted, width: 120, flexShrink: 0 }}>{k}</span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v ?? '—'}</span>
    </div>
  );

  const amtCell = (v: unknown, color?: string) => {
    const a = amt(v);
    if (a === null) return null;
    return <span style={{ color: a === 0 ? C.muted : color, fontWeight: a === 0 ? 400 : 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{money(a)}</span>;
  };

  const JournalCard: React.FC<{ j: Journal }> = ({ j }) => {
    const h = j.header;
    const ccy = pick(h, ['CURRENCY_CODE']) || pick(j.lines[0], ['CURRENCY_CODE']) || '';
    const rate = amt(pick(h, ['CURRENCY_CONVERSION_RATE'])) ?? amt(pick(j.lines[0], ['CURRENCY_CONVERSION_RATE']));
    const inv = amt(pick(h, ['INV_CURRENCY_CONVERSION_RATE'])) ?? (rate ? 1 / rate : null);
    const status = journalStatus(j);
    const posted = journalPosted(j);
    const dr = j.lines.reduce((s, l) => s + n(l.ACCOUNTED_DR), 0);
    const cr = j.lines.reduce((s, l) => s + n(l.ACCOUNTED_CR), 0);
    const eDr = j.lines.reduce((s, l) => s + n(l.ENTERED_DR), 0);
    const eCr = j.lines.reduce((s, l) => s + n(l.ENTERED_CR), 0);
    const diff = Math.round((dr - cr) * 100) / 100;
    return (
      <div style={{ border: `1px solid #e5e5e5`, borderRadius: 8, marginBottom: 14, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: '#fafafa', borderBottom: `1px solid ${C.line}`, flexWrap: 'wrap' }}>
          <Text strong style={{ fontSize: 13 }}>{pick(h, ['JOURNAL_NAME', 'NAME']) || `Journal ${j.headerId}`}</Text>
          {ccy && <Tag color="blue" style={{ marginInlineEnd: 0 }}>{ccy}</Tag>}
          <Tag color={posted ? 'success' : 'warning'} style={{ marginInlineEnd: 0 }}>{posted ? 'Posted' : status ? `Unposted (${status})` : 'Unposted'}</Tag>
          <span style={{ flex: 1 }} />
          <Tooltip title="Open the whole batch as in Manage Journals">
            <Button size="small" icon={<ExpandOutlined />} onClick={() => setFull(j.headerId)}>Full journal</Button>
          </Tooltip>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', columnGap: 24, padding: '8px 12px' }}>
          <div>
            <Fact k="Batch" v={<Text copyable={!!pick(j.batch, ['NAME', 'BATCH_NAME'])} style={{ fontFamily: 'monospace', fontSize: 11 }}>{pick(j.batch, ['NAME', 'BATCH_NAME']) || `#${pick(h, ['BATCH_ID', 'JE_BATCH_ID']) ?? '—'}`}</Text>} />
            <Fact k="Description" v={pick(h, ['JOURNAL_DESCRIPTION', 'DESCRIPTION'])} />
            <Fact k="Category · Source" v={[pick(h, ['USER_JE_CATEGORY_NAME', 'JE_CATEGORY']), pick(h, ['USER_JE_SOURCE_NAME', 'JE_SOURCE'])].filter(Boolean).join(' · ') || null} />
            <Fact k="Period · Date" v={[pick(h, ['PERIOD_NAME']), day(pick(h, ['DEFAULT_EFFECTIVE_DATE', 'ACCOUNTING_DATE']))].filter(Boolean).join(' · ') || null} />
          </div>
          <div>
            <Fact k="Currency" v={ccy || null} />
            <Fact k="Conversion type" v={pick(h, ['USER_CURRENCY_CONVERSION_TYPE', 'CURRENCY_CONVERSION_TYPE'])} />
            <Fact k="Conversion rate" v={rate != null ? <span style={{ fontVariantNumeric: 'tabular-nums' }}>{rate.toFixed(10).replace(/0+$/, '').replace(/\.$/, '')}</span> : null} />
            <Fact k="Inverse rate" v={inv != null && Number.isFinite(inv) ? <span style={{ fontVariantNumeric: 'tabular-nums' }}>{inv.toFixed(6)}</span> : null} />
          </div>
        </div>
        <Table<Row>
          size="small" pagination={false} rowKey={l => String(pick(l, ['LINE_ID', 'JE_LINE_NUMBER']))} dataSource={j.lines} scroll={{ x: 1050 }}
          columns={[
            { title: 'Line', width: 50, align: 'center', render: (_, l) => <Text type="secondary">{pick(l, ['JE_LINE_NUMBER', 'LINE_NUM'])}</Text> },
            { title: 'Account', width: 290, render: (_, l) => (
              <div style={{ minWidth: 0 }}>
                <Text style={{ fontFamily: 'monospace', fontSize: 11, whiteSpace: 'nowrap' }}>{l.ACCOUNT_COMBINATION}</Text>
                {(acctDescs[l.ACCOUNT_COMBINATION] || l.DESCRIPTION) && <div style={{ fontSize: 11, color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {acctDescs[l.ACCOUNT_COMBINATION] || l.DESCRIPTION}</div>}
              </div>
            ) },
            { title: `Entered Dr${ccy ? ` (${ccy})` : ''}`, width: 110, align: 'right', render: (_, l) => amtCell(l.ENTERED_DR) },
            { title: `Entered Cr${ccy ? ` (${ccy})` : ''}`, width: 110, align: 'right', render: (_, l) => amtCell(l.ENTERED_CR) },
            { title: 'Accounted Dr', width: 120, align: 'right', render: (_, l) => amtCell(l.ACCOUNTED_DR, C.success) },
            { title: 'Accounted Cr', width: 120, align: 'right', render: (_, l) => amtCell(l.ACCOUNTED_CR, C.primary) },
            { title: 'Ref 1', width: 140, render: (_, l) => <Text style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{l.REFERENCE1}</Text> },
            { title: 'Ref 2', width: 70, render: (_, l) => <Text style={{ fontSize: 11 }}>{l.REFERENCE2}</Text> },
            { title: 'Ref 5', width: 130, render: (_, l) => <Text style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{l.REFERENCE5}</Text> },
          ]}
          summary={() => (
            <Table.Summary fixed>
              <Table.Summary.Row style={{ background: '#fafafa' }}>
                <Table.Summary.Cell index={0} colSpan={2}><Text strong style={{ whiteSpace: 'nowrap' }}>Total</Text></Table.Summary.Cell>
                <Table.Summary.Cell index={2} align="right">{amtCell(eDr)}</Table.Summary.Cell>
                <Table.Summary.Cell index={3} align="right">{amtCell(eCr)}</Table.Summary.Cell>
                <Table.Summary.Cell index={4} align="right">{amtCell(dr, C.success)}</Table.Summary.Cell>
                <Table.Summary.Cell index={5} align="right">{amtCell(cr, C.primary)}</Table.Summary.Cell>
                <Table.Summary.Cell index={6} colSpan={3}>
                  {diff === 0
                    ? <Text style={{ color: C.success, fontSize: 12, whiteSpace: 'nowrap' }}><CheckCircleFilled /> Balanced</Text>
                    : <Text style={{ color: C.primary, fontSize: 12, whiteSpace: 'nowrap' }}><WarningFilled /> Out of balance by {money(Math.abs(diff))}</Text>}
                </Table.Summary.Cell>
              </Table.Summary.Row>
            </Table.Summary>
          )}
        />
      </div>
    );
  };

  const stateTag = (s: CheckRow['state']) => ({
    POSTED: <Tag icon={<CheckCircleFilled />} color="success" style={{ marginInlineEnd: 0 }}>In GL</Tag>,
    ACCOUNT_DIFFERS: <Tooltip title="Same amount and side, posted to a different account"><Tag icon={<ExclamationCircleFilled />} color="warning" style={{ marginInlineEnd: 0 }}>Other account</Tag></Tooltip>,
    MISSING: <Tag icon={<CloseCircleFilled />} color="error" style={{ marginInlineEnd: 0 }}>Not in GL</Tag>,
    EXTRA: <Tooltip title={`In the GL, but not a line of this ${sourceLabel}`}><Tag color="purple" style={{ marginInlineEnd: 0 }}>GL only</Tag></Tooltip>,
  }[s]);

  const checkOk = check && !missing.length && !differs.length && !extra.length;

  return (
    <>
      <Modal open={open} onCancel={onClose} width={1240} style={{ top: 24 }} destroyOnHidden
        title={<Space wrap><AccountBookOutlined style={{ color: C.info }} /><span>Posted Journals</span><span style={{ color: C.muted, fontWeight: 400 }}>{title}</span>
          <Tag style={{ fontFamily: 'monospace', fontWeight: 400 }}>reference2 = {String(reference2)}</Tag></Space>}
        footer={[
          <Button key="sql" icon={<CodeOutlined />} type="text" onClick={() => setShowSql(s => !s)}>{showSql ? 'Hide SQL' : 'SQL'}</Button>,
          <Button key="r" icon={<ReloadOutlined />} onClick={() => setTick(t => t + 1)} loading={loading}>Refresh</Button>,
          <Button key="c" type="primary" onClick={onClose}>Close</Button>,
        ]}>
        <Spin spinning={loading}>
          {err && <Alert type="error" showIcon style={{ marginBottom: 12 }} message="Could not read the GL journals" description={err} />}

          {!loading && !err && journals.length === 0 && (
            <Empty style={{ padding: '24px 0' }} description={<>
              <div>No GL journal found for this {sourceLabel}.</div>
              <Text type="secondary" style={{ fontSize: 12 }}>Looked for GL lines with reference2 = {String(reference2)}
                {reference5?.length ? <> and reference5 {reference5.join(' / ')}</> : null}.</Text>
            </>} />
          )}

          {journals.length > 0 && (
            <>
              <div style={{ display: 'flex', flexWrap: 'wrap', border: `1px solid #e5e5e5`, borderRadius: 8, marginBottom: 12, background: '#fff' }}>
                <Stat label="Journals">{journals.length}{ccys.length > 0 && <span style={{ fontSize: 12, fontWeight: 400, color: C.muted }}> · {ccys.join(', ')}</span>}</Stat>
                <Stat label="Lines">{allLines.length}</Stat>
                <Stat label="Accounted Dr" color={C.success}>{money(totDr)}</Stat>
                <Stat label="Accounted Cr" color={C.primary}>{money(totCr)}</Stat>
                <Stat label="Posting" color={unposted.length ? C.warning : C.success}>
                  {unposted.length ? `${unposted.length} unposted` : <><CheckCircleFilled /> All posted</>}
                </Stat>
                {loadExpected && (
                  <Stat label={`Check against the ${sourceLabel}`} color={!check ? C.muted : checkOk ? C.success : C.primary}>
                    {!check ? (expErr ? 'Unavailable' : '—')
                      : checkOk ? <><CheckCircleFilled /> All {expected!.length} lines in GL</>
                        : <><WarningFilled /> {missing.length ? `${missing.length} of ${expected!.length} lines not in GL` : `${differs.length + extra.length} to review`}</>}
                  </Stat>
                )}
              </div>

              {check && !checkOk && missing.length > 0 && (
                <Alert type="error" showIcon style={{ marginBottom: 12 }}
                  message={`${missing.length} ${sourceLabel} line${missing.length === 1 ? ' was' : 's were'} never posted to the GL (${money(missDr)} Dr / ${money(missCr)} Cr)`}
                  description={<>The {sourceLabel} has {expected!.length} lines; the GL has {allLines.length}.{' '}
                    <a onClick={() => setView('C')}>See which lines</a>.</>}
                  action={repairMissing && !differs.length && !extra.length ? (
                    <Button danger loading={repairing} onClick={() => Modal.confirm({
                      title: `Post the ${missing.length} missing line${missing.length === 1 ? '' : 's'} to the GL?`,
                      content: `Creates and posts a journal per currency with only the lines the GL does not have yet (${money(missDr)} Dr / ${money(missCr)} Cr). Lines already in the GL are not touched.`,
                      okText: 'Post missing lines',
                      onOk: async () => {
                        setRepairing(true);
                        try { message.success(await repairMissing(), 6); setTick(t => t + 1); }
                        catch (e: any) { Modal.error({ title: 'Could not post the missing lines', content: e?.message || String(e) }); }
                        finally { setRepairing(false); }
                      },
                    })}>Post missing lines</Button>
                  ) : undefined} />
              )}

              {loadExpected && (
                <Segmented value={view} onChange={v => setView(v as 'J' | 'C')} style={{ marginBottom: 12 }}
                  options={[
                    { value: 'J', label: `Journals (${journals.length})` },
                    { value: 'C', label: <span>Check against the {sourceLabel}{check && !checkOk ? <Tag color="error" style={{ marginLeft: 6, marginInlineEnd: 0 }}>{missing.length + differs.length + extra.length}</Tag> : null}</span> },
                  ]} />
              )}

              {view === 'J' && journals.map(j => <JournalCard key={j.headerId} j={j} />)}

              {view === 'C' && (
                expErr ? <Alert type="warning" showIcon message={`Could not load the ${sourceLabel} lines`} description={expErr} />
                  : check && (
                    <Table<CheckRow>
                      size="small" pagination={false} rowKey="key" dataSource={check} scroll={{ x: 1000 }}
                      rowClassName={r => (r.state === 'MISSING' ? 'rr-sj-missing' : '')}
                      columns={[
                        { title: '#', width: 46, align: 'center', render: (_, r) => <Text type="secondary">{r.exp?.lineNum ?? ''}</Text> },
                        { title: 'Status', width: 120, render: (_, r) => stateTag(r.state) },
                        { title: `${sourceLabel[0].toUpperCase()}${sourceLabel.slice(1)} account`, width: 280, render: (_, r) => r.exp ? (
                          <div><Text style={{ fontFamily: 'monospace', fontSize: 11 }}>{r.exp.combo}</Text>
                            {r.exp.description && <div style={{ fontSize: 11, color: C.muted }}>{r.exp.description}</div>}</div>) : <Text type="secondary">—</Text> },
                        { title: 'Dr', width: 110, align: 'right', render: (_, r) => (r.exp ? amtCell(r.exp.dr || null, C.success) : null) },
                        { title: 'Cr', width: 110, align: 'right', render: (_, r) => (r.exp ? amtCell(r.exp.cr || null, C.primary) : null) },
                        { title: 'GL line', render: (_, r) => r.gl ? (
                          <div style={{ fontSize: 11 }}>
                            <Text style={{ fontFamily: 'monospace', fontSize: 11, color: r.state === 'ACCOUNT_DIFFERS' ? C.warning : undefined }}>{r.gl.ACCOUNT_COMBINATION}</Text>
                            <div style={{ color: C.muted }}>
                              {pick(r.journal?.header, ['JOURNAL_NAME', 'NAME']) || `Journal ${r.journal?.headerId}`} · line {pick(r.gl, ['JE_LINE_NUMBER', 'LINE_NUM'])}
                              {r.state === 'EXTRA' && <> · {money(n(r.gl.ACCOUNTED_DR) || n(r.gl.ACCOUNTED_CR))} {n(r.gl.ACCOUNTED_DR) ? 'Dr' : 'Cr'}</>}
                            </div>
                          </div>) : <Text type="secondary" style={{ fontSize: 12 }}>No matching GL line</Text> },
                      ]}
                    />
                  )
              )}
            </>
          )}

          {showSql && sqls.length > 0 && (
            <pre style={{ marginTop: 12, background: '#1f1f1f', color: '#d4d4d4', padding: 10, borderRadius: 6, fontSize: 11, whiteSpace: 'pre-wrap' }}>
              {sqls.join(';\n\n')}
            </pre>
          )}
        </Spin>
        <style>{`.rr-sj-missing > td { background: #fff1f0 !important; }`}</style>
      </Modal>
      <JournalFullPreview open={full != null} jeHeaderId={full} onClose={() => setFull(null)} />
    </>
  );
};

export default SourceJournalsModal;
