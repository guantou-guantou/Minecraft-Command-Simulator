import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/language/parser.ts';
import { Simulation } from '../src/engine/simulation.ts';

const diags = (src: string) => parse(src).diagnostics.map((d) => [d.line, d.message]);
const says = (s: Simulation) => s.events.flatMap((e) => (e.type === 'chat' && e.kind === 'say' ? [e.text] : []));
const traces = (s: Simulation) => s.events.flatMap((e) => (e.type === 'trace' ? [e.message] : []));

test('chain header: keyword form, legacy "at" form, node positions follow facing', () => {
  const p = parse(`
r = rot(90, 0)
chain a(position=(0, 10, 0), facing=south, rotation=r):
    /say 1
    cb(facing=east)
    /say 2
    /say 3
    /say 4
chain b at (5, 10, 5):
    /say x
    /say y
`);
  assert.deepEqual(p.diagnostics, []);
  const [a, b] = p.chains;
  assert.deepEqual(a.rotation, [90, 0]);
  assert.deepEqual(a.nodes.map((n) => [n.pos, n.facing]), [
    [[0, 10, 0], 'south'], [[0, 10, 1], 'east'], [[1, 10, 1], 'east'], [[2, 10, 1], 'east'],
  ]);
  assert.deepEqual(b.nodes.map((n) => n.pos), [[5, 10, 5], [6, 10, 5]]);
  assert.equal(p.chains.length, 2);
});

test('chain header errors', () => {
  assert.deepEqual(diags('chain a(facing=east):\n /say a').map((d) => d[0]), [1]);
  assert.deepEqual(diags('chain a(position=(0,0,0), facing=sideways):\n /say a').map((d) => d[0]), [1]);
  assert.deepEqual(diags('chain a(position=(0,0,0), bogus=1):\n /say a').map((d) => d[0]), [1]);
});

test('each command block runs at its own position and the chain rotation', () => {
  const p = parse(`
chain a(position=(0, 5, 0), facing=east, rotation=rot(90, 0)):
    /execute positioned ^ ^ ^1 run say hi
    /execute positioned ~ ~ ~ run say there
`);
  assert.deepEqual(p.diagnostics, []);
  const s = new Simulation(p);
  s.runChain('a');
  assert.deepEqual(traces(s).filter((t) => t.startsWith('positioned')), ['positioned (-0.5, 5, 0.5)', 'positioned (1.5, 5, 0.5)']);
});

test('command blocks are real blocks in the world; layout is validated', () => {
  const p = parse(`
chain a(position=(0, 5, 0), facing=east):
    /say 1
    cb(conditional=true)
    /say 2
`);
  const s = new Simulation(p);
  assert.deepEqual(s.world.getBlockData([0, 5, 0]), {
    id: 'minecraft:command_block',
    states: { facing_direction: 5, conditional_bit: false },
    cb: { command: 'say 1', delay: 0, power: 'needs_redstone', line: 3, rotation: [0, 0] },
  });
  assert.deepEqual(s.world.getBlockData([1, 5, 0]), {
    id: 'minecraft:chain_command_block',
    states: { facing_direction: 5, conditional_bit: true },
    cb: { command: 'say 2', delay: 0, power: 'always_on', line: 5, rotation: [0, 0] },
  });
  const d = diags(`
block(type=stone, position=(1, 5, 0))
block(type=stone, position=(500, 5, 0))
chain a(position=(0, 5, 0), facing=east):
    /say 1
    /say 2
chain b(position=(1000, 5, 0)):
    /say 3
chain c(position=(0, 5, 0)):
    /say 4
`);
  assert.deepEqual(d.map((x) => x[0]), [3, 6, 8, 10]);
  assert.match(String(d[1][1]), /overlaps block\(\.\.\.\) declared on line 2/);
  assert.match(String(d[3][1]), /overlaps a command block of chain "a"/);
});

