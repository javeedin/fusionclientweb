// The accounting of a transaction as Dr / Cr lines: each line's full code combination and, under it, the natural
// account segment with its description (Account 5112101 — Bank charges). Every segment is in the code's tooltip.
import React, { useEffect, useMemo, useState } from 'react';
import { Button, Spin, Tag, Tooltip, Typography, message } from 'antd';
import { CopyOutlined } from '@ant-design/icons';
import { validateAccountCode } from './AccountSelector';

const { Text } = Typography;

export interface AccountingLine {
  side: 'DR' | 'CR';
  account: string;
  /** what the line is, e.g. "Bank account", "Offset account" */
  label?: string;
  /** in the transaction currency */
  entered: number;
  currency: string;
  /** in the ledger currency, when it differs from the entered amount */
  accounted?: number;
  ledgerCurrency?: string;
  /** natural account value + description read with the lines (shown when the segment lookup has nothing) */
  accountValue?: string;
  accountDescription?: string;
}

interface SegmentInfo { name: string; value: string; description: string }
interface Breakdown { segments: SegmentInfo[]; invalid: string[] }

/** Segment name / value / description of each code combination (segments and value sets are cached by AccountSelector). */
export function useSegmentBreakdowns(codes: string[]): { map: Record<string, Breakdown>; loading: boolean } {
  const key = useMemo(() => [...new Set(codes.filter(Boolean))].sort().join('|'), [codes]);
  const [map, setMap] = useState<Record<string, Breakdown>>({});
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!key) { setMap({}); return; }
    let cancelled = false;
    setLoading(true);
    Promise.all(key.split('|').map(async code => {
      try {
        const v = await validateAccountCode(code);
        return [code, { segments: Object.values(v.segmentDetails), invalid: v.invalidSegments }] as const;
      } catch {
        return [code, { segments: [], invalid: [] }] as const;
      }
    }))
      .then(entries => { if (!cancelled) setMap(Object.fromEntries(entries)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [key]);
  return { map, loading };
}

/** The natural-account segment ("Account", not "Sub Account"). */
const accountSegment = (b: Breakdown | undefined) => b?.segments.find(s => /natural/i.test(s.name))
  || b?.segments.find(s => /^account$/i.test(s.name.trim()))
  || b?.segments.find(s => /account/i.test(s.name) && !/sub/i.test(s.name));

const money = (v: number) => v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const SIDE = { DR: { color: '#0572CE', tag: 'blue', label: 'Dr' }, CR: { color: '#389e0d', tag: 'green', label: 'Cr' } } as const;

const cell: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #f0f0f0', verticalAlign: 'top' };
const head: React.CSSProperties = { ...cell, background: '#fafafa', fontSize: 11, color: '#595959', fontWeight: 600, whiteSpace: 'nowrap' };

const AccountingLinesView: React.FC<{ lines: AccountingLine[] }> = ({ lines }) => {
  const { map, loading } = useSegmentBreakdowns(useMemo(() => lines.map(l => l.account), [lines]));
  const ccy = lines[0]?.currency || '';
  const ledger = lines.find(l => l.ledgerCurrency)?.ledgerCurrency;
  const showAccounted = lines.some(l => l.accounted != null && (l.ledgerCurrency !== l.currency || Math.abs(l.accounted - l.entered) > 0.004));
  const total = (side: 'DR' | 'CR', f: (l: AccountingLine) => number) => lines.filter(l => l.side === side).reduce((s, l) => s + f(l), 0);

  return (
    <div style={{ border: '1px solid #f0f0f0', borderRadius: 8, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            <th style={{ ...head, width: 44 }} />
            <th style={{ ...head, textAlign: 'left' }}>Account</th>
            <th style={{ ...head, textAlign: 'right', width: 120 }}>Debit {ccy}</th>
            <th style={{ ...head, textAlign: 'right', width: 120 }}>Credit {ccy}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => {
            const b = map[l.account];
            const side = SIDE[l.side];
            const amount = (
              <>
                <div style={{ fontFamily: 'monospace', fontWeight: 600, color: side.color }}>{money(l.entered)}</div>
                {showAccounted && l.accounted != null && (
                  <div style={{ fontSize: 10, color: '#8c8c8c' }}>{l.ledgerCurrency} {money(l.accounted)}</div>
                )}
              </>
            );
            return (
              <tr key={i}>
                <td style={cell}><Tag color={side.tag} style={{ margin: 0, fontWeight: 600 }}>{side.label}</Tag></td>
                <td style={cell}>
                  {l.label && <div style={{ fontSize: 11, color: '#8c8c8c', marginBottom: 2 }}>{l.label}</div>}
                  {l.account ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Tooltip title={b?.segments.length ? (
                        <div style={{ display: 'grid', gridTemplateColumns: 'auto auto 1fr', columnGap: 8, fontSize: 11 }}>
                          {b.segments.map((s, k) => (
                            <React.Fragment key={k}>
                              <span style={{ opacity: 0.7 }}>{s.name}</span>
                              <span style={{ fontFamily: 'monospace' }}>{s.value}</span>
                              <span>{s.description || '—'}</span>
                            </React.Fragment>
                          ))}
                        </div>) : undefined} overlayStyle={{ maxWidth: 460 }}>
                        <Text style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 600, wordBreak: 'break-all', cursor: b?.segments.length ? 'help' : undefined }}>{l.account}</Text>
                      </Tooltip>
                      <Tooltip title="Copy the code combination">
                        <Button size="small" type="text" icon={<CopyOutlined style={{ fontSize: 11 }} />}
                          onClick={() => navigator.clipboard?.writeText(l.account).then(() => message.success('Copied'))} />
                      </Tooltip>
                    </div>
                  ) : <Text type="danger" style={{ fontSize: 12 }}>No account on the transaction</Text>}
                  {l.account && (loading && !b && !l.accountDescription ? <Spin size="small" style={{ marginTop: 4 }} /> : (() => {
                    const a = accountSegment(b) ?? (l.accountDescription ? { value: l.accountValue || '', description: l.accountDescription } : undefined);
                    if (!a && !b?.invalid.length) return null;
                    return (
                      <div style={{ marginTop: 2, fontSize: 12 }}>
                        {a && <>
                          <span style={{ fontFamily: 'monospace', fontWeight: 600, marginRight: 6 }}>{a.value}</span>
                          <span style={{ color: a.description ? '#262626' : '#bfbfbf' }}>{a.description || 'no description'}</span>
                        </>}
                        {b && b.invalid.length > 0 && (
                          <div style={{ fontSize: 11, color: '#cf1322' }}>Not a valid value: {b.invalid.join(', ')}</div>
                        )}
                      </div>
                    );
                  })())}
                </td>
                <td style={{ ...cell, textAlign: 'right' }}>{l.side === 'DR' ? amount : null}</td>
                <td style={{ ...cell, textAlign: 'right' }}>{l.side === 'CR' ? amount : null}</td>
              </tr>
            );
          })}
          <tr style={{ background: '#fafafa' }}>
            <td style={cell} />
            <td style={{ ...cell, fontWeight: 600, textAlign: 'right' }}>Total</td>
            {(['DR', 'CR'] as const).map(s => (
              <td key={s} style={{ ...cell, textAlign: 'right' }}>
                <div style={{ fontFamily: 'monospace', fontWeight: 700 }}>{money(total(s, l => l.entered))}</div>
                {showAccounted && <div style={{ fontSize: 10, color: '#8c8c8c' }}>{ledger} {money(total(s, l => l.accounted ?? l.entered))}</div>}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
};

export default AccountingLinesView;
