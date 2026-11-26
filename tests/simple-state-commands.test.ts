import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/language/parser.ts';
import { Simulation } from '../src/engine/simulation.ts';

const SCRIPT = `region(from=(-64, 0, -64), to=(64, 100, 64))
fill(type=stone, from=(-30, 3, -30), to=(30, 3, 30))
A = ent(type=player, pos=(0.5, 4.0, 0.5), name=A)
z1 = ent(type=zombie, pos=(1.5, 4.0, 1.5), tags=["z"])
z2 = ent(type=zombie, pos=(2.5, 4.0, 1.5), tags=["z"])
z3 = ent(type=zombie, pos=(3.5, 4.0, 1.5), tags=["z"])
`;
const make = () => new Simulation(parse(SCRIPT));
const says = (sim: Simulation) => sim.events.flatMap((e) => (e.type === 'chat' ? [e.text] : []));

test('alwaysday locks the day cycle like daylock, true by default', () => {
  const sim = make();
  assert.equal(sim.runCommand('/alwaysday', null, [0, 0, 0]), true);
  assert.equal(sim.world.gamerules.dodaylightcycle, false);
  assert.equal(sim.runCommand('/alwaysday false', null, [0, 0, 0]), true);
  assert.equal(sim.world.gamerules.dodaylightcycle, true);
  assert.equal(sim.runCommand('/alwaysday maybe', null, [0, 0, 0]), false);
});

test('toggledownfall switches between clear and rain', () => {
  const sim = make();
  sim.runCommand('/toggledownfall', null, [0, 0, 0]);
  assert.equal(sim.world.weather, 'rain');
  sim.runCommand('/weather thunder', null, [0, 0, 0]);
  sim.runCommand('/toggledownfall', null, [0, 0, 0]);
  assert.equal(sim.world.weather, 'clear');
  assert.ok(says(sim).includes('Toggled downfall'));
});

test('me announces the executor and a message', () => {
  const sim = make();
  sim.runCommand('/me waves', sim.findEntity('A') ?? null, [0, 0, 0]);
  sim.runCommand('/me hi @a', null, [0, 0, 0]);
  assert.deepEqual(says(sim), ['* A waves', '* @ hi A']);
  assert.equal(sim.runCommand('/me', null, [0, 0, 0]), false);
});

test('querytarget prints the position and rotation of every target', () => {
  const sim = make();
  assert.equal(sim.runCommand('/querytarget A', null, [0, 0, 0]), true);
  const out = says(sim).at(-1)!;
  assert.match(out, /^Target data:\[\n    \{\n        "dimension" : 0,\n        "id" : -4294967295,\n/);
  const data = JSON.parse(out.slice('Target data:'.length));
  assert.deepEqual(data[0].position, { x: 0.5, y: 4, z: 0.5 });
  assert.equal(data[0].dimension, 0);
  assert.equal(sim.runCommand('/querytarget @e[type=creeper]', null, [0, 0, 0]), false);
});

test('spreadplayers puts the victims on the ground, inside the range and apart', () => {
  const sim = make();
  assert.equal(sim.runCommand('/spreadplayers 10 10 4 12 @e[tag=z]', null, [0, 0, 0]), true);
  const zs = sim.world.entities.filter((e) => e.tags.has('z'));
  assert.equal(zs.length, 3);
  for (const e of zs) {
    assert.ok(Math.abs(e.pos[0] - 10.5) <= 12 && Math.abs(e.pos[2] - 10.5) <= 12);
    assert.equal(e.pos[1], 4);
  }
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) assert.ok(Math.hypot(zs[i].pos[0] - zs[j].pos[0], zs[i].pos[2] - zs[j].pos[2]) >= 4);
  const again = make();
  again.runCommand('/spreadplayers 10 10 4 12 @e[tag=z]', null, [0, 0, 0]);
  assert.deepEqual(again.world.entities.filter((e) => e.tags.has('z')).map((e) => e.pos), zs.map((e) => e.pos));
  assert.equal(sim.runCommand('/spreadplayers 0 0 10 5 @a', null, [0, 0, 0]), false);
  assert.equal(sim.runCommand('/spreadplayers 0 0 4 12 @e[type=creeper]', null, [0, 0, 0]), false);
});