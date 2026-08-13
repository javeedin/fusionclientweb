import { useEffect, useMemo, useState } from 'react';
import { validateAccountCode } from '../components/AccountSelector';

/**
 * Resolve GL account-combination → natural-account description for a set of codes.
 * Reuses AccountSelector.validateAccountCode (segments + value sets are cached
 * module-level, so repeated lookups are cheap). Returns a { code: description }
 * map that fills in asynchronously as codes resolve.
 */
export function useAccountDescriptions(codes: (string | null | undefined)[]): Record<string, string> {
  const [descs, setDescs] = useState<Record<string, string>>({});

  // Stable key from the unique, non-empty codes so the effect only re-runs when
  // the actual set of codes changes.
  const key = useMemo(
    () => Array.from(new Set(codes.filter(Boolean) as string[])).sort().join('|'),
    [codes],
  );

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const unique = key.split('|');
    (async () => {
      const entries = await Promise.all(unique.map(async (code) => {
        try {
          const result = await validateAccountCode(code);
          const details = Object.values(result.segmentDetails);
          // Prefer the natural-account segment's description; else the first non-empty one.
          const naturalValue = details.find(s =>
            s.name?.toLowerCase().includes('natural') || s.name?.toLowerCase().includes('account'))?.value || '';
          const desc = (naturalValue
            ? details.find(s => s.value === naturalValue)?.description
            : details.find(s => s.description)?.description) || '';
          return [code, desc] as const;
        } catch {
          return [code, ''] as const;
        }
      }));
      if (!cancelled) setDescs(Object.fromEntries(entries));
    })();
    return () => { cancelled = true; };
  }, [key]);

  return descs;
}
