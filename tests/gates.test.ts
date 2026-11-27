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

test('an if:/run: chain expands into the break chain: detector, template, gap, run blocks and the restore', () => {
  const p = parse(SAMPLE);
  assert.deepEqual(p.diagnostics, []);
  assert.deepEqual(p.chains.map((c) => c.name), ['a', 'a__tpl1', 'a__run1']);
  const [a, tpl, run] = p.chains;
  assert.deepEqual(a.nodes.map((n) => [n.cb.mode, n.cb.power, n.cb.conditional, n.pos]), [['rep', 'always_on', false, [0, 0, 0]], ['cha', 'always_on', true, [1, 0, 0]]]);
  assert.equal(a.nodes[1].command, 'clone 0 1 0 0 1 0 2 0 0');
  assert.deepEqual([tpl.position, tpl.nodes[0].command, tpl.nodes[0].cb.mode], [[0, 1, 0], '', 'cha']);
  assert.deepEqual([run.position, run.gapAt, run.nodes[0].cb.mode], [[3, 0, 0], [2, 0, 0], 'cha']);
  assert.equal(run.nodes.at(-1)!.command, 'setblock 2 0 0 air');
  assert.equal(run.nodes.length, 4);
  assert.equal(a.nodes[0].line, 4);
  assert.equal(run.nodes.at(-1)!.line, 5);
});

test('the break chain runs its blocks only when the detector succeeds and puts the gap back', () => {
  const sim = new Simulation(parse(SAMPLE));
  sim.activate('a');
  sim.advance(3);
  assert.deepEqual(says(sim), []);
  sim.runCommand('/tag @a add go', null, [0, 0, 0]);
  sim.advance(1);
  assert.deepEqual(says(sim), ['111', '222']);
  assert.equal(sim.world.getBlock([2, 0, 0]), 'minecraft:air');
  assert.equal(sim.world.entities[0].tags.has('go'), false);
  sim.advance(3);
  assert.deepEqual(says(sim), ['111', '222']);
});

test('the example with always-true detector fires every tick', () => {
  const sim = new Simulation(parse('A = ent(type=player, pos=(0, 0, 0), name=A)\nchain a at (0, 0, 0):\n    if:\n        /execute if entity @a run say test\n    run:\n        /say 111\n'));
  sim.activate('a');
  sim.advance(2);
  assert.deepEqual(says(sim), ['test', '111', 'test', '111']);
});

test('run: can end with another if:/run: pair for several levels', () => {
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
  assert.deepEqual(p.chains.map((c) => c.name), ['a', 'a__tpl1', 'a__run1', 'a__tpl2', 'a__run2']);
  const run1 = p.chains[2];
  assert.deepEqual(run1.nodes.map((n) => n.command), ['say level one', 'setblock 0 0 2 air', 'execute if entity @a[tag=deeper]', 'clone 0 1 3 0 1 3 0 0 7']);
  assert.deepEqual(p.chains[4].position, [0, 0, 8]);
  const sim = new Simulation(p);
  sim.activate('a');
  sim.advance(2);
  assert.deepEqual(says(sim), ['level one', 'level two']);
  assert.equal(sim.world.getBlock([0, 0, 2]), 'minecraft:air');
  assert.equal(sim.world.getBlock([0, 0, 7]), 'minecraft:air');
  assert.equal(sim.world.entities[0].tags.size, 0);
});

test('bad if:/run: shapes and nested chain headers are reported', () => {
  const messages = (src: string) => parse(src).diagnostics.map((d) => d.message);
  assert.ok(messages('chain a at (0,0,0):\n    run:\n        /say hi\n').some((m) => /exactly one if: followed by one run:/.test(m)));
  assert.ok(messages('chain a at (0,0,0):\n    if:\n        cb(mode=rep)\n    run:\n        /say hi\n').some((m) => /if: needs at least one command/.test(m)));
  assert.ok(messages('chain a at (0,0,0):\n    if:\n        /say a\n    run:\n        /say b\n        if:\n            /say c\n').length > 0);
  const nested = parse('chain a at (0,0,0):\n    /say a1\n    chain b at (0,2,0):\n        /say b1\n    /say a2\n');
  assert.ok(nested.diagnostics.some((d) => d.line === 3 && /cannot be nested/.test(d.message)));
  assert.deepEqual(nested.chains.map((c) => [c.name, c.nodes.map((n) => n.command)]), [['a', ['say a1', 'say b1', 'say a2']]]);
  assert.ok(messages('chain a at (0,0,0):\n    if:\n        /say a\n    run:\n        /say b\nblock(type=stone, pos=(2, 0, 0))\n').some((m) => /gap cell/.test(m)));
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