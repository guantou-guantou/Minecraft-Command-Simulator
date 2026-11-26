import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/language/parser.ts';
import { Simulation } from '../src/engine/simulation.ts';
import { entityCommandCells } from '../src/bdx/entity-commands.ts';
import { buildBdx, parseBdx } from '../src/bdx/bdx.ts';
import type { SavedEntity } from '../src/engine/structure.ts';
import { byte, compound } from '../src/nbt/nbt.ts';

const stand = (pos: [number, number, number], extra: Partial<SavedEntity> = {}): SavedEntity => ({ type: 'minecraft:armor_stand', name: null, pos, rot: [0, 0], tags: [], items: {}, ...extra });
const item = (id: string, count = 1, components: Record<string, unknown> = {}) => ({ id, count, data: 0, components });

/** Runs the commands the way command blocks would: at the centre of their own block. */
function run(entities: SavedEntity[], base: [number, number, number]) {
  const r = entityCommandCells(entities, { start: [0, 0, 5], selfDestruct: true, rowLength: 4 });
  const s = new Simulation(parse('region(from=(-1000,-1000,-1000), to=(1000,1000,1000))'));
  const cmds = r.cells.filter((c) => c.block.cb).map((c) => ({ pos: c.pos, cmd: c.block.cb!.command }));
  for (const c of cmds) {
    const ok = s.runCommand(`/${c.cmd}`, null, [base[0] + c.pos[0] + 0.5, base[1] + c.pos[1], base[2] + c.pos[2] + 0.5]);
    if (!c.cmd.startsWith('fill')) assert.equal(ok, true, c.cmd);
  }
  return { r, s, cmds };
}

test('every entity is summoned back with its position, rotation, name, tags and items, even when several look alike', () => {
  const list: SavedEntity[] = [
    stand([1.5, 0, 2.5], { name: 'Same', rot: [90, -10], tags: ['a', 'b'], items: { 'slot.weapon.mainhand:0': item('minecraft:stick'), 'slot.armor.head:0': item('minecraft:iron_helmet') } }),
    stand([3.25, 1, 2.5], { name: 'Same', tags: ['c'] }),
    stand([3.25, 1, 2.5], { name: 'Same', tags: ['d'] }),
    stand([0.5, 0, 0.5]),
    { type: 'minecraft:cow', name: 'Bessie', pos: [5.75, 2, 7.125], rot: [-45, 5], tags: ['needs space'], items: {} },
  ];
  const base: [number, number, number] = [100, 64, -200];
  const { s, r } = run(list, base);
  assert.equal(r.stats.entities, 5);
  const got = s.world.entities;
  assert.equal(got.length, 5);
  list.forEach((e, i) => {
    assert.equal(got[i].type, e.type);
    assert.deepEqual(got[i].pos.map((v) => Math.round(v * 1e4) / 1e4), e.pos.map((v, k) => v + base[k]));
    assert.deepEqual(got[i].rot, e.rot);
    assert.equal(got[i].name, e.name);
    assert.deepEqual([...got[i].tags].sort(), [...e.tags].sort(), `entity ${i}`);
    for (const [k, it] of Object.entries(e.items)) assert.equal(got[i].items[k]?.id, it.id);
  });
  assert.ok(got.every((g) => !g.tags.has('mcsim_tmp')));
});

test('layout: impulse head, chain blocks, winding rows, a button beside the head and a final clean-up fill', () => {
  const list = Array.from({ length: 6 }, (_, i) => stand([i + 0.5, 0, 0.5], { tags: ['t'] }));
  const r = entityCommandCells(list, { start: [0, 0, 10], selfDestruct: true, rowLength: 5 });
  const cbs = r.cells.filter((c) => c.block.cb);
  assert.equal(cbs.length, r.stats.commandBlocks);
  assert.equal(cbs[0].block.id, 'minecraft:command_block');
  assert.equal(cbs[0].block.cb!.power, 'needs_redstone');
  assert.ok(cbs.slice(1).every((c) => c.block.id === 'minecraft:chain_command_block' && c.block.cb!.power === 'always_on'));
  // every block points at the next one
  const dir = { 3: [0, 0, 1], 4: [-1, 0, 0], 5: [1, 0, 0] } as Record<number, number[]>;
  for (let i = 0; i < cbs.length - 1; i++) {
    const f = dir[cbs[i].block.states.facing_direction as number];
    assert.deepEqual(cbs[i].pos.map((v, k) => v + f[k]), cbs[i + 1].pos, `block ${i}`);
  }
  const button = r.cells.find((c) => c.block.id === 'minecraft:stone_button')!;
  assert.deepEqual(button.pos, [cbs[0].pos[0] - 1, cbs[0].pos[1], cbs[0].pos[2]]);
  assert.deepEqual(r.button, button.pos);
  assert.match(cbs[cbs.length - 1].block.cb!.command, /^fill (?:~-?\d* ){6}air$/);
  assert.equal(r.stats.selfDestruct, true);
  assert.equal(entityCommandCells(list, { start: [0, 0, 10], selfDestruct: false }).stats.selfDestruct, false);
  assert.equal(entityCommandCells([], { start: [0, 0, 0], selfDestruct: true }).cells.length, 0);
});

