import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import lib from '../electron/lib.cjs';
import { parse } from '../src/language/parser.ts';
import { buildBdx, parseBdx, templateCells, type BdxCell } from '../src/bdx/bdx.ts';
import { exportSceneBlocks } from '../src/engine/scene-export.ts';
import type { StructureTemplate } from '../src/engine/structure.ts';
import type { BlockData } from '../src/engine/types.ts';
import { exportMcstructure, importMcstructure } from '../src/nbt/mcstructure.ts';
import { byte, compound, int, list, readNbt, string, writeNbt, type Nbt } from '../src/nbt/nbt.ts';

const FIXTURE = new Uint8Array(fs.readFileSync(new URL('./fixtures/test_structure.mcstructure', import.meta.url)));
const at = (pos: [number, number, number], block: BlockData): BdxCell => ({ pos, block });
const field = (n: Nbt | undefined, k: string): Nbt | undefined => (n?.t === 'compound' ? n.v[k] : undefined);

test('a command block is written as operation 36 with its data value, mode, delay and flags', () => {
  const { content } = buildBdx([at([0, 0, 0], {
    id: 'minecraft:chain_command_block', states: { conditional_bit: true, facing_direction: 3 },
    cb: { command: 'say hi', delay: 20, power: 'always_on', line: 0, rotation: [0, 0], name: 'n', firstTick: true, track: false },
  })], 'A');
  const bytes = [...'BDX'].map((c) => c.charCodeAt(0)).concat([0, 65, 0, 36, 0, 11, 0, 0, 0, 2], [...'say hi'].map((c) => c.charCodeAt(0)), [0, 110, 0, 0, 0, 0, 0, 20, 1, 0, 1, 0, 88, 69]);
  assert.deepEqual([...content], bytes);
});

test('movement picks the shortest operation and negative or large steps survive', () => {
  const cells = [at([0, 0, 0], { id: 'minecraft:stone', states: {} }), at([1, 0, 0], { id: 'minecraft:stone', states: {} }), at([1, 0, 70], { id: 'minecraft:stone', states: {} }), at([1, 3, 70], { id: 'minecraft:stone', states: {} }), at([1, 3, -9], { id: 'minecraft:stone', states: {} }), at([300, 3, -9], { id: 'minecraft:stone', states: {} }), at([300, 3, -200000], { id: 'minecraft:stone', states: {} }), at([-5, -2, 4], { id: 'minecraft:stone', states: {} })];
  const parsed = parseBdx(buildBdx(cells).content).blocks.map((b) => b.pos);
  const sorted = [...cells].sort((a, b) => a.pos[0] - b.pos[0] || a.pos[1] - b.pos[1] || a.pos[2] - b.pos[2]).map((c) => c.pos);
  assert.deepEqual(parsed, sorted);
});

test('direction, attachment and on/off states of trapdoors, signs, buttons and levers are kept as block states', () => {
  const sign: Nbt = compound({
    id: string('Sign'), isMovable: byte(1), x: int(0), y: int(0), z: int(0),
    FrontText: compound({ Text: string('hello\nworld'), SignTextColor: int(-16777216), HideGlowOutline: byte(0) }),
    BackText: compound({ Text: string('back') }),
  });
  const blocks: BlockData[] = [
    { id: 'minecraft:oak_trapdoor', states: { direction: 2, open_bit: true, upside_down_bit: true } },
    { id: 'minecraft:iron_trapdoor', states: { direction: 1, open_bit: false, upside_down_bit: false } },
    { id: 'minecraft:stone_button', states: { button_pressed_bit: true, facing_direction: 4 } },
    { id: 'minecraft:lever', states: { lever_direction: 'down_north_south', open_bit: true } },
    { id: 'minecraft:standing_sign', states: { ground_sign_direction: 13 }, entityNbt: sign },
    { id: 'minecraft:wall_sign', states: { facing_direction: 5 }, entityNbt: sign },
    { id: 'minecraft:chest', states: { 'minecraft:cardinal_direction': 'west' }, items: { 'slot.container:4': { id: 'minecraft:apple', count: 5, data: 0, components: { 'minecraft:enchantments': { sharpness: 3 } } } } },
  ];
  const tpl: StructureTemplate = { size: [blocks.length, 1, 1], origin: [10, 64, 10], blocks, entities: [] };
  const parsed = parseBdx(buildBdx(templateCells(tpl)).content).blocks;
  assert.equal(parsed.length, 7);
  assert.equal(parsed[0].name, 'oak_trapdoor');
  assert.equal(parsed[0].states, '["direction"=2,"open_bit"=true,"upside_down_bit"=true]');
  assert.equal(parsed[2].states, '["button_pressed_bit"=true,"facing_direction"=4]');
  assert.equal(parsed[3].states, '["lever_direction"="down_north_south","open_bit"=true]');
  assert.equal(parsed[4].states, '["ground_sign_direction"=13]');
  assert.equal(parsed[5].states, '["facing_direction"=5]');
  assert.equal(parsed[6].states, '["minecraft:cardinal_direction"="west"]');
  for (const i of [4, 5]) {
    const front = field(parsed[i].nbt, 'FrontText');
    assert.deepEqual(field(front, 'Text'), string('hello\nworld'));
    assert.deepEqual(field(field(parsed[i].nbt, 'BackText'), 'Text'), string('back'));
    assert.deepEqual(field(parsed[i].nbt, 'id'), string('Sign'));
    assert.deepEqual(field(parsed[i].nbt, 'x'), int(i));
  }
  const items = field(parsed[6].nbt, 'Items');
  assert.equal(items?.t === 'list' ? items.v.length : 0, 1);
  assert.deepEqual(field(items?.t === 'list' ? items.v[0] : undefined, 'Name'), string('minecraft:apple'));
  assert.deepEqual(field(items?.t === 'list' ? items.v[0] : undefined, 'Slot'), byte(4));
  assert.equal(parsed[1].nbt, undefined);
});

