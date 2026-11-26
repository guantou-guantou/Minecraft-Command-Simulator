import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/language/parser.ts';
import { Simulation } from '../src/engine/simulation.ts';
import { lintCommands } from '../src/language/cmdlint.ts';
import { COMMANDS } from '../src/language/grammar.ts';
import { ADMIN_COMMANDS, PRESENTATION_COMMANDS } from '../src/engine/known-commands.ts';

const world = () => new Simulation(parse('A = ent(type=player, pos=(0.5, 4.0, 0.5), name=A)\nz = ent(type=zombie, pos=(3.5, 4.0, 0.5))\n'));
const run = (sim: Simulation, cmd: string) => sim.runCommand(cmd, null, [0, 0, 0]);
const errors = (sim: Simulation) => sim.events.filter((e) => e.type === 'chat' && e.kind === 'error').length;

test('presentation commands are accepted for the players they name and recorded', () => {
  const sim = world();
  assert.equal(run(sim, '/camera @a clear'), true);
  assert.equal(run(sim, '/camera A fade'), true);
  assert.equal(run(sim, '/fog @a push fog.hell_fog my_fog'), true);
  assert.equal(run(sim, '/camerashake add @a 1 2 positional'), true);
  assert.equal(run(sim, '/hud @a hide all'), true);
  assert.equal(run(sim, '/music play record.cat'), true);
  assert.equal(errors(sim), 0);
  assert.ok(sim.events.some((e) => e.type === 'trace' && /camera accepted for 1 player/.test(e.message)));
});

test('presentation commands fail without a matching player and on bad syntax', () => {
  const sim = world();
  assert.equal(run(sim, '/camera @e[type=zombie] clear'), false);
  assert.equal(run(sim, '/camera @a[name=nobody] clear'), false);
  assert.equal(run(sim, '/camera @a bogus'), false);
  assert.ok(sim.events.some((e) => e.type === 'chat' && e.kind === 'error' && /Unexpected "bogus"/.test(e.text)));
});

test('administration commands are accepted and recorded', () => {
  const sim = world();
  for (const cmd of ['/op A', '/deop A', '/allowlist add bob', '/permission reload', '/setmaxplayers 10', '/stop', '/reload', '/transfer A host 19132', '/scriptevent a:b hi']) assert.equal(run(sim, cmd), true, cmd);
  assert.equal(errors(sim), 0);
});

test('recorded commands are listed as supported and follow execute run', () => {
  for (const n of [...PRESENTATION_COMMANDS, ...ADMIN_COMMANDS]) assert.ok(n in COMMANDS, `${n} has a grammar entry`);
  assert.deepEqual(lintCommands('/op bob\n/camera @a clear\n/execute as @a run camera @s clear\n'), []);
  const sim = world();
  assert.equal(run(sim, '/execute as @a run camera @s clear'), true);
  assert.equal(errors(sim), 0);
});