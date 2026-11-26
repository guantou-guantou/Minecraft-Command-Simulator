import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/language/parser.ts';
import { Simulation } from '../src/engine/simulation.ts';
import { snapshot } from '../src/engine/snapshot.ts';
import { lintCommands } from '../src/language/cmdlint.ts';

const make = () => new Simulation(parse(`A = ent(type=player, pos=(0.5, 4.0, 0.5), name=A)
z1 = ent(type=zombie, pos=(3.5, 4.0, 0.5), tags=["z"])
z2 = ent(type=zombie, pos=(5.5, 4.0, 0.5), tags=["z"])
s = ent(type=armor_stand, pos=(7.5, 4.0, 0.5), tags=["stand"])
`));
const run = (sim: Simulation, c: string) => sim.runCommand(c, null, [0, 0, 0]);
const hp = (sim: Simulation, tag: string) => sim.world.entities.filter((e) => e.tags.has(tag)).map((e) => e.health);
const texts = (sim: Simulation) => sim.events.flatMap((e) => (e.type === 'chat' ? [e.text] : []));

test('entities start with their maximum health; things without health have none', () => {
  const sim = make();
  assert.deepEqual([sim.findEntity('A')!.health, sim.findEntity('A')!.maxHealth], [20, 20]);
  assert.deepEqual(hp(sim, 'stand'), [6]);
  run(sim, '/summon item 0 4 0');
  run(sim, '/summon creeper 0 4 0');
  const item = sim.world.entities.find((e) => e.type === 'minecraft:item')!;
  assert.equal(item.maxHealth, 0);
  assert.equal(sim.world.entities.find((e) => e.type === 'minecraft:creeper')!.health, 20);
  assert.equal(snapshot(sim).entities.find((e) => e.name === 'A')!.health, 20);
});

test('damage takes health off every target and removes what dies', () => {
  const sim = make();
  assert.equal(run(sim, '/damage @e[tag=z] 5 entity_attack'), true);
  assert.deepEqual(hp(sim, 'z'), [15, 15]);
  assert.ok(texts(sim).includes('Applied 5 damage to 2 entities'));
  assert.equal(run(sim, '/damage @e[tag=stand] 6'), true);
  assert.equal(sim.world.entities.some((e) => e.tags.has('stand')), false);
  assert.ok(sim.events.some((e) => e.type === 'change' && /died and was removed/.test(e.what)));
  assert.equal(run(sim, '/damage @e[tag=z] 100 void'), true);
  assert.equal(sim.world.entities.filter((e) => e.tags.has('z')).length, 0);
});

test('a player at 0 health stays, damage names the damager, and bad uses fail', () => {
  const sim = make();
  assert.equal(run(sim, '/damage A 99 entity_explosion entity @e[tag=z,c=1]'), true);
  assert.equal(sim.findEntity('A')!.health, 0);
  assert.ok(sim.events.some((e) => e.type === 'change' && /by zombie/.test(e.what) && /the player stays/.test(e.what)));
  assert.equal(run(sim, '/damage @e[type=creeper] 1'), false);
  assert.equal(run(sim, '/damage A -3'), false);
  assert.equal(run(sim, '/damage A 1 entity_attack entity @e[type=creeper]'), false);
  run(sim, '/summon item 0 4 0');
  assert.equal(run(sim, '/damage @e[type=item] 1'), false);
  assert.ok(texts(sim).some((t) => t.includes('cannot be damaged')));
  assert.deepEqual(lintCommands('/damage @a 9 entity_explosion\n/damage @a 1 bogus\n').map((d) => d.line), [2]);
});

test('instant_damage and instant_health change health by their amplifier', () => {
  const sim = make();
  assert.equal(run(sim, '/effect @e[tag=z] instant_damage 1 0'), true);
  assert.deepEqual(hp(sim, 'z'), [14, 14]);
  run(sim, '/effect @e[tag=z] instant_damage 1 1');
  assert.deepEqual(hp(sim, 'z'), [2, 2]);
  run(sim, '/effect @e[tag=z] instant_health 1 0');
  assert.deepEqual(hp(sim, 'z'), [6, 6]);
  run(sim, '/effect @e[tag=z] instant_health 1 3');
  assert.deepEqual(hp(sim, 'z'), [20, 20]);
  assert.equal(sim.world.entities.filter((e) => e.tags.has('z')).every((e) => !('instant_damage' in e.effects)), true);
});