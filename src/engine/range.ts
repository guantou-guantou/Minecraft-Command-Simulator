import { CommandError } from './types.ts';

export function inRange(value: number, range: string): boolean {
  const m = /^(!)?(-?\d+)?(\.\.)?(-?\d+)?$/.exec(range);
  if (!m || (m[2] === undefined && m[4] === undefined)) throw new CommandError('syntax_error', `Invalid range "${range}"`);
  const [lo, hi] = m[3] ? [m[2], m[4]] : [m[2], m[2]];
  const ok = (lo === undefined || value >= Number(lo)) && (hi === undefined || value <= Number(hi));
  return ok !== !!m[1];
}

