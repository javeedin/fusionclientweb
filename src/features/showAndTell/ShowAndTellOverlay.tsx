import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import { Button, Space } from 'antd';
import { useShowAndTell } from './ShowAndTellContext';

const COLORS = {
  yellow: { bg: '#fffde7', border: '#f9a825', tape: 'rgba(255,245,100,0.7)', text: '#1a1a1a' },
  blue:   { bg: '#e3f2fd', border: '#1976d2', tape: 'rgba(100,180,255,0.5)', text: '#0d2a4a' },
  green:  { bg: '#f1f8e9', border: '#558b2f', tape: 'rgba(120,220,120,0.5)', text: '#1a3a0a' },
  pink:   { bg: '#fce4ec', border: '#c2185b', tape: 'rgba(255,100,160,0.4)', text: '#3a0a1a' },
};

export const ShowAndTellOverlay: React.FC = () => {
  const { activeTour, stepIndex, isRunning, nextStep, prevStep, stopTour } = useShowAndTell();
  const [targetRect, setTarget] = useState<DOMRect | null>(null);

  const step       = activeTour?.steps[stepIndex];
  const colors     = COLORS[step?.noteColor ?? 'yellow'];
  const rotation   = step?.noteRotation ?? (stepIndex % 2 === 0 ? -1.5 : 1.5);
  const totalSteps = activeTour?.steps.length ?? 0;

  // Auto-click (open dropdown / modal) when step activates
  useEffect(() => {
    if (!step?.autoClick) return;
    const t = setTimeout(() => {
      const el = document.querySelector(step.autoClick!) as HTMLElement | null;
      el?.click();
    }, 350); // small delay so the element is fully rendered
    return () => clearTimeout(t);
  }, [step?.autoClick, stepIndex]);

  // Track the highlighted target element
  useEffect(() => {
    if (!step?.targetId) { setTarget(null); return; }

    const locate = () => {
      const el = document.querySelector(`[data-sat-id="${step.targetId}"]`);
      if (!el) return false;
      setTarget(el.getBoundingClientRect());
      return true;
    };

    if (!locate()) {
      let attempts = 0;
      const iv = setInterval(() => { if (locate() || ++attempts > 20) clearInterval(iv); }, 250);
      return () => clearInterval(iv);
    }
  }, [step?.targetId, stepIndex]);

  // Keep highlight ring in sync on scroll / resize
  useEffect(() => {
    if (!step?.targetId) return;
    const refresh = () => {
      const el = document.querySelector(`[data-sat-id="${step.targetId}"]`);
      if (el) setTarget(el.getBoundingClientRect());
    };
    window.addEventListener('scroll', refresh, true);
    window.addEventListener('resize', refresh);
    return () => {
      window.removeEventListener('scroll', refresh, true);
      window.removeEventListener('resize', refresh);
    };
  }, [step?.targetId]);

  if (!isRunning || !activeTour || !step) return null;

  const overlay = (
    <>
      {/* Subtle backdrop when a target is highlighted */}
      {targetRect && (
        <div style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.12)',
          pointerEvents: 'none',
          zIndex: 9990,
        }} />
      )}

      {/* Pulsing highlight ring around the target element */}
      {targetRect && (
        <div style={{
          position:      'fixed',
          top:           targetRect.top    - 5,
          left:          targetRect.left   - 5,
          width:         targetRect.width  + 10,
          height:        targetRect.height + 10,
          border:        `2px solid ${colors.border}`,
          borderRadius:  8,
          boxShadow:     `0 0 0 4px ${colors.border}44, 0 0 16px ${colors.border}66`,
          pointerEvents: 'none',
          zIndex:        9991,
          animation:     'sat-pulse 1.8s ease-in-out infinite',
        }} />
      )}

      {/* Sticky Note — fixed bottom-right, never overlaps content */}
      <div style={{
        position:  'fixed',
        bottom:    24,
        right:     24,
        zIndex:    9999,
        width:     300,
        transform: `rotate(${rotation}deg)`,
        filter:    `drop-shadow(3px 5px 14px ${colors.border}66)`,
      }}>
        <div style={{
          background:   colors.bg,
          border:       `1px solid ${colors.border}`,
          borderRadius: 4,
          padding:      '18px 16px 14px',
          position:     'relative',
          fontFamily:   "'Segoe UI', system-ui, sans-serif",
        }}>
          {/* Tape strip */}
          <div style={{
            position:     'absolute',
            top:          -10,
            left:         '50%',
            transform:    'translateX(-50%)',
            width:        48,
            height:       18,
            background:   colors.tape,
            borderRadius: 2,
            border:       `1px solid ${colors.border}33`,
          }} />

          {/* Tour name + step counter */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: colors.border, textTransform: 'uppercase', letterSpacing: 0.6 }}>
              {activeTour.icon} {activeTour.title}
            </span>
            <span style={{ fontSize: 10, color: '#888' }}>
              {stepIndex + 1} / {totalSteps}
            </span>
          </div>

          {/* Progress bar */}
          <div style={{ height: 3, background: '#e0e0e0', borderRadius: 2, marginBottom: 10 }}>
            <div style={{
              height: '100%',
              width: `${((stepIndex + 1) / totalSteps) * 100}%`,
              background: colors.border,
              borderRadius: 2,
              transition: 'width 0.3s',
            }} />
          </div>

          {/* Note text */}
          <div style={{
            fontSize:     13,
            color:        colors.text,
            lineHeight:   1.6,
            whiteSpace:   'pre-line',
            marginBottom: step.fillLabel ? 10 : 14,
          }}>
            {step.note}
          </div>

          {/* Fill label pill */}
          {step.fillLabel && (
            <div style={{
              background:   `${colors.border}18`,
              border:       `1px solid ${colors.border}44`,
              borderRadius: 4,
              padding:      '4px 8px',
              fontSize:     11,
              fontFamily:   'monospace',
              color:        colors.border,
              marginBottom: 12,
            }}>
              ✏️ {step.fillLabel}
            </div>
          )}

          {/* Controls */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Button size="small" type="text" onClick={stopTour}
              style={{ fontSize: 11, color: '#999', padding: '0 4px', height: 22 }}>
              ✕ Exit
            </Button>
            <Space size={6}>
              {stepIndex > 0 && (
                <Button size="small" onClick={prevStep} style={{ fontSize: 11 }}>← Back</Button>
              )}
              <Button size="small" type="primary" onClick={nextStep}
                style={{ fontSize: 11, background: colors.border, borderColor: colors.border }}>
                {stepIndex === totalSteps - 1 ? 'Finish ✓' : 'Next →'}
              </Button>
            </Space>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes sat-pulse {
          0%,100% { box-shadow: 0 0 0 4px ${colors.border}44, 0 0 16px ${colors.border}66; }
          50%      { box-shadow: 0 0 0 8px ${colors.border}22, 0 0 24px ${colors.border}44; }
        }
      `}</style>
    </>
  );

  return ReactDOM.createPortal(overlay, document.body);
};
