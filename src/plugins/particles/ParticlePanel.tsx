import { useEffect, useMemo, useRef, useState } from 'react';
import type { Vec3 } from '../../language/types.ts';
import { useT } from '../../ui/I18n.tsx';
import type { PluginContext } from '../host.ts';
import {
  AXIS_VIEWS, DEFAULT_VIEW, MAX_PITCH, clipToDepth, fitAround, fmtCoord, gridLines, idColor, niceStep, particlesFrom, pickParticle, project, pxPerUnit, withinRadius,
  type AxisView, type Particle, type Plane, type View, type Window,
} from './project.ts';

const DRAW_LIMIT = 50000;
const NORMAL = { w: 400, h: 360 };
type Dims = { w: number; h: number };

const WINDOWS: { label: 'part.all' | 'part.now' | 'part.last5' | 'part.last20'; value: Window }[] = [
  { label: 'part.all', value: { kind: 'all' } },
  { label: 'part.now', value: { kind: 'last', ticks: 0 } },
  { label: 'part.last5', value: { kind: 'last', ticks: 5 } },
  { label: 'part.last20', value: { kind: 'last', ticks: 20 } },
];
const VIEW_KEYS: { key: AxisView; label: 'part.v.front' | 'part.v.back' | 'part.v.left' | 'part.v.right' | 'part.v.top' | 'part.v.bottom'; tip: string }[] = [
  { key: 'front', label: 'part.v.front', tip: 'looking along +z, +x to the right, +y up' },
  { key: 'back', label: 'part.v.back', tip: 'looking along -z, -x to the right, +y up' },
  { key: 'left', label: 'part.v.left', tip: 'looking along -x, +z to the right, +y up' },
  { key: 'right', label: 'part.v.right', tip: 'looking along +x, -z to the right, +y up' },
  { key: 'top', label: 'part.v.top', tip: 'looking down, +x to the right, +z up' },
  { key: 'bottom', label: 'part.v.bottom', tip: 'looking up, +x to the right, -z up' },
];

interface Picked {
  id: string;
  pos: Vec3;
  tick: number;
}

/** One particle window: its own camera, time window, grid, optional region filter and picked particle. */
interface ViewTab {
  id: number;
  name: string;
  view: View;
  /** Where the camera looks; null means the middle of the particles. */
  focus: Vec3 | null;
  winIdx: number;
  size: number;
  fixedSize: boolean;
  grid: boolean;
  plane: Plane;
  region: { on: boolean; c: [string, string, string]; r: string };
  jump: [string, string, string];
  picked: Picked | null;
}
interface Saved {
  tabs: ViewTab[];
  active: number;
  next: number;
}

const newTab = (id: number): ViewTab => ({
  id, name: `${id}`, view: DEFAULT_VIEW, focus: null, winIdx: 0, size: 3, fixedSize: false, grid: true, plane: 'xz',
  region: { on: false, c: ['0', '0', '0'], r: '16' }, jump: ['0', '0', '0'], picked: null,
});

const num = (s: string): number | null => (s.trim() !== '' && Number.isFinite(Number(s)) ? Number(s) : null);
const vec = (c: [string, string, string]): Vec3 | null => {
  const v = c.map(num);
  return v.every((x) => x !== null) ? (v as Vec3) : null;
};

export function ParticlePanel({ ctx }: { ctx: PluginContext }) {
  const t = useT();
  const [saved, setSaved] = useState<Saved>(() => (ctx.panelState.get('particles') as Saved | undefined) ?? { tabs: [newTab(1)], active: 1, next: 2 });
  const [maxed, setMaxed] = useState(false);
  const [dims, setDims] = useState<Dims>(NORMAL);
  const [cols, setCols] = useState(1);
  const count = saved.tabs.length;

  useEffect(() => void ctx.panelState.set('particles', saved), [saved, ctx.panelState]);
  useEffect(() => {
    if (!maxed) {
      setDims(NORMAL);
      return setCols(1);
    }
    const fit = () => {
      const iw = window.innerWidth - 24;
      const c = Math.max(1, Math.min(Math.ceil(Math.sqrt(count)), Math.floor(iw / 440)));
      const rows = Math.ceil(count / c);
      setCols(c);
      setDims({ w: Math.max(280, Math.floor((iw - 8 * (c - 1)) / c) - 16), h: Math.max(220, Math.floor((window.innerHeight - 70) / rows) - 250) });
    };
    fit();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setMaxed(false);
    window.addEventListener('resize', fit);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('resize', fit);
      window.removeEventListener('keydown', esc);
    };
  }, [maxed, count]);

  const patchTab = (id: number, p: Partial<ViewTab>) => setSaved((s) => ({ ...s, tabs: s.tabs.map((x) => (x.id === id ? { ...x, ...p } : x)) }));
  const addTab = () => setSaved((s) => ({ ...s, tabs: [...s.tabs, newTab(s.next)], next: s.next + 1 }));
  const closeTab = (id: number) => setSaved((s) => (s.tabs.length === 1 ? s : { ...s, tabs: s.tabs.filter((x) => x.id !== id) }));

  return (
    <div className={maxed ? 'nx pmax' : 'nx'}>
      <div className="ptabs">
        <button title={t('part.addTab')} onClick={addTab}>+ {t('part.addTab')}</button>
        <button style={{ marginLeft: 'auto' }} onClick={() => setMaxed(!maxed)}>{maxed ? t('part.restore') : t('part.maximize')}</button>
      </div>
      <div className="pgrid" style={maxed ? { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` } : undefined}>
        {saved.tabs.map((tab) => (
          <ParticleView key={tab.id} ctx={ctx} tab={tab} dims={dims} onPatch={(p) => patchTab(tab.id, p)} onClose={count > 1 ? () => closeTab(tab.id) : undefined} />
        ))}
      </div>
    </div>
  );
}

/** One particle window: its own camera, time window, grid, optional region filter and picked particle. All windows are shown at once. */
function ParticleView({ ctx, tab, dims, onPatch, onClose }: { ctx: PluginContext; tab: ViewTab; dims: Dims; onPatch: (p: Partial<ViewTab>) => void; onClose?: () => void }) {
  const t = useT();
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; moved: number } | null>(null);
  const hits = useRef<{ p: Particle; q: { x: number; y: number; depth: number } }[]>([]);
  const patch = onPatch;
  const viewRef = useRef(tab.view);
  viewRef.current = tab.view;
  const setView = (f: (v: View) => View) => {
    viewRef.current = f(viewRef.current);
    patch({ view: viewRef.current });
  };
  const { sim } = ctx;
  const regionC = tab.region.on ? vec(tab.region.c) : null;
  const regionR = num(tab.region.r);
  const all = particlesFrom(sim.events, WINDOWS[tab.winIdx].value, sim.tick);
  const particles = regionC && regionR !== null ? all.filter((p) => withinRadius(p.pos, regionC, regionR)) : all;
  const focusKey = tab.focus?.join(',') ?? '';
  const fit = useMemo(() => fitAround(particles.map((p) => p.pos), tab.focus), [particles.length, tab.winIdx, focusKey, tab.region.on, tab.region.c.join(), tab.region.r, tab.id]);
  const legend = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of particles) m.set(p.id, (m.get(p.id) ?? 0) + 1);
    return [...m];
  }, [particles.length, tab.winIdx, tab.region.on, tab.region.c.join(), tab.region.r, tab.id]);

  useEffect(() => {
    const c = canvas.current;
    const g = c?.getContext('2d');
    if (!c || !g) return;
    const { w, h } = dims;
    const { center, radius } = fit;
    const view = tab.view;
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#141414';
    g.fillRect(0, 0, w, h);
    const line = (a: Vec3, b: Vec3, color: string, width = 1) => {
      const seg = clipToDepth(a, b, center, view, radius);
      if (!seg) return;
      const p = project(seg[0], center, view, w, h, radius);
      const q = project(seg[1], center, view, w, h, radius);
      g.strokeStyle = color;
      g.lineWidth = width;
      g.beginPath();
      g.moveTo(p.x, p.y);
      g.lineTo(q.x, q.y);
      g.stroke();
    };
    if (tab.grid) {
      const step = niceStep(pxPerUnit(view, w, h, radius));
      const lines = gridLines(center, step, 20, tab.plane);
      for (const l of lines) line(l.a, l.b, l.origin ? '#6a5a2a' : l.major ? '#3c3c3c' : '#262626');
      g.font = '10px Consolas, monospace';
      g.fillStyle = '#8a8a8a';
      g.textBaseline = 'middle';
      const label = (pos: Vec3, text: string) => {
        const q = project(pos, center, view, w, h, radius);
        if (q.x < 2 || q.y < 2 || q.x > w - 2 || q.y > h - 2 || q.depth <= -Math.max(radius, 1) * 3) return;
        g.fillText(text, q.x + 3, q.y - 6);
      };
      const near = (v: number) => Math.round(v / step) * step;
      const idx = { xz: [0, 2, 1], xy: [0, 1, 2], yz: [2, 1, 0] }[tab.plane];
      for (const l of lines) {
        const a = idx[0];
        const b = idx[1];
        const axisIdx = l.axis === 'x' ? 0 : l.axis === 'y' ? 1 : 2;
        const other = axisIdx === a ? b : a;
        const at: Vec3 = [...center];
        at[axisIdx] = l.value;
        at[other] = near(center[other]);
        label(at, fmtCoord(l.value));
      }
    }
    const axis = (to: Vec3, color: string) => line(center, [center[0] + to[0] * radius, center[1] + to[1] * radius, center[2] + to[2] * radius], color, 1.5);
    axis([1, 0, 0], '#a44');
    axis([0, 1, 0], '#4a4');
    axis([0, 0, 1], '#46c');
    const step = Math.max(1, Math.ceil(particles.length / DRAW_LIMIT));
    const projected = particles
      .filter((_, i) => i % step === 0)
      .map((p) => ({ p, q: project(p.pos, center, view, w, h, radius) }))
      .sort((a, b) => b.q.depth - a.q.depth);
    hits.current = projected;
    for (const { p, q } of projected) {
      g.fillStyle = idColor(p.id);
      g.beginPath();
      const r = (tab.fixedSize ? tab.size : tab.size * q.scale) * (projected.length > 2000 ? 0.5 : 1);
      g.arc(q.x, q.y, Math.max(0.8, r), 0, Math.PI * 2);
      g.fill();
    }
    if (tab.picked) {
      const q = project(tab.picked.pos, center, view, w, h, radius);
      g.strokeStyle = '#fff';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(q.x, q.y, 9, 0, Math.PI * 2);
      g.moveTo(q.x - 14, q.y);
      g.lineTo(q.x - 5, q.y);
      g.moveTo(q.x + 5, q.y);
      g.lineTo(q.x + 14, q.y);
      g.stroke();
      const text = `${fmtCoord(tab.picked.pos[0])}, ${fmtCoord(tab.picked.pos[1])}, ${fmtCoord(tab.picked.pos[2])}`;
      g.font = '12px Consolas, monospace';
      g.textBaseline = 'alphabetic';
      const tw = g.measureText(text).width;
      const bx = Math.min(w - tw - 8, Math.max(2, q.x + 12));
      const by = Math.min(h - 6, Math.max(16, q.y - 12));
      g.fillStyle = 'rgba(0,0,0,0.75)';
      g.fillRect(bx - 3, by - 13, tw + 6, 17);
      g.fillStyle = '#fff';
      g.fillText(text, bx, by);
    }
  });

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setView((v) => ({ ...v, zoom: Math.min(200, Math.max(0.05, v.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1))) }));
    };
    c.addEventListener('wheel', onWheel, { passive: false });
    return () => c.removeEventListener('wheel', onWheel);
  }, [tab.id]);

  const jumpTo = () => {
    const v = vec(tab.jump);
    if (v) patch({ focus: v });
  };
  const filterHere = () => patch({ region: { on: true, c: (tab.focus ?? fit.center).map((n) => fmtCoord(n)) as [string, string, string], r: tab.region.r }, focus: tab.focus ?? fit.center });

  return (
    <div className="pcard">
      <div className="pcardhead">
        <b>{t('part.tab', { n: tab.name })}</b>
        {onClose && <span className="ptabx" title={t('part.closeTab')} onClick={onClose}>×</span>}
      </div>
      <div className="nxrow">
        <select value={tab.winIdx} onChange={(e) => patch({ winIdx: Number(e.target.value) })}>
          {WINDOWS.map((w, i) => <option key={w.label} value={i}>{t(w.label)}</option>)}
        </select>
        <label>{t('part.size')} <input type="range" min={1} max={8} value={tab.size} onChange={(e) => patch({ size: Number(e.target.value) })} /></label>
        <label><input type="checkbox" checked={tab.fixedSize} onChange={(e) => patch({ fixedSize: e.target.checked })} /> {t('part.fixedSize')}</label>
        <label><input type="checkbox" checked={tab.grid} onChange={(e) => patch({ grid: e.target.checked })} /> {t('part.grid')}</label>
        <select value={tab.plane} title={t('part.plane')} onChange={(e) => patch({ plane: e.target.value as Plane })}>
          <option value="xz">XZ</option>
          <option value="xy">XY</option>
          <option value="yz">YZ</option>
        </select>
        <button onClick={() => patch({ view: DEFAULT_VIEW, focus: null })}>{t('part.reset')}</button>
      </div>
      <div className="nxrow">
        {VIEW_KEYS.map((v) => (
          <button key={v.key} title={v.tip} onClick={() => patch({ view: { ...tab.view, ...AXIS_VIEWS[v.key], pitch: Math.max(-MAX_PITCH, Math.min(MAX_PITCH, AXIS_VIEWS[v.key].pitch)) } })}>{t(v.label)}</button>
        ))}
        <button onClick={() => patch({ focus: null, view: { ...tab.view, zoom: 1 } })}>{t('part.fitAll')}</button>
        <button disabled={!tab.picked} onClick={() => tab.picked && patch({ focus: tab.picked.pos })}>{t('part.fitPicked')}</button>
      </div>
      <div className="nxrow">
        {t('part.jump')}
        {[0, 1, 2].map((i) => (
          <input
            key={i} style={{ width: 62 }} value={tab.jump[i]} placeholder={['x', 'y', 'z'][i]}
            onChange={(e) => patch({ jump: tab.jump.map((v, k) => (k === i ? e.target.value : v)) as [string, string, string] })}
            onKeyDown={(e) => e.key === 'Enter' && jumpTo()}
          />
        ))}
        <button disabled={!vec(tab.jump)} onClick={jumpTo}>{t('part.go')}</button>
        {tab.focus && <span className="muted">{t('part.focus', { pos: tab.focus.map(fmtCoord).join(', ') })}</span>}
      </div>
      <div className="nxrow">
        <label><input type="checkbox" checked={tab.region.on} onChange={(e) => patch({ region: { ...tab.region, on: e.target.checked } })} /> {t('part.region')}</label>
        {[0, 1, 2].map((i) => (
          <input
            key={i} style={{ width: 62 }} value={tab.region.c[i]} placeholder={['x', 'y', 'z'][i]}
            onChange={(e) => patch({ region: { ...tab.region, c: tab.region.c.map((v, k) => (k === i ? e.target.value : v)) as [string, string, string] } })}
          />
        ))}
        <label>{t('part.radius')} <input style={{ width: 52 }} value={tab.region.r} onChange={(e) => patch({ region: { ...tab.region, r: e.target.value } })} /></label>
        <button onClick={filterHere}>{t('part.filterHere')}</button>
      </div>
      <canvas
        ref={canvas}
        width={dims.w}
        height={dims.h}
        className="pcanvas"
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY, moved: 0 };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          d.moved += Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y);
          const dx = e.clientX - d.x;
          const dy = e.clientY - d.y;
          d.x = e.clientX;
          d.y = e.clientY;
          setView((v) => ({ ...v, yaw: v.yaw + dx * 0.01, pitch: Math.max(-MAX_PITCH, Math.min(MAX_PITCH, v.pitch - dy * 0.01)) }));
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          if (!d || d.moved >= 4) return;
          const r = e.currentTarget.getBoundingClientRect();
          const hit = pickParticle(hits.current, ((e.clientX - r.left) * dims.w) / r.width, ((e.clientY - r.top) * dims.h) / r.height, 10);
          patch({ picked: hit ? { id: hit.p.id, pos: hit.p.pos, tick: hit.p.tick } : null });
        }}
      />
      <div className="muted">{t('part.info', { n: particles.length, tick: sim.tick })}</div>
      {tab.picked && (
        <div className="nxrow">
          <span className="swatch" style={{ background: idColor(tab.picked.id) }} />
          <b>{tab.picked.pos.map(fmtCoord).join(', ')}</b>
          <span className="muted">{t('part.picked', { id: tab.picked.id, tick: tab.picked.tick })}</span>
        </div>
      )}
      {particles.length === 0 && <div className="muted">{t('part.empty')}</div>}
      {legend.map(([id, n]) => (
        <div key={id} className="nxrow">
          <span className="swatch" style={{ background: idColor(id) }} />
          <span>{id}</span>
          <span className="muted">{n}</span>
        </div>
      ))}
    </div>
  );
}