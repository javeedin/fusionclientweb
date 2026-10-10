// Purchasing-RR — terms and conditions on screen: the document view (as printed), the clause
// manager of a purchase order (Terms & Conditions tab) and the toolbar icon + reader drawer.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Badge, Button, Checkbox, Drawer, Empty, Input, Modal, Popconfirm, Space, Spin, Tag, Tooltip, Typography, message,
} from 'antd';
import {
  ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, EditOutlined, FileProtectOutlined, HolderOutlined, LockOutlined,
  PlusOutlined, ReloadOutlined, SaveOutlined, SearchOutlined, SyncOutlined, UndoOutlined, CheckOutlined, EyeOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import {
  LibraryTerm, PoClause, PoTerms, MergeContext, categoryInfo, clauseKey, clauseProblems, defaultClauses, fromLibrary,
  libraryChanged, loadPoTerms, loadTermLibrary, mergeParts, missingMandatory, savePoTerms, termsNotInstalled, appliesToBu,
  withMandatory, byteLength, MAX_CLAUSE_BYTES, MERGE_FIELDS,
} from './poTerms';
import { PO_RED } from './poShared';

const { Text } = Typography;

// ── text with merge fields highlighted ─────────────────────────────────────────
export const ClauseText: React.FC<{ text: string; ctx: MergeContext; style?: React.CSSProperties }> = ({ text, ctx, style }) => (
  <span style={{ whiteSpace: 'pre-wrap', ...style }}>
    {mergeParts(text, ctx).map((p, i) => !p.field ? <React.Fragment key={i}>{p.text}</React.Fragment> : (
      <Tooltip key={i} title={p.known ? `{${p.field}}${p.filled ? '' : ' — no value on this order yet'}` : `{${p.field}} is not a known merge field`}>
        <span style={p.filled
          ? { borderBottom: `1px dotted ${PO_RED}`, background: `${PO_RED}0d` }
          : { color: p.known ? '#d46b08' : '#cf1322', background: p.known ? '#fff7e6' : '#fff1f0', borderRadius: 3, padding: '0 2px', fontFamily: 'monospace', fontSize: '0.92em' }}>
          {p.text}
        </span>
      </Tooltip>
    ))}
  </span>
);

// ── the terms as they print: heading + numbered clauses ─────────────────────────
export const TermsDocument: React.FC<{ clauses: PoClause[]; ctx: MergeContext; compact?: boolean; emptyText?: React.ReactNode }> =
  ({ clauses, ctx, compact, emptyText }) => {
    if (!clauses.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText ?? 'No terms and conditions'} />;
    return (
      <div style={{ background: '#fff', border: '1px solid #eef0f3', borderRadius: 8, padding: compact ? '12px 14px' : '18px 22px',
        fontFamily: 'Georgia, "Times New Roman", serif', fontSize: compact ? 12.5 : 13.5, lineHeight: 1.6, color: '#262626' }}>
        <div style={{ color: PO_RED, fontWeight: 700, letterSpacing: 0.6, fontSize: compact ? 12 : 13, borderBottom: `2px solid ${PO_RED}`,
          paddingBottom: 4, marginBottom: 10, fontFamily: 'inherit' }}>TERMS AND CONDITIONS</div>
        {clauses.map((c, i) => (
          <div key={c.key} style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
            <div style={{ fontWeight: 700, minWidth: 22, textAlign: 'right' }}>{i + 1}.</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              {c.title && <div style={{ fontWeight: 700 }}><ClauseText text={c.title} ctx={ctx} /></div>}
              <ClauseText text={c.text} ctx={ctx} />
            </div>
          </div>
        ))}
      </div>
    );
  };

// ── load the order's clauses + the library once; shared by the tab and the drawer ──
export function usePoTerms(poId: number | null, bu: number | null) {
  const [data, setData] = useState<PoTerms | null>(null);
  const [library, setLibrary] = useState<LibraryTerm[]>([]);
  const [installed, setInstalled] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [lib, terms] = await Promise.all([
        loadTermLibrary().catch(e => { if (termsNotInstalled(e)) return null; throw e; }),
        loadPoTerms(poId, bu),
      ]);
      setInstalled(lib !== null && terms.installed);
      setLibrary(lib || []);
      setData(terms);
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }, [poId, bu]);
  useEffect(() => { reload(); }, [reload]);
  /** what the order shows: its own clauses, or for a new order the defaults it will get */
  const shown = useMemo(() => (poId ? (data?.clauses || []) : defaultClauses(library, bu)), [poId, data, library, bu]);
  return { data, library, installed, loading, error, reload, shown };
}
export type PoTermsState = ReturnType<typeof usePoTerms>;

