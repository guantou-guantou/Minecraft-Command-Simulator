import type { Vec3 } from '../../language/types.ts';
import type { View } from '../particles/project.ts';

export type Mat = number[];

const DEG = Math.PI / 180;

/** Row-major 4x4 product `l * r`, the same convention as the Basic Edition FMBE simulator. */
export function mulMat(l: Mat, r: Mat): Mat {
  const out: number[] = [];
  for (let i = 0; i < 16; i++) {
    const row = i - (i % 4);
    const col = i % 4;
    out[i] = l[row] * r[col] + l[row + 1] * r[col + 4] + l[row + 2] * r[col + 8] + l[row + 3] * r[col + 12];
  }
  return out;
}

const trans = (x: number, y: number, z: number): Mat => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1];
const scaleM = (x: number, y: number, z: number): Mat => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1];
const rotX = (a: number): Mat => { const c = Math.cos(a * DEG), s = Math.sin(a * DEG); return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1]; };
const rotY = (a: number): Mat => { const c = Math.cos(a * DEG), s = Math.sin(a * DEG); return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]; };
const rotZ = (a: number): Mat => { const c = Math.cos(a * DEG), s = Math.sin(a * DEG); return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; };

export const FMBE_DEFAULTS: Record<string, number> = {
  xpos: 0, ypos: 0, zpos: 0, xrot: 0, yrot: 0, zrot: 0, scale: 1, xzscale: 1, yscale: 1, xbasepos: 0, ybasepos: 0, zbasepos: 0,
};

/**
 * Model matrix of the Basic Edition FMBE, ported from the reference simulator
 * (https://allah-ethan.github.io/Basic-Edition-FMBE-simulator/): base position, then scale, then X, Z and Y rotation,
 * then position. Positions are in 1/16 block; the unit cube is centred on the entity when everything is zero.
 */
export function modelMatrix(vars: Record<string, number | string | null>): Mat {
  const v = (k: string) => (typeof vars[k] === 'number' ? (vars[k] as number) : FMBE_DEFAULTS[k]);
  let m = trans(v('xbasepos') / 16, v('ybasepos') / 16, v('zbasepos') / 16);
  m = mulMat(scaleM(v('scale') * v('xzscale'), v('scale') * v('yscale'), v('scale') * v('xzscale')), m);
  m = mulMat(rotX(v('xrot')), m);
  m = mulMat(rotZ(v('zrot')), m);
  m = mulMat(rotY(v('yrot')), m);
  return mulMat(trans(v('xpos') / 16, v('ypos') / 16, v('zpos') / 16), m);
}

export const transformPoint = (m: Mat, p: Vec3): Vec3 => [
  m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3],
  m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7],
  m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11],
];

export const transformDir = (m: Mat, d: Vec3): Vec3 => [
  m[0] * d[0] + m[1] * d[1] + m[2] * d[2],
  m[4] * d[0] + m[5] * d[1] + m[6] * d[2],
  m[8] * d[0] + m[9] * d[1] + m[10] * d[2],
];

const FACES: { n: Vec3; v: Vec3[] }[] = [
  { n: [1, 0, 0], v: [[0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5], [0.5, -0.5, 0.5]] },
  { n: [-1, 0, 0], v: [[-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5], [-0.5, -0.5, -0.5]] },
  { n: [0, 1, 0], v: [[-0.5, 0.5, -0.5], [-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5]] },
  { n: [0, -1, 0], v: [[-0.5, -0.5, 0.5], [-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5]] },
  { n: [0, 0, 1], v: [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]] },
  { n: [0, 0, -1], v: [[0.5, -0.5, -0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5]] },
];

export interface WorldFace {
  corners: Vec3[];
  normal: Vec3;
}

/** The six faces of the unit cube after the model matrix, moved to `origin` in world space. */
export function cubeFaces(m: Mat, origin: Vec3): WorldFace[] {
  return FACES.map((f) => {
    const normal = transformDir(m, f.n);
    const len = Math.hypot(...normal) || 1;
    return {
      corners: f.v.map((p) => transformPoint(m, p).map((c, i) => c + origin[i]) as Vec3),
      normal: normal.map((c) => c / len) as Vec3,
    };
  });
}

/** Rotates a direction into the camera frame used by the particle viewer: larger z is farther away. */
export function viewDir(d: Vec3, view: View): Vec3 {
  const x1 = d[0] * Math.cos(view.yaw) - d[2] * Math.sin(view.yaw);
  const z1 = d[0] * Math.sin(view.yaw) + d[2] * Math.cos(view.yaw);
  return [x1, d[1] * Math.cos(view.pitch) - z1 * Math.sin(view.pitch), d[1] * Math.sin(view.pitch) + z1 * Math.cos(view.pitch)];
}

export const isFrontFacing = (normal: Vec3, view: View) => viewDir(normal, view)[2] < 0;

const LIGHT: Vec3 = (() => {
  const l: Vec3 = [0.3, 0.8, 0.5];
  const n = Math.hypot(...l);
  return l.map((c) => c / n) as Vec3;
})();

export const shade = (normal: Vec3) => 0.4 + 0.6 * Math.max(0, normal[0] * LIGHT[0] + normal[1] * LIGHT[1] + normal[2] * LIGHT[2]);

export function itemHue(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 360;
}