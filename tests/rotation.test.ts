import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/language/parser.ts';
import { Simulation } from '../src/engine/simulation.ts';

function load(src: string): Simulation {
  const p = parse(src);
  assert.deepEqual(p.diagnostics, []);
  return new Simulation(p);
}

const traces = (s: Simulation) => s.events.flatMap((e) => (e.type === 'trace' ? [e.message] : []));
const errors = (s: Simulation) => s.events.flatMap((e) => (e.type === 'chat' && e.kind === 'error' ? [e.text] : []));

test('user script: tp with c=1 from the default origin, rotated as, ^^^ coordinates', () => {
  const s = load(`
ent(type=armor_stand,position=(0,0,0),name="a")
ent(type=armor_stand,position=(0,0,1),name="a")
/tp @e[name="a",c=1] ~ ~ ~ 90 ~
/execute positioned 0.0 100 0.0 rotated as @e[name="a"] positioned ^^^0.5 run say 1
`);
  s.runChain('main');
  assert.deepEqual(errors(s), []);
  assert.deepEqual(s.world.entities.map((e) => e.rot), [[90, 0], [0, 0]]);
  assert.deepEqual(s.world.entities.map((e) => e.pos), [[0, 0, 0], [0.5, 0, 1.5]]);
  assert.equal(s.events.filter((e) => e.type === 'chat' && e.kind === 'say').length, 2);
  const t = traces(s);
  assert.ok(t.includes('positioned (-0.5, 100, 0)'), t.join('\n'));
  assert.ok(t.includes('positioned (0, 100, 0.5)'), t.join('\n'));
});

test('local coordinates follow yaw and pitch', () => {
  const s = load(`ent(type=player, position=(0,0,0), name=p, rotation=(0,0))`);
  const run = (cmd: string) => {
    s.events = [];
    s.runCommand(cmd, null, [0, 0, 0]);
    return traces(s)[0];
  };
  assert.equal(run('/execute rotated 0 0 positioned ^ ^ ^1 run say x'), 'rotated (0, 0)');
  const pos = (cmd: string) => traces(s).find((m) => m.startsWith('positioned'));
  run('/execute rotated 0 0 positioned ^1 ^ ^ run say x');
  assert.equal(pos(''), 'positioned (1, 0, 0)');
  run('/execute rotated 90 0 positioned ^ ^ ^1 run say x');
  assert.equal(pos(''), 'positioned (-1, 0, 0)');
  run('/execute rotated 0 -90 positioned ^ ^ ^1 run say x');
  assert.equal(pos(''), 'positioned (0, 1, 0)');
  run('/execute rotated 0 0 positioned ^^^2 run say x');
  assert.equal(pos(''), 'positioned (0, 0, 2)');
  run('/execute positioned ~~1~ run say x');
  assert.equal(pos(''), 'positioned (0, 1, 0)');
  run('/execute positioned ~1 ^ ^ run say x');
  assert.deepEqual(errors(s), ['Cannot mix local (^) and world coordinates']);
});

test('tp to coordinates, relative rotation, and to another entity', () => {
  const s = load(`
ent(type=player, position=(1,2,3), name=p, rotation=(10, 5))
ent(type=armor_stand, position=(9,9,9), name=q, rotation=(45, 0))
`);
  s.runCommand('/tp p ~ ~1 ~ ~20 ~', null, [0, 0, 0]);
  assert.deepEqual([s.world.entities[0].pos, s.world.entities[0].rot], [[0, 1, 0], [20, 0]]);
  s.runCommand('/execute rotated 100 30 run tp p ~ ~ ~ ~20 ~-10', null, [0, 0, 0]);
  assert.deepEqual(s.world.entities[0].rot, [120, 20]);
  s.runCommand('/tp p q', null, [0, 0, 0]);
  assert.deepEqual([s.world.entities[0].pos, s.world.entities[0].rot], [[9.5, 9, 9.5], [45, 0]]);
  s.runCommand('/tp 0 0 0 200', s.world.entities[0], [0, 0, 0]);
  assert.deepEqual(s.world.entities[0].rot, [-160, 0]);
  assert.equal(s.runCommand('/tp 1 2 3', null, [0, 0, 0]), false);
  assert.equal(s.runCommand('/tp p 1 2 3 facing 0 0 0', null, [0, 0, 0]), true);
  assert.equal(s.runCommand('/tp p 1 2 3 facing nobody', null, [0, 0, 0]), false);
  assert.equal(errors(s).length, 1);
});

