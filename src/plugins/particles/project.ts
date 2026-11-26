import type { Vec3 } from '../../language/types.ts';
import type { SimEvent } from '../../engine/types.ts';

export interface View {
  yaw: number;
  pitch: number;
  zoom: number;
}

export const DEFAULT_VIEW: View = { yaw: 0.6, pitch: 0.45, zoom: 1 };

export interface Projected {
  x: number;
  y: number;
  depth: number;
  scale: number;
}

/** Perspective projection of a world point; world +y is up on screen. */
export function project(p: Vec3, center: Vec3, view: View, w: number, h: number, radius: number): Projected {
  const dx = p[0] - center[0];
  const dy = p[1] - center[1];
  const dz = p[2] - center[2];
  const cy = Math.cos(view.yaw);
  const sy = Math.sin(view.yaw);
  const x1 = dx * cy - dz * sy;
  const z1 = dx * sy + dz * cy;
  const cp = Math.cos(view.pitch);
  const sp = Math.sin(view.pitch);
  const y2 = dy * cp - z1 * sp;
  const z2 = dy * sp + z1 * cp;
  const cam = Math.max(radius, 1) * 4;
  const base = (0.42 * Math.min(w, h)) / Math.max(radius, 1);
  const s = (base * view.zoom * cam) / (cam + z2);
  return { x: w / 2 + x1 * s, y: h / 2 - y2 * s, depth: z2, scale: s / base };
}

export interface Particle {
  id: string;
  pos: Vec3;
  tick: number;
}

export type Window = { kind: 'all' } | { kind: 'last'; ticks: number };

export function particlesFrom(events: SimEvent[], window: Window, currentTick: number): Particle[] {
  const out: Particle[] = [];
  for (const e of events) {
    if (e.type !== 'effect' || e.kind !== 'particle') continue;
    if (window.kind === 'last' && e.tick < currentTick - window.ticks) continue;
    out.push({ id: e.id, pos: e.pos, tick: e.tick });
  }
  return out;
}

export function bounds(points: Vec3[]): { center: Vec3; radius: number } {
  if (!points.length) return { center: [0, 0, 0], radius: 1 };
  const lo = [0, 1, 2].map((i) => Math.min(...points.map((p) => p[i])));
  const hi = [0, 1, 2].map((i) => Math.max(...points.map((p) => p[i])));
  const center = lo.map((v, i) => (v + hi[i]) / 2) as Vec3;
  const radius = Math.max(1, ...points.map((p) => Math.hypot(p[0] - center[0], p[1] - center[1], p[2] - center[2])));
  return { center, radius };
}

export function idColor(id: string): string {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360} 75% 62%)`;
}

export type Plane = 'xz' | 'xy' | 'yz';

/** Camera presets, like the numpad views of Blender. Screen right and up are given for each. */
export const AXIS_VIEWS = {
  front: { yaw: 0, pitch: 0 },
  back: { yaw: Math.PI, pitch: 0 },
  left: { yaw: -Math.PI / 2, pitch: 0 },
  right: { yaw: Math.PI / 2, pitch: 0 },
  top: { yaw: 0, pitch: -Math.PI / 2 },
  bottom: { yaw: 0, pitch: Math.PI / 2 },
} as const;
export type AxisView = keyof typeof AXIS_VIEWS;
export const MAX_PITCH = Math.PI / 2;

/** Screen pixels per world unit at the centre of the view. */
export const pxPerUnit = (view: View, w: number, h: number, radius: number) => ((0.42 * Math.min(w, h)) / Math.max(radius, 1)) * view.zoom;

/** The smallest "nice" grid step (1, 2, 5, 10, 20, 50, ...) that is at least `minPx` wide on screen. */
export function niceStep(pxPerWorldUnit: number, minPx = 44): number {
  for (let e = -3; e < 9; e++) for (const m of [1, 2, 5]) if (m * 10 ** e * pxPerWorldUnit >= minPx) return m * 10 ** e;
  return 10 ** 9;
}

export interface GridLine {
  a: Vec3;
  b: Vec3;
  /** The world coordinate this line stands at, and which axis it crosses. */
  value: number;
  axis: 'x' | 'y' | 'z';
  /** Lines through the world origin axes are drawn stronger. */
  origin: boolean;
  /** Every tenth line is drawn a little stronger. */
  major: boolean;
}

const AXES: Record<Plane, [number, number, number]> = { xz: [0, 2, 1], xy: [0, 1, 2], yz: [2, 1, 0] };

/** Grid lines of a plane through `focus`, `count` lines each way, aligned to multiples of `step`. */
export function gridLines(focus: Vec3, step: number, count: number, plane: Plane): GridLine[] {
  const [u, v, n] = AXES[plane];
  const E = step * count;
  const name = ['x', 'y', 'z'] as const;
  const out: GridLine[] = [];
  const mk = (along: number, fixed: number, value: number): GridLine => {
    const a: Vec3 = [0, 0, 0];
    const b: Vec3 = [0, 0, 0];
    a[n] = b[n] = focus[n];
    a[fixed] = b[fixed] = value;
    a[along] = focus[along] - E;
    b[along] = focus[along] + E;
    const idx = Math.round(value / step);
    return { a, b, value, axis: name[fixed], origin: Math.abs(value) < 1e-9, major: idx % 10 === 0 };
  };
  const first = (c: number) => Math.ceil((c - E) / step - 1e-9);
  const last = (c: number) => Math.floor((c + E) / step + 1e-9);
  for (let k = first(focus[u]); k <= last(focus[u]); k++) out.push(mk(v, u, Math.round(k * step * 1e9) / 1e9));
  for (let k = first(focus[v]); k <= last(focus[v]); k++) out.push(mk(u, v, Math.round(k * step * 1e9) / 1e9));
  return out;
}

/** Keeps the part of the segment a-b that is in front of the camera (the projection breaks down behind it). */
export function clipToDepth(a: Vec3, b: Vec3, center: Vec3, view: View, radius: number): [Vec3, Vec3] | null {
  const limit = -Math.max(radius, 1) * 4 * 0.8;
  const da = project(a, center, view, 100, 100, radius).depth;
  const db = project(b, center, view, 100, 100, radius).depth;
  if (da <= limit && db <= limit) return null;
  const at = (t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const t = (limit - da) / (db - da);
  if (da <= limit) return [at(t), b];
  if (db <= limit) return [a, at(t)];
  return [a, b];
}

/** The particle closest to a click, within `maxDist` pixels (front-most wins a tie). */
export function pickParticle<T extends { q: { x: number; y: number; depth: number } }>(items: T[], x: number, y: number, maxDist: number): T | null {
  let best: T | null = null;
  let bestD = maxDist;
  for (const it of items) {
    const d = Math.hypot(it.q.x - x, it.q.y - y);
    if (d < bestD - 1e-9 || (best && Math.abs(d - bestD) < 1e-9 && it.q.depth < best.q.depth)) {
      best = it;
      bestD = d;
    }
  }
  return best;
}

export const withinRadius = (p: Vec3, c: Vec3, r: number) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) <= r;

/** Centre and radius for looking at `points`: around `focus` when given, otherwise around their bounding box. */
export function fitAround(points: Vec3[], focus: Vec3 | null): { center: Vec3; radius: number } {
  if (!focus) return bounds(points);
  return { center: focus, radius: Math.max(1, ...points.map((p) => Math.hypot(p[0] - focus[0], p[1] - focus[1], p[2] - focus[2]))) };
}

/** A coordinate for display: at most 3 decimals, no trailing zeros. */
export const fmtCoord = (n: number) => String(Math.round(n * 1000) / 1000);