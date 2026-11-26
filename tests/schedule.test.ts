import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/language/parser.ts';
import { Simulation } from '../src/engine/simulation.ts';
import { exportCommands, exportManifest } from '../src/export.ts';

function load(src: string): Simulation {
  const p = parse(src);
  assert.deepEqual(p.diagnostics, []);
  return new Simulation(p);
}

const says = (s: Simulation) => s.events.filter((e) => e.type === 'chat' && e.kind === 'say').map((e) => [e.tick, e.type === 'chat' ? e.text : '']);

test('impulse chain: zero delay runs in the same tick, delay waits', () => {
  const s = load(`
chain c:
    /say a
    /say b
    cb(delay=3)
    /say c
`);
  s.activate('c');
  s.advance(1);
  assert.deepEqual(says(s), [[0, 'a'], [0, 'b']]);
  s.advance(5);
  assert.deepEqual(says(s), [[0, 'a'], [0, 'b'], [3, 'c']]);
});

test('needs_redstone impulse does nothing until activated', () => {
  const s = load('/say hi');
  s.advance(3);
  assert.deepEqual(says(s), []);
  s.activate('main');
  s.advance(1);
  assert.deepEqual(says(s), [[3, 'hi']]);
});

test('always_on repeat runs every tick; delay sets the period; deactivate stops', () => {
  const s = load(`
chain fast:
    cb(mode=rep, power=always_on)
    /say f
chain slow:
    cb(mode=rep, power=needs_redstone, delay=2)
    /say s
`);
  s.advance(3);
  assert.deepEqual(says(s).filter(([, t]) => t === 'f').map(([t]) => t), [0, 1, 2]);
  assert.equal(says(s).some(([, t]) => t === 's'), false);
  s.activate('slow');
  s.advance(5);
  assert.deepEqual(says(s).filter(([, t]) => t === 's').map(([t]) => t), [5, 7]);
  s.deactivate('slow');
  s.advance(4);
  assert.deepEqual(says(s).filter(([, t]) => t === 's').map(([t]) => t), [5, 7]);
});

test('delayed conditional reads the previous block last result', () => {
  const s = load(`
chain c:
    /tag @a[name=none] add x
    cb(conditional=true, delay=2)
    /say skipped
    /say ok
`);
  s.activate('c');
  s.advance(4);
  assert.deepEqual(says(s), [[2, 'ok']]);
});

test('always_on repeat fires once per tick, not unboundedly', () => {
  const s = load(`
chain loop:
    cb(mode=rep, power=always_on)
    /say x
`);
  s.advance(2);
  assert.equal(says(s).length, 2);
});

test('only the first block may be imp or rep', () => {
  const p = parse('chain c:\n /say a\n cb(mode=rep)\n /say b');
  assert.deepEqual(p.diagnostics.map((d) => d.line), [4]);
});

test('scoreboard timer pattern', () => {
  const s = load(`
chain boot:
    /scoreboard objectives add sys dummy
    /scoreboard players set timer sys 0
chain tick:
    cb(mode=rep, power=always_on)
    /scoreboard players add timer sys 1
    /execute if score timer sys matches 3.. run say tick3
    /execute if score timer sys matches 3.. run scoreboard players set timer sys 0
`);
  s.runChain('boot');
  s.activate('tick');
  s.advance(7);
  assert.deepEqual(says(s), [[2, 'tick3'], [5, 'tick3']]);
  assert.equal(s.world.scores.get('sys')!.get('n:timer'), 1);
});

test('scoreboard errors and operations', () => {
  const s = load(`ent(type=player, position=(0,0,0), name=alice)`);
  assert.equal(s.runCommand('/scoreboard players add alice nope 1', null, [0, 0, 0]), false);
  s.runCommand('/scoreboard objectives add a dummy', null, [0, 0, 0]);
  s.runCommand('/scoreboard players set alice a 7', null, [0, 0, 0]);
  s.runCommand('/scoreboard players set k a 3', null, [0, 0, 0]);
  s.runCommand('/scoreboard players operation alice a %= k a', null, [0, 0, 0]);
  assert.equal(s.world.scores.get('a')!.get('e:1'), 1);
  assert.equal(s.runCommand('/scoreboard players operation alice a /= zero a', null, [0, 0, 0]), false);
  s.runCommand('/scoreboard players set alice a 2147483647', null, [0, 0, 0]);
  s.runCommand('/scoreboard players add alice a 1', null, [0, 0, 0]);
  assert.equal(s.world.scores.get('a')!.get('e:1'), -2147483648);
  assert.equal(s.runCommand('/execute if score alice a matches ..-1 run say neg', null, [0, 0, 0]), true);
  s.runCommand('/scoreboard players reset * a', null, [0, 0, 0]);
  assert.equal(s.world.scores.get('a')!.size, 0);
});

test('export: commands only, and manifest with block settings', () => {
  const p = parse(`
ent(type=player, position=(0,0,0), name=x)
chain one at (1, 2, 3):
    /say a
    cb(conditional=true, delay=5)
    /say b
chain two:
    /say other
`);
  assert.equal(exportCommands(p.chains[0]), 'say a\nsay b\n');
  assert.equal(
    exportManifest(p.chains[0]),
    '# chain one at (1, 2, 3) facing east rotation (0, 0)\n[1] imp | needs_redstone | unconditional | delay 0 | facing east | at (1, 2, 3)\nsay a\n[2] cha | always_on | conditional | delay 5 | facing east | at (2, 2, 3)\nsay b\n',
  );
});
