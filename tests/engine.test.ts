import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/language/parser.ts';
import { Simulation } from '../src/engine/simulation.ts';

const scene = `
ent(type=player, position=(0.5, 65, 0.5), name=alice)
ent(type=player, position=(3.5, 65, 0.5), name=bob)
block(type=gold_block, position=(0, 64, 0))
block(type=stone, position=(3, 64, 0))
`;

function load(src: string): Simulation {
  const p = parse(src);
  assert.deepEqual(p.diagnostics, []);
  return new Simulation(p);
}

const tags = (s: Simulation, n: string) => [...s.findEntity(n)!.tags];

test('with at @s only the player on gold gets the tag', () => {
  const s = load(`${scene}
chain gate at (8, 65, 0):
    /execute as @a at @s if block ~ ~-1 ~ minecraft:gold_block run tag @s add ready
`);
  const [r] = s.runChain('gate');
  assert.equal(r.success, true);
  assert.deepEqual(tags(s, 'alice'), ['ready']);
  assert.deepEqual(tags(s, 'bob'), []);
  assert.ok(s.events.some((e) => e.type === 'trace' && e.branch === 'bob (player)' && e.status === 'condition_false'));
});

test('without at @s the check uses the chain position', () => {
  const s = load(`${scene}
chain gate at (8, 65, 0):
    /execute as @a if block ~ ~-1 ~ gold_block run tag @s add ready
`);
  const [r] = s.runChain('gate');
  assert.equal(r.success, false);
  assert.deepEqual(tags(s, 'alice'), []);
  assert.deepEqual(tags(s, 'bob'), []);
});

test('say example produces a chat event with executor', () => {
  const s = load(`
ent(type=armor_stand, position=(0,0,0), name=a)
/execute as @e[name=a] at @s run say aaa
`);
  s.runChain('main');
  const chats = s.events.filter((e) => e.type === 'chat');
  assert.deepEqual(chats.map((c) => [c.kind, c.sender, c.text, c.line]), [['say', 'a', 'aaa', 3]]);
  assert.equal(s.findEntity('a')!.tags.size, 0);
});

test('conditional block reads the previous result', () => {
  const s = load(`${scene}
chain c:
    /tag @a[name=nobody] add x
    cb(mode=cha, conditional=true)
    /say should be skipped
    cb(mode=cha)
    /say runs anyway
`);
  const res = s.runChain('c');
  assert.deepEqual(res.map((r) => [r.success, r.skipped]), [[false, false], [false, true], [true, false]]);
  assert.deepEqual(s.events.filter((e) => e.type === 'chat').map((e) => e.text), ['runs anyway']);
});

test('reset restores scene and clears events', () => {
  const s = load(`${scene}
/execute as @a run tag @s add t
/setblock 0 64 0 stone
`);
  s.runChain('main');
  assert.equal(s.world.getBlock([0, 64, 0]), 'minecraft:stone');
  s.reset();
  assert.equal(s.world.getBlock([0, 64, 0]), 'minecraft:gold_block');
  assert.deepEqual(tags(s, 'alice'), []);
  assert.equal(s.events.length, 0);
});

test('negative coordinates floor correctly', () => {
  const s = load(`
ent(type=player, position=(-0.5, 65, -0.5), name=p)
block(type=gold_block, position=(-1, 64, -1))
/execute as @a at @s if block ~ ~-1 ~ gold_block run say hit
`);
  s.runChain('main');
  assert.equal(s.events.some((e) => e.type === 'chat' && e.text === 'hit'), true);
});

test('unsupported things are reported, not ignored', () => {
  const s = load(`ent(type=player, position=(0,0,0), name=p)`);
  assert.equal(s.runCommand('/locate biome plains', null, [0, 0, 0]), false);
  assert.equal(s.runCommand('/execute as @a[limit=1] run say x', null, [0, 0, 0]), false);
  assert.equal(s.runCommand('/tag @s add x', null, [0, 0, 0]), false);
  const statuses = s.events.filter((e) => e.type === 'trace').map((e) => e.status);
  assert.deepEqual(statuses, ['unimplemented', 'unimplemented', 'failed']);
  assert.equal(s.events.filter((e) => e.type === 'chat' && e.kind === 'error').length, 3);
});

test('outside the simulated region is not treated as air', () => {
  const s = load(`
region(from=(0,0,0), to=(10,10,10))
ent(type=player, position=(5.5, 0.5, 5.5), name=p)
/execute as @a at @s if block ~ ~-1 ~ air run say bad
`);
  s.runChain('main');
  assert.equal(s.events.some((e) => e.type === 'chat' && e.kind === 'say'), false);
  assert.ok(s.events.some((e) => e.type === 'trace' && /outside the simulated region/.test(e.message)));
});
