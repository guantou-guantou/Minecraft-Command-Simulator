const KEY = 'mcsim:termHistory';
const MAX = 100;

/** What the terminal remembers: the lines sent so far, where the up/down keys are in them (null = not browsing) and the line being typed before browsing started. */
export interface TermHistory {
  items: string[];
  index: number | null;
  draft: string;
}

export const emptyHistory = (items: string[] = []): TermHistory => ({ items, index: null, draft: '' });

/** Remembers a sent line (not twice in a row) and stops browsing. */
export function remember(h: TermHistory, line: string): TermHistory {
  const items = h.items.at(-1) === line ? h.items : [...h.items, line].slice(-MAX);
  return { items, index: null, draft: '' };
}

/** Up key: the previous sent line. `current` is what is in the input now (kept as the draft when browsing starts). */
export function older(h: TermHistory, current: string): { history: TermHistory; text: string } {
  if (!h.items.length) return { history: h, text: current };
  const index = h.index === null ? h.items.length - 1 : Math.max(0, h.index - 1);
  return { history: { items: h.items, index, draft: h.index === null ? current : h.draft }, text: h.items[index] };
}

/** Down key: the next sent line, and after the newest one the line that was being typed. */
export function newer(h: TermHistory, current: string): { history: TermHistory; text: string } {
  if (h.index === null) return { history: h, text: current };
  if (h.index >= h.items.length - 1) return { history: { ...h, index: null }, text: h.draft };
  const index = h.index + 1;
  return { history: { ...h, index }, text: h.items[index] };
}

export function loadHistory(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(-MAX) : [];
  } catch {
    return [];
  }
}

export function saveHistory(items: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    /* the history is only a convenience */
  }
}