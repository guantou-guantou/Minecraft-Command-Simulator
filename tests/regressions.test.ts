import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from '../src/language/parser.ts';
import { Simulation } from '../src/engine/simulation.ts';
import { runTests } from '../src/engine/testrun.ts';

const chat = (sim: Simulation) => sim.events.flatMap((e) => (e.type === 'chat' ? [e.text] : []));
const gate = (cond: string) => `A = ent(type=player, pos=(0.5, 4.0, 0.5), name=A)

chain gate(pos=(0, 4, 0)):
    cb(mode=imp, power=always_on)
    /execute ${cond}
    cb(mode=cha, conditional=true)
    /say gated
`;

test('execute if/unless without run is a plain gate', () => {
  const run = (cond: string) => {
    const sim = new Simulation(parse(gate(cond)));
    sim.activate('gate');
    sim.advance(1);
    return chat(sim);
  };
  assert.deepEqual(run('if entity @a'), ['gated']);
  assert.deepEqual(run('unless entity @e[type=zombie]'), ['gated']);
  assert.deepEqual(run('if entity @e[type=zombie]'), []);
  assert.deepEqual(run('as @a at @s if entity @s'), ['gated']);
});

test('a bare execute branch is still a syntax error', () => {
  const sim = new Simulation(parse('A = ent(type=player, pos=(0.5, 4.0, 0.5), name=A)\nchain c:\n    /execute as @a\n'));
  sim.runChain('c');
  assert.ok(chat(sim).some((t) => t.includes('expected a subcommand')));
});

test('a command step that fails fails the test', () => {
  const program = parse(`A = ent(type=player, pos=(0.5, 4.0, 0.5), name=A)

test setup_fails:
    /scoreboard players add A missing_objective 1
    expect entity @a count == 1

test setup_ok:
    /scoreboard objectives add n dummy
    /scoreboard players add A n 1
    expect score A n == 1
`);
  const [bad, good] = runTests(program);
  assert.equal(bad.passed, false);
  assert.match(bad.failures[0].message, /command failed: \/scoreboard players add A missing_objective 1/);
  assert.equal(bad.failures[0].line, 4);
  assert.equal(good.passed, true);
});

test('an always_on impulse runs once even when it is activated again in the same tick', () => {
  const sim = new Simulation(parse(`chain c(pos=(0, 4, 0)):
    cb(mode=imp, power=always_on)
    /summon armor_stand
`));
  sim.activate('c');
  sim.advance(1);
  sim.advance(2);
  assert.equal(sim.world.entities.filter((e) => e.type === 'minecraft:armor_stand').length, 1);
});

test('summon refuses entity ids that do not exist but accepts other namespaces', () => {
  const sim = new Simulation(parse(''));
  assert.equal(sim.runCommand('/summon zombe 0 4 0', null, [0, 0, 0]), false);
  assert.ok(chat(sim).some((t) => t.includes('Unknown entity type "zombe"')));
  for (const id of ['zombie', 'minecraft:fox', 'item', 'area_effect_cloud', 'wiki:custom']) assert.equal(sim.runCommand(`/summon ${id} 0 4 0`, null, [0, 0, 0]), true, id);
});

test('--ticks and plain runs exit with 1 when a command reported an error', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mcsim-'));
  const bad = join(dir, 'bad.mcsim');
  const good = join(dir, 'good.mcsim');
  writeFileSync(bad, 'chain c(pos=(0, 4, 0)):\n    cb(mode=imp, power=always_on)\n    /summon zombe\n');
  writeFileSync(good, 'chain c(pos=(0, 4, 0)):\n    cb(mode=imp, power=always_on)\n    /say ok\n');
  const run = (...args: string[]) => spawnSync(process.execPath, ['src/cli.ts', ...args], { encoding: 'utf8' });
  assert.equal(run(bad, 'c', '--ticks', '1').status, 1);
  assert.equal(run(bad, 'c').status, 1);
  const ok = run(good, 'c', '--ticks', '1');
  assert.equal(ok.status, 0);
  assert.equal(ok.stdout.split('\n').filter((l) => l.includes('[chat/say] ok')).length, 1);
});