const NotInstalled: React.FC = () => (
  <Alert type="warning" showIcon style={{ marginBottom: 10 }}
    message="Terms & Conditions library is not installed"
    description={<span>Run <code>database/po/306_po_terms.sql</code>. Until then purchase orders print the single terms text of
      Purchasing Options, shown below.</span>} />
);

// ── toolbar icon + reader drawer ────────────────────────────────────────────────
export const PoTermsButton: React.FC<{
  state: PoTermsState; ctx: MergeContext; poNumber?: string | null; dirty?: boolean;
  /** open the Terms & Conditions tab (shown when the order can be edited) */
  onManage?: () => void;
}> = ({ state, ctx, poNumber, dirty, onManage }) => {
  const [open, setOpen] = useState(false);
  const count = state.shown.length;
  return (
    <>
      <Tooltip title={`Terms & Conditions${count ? ` (${count} clause${count > 1 ? 's' : ''})` : ''}`}>
        <Badge count={count} size="small" color={PO_RED} offset={[-4, 4]}>
          <Button icon={<FileProtectOutlined />} onClick={() => setOpen(true)} aria-label="Terms and conditions" />
        </Badge>
      </Tooltip>
      <Drawer open={open} onClose={() => setOpen(false)} width={640} destroyOnHidden
        title={<Space><FileProtectOutlined style={{ color: PO_RED }} />Terms & Conditions{poNumber ? <Text type="secondary">· {poNumber}</Text> : null}</Space>}
        extra={onManage && <Button type="primary" icon={<EditOutlined />} onClick={() => { setOpen(false); onManage(); }}>Edit terms</Button>}>
        {state.loading ? <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div> : <>
          {!state.installed && <NotInstalled />}
          {state.error && <Alert type="error" showIcon style={{ marginBottom: 10 }} message={state.error} />}
          {dirty && <Alert type="warning" showIcon style={{ marginBottom: 10 }} message="The terms have unsaved changes on the Terms & Conditions tab — this shows the saved version." />}
          {!poNumber && count > 0 && <Alert type="info" showIcon style={{ marginBottom: 10 }}
            message="These default clauses are added to the order when you save it." />}
          <TermsDocument clauses={state.shown} ctx={ctx}
            emptyText={<span>No terms on this order.{onManage ? ' Use Edit terms to add clauses.' : ''}</span>} />
          <div style={{ marginTop: 10, fontSize: 12 }}>
            <Text type="secondary">Highlighted text is filled in from the order. The same terms print on the PO PDF.</Text>
          </div>
        </>}
      </Drawer>
    </>
  );
};

// ── pick clauses from the library ────────────────────────────────────────────────
const LibraryPicker: React.FC<{
  open: boolean; onClose: () => void; library: LibraryTerm[]; bu: number | null; onPick: (t: LibraryTerm[]) => void;
  onOrder: Set<number>; ctx: MergeContext;
}> = ({ open, onClose, library, bu, onPick, onOrder, ctx }) => {
  const [sel, setSel] = useState<number[]>([]);
  const [q, setQ] = useState('');
  useEffect(() => { if (open) { setSel([]); setQ(''); } }, [open]);
  const avail = library.filter(t => t.STATUS === 'ACTIVE' && appliesToBu(t, bu));
  const s = q.trim().toLowerCase();
  const shown = s ? avail.filter(t => `${t.TERM_CODE} ${t.TITLE} ${t.TERM_TEXT} ${t.TERM_CATEGORY}`.toLowerCase().includes(s)) : avail;
  const groups = Array.from(new Set(shown.map(t => t.TERM_CATEGORY))).map(c => ({ c, items: shown.filter(t => t.TERM_CATEGORY === c) }));
  return (
    <Modal open={open} onCancel={onClose} width={760} title="Add clauses from the library" okText={`Add ${sel.length || ''} clause${sel.length === 1 ? '' : 's'}`}
      okButtonProps={{ disabled: !sel.length }} onOk={() => { onPick(avail.filter(t => sel.includes(t.TERM_ID))); onClose(); }} destroyOnHidden>
      <Input allowClear prefix={<SearchOutlined />} placeholder="Search clauses" value={q} onChange={e => setQ(e.target.value)} style={{ marginBottom: 10 }} />
      {!avail.length && <Empty description={<span>No active clauses for this business unit. <Link to="/po/terms">Open the Terms & Conditions library</Link></span>} />}
      <div style={{ maxHeight: 460, overflow: 'auto' }}>
        {groups.map(g => (
          <div key={g.c} style={{ marginBottom: 10 }}>
            <Tag color={categoryInfo(g.c).color} style={{ marginBottom: 6 }}>{categoryInfo(g.c).label}</Tag>
            {g.items.map(t => {
              const already = onOrder.has(t.TERM_ID);
              const checked = sel.includes(t.TERM_ID);
              return (
                <div key={t.TERM_ID} onClick={() => !already && setSel(x => checked ? x.filter(i => i !== t.TERM_ID) : [...x, t.TERM_ID])}
                  style={{ display: 'flex', gap: 10, padding: '8px 10px', borderRadius: 8, marginBottom: 4, cursor: already ? 'default' : 'pointer',
                    border: `1px solid ${checked ? PO_RED : '#f0f0f0'}`, background: already ? '#fafafa' : checked ? `${PO_RED}08` : '#fff', opacity: already ? 0.6 : 1 }}>
                  <Checkbox checked={checked || already} disabled={already} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Space size={6} wrap>
                      <Text strong>{t.TITLE}</Text><Text type="secondary" style={{ fontSize: 12 }}>{t.TERM_CODE}</Text>
                      {t.MANDATORY_FLAG === 'Y' && <Tag color="red" style={{ fontSize: 11 }}>Mandatory</Tag>}
                      {already && <Tag style={{ fontSize: 11 }}>On this order</Tag>}
                    </Space>
                    <div style={{ fontSize: 12, color: '#595959', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      <ClauseText text={t.TERM_TEXT} ctx={ctx} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </Modal>
  );
};

// ── the order's clauses: view, or manage while the order is editable ─────────────────
export const PoTermsPanel: React.FC<{
  state: PoTermsState; poId: number | null; bu: number | null; editable: boolean; user: string; ctx: MergeContext;
  onDirtyChange?: (dirty: boolean) => void;
}> = ({ state, poId, bu, editable, user, ctx, onDirtyChange }) => {
  const [draft, setDraft] = useState<PoClause[] | null>(null);   // null = no unsaved edits
  const [editing, setEditing] = useState<string | null>(null);
  const [pickOpen, setPickOpen] = useState(false);
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const dragFrom = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  const saved = state.data?.clauses || [];
  const canEdit = editable && !!poId && state.installed;
  // mandatory clauses missing on a draft order are added automatically (the save would refuse without them)
  const autoAdded = useMemo(() => (canEdit ? missingMandatory(saved, state.library, bu) : []), [canEdit, saved, state.library, bu]);
  const base = useMemo(() => (autoAdded.length ? withMandatory(saved, state.library, bu) : saved), [autoAdded, saved, state.library, bu]);
  const list = draft ?? base;
  const dirty = draft !== null || autoAdded.length > 0;
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { setDraft(null); setEditing(null); }, [state.data]);

  const change = (next: PoClause[]) => setDraft(next);
  const update = (key: string, p: Partial<PoClause>) => change(list.map(c => (c.key === key ? { ...c, ...p } : c)));
  const move = (from: number, to: number) => {
    if (to < 0 || to >= list.length || from === to) return;
    const next = [...list]; const [x] = next.splice(from, 1); next.splice(to, 0, x); change(next);
  };
  const problems = list.map(c => clauseProblems(c));
  const invalid = problems.some(p => p.length);

  const save = async () => {
    if (!poId) return;
    if (invalid) { message.warning('Fix the highlighted clauses first'); return; }
    setSaving(true);
    try {
      const r = await savePoTerms(poId, list, user);
      message.success(r.message || 'Terms saved');
      await state.reload();
    } catch (e: any) { message.error(e.message, 8); } finally { setSaving(false); }
  };
  const resetToDefaults = () => change(defaultClauses(state.library, bu));
  const refreshAll = () => change(list.map(c => (libraryChanged(c) ? { ...c, title: c.libraryTitle || c.title, text: c.libraryText || c.text } : c)));
  const changedCount = list.filter(libraryChanged).length;
  const onOrder = useMemo(() => new Set(list.filter(c => c.termId !== null).map(c => c.termId as number)), [list]);

  if (state.loading && !state.data) return <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>;

  // read-only (approved / pending / new order / library not installed)
  if (!canEdit) {
    return (
      <div style={{ maxWidth: 900 }}>
        {!state.installed && <NotInstalled />}
        {state.error && <Alert type="error" showIcon style={{ marginBottom: 10 }} message={state.error} />}
        {!poId && <Alert type="info" showIcon style={{ marginBottom: 10 }}
          message={state.shown.length ? 'These default clauses are added when you save the order. Save it to change them.' : 'Save the order to add terms and conditions.'}
          description={!state.shown.length && state.installed ? <span>Default clauses come from the <Link to="/po/terms">Terms & Conditions library</Link>.</span> : undefined} />}
        {poId && !editable && state.installed && <Alert type="info" showIcon style={{ marginBottom: 10 }}
          message="The terms are fixed once the order leaves draft. They are part of what was sent to the supplier." />}
        <TermsDocument clauses={state.shown} ctx={ctx} />
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: preview ? 'minmax(0, 1fr) minmax(0, 1fr)' : 'minmax(0, 1fr)', gap: 14, alignItems: 'start' }}>
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
          <Space wrap size={6}>
            <Button icon={<PlusOutlined />} onClick={() => setPickOpen(true)}>From library</Button>
            <Button icon={<EditOutlined />} onClick={() => {
              const c: PoClause = { key: clauseKey(), termId: null, title: '', text: '', mandatory: false };
              change([...list, c]); setEditing(c.key);
            }}>Custom clause</Button>
            <Popconfirm title="Replace the clauses with the business unit's defaults?" onConfirm={resetToDefaults}>
              <Button icon={<UndoOutlined />}>Reset to defaults</Button>
            </Popconfirm>
            {changedCount > 0 && <Tooltip title="Use the current library wording for clauses whose wording differs">
              <Button icon={<SyncOutlined />} onClick={refreshAll}>Latest wording ({changedCount})</Button></Tooltip>}
            <Button icon={<EyeOutlined />} type={preview ? 'primary' : 'default'} ghost={preview} onClick={() => setPreview(p => !p)}>Preview</Button>
          </Space>
          <Space size={6}>
            {dirty && <Button icon={<ReloadOutlined />} disabled={saving} onClick={() => { setDraft(null); setEditing(null); state.reload(); }}>Discard</Button>}
            <Button type="primary" icon={<SaveOutlined />} loading={saving} disabled={!dirty} onClick={save}>Save terms</Button>
          </Space>
        </div>
        {autoAdded.length > 0 && !draft && <Alert type="warning" showIcon style={{ marginBottom: 10 }}
          message={`Mandatory clause${autoAdded.length > 1 ? 's' : ''} added: ${autoAdded.map(t => t.TITLE).join(', ')}`}
          description="They became mandatory after this order was created. Save the terms to keep them." />}
        {!list.length && <Empty description="No clauses on this order" style={{ padding: 24 }} />}
        {list.map((c, i) => {
          const isEditing = editing === c.key;
          const errs = problems[i];
          const cat = c.category ? categoryInfo(c.category) : null;
          return (
            <div key={c.key}
              draggable={!isEditing}
              onDragStart={() => { dragFrom.current = i; }}
              onDragOver={e => { e.preventDefault(); setDragOver(i); }}
              onDragLeave={() => setDragOver(d => (d === i ? null : d))}
              onDrop={e => { e.preventDefault(); if (dragFrom.current !== null) move(dragFrom.current, i); dragFrom.current = null; setDragOver(null); }}
              onDragEnd={() => { dragFrom.current = null; setDragOver(null); }}
              style={{ background: '#fff', border: `1px solid ${errs.length ? '#ffa39e' : dragOver === i ? PO_RED : '#eef0f3'}`, borderRadius: 8,
                padding: '8px 10px', marginBottom: 6, boxShadow: dragOver === i ? `0 0 0 2px ${PO_RED}22` : undefined }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <HolderOutlined style={{ cursor: 'grab', color: '#bfbfbf', marginTop: 4 }} />
                <Text strong style={{ minWidth: 20 }}>{i + 1}.</Text>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {isEditing ? (
                    <div>
                      <Input value={c.title} placeholder="Clause title" maxLength={240} style={{ marginBottom: 6 }}
                        onChange={e => update(c.key, { title: e.target.value })} />
                      <Input.TextArea value={c.text} autoSize={{ minRows: 3, maxRows: 14 }} placeholder="Clause text — merge fields like {SUPPLIER_NAME} are filled in when printed"
                        onChange={e => update(c.key, { text: e.target.value })} />
                      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                        <Space size={4} wrap>
                          {MERGE_FIELDS.map(f => <Tag key={f.key} style={{ cursor: 'pointer', fontSize: 11 }}
                            onClick={() => update(c.key, { text: `${c.text}${c.text && !c.text.endsWith(' ') ? ' ' : ''}{${f.key}}` })}>+ {f.label}</Tag>)}
                        </Space>
                        <Text type={byteLength(c.text) > MAX_CLAUSE_BYTES ? 'danger' : 'secondary'} style={{ fontSize: 11 }}>
                          {byteLength(c.text)} / {MAX_CLAUSE_BYTES}</Text>
                      </div>
                    </div>
                  ) : (
                    <>
                      <Space size={6} wrap>
                        <Text strong>{c.title || <Text type="danger">Untitled clause</Text>}</Text>
                        {c.code && <Text type="secondary" style={{ fontSize: 12 }}>{c.code}</Text>}
                        {cat && <Tag color={cat.color} style={{ fontSize: 11 }}>{cat.label}</Tag>}
                        {c.termId === null && <Tag color="purple" style={{ fontSize: 11 }}>This order only</Tag>}
                        {c.mandatory && <Tooltip title="Mandatory — cannot be removed"><Tag color="red" icon={<LockOutlined />} style={{ fontSize: 11 }}>Mandatory</Tag></Tooltip>}
                        {libraryChanged(c) && <Tooltip title="The wording differs from the library (edited here, or the library changed since)">
                          <Tag color="gold" style={{ fontSize: 11, cursor: 'pointer' }}
                            onClick={() => update(c.key, { title: c.libraryTitle || c.title, text: c.libraryText || c.text })}>
                            <SyncOutlined /> Use library wording</Tag></Tooltip>}
                      </Space>
                      <div style={{ fontSize: 12.5, color: '#434343', marginTop: 2 }}><ClauseText text={c.text} ctx={ctx} /></div>
                    </>
                  )}
                  {errs.length > 0 && <div style={{ marginTop: 4 }}><Text type="danger" style={{ fontSize: 12 }}>{errs.join(' · ')}</Text></div>}
                </div>
                <Space size={0}>
                  <Button size="small" type="text" icon={<ArrowUpOutlined />} disabled={i === 0} onClick={() => move(i, i - 1)} />
                  <Button size="small" type="text" icon={<ArrowDownOutlined />} disabled={i === list.length - 1} onClick={() => move(i, i + 1)} />
                  <Tooltip title={isEditing ? 'Done' : 'Edit the wording for this order'}>
                    <Button size="small" type="text" icon={isEditing ? <CheckOutlined /> : <EditOutlined />} onClick={() => setEditing(isEditing ? null : c.key)} />
                  </Tooltip>
                  <Tooltip title={c.mandatory ? 'Mandatory clause — cannot be removed' : 'Remove from this order'}>
                    <Button size="small" type="text" danger icon={<DeleteOutlined />} disabled={c.mandatory}
                      onClick={() => { change(list.filter(x => x.key !== c.key)); if (isEditing) setEditing(null); }} />
                  </Tooltip>
                </Space>
              </div>
            </div>
          );
        })}
        {list.length > 1 && <Text type="secondary" style={{ fontSize: 12 }}>Drag clauses to change the order they print in.</Text>}
      </div>
      {preview && <div style={{ position: 'sticky', top: 90 }}>
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>As printed on the PO{dirty ? ' (unsaved)' : ''}</Text>
        <TermsDocument clauses={list} ctx={ctx} compact />
      </div>}
      <LibraryPicker open={pickOpen} onClose={() => setPickOpen(false)} library={state.library} bu={bu} ctx={ctx} onOrder={onOrder}
        onPick={ts => change([...list, ...ts.map(fromLibrary)])} />
    </div>
  );
};
