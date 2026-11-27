import { useEffect, useRef, useState } from 'react';
import type { Vec3 } from '../../language/types.ts';
import type { Simulation } from '../../engine/simulation.ts';
import { DEFAULT_VIEW, project, type View } from '../particles/project.ts';
import { VARIABLES } from './core.ts';
import { GAME_OUTPUTS, cubeFaces, effectiveVars, isFrontFacing, itemHue, modelMatrix, shade } from './render.ts';

const W = 400;
const H = 300;
const NAMES = new Set([...VARIABLES.map((v) => v.name), ...GAME_OUTPUTS, 'extend_scale']);

export function Fmbe3D({ sim, label, axesLabel }: { sim: Simulation; label: string; axesLabel: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [view, setView] = useState<View>({ ...DEFAULT_VIEW, yaw: 0.7, pitch: 0.5 });

  const models = sim.world.entities.filter((e) => Object.keys(e.molang).some((k) => NAMES.has(k)));

  useEffect(() => {
    const c = canvas.current;
    const g = c?.getContext('2d');
    if (!c || !g) return;
    g.fillStyle = '#141414';
    g.fillRect(0, 0, W, H);
    const center: Vec3 = models.length
      ? ([0, 1, 2].map((i) => models.reduce((s, e) => s + e.pos[i], 0) / models.length) as Vec3)
      : [0, 0, 0];
    const radius = Math.max(3, ...models.map((e) => Math.hypot(e.pos[0] - center[0], e.pos[1] - center[1], e.pos[2] - center[2]) + 2));
    const proj = (p: Vec3) => project(p, center, view, W, H, radius);

    g.strokeStyle = '#2a2a2a';
    const gy = center[1] - 1;
    for (let i = -4; i <= 4; i++) {
      const segments: [number, number, number, number][] = [[i, -4, i, 4], [-4, i, 4, i]];
      for (const [x1, z1, x2, z2] of segments) {
        const p = proj([center[0] + x1, gy, center[2] + z1]);
        const q = proj([center[0] + x2, gy, center[2] + z2]);
        g.beginPath();
        g.moveTo(p.x, p.y);
        g.lineTo(q.x, q.y);
        g.stroke();
      }
    }

    const axes: [Vec3, string, string][] = [[[1, 0, 0], '#e55', 'x'], [[0, 1, 0], '#5d5', 'y'], [[0, 0, 1], '#69f', 'z']];
    const SEGMENTS = 24;
    const LENGTH = 1.5;
    type Item = { depth: number; draw: () => void };
    const items: Item[] = [];
    for (const [dir, color, name] of axes) {
      for (let k = 0; k < SEGMENTS; k++) {
        const a = proj(center.map((c, i) => c + (dir[i] * LENGTH * k) / SEGMENTS) as Vec3);
        const b = proj(center.map((c, i) => c + (dir[i] * LENGTH * (k + 1)) / SEGMENTS) as Vec3);
        items.push({
          depth: (a.depth + b.depth) / 2,
          draw: () => {
            g.strokeStyle = color;
            g.lineWidth = 2;
            g.beginPath();
            g.moveTo(a.x, a.y);
            g.lineTo(b.x, b.y);
            g.stroke();
            g.lineWidth = 1;
            if (k === SEGMENTS - 1) {
              g.font = '11px sans-serif';
              g.fillStyle = color;
              g.fillText(name, b.x + 3, b.y - 3);
            }
          },
        });
      }
    }
    for (const e of models) {
      const hue = itemHue(e.items['slot.weapon.mainhand:0']?.id ?? e.type);
      for (const f of cubeFaces(modelMatrix(effectiveVars(e.molang)), e.pos)) {
        if (!isFrontFacing(f.normal, view)) continue;
        const pts = f.corners.map(proj);
        items.push({
          depth: pts.reduce((s, p) => s + p.depth, 0) / pts.length,
          draw: () => {
            g.beginPath();
            pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
            g.closePath();
            g.fillStyle = `hsl(${hue} 55% ${Math.round(shade(f.normal) * 60)}%)`;
            g.fill();
            g.strokeStyle = '#000';
            g.stroke();
          },
        });
      }
    }
    items.sort((p, q) => q.depth - p.depth).forEach((it) => it.draw());  });

  return (
    <div>
      <canvas
        ref={canvas}
        width={W}
        height={H}
        className="pcanvas"
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          drag.current = { x: e.clientX, y: e.clientY };
          setView((v) => ({ ...v, yaw: v.yaw + (e.clientX - d.x) * 0.01, pitch: Math.max(-1.5, Math.min(1.5, v.pitch - (e.clientY - d.y) * 0.01)) }));
        }}
        onPointerUp={() => (drag.current = null)}
        onWheel={(e) => setView((v) => ({ ...v, zoom: Math.min(20, Math.max(0.2, v.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1))) }))}
      />
      <div className="muted">{models.length === 0 ? label : axesLabel}</div>
    </div>
  );
}