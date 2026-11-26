import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/language/parser.ts';
import { Simulation } from '../src/engine/simulation.ts';
import { exportScene } from '../src/engine/scene-export.ts';
import { formatSnbt, parseSnbt } from '../src/nbt/snbt.ts';
import { byte, compound, double, float, int, list, long, short, string, type Nbt } from '../src/nbt/nbt.ts';

test('SNBT writes and reads every tag type and keeps the types apart', () => {
  const n: Nbt = compound({
    b: byte(1), s: short(-3), i: int(7), l: long(5n), f: float(1.5), d: double(2), str: string('a "q" \\ b\nc'),
    list: list(10, [compound({ x: int(1) }), compound({ x: int(2) })]), empty: list(0, []), 'odd key': int(1),
    arr: { t: 'ints', v: [1, 2, 3] }, bytes: { t: 'bytes', v: [-1, 0, 5] }, longs: { t: 'longs', v: [1n, -2n] },
  });
  const text = formatSnbt(n);
  assert.match(text, /^\{b:1b,s:-3s,i:7,l:5L,f:1\.5f,d:2\.0d,/);
  assert.deepEqual(parseSnbt(text), n);
  assert.deepEqual(parseSnbt('{a:true,b:false,c:1.5,d:"x",e:\'y\'}'), compound({ a: byte(1), b: byte(0), c: double(1.5), d: string('x'), e: string('y') }));
  for (const bad of ['{a:}', '{a:1', '[1,"x"]', '{a:1} extra', '{a 1}', '"open']) assert.throws(() => parseSnbt(bad), /SNBT/, bad);
});

test('fill(...) declares a whole box and respects the region', () => {
  const p = parse(`
region(from=(0,0,0), to=(9,9,9))
fill(type=stone, from=(2,1,2), to=(0,0,0))
fill(type=oak_slab, from=(5,5,5), to=(6,5,6), states=["minecraft:vertical_half"="top"])
fill(type=dirt, from=(8,8,8), to=(12,8,8))
chain c(pos=(1,1,1), facing=east):
    /say hi
`);
  assert.deepEqual(p.fills.map((f) => [f.type, f.from, f.to]), [['minecraft:stone', [0, 0, 0], [2, 1, 2]], ['minecraft:oak_slab', [5, 5, 5], [6, 5, 6]], ['minecraft:dirt', [8, 8, 8], [12, 8, 8]]]);
  const msgs = p.diagnostics.map((d) => d.message);
  assert.ok(msgs.some((m) => /fill\(\.\.\.\) from \(8, 8, 8\) to \(12, 8, 8\) is outside/.test(m)), msgs.join('|'));
  assert.ok(msgs.some((m) => /inside the fill\(\.\.\.\) on line 3/.test(m)), msgs.join('|'));
  const s = new Simulation(p);
  assert.equal(s.world.getBlock([1, 1, 0]), 'minecraft:stone');
  assert.equal(s.world.getBlock([2, 1, 2]), 'minecraft:stone');
  assert.equal(s.world.getBlock([3, 1, 2]), 'minecraft:air');
  assert.deepEqual(s.world.getBlockData([6, 5, 5]).states, { 'minecraft:vertical_half': 'top' });
  assert.equal(s.world.getBlock([9, 8, 8]), 'minecraft:dirt');
});

test('block(..., nbt=...) keeps block entity data through the world and a structure export', () => {
  const p = parse('block(type=oak_sign, pos=(1,2,3), states=["ground_sign_direction"=4], nbt={id:"Sign",FrontText:{Text:"hello, world"},IsWaxed:1b})');
  assert.deepEqual(p.diagnostics, []);
  const s = new Simulation(p);
  const b = s.world.getBlockData([1, 2, 3]);
  assert.deepEqual(b.entityNbt, compound({ id: string('Sign'), FrontText: compound({ Text: string('hello, world') }), IsWaxed: byte(1) }));
  const r = exportScene(p);
  assert.deepEqual(r.template.blocks[0].entityNbt, b.entityNbt);
  assert.ok(parse('block(type=oak_sign, pos=(0,0,0), nbt=[1,2])').diagnostics.length > 0);
  assert.ok(parse('block(type=oak_sign, pos=(0,0,0), nbt={a:})').diagnostics.length > 0);
});