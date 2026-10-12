// Purchasing-RR — Report Branding: use a branding for all modules (Purchasing → Payables, Receivables, Cash,
// General Ledger, Fixed Assets) of its business unit, for one business unit or every branded one at once.
// Shows each business unit's modules before → after, then saves the branding with the new "printed on" list.
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Avatar, Button, Checkbox, Modal, Progress, Segmented, Select, Tag, Tooltip, Typography, message } from 'antd';
import { AppstoreAddOutlined, CheckCircleFilled, PlusOutlined } from '@ant-design/icons';
import { PO_RED } from './poShared';
import {
  BRANDING_DOCS, planAllModules, saveAppliesTo, type AllModulesPlan, type Branding,
} from '../../services/reportBranding.service';

const { Text } = Typography;

type Mode = 'MODULES' | 'ALL';
export interface AllModulesTarget { businessUnitId: number; businessUnitName: string; sourceId: number }

const initials = (s: string) => s.split(/[\s_]+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';

/** What the save would write, or null when nothing changes. */
const nextAppliesTo = (p: AllModulesPlan, mode: Mode): string[] | null => {
  if (mode === 'ALL') return p.source.appliesTo.includes('ALL') || p.otherAll ? null : ['ALL'];
  return p.add.length ? BRANDING_DOCS.map(d => d.code).filter(c => p.has.includes(c) || p.add.includes(c)) : null;
};

const BrandingAllModules: React.FC<{
  open: boolean;
  targets: AllModulesTarget[];
  list: Branding[];
  logos: Record<number, string | null>;
  user: string;
  onClose: () => void;
  onDone: () => void;
}> = ({ open, targets, list, logos, user, onClose, onDone }) => {
  const [mode, setMode] = useState<Mode>('MODULES');
  const [source, setSource] = useState<Record<number, number>>({});
  const [skip, setSkip] = useState<Record<number, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);

  useEffect(() => {
    if (!open) return;
    setMode('MODULES'); setSkip({}); setDone(0);
    setSource(Object.fromEntries(targets.map(t => [t.businessUnitId, t.sourceId])));
  }, [open, targets]);

  const rows = useMemo(() => targets.map(t => {
    const src = list.find(b => b.brandingId === (source[t.businessUnitId] ?? t.sourceId));
    const plan = src ? planAllModules(list, src) : null;
    const choices = list.filter(b => b.businessUnitId === t.businessUnitId && b.status === 'ACTIVE');
    return { t, plan, choices, next: plan ? nextAppliesTo(plan, mode) : null };
  }), [targets, list, source, mode]);

  const todo = rows.filter(r => r.next && !skip[r.t.businessUnitId]);

  const apply = async () => {
    setBusy(true); setDone(0);
    const failed: string[] = [];
    for (const r of todo) {
      try { await saveAppliesTo(r.plan!.source, r.next!, user); }
      catch (e: any) { failed.push(`${r.t.businessUnitName}: ${e.message || e}`); }
      setDone(n => n + 1);
    }
    setBusy(false);
    if (failed.length) {
      Modal.error({ title: `${todo.length - failed.length} of ${todo.length} saved`, content: <ul style={{ paddingLeft: 18 }}>{failed.map(f => <li key={f}>{f}</li>)}</ul> });
    } else {
      message.success(todo.length === 1 ? `"${todo[0].plan!.source.displayName}" now prints on all modules of ${todo[0].t.businessUnitName}`
        : `Branding now prints on all modules of ${todo.length} business units`);
    }
    onDone();
  };

  const Logo: React.FC<{ b: Branding }> = ({ b }) => {
    const u = b.brandingId ? logos[b.brandingId] : null;
    return u ? <img src={u} alt="" style={{ height: 16, maxWidth: 40, objectFit: 'contain' }} />
      : <Avatar size={16} style={{ background: b.accentColor || PO_RED, fontSize: 8, flexShrink: 0 }}>{initials(b.displayName)}</Avatar>;
  };

  /** One module cell of a row, after the change. */
  const Cell: React.FC<{ code: string; p: AllModulesPlan; next: string[] | null }> = ({ code, p, next }) => {
    const kept = p.kept.find(k => k.code === code);
    const accent = p.source.accentColor || PO_RED;
    if (kept) {
      return <Tooltip title={`Keeps its own branding "${kept.by.displayName}"`}>
        <div className="rr-am-cell" style={{ borderColor: '#d9d9d9', background: '#fafafa', color: '#8c8c8c' }}>
          <Logo b={kept.by} /><span className="rr-am-name">{kept.by.displayName}</span></div></Tooltip>;
    }
    const isNew = !!next && !p.has.includes(code);
    const viaAll = mode === 'ALL' ? !!next || p.source.appliesTo.includes('ALL') : p.source.appliesTo.includes('ALL');
    if (!isNew && !p.has.includes(code)) {
      return p.otherAll
        ? <Tooltip title={`Prints "${p.otherAll.displayName}", the business unit's All documents branding`}>
            <div className="rr-am-cell" style={{ borderStyle: 'dashed', borderColor: '#d9d9d9', background: '#fafafa', color: '#8c8c8c' }}>
              <Logo b={p.otherAll} /><span className="rr-am-name">{p.otherAll.displayName}</span>
              <Tag style={{ fontSize: 9, margin: 0, lineHeight: '14px', padding: '0 3px' }}>ALL</Tag></div></Tooltip>
        : <div className="rr-am-cell" style={{ borderStyle: 'dashed', color: '#bfbfbf' }}>Name only</div>;
    }
    return (
      <div className="rr-am-cell" style={{ borderStyle: viaAll ? 'dashed' : 'solid', borderColor: isNew ? '#52c41a' : `${accent}66`,
        background: isNew ? '#f6ffed' : `${accent}0f` }}>
        {isNew ? <PlusOutlined style={{ color: '#52c41a', fontSize: 10 }} /> : <Logo b={p.source} />}
        <span className="rr-am-name">{p.source.displayName}</span>
        {viaAll && <Tag style={{ fontSize: 9, margin: 0, lineHeight: '14px', padding: '0 3px' }}>ALL</Tag>}
      </div>
    );
  };

  return (
    <Modal open={open} onCancel={() => !busy && onClose()} width={1180} destroyOnHidden
      title={<span><AppstoreAddOutlined style={{ color: PO_RED }} /> Use for all modules</span>}
      footer={[
        <Button key="c" onClick={onClose} disabled={busy}>Cancel</Button>,
        <Button key="a" type="primary" icon={<AppstoreAddOutlined />} loading={busy} disabled={!todo.length}
          style={{ background: todo.length ? PO_RED : undefined }} onClick={apply}>
          {todo.length ? `Apply to ${todo.length} business unit${todo.length === 1 ? '' : 's'}` : 'Nothing to change'}
        </Button>,
      ]}>
      <style>{`
        .rr-am-grid { display: grid; grid-template-columns: 28px 210px repeat(${BRANDING_DOCS.length}, minmax(118px, 1fr)); gap: 6px; align-items: center; }
        .rr-am-head { font-size: 11px; font-weight: 600; color: #595959; }
        .rr-am-row { padding: 8px 0; border-top: 1px solid #f0f0f0; }
        .rr-am-cell { display: flex; align-items: center; gap: 5px; padding: 3px 6px; border: 1px solid; border-radius: 6px; font-size: 11px; min-height: 26px; overflow: hidden; }
        .rr-am-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
      `}</style>

      <Segmented block value={mode} onChange={v => setMode(v as Mode)} style={{ marginBottom: 8 }}
        options={[
          { value: 'MODULES', label: 'Every module — tick all six modules on the branding' },
          { value: 'ALL', label: 'All documents — the default for every module, including new ones' },
        ]} />
      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 10 }}>
        {mode === 'MODULES'
          ? 'The branding is added to each module that prints only the business unit name. Modules that already have a branding of their own keep it.'
          : 'The branding becomes the business unit\'s "All documents" branding: every module without a branding of its own prints it, and so will modules added later. Modules with their own branding keep it.'}
      </Text>

      <div className="rr-am-grid">
        <span />
        <span className="rr-am-head">Business unit · branding</span>
        {BRANDING_DOCS.map(d => <span key={d.code} className="rr-am-head">{d.label}</span>)}
      </div>
      {rows.map(({ t, plan, choices, next }) => (
        <div key={t.businessUnitId} className="rr-am-grid rr-am-row" style={{ opacity: next && !skip[t.businessUnitId] ? 1 : 0.6 }}>
          <Checkbox checked={!!next && !skip[t.businessUnitId]} disabled={!next || busy}
            onChange={e => setSkip(s => ({ ...s, [t.businessUnitId]: !e.target.checked }))} />
          <div style={{ minWidth: 0 }}>
            <Text strong style={{ fontSize: 12, display: 'block' }} ellipsis>{t.businessUnitName}</Text>
            {choices.length > 1 ? (
              <Select size="small" style={{ width: '100%' }} value={source[t.businessUnitId]} disabled={busy}
                onChange={v => setSource(s => ({ ...s, [t.businessUnitId]: v }))}
                options={choices.map(b => ({ value: b.brandingId!, label: b.displayName }))} />
            ) : (
              <Text type="secondary" style={{ fontSize: 11 }} ellipsis>{plan?.source.displayName}</Text>
            )}
            {!next && plan && (
              <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
                {mode === 'ALL' && plan.otherAll ? <>"{plan.otherAll.displayName}" is already this unit's All documents branding</>
                  : <><CheckCircleFilled style={{ color: '#52c41a' }} /> Already on every module</>}
              </Text>
            )}
          </div>
          {plan ? BRANDING_DOCS.map(d => <Cell key={d.code} code={d.code} p={plan} next={next} />) : null}
        </div>
      ))}

      {busy && <Progress percent={Math.round((done / Math.max(1, todo.length)) * 100)} size="small" strokeColor={PO_RED} style={{ marginTop: 10 }} />}
      <Alert type="info" showIcon style={{ marginTop: 12 }}
        message="Only the modules the branding prints on change. The logo, company name, address and colours stay as they are." />
    </Modal>
  );
};

export default BrandingAllModules;
