// PMS dashboard — looks (themes) and the two charts used by the modern looks.
// Categorical slots: validated reference palette (dataviz skill, light + dark steps), assigned per company CODE
// in fixed order so a company keeps its colour across refreshes and filters; a 9th+ company folds into "Other".
import React from 'react';
import { Tooltip } from 'antd';
import { CaretUpFilled, CaretDownFilled, BarChartOutlined, FundProjectionScreenOutlined } from '@ant-design/icons';
import { fmtShort, fmtPct } from '../../services/pms.service';

export type Look = 'classic' | 'midnight' | 'aurora';

/** PMS → Modules menu (only the live modules) */
export const PMS_MODULES = [
  { key: '/pms/investment-holdings', icon: <BarChartOutlined />, label: 'Investment Holdings' },
  { key: '/pms/venture-capital', icon: <FundProjectionScreenOutlined />, label: 'Venture Capital' },
];

export interface Theme {
  look: Look; dark: boolean;
  bg: string; surface: string; surface2: string; ink: string; muted: string; faint: string; line: string;
  accent: string; pos: string; neg: string; neu: string; reval: string; revalInk: string;
  radius: number; shadow: string; blur?: string;
  heroBg: string; heroInk: string; heroMuted: string; heroChip: string;
  series: string[]; other: string;
}

const SERIES_LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
const SERIES_DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];

export const THEMES: Record<Look, Theme> = {
  classic: {
    look: 'classic', dark: false,
    bg: '#f5f7fb', surface: '#ffffff', surface2: '#fafbfc', ink: '#172033', muted: '#7c8596', faint: '#929bad', line: '#dfe4ec',
    accent: '#1e3766', pos: '#168a42', neg: '#ce3434', neu: '#697386', reval: '#fff7dc', revalInk: '#806317',
    radius: 12, shadow: 'none',
    heroBg: '#ffffff', heroInk: '#172033', heroMuted: '#7c8596', heroChip: '#f0f2f5',
    series: SERIES_LIGHT, other: '#a3a8b4',
  },
  midnight: {
    look: 'midnight', dark: true,
    bg: '#0b1020', surface: '#121a2e', surface2: '#0f1729', ink: '#e6ebf5', muted: '#8b97b3', faint: '#6a7799', line: '#22304f',
    accent: '#5b8cff', pos: '#34d17f', neg: '#ff6b78', neu: '#8b97b3', reval: 'rgba(245,196,81,.10)', revalInk: '#f5c451',
    radius: 14, shadow: '0 1px 0 rgba(255,255,255,.04) inset, 0 12px 30px rgba(0,0,0,.35)',
    heroBg: 'linear-gradient(135deg, #131c33 0%, #1a2748 55%, #22305a 100%)', heroInk: '#ffffff', heroMuted: '#9fb0d6', heroChip: 'rgba(255,255,255,.08)',
    series: SERIES_DARK, other: '#5d6683',
  },
  aurora: {
    look: 'aurora', dark: false,
    bg: 'linear-gradient(180deg, #eef0fb 0%, #f6f4fb 40%, #f7f8fb 100%)', surface: 'rgba(255,255,255,.82)', surface2: 'rgba(255,255,255,.6)',
    ink: '#141a2e', muted: '#6b7390', faint: '#8d94ad', line: 'rgba(120,120,170,.18)',
    accent: '#5b4bdb', pos: '#12805c', neg: '#d33b54', neu: '#6b7390', reval: 'rgba(237,161,0,.10)', revalInk: '#8a5a00',
    radius: 20, shadow: '0 10px 40px rgba(80,70,180,.10), 0 2px 6px rgba(80,70,180,.06)', blur: 'blur(14px)',
    heroBg: 'linear-gradient(120deg, #4f46e5 0%, #7c3aed 45%, #db2777 100%)', heroInk: '#ffffff', heroMuted: 'rgba(255,255,255,.78)', heroChip: 'rgba(255,255,255,.16)',
    series: SERIES_LIGHT, other: '#a3a8b4',
  },
};

/** stable colour per company code (sorted codes → fixed slot order; beyond the palette → "Other" grey) */
export const colorMap = (codes: string[], t: Theme) => {
  const m = new Map<string, string>();
  [...codes].sort().forEach((c, i) => m.set(c, i < t.series.length ? t.series[i] : t.other));
  return m;
};

export const surfaceStyle = (t: Theme, extra?: React.CSSProperties): React.CSSProperties => ({
  background: t.surface, border: `1px solid ${t.line}`, borderRadius: t.radius, boxShadow: t.shadow,
  ...(t.blur ? { backdropFilter: t.blur, WebkitBackdropFilter: t.blur } : {}), ...extra,
});

// ── Donut: market value by company (part-to-whole; ≤ 8 slices + Other) ───────────────────────────
export interface Slice { key: string; label: string; value: number; color: string }
export const Donut: React.FC<{ slices: Slice[]; t: Theme; centerTop: string; centerValue: string; onPick?: (key: string) => void }> =
  ({ slices, t, centerTop, centerValue, onPick }) => {
    const total = slices.reduce((s, x) => s + Math.max(x.value, 0), 0);
    const R = 80; const W = 26; const C = 2 * Math.PI * R;
    let acc = 0;
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 22, flexWrap: 'wrap' }}>
        <svg width={200} height={200} viewBox="0 0 200 200" role="img" aria-label="Allocation by company">
          <circle cx={100} cy={100} r={R} fill="none" stroke={t.dark ? '#1b2540' : '#eef0f5'} strokeWidth={W} />
          {total > 0 && slices.filter(s => s.value > 0).map(s => {
            const len = (s.value / total) * C;
            const gap = slices.length > 1 ? Math.min(2, len / 2) : 0;     // 2px surface gap between fills
            const el = (
              <Tooltip key={s.key} title={`${s.label}: AED ${fmtShort(s.value)} · ${((s.value / total) * 100).toFixed(1)}%`}>
                <circle cx={100} cy={100} r={R} fill="none" stroke={s.color} strokeWidth={W}
                  strokeDasharray={`${Math.max(len - gap, 0.5)} ${C}`} strokeDashoffset={-acc}
                  transform="rotate(-90 100 100)" style={{ cursor: onPick && s.key !== '__other' ? 'pointer' : 'default', transition: 'stroke-width .15s' }}
                  onClick={() => onPick && s.key !== '__other' && onPick(s.key)}
                  onMouseEnter={e => e.currentTarget.setAttribute('stroke-width', String(W + 6))}
                  onMouseLeave={e => e.currentTarget.setAttribute('stroke-width', String(W))} />
              </Tooltip>
            );
            acc += len;
            return el;
          })}
          <text x={100} y={92} textAnchor="middle" style={{ fontSize: 11, fill: t.muted, letterSpacing: 0.5 }}>{centerTop}</text>
          <text x={100} y={116} textAnchor="middle" style={{ fontSize: 20, fontWeight: 700, fill: t.ink }}>{centerValue}</text>
        </svg>
        <div style={{ flex: 1, minWidth: 180, display: 'grid', gap: 8 }}>
          {slices.map(s => (
            <div key={s.key} onClick={() => onPick && s.key !== '__other' && onPick(s.key)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: onPick && s.key !== '__other' ? 'pointer' : 'default' }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color, flex: 'none' }} />
              <span style={{ flex: 1, color: t.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</span>
              <span style={{ color: t.muted, fontVariantNumeric: 'tabular-nums' }}>{total ? ((s.value / total) * 100).toFixed(1) : '0.0'}%</span>
              <span style={{ color: t.ink, fontWeight: 600, fontVariantNumeric: 'tabular-nums', minWidth: 70, textAlign: 'right' }}>{fmtShort(s.value)}</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

// ── Top movers: return % since purchase, diverging bars around zero (sign + arrow carry polarity) ──
export interface Mover { key: string; label: string; sub: string; ret: number; gainText: string; company: string }
export const Movers: React.FC<{ movers: Mover[]; t: Theme; onPick?: (company: string) => void }> = ({ movers, t, onPick }) => {
  // one extreme return (e.g. +8,000,000% on a near-zero cost) must not flatten every other bar:
  // scale to the runner-up and draw the outlier full-width with a break mark
  const mags = movers.map(m => Math.abs(m.ret)).sort((x, y) => y - x);
  const max = Math.max(1, mags.length > 1 && mags[0] > mags[1] * 3 ? mags[1] * 1.25 : mags[0] || 1);
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {movers.map(m => {
        const capped = Math.abs(m.ret) > max;
        const w = Math.min(Math.abs(m.ret) / max, 1) * 50;
        const up = m.ret >= 0;
        const col = up ? t.pos : t.neg;
        return (
          <Tooltip key={m.key} title={`${m.label} (${m.sub}) · ${m.gainText} · ${fmtPct(m.ret)}`}>
            <div onClick={() => onPick?.(m.company)} style={{ display: 'grid', gridTemplateColumns: 'minmax(110px, 1.1fr) 2fr 74px', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '3px 0' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: t.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.label}</div>
                <div style={{ fontSize: 10, color: t.faint }}>{m.sub}</div>
              </div>
              <div style={{ position: 'relative', height: 14 }}>
                <div style={{ position: 'absolute', left: '50%', top: -2, bottom: -2, width: 1, background: t.line }} />
                <div style={{ position: 'absolute', top: 2, height: 10, borderRadius: up ? '0 4px 4px 0' : '4px 0 0 4px', background: col,
                  left: up ? '50%' : `${50 - w}%`, width: `${Math.max(w, 0.6)}%` }} />
                {capped && <div title="Off scale" style={{ position: 'absolute', top: 0, height: 14, width: 6, background: t.dark ? '#121a2e' : '#fff', transform: 'skewX(-20deg)',
                  left: up ? 'calc(50% + 40%)' : 'calc(10% - 6px)' }} />}
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: col, textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                {up ? <CaretUpFilled /> : <CaretDownFilled />} {fmtPct(m.ret)}
              </div>
            </div>
          </Tooltip>
        );
      })}
    </div>
  );
};
