import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/language/parser.ts';
import { Simulation } from '../src/engine/simulation.ts';
import { lintCommands } from '../src/language/cmdlint.ts';

test('execute run accepts a leading slash on the command', () => {
  assert.deepEqual(lintCommands('/execute as @a run /say aaa\n/execute as @a at @s run /execute if entity @s run /say bbb\n'), []);
  assert.equal(lintCommands('/execute as @a run /nope\n').length, 1);
  assert.equal(lintCommands('/execute as @a run /say\n').length, 1);
  const sim = new Simulation(parse('A = ent(type=player, pos=(0, 0, 0), name=A)\n'));
  assert.equal(sim.runCommand('/execute as @a run /say aaa', null, [0, 0, 0]), true);
  assert.equal(sim.runCommand('/execute as @a run /nope', null, [0, 0, 0]), false);
  assert.ok(sim.events.some((e) => e.type === 'chat' && e.kind === 'say' && e.text === 'aaa'));
});