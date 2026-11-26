import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/language/parser.ts';
import { Simulation } from '../src/engine/simulation.ts';

test('parses the user example with trailing comments', () => {
  const p = parse(`
pos1 = (0,0,0) # position variable
ent(type=armor_stand,position=pos1,name=a) # entity
/execute as @e[name=a] at @s run say aaa # command
`);
  assert.deepEqual(p.diagnostics, []);
  assert.deepEqual(p.entities.map((e) => [e.type, e.name, e.position]), [['minecraft:armor_stand', 'a', [0.5, 0, 0.5]]]);
  assert.equal(p.chains.length, 1);
  assert.equal(p.chains[0].name, 'main');
  assert.equal(p.chains[0].nodes[0].command, 'execute as @e[name=a] at @s run say aaa');
});

test('quoted names and # inside quotes', () => {
  const p = parse('ent(type=player, position=(1,2,3), name="stand #1")');
  assert.deepEqual(p.diagnostics, []);
  assert.equal(p.entities[0].name, 'stand #1');
});

test('command block defaults and cb overrides', () => {
  const p = parse(`
chain gate at (4, 5, 6):
    /say first
    cb(mode=cha, conditional=true, delay=20)
    /say second
    /say third
`);
  assert.deepEqual(p.diagnostics, []);
  const [a, b, c] = p.chains[0].nodes.map((n) => n.cb);
  assert.deepEqual(p.chains[0].position, [4, 5, 6]);
  assert.deepEqual(a, { mode: 'imp', conditional: false, power: 'needs_redstone', delay: 0 });
  assert.deepEqual(b, { mode: 'cha', conditional: true, power: 'always_on', delay: 20 });
  assert.deepEqual(c, { mode: 'cha', conditional: false, power: 'always_on', delay: 0 });
});

test('diagnostics carry line numbers', () => {
  const p = parse(`
cb(type=imp)
/say a
ent(type=armor_stand, position=nope)
chain x:
    cb(delay=-1)
    /say b
nonsense
cb(mode=cha)
`);
  assert.deepEqual(p.diagnostics.map((d) => d.line), [2, 4, 6, 8, 9]);
  assert.match(p.diagnostics[0].message, /mode=/);
  assert.match(p.diagnostics[1].message, /nope/);
});

test('first block cannot be conditional', () => {
  const p = parse('chain x:\n cb(conditional=true)\n /say a');
  assert.equal(p.diagnostics.length, 1);
  assert.equal(p.diagnostics[0].line, 3);
});

test('cb(first_tick=...) is parsed, validated and makes a repeating block run at once', () => {
  const p = parse('chain c:\n    cb(mode=rep, delay=10, first_tick=true, power=always_on)\n    /say tick');
  assert.deepEqual(p.diagnostics, []);
  assert.equal(p.chains[0].nodes[0].cb.firstTick, true);
  assert.ok(parse('chain c:\n    cb(first_tick=maybe)\n    /say a').diagnostics.length > 0);
  const run = (first: boolean) => {
    const s = new Simulation(parse(`chain c:\n    cb(mode=rep, delay=10, power=always_on${first ? ', first_tick=true' : ''})\n    /say tick`));
    s.activate('c');
    s.advance(1);
    return s.events.filter((e) => e.type === 'chat' && e.kind === 'say').length;
  };
  assert.equal(run(true), 1);
  assert.equal(run(false), 0);
});
