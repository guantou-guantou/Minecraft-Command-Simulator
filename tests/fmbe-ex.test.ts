import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/language/parser.ts';
import { Simulation } from '../src/engine/simulation.ts';
import { FMBE_VERSIONS, parseCustomPrerequisite, prerequisiteCommands, prerequisiteScript, transformCommand, variablesFor } from '../src/plugins/fmbe/core.ts';

const world = () => new Simulation(parse('f = ent(type=fox, pos=(0.5, 4, 0.5), tags=["wiki:fmbe"])\n'));
const errors = (sim: Simulation) => sim.events.flatMap((e) => (e.type === 'chat' && e.kind === 'error' ? [e.text] : []));

test('the EX prerequisites have 5 commands, use "_" as the next state and aim at the tag', () => {
  for (const v of ['ex3d', 'ex2d', 'exitems'] as const) {
    const cmds = prerequisiteCommands('my:tag', v);
    assert.equal(cmds.length, 5, v);
    assert.ok(cmds.every((c) => c.startsWith('playanimation @e[tag=my:tag] ') && / _ 0 "/.test(c)), v);
    assert.match(cmds[0], /v\.extend_scale=v\.extend_scale\?\?1;v\.extend_xrot=v\.extend_xrot\?\?-90/);
  }
  assert.equal(prerequisiteCommands('wiki:fmbe').length, 8);
  assert.deepEqual(FMBE_VERSIONS, ['standard', 'ex3d', 'ex2d', 'exitems']);
});

test('every EX prerequisite runs in the engine without errors and computes the scale and matrix', () => {
  const scale: Record<string, number> = { ex3d: Math.sqrt(32 / 7), ex2d: Math.sqrt(17 / 8) };
  for (const v of ['ex3d', 'ex2d', 'exitems'] as const) {
    const sim = world();
    for (const c of prerequisiteCommands('wiki:fmbe', v)) assert.equal(sim.runCommand(`/${c}`, null, [0, 0, 0]), true);
    sim.advance(2);
    assert.deepEqual(errors(sim), [], v);
    const m = sim.world.entities[0].molang;
    assert.equal(m.extend_scale, 1);
    assert.equal(m.extend_xrot, -90);
    assert.ok(Math.abs((m['f.p5'] as number) - 1) < 1e-9, `${v}: p5`);
    if (scale[v]) assert.ok(Math.abs((m['f.s'] as number) - scale[v]) < 1e-9 || v === 'ex2d', v);
    assert.ok(typeof m.head_position_x === 'number' && Number.isFinite(m.head_position_x), v);
  }
});

test('the EX variables are the standard ones without xzscale and yscale plus the three extension variables', () => {
  const names = (v: Parameters<typeof variablesFor>[0]) => variablesFor(v).map((x) => x.name);
  assert.ok(names('standard').includes('xzscale') && !names('standard').includes('extend_scale'));
  assert.ok(!names('ex3d').includes('xzscale') && !names('ex3d').includes('yscale'));
  assert.deepEqual(names('ex2d').slice(-3), ['extend_scale', 'extend_xrot', 'extend_yrot']);
  assert.match(transformCommand({ selector: '@e[tag=wiki:fmbe]', values: { extend_xrot: 45, extend_scale: 2 } }), /"v\.extend_xrot=45;v\.extend_scale=2;"/);
});

test('the EX chain script is one repeating block and four chain blocks', () => {
  const p = parse(prerequisiteScript('wiki:fmbe', 'ex_fmbe', 100, 'ex3d'));
  assert.deepEqual(p.diagnostics, []);
  assert.deepEqual(p.chains[0].nodes.map((n) => n.cb.mode), ['rep', 'cha', 'cha', 'cha', 'cha']);
});

test('a pasted prerequisite is checked line by line', () => {
  const ok = parseCustomPrerequisite('# mine\n/playanimation @e[tag=a] animation.player.sleeping none 0 "v.x=1;" c1\nplayanimation @e[tag=a] animation.warden.move none 0 "v.y=v.x*2;" c2\n');
  assert.equal(ok.length, 2);
  assert.ok(!ok[0].startsWith('/'));
  assert.throws(() => parseCustomPrerequisite('say hi'), /Line 1: only playanimation/);
  assert.throws(() => parseCustomPrerequisite('playanimation @e animation.a none 0 "v.x=(1;" c'), /Line 1/);
  assert.throws(() => parseCustomPrerequisite('# nothing\n'), /at least one/);
});