test('block states: declare, match in execute if block, setblock', () => {
  const p = parse(`
block(type=lever, position=(0, 0, 0), states=["open_bit"=true, "lever_direction"="up_north"])
chain t:
    /execute if block 0 0 0 lever ["open_bit"=true] run say open
    /execute if block 0 0 0 lever["open_bit"=false] run say closed
    /execute if block 0 0 0 lever run say any
    /execute if block 0 0 0 lever ["missing"=1] run say nope
    /setblock 0 0 0 lever ["open_bit"=false]
    /execute if block 0 0 0 lever ["open_bit"=false] run say now closed
    /setblock 0 0 0 lever ["open_bit"=false]
`);
  assert.deepEqual(p.diagnostics, []);
  const s = new Simulation(p);
  const res = s.runChain('t');
  assert.deepEqual(says(s), ['open', 'any', 'now closed']);
  assert.deepEqual(res.map((r) => r.success), [true, false, true, false, true, true, false]);
  assert.match(traces(s).join('\n'), /state missing is not set/);
});

test('block state syntax errors', () => {
  assert.deepEqual(diags('block(type=lever, position=(0,0,0), states=["a"=nope])').map((d) => d[0]), [1]);
  assert.deepEqual(diags('block(type=lever, position=(0,0,0), states="open_bit")').map((d) => d[0]), [1]);
  const s = new Simulation(parse(''));
  assert.equal(s.runCommand('/setblock 0 0 0 lever ["a"=nope]', null, [0, 0, 0]), false);
  assert.equal(s.events.some((e) => e.type === 'trace' && e.status === 'syntax_error'), true);
});

test('entity handles and tags', () => {
  const p = parse(`
stand1 = ent(type=armor_stand, position=(0,0,0), name="a", tags=["first", "x y"])
stand2 = ent(type=armor_stand, position=(0,0,1), name="a")
ent(type=armor_stand, position=(0,0,2), name="a")
`);
  assert.deepEqual(p.diagnostics, []);
  const s = new Simulation(p);
  assert.equal(s.world.entityByHandle('stand1')!.pos[2], 0.5);
  assert.equal(s.world.entityByHandle('stand2')!.pos[2], 1.5);
  assert.deepEqual([...s.world.entityByHandle('stand1')!.tags], ['first', 'x y']);
  assert.equal(s.world.entities.filter((e) => e.name === 'a').length, 3);
  assert.equal(s.runCommand('/tag @e[tag=first] add picked', null, [0, 0, 0]), true);
  assert.equal(s.world.entityByHandle('stand2')!.tags.size, 0);
  s.reset();
  assert.equal(s.world.entityByHandle('stand1')!.tags.has('picked'), false);
});

test('handle errors and namespace sharing', () => {
  const d = diags(`
h = ent(type=player, position=(0,0,0))
h = ent(type=player, position=(1,0,0))
pos1 = (0, 0, 0)
pos1 = ent(type=player, position=(1,0,0))
h = (1, 2, 3)
ent(type=player, position=pos1, tags=oops)
`);
  assert.deepEqual(d.map((x) => x[0]), [3, 5, 6, 7]);
});

test('a chain block pointing at another chain\'s chain command block triggers it', () => {
  const src = (aFacing: string, aCmd: string) => `
chain a(position=(0, 5, 0), facing=${aFacing}):
    ${aCmd}
chain b(position=(1, 5, 0)):
    cb(mode=cha)
    /say b1
    /say b2
chain c(position=(0, 8, 0)):
    cb(mode=cha, power=needs_redstone)
    /say c1
chain d(position=(0, 7, 0), facing=up):
    /say d0
`;
  const run = (s: string) => {
    const sim = new Simulation(parse(s));
    assert.deepEqual(sim.program.diagnostics, []);
    sim.activate('a');
    sim.advance(1);
    return says(sim);
  };
  assert.deepEqual(run(src('east', '/say a0')), ['a0', 'b1', 'b2']);
  assert.deepEqual(run(src('north', '/say a0')), ['a0']);
  assert.deepEqual(run(src('east', '/setblock 1 5 0 stone')), []);
  const sim = new Simulation(parse(src('east', '/say a0')));
  sim.activate('d');
  sim.advance(1);
  assert.deepEqual(says(sim), ['d0']);
  assert.ok(traces(sim).some((t) => /needs redstone/.test(t)));
  sim.activate('c');
  sim.advance(1);
  assert.deepEqual(says(sim), ['d0', 'c1']);
});

test('a first block declared cha does not start by itself', () => {
  const sim = new Simulation(parse('chain x(position=(0,0,0)):\n cb(mode=cha)\n /say x'));
  sim.advance(3);
  assert.deepEqual(says(sim), []);
});
