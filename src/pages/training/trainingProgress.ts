// Training — what each user has read, kept in this browser (per user), and where they stopped.
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { ManualChapter, LearningPath } from './manualCatalog';

export interface TrainingProgress {
  done: Record<string, string>;                              // section id → ISO date read
  last?: { chapterId: string; slug?: string; at: string };   // where the user stopped
}

const EVENT = 'rr:training-progress';
const keyFor = (user?: string) => `rr.training.v1.${(user || 'anonymous').toLowerCase()}`;

const read = (key: string): TrainingProgress => {
  try {
    const v = JSON.parse(localStorage.getItem(key) || 'null');
    if (v && typeof v === 'object' && v.done) return v;
  } catch { /* private window or bad data */ }
  return { done: {} };
};

const write = (key: string, p: TrainingProgress) => {
  try { localStorage.setItem(key, JSON.stringify(p)); } catch { /* storage unavailable: progress lives for this session only */ }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: key }));
};

export const useTrainingProgress = () => {
  const { user } = useAuth();
  const key = keyFor(user?.email || user?.username);
  const [progress, setProgress] = useState<TrainingProgress>(() => read(key));

  useEffect(() => {
    setProgress(read(key));
    const sync = (e: Event) => { if ((e as CustomEvent).detail === key) setProgress(read(key)); };
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, [key]);

  const update = useCallback((fn: (p: TrainingProgress) => TrainingProgress) => {
    const cur = read(key);
    const next = fn(cur);
    if (next === cur) return;
    setProgress(next);
    write(key, next);
  }, [key]);

  const setDone = useCallback((sectionId: string, done: boolean) => update(p => {
    const d = { ...p.done };
    if (done) d[sectionId] = new Date().toISOString(); else delete d[sectionId];
    return { ...p, done: d };
  }), [update]);

  const setLast = useCallback((chapterId: string, slug?: string) => update(p => (
    p.last?.chapterId === chapterId && p.last?.slug === slug ? p : { ...p, last: { chapterId, slug, at: new Date().toISOString() } }
  )), [update]);

  const reset = useCallback(() => update(() => ({ done: {} })), [update]);

  const chapterDone = (c: ManualChapter) => c.sections.filter(s => progress.done[s.id]).length;
  const pathDone = (p: LearningPath) => p.steps.filter(id => progress.done[id]).length;
  const isDone = (sectionId: string) => !!progress.done[sectionId];

  return { progress, setDone, setLast, reset, chapterDone, pathDone, isDone };
};
