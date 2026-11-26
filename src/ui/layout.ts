export interface Layout {
  c1: number;
  c2: number;
  term: number;
  drawer: number;
}

export const DEFAULT_LAYOUT: Layout = { c1: 520, c2: 360, term: 220, drawer: 440 };
export const MIN: Layout = { c1: 240, c2: 200, term: 80, drawer: 280 };
export const SPLITTER = 6;
export const MIN_REST = 160;

const KEY = 'mcsim:layout';

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(Math.max(lo, hi), v));

export function sanitize(raw: unknown): Layout {
  const out = { ...DEFAULT_LAYOUT };
  if (raw && typeof raw === 'object') {
    for (const k of Object.keys(out) as (keyof Layout)[]) {
      const v = (raw as Record<string, unknown>)[k];
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.max(MIN[k], v);
    }
  }
  return out;
}

export function loadLayout(): Layout {
  try {
    return sanitize(JSON.parse(localStorage.getItem(KEY) ?? 'null'));
  } catch {
    return { ...DEFAULT_LAYOUT };
  }
}

export function saveLayout(l: Layout): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(l));
  } catch {
    /* layout persistence is optional */
  }
}

/** Largest allowed width of the first column given the container width and the other column. */
export const maxC1 = (total: number, c2: number) => total - c2 - 2 * SPLITTER - MIN_REST;
export const maxC2 = (total: number, c1: number) => total - c1 - 2 * SPLITTER - MIN_REST;