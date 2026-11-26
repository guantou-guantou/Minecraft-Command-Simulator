import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/language/parser.ts';
import { Simulation } from '../src/engine/simulation.ts';
import { bounds, idColor, particlesFrom, project } from '../src/plugins/particles/project.ts';
import { generate, DEFAULT_SPEC } from '../src/plugins/nxtree/core.ts';

const ID_VIEW = { yaw: 0, pitch: 0, zoom: 1 };

test('project: axes map to the screen as expected', () => {
  const c: [number, number, number] = [0, 0, 0];
  const o = project(c, c, ID_VIEW, 400, 400, 10);
  assert.deepEqual([o.x, o.y], [200, 200]);
  assert.ok(project([1, 0, 0], c, ID_VIEW, 400, 400, 10).x > 200);
  assert.ok(project([0, 1, 0], c, ID_VIEW, 400, 400, 10).y < 200);
  assert.equal(project([0, 0, 1], c, ID_VIEW, 400, 400, 10).x, 200);
  const near = project([0, 0, -5], c, ID_VIEW, 400, 400, 10);
  const far = project([0, 0, 5], c, ID_VIEW, 400, 400, 10);
  assert.ok(far.depth > near.depth);
  assert.ok(near.scale > far.scale);
  const turned = project([1, 0, 0], c, { yaw: Math.PI / 2, pitch: 0, zoom: 1 }, 400, 400, 10);
  assert.ok(Math.abs(turned.x - 200) < 1e-9);
  const zoomed = project([1, 0, 0], c, { ...ID_VIEW, zoom: 2 }, 400, 400, 10);
  assert.ok(zoomed.x - 200 > project([1, 0, 0], c, ID_VIEW, 400, 400, 10).x - 200);
});

test('bounds, colors, and time windows', () => {
  assert.deepEqual(bounds([]), { center: [0, 0, 0], radius: 1 });
  const b = bounds([[0, 0, 0], [4, 2, 0]]);
  assert.deepEqual(b.center, [2, 1, 0]);
  assert.ok(Math.abs(b.radius - Math.hypot(2, 1)) < 1e-9);
  assert.equal(idColor('a'), idColor('a'));
  assert.notEqual(idColor('a'), idColor('b'));
  const events = [
    { type: 'effect', kind: 'particle', tick: 0, line: 1, id: 'a', pos: [0, 0, 0] },
    { type: 'effect', kind: 'particle', tick: 4, line: 1, id: 'b', pos: [1, 0, 0] },
    { type: 'effect', kind: 'particle', tick: 5, line: 1, id: 'c', pos: [2, 0, 0] },
    { type: 'chat', kind: 'say', tick: 5, line: 1, sender: null, text: 'x' },
  ] as Parameters<typeof particlesFrom>[0];
  assert.deepEqual(particlesFrom(events, { kind: 'all' }, 5).map((p) => p.id), ['a', 'b', 'c']);
  assert.deepEqual(particlesFrom(events, { kind: 'last', ticks: 0 }, 5).map((p) => p.id), ['c']);
  assert.deepEqual(particlesFrom(events, { kind: 'last', ticks: 1 }, 5).map((p) => p.id), ['b', 'c']);
  assert.deepEqual(particlesFrom(events, { kind: 'last', ticks: 5 }, 5).map((p) => p.id), ['a', 'b', 'c']);
});

test('nx tree run in the live simulation produces the particles the viewer reads', () => {
  const g = generate(DEFAULT_SPEC);
  const sim = new Simulation(parse(`${g.entities}\nchain t:\n    /${g.command}`));
  assert.deepEqual(sim.program.diagnostics, []);
  sim.activate('t');
  sim.advance(1);
  const ps = particlesFrom(sim.events, { kind: 'last', ticks: 1 }, sim.tick);
  assert.equal(ps.length, 64);
  assert.equal(new Set(ps.map((p) => p.pos.join(','))).size, 64);
  const { center } = bounds(ps.map((p) => p.pos));
  assert.deepEqual(center, [2, 66, 2]);
});
