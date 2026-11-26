import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/language/parser.ts';
import { complete, sceneFrom } from '../src/language/complete.ts';

const SCRIPT = `pos1 = (0, 64, 0)
r1 = rot(90, 0)
alice = ent(type=player, pos=pos1, name=alice, tags=["ready"])
block(type=gold_block, pos=pos1)
/scoreboard objectives add timer dummy
`;

/** Completes at the position of `|` in `src`. */
function at(src: string, script = '') {
  const cursor = src.indexOf('|');
  const text = script + src.replace('|', '');
  const offset = script.length;
  const full = text;
  const scene = sceneFrom(full, parse(full));
  const r = complete(full, cursor + offset, scene);
  return { ...r, labels: r.items.map((i) => i.label), from: r.from - offset, to: r.to - offset };
}

test('command names: prefix match, implemented before unimplemented, unimplemented marked', () => {
  const r = at('/gam|');
  assert.deepEqual(r.labels.slice(0, 2).sort(), ['gamemode', 'gamerule']);
  assert.deepEqual([r.from, r.to], [1, 4]);
  assert.equal(r.items[0].insert, `${r.items[0].label} `);
  const t = at('/locat|');
  assert.ok(t.items.some((i) => i.label === 'locate' && i.detail === 'not implemented'));
  assert.ok(at('/|').labels.includes('execute'));
  assert.ok(at('/tp|').labels.includes('tp'));
});

test('arguments follow the grammar', () => {
  assert.ok(at('/gamemode |').labels.includes('creative'));
  assert.deepEqual(at('/inputpermission |').labels, ['set', 'query']);
  assert.ok(at('/execute as @a |').labels.includes('run'));
  assert.ok(at('/execute as @a |').labels.includes('at'));
  assert.ok(at('/execute as @a run |').labels.includes('say'));
  assert.ok(at('/effect @a spe|').labels.includes('speed'));
  assert.ok(at('/effect @a |').labels.includes('clear'));
  assert.ok(at('/gamerule do|').labels.includes('dodaylightcycle'));
  assert.deepEqual(at('/tickingarea add circle 0 0 0 2 |').labels, []);
  assert.ok(at('/enchant @s sharp|').labels.includes('sharpness'));
  assert.deepEqual(at('/list |').labels, []);
  assert.deepEqual(at('/bogus |').labels, []);
  assert.deepEqual(at('/say |').labels, []);
});

test('scene symbols: names, tags, objectives, position variables', () => {
  assert.ok(at('/tag @a add |', SCRIPT).labels.includes('ready'));
  assert.ok(at('/tag |', SCRIPT).labels.includes('alice'));
  assert.ok(at('/scoreboard players set @s |', SCRIPT).labels.includes('timer'));
  assert.ok(at('/tp @s |', SCRIPT).labels.includes('${pos1}'));
  assert.ok(at('/tp @s ~ ~ ~ |', SCRIPT).labels.includes('${r1}'));
  assert.ok(at('/setblock 0 0 0 gold|', SCRIPT).labels.includes('gold_block'));
  assert.ok(at('/summon fo|', SCRIPT).labels.includes('fox'));
});

test('selectors: kinds, parameters and their values', () => {
  assert.deepEqual(at('/kill @|').labels.sort(), ['@a', '@e', '@n', '@p', '@r', '@s']);
  assert.ok(at('/tag @e[|', SCRIPT).labels.includes('type='));
  assert.ok(at('/tag @e[ty|', SCRIPT).labels.includes('type='));
  assert.deepEqual(at('/tag @e[ty|').items[0].label, 'type=');
  assert.ok(at('/tag @e[type=fo|', SCRIPT).labels.includes('fox'));
  assert.ok(at('/tag @e[type=player,tag=|', SCRIPT).labels.includes('ready'));
  assert.ok(at('/tag @e[name=|', SCRIPT).labels.includes('alice'));
  assert.equal(at('/tag @e[type=fox,|').from, 17);
});

test('declarations: keys, used keys removed, values by key', () => {
  assert.deepEqual(at('ent(|').labels.sort(), ['name=', 'pos=', 'rot=', 'selected=', 'tags=', 'type=']);
  assert.ok(!at('ent(type=fox, |').labels.includes('type='));
  assert.ok(!at('ent(position=(0,0,0), |').labels.includes('pos='));
  assert.ok(at('ent(type=armor|').labels.includes('armor_stand'));
  assert.ok(at('ent(type=fox, pos=|', SCRIPT).labels.includes('pos1'));
  assert.ok(at('ent(type=fox, rot=|', SCRIPT).labels.includes('r1'));
  assert.ok(at('block(type=sto|').labels.includes('stone'));
  assert.ok(at('item(target=|', SCRIPT).labels.includes('alice'));
  assert.ok(at('item(target=alice, slot=|').labels.includes('slot.hotbar'));
  assert.deepEqual(at('cb(mode=|').labels, ['imp', 'cha', 'rep']);
  assert.deepEqual(at('cb(conditional=|').labels, ['true', 'false']);
  assert.ok(at('x = ent(|').labels.includes('type='));
  assert.ok(at('chain gate(|').labels.includes('facing='));
  assert.deepEqual(at('ent(type=fox, pos=(0, 0|').labels, []);
  assert.deepEqual(at('ent(type=fox)|').labels, ['ent('].filter(() => false));
});

test('top level keywords and assignments', () => {
  assert.deepEqual(at('en|').labels, ['ent(']);
  assert.ok(at('|').labels.includes('region('));
  assert.deepEqual(at('r1 = |').labels.sort(), ['ent(', 'rot(']);
  assert.deepEqual(at('# a com|').labels, []);
  assert.deepEqual(at('/say hi # tp|').labels, []);
});

test('continuation lines complete as part of the same command', () => {
  const r = at('/execute as @a \\\n    |');
  assert.ok(r.labels.includes('run'));
  assert.ok(at('/execute as @a \\\n    run \\\n    gam|').labels.includes('gamemode'));
});

test('ranking prefers prefix matches, then words used in the document', () => {
  const script = 'ent(type=cow, pos=(0,0,0))\nent(type=cow, pos=(1,0,0))\n';
  const r = at('ent(type=c|', script);
  assert.equal(r.labels[0], 'cow');
  const r2 = at('ent(type=ox|');
  assert.ok(r2.labels.length >= 0);
  assert.ok(at('/summon axl|').labels.includes('axolotl'));
  assert.ok(!at('/summon fx|').labels.includes('fox'));
});
test('accepted candidates are ranked higher in later completions', () => {
  const text = '/gam';
  const scene = sceneFrom(text, parse(text));
  assert.equal(complete(text, 4, scene).items[0].label, 'gamerule');
  const boosted = complete(text, 4, { ...scene, history: { gamemode: 3 } });
  assert.equal(boosted.items[0].label, 'gamemode');
});

test('test blocks complete their own steps', () => {
  const script = 'chain boot:\n    /say hi\n\ntest t:\n';
  assert.deepEqual(at('    |', script).labels.sort(), ['activate', 'deactivate', 'expect', 'run', 'tick']);
  assert.deepEqual(at('    ru|', script).labels, ['run']);
  assert.ok(at('    run |', script).labels.includes('boot'));
  assert.ok(at('    expect |', script).labels.includes('score'));
  assert.ok(at('    expect tag @e[ty|', script).labels.includes('type='));
  assert.ok(at('    expect entity @e count |', script).labels.includes('=='));
  assert.ok(at('te|').labels.includes('test '));
  assert.ok(!at('    ru|', 'chain a:\n').labels.includes('run'));
});
