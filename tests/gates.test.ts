import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/language/parser.ts';
import { Simulation } from '../src/engine/simulation.ts';
import { exportAllCommands, exportAllManifest } from '../src/export.ts';

const says = (sim: Simulation) => sim.events.flatMap((e) => (e.type === 'chat' && e.kind === 'say' ? [e.text] : []));

const SAMPLE = `A = ent(type=player, pos=(0, 0, 0), name=A)
chain a at (0, 0, 0):
    if:
        /execute if entity @a[tag=go]
    run:
        /say 111
        /say 222
        /tag @a remove go
`;

test('an if:/run: chain is one chain: detector, switch block, run blocks and the switch back', () => {
  const p = parse(SAMPLE);
  assert.deepEqual(p.diagnostics, []);
  assert.deepEqual(p.chains.map((c) => c.name), ['a']);
  const a = p.chains[0];
  assert.deepEqual(a.nodes.map((n) => [n.cb.mode, n.cb.power, n.cb.conditional, n.pos, n.command]), [
    ['rep', 'always_on', false, [0, 0, 0], 'execute if entity @a[tag=go]'],
    ['cha', 'always_on', true, [1, 0, 0], 'setblock ~1 ~ ~ chain_command_block ["facing_direction"=5]'],
    ['imp', 'always_on', false, [2, 0, 0], 'say 111'],
    ['cha', 'always_on', false, [3, 0, 0], 'say 222'],
    ['cha', 'always_on', false, [4, 0, 0], 'tag @a remove go'],
    ['cha', 'always_on', false, [5, 0, 0], 'setblock ~-3 ~ ~ command_block ["facing_direction"=5]'],
  ]);
  assert.deepEqual(a.nodes.map((n) => n.line), [4, 3, 6, 7, 8, 5]);
});

test('the break chain runs its blocks only when the detector succeeds and switches the block back', () => {
  const sim = new Simulation(parse(SAMPLE));
  assert.equal(sim.world.getBlock([2, 0, 0]), 'minecraft:command_block');
  sim.activate('a');
  sim.advance(3);
  assert.deepEqual(says(sim), []);
  sim.runCommand('/tag @a add go', null, [0, 0, 0]);
  sim.advance(1);
  assert.deepEqual(says(sim), ['111', '222']);
  assert.equal(sim.world.getBlock([2, 0, 0]), 'minecraft:command_block');
  assert.equal(sim.world.getBlockData([2, 0, 0]).cb?.command, 'say 111');
  assert.equal(sim.world.entities[0].tags.has('go'), false);
  sim.advance(3);
  assert.deepEqual(says(sim), ['111', '222']);
  sim.runCommand('/tag @a add go', null, [0, 0, 0]);
  sim.advance(1);
  assert.deepEqual(says(sim), ['111', '222', '111', '222']);
});

test('the example with an always-true detector fires every tick', () => {
  const sim = new Simulation(parse('A = ent(type=player, pos=(0, 0, 0), name=A)\nchain a at (0, 0, 0):\n    if:\n        /execute if entity @a run say test\n    run:\n        /say 111\n'));
  sim.activate('a');
  sim.advance(2);
  assert.deepEqual(says(sim), ['test', '111', 'test', '111']);
});

test('setblock between command block kinds keeps the command and the settings', () => {
  const sim = new Simulation(parse('chain c(pos=(0, 0, 0)):\n    cb(mode=imp, power=always_on, delay=7)\n    /say hi\n'));
  sim.runCommand('/setblock 0 0 0 chain_command_block ["facing_direction"=5]', null, [0, 0, 0]);
  const d = sim.world.getBlockData([0, 0, 0]);
  assert.deepEqual([d.id, d.cb?.command, d.cb?.delay, d.cb?.power], ['minecraft:chain_command_block', 'say hi', 7, 'always_on']);
  sim.runCommand('/setblock 0 0 0 command_block ["facing_direction"=5] destroy', null, [0, 0, 0]);
  assert.equal(sim.world.getBlockData([0, 0, 0]).cb, undefined);
});