test('chain without "at" runs at exactly (0,0,0), with "at" at the block center', () => {
  const s = load(`
ent(type=armor_stand,position=(0,0,0),name=near)
ent(type=armor_stand,position=(1,0,1),name=far)
chain plain:
    /tag @e[c=1] add hit
chain placed at (1, 0, 1):
    /tag @e[c=1] add hit2
`);
  s.runChain('plain');
  s.runChain('placed');
  assert.deepEqual([...s.findEntity('near')!.tags], ['hit']);
  assert.deepEqual([...s.findEntity('far')!.tags], ['hit2']);
});

test('rotation variables: rot(...) and bare 2-tuples, used by ent', () => {
  const p = parse(`
r1 = rot(90, 0)
r2 = (270, -45)
pos1 = (1, 2, 3)
ent(type=armor_stand, position=pos1, rotation=r1, name=a)
ent(type=armor_stand, position=pos1, rotation=r2, name=b)
ent(type=armor_stand, position=pos1, rotation=rot(10, 20), name=c)
ent(type=armor_stand, position=pos1, rotation=(30, 40), name=d)
`);
  assert.deepEqual(p.diagnostics, []);
  assert.deepEqual(p.entities.map((e) => e.rotation), [[90, 0], [270, -45], [10, 20], [30, 40]]);
  const s = new Simulation(p);
  assert.deepEqual(s.findEntity('b')!.rot, [-90, -45]);
});

test('rotation variable errors', () => {
  const p = parse(`
r = rot(1, 100)
r3 = rot(1, 2, 3)
pos1 = (0, 0, 0)
r4 = (1, 2)
ent(type=player, position=r4, name=x)
ent(type=player, position=pos1, rotation=pos1, name=y)
ent(type=player, position=pos1, rotation=nope, name=z)
ent(type=player, position=pos1, rotation=(0, 91), name=w)
`);
  assert.deepEqual(p.diagnostics.map((d) => d.line), [2, 3, 6, 7, 8, 9]);
  assert.match(p.diagnostics[2].message, /is a rotation/);
  assert.match(p.diagnostics[3].message, /is a position/);
});

test('${var} expansion in commands', () => {
  const p = parse(`
pos1 = (1, 64.5, -3)
r1 = rot(90, -10)
ent(type=armor_stand, position=pos1, name=a)
/tp @e[name=a] \${pos1} \${r1}
/tp @e[name=a] \${pos1.x} \${pos1.y} \${pos1.z} \${r1.yrot} \${r1.xrot}
/say pos1 stays literal
`);
  assert.deepEqual(p.diagnostics, []);
  assert.deepEqual(p.chains[0].nodes.map((n) => n.command), [
    'tp @e[name=a] 1 64.5 -3 90 -10',
    'tp @e[name=a] 1 64.5 -3 90 -10',
    'say pos1 stays literal',
  ]);
  const s = new Simulation(p);
  s.runChain('main');
  assert.deepEqual([s.world.entities[0].pos, s.world.entities[0].rot], [[1.5, 64.5, -2.5], [90, -10]]);
});

test('${var} errors keep line numbers and do not leak a cb to the next command', () => {
  const p = parse(`
pos1 = (0, 0, 0)
r1 = rot(1, 2)
cb(delay=5)
/say \${nope}
/say \${pos1.yrot}
/say \${r1.x}
/say ok
`);
  assert.deepEqual(p.diagnostics.map((d) => d.line), [5, 6, 7]);
  assert.deepEqual(p.chains[0].nodes.map((n) => [n.command, n.cb.delay]), [['say ok', 0]]);
});
