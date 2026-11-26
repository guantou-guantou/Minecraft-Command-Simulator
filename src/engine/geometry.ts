import type { Vec3 } from '../language/types.ts';

const RAD = Math.PI / 180;
const clean = (n: number) => Math.round(n * 1e9) / 1e9;

export const wrapYaw = (y: number) => ((((y + 180) % 360) + 360) % 360) - 180;
export const clampPitch = (p: number) => Math.max(-90, Math.min(90, p));

export function localPos(pos: Vec3, rot: [number, number], [left, up, forward]: Vec3): Vec3 {
  const [yaw, pitch] = rot;
  const a = Math.cos((yaw + 90) * RAD);
  const b = Math.sin((yaw + 90) * RAD);
  const c = Math.cos(-pitch * RAD);
  const d = Math.sin(-pitch * RAD);
  const e = Math.cos((-pitch + 90) * RAD);
  const f = Math.sin((-pitch + 90) * RAD);
  const fw: Vec3 = [a * c, d, b * c];
  const upv: Vec3 = [a * e, f, b * e];
  const lf: Vec3 = [
    -(fw[1] * upv[2] - fw[2] * upv[1]),
    -(fw[2] * upv[0] - fw[0] * upv[2]),
    -(fw[0] * upv[1] - fw[1] * upv[0]),
  ];
  return pos.map((p, k) => clean(p + lf[k] * left + upv[k] * up + fw[k] * forward)) as Vec3;
}