test('the clean-up fill removes exactly the helper area', () => {
  const list = Array.from({ length: 9 }, (_, i) => stand([i + 0.5, 0, 0.5]));
  const { r, s, cmds } = run(list, [0, 64, 0]);
  void s;
  const last = cmds[cmds.length - 1];
  const nums = last.cmd.split(' ').slice(1, 7).map((t) => (t === '~' ? 0 : Number(t.slice(1))));
  const from = nums.slice(0, 3).map((v, k) => v + last.pos[k]);
  const to = nums.slice(3).map((v, k) => v + last.pos[k]);
  for (const c of r.cells) assert.ok(c.pos.every((v, k) => v >= from[k] && v <= to[k]), `${c.block.id} at ${c.pos} is inside the cleared box`);
  assert.equal((to[0] - from[0] + 1) * (to[1] - from[1] + 1) * (to[2] - from[2] + 1) >= r.cells.length, true);
});

test('common babies get their spawn event; unknown ones and dropped items are reported', () => {
  const baby = compound({ IsBaby: byte(1) });
  const r = entityCommandCells([
    { type: 'minecraft:cow', name: null, pos: [0.5, 0, 0.5], rot: [0, 0], tags: [], items: {}, raw: baby },
    { type: 'minecraft:zombie', name: 'Z', pos: [1.5, 0, 0.5], rot: [0, 0], tags: [], items: {}, raw: baby },
    { type: 'minecraft:axolotl', name: null, pos: [2.5, 0, 0.5], rot: [0, 0], tags: [], items: {}, raw: baby },
    { type: 'minecraft:item', name: null, pos: [3.5, 0, 0.5], rot: [0, 0], tags: [], items: {} },
    stand([4.5, 0, 0.5], { tags: ['x'], items: { 'slot.weapon.mainhand:0': item('minecraft:diamond_sword', 1, { 'minecraft:enchantments': { sharpness: 3 } }) } }),
  ], { start: [0, 0, 3], selfDestruct: false });
  const cmds = r.cells.flatMap((c) => (c.block.cb ? [c.block.cb.command] : []));
  assert.match(cmds[0], /^summon cow ~\S* ~\S* ~\S* 0 0 minecraft:ageable_set_baby$/);
  assert.match(cmds[1], /minecraft:as_baby "Z"$/);
  assert.match(cmds[2], /^summon axolotl /);
  assert.ok(!/minecraft:/.test(cmds[2].replace('minecraft:entity_spawned', '')));
  assert.ok(r.notes.some((n) => /1 dropped item entities/.test(n)));
  assert.ok(r.notes.some((n) => /1 baby entities have no known spawn event/.test(n)));
  assert.ok(r.notes.some((n) => /1 item\(s\) had enchantments/.test(n)));
  assert.equal(r.stats.entities, 4);
  assert.equal(r.stats.skipped, 1);
});

test('the helper chain survives the BDX file', () => {
  const r = entityCommandCells([stand([1.5, 0, 1.5], { name: 'n', tags: ['a'] })], { start: [0, 0, 4], selfDestruct: true });
  const parsed = parseBdx(buildBdx(r.cells).content).blocks;
  assert.equal(parsed.filter((b) => b.cb).length, r.stats.commandBlocks);
  assert.equal(parsed.find((b) => b.cb)!.cb!.mode, 'imp');
  assert.ok(parsed.some((b) => b.name === 'stone_button' && b.states.includes('"facing_direction"=4')));
});