import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/language/parser.ts';
import { Simulation } from '../src/engine/simulation.ts';
import { snapshot } from '../src/engine/snapshot.ts';
import { lintCommands } from '../src/language/cmdlint.ts';

const make = (extra = '') => new Simulation(parse(`A = ent(type=player, pos=(0.5, 4.0, 0.5), name=A)
z1 = ent(type=zombie, pos=(3.5, 4.0, 0.5), tags=["z"])
z2 = ent(type=zombie, pos=(5.5, 4.0, 0.5), tags=["z"])
s = ent(type=armor_stand, pos=(7.5, 4.0, 0.5), tags=["stand"])
p1 = ent(type=pig, pos=(9.5, 4.0, 0.5), tags=["pig"])
${extra}`));
const run = (sim: Simulation, c: string) => sim.runCommand(c, null, [0, 0, 0]);
const hp = (sim: Simulation, tag: string) => sim.world.entities.filter((e) => e.tags.has(tag)).map((e) => e.health);
const texts = (sim: Simulation) => sim.events.flatMap((e) => (e.type === 'chat' ? [e.text] : []));

test('entities start with their maximum health; things without health have none', () => {
  const sim = make();
  assert.deepEqual([sim.findEntity('A')!.health, sim.findEntity('A')!.maxHealth], [20, 20]);
  assert.deepEqual(hp(sim, 'stand'), [6]);
  assert.deepEqual(hp(sim, 'pig'), [10]);
  run(sim, '/summon item 0 4 0');
  run(sim, '/summon creeper 0 4 0');
  run(sim, '/summon wither 0 4 0');
  assert.equal(sim.world.entities.find((e) => e.type === 'minecraft:item')!.maxHealth, 0);
  assert.equal(sim.world.entities.find((e) => e.type === 'minecraft:creeper')!.health, 20);
  assert.equal(sim.world.entities.find((e) => e.type === 'minecraft:wither')!.health, 300);
  assert.equal(snapshot(sim).entities.find((e) => e.name === 'A')!.health, 20);
});

test('damage takes health off every target and removes what dies', () => {
  const sim = make();
  assert.equal(run(sim, '/damage @e[tag=z] 5 entity_attack'), true);
  assert.deepEqual(hp(sim, 'z'), [15, 15]);
  assert.ok(texts(sim).includes('Applied damage to 2 entities'));
  assert.equal(run(sim, '/damage @e[tag=stand] 6'), true);
  assert.equal(sim.world.entities.some((e) => e.tags.has('stand')), false);
  assert.ok(sim.events.some((e) => e.type === 'change' && /died and was removed/.test(e.what)));
  assert.equal(run(sim, '/damage @e[tag=z] 100 void'), true);
  assert.equal(sim.world.entities.filter((e) => e.tags.has('z')).length, 0);
  assert.ok(texts(sim).includes('Applied damage to A') === false);
});

test('a player at 0 health stays, damage names the damager, and bad uses fail', () => {
  const sim = make();
  assert.equal(run(sim, '/damage A 99 entity_explosion entity @e[tag=z,c=1]'), true);
  assert.equal(sim.findEntity('A')!.health, 0);
  assert.ok(texts(sim).includes('Applied damage to A'));
  assert.ok(sim.events.some((e) => e.type === 'change' && /by zombie/.test(e.what) && /the player stays/.test(e.what)));
  assert.equal(run(sim, '/damage @e[type=creeper] 1'), false);
  assert.equal(run(sim, '/damage A -3'), false);
  assert.equal(run(sim, '/damage A 1 entity_attack entity @e[type=creeper]'), false);
  run(sim, '/summon item 0 4 0');
  assert.equal(run(sim, '/damage @e[type=item] 1'), false);
  assert.ok(texts(sim).some((t) => t.startsWith('Unable to apply damage to')));
  assert.deepEqual(lintCommands('/damage @a 9 entity_explosion\n/damage @a 1 bogus\n').map((d) => d.line), [2]);
});