test('sign text and other block entity data survive a trip through .mcstructure into BDX', () => {
  const sign = compound({ id: string('Sign'), x: int(1), y: int(2), z: int(3), FrontText: compound({ Text: string('line 1') }), IsWaxed: byte(1) });
  const tpl: StructureTemplate = {
    size: [1, 1, 1], origin: [1, 2, 3], entities: [],
    blocks: [{ id: 'minecraft:oak_sign', states: { ground_sign_direction: 4 }, entityNbt: sign }],
  };
  const back = importMcstructure(exportMcstructure(tpl));
  assert.equal(field(back.blocks[0].entityNbt, 'IsWaxed')?.t, 'byte');
  const parsed = parseBdx(buildBdx(templateCells(back)).content).blocks[0];
  assert.equal(parsed.states, '["ground_sign_direction"=4]');
  assert.deepEqual(field(field(parsed.nbt, 'FrontText'), 'Text'), string('line 1'));
  assert.deepEqual(field(parsed.nbt, 'IsWaxed'), byte(1));
});

test('the real sample converts to BDX: blocks, command block mode and delay, chest items', () => {
  const t = importMcstructure(FIXTURE);
  const { content, stats } = buildBdx(templateCells(t), 'tester');
  const r = parseBdx(content);
  assert.equal(r.author, 'tester');
  assert.equal(stats.commandBlocks, 1);
  const names = new Set(r.blocks.map((b) => b.name));
  assert.deepEqual([...names].sort(), ['chain_command_block', 'chest', 'dirt', 'grass_block', 'structure_block']);
  const cb = r.blocks.find((b) => b.cb)!;
  assert.deepEqual([cb.pos, cb.cb!.mode, cb.cb!.command, cb.cb!.delay, cb.cb!.conditional, cb.cb!.data, cb.cb!.name, cb.cb!.power], [[1, 1, 1], 'cha', 'say aaa', 20, true, 11, 'test_command', 'always_on']);
  const chest = r.blocks.find((b) => b.name === 'chest')!;
  assert.deepEqual(chest.pos, [2, 1, 2]);
  assert.equal(chest.states, '["minecraft:cardinal_direction"="south"]');
  assert.equal(r.blocks.filter((b) => b.name === 'grass_block').length, 8);
});

test('the BDX file is BD@ plus brotli of the content', () => {
  const { content } = buildBdx([at([0, 0, 0], { id: 'minecraft:stone', states: {} })]);
  const file = lib.bdxFile(content);
  assert.equal(Buffer.from(file).subarray(0, 3).toString('latin1'), 'BD@');
  const back = zlib.brotliDecompressSync(Buffer.from(file).subarray(3));
  assert.deepEqual([...back], [...content]);
  assert.equal(parseBdx(new Uint8Array(back)).blocks[0].name, 'stone');
});

test('a scene bigger than a structure and outside the region still exports as BDX', () => {
  const r = exportSceneBlocks(parse(`
region(from=(0,0,0), to=(10,10,10))
block(type=stone, position=(0, 0, 0))
block(type=oak_trapdoor, position=(500, 70, -300), states=["direction"=1, "open_bit"=true])
ent(type=cow, position=(5.5, 1, 5.5))
/say a
cb(mode=cha)
/say b
`));
  assert.deepEqual(r.size, [501, 71, 306]);
  assert.equal(r.entities.length, 1);
  assert.deepEqual(r.origin, [0, 0, -300]);
  assert.equal(r.placed.length, 1);
  const parsed = parseBdx(buildBdx(r.cells).content).blocks;
  assert.equal(parsed.length, 4);
  const trap = parsed.find((b) => b.name === 'oak_trapdoor')!;
  assert.deepEqual(trap.pos, [500, 70, 0]);
  assert.equal(trap.states, '["direction"=1,"open_bit"=true]');
  assert.equal(parsed.filter((b) => b.cb).length, 2);
});

test('NBT written for BDX can be read back exactly', () => {
  const n = compound({ a: int(1), l: list(10, [compound({ s: string('x') })]) });
  const bytes = writeNbt(n);
  assert.deepEqual(readNbt(bytes).value, n);
});