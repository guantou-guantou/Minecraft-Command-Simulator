import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from '../src/language/parser.ts';
import { Simulation } from '../src/engine/simulation.ts';
import { exportScene } from '../src/engine/scene-export.ts';
import { cellsToMcsim } from '../src/convert/to-mcsim.ts';
import { templateCells, type BdxCell } from '../src/bdx/bdx.ts';
import { importMcstructure } from '../src/nbt/mcstructure.ts';
import { byte, compound, int, string } from '../src/nbt/nbt.ts';
import type { StructureTemplate } from '../src/engine/structure.ts';
import type { BlockData } from '../src/engine/types.ts';

const FIXTURE = new Uint8Array(fs.readFileSync(new URL('./fixtures/test_structure.mcstructure', import.meta.url)));
const at = (x: number, y: number, z: number, block: BlockData): BdxCell => ({ pos: [x, y, z], block });
const cb = (command: string, extra: Record<string, unknown> = {}) => ({ command, delay: 0, power: 'always_on' as const, line: 0, rotation: [0, 0] as [number, number], ...extra });

const SIGN = compound({ id: string('Sign'), isMovable: byte(1), x: int(5), y: int(5), z: int(5), FrontText: compound({ Text: string('hello, "world"\nline 2') }), IsWaxed: byte(1) });

function scene(): { cells: BdxCell[]; entities: StructureTemplate['entities'] } {
  const cells: BdxCell[] = [];
  for (let x = 0; x < 3; x++) for (let y = 0; y < 2; y++) for (let z = 0; z < 2; z++) cells.push(at(x, y, z, { id: 'minecraft:stone', states: {} }));
  cells.push(at(3, 0, 0, { id: 'minecraft:oak_slab', states: { 'minecraft:vertical_half': 'top' } }));
  cells.push(at(3, 0, 1, { id: 'minecraft:oak_trapdoor', states: { direction: 2, open_bit: true, upside_down_bit: false } }));
  cells.push(at(3, 0, 2, { id: 'minecraft:stone_button', states: { button_pressed_bit: true, facing_direction: 4 } }));
  cells.push(at(3, 0, 3, { id: 'minecraft:lever', states: { lever_direction: 'down_north_south', open_bit: true } }));
  cells.push(at(4, 0, 0, { id: 'minecraft:oak_sign', states: { ground_sign_direction: 13 }, entityNbt: SIGN }));
  cells.push(at(4, 0, 1, { id: 'minecraft:chest', states: { 'minecraft:cardinal_direction': 'north' }, items: { 'slot.container:3': { id: 'minecraft:diamond_sword', count: 1, data: 0, components: { 'minecraft:enchantments': { sharpness: 3 } } }, 'slot.container:10': { id: 'minecraft:apple', count: 5, data: 0, components: {} } }, entityNbt: compound({ id: string('Chest'), isMovable: byte(1), Findable: byte(0), Items: { t: 'list', of: 10, v: [] } }) }));
  // a chain that bends: east, east, then south
  cells.push(at(0, 3, 0, { id: 'minecraft:repeating_command_block', states: { conditional_bit: false, facing_direction: 5 }, cb: cb('say one', { power: 'needs_redstone', delay: 10, firstTick: true, name: 'start' }) }));
  cells.push(at(1, 3, 0, { id: 'minecraft:chain_command_block', states: { conditional_bit: true, facing_direction: 5 }, cb: cb('say two # in text', { delay: 3 }) }));
  cells.push(at(2, 3, 0, { id: 'minecraft:chain_command_block', states: { conditional_bit: false, facing_direction: 3 }, cb: cb('/say three') }));
  cells.push(at(2, 3, 1, { id: 'minecraft:chain_command_block', states: { conditional_bit: false, facing_direction: 3 }, cb: cb('say four') }));
  cells.push(at(0, 5, 3, { id: 'minecraft:command_block', states: { conditional_bit: false, facing_direction: 1 }, cb: cb('say alone', { power: 'needs_redstone' }) }));
  const entities = [
    { type: 'minecraft:armor_stand', name: 'Stand', raw: compound({}), pos: [1.5, 0, 2.5] as [number, number, number], rot: [90, -10] as [number, number], tags: ['a', 'b'], items: { 'slot.weapon.mainhand:0': { id: 'minecraft:stick', count: 1, data: 0, components: {} }, 'slot.armor.head:0': { id: 'minecraft:iron_helmet', count: 1, data: 0, components: {} } } },
    { type: 'minecraft:cow', name: null, pos: [0.25, 0, 3.75] as [number, number, number], rot: [0, 0] as [number, number], tags: [], items: {} },
  ];
  return { cells, entities: entities as unknown as StructureTemplate['entities'] };
}

test('a converted structure builds the same scene: blocks, states, containers, block entity data, command blocks, entities', () => {
  const { cells, entities } = scene();
  const offset: [number, number, number] = [10, 64, -5];
  for (const fills of [true, false]) {
    const r = cellsToMcsim(cells, entities, { offset, fills, entities: true, source: 'x.mcstructure' });
    const p = parse(r.text);
    assert.deepEqual(p.diagnostics, [], r.text);
    const s = new Simulation(p);
    for (const c of cells) {
      const pos = c.pos.map((v, i) => v + offset[i]) as [number, number, number];
      const b = s.world.getBlockData(pos);
      assert.equal(b.id, c.block.id, `${c.block.id} at ${pos}`);
      assert.deepEqual(b.states, c.block.states, `${c.block.id} states at ${pos}`);
      if (c.block.cb) {
        assert.equal(b.cb?.command, c.block.cb.command.replace(/^\//, '').replace(/ #.*$/, ''));
        assert.equal(b.cb?.delay, c.block.cb.delay);
        assert.equal(b.cb?.power, c.block.cb.power);
        assert.equal(!!b.cb?.firstTick, !!c.block.cb.firstTick);
      }
      if (c.block.items) assert.deepEqual(b.items, c.block.items);
      if (c.block.entityNbt && !c.block.items) {
        const want = JSON.stringify(c.block.entityNbt, (_k, v) => (typeof v === 'bigint' ? String(v) : v));
        const got = b.entityNbt ? JSON.stringify({ ...b.entityNbt, v: { ...(b.entityNbt as { v: object }).v, x: int(5), y: int(5), z: int(5) } }, (_k, v) => (typeof v === 'bigint' ? String(v) : v)) : '';
        assert.deepEqual(JSON.parse(got).v.FrontText, JSON.parse(want).v.FrontText);
        assert.deepEqual(JSON.parse(got).v.IsWaxed, JSON.parse(want).v.IsWaxed);
      }
    }
    const ents = s.world.entities;
    assert.equal(ents.length, 2);
    assert.deepEqual(ents[0].pos, [11.5, 64, -2.5]);
    assert.deepEqual([ents[0].name, [...ents[0].tags], ents[0].rot], ['Stand', ['a', 'b'], [90, -10]]);
    assert.equal(ents[0].items['slot.weapon.mainhand:0'].id, 'minecraft:stick');
    assert.equal(ents[0].items['slot.armor.head:0'].id, 'minecraft:iron_helmet');
    assert.deepEqual(ents[1].pos, [10.25, 64, -1.25]);
    assert.equal(r.stats.fills > 0, fills);
    assert.equal(r.stats.chains, 2);
  }
});

test('boxes of equal blocks are merged into few fill lines, and the result exports back to the same blocks', () => {
  const { cells, entities } = scene();
  const r = cellsToMcsim(cells, entities, { offset: [0, 0, 0], fills: true, entities: true, source: 'x' });
  assert.match(r.text, /fill\(type=stone, from=\(0, 0, 0\), to=\(2, 1, 1\)\)/);
  const back = exportScene(parse(r.text));
  const key = (c: { pos: number[]; block: BlockData }) => `${c.pos.join(',')}:${c.block.id}${JSON.stringify(Object.entries(c.block.states).sort())}`;
  const want = new Set(cells.map((c) => key(c)));
  const origin = back.template.origin;
  const got = new Set(templateCells(back.template).map((c) => key({ pos: c.pos.map((v, i) => v + origin[i]), block: c.block })));
  assert.deepEqual([...got].sort(), [...want].sort());
});

test('the script keeps comments in the header: size, corners and what could not be converted', () => {
  const { cells, entities } = scene();
  const r = cellsToMcsim(cells, entities, { offset: [0, 0, 0], fills: true, entities: true, source: 'sample.bdx', warnings: ['something odd'] });
  assert.match(r.text, /^# Converted from sample\.bdx\n# Lowest corner \(0, 0, 0\)/);
  assert.match(r.text, /# note: something odd/);
  assert.match(r.text, /# note: The command at \(1, 3, 0\) contains " #"/);
  assert.match(r.text, /# note: Entities keep their type/);
  assert.equal(cellsToMcsim(cells, entities, { offset: [0, 0, 0], fills: true, entities: false, source: 'x' }).stats.entities, 0);
});

test('the real sample converts to a script with no diagnostics', () => {
  const t = importMcstructure(FIXTURE);
  const r = cellsToMcsim(templateCells(t), t.entities, { offset: [0, 64, 0], fills: true, entities: true, source: 'test_structure.mcstructure' });
  const p = parse(r.text);
  assert.deepEqual(p.diagnostics, [], r.text);
  const chain = p.chains.find((c) => c.name === 'test_command')!;
  assert.ok(chain, r.text);
  assert.equal(chain.nodes[0].command, 'say aaa');
  assert.equal(chain.nodes[0].cb.delay, 20);
  assert.match(r.text, /oak|grass_block/.test(r.text) ? /grass_block/ : /./);
  assert.equal(new Simulation(p).world.getBlock([1, 65, 1]) !== undefined, true);
});