test('run: can end with another if:/run: pair for several levels, all in one chain', () => {
  const p = parse(`A = ent(type=player, pos=(0, 0, 0), name=A, tags=["go", "deeper"])
chain a(pos=(0, 0, 0), facing=south):
    if:
        /execute if entity @a[tag=go]
    run:
        /say level one
        if:
            /execute if entity @a[tag=deeper]
        run:
            /say level two
            /tag @a remove go
            /tag @a remove deeper
`);
  assert.deepEqual(p.diagnostics, []);
  assert.deepEqual(p.chains.map((c) => c.name), ['a']);
  assert.deepEqual(p.chains[0].nodes.map((n) => n.command), [
    'execute if entity @a[tag=go]',
    'setblock ~ ~ ~1 chain_command_block ["facing_direction"=3]',
    'say level one',
    'setblock ~ ~ ~-1 command_block ["facing_direction"=3]',
    'execute if entity @a[tag=deeper]',
    'setblock ~ ~ ~1 chain_command_block ["facing_direction"=3]',
    'say level two',
    'tag @a remove go',
    'tag @a remove deeper',
    'setblock ~ ~ ~-3 command_block ["facing_direction"=3]',
  ]);
  const sim = new Simulation(p);
  sim.activate('a');
  sim.advance(2);
  assert.deepEqual(says(sim), ['level one', 'level two']);
  assert.equal(sim.world.getBlock([0, 0, 2]), 'minecraft:command_block');
  assert.equal(sim.world.getBlock([0, 0, 6]), 'minecraft:command_block');
  assert.equal(sim.world.entities[0].tags.size, 0);
});

test('the second level does not run when its detector fails', () => {
  const sim = new Simulation(parse(`A = ent(type=player, pos=(0, 0, 0), name=A, tags=["go"])
chain a(pos=(0, 0, 0), facing=south):
    if:
        /execute if entity @a[tag=go]
    run:
        /say level one
        /tag @a remove go
        if:
            /execute if entity @a[tag=deeper]
        run:
            /say level two
`));
  sim.activate('a');
  sim.advance(2);
  assert.deepEqual(says(sim), ['level one']);
});

test('bad if:/run: shapes and nested chain headers are reported', () => {
  const messages = (src: string) => parse(src).diagnostics.map((d) => d.message);
  assert.ok(messages('chain a at (0,0,0):\n    run:\n        /say hi\n').some((m) => /exactly one if: followed by one run:/.test(m)));
  assert.ok(messages('chain a at (0,0,0):\n    if:\n        cb(mode=rep)\n    run:\n        /say hi\n').some((m) => /if: needs at least one command/.test(m)));
  assert.ok(messages('chain a at (0,0,0):\n    if:\n        /say a\n    run:\n        cb(delay=1)\n').some((m) => /run: needs at least one command/.test(m)));
  assert.ok(messages('chain a at (0,0,0):\n    if:\n        /say a\n    run:\n        /say b\n        if:\n            /say c\n').length > 0);
  assert.ok(messages('chain a at (0,0,0):\n    if:\n        /say a\n    run:\n        cb(conditional=true)\n        /say b\n').some((m) => /cannot be conditional/.test(m)));
  const nested = parse('chain a at (0,0,0):\n    /say a1\n    chain b at (0,2,0):\n        /say b1\n    /say a2\n');
  assert.ok(nested.diagnostics.some((d) => d.line === 3 && /cannot be nested/.test(d.message)));
  assert.deepEqual(nested.chains.map((c) => [c.name, c.nodes.map((n) => n.command)]), [['a', ['say a1', 'say b1', 'say a2']]]);
});

test('pass is an empty command block that passes the chain on but counts as failed', () => {
  const p = parse('A = ent(type=player, pos=(0, 0, 0), name=A)\nchain c at (0, 0, 0):\n    cb(mode=imp, power=always_on)\n    pass\n    cb(conditional=true)\n    /say conditional after pass\n    /say after pass\n');
  assert.deepEqual(p.diagnostics, []);
  assert.deepEqual(p.chains[0].nodes.map((n) => n.command), ['', 'say conditional after pass', 'say after pass']);
  const sim = new Simulation(p);
  sim.runChain('c');
  assert.deepEqual(says(sim), ['after pass']);
  assert.equal(exportAllCommands(p.chains), 'say conditional after pass\nsay after pass\n');
  assert.match(exportAllManifest(p.chains), /\npass\n/);
});

test('after= and beside= place chains relative to another chain', () => {
  const p = parse('chain a at (0, 0, 0):\n    /say 1\n    /say 2\nchain b(after=a, gap=2):\n    /say 3\nchain c(beside=a):\n    /say 4\n');
  assert.deepEqual(p.diagnostics, []);
  const [, b, c] = p.chains;
  assert.deepEqual([b.position, b.gapAt, b.nodes[0].cb.mode], [[4, 0, 0], [2, 0, 0], 'cha']);
  assert.deepEqual(c.position, [0, 1, 0]);
  assert.ok(parse('chain b(after=zz):\n    /say 3\n').diagnostics.some((d) => /unknown chain "zz"/.test(d.message)));
  assert.ok(parse('chain a at (0,0,0):\n    /say 1\nchain b(after=a, position=(1,1,1)):\n    /say 2\n').diagnostics.length > 0);
});