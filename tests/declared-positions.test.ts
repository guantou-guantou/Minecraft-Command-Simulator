import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from '../src/language/parser.ts';
import { Simulation } from '../src/engine/simulation.ts';

test('entity positions follow the game rule: whole x and z are block centres, decimals are exact', () => {
  const p = parse(`
a = ent(type=cow, position=(1, 2, 3))
b = ent(type=cow, position=(1.0, 2, 3.0))
c = ent(type=cow, position=(-5, 64, 0.5))
`);
  assert.deepEqual(p.diagnostics, []);
  assert.deepEqual(p.entities.map((e) => e.position), [[1.5, 2, 3.5], [1, 2, 3], [-4.5, 64, 0.5]]);
});

test('position variables keep how their coordinates were written', () => {
  const p = parse(`
p = (0, 0, 0)
q = (1.0, 0, 2.5)
ent(type=cow, position=p)
ent(type=cow, position=q)
/say \${p} | \${q} | \${q.x} \${q.y} \${q.z}
`);
  assert.deepEqual(p.diagnostics, []);
  assert.deepEqual(p.entities.map((e) => e.position), [[0.5, 0, 0.5], [1, 0, 2.5]]);
  assert.equal(p.chains[0].nodes[0].command, 'say 0 0 0 | 1.0 0 2.5 | 1.0 0 2.5');
  const s = new Simulation(parse('p = (0, 0, 0)\nent(type=cow, position=p, name=c)\n/execute positioned ${p} run tp @e[name=c] ~ ~ ~'));
  s.runChain('main');
  assert.deepEqual(s.world.entities[0].pos, [0.5, 0, 0.5]);
});

test('the SCP logo script draws the whole outline: tab top edges are there and the arcs have no gaps', () => {
  const s = new Simulation(parse(fs.readFileSync(new URL('./fixtures/scp_logo.mcsim', import.meta.url), 'utf8')));
  s.runChain('main');
  const pts = s.events.flatMap((e) => (e.type === 'effect' && e.kind === 'particle' ? [e.pos] : []));
  assert.equal(pts.length, 768);
  const rel = pts.map((p) => [p[0] - 0.5, p[2] - 0.5]);
  assert.ok(Math.max(...rel.map((p) => Math.hypot(p[0], p[1]))) < 4.3);
  const topEdge = rel.filter((p) => Math.abs(p[0]) < 1 && p[1] < -3.7 && p[1] > -4.4).length;
  const baseArc = rel.filter((p) => Math.abs(p[0]) < 1 && p[1] < -2.9 && p[1] > -3.5).length;
  assert.ok(topEdge >= 10, `top edge points: ${topEdge}`);
  assert.equal(baseArc, 0);
});