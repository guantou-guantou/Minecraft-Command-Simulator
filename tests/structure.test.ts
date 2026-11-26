import { complete, sceneFrom } from '../src/language/complete.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from '../src/language/parser.ts';
import { Simulation } from '../src/engine/simulation.ts';
import { exportMcstructure, importMcstructure, templateToNbt } from '../src/nbt/mcstructure.ts';
import { dump, readNbt } from '../src/nbt/nbt.ts';
import { cellIndex } from '../src/engine/structure.ts';

const FIXTURE = new Uint8Array(fs.readFileSync(new URL('./fixtures/test_structure.mcstructure', import.meta.url)));
const sim = (src = '') => new Simulation(parse(src));
const run = (s: Simulation, c: string) => s.runCommand(c, null, [0, 0, 0]);

test('the real sample file is read into blocks, a command block and a chest', () => {
  const t = importMcstructure(FIXTURE);
  assert.deepEqual(t.size, [3, 3, 3]);
  assert.deepEqual(t.origin, [-3, -61, -6]);
  assert.equal(t.blocks.length, 27);
  assert.equal(t.blocks[0].id, 'minecraft:grass_block');
  assert.equal(t.blocks[cellIndex(t.size, 1, 0, 1)].id, 'minecraft:dirt');
  assert.deepEqual(t.blocks[3].states, { structure_block_type: 'save' });
  const cb = t.blocks[cellIndex(t.size, 1, 1, 1)];
  assert.equal(cb.id, 'minecraft:chain_command_block');
  assert.deepEqual(cb.states, { conditional_bit: true, facing_direction: 3 });
  assert.deepEqual(cb.cb, { command: 'say aaa', delay: 20, power: 'always_on', line: 0, rotation: [0, 0], name: 'test_command', firstTick: false, track: true });
  const chest = t.blocks[cellIndex(t.size, 2, 1, 2)];
  assert.equal(chest.id, 'minecraft:chest');
  assert.deepEqual(chest.states, { 'minecraft:cardinal_direction': 'south' });
  assert.deepEqual(chest.items, { 'slot.container:13': { id: 'minecraft:diamond', count: 1, data: 0, components: {} } });
  assert.equal(t.entities.length, 0);
});

test('writing and reading again gives the same structure, and the file keeps the sample layout', () => {
  const t = importMcstructure(FIXTURE);
  const bytes = exportMcstructure(t);
  const again = importMcstructure(bytes);
  const bare = (x: typeof t) => ({ ...x, blocks: x.blocks.map(({ entityNbt: _n, ...b }) => b) });
  assert.deepEqual(bare(again), bare(t));
  assert.deepEqual(importMcstructure(exportMcstructure(again)), again);
  const root = readNbt(bytes).value;
  assert.deepEqual(Object.keys((root as any).v), ['format_version', 'size', 'structure', 'structure_world_origin']);
  const text = dump(root, 0, 6);
  assert.match(text, /version: 18168865/);
  assert.match(text, /conditional_bit: 1b/);
  assert.match(text, /facing_direction: 3\n/);
  assert.match(text, /id: "CommandBlock"/);
  assert.match(text, /Name: "minecraft:diamond"/);
  assert.match(text, /Slot: 13b/);
  assert.equal(JSON.stringify(templateToNbt(again), (_k, v) => (typeof v === 'bigint' ? String(v) : v)), JSON.stringify(templateToNbt(t), (_k, v) => (typeof v === 'bigint' ? String(v) : v)));
});

test('bad files are rejected with a clear error', () => {
  assert.throws(() => importMcstructure(new Uint8Array([1, 2, 3])));
  assert.throws(() => importMcstructure(exportMcstructure({ size: [1, 1, 1], origin: [0, 0, 0], blocks: [{ id: 'minecraft:air', states: {} }], entities: [] }).slice(0, 40)));
});

const BUILD = `
ent(type=armor_stand, position=(1.5, 64, 1.5), name=stand, rotation=(90, 0), tags=["t"])
block(type=stone, position=(0, 64, 0))
block(type=stairs, position=(1, 64, 0), states=["weirdo_direction"=0])
item(target=(0, 64, 1), slot=slot.container, index=3, type=diamond_sword, count=1)
block(type=chest, position=(0, 64, 1), states=["minecraft:cardinal_direction"="north"])
chain gate(pos=(2, 64, 0), facing=east):
    /say hi
    cb(mode=cha, delay=5)
    /say two
`;

test('structure save and load copy blocks, command blocks, containers and entities', () => {
  const s = sim(BUILD);
  assert.equal(run(s, '/structure save house 0 64 0 3 65 2'), true);
  assert.equal(s.library.has('mystructure:house'), true);
  assert.equal(run(s, '/structure load house 10 70 10'), true);
  assert.equal(s.world.getBlock([10, 70, 10]), 'minecraft:stone');
  assert.equal(s.world.getBlockData([12, 70, 10]).cb?.command, 'say hi');
  assert.equal(s.world.getBlockData([13, 70, 10]).cb?.command, 'say two');
  assert.equal(s.world.getBlockData([10, 70, 11]).items?.['slot.container:3']?.id, 'minecraft:diamond_sword');
  const stands = s.world.entities.filter((e) => e.type === 'minecraft:armor_stand');
  assert.equal(stands.length, 2);
  assert.deepEqual(stands[1].pos, [11.5, 70, 11.5]);
  assert.deepEqual([...stands[1].tags], ['t']);
  assert.equal(stands[1].name, 'stand');
  assert.equal(run(s, '/structure load house 20 70 10 0_degrees none true false'), true);
  assert.equal(s.world.getBlock([20, 70, 10]), 'minecraft:air');
  assert.equal(s.world.entities.filter((e) => e.type === 'minecraft:armor_stand').length, 3);
  assert.equal(run(s, '/structure load nope 0 0 0'), false);
  assert.equal(run(s, '/structure load house 500 0 0'), false);
  assert.equal(run(s, '/structure delete house'), true);
  assert.equal(run(s, '/structure delete house'), false);
});

test('memory structures vanish on reset, disk structures stay', () => {
  const s = sim(BUILD);
  run(s, '/structure save m 0 64 0 1 64 0 true memory');
  run(s, '/structure save d 0 64 0 1 64 0 true disk');
  assert.equal(s.world.structures.has('mystructure:m'), true);
  assert.equal(s.library.has('mystructure:m'), false);
  s.reset();
  assert.equal(s.world.structures.has('mystructure:m'), false);
  assert.equal(s.library.has('mystructure:d'), true);
  assert.equal(run(s, '/structure load d 5 70 5'), true);
});

test('rotation and mirror move blocks, entities and direction states', () => {
  const s = sim(BUILD);
  run(s, '/structure save h 0 64 0 3 64 1');
  run(s, '/structure load h 10 70 10 90_degrees');
  // size 4x1x2 -> 2x1x4: cell (x,z) -> (sz-1-z, x)
  assert.equal(s.world.getBlock([11, 70, 10]), 'minecraft:stone');
  assert.equal(s.world.getBlockData([10, 70, 10]).states['minecraft:cardinal_direction'], 'east');
  assert.equal(s.world.getBlockData([11, 70, 11]).states.weirdo_direction, 2);
  assert.equal(s.world.getBlockData([11, 70, 12]).states.facing_direction, 3);
  const e = s.world.entities.filter((x) => x.type === 'minecraft:armor_stand')[1];
  assert.deepEqual(e.pos, [10.5, 70, 11.5]);
  assert.equal(e.rot[0], -180);
  run(s, '/structure load h 30 70 10 0_degrees x');
  assert.equal(s.world.getBlock([33, 70, 10]), 'minecraft:stone');
  assert.equal(s.world.getBlockData([32, 70, 10]).states.weirdo_direction, 1);
  assert.equal(s.world.getBlockData([33, 70, 11]).states['minecraft:cardinal_direction'], 'north');
  assert.equal(s.world.getBlockData([31, 70, 10]).states.facing_direction, 4);
});

test('integrity places a share of the blocks, the same for the same seed', () => {
  const s = sim('region(from=(0,0,0), to=(40,10,40))\n');
  run(s, '/fill 0 0 0 9 0 9 stone');
  run(s, '/structure save slab 0 0 0 9 0 9');
  const count = (x: number) => {
    let n = 0;
    for (let i = 0; i < 10; i++) for (let j = 0; j < 10; j++) if (s.world.getBlock([x + i, 0, 20 + j]) === 'minecraft:stone') n++;
    return n;
  };
  run(s, '/structure load slab 10 0 20 0_degrees none true true false 50 abc');
  run(s, '/structure load slab 25 0 20 0_degrees none true true false 50 abc');
  assert.equal(count(10), count(25));
  assert.ok(count(10) > 20 && count(10) < 80);
  run(s, '/structure load slab 10 0 20 0_degrees none true true false 0 abc');
});

test('export from a simulated world and import back keeps entities and blocks', () => {
  const s = sim(BUILD);
  run(s, '/structure save house 0 64 0 3 65 2');
  const t = s.library.get('mystructure:house')!;
  const back = importMcstructure(exportMcstructure(t));
  assert.deepEqual(back.size, t.size);
  assert.equal(back.entities.length, 1);
  assert.equal(back.entities[0].type, 'minecraft:armor_stand');
  assert.equal(back.entities[0].name, 'stand');
  assert.deepEqual(back.entities[0].tags, ['t']);
  assert.deepEqual(back.entities[0].pos, t.entities[0].pos);
  assert.deepEqual(back.blocks.map((b) => [b.id, b.states]), t.blocks.map((b) => [b.id, b.states]));
  const cbBlock = back.blocks[cellIndex(back.size, 2, 0, 0)];
  assert.equal(cbBlock.cb?.command, 'say hi');
});
test('structure names: the default namespace may be left out', () => {
  const s = new Simulation(parse('block(type=stone, position=(0, 64, 0))'));
  const run = (c: string) => s.runCommand(c, null, [0, 0, 0]);
  assert.equal(run('/structure save house 0 64 0 0 64 0'), true);
  assert.deepEqual([...s.library.keys()], ['mystructure:house']);
  assert.equal(run('/structure load house 5 70 5'), true);
  assert.equal(run('/structure load mystructure:house 6 70 5'), true);
  assert.equal(s.world.getBlock([5, 70, 5]), 'minecraft:stone');
  assert.equal(s.world.getBlock([6, 70, 5]), 'minecraft:stone');
  assert.equal(run('/structure save mystructure:house 0 64 0 1 64 0'), true);
  assert.equal(s.library.size, 1);
  assert.equal(s.library.get('mystructure:house')!.size[0], 2);
  assert.equal(run('/structure save other:box 0 64 0 0 64 0 true memory'), true);
  assert.equal(s.world.structures.has('other:box'), true);
  assert.equal(run('/structure load box 0 70 0'), false);
  assert.equal(run('/structure load other:box 0 70 0'), true);
  assert.equal(run('/structure delete house'), true);
  assert.equal(s.library.size, 0);
  assert.equal(run('/structure delete mystructure:house'), false);
});

test('structure names are completed from the library and the script', () => {
  const p = parse('/structure save fort 0 0 0 1 1 1');
  const scene = sceneFrom('/structure save fort 0 0 0 1 1 1', p, ['mystructure:house', 'other:box']);
  assert.deepEqual(scene.structures.sort(), ['fort', 'house', 'other:box']);
  const labels = (t: string) => complete(t, t.length, scene)?.items.map((i) => i.label).sort();
  assert.deepEqual(labels('/structure load '), ['fort', 'house', 'other:box']);
  assert.deepEqual(labels('/structure delete hou'), ['house']);
});
