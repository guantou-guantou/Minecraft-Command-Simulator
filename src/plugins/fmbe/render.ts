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

/**
 * The stretch of the Advanced FMBE: extend_scale along the direction given by extend_xrot and extend_yrot (the unit direction
 * is the up axis turned by those angles, the same column the prerequisite builds as v.F.e1, e4, e7), applied before the rotations.
 * The direction and the amount are worked out from the prerequisite's formulas and were not compared with the game.
 */
export function extensionMatrix(vars: Record<string, number | string | null>): Mat {
  const g = (k: string, d: number) => (typeof vars[k] === 'number' ? (vars[k] as number) : d);
  const ext = g('extend_scale', 1);
  const xr = g('extend_xrot', -90) * DEG;
  const yr = g('extend_yrot', 0) * DEG;
  const e0 = Math.cos(yr);
  const e5 = -Math.sin(xr);
  const d = [e5 * Math.sin(yr), Math.cos(xr), -e5 * e0];
  const k = ext - 1;
  return [1 + k * d[0] * d[0], k * d[0] * d[1], k * d[0] * d[2], 0, k * d[1] * d[0], 1 + k * d[1] * d[1], k * d[1] * d[2], 0, k * d[2] * d[0], k * d[2] * d[1], 1 + k * d[2] * d[2], 0, 0, 0, 0, 1];
}

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
  m = mulMat(extensionMatrix(vars), m);
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

/** The variables the game's own animations read; the prerequisites compute them from the custom ones, so they never change their names. */
export const GAME_OUTPUTS = ['body_x_rot', 'body_z_rot', 'attack_body_rot_y', 'swelling_scale1', 'swelling_scale2', 'head_position_x', 'head_position_y', 'head_position_z', 'wing_flap', 'rail_offset.y', 'dance.x'];

/**
 * The model variables the preview should use. When the game-side outputs of the Basic Edition prerequisite are there, the
 * custom inputs are worked out backwards from them (the prerequisite's own relations: body rotations are the rotations plus 90,
 * the head position is the base position times the scale, and so on), so renaming v.xrot or v.scale in a prerequisite does not matter.
 * Otherwise the custom variables are used as they are.
 */
export function effectiveVars(vars: Record<string, number | string | null>): Record<string, number | string | null> {
  const g = (k: string) => (typeof vars[k] === 'number' ? (vars[k] as number) : null);
  const [bx, bz, ay, s1, s2, hx, hy, hz, wf, ry, dx] = GAME_OUTPUTS.map(g);
  if ([bx, bz, ay, s1, s2, hx, hy, hz, wf, ry, dx].some((v) => v === null) || !s1 || !s2) return vars;
  const q1 = s1! / 2.1385;
  const q2 = s2! / 2.1385;
  return {
    ...vars,
    xrot: bx! - 90, yrot: bz! - 90, zrot: -ay!, xpos: 16 - wf! / 3.3333333, ypos: (ry! - 1.6485) * 16, zpos: -dx!,
    scale: 1, xzscale: q1 * q1, yscale: q2 * q2,
    xbasepos: hx! / (0.433875 * q1), ybasepos: (hy! / q2 - 10.05185375) / 0.467625, zbasepos: (17.108 - hz! / q1) / 0.433875,
  };
}