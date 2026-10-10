// Purchasing-RR — Terms & Conditions library: the clauses printed on purchase orders.
// Clauses apply to one business unit or to all. "Default" clauses are put on every new order,
// "mandatory" ones cannot be removed from an order. Orders keep their own copy of the wording.
// Database: database/po/306_po_terms.sql.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Button, Card, Checkbox, Col, Empty, Form, Input, InputNumber, Modal, Popconfirm, Row as AntRow, Segmented, Select, Space,
  Switch, Tag, Tooltip, Typography, message,
} from 'antd';
import {
  CopyOutlined, DeleteOutlined, EditOutlined, FileProtectOutlined, FilePdfOutlined, HolderOutlined, LockOutlined, PlusOutlined,
  ReloadOutlined, ScissorOutlined, SearchOutlined, StopOutlined, CheckCircleOutlined,
} from '@ant-design/icons';
import { poExec, PROC, Row } from '../../services/po.service';
import { PoBar, useBusinessUnits, usePoUser, PO_RED } from './poShared';
import { buildPoPdf } from './poPdf';
import {
  LibraryTerm, MERGE_FIELDS, MAX_CLAUSE_BYTES, TERM_CATEGORIES, appliesToBu, byteLength, categoryInfo, defaultClauses,
  loadTermLibrary, printableClauses, sampleContext, splitProposal, termsNotInstalled, unknownFields,
} from './poTerms';
import { ClauseText, TermsDocument } from './PoTermsUi';

const { Text } = Typography;

interface Draft {
  termId?: number; termCode: string; title: string; termText: string; category: string;
  businessUnitId: number | null; displayOrder: number; defaultFlag: boolean; mandatoryFlag: boolean; active: boolean;
}

const toJson = (d: Draft) => ({
  termId: d.termId ?? null, termCode: d.termCode.trim().toUpperCase(), title: d.title.trim(), termText: d.termText.trim(),
  category: d.category, businessUnitId: d.businessUnitId, displayOrder: d.displayOrder,
  defaultFlag: d.defaultFlag || d.mandatoryFlag ? 'Y' : 'N', mandatoryFlag: d.mandatoryFlag ? 'Y' : 'N', status: d.active ? 'ACTIVE' : 'INACTIVE',
});
const fromTerm = (t: LibraryTerm): Draft => ({
  termId: t.TERM_ID, termCode: t.TERM_CODE, title: t.TITLE, termText: t.TERM_TEXT, category: t.TERM_CATEGORY || 'GENERAL',
  businessUnitId: t.BUSINESS_UNIT_ID, displayOrder: t.DISPLAY_ORDER, defaultFlag: t.DEFAULT_FLAG === 'Y',
  mandatoryFlag: t.MANDATORY_FLAG === 'Y', active: t.STATUS === 'ACTIVE',
});

/** Next free TC-### code. */
const nextCode = (lib: LibraryTerm[], prefix = 'TC') => {
  const max = lib.reduce((m, t) => {
    const x = new RegExp(`^${prefix}-(\\d+)$`).exec(t.TERM_CODE);
    return x ? Math.max(m, Number(x[1])) : m;
  }, 0);
  return `${prefix}-${String(max + 1).padStart(3, '0')}`;
};

// ── clause editor ──────────────────────────────────────────────────────────────
const ClauseEditor: React.FC<{
  open: boolean; initial: Draft | null; onClose: () => void; onSaved: () => void;
  bus: { BUSINESS_UNIT_ID: number; BUSINESS_UNIT_NAME: string }[]; lib: LibraryTerm[]; user: string;
}> = ({ open, initial, onClose, onSaved, bus, lib, user }) => {
  const [d, setD] = useState<Draft | null>(initial);
  const [busy, setBusy] = useState(false);
  const caret = useRef<number | null>(null);
  useEffect(() => { setD(initial); caret.current = null; }, [initial]);
  if (!d) return null;
  const set = (p: Partial<Draft>) => setD(x => (x ? { ...x, ...p } : x));
  const bytes = byteLength(d.termText);
  const unknown = unknownFields(`${d.title} ${d.termText}`);
  const codeTaken = lib.some(t => t.TERM_CODE === d.termCode.trim().toUpperCase() && t.TERM_ID !== d.termId);
  const errors = [
    !d.termCode.trim() && 'Code is required', codeTaken && 'This code is already used',
    !d.title.trim() && 'Title is required', !d.termText.trim() && 'Clause text is required',
    bytes > MAX_CLAUSE_BYTES && `Text is ${bytes} bytes — at most ${MAX_CLAUSE_BYTES}. Split it into two clauses.`,
  ].filter(Boolean) as string[];
  const insert = (key: string) => {
    const at = caret.current ?? d.termText.length;
    const token = `{${key}}`;
    set({ termText: d.termText.slice(0, at) + token + d.termText.slice(at) });
    caret.current = at + token.length;
  };
  const trackCaret = (e: React.SyntheticEvent<HTMLTextAreaElement>) => { caret.current = e.currentTarget.selectionStart; };
  const save = async () => {
    if (errors.length) { message.warning(errors[0]); return; }
    setBusy(true);
    try {
      const r = await poExec(PROC.saveTerm, { p_json: toJson(d) }, user);
      message.success(r.message || 'Saved');
      onSaved(); onClose();
    } catch (e: any) { message.error(e.message, 8); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onCancel={onClose} width={1040} destroyOnHidden okText="Save clause" onOk={save} confirmLoading={busy}
      title={<Space><FileProtectOutlined style={{ color: PO_RED }} />{d.termId ? `Edit clause ${initial?.termCode}` : 'New clause'}</Space>}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.15fr) minmax(0, 1fr)', gap: 18 }}>
        <Form layout="vertical" size="middle">
          <div style={{ display: 'grid', gridTemplateColumns: '150px minmax(0, 1fr)', columnGap: 12 }}>
            <Form.Item label="Code" required validateStatus={codeTaken ? 'error' : undefined} help={codeTaken ? 'Already used' : undefined} style={{ marginBottom: 10 }}>
              <Input value={d.termCode} maxLength={40} onChange={e => set({ termCode: e.target.value.toUpperCase() })} />
            </Form.Item>
            <Form.Item label="Title (printed in bold)" required style={{ marginBottom: 10 }}>
              <Input value={d.title} maxLength={240} placeholder="e.g. Delivery" onChange={e => set({ title: e.target.value })} />
            </Form.Item>
          </div>
          <Form.Item label="Clause text" required style={{ marginBottom: 6 }}
            extra={<div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Click a field below to insert it at the cursor.</span>
              <Text type={bytes > MAX_CLAUSE_BYTES ? 'danger' : 'secondary'} style={{ fontSize: 12 }}>{bytes} / {MAX_CLAUSE_BYTES} bytes</Text>
            </div>}>
            <Input.TextArea value={d.termText} autoSize={{ minRows: 8, maxRows: 18 }}
              placeholder="The supplier shall deliver the goods to {SHIP_TO} by the need-by date shown on purchase order {PO_NUMBER}…"
              onChange={e => { set({ termText: e.target.value }); caret.current = e.target.selectionStart; }}
              onSelect={trackCaret} onClick={trackCaret} onKeyUp={trackCaret} />
          </Form.Item>
          <Space size={[4, 4]} wrap style={{ marginBottom: 12 }}>
            {MERGE_FIELDS.map(f => (
              <Tooltip key={f.key} title={`{${f.key}} — e.g. ${f.sample}`}>
                <Tag color="volcano" style={{ cursor: 'pointer', margin: 0 }} onClick={() => insert(f.key)}>+ {f.label}</Tag>
              </Tooltip>
            ))}
          </Space>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', columnGap: 12 }}>
            <Form.Item label="Category" style={{ marginBottom: 10 }}>
              <Select value={d.category} onChange={v => set({ category: v })} options={TERM_CATEGORIES.map(c => ({ value: c.value, label: c.label }))} />
            </Form.Item>
            <Form.Item label="Business unit" style={{ marginBottom: 10 }}>
              <Select allowClear placeholder="All business units" value={d.businessUnitId ?? undefined} showSearch optionFilterProp="label"
                onChange={v => set({ businessUnitId: v ?? null })}
                options={bus.map(b => ({ value: Number(b.BUSINESS_UNIT_ID), label: b.BUSINESS_UNIT_NAME }))} />
            </Form.Item>
            <Form.Item label="Print order" tooltip="Lower numbers print first" style={{ marginBottom: 10 }}>
              <InputNumber style={{ width: '100%' }} min={0} value={d.displayOrder} onChange={v => set({ displayOrder: Number(v) || 0 })} />
            </Form.Item>
          </div>
          <Space size={24} wrap>
            <Tooltip title="Put this clause on every new purchase order">
              <Space size={6}><Switch size="small" checked={d.defaultFlag || d.mandatoryFlag} disabled={d.mandatoryFlag} onChange={v => set({ defaultFlag: v })} />
                <Text>Default on new POs</Text></Space>
            </Tooltip>
            <Tooltip title="Always on new POs and cannot be removed from an order">
              <Space size={6}><Switch size="small" checked={d.mandatoryFlag} onChange={v => set({ mandatoryFlag: v })} /><Text>Mandatory</Text></Space>
            </Tooltip>
            <Space size={6}><Switch size="small" checked={d.active} onChange={v => set({ active: v })} /><Text>Active</Text></Space>
          </Space>
        </Form>
        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>Preview with sample order values</Text>
          <div style={{ marginTop: 6 }}>
            <TermsDocument compact ctx={sampleContext()}
              clauses={[{ key: 'p', termId: null, title: d.title || 'Clause title', text: d.termText || '…', mandatory: d.mandatoryFlag }]} />
          </div>
          {unknown.length > 0 && <Alert type="error" showIcon style={{ marginTop: 10 }}
            message={`Unknown merge field${unknown.length > 1 ? 's' : ''}: ${unknown.map(u => `{${u}}`).join(', ')}`}
            description="These print exactly as typed. Use one of the fields listed under the text." />}
          {d.termId && (initial && lib.find(t => t.TERM_ID === d.termId)?.PO_COUNT) ? <Alert type="info" showIcon style={{ marginTop: 10 }}
            message={`Used on ${lib.find(t => t.TERM_ID === d.termId)?.PO_COUNT} purchase order(s)`}
            description="Those orders keep the wording they have. Draft orders can switch to the new wording from their Terms & Conditions tab." /> : null}
          {errors.length > 0 && <Alert type="warning" showIcon style={{ marginTop: 10 }} message={errors.join(' · ')} />}
        </div>
      </div>
    </Modal>
  );
};

// ── split one clause into several ─────────────────────────────────────────────────
const SplitModal: React.FC<{ term: LibraryTerm | null; onClose: () => void; onDone: () => void; lib: LibraryTerm[]; user: string }> =
  ({ term, onClose, onDone, lib, user }) => {
    const [parts, setParts] = useState<{ title: string; text: string; keep: boolean }[]>([]);
    const [retire, setRetire] = useState(true);
    const [busy, setBusy] = useState(false);
    useEffect(() => { setParts(term ? splitProposal(term.TERM_TEXT).map(p => ({ ...p, keep: true })) : []); setRetire(true); }, [term]);
    if (!term) return null;
    const kept = parts.filter(p => p.keep && p.title.trim() && p.text.trim());
    const run = async () => {
      setBusy(true);
      let made = 0;
      try {
        const base = term.TERM_CODE.length <= 36 ? term.TERM_CODE : nextCode(lib);
        for (let i = 0; i < kept.length; i++) {
          let code = `${base}-${i + 1}`;
          if (lib.some(t => t.TERM_CODE === code)) code = `${base}-S${i + 1}`;
          await poExec(PROC.saveTerm, { p_json: {
            termCode: code, title: kept[i].title.trim(), termText: kept[i].text.trim(), category: term.TERM_CATEGORY,
            businessUnitId: term.BUSINESS_UNIT_ID, displayOrder: term.DISPLAY_ORDER + i, defaultFlag: term.DEFAULT_FLAG,
            mandatoryFlag: term.MANDATORY_FLAG, status: term.STATUS,
          } }, user);
          made++;
        }
        if (retire) await poExec(PROC.saveTerm, { p_json: toJson({ ...fromTerm(term), active: false }) }, user);
        message.success(`${made} clause(s) created${retire ? `; ${term.TERM_CODE} set to inactive` : ''}`);
        onDone(); onClose();
      } catch (e: any) {
        message.error(`${made ? `${made} clause(s) created, then: ` : ''}${e.message}`, 10);
        if (made) onDone();
      } finally { setBusy(false); }
    };
    return (
      <Modal open={!!term} onCancel={onClose} width={900} destroyOnHidden okText={`Create ${kept.length} clause${kept.length === 1 ? '' : 's'}`}
        okButtonProps={{ disabled: kept.length < 2 }} confirmLoading={busy} onOk={run}
        title={<Space><ScissorOutlined style={{ color: PO_RED }} />Split {term.TERM_CODE} into separate clauses</Space>}>
        <Alert type="info" showIcon style={{ marginBottom: 10 }}
          message="Each numbered item or paragraph becomes its own clause, with the same business unit, category and flags. Check the titles before creating them." />
        {parts.length < 2 && <Empty description="The text has no numbered items or paragraphs to split on" />}
        <div style={{ maxHeight: 460, overflow: 'auto' }}>
          {parts.map((p, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, padding: 8, border: '1px solid #f0f0f0', borderRadius: 8, marginBottom: 6, opacity: p.keep ? 1 : 0.5 }}>
              <Checkbox checked={p.keep} onChange={e => setParts(ps => ps.map((x, j) => (j === i ? { ...x, keep: e.target.checked } : x)))} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <Input size="small" value={p.title} addonBefore={`${i + 1}.`} style={{ marginBottom: 4 }}
                  onChange={e => setParts(ps => ps.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
                <div style={{ fontSize: 12, color: '#595959', whiteSpace: 'pre-wrap', maxHeight: 90, overflow: 'auto' }}>{p.text}</div>
              </div>
            </div>
          ))}
        </div>
        <Checkbox checked={retire} onChange={e => setRetire(e.target.checked)} style={{ marginTop: 8 }}>
          Set {term.TERM_CODE} to inactive afterwards (orders that already have it keep it)
        </Checkbox>
      </Modal>
    );
  };

// ── page ─────────────────────────────────────────────────────────────────────────
const PoTerms: React.FC = () => {
  const buState = useBusinessUnits();
  const user = usePoUser();
  const [lib, setLib] = useState<LibraryTerm[]>([]);
  const [loading, setLoading] = useState(true);
  const [installed, setInstalled] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [cat, setCat] = useState<string | undefined>();
  const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE' | 'ALL'>('ACTIVE');
  const [editing, setEditing] = useState<Draft | null>(null);
  const [splitting, setSplitting] = useState<LibraryTerm | null>(null);
  const [showFields, setShowFields] = useState<'sample' | 'fields'>('sample');
  const dragFrom = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setLib(await loadTermLibrary()); setInstalled(true); }
    catch (e: any) { if (termsNotInstalled(e)) setInstalled(false); else setError(e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const bu = buState.bu;
  const buName = buState.current?.BUSINESS_UNIT_NAME;
  const scoped = useMemo(() => lib.filter(t => (bu ? appliesToBu(t, bu) : true)), [lib, bu]);
  const shown = useMemo(() => {
    const s = search.trim().toLowerCase();
    return scoped
      .filter(t => status === 'ALL' || t.STATUS === status)
      .filter(t => !cat || t.TERM_CATEGORY === cat)
      .filter(t => !s || `${t.TERM_CODE} ${t.TITLE} ${t.TERM_TEXT}`.toLowerCase().includes(s))
      .sort((a, b) => a.DISPLAY_ORDER - b.DISPLAY_ORDER || a.TERM_CODE.localeCompare(b.TERM_CODE));
  }, [scoped, search, cat, status]);
  const onNewPo = useMemo(() => defaultClauses(lib, bu), [lib, bu]);
  const printPos = useMemo(() => new Map(onNewPo.map((c, i) => [c.termId, i + 1])), [onNewPo]);
  const canReorder = !search.trim() && !cat && shown.length > 1;

  const stats = [
    { label: 'Active clauses', value: scoped.filter(t => t.STATUS === 'ACTIVE').length },
    { label: 'On every new PO', value: onNewPo.length, sub: bu ? buName : 'all business units' },
    { label: 'Mandatory', value: scoped.filter(t => t.STATUS === 'ACTIVE' && t.MANDATORY_FLAG === 'Y').length },
    { label: 'In use on POs', value: scoped.filter(t => t.PO_COUNT > 0).length, sub: 'clauses' },
  ];

  const newDraft = (): Draft => ({
    termCode: nextCode(lib), title: '', termText: '', category: cat || 'GENERAL', businessUnitId: null,
    displayOrder: (lib.reduce((m, t) => Math.max(m, t.DISPLAY_ORDER), 0) || 0) + 10, defaultFlag: true, mandatoryFlag: false, active: true,
  });

  const saveQuiet = async (d: Draft, ok: string) => {
    try { await poExec(PROC.saveTerm, { p_json: toJson(d) }, user); message.success(ok); load(); }
    catch (e: any) { message.error(e.message, 8); }
  };
  const del = async (t: LibraryTerm) => {
    try { const r = await poExec(PROC.deleteTerm, { p_term_id: t.TERM_ID }, user); message.success(r.message || 'Deleted'); load(); }
    catch (e: any) { message.error(e.message, 8); }
  };
  const reorder = async (from: number, to: number) => {
    if (from === to) return;
    const next = [...shown]; const [x] = next.splice(from, 1); next.splice(to, 0, x);
    const changes = next.map((t, i) => ({ termId: t.TERM_ID, displayOrder: (i + 1) * 10 })).filter(c => lib.find(t => t.TERM_ID === c.termId)?.DISPLAY_ORDER !== c.displayOrder);
    setLib(l => l.map(t => { const c = changes.find(z => z.termId === t.TERM_ID); return c ? { ...t, DISPLAY_ORDER: c.displayOrder } : t; }));
    try { await poExec(PROC.setTermOrder, { p_json: changes }, user); }
    catch (e: any) { message.error(e.message, 8); load(); }
  };

  const samplePdf = () => {
    const ctx = sampleContext();
    const h: Row = {
      PO_NUMBER: ctx.PO_NUMBER, REVISION_NUM: 0, CREATION_DATE: ctx.PO_DATE, BUYER_USER: user || ctx.BUYER, CURRENCY_CODE: ctx.CURRENCY,
      PAYMENT_TERMS: ctx.PAYMENT_TERMS, DOCUMENT_STATUS: 'INCOMPLETE', SUPPLIER_NAME: ctx.SUPPLIER_NAME, SITE_NAME: ctx.SUPPLIER_SITE,
      SUPPLIER_ADDRESS: 'Sample address', SHIP_TO_NAME: ctx.SHIP_TO, BILL_TO_NAME: ctx.BILL_TO,
    };
    const lines: Row[] = [
      { LINE_NUM: 1, ITEM_DESCRIPTION: 'Sample item — office chairs', NEED_BY_DATE: ctx.PO_DATE, LINE_TYPE: 'QUANTITY', QUANTITY: 50, UOM_CODE: 'EA', UNIT_PRICE: 1500, AMOUNT: 75000 },
      { LINE_NUM: 2, ITEM_DESCRIPTION: 'Sample service — installation', NEED_BY_DATE: ctx.PO_DATE, LINE_TYPE: 'AMOUNT', AMOUNT: 50000 },
    ];
    const doc = buildPoPdf(h, lines, { buName: buName || undefined, terms: printableClauses(onNewPo, ctx) });
    doc.save(`Sample PO terms${buName ? ` - ${buName}` : ''}.pdf`);
  };

  return (
    <div style={{ padding: 20 }}>
      <PoBar title="Terms & Conditions" subtitle="Clauses printed on purchase orders" icon={<FileProtectOutlined />} buState={buState} allowAllBu
        extra={<>
          <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>Refresh</Button>
          <Tooltip title="A sample purchase order PDF with the clauses a new order gets">
            <Button icon={<FilePdfOutlined />} onClick={samplePdf} disabled={!installed || !onNewPo.length}>Sample PDF</Button>
          </Tooltip>
          <Button type="primary" icon={<PlusOutlined />} disabled={!installed} onClick={() => setEditing({ ...newDraft(), businessUnitId: null })}>New clause</Button>
        </>} />

      {!installed && <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="Terms & Conditions is not installed in the database"
        description={<span>Run <code>database/po/306_po_terms.sql</code> (after 300–305). It creates the clause library and copies each business unit's
          existing terms text from Purchasing Options into it, so purchase orders keep printing the same terms.</span>} />}
      {error && <Alert type="error" showIcon style={{ marginBottom: 12 }} message={error} />}

      {installed && <>
        <AntRow gutter={[12, 12]} style={{ marginBottom: 12 }}>
          {stats.map(s => (
            <Col key={s.label} xs={12} md={6}>
              <Card size="small" style={{ borderRadius: 10 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>{s.label}</Text>
                <div style={{ fontSize: 22, fontWeight: 700, color: PO_RED, lineHeight: 1.2 }}>{s.value}</div>
                {s.sub && <Text type="secondary" style={{ fontSize: 11 }}>{s.sub}</Text>}
              </Card>
            </Col>
          ))}
        </AntRow>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.35fr) minmax(320px, 1fr)', gap: 14, alignItems: 'start' }}>
          <Card size="small" style={{ borderRadius: 10 }} loading={loading && !lib.length}
            title={<Space wrap>
              <Input allowClear prefix={<SearchOutlined />} placeholder="Search code, title or text" style={{ width: 240 }} value={search} onChange={e => setSearch(e.target.value)} />
              <Select allowClear placeholder="All categories" style={{ width: 190 }} value={cat} onChange={setCat}
                options={TERM_CATEGORIES.map(c => ({ value: c.value, label: c.label }))} />
              <Segmented size="small" value={status} onChange={v => setStatus(v as typeof status)}
                options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'INACTIVE', label: 'Inactive' }, { value: 'ALL', label: 'All' }]} />
            </Space>}
            extra={<Text type="secondary" style={{ fontSize: 12 }}>{shown.length} clause(s){bu ? ` for ${buName}` : ''}</Text>}>
            {!shown.length && <Empty description={lib.length ? 'No clauses match' : 'No clauses yet'} style={{ padding: 24 }}>
              {!lib.length && <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing(newDraft())}>Add your first clause</Button>}
            </Empty>}
            {shown.map((t, i) => {
              const pos = printPos.get(t.TERM_ID);
              const c = categoryInfo(t.TERM_CATEGORY);
              const long = splitProposal(t.TERM_TEXT).length >= 2;
              return (
                <div key={t.TERM_ID}
                  draggable={canReorder}
                  onDragStart={() => { dragFrom.current = i; }}
                  onDragOver={e => { if (canReorder) { e.preventDefault(); setDragOver(i); } }}
                  onDragLeave={() => setDragOver(d => (d === i ? null : d))}
                  onDrop={e => { e.preventDefault(); if (dragFrom.current !== null) reorder(dragFrom.current, i); dragFrom.current = null; setDragOver(null); }}
                  onDragEnd={() => { dragFrom.current = null; setDragOver(null); }}
                  onDoubleClick={() => setEditing(fromTerm(t))}
                  style={{ display: 'flex', gap: 10, padding: '10px 12px', marginBottom: 8, borderRadius: 10, background: t.STATUS === 'ACTIVE' ? '#fff' : '#fafafa',
                    border: `1px solid ${dragOver === i ? PO_RED : '#eef0f3'}`, boxShadow: dragOver === i ? `0 0 0 2px ${PO_RED}22` : undefined,
                    opacity: t.STATUS === 'ACTIVE' ? 1 : 0.65 }}>
                  <Tooltip title={canReorder ? 'Drag to change the print order' : 'Clear the search and category filter to reorder'}>
                    <HolderOutlined style={{ color: canReorder ? '#8c8c8c' : '#e0e0e0', cursor: canReorder ? 'grab' : 'not-allowed', marginTop: 4 }} />
                  </Tooltip>
                  <Tooltip title={pos ? `Prints as clause ${pos} on new ${buName || 'all-business-unit'} orders` : 'Not added to new orders automatically'}>
                    <div style={{ minWidth: 28, height: 28, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 12,
                      background: pos ? `${PO_RED}14` : '#f5f5f5', color: pos ? PO_RED : '#bfbfbf' }}>{pos ?? '—'}</div>
                  </Tooltip>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Space size={6} wrap>
                      <Text strong>{t.TITLE}</Text>
                      <Text type="secondary" style={{ fontSize: 12 }}>{t.TERM_CODE}</Text>
                      <Tag color={c.color} style={{ fontSize: 11 }}>{c.label}</Tag>
                      <Tag style={{ fontSize: 11 }}>{t.BUSINESS_UNIT_NAME || 'All business units'}</Tag>
                      {t.MANDATORY_FLAG === 'Y' ? <Tag color="red" icon={<LockOutlined />} style={{ fontSize: 11 }}>Mandatory</Tag>
                        : t.DEFAULT_FLAG === 'Y' ? <Tag color="green" style={{ fontSize: 11 }}>Default</Tag> : <Tag style={{ fontSize: 11 }}>Optional</Tag>}
                      {t.STATUS !== 'ACTIVE' && <Tag style={{ fontSize: 11 }}>Inactive</Tag>}
                      {t.PO_COUNT > 0 && <Tooltip title="Purchase orders that carry this clause"><Tag color="blue" style={{ fontSize: 11 }}>On {t.PO_COUNT} PO{t.PO_COUNT > 1 ? 's' : ''}</Tag></Tooltip>}
                    </Space>
                    <div style={{ fontSize: 12.5, color: '#595959', marginTop: 3, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      <ClauseText text={t.TERM_TEXT} ctx={showFields === 'sample' ? sampleContext() : {}} />
                    </div>
                  </div>
                  <Space size={0} style={{ alignSelf: 'flex-start' }}>
                    <Tooltip title="Edit"><Button size="small" type="text" icon={<EditOutlined />} onClick={() => setEditing(fromTerm(t))} /></Tooltip>
                    <Tooltip title="Duplicate"><Button size="small" type="text" icon={<CopyOutlined />}
                      onClick={() => setEditing({ ...fromTerm(t), termId: undefined, termCode: nextCode(lib), title: `${t.TITLE} (copy)`, displayOrder: t.DISPLAY_ORDER + 1 })} /></Tooltip>
                    {long && <Tooltip title="Split into separate clauses"><Button size="small" type="text" icon={<ScissorOutlined />} onClick={() => setSplitting(t)} /></Tooltip>}
                    <Tooltip title={t.STATUS === 'ACTIVE' ? 'Set inactive (new orders stop getting it)' : 'Set active'}>
                      <Button size="small" type="text" icon={t.STATUS === 'ACTIVE' ? <StopOutlined /> : <CheckCircleOutlined />}
                        onClick={() => saveQuiet({ ...fromTerm(t), active: t.STATUS !== 'ACTIVE' }, t.STATUS === 'ACTIVE' ? `${t.TERM_CODE} set to inactive` : `${t.TERM_CODE} is active`)} />
                    </Tooltip>
                    {t.PO_COUNT > 0
                      ? <Tooltip title={`On ${t.PO_COUNT} purchase order(s) — set it inactive instead`}><Button size="small" type="text" danger disabled icon={<DeleteOutlined />} /></Tooltip>
                      : <Popconfirm title={`Delete ${t.TERM_CODE}?`} okText="Delete" okButtonProps={{ danger: true }} onConfirm={() => del(t)}>
                          <Button size="small" type="text" danger icon={<DeleteOutlined />} /></Popconfirm>}
                  </Space>
                </div>
              );
            })}
          </Card>

          <Card size="small" style={{ borderRadius: 10, position: 'sticky', top: 12 }}
            title={<Space><FileProtectOutlined style={{ color: PO_RED }} />On a new purchase order</Space>}
            extra={<Segmented size="small" value={showFields} onChange={v => setShowFields(v as typeof showFields)}
              options={[{ value: 'sample', label: 'Sample values' }, { value: 'fields', label: 'Merge fields' }]} />}>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
              {bu ? `Default and mandatory clauses for ${buName}, in print order.` : 'Clauses for all business units. Choose a business unit at the top to include its own clauses.'}
              {' '}Buyers can add, remove or reword clauses on a draft order.
            </Text>
            <div style={{ maxHeight: 'calc(100vh - 260px)', overflow: 'auto' }}>
              <TermsDocument compact clauses={onNewPo} ctx={showFields === 'sample' ? sampleContext() : {}}
                emptyText="No default clauses — new orders start without terms" />
            </div>
          </Card>
        </div>
      </>}

      <ClauseEditor open={!!editing} initial={editing} onClose={() => setEditing(null)} onSaved={load}
        bus={buState.bus as unknown as { BUSINESS_UNIT_ID: number; BUSINESS_UNIT_NAME: string }[]} lib={lib} user={user} />
      <SplitModal term={splitting} onClose={() => setSplitting(null)} onDone={load} lib={lib} user={user} />
    </div>
  );
};

export default PoTerms;
