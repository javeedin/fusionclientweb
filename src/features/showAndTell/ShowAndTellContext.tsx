import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

export interface TourStep {
  id: string;
  note: string;
  fillLabel?: string;
  noteColor?: 'yellow' | 'blue' | 'green' | 'pink';
  noteRotation?: number;
  targetId?: string;
  placement?: 'top' | 'bottom' | 'left' | 'right';
  /** CSS selector auto-clicked when this step activates — opens dropdowns, modals, etc. */
  autoClick?: string;
  action?: (ctx: { navigate: ReturnType<typeof useNavigate> }) => Promise<void>;
  autoNextMs?: number;
}

export interface Tour {
  id: string;
  title: string;
  icon: string;
  description: string;
  steps: TourStep[];
}

interface ShowAndTellCtx {
  activeTour: Tour | null;
  stepIndex: number;
  isRunning: boolean;
  startTour: (tour: Tour) => void;
  stopTour: () => void;
  nextStep: () => void;
  prevStep: () => void;
}

const Ctx = createContext<ShowAndTellCtx | null>(null);

export const useShowAndTell = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('useShowAndTell must be inside ShowAndTellProvider');
  return c;
};

export const ShowAndTellProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeTour, setActiveTour] = useState<Tour | null>(null);
  const [stepIndex, setStepIndex]   = useState(0);
  const [isRunning, setIsRunning]   = useState(false);
  const navigate = useNavigate();

  // Refs keep current values accessible inside callbacks without stale closures
  const tourRef  = useRef<Tour | null>(null);
  const indexRef = useRef(0);
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => {
    if (autoTimer.current) { clearTimeout(autoTimer.current); autoTimer.current = null; }
  };

  const execStep = useCallback((tour: Tour, idx: number) => {
    clearTimer();
    const step = tour.steps[idx];
    if (!step) return;
    if (step.action) step.action({ navigate });
    if (step.autoNextMs && step.autoNextMs > 0) {
      autoTimer.current = setTimeout(() => {
        const t = tourRef.current;
        if (!t) return;
        const next = indexRef.current + 1;
        if (next >= t.steps.length) {
          setActiveTour(null); tourRef.current = null;
          setStepIndex(0);    indexRef.current = 0;
          setIsRunning(false);
        } else {
          setStepIndex(next); indexRef.current = next;
          execStep(t, next);
        }
      }, step.autoNextMs);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate]);

  const startTour = useCallback((tour: Tour) => {
    clearTimer();
    tourRef.current  = tour;
    indexRef.current = 0;
    setActiveTour(tour);
    setStepIndex(0);
    setIsRunning(true);
    execStep(tour, 0);
  }, [execStep]);

  const stopTour = useCallback(() => {
    clearTimer();
    tourRef.current  = null;
    indexRef.current = 0;
    setActiveTour(null);
    setStepIndex(0);
    setIsRunning(false);
  }, []);

  const nextStep = useCallback(() => {
    clearTimer();
    const tour = tourRef.current;
    if (!tour) return;
    const next = indexRef.current + 1;
    if (next >= tour.steps.length) {
      setActiveTour(null); tourRef.current = null;
      setStepIndex(0);    indexRef.current = 0;
      setIsRunning(false);
    } else {
      indexRef.current = next;
      setStepIndex(next);
      execStep(tour, next);
    }
  }, [execStep]);

  const prevStep = useCallback(() => {
    clearTimer();
    const prev = Math.max(0, indexRef.current - 1);
    indexRef.current = prev;
    setStepIndex(prev);
  }, []);

  return (
    <Ctx.Provider value={{ activeTour, stepIndex, isRunning, startTour, stopTour, nextStep, prevStep }}>
      {children}
    </Ctx.Provider>
  );
};
