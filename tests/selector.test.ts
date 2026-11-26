import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/language/parser.ts';
import { Simulation } from '../src/engine/simulation.ts';

const SCRIPT = `world(seed=7)
a = ent(type=player, position=(0.0, 0, 0.0), name=alice, tags=["red"])
b = ent(type=player, position=(10.0, 0, 0.0), name=bob, tags=["blue"])
c = ent(type=player, position=(0.0, 0, 30.0), name=carl)
ent(type=zombie, position=(2.0, 0, 0.0), name=z1, rotation=(90, 10))
ent(type=zombie, position=(4.0, 0, 0.0), name=z2)
ent(type=cow, position=(0.0, 0, 4.0), name=cow1)
ent(type=armor_stand, position=(0.5, 0, 0.5), name=stand)
`;

function names(sel: string, from: [number, number, number] = [0, 0, 0], setup?: (s: Simulation) => void): string[] {
  const s = new Simulation(parse(SCRIPT));
  setup?.(s);
  return s.select(sel, from).map((e) => e.name ?? e.type).sort();
}
const throws = (sel: string) => {
  const s = new Simulation(parse(SCRIPT));
  assert.throws(() => s.select(sel), (e: Error) => e instanceof Error, sel);
};

test('kinds: @a players, @e everything, @p nearest player, @n nearest entity', () => {
  assert.deepEqual(names('@a'), ['alice', 'bob', 'carl']);
  assert.equal(names('@e').length, 7);
  assert.deepEqual(names('@p', [9, 0, 0]), ['bob']);
  assert.deepEqual(names('@n', [4.2, 0, 0]), ['z2']);
  assert.deepEqual(names('@p[c=2]', [9, 0, 0]), ['alice', 'bob']);
  assert.deepEqual(names('@e[c=-1]'), ['carl']);
  assert.deepEqual(names('@e[type=!player,c=2]'), ['stand', 'z1']);
});

test('@r is random but deterministic for a seed, defaults to players, and respects type and c', () => {
  const pick = (sel: string, seed?: number) => {
    const s = new Simulation(parse(SCRIPT));
    if (seed !== undefined) s.world.setSeed(seed);
    return Array.from({ length: 12 }, () => s.select(sel).map((e) => e.name).join('+'));
  };
  const a = pick('@r');
  assert.deepEqual(a, pick('@r'));
  assert.ok(a.every((n) => ['alice', 'bob', 'carl'].includes(n)));
  assert.ok(new Set(a).size > 1);
  assert.notDeepEqual(a, pick('@r', 99));
  assert.ok(pick('@r[type=zombie]').every((n) => n === 'z1' || n === 'z2'));
  assert.ok(pick('@r[type=zombie]').some((n) => n === 'z1') && pick('@r[type=zombie]').some((n) => n === 'z2'));
  assert.ok(pick('@r[c=2]').every((n) => n.split('+').length === 2));
  assert.ok(pick('@r[c=3]').every((n) => n.split('+').sort().join('+') === 'alice+bob+carl'));
  const s = new Simulation(parse(SCRIPT));
  const first = s.select('@r').map((e) => e.name);
  s.reset();
  assert.deepEqual(s.select('@r').map((e) => e.name), first);
});

test('name, type, tag, family with negation and repetition', () => {
  assert.deepEqual(names('@e[name=alice]'), ['alice']);
  assert.deepEqual(names('@a[name=!alice]'), ['bob', 'carl']);
  assert.deepEqual(names('@e[type=zombie,name=!z1]'), ['z2']);
  assert.deepEqual(names('@e[type=!player,type=!zombie,type=!armor_stand]'), ['cow1']);
  assert.deepEqual(names('@a[tag=red]'), ['alice']);
  assert.deepEqual(names('@a[tag=!red,tag=!blue]'), ['carl']);
  assert.deepEqual(names('@a[tag=]'), ['carl']);
  assert.deepEqual(names('@a[tag=!]'), ['alice', 'bob']);
  assert.deepEqual(names('@e[family=zombie]'), ['z1', 'z2']);
  assert.deepEqual(names('@e[family=mob,family=!monster,type=!player]'), ['cow1']);
  assert.deepEqual(names('@e[family=inanimate]'), ['stand']);
  const s = new Simulation(parse(SCRIPT));
  s.world.addEntity('minecraft:ghast', 'g', [0, 0, 0]);
  assert.throws(() => s.select('@e[family=monster]'), /no family data for ghast/);
});

