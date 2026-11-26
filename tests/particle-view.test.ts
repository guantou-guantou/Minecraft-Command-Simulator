import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AXIS_VIEWS, DEFAULT_VIEW, clipToDepth, fitAround, fmtCoord, gridLines, niceStep, pickParticle, project, pxPerUnit, withinRadius } from '../src/plugins/particles/project.ts';

test('niceStep picks 1, 2, 5, 10, ... so grid lines stay at least 44 px apart', () => {
  assert.equal(niceStep(100), 0.5);
  assert.equal(niceStep(30), 2);
  assert.equal(niceStep(10), 5);
  assert.equal(niceStep(5), 10);
  assert.equal(niceStep(0.3), 200);
  assert.equal(niceStep(1000), 0.05);
  for (const px of [0.01, 0.7, 3, 19, 44, 200]) assert.ok(niceStep(px) * px >= 44);
});

test('gridLines are aligned to multiples of the step, mark the origin and every tenth line', () => {
  const lines = gridLines([3.2, 64, -7.9], 5, 4, 'xz');
  const xs = lines.filter((l) => l.axis === 'x').map((l) => l.value);
  const zs = lines.filter((l) => l.axis === 'z').map((l) => l.value);
  assert.deepEqual(xs, [-15, -10, -5, 0, 5, 10, 15, 20, 25].filter((v) => v >= 3.2 - 20 && v <= 3.2 + 20));
  assert.ok(zs.every((v) => v % 5 === 0 && v >= -27.9 && v <= 12.1));
  assert.ok(lines.every((l) => l.a[1] === 64 && l.b[1] === 64));
  assert.equal(lines.find((l) => l.axis === 'x' && l.value === 0)!.origin, true);
  assert.equal(lines.find((l) => l.axis === 'x' && l.value === 50 / 5)!.major, false);
  const y = gridLines([0, 0, 0], 1, 10, 'xy');
  assert.ok(y.every((l) => l.a[2] === 0 && l.b[2] === 0));
  assert.ok(y.find((l) => l.axis === 'x' && l.value === 10)!.major);
  const yz = gridLines([4, 0, 0], 1, 2, 'yz');
  assert.ok(yz.every((l) => l.a[0] === 4 && l.b[0] === 4));
});

test('clipToDepth drops what is behind the camera and clips what crosses it', () => {
  const c: [number, number, number] = [0, 0, 0];
  const radius = 5;
  assert.deepEqual(clipToDepth([0, 0, 0], [1, 0, 1], c, DEFAULT_VIEW, radius)?.length, 2);
  assert.equal(clipToDepth([-500, 0, -500], [-400, 0, -400], c, { yaw: 0, pitch: 0, zoom: 1 }, radius), null);
  const seg = clipToDepth([0, 0, -500], [0, 0, 5], c, { yaw: 0, pitch: 0, zoom: 1 }, radius)!;
  assert.ok(seg[0][2] > -500 && seg[0][2] <= -15 && seg[1][2] === 5);
});

test('axis views look along the right axis', () => {
  const c: [number, number, number] = [0, 0, 0];
  const at = (v: keyof typeof AXIS_VIEWS, p: [number, number, number]) => project(p, c, { ...AXIS_VIEWS[v], zoom: 1 }, 400, 400, 10);
  assert.ok(at('front', [5, 0, 0]).x > 200 && Math.abs(at('front', [5, 0, 0]).y - 200) < 1e-6);
  assert.ok(at('front', [0, 5, 0]).y < 200);
  assert.ok(at('top', [0, 5, 0]).depth < at('top', [0, -5, 0]).depth);
  assert.ok(at('bottom', [0, 5, 0]).depth > at('bottom', [0, -5, 0]).depth);
  assert.ok(at('right', [0, 0, 5]).x < 200);
  assert.ok(at('back', [5, 0, 0]).x < 200);
  assert.ok(at('left', [5, 0, 0]).depth < at('left', [-5, 0, 0]).depth);
  assert.ok(at('right', [5, 0, 0]).depth > at('right', [-5, 0, 0]).depth);
});

test('pickParticle takes the nearest one within reach, front-most on a tie', () => {
  const items = [{ q: { x: 10, y: 10, depth: 5 }, n: 'far' }, { q: { x: 10, y: 10, depth: -5 }, n: 'near' }, { q: { x: 40, y: 10, depth: 0 }, n: 'side' }];
  assert.equal(pickParticle(items, 11, 10, 10)?.n, 'near');
  assert.equal(pickParticle(items, 38, 12, 10)?.n, 'side');
  assert.equal(pickParticle(items, 200, 200, 10), null);
  assert.equal(pickParticle([], 0, 0, 10), null);
});

test('region filter, fit and coordinate text', () => {
  assert.equal(withinRadius([3, 4, 0], [0, 0, 0], 5), true);
  assert.equal(withinRadius([3, 4, 0.1], [0, 0, 0], 5), false);
  const around = fitAround([[10, 0, 0], [0, 0, 3]], [0, 0, 0]);
  assert.deepEqual(around.center, [0, 0, 0]);
  assert.equal(around.radius, 10);
  assert.deepEqual(fitAround([[0, 0, 0], [4, 0, 0]], null).center, [2, 0, 0]);
  assert.equal(fmtCoord(1.23456), '1.235');
  assert.equal(fmtCoord(2), '2');
  assert.equal(fmtCoord(-0.5), '-0.5');
  assert.equal(pxPerUnit({ ...DEFAULT_VIEW, zoom: 2 }, 400, 360, 10) / pxPerUnit(DEFAULT_VIEW, 400, 360, 10), 2);
});