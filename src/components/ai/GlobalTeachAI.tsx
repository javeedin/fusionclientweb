import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Select, Typography, message } from 'antd';
import { getFilteredMenuItems } from '../../data/menuItems';
import { getCapturedCalls, type CapturedCall } from './apiCapture';
import { TeachAIModal } from './TeachAIButton';
import type { TrainingRecipe } from './aiTraining';

const { Text } = Typography;

const MODULE_BY_SEGMENT: Record<string, string> = {
  gl: 'GL', glaccountslist: 'GL', accountanalysis: 'GL', currencies: 'GL', ledgers: 'GL',
  ap: 'AP', suppliers: 'AP',
  ar: 'AR',
  cash: 'CASH', banks: 'CASH',
  fa: 'FA',
  pc: 'PC',
  procurement: 'PROC',
  rm: 'RM', pms: 'PMS',
};

const prettify = (name: string): string =>
  name.replace(/^p_/, '').replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, c => c.toUpperCase()).trim();

const pageLabelFor = (route: string): string | undefined => {
  const items = getFilteredMenuItems()
    .filter(m => route === m.path || route.startsWith(m.path + '/'))
    .sort((a, b) => b.path.length - a.path.length);
  return items[0]?.label;
};

function recipeFromCall(c: CapturedCall, user: string): TrainingRecipe {
  const seg = c.path.split('/')[1] || '';
  const page = pageLabelFor(c.route);
  const endpointName = prettify(c.path.split('/').filter(Boolean).slice(-1)[0] || 'data');
  return {
    recipeName: page ? `Search ${page}` : `${c.method} ${endpointName}`,
    description: page
      ? `Search / list data from the ${page} page (${c.path}).`
      : `Call ${c.method} ${c.path} as captured from the app.`,
    module: MODULE_BY_SEGMENT[seg] || 'OTHER',
    method: c.method,
    urlTemplate: c.path,
    params: Object.keys(c.params).map(name => ({ name, label: prettify(name), required: false })),
    example: c.params,
    appPath: c.route,
    createdBy: user,
  };
}

/**
 * Global "Teach AI" — works on every page with no per-page wiring: a fetch
 * interceptor records the APEX calls the current page makes, and the top
 * toolbar's Teach AI icon (via the reerp-ai:teach event) lets the user pick
 * the search they just ran and teach it to the AI Assistant as a recipe.
 */
const GlobalTeachAI: React.FC<{ userName: string }> = ({ userName }) => {
  const [open, setOpen] = useState(false);
  const [calls, setCalls] = useState<CapturedCall[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);

  const start = useCallback(() => {
    const captured = getCapturedCalls();
    if (!captured.length) {
      message.info('No API calls captured yet on this page — run a search first, then press Teach AI.');
      return;
    }
    // default to the most recent call that actually had parameters (a search),
    // falling back to the most recent call overall
    const idx = Math.max(0, captured.findIndex(c => Object.keys(c.params).length > 0));
    setCalls(captured);
    setSelectedIdx(idx);
    setOpen(true);
  }, []);

  // triggered from the top toolbar's Teach AI icon
  useEffect(() => {
    window.addEventListener('reerp-ai:teach', start);
    return () => window.removeEventListener('reerp-ai:teach', start);
  }, [start]);

  const initial = useMemo(
    () => (calls[selectedIdx] ? recipeFromCall(calls[selectedIdx], userName) : null),
    [calls, selectedIdx, userName],
  );

  const picker = calls.length > 0 && (
    <div style={{ marginBottom: 12 }}>
      <Text strong style={{ fontSize: 12 }}>Which call do you want to teach? (recent calls from this page)</Text>
      <Select
        style={{ width: '100%', marginTop: 4 }}
        value={selectedIdx}
        onChange={setSelectedIdx}
        options={calls.map((c, i) => {
          const qs = new URLSearchParams(c.params).toString();
          return {
            value: i,
            label: `${c.method} ${c.path}${qs ? `?${qs.slice(0, 80)}${qs.length > 80 ? '…' : ''}` : ''}`,
          };
        })}
      />
    </div>
  );

  return <TeachAIModal open={open} initial={initial} onClose={() => setOpen(false)} header={picker} />;
};

export default GlobalTeachAI;