test('creative and spectator players cannot be damaged', () => {
  const sim = make();
  run(sim, '/gamemode creative A');
  assert.equal(run(sim, '/damage A 5'), false);
  assert.ok(texts(sim).includes('Unable to apply damage to A'));
  assert.equal(sim.findEntity('A')!.health, 20);
  run(sim, '/gamemode spectator A');
  assert.equal(run(sim, '/damage A 5'), false);
  run(sim, '/gamemode survival A');
  assert.equal(run(sim, '/damage A 5'), true);
  assert.equal(sim.findEntity('A')!.health, 15);
});

test('armor and resistance reduce damage as on the wiki', () => {
  const sim = make(`item(target=A, slot=slot.armor.head, type=diamond_helmet)
item(target=A, slot=slot.armor.chest, type=diamond_chestplate)
item(target=A, slot=slot.armor.legs, type=diamond_leggings)
item(target=A, slot=slot.armor.feet, type=diamond_boots)
item(target=p1, slot=slot.armor.chest, type=leather_chestplate)
`);
  const a = sim.findEntity('A')!;
  run(sim, '/damage A 10 entity_attack');
  const expected = Math.fround(10 * (1 - Math.min(20, Math.max(4, 20 - 10 / (2 + 2))) / 25));
  assert.equal(a.health, Math.fround(20 - expected));
  assert.ok(a.health > 10);
  a.health = 20;
  run(sim, '/damage A 10 magic');
  assert.equal(a.health, 10);
  a.health = 20;
  run(sim, '/effect A resistance 30 1');
  run(sim, '/damage A 10 magic');
  assert.equal(a.health, 14);
  a.health = 20;
  run(sim, '/damage A 10 void');
  assert.equal(a.health, 10);
  a.health = 20;
  run(sim, '/effect A resistance 30 4');
  run(sim, '/damage A 10 entity_attack');
  assert.equal(a.health, 20);
  const pig = sim.world.entities.find((e) => e.tags.has('pig'))!;
  run(sim, '/damage @e[tag=pig] 5 entity_attack');
  assert.equal(pig.health, Math.fround(10 - 5 * (1 - Math.min(20, Math.max(0.6, 3 - 5 / 2)) / 25)));
});

test('instant_health and instant_damage use the wiki amounts and swap for the undead', () => {
  const sim = make();
  const pig = sim.world.entities.find((e) => e.tags.has('pig'))!;
  assert.equal(run(sim, '/effect @e[tag=pig] instant_damage 1 0'), true);
  assert.equal(pig.health, 4);
  run(sim, '/effect @e[tag=pig] instant_health 1 0');
  assert.equal(pig.health, 8);
  run(sim, '/effect @e[tag=pig] instant_health 1 1');
  assert.equal(pig.health, 10);
  assert.equal(run(sim, '/effect @e[tag=z] instant_damage 1 0'), true);
  assert.deepEqual(hp(sim, 'z'), [20, 20]);
  run(sim, '/effect @e[tag=z] instant_health 1 0');
  assert.deepEqual(hp(sim, 'z'), [16, 16]);
  run(sim, '/effect @e[tag=z] instant_health 1 33');
  assert.deepEqual(hp(sim, 'z'), [8, 8]);
  assert.ok(sim.world.entities.every((e) => !('instant_damage' in e.effects)));
});

test('instant effects given for several ticks act every tick, and hurt only every 10 ticks', () => {
  const sim = make();
  const pig = sim.world.entities.find((e) => e.tags.has('pig'))!;
  pig.health = 1;
  run(sim, '/effect @e[tag=pig] instant_health 5 0');
  assert.equal(pig.health, 5);
  sim.advance(1);
  assert.equal(pig.health, 9);
  sim.advance(1);
  assert.equal(pig.health, 10);
  sim.advance(5);
  assert.ok(!('instant_health' in pig.effects));
  const stand = sim.world.entities.find((e) => e.tags.has('stand'))!;
  stand.health = 6;
  stand.maxHealth = 100;
  stand.health = 100;
  run(sim, '/effect @e[tag=stand] instant_damage 25 0');
  assert.equal(stand.health, 94);
  sim.advance(9);
  assert.equal(stand.health, 94);
  sim.advance(1);
  assert.equal(stand.health, 88);
  sim.advance(10);
  assert.equal(stand.health, 82);
});