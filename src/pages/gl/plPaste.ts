// Parse a pasted list of accounts for the P&L template (Financial Statements → As per TB → Paste accounts).
// Accepts one account per line, comma / space separated lists, Excel rows (tab separated),
// ranges "5229100-5229199" (expanded to the known TB accounts in it) and full code combinations
// "101-1000-000-5229101-000" (the segment that is a known account is taken).
// Any other cell on a line that names a section ("Staff Cost", "Group › Section", section code) sets
// that line's section; other text (descriptions, amounts) is ignored.

export interface PastedAccount { account: string; sectionId?: number }
export interface PasteResult { items: PastedAccount[]; unknown: string[]; emptyRanges: string[] }

const ACCOUNTISH = /^[A-Za-z0-9][A-Za-z0-9._]*$/;
const hasDigit = (x: string) => /\d/.test(x);

export function parsePastedAccounts(
  text: string,
  opts: { knownAccounts: string[]; sectionOf: (name: string) => number | undefined },
): PasteResult {
  const known = new Set(opts.knownAccounts);
  const knownSorted = [...known].sort();
  const order: string[] = [];
  const byAcct = new Map<string, PastedAccount>();
  const unknown: string[] = [];
  const emptyRanges: string[] = [];
  const put = (account: string, sectionId?: number) => {
    const cur = byAcct.get(account);
    if (!cur) { order.push(account); byAcct.set(account, { account, sectionId }); }
    else if (sectionId !== undefined) cur.sectionId = sectionId;
  };

  // one token → accounts (or nothing)
  const accountsOf = (tok: string): string[] | null => {
    const t = tok.trim();
    if (!t) return [];
    const range = t.match(/^([A-Za-z0-9]+)\s*(?:-|–|—|\.\.|to)\s*([A-Za-z0-9]+)$/i);
    if (range && hasDigit(range[1]) && hasDigit(range[2]) && !(known.has(t))) {
      const [a, b] = [range[1], range[2]];
      const num = /^\d+$/.test(a) && /^\d+$/.test(b);
      const inR = knownSorted.filter(k => (num && /^\d+$/.test(k) ? Number(k) >= Number(a) && Number(k) <= Number(b) : k >= a && k <= b));
      if (!inR.length) emptyRanges.push(t);
      return inR;
    }
    if (t.includes('-') && t.split('-').length > 2) {            // full code combination
      const seg = t.split('-').map(x => x.trim()).find(x => known.has(x));
      return seg ? [seg] : null;
    }
    if (ACCOUNTISH.test(t) && hasDigit(t)) return [t];
    return null;
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let cells = line.split(/\t|;|\|/).map(c => c.trim()).filter(Boolean);
    if (cells.length === 1) {
      // "5229101, 5229102" or "5229101 5229102" → several accounts; "5229101 Staff Cost" → account + section text
      const parts = cells[0].split(/\s*,\s*/).filter(Boolean);
      if (parts.length > 1) cells = parts;
      else {
        const ws = cells[0].split(/\s+/);
        if (ws.length > 1 && ws.every(w => accountsOf(w) !== null)) cells = ws;
        else if (ws.length > 1 && accountsOf(ws[0]) !== null && !accountsOf(cells[0])) cells = [ws[0], ws.slice(1).join(' ')];
      }
    }
    const accts: string[] = [];
    let sectionId: number | undefined;
    // a list ("a, b, c") is all accounts; an Excel row (account, description, amounts…) gives its first account only
    const isList = cells.length > 1 && cells.every(c => accountsOf(c) !== null || opts.sectionOf(c) !== undefined);
    for (const c of cells) {
      if (!isList && accts.length && cells.length > 1) {
        const sec = opts.sectionOf(c);
        if (sec !== undefined) sectionId = sec;
        continue;
      }
      const sec = opts.sectionOf(c);
      if (sec !== undefined && !(accts.length === 0 && accountsOf(c))) { sectionId = sec; continue; }
      const a = accountsOf(c);
      if (a) accts.push(...a);
      else if (!accts.length && cells.length === 1) unknown.push(c);   // a lone cell that is neither account nor section
    }
    if (!accts.length && cells.length > 1 && !cells.some(c => accountsOf(c))) unknown.push(line.slice(0, 40));
    accts.forEach(a => put(a, sectionId));
  }
  return { items: order.map(a => byAcct.get(a)!), unknown, emptyRanges };
}