test('x y z, r, rm and relative coordinates', () => {
  assert.deepEqual(names('@a[r=5]'), ['alice']);
  assert.deepEqual(names('@a[rm=5]'), ['bob', 'carl']);
  assert.deepEqual(names('@a[x=10,r=1]'), ['bob']);
  assert.deepEqual(names('@a[z=30,r=1]'), ['carl']);
  assert.deepEqual(names('@a[x=~,r=1]', [10, 0, 0]), ['bob']);
  assert.deepEqual(names('@a[x=~-10,r=1]', [10, 0, 0]), ['alice']);
  assert.deepEqual(names('@a[x=5,r=5,rm=5]'), ['alice', 'bob']);
});

test('dx dy dz volumes use entity boxes; whole-number origins cover whole blocks', () => {
  assert.deepEqual(names('@e[x=0,y=0,z=0,dx=0,dy=0,dz=0]'), ['alice', 'stand']);
  assert.deepEqual(names('@e[x=0,y=0,z=0,dx=5,dy=2,dz=0,type=!armor_stand]'), ['alice', 'z1', 'z2']);
  assert.deepEqual(names('@e[x=2,y=0,z=0,dx=-2,dy=0,dz=0,type=!armor_stand]'), ['alice', 'z1']);
  assert.deepEqual(names('@e[x=0,y=5,z=0,dx=0,dy=0,dz=0]'), []);
  assert.deepEqual(names('@e[x=-1,y=0,z=-1,dx=0,dz=0,type=player]'), ['alice']);
});

test('scores, hasitem-free filters l/lm/m, rx/ry, haspermission', () => {
  const setup = (s: Simulation) => {
    s.runCommand('/scoreboard objectives add n dummy', null, [0, 0, 0]);
    s.runCommand('/scoreboard players set alice n 3', null, [0, 0, 0]);
    s.runCommand('/scoreboard players set bob n 8', null, [0, 0, 0]);
    s.runCommand('/xp 5L @a[name=alice]', null, [0, 0, 0]);
    s.runCommand('/xp 20L @a[name=bob]', null, [0, 0, 0]);
    s.runCommand('/gamemode creative @a[name=bob]', null, [0, 0, 0]);
    s.runCommand('/inputpermission set @a[name=carl] movement disabled', null, [0, 0, 0]);
  };
  assert.deepEqual(names('@a[scores={n=1..5}]', [0, 0, 0], setup), ['alice']);
  assert.deepEqual(names('@a[scores={n=5..}]', [0, 0, 0], setup), ['bob']);
  assert.deepEqual(names('@a[scores={n=!3}]', [0, 0, 0], setup), ['bob']);
  assert.deepEqual(names('@a[scores={n=..10}]', [0, 0, 0], setup), ['alice', 'bob']);
  assert.deepEqual(names('@a[l=10]', [0, 0, 0], setup), ['alice', 'carl']);
  assert.deepEqual(names('@a[lm=10]', [0, 0, 0], setup), ['bob']);
  assert.deepEqual(names('@a[lm=1,l=10]', [0, 0, 0], setup), ['alice']);
  assert.deepEqual(names('@a[m=creative]', [0, 0, 0], setup), ['bob']);
  assert.deepEqual(names('@a[m=!c]', [0, 0, 0], setup), ['alice', 'carl']);
  assert.deepEqual(names('@a[m=1]', [0, 0, 0], setup), ['bob']);
  assert.deepEqual(names('@a[haspermission={movement=disabled}]', [0, 0, 0], setup), ['carl']);
  assert.deepEqual(names('@a[haspermission={movement=enabled}]', [0, 0, 0], setup), ['alice', 'bob']);
  assert.deepEqual(names('@e[l=10,type=zombie]', [0, 0, 0], setup), []);
  assert.deepEqual(names('@e[rxm=5,rx=15]'), ['z1']);
  assert.deepEqual(names('@e[rym=45,ry=135]'), ['z1']);
  assert.deepEqual(names('@e[ry=20,rym=-20,type=zombie]'), ['z2']);
  assert.deepEqual(names('@e[ry=-170,rym=170,type=zombie]'), []);
  throws('@a[scores={nope=1}]');
});

test('invalid selectors: unknown kind or argument, duplicates, bad values', () => {
  for (const bad of ['@x', '@initiator', '@a[bogus=1]', '@a[r=1,r=2]', '@a[r=!1]', '@a[c=0]', '@a[c=x]', '@a[m=banana]', '@a[scores={n}]', '@a[haspermission={movement=maybe}]', '@a[noequals]']) throws(bad);
});