// Rich text editor (contentEditable + toolbar) for clauses: bold / italic / underline / strike,
// bulleted and numbered lists, indent, alignment, clear formatting, insert merge field.
// Pasted Word / web content is cleaned to the allowed subset (richText.ts). Value in / out is HTML;
// plain-text values are shown with their line breaks and become HTML on the first edit.
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Button, Divider, Dropdown, Tooltip } from 'antd';
import {
  AlignCenterOutlined, AlignLeftOutlined, AlignRightOutlined, BoldOutlined, ClearOutlined, ItalicOutlined,
  MenuFoldOutlined, MenuUnfoldOutlined, OrderedListOutlined, PlusOutlined, RedoOutlined, StrikethroughOutlined,
  UnderlineOutlined, UndoOutlined, UnorderedListOutlined,
} from '@ant-design/icons';
import { plainToHtml, sanitizeHtml, toHtml } from './richText';

/** Styles for showing rich clauses (and the editor) — injected once. */
export const ensureRichStyles = () => {
  if (typeof document === 'undefined' || document.getElementById('rr-rich-styles')) return;
  const st = document.createElement('style');
  st.id = 'rr-rich-styles';
  st.textContent = `
.rt-content { overflow-wrap: anywhere; }
.rt-content p { margin: 0 0 4px; }
.rt-content div { margin: 0; }
.rt-content ul, .rt-content ol { margin: 2px 0 4px; padding-left: 22px; }
.rt-content li { margin: 0; }
.rt-content blockquote { margin: 0 0 0 22px; padding: 0; border: none; }
.rt-content > :last-child { margin-bottom: 0; }
.rt-editor { outline: none; padding: 8px 10px; overflow: auto; line-height: 1.55; font-size: 13px; }
.rt-editor:empty:before { content: attr(data-placeholder); color: #bfbfbf; pointer-events: none; }
.rt-field { border-bottom: 1px dotted #C74634; background: rgba(199, 70, 52, 0.06); }
.rt-field-missing { color: #d46b08; background: #fff7e6; border-radius: 3px; padding: 0 2px; font-family: monospace; font-size: 0.92em; }
.rt-field-unknown { color: #cf1322; background: #fff1f0; border-radius: 3px; padding: 0 2px; font-family: monospace; font-size: 0.92em; }
`;
  document.head.appendChild(st);
};

/** Show stored clause text (rich or plain), cleaned. */
export const RichHtml: React.FC<{ html: string; style?: React.CSSProperties; className?: string }> = ({ html, style, className }) => {
  ensureRichStyles();
  return <div className={`rt-content ${className || ''}`} style={style} dangerouslySetInnerHTML={{ __html: sanitizeHtml(toHtml(html)) }} />;
};

export interface RichTextEditorHandle { insertText: (text: string) => void; focus: () => void }

const COMMANDS: { cmd: string; icon: React.ReactNode; title: string }[][] = [
  [
    { cmd: 'bold', icon: <BoldOutlined />, title: 'Bold (Ctrl+B)' },
    { cmd: 'italic', icon: <ItalicOutlined />, title: 'Italic (Ctrl+I)' },
    { cmd: 'underline', icon: <UnderlineOutlined />, title: 'Underline (Ctrl+U)' },
    { cmd: 'strikeThrough', icon: <StrikethroughOutlined />, title: 'Strikethrough' },
  ],
  [
    { cmd: 'insertUnorderedList', icon: <UnorderedListOutlined />, title: 'Bulleted list' },
    { cmd: 'insertOrderedList', icon: <OrderedListOutlined />, title: 'Numbered list' },
    { cmd: 'outdent', icon: <MenuFoldOutlined />, title: 'Decrease indent' },
    { cmd: 'indent', icon: <MenuUnfoldOutlined />, title: 'Increase indent' },
  ],
  [
    { cmd: 'justifyLeft', icon: <AlignLeftOutlined />, title: 'Align left' },
    { cmd: 'justifyCenter', icon: <AlignCenterOutlined />, title: 'Center' },
    { cmd: 'justifyRight', icon: <AlignRightOutlined />, title: 'Align right' },
  ],
  [
    { cmd: 'removeFormat', icon: <ClearOutlined />, title: 'Clear formatting' },
    { cmd: 'undo', icon: <UndoOutlined />, title: 'Undo (Ctrl+Z)' },
    { cmd: 'redo', icon: <RedoOutlined />, title: 'Redo (Ctrl+Y)' },
  ],
];
const STATE_CMDS = ['bold', 'italic', 'underline', 'strikeThrough', 'insertUnorderedList', 'insertOrderedList', 'justifyCenter', 'justifyRight'];

export const RichTextEditor = forwardRef<RichTextEditorHandle, {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
  maxHeight?: number;
  disabled?: boolean;
  /** merge fields for the "Insert field" menu */
  fields?: { key: string; label: string }[];
  status?: 'error';
}>(({ value, onChange, placeholder, minHeight = 140, maxHeight = 380, disabled, fields, status }, ref) => {
  ensureRichStyles();
  const el = useRef<HTMLDivElement>(null);
  const emitted = useRef<string | null>(null);
  const range = useRef<Range | null>(null);
  const [active, setActive] = useState<Record<string, boolean>>({});
  const [focused, setFocused] = useState(false);

  // show the incoming value unless it is what the editor itself just produced (keeps the caret)
  useEffect(() => {
    if (!el.current) return;
    const incoming = value || '';
    if (incoming === emitted.current) return;
    el.current.innerHTML = incoming ? sanitizeHtml(toHtml(incoming)) : '';
    emitted.current = incoming;
  }, [value]);

  const emit = useCallback(() => {
    if (!el.current) return;
    const raw = el.current.innerHTML;
    const text = (el.current.textContent || '').replace(/​/g, '');
    const html = !text.trim() && !/<(li|br)\b/i.test(raw.replace(/^<br>$/, '')) ? '' : sanitizeHtml(raw);
    emitted.current = html;
    onChange(html);
  }, [onChange]);

  const saveRange = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount && el.current?.contains(sel.anchorNode)) range.current = sel.getRangeAt(0).cloneRange();
  };
  const restoreRange = () => {
    el.current?.focus();
    const sel = window.getSelection();
    if (range.current && sel) { sel.removeAllRanges(); sel.addRange(range.current); }
  };
  const refreshState = useCallback(() => {
    const st: Record<string, boolean> = {};
    STATE_CMDS.forEach(c => { try { st[c] = document.queryCommandState(c); } catch { st[c] = false; } });
    setActive(st);
  }, []);
  useEffect(() => {
    const onSel = () => { if (el.current && document.activeElement === el.current) { saveRange(); refreshState(); } };
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, [refreshState]);

  const run = (cmd: string) => {
    restoreRange();
    try { document.execCommand('styleWithCSS', false, 'false'); } catch { /* older engines */ }
    document.execCommand(cmd, false);
    emit(); refreshState(); saveRange();
  };
  const insertText = (text: string) => {
    restoreRange();
    document.execCommand('insertText', false, text);
    emit(); saveRange();
  };
  useImperativeHandle(ref, () => ({ insertText, focus: () => restoreRange() }));

  const onPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    const clean = html ? sanitizeHtml(html.replace(/<!--[\s\S]*?-->/g, '')) : plainToHtml(text);
    document.execCommand('insertHTML', false, clean || plainToHtml(text));
    emit();
  };

  const border = status === 'error' ? '#ff4d4f' : focused ? '#4096ff' : '#d9d9d9';
  return (
    <div style={{ border: `1px solid ${border}`, borderRadius: 6, background: disabled ? '#fafafa' : '#fff', boxShadow: focused ? '0 0 0 2px rgba(5,145,255,0.1)' : undefined }}>
      {!disabled && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2, padding: '3px 6px', borderBottom: '1px solid #f0f0f0', background: '#fafafa', borderRadius: '6px 6px 0 0' }}>
          {COMMANDS.map((group, gi) => (
            <React.Fragment key={gi}>
              {gi > 0 && <Divider type="vertical" style={{ margin: '0 3px' }} />}
              {group.map(c => (
                <Tooltip key={c.cmd} title={c.title} mouseEnterDelay={0.4}>
                  <Button size="small" type={active[c.cmd] ? 'primary' : 'text'} ghost={active[c.cmd]} icon={c.icon}
                    aria-label={c.title} onMouseDown={e => e.preventDefault()} onClick={() => run(c.cmd)} />
                </Tooltip>
              ))}
            </React.Fragment>
          ))}
          {fields && fields.length > 0 && <>
            <Divider type="vertical" style={{ margin: '0 3px' }} />
            <Dropdown trigger={['click']} menu={{ items: fields.map(f => ({ key: f.key, label: <span>{f.label} <span style={{ color: '#8c8c8c', fontSize: 11 }}>{`{${f.key}}`}</span></span> })),
              onClick: ({ key }) => insertText(`{${key}}`) }}>
              <Button size="small" type="text" icon={<PlusOutlined />} onMouseDown={e => e.preventDefault()}>Field</Button>
            </Dropdown>
          </>}
        </div>
      )}
      <div ref={el} className="rt-editor rt-content" contentEditable={!disabled} suppressContentEditableWarning
        data-placeholder={placeholder || ''} role="textbox" aria-multiline="true"
        style={{ minHeight, maxHeight }}
        onInput={emit} onPaste={onPaste} onKeyUp={saveRange} onMouseUp={saveRange}
        onFocus={() => setFocused(true)} onBlur={() => { saveRange(); setFocused(false); }} />
    </div>
  );
});
RichTextEditor.displayName = 'RichTextEditor';

export default RichTextEditor;
