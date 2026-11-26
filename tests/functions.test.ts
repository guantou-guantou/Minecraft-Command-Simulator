import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/language/parser.ts';
import { Simulation } from '../src/engine/simulation.ts';
import { lintCommands } from '../src/language/cmdlint.ts';
import { lintProgram } from '../src/engine/lint.ts';
import { complete, sceneFrom } from '../src/language/complete.ts';
import { analyzeDoc } from '../src/ui/highlight.ts';

const SCRIPT = `A = ent(type=player, pos=(0.5, 4.0, 0.5), name=A)

function pack/start:
    # comments and blank lines are fine

    /scoreboard objectives add n dummy
    /scoreboard players add @s n 1
    /function pack/inner
    /summon zombe
    /say after the failure

function pack/inner:
    /scoreboard players add @s n 10

function loop:
    /function loop

chain c(pos=(0, 4, 0)):
    /say in chain
`;
const make = (extra = '') => new Simulation(parse(SCRIPT + extra));
const texts = (sim: Simulation) => sim.events.flatMap((e) => (e.type === 'chat' ? [`${e.kind}: ${e.text}`] : []));

test('function blocks are taken out of the script and keep the line numbers of what follows', () => {
  const program = parse(SCRIPT);
  assert.deepEqual(program.diagnostics, []);
  assert.deepEqual(program.functions.map((f) => [f.name, f.line, f.commands.length]), [['pack/start', 3, 5], ['pack/inner', 12, 1], ['loop', 15, 1]]);
  assert.equal(program.functions[0].commands[1].line, 7);
  assert.equal(program.chains.length, 1);
  assert.equal(program.chains[0].nodes[0].line, 19);
});

test('/function runs the commands in order as the caller, keeps going after a failure and reports it', () => {
  const sim = make();
  assert.equal(sim.runCommand('/execute as @a run function pack/start', null, [0, 0, 0]), true);
  assert.equal(sim.world.scores.get('n')?.get(`e:${sim.findEntity('A')!.id}`), 11);
  const out = texts(sim);
  assert.ok(out.some((t) => t.startsWith('error:') && t.includes('Unknown entity type "zombe"')));
  assert.ok(out.includes('say: after the failure'));
  assert.ok(out.includes("system: Executed 4 commands from function 'pack/inner'") === false);
  assert.ok(out.at(-1)!.startsWith("system: Executed 4 commands from function 'pack/start'"));
  const failure = sim.events.find((e) => e.type === 'chat' && e.kind === 'error');
  assert.equal(failure?.line, 9);
});

test('a missing function and runaway recursion fail cleanly', () => {
  const sim = make();
  assert.equal(sim.runCommand('/function nope', null, [0, 0, 0]), false);
  assert.ok(texts(sim).some((t) => t.includes('Function nope not found.')));
  assert.equal(sim.runCommand('/function loop', null, [0, 0, 0]), true);
  assert.ok(texts(sim).some((t) => t.includes('nested more than')));
});

test('schedule on_area_loaded runs the function on the next processed tick', () => {
  const sim = make('/tickingarea add 0 0 0 5 5 5 spawn\n');
  sim.runCommand('/tickingarea add 0 0 0 5 5 5 spawn', null, [0, 0, 0]);
  sim.runCommand('/scoreboard objectives add n dummy', null, [0, 0, 0]);
  assert.equal(sim.runCommand('/schedule on_area_loaded add circle 0 0 0 4 pack/inner', null, [0, 0, 0]), true);
  assert.equal(sim.runCommand('/schedule on_area_loaded add tickingarea spawn pack/inner', null, [0, 0, 0]), true);
  assert.equal(sim.runCommand('/schedule on_area_loaded add 0 0 0 3 3 3 pack/inner', null, [0, 0, 0]), true);
  assert.equal(sim.world.scheduled.length, 3);
  sim.advance(1);
  assert.equal(sim.world.scheduled.length, 0);
  assert.equal(texts(sim).filter((t) => t.startsWith("system: Executed")).length, 3);
  assert.equal(sim.runCommand('/schedule on_area_loaded add circle 0 0 0 4 missing', null, [0, 0, 0]), false);
  assert.equal(sim.runCommand('/schedule on_area_loaded add tickingarea nothere pack/inner', null, [0, 0, 0]), false);
});

test('function bodies must be /commands, names are unique, lint and completion know functions', () => {
  const bad = parse('function a:\n    say hi\n\nfunction a:\n    /say hi\n');
  assert.ok(bad.diagnostics.some((d) => /function a: expected a \/command/.test(d.message)));
  assert.ok(bad.diagnostics.some((d) => /Duplicate function "a"/.test(d.message)));
  assert.equal(lintCommands('function f:\n    /damagex @a 1\n    /say ok\n/function f\n').length, 1);
  const program = parse(SCRIPT);
  const scene = sceneFrom(SCRIPT, program);
  assert.deepEqual(scene.functions, ['pack/start', 'pack/inner', 'loop']);
  const r = complete('/function pa', '/function pa'.length, scene);
  assert.deepEqual(r?.items.map((i) => i.label).sort(), ['pack/inner', 'pack/start']);
  const kinds = analyzeDoc(SCRIPT).map((l) => l.kind);
  assert.equal(kinds[2], 'testhead');
  assert.equal(kinds[5], 'cmd');
});

test('check reports functions that do not exist', () => {
  const p = parse('function a:\n    /say hi\n    /function b\nchain c:\n    /execute as @a run function a\n    /function zz\n    /schedule on_area_loaded add circle 0 0 0 3 nope\n');
  assert.deepEqual(lintProgram(p).map((d) => [d.line, d.message]), [[3, 'Function b not found.'], [6, 'Function zz not found.'], [7, 'Function nope not found.']]);
});