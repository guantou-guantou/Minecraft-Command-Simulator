export const DEFAULT_TPS = 20;
export const MIN_TPS = 1;
export const MAX_TPS = 1000;
const KEY = 'mcsim:tps';

/** A usable ticks-per-second value: a whole number between 1 and 1000, 20 when the input makes no sense. */
export function sanitizeTps(v: unknown): number {
  const n = typeof v === 'string' ? (v.trim() === '' ? NaN : Number(v.trim())) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? Math.max(MIN_TPS, Math.min(MAX_TPS, Math.round(n))) : DEFAULT_TPS;
}

export function loadTps(): number {
  try {
    return sanitizeTps(localStorage.getItem(KEY) ?? DEFAULT_TPS);
  } catch {
    return DEFAULT_TPS;
  }
}

export function saveTps(tps: number): void {
  try {
    localStorage.setItem(KEY, String(tps));
  } catch {
    /* the setting is only a convenience */
  }
}

/** How many whole ticks are due after `elapsedMs` at `tps`, carrying the fraction over (`carry`) so slow rates stay exact. */
export function ticksDue(carry: number, tps: number, elapsedMs: number, maxPerStep = 500): { ticks: number; carry: number } {
  const total = carry + (tps * elapsedMs) / 1000;
  const whole = Math.floor(total);
  const ticks = Math.min(whole, maxPerStep);
  return { ticks, carry: whole > maxPerStep ? 0 : total - whole };
}