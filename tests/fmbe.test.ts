import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/language/parser.ts';
import { Simulation } from '../src/engine/simulation.ts';
import { lintProgram } from '../src/engine/lint.ts';
import {
  DEFAULT_TAG, PREREQ, VARIABLES, fillItemCommand, foxScript, foxSetupCommands, prerequisiteCommands, prerequisiteScript, readTransform,
  selectorFor, transformCommand, type FoxSpec,
} from '../src/plugins/fmbe/core.ts';

const O: [number, number, number] = [0, 0, 0];
const spec = (over: Partial<FoxSpec> = {}): FoxSpec => ({
  name: 'wiki:fmbe', tag: DEFAULT_TAG, position: [1, 65, 2], item: 'stone', adult: true, mode: 'scene', handle: 'fmbe1', ...over,
});

test('the prerequisite is the 8 wiki commands in order with the wiki controller names', () => {
  assert.equal(PREREQ.length, 8);
  const cmds = prerequisiteCommands();
  assert.equal(cmds.length, 8);
  assert.equal(cmds[0], 'playanimation @e[tag=wiki:fmbe] animation.player.sleeping none 0 "" controller.animation.fox.move');
  assert.deepEqual(PREREQ.map((p) => p.controller), [
    'controller.animation.fox.move', 'wiki.scale', 'wiki.shift_pos', 'wiki.xrot', 'wiki.zrot', 'wiki.xpos', 'wiki.ypos', 'wiki.zpos',
  ]);
  assert.match(cmds[7], /animation\.parrot\.dance none 0 "v\.dance\.x=-v\.zpos;v\.dance\.y=0;" wiki\.zpos$/);
  assert.match(prerequisiteCommands('my:tag')[3], /^playanimation @e\[tag=my:tag\] /);
  assert.throws(() => prerequisiteCommands('bad tag'), /tag may only contain/);
});

test('the prerequisite script is one repeating chain of 8 blocks that parses, lints and runs', () => {
  const text = prerequisiteScript();
  assert.ok(text.split('\n').length > 10);
  assert.ok(text.includes('cb(mode=rep, power=always_on)'));
  const p = parse(text);
  assert.deepEqual(p.diagnostics, []);
  assert.deepEqual(lintProgram(p), []);
  assert.equal(p.chains.length, 1);
  assert.equal(p.chains[0].nodes.length, 8);
  assert.equal(p.chains[0].nodes[0].cb.mode, 'rep');
  assert.ok(p.chains[0].nodes.slice(1).every((n) => n.cb.mode === 'cha'));
  const joined = p.chains[0].nodes.map((n) => n.command.replace(/; /g, ';').replace('0 " v', '0 "v'));
  assert.deepEqual(joined, prerequisiteCommands());
  assert.throws(() => prerequisiteScript(DEFAULT_TAG, 'bad name'), /chain name/);
});

test('fox script as scene declarations creates an FMBE fox holding the item', () => {
  const p = parse(foxScript(spec()));
  assert.deepEqual(p.diagnostics, []);
  const s = new Simulation(p);
  const fox = s.world.entityByHandle('fmbe1')!;
  assert.equal(fox.type, 'minecraft:fox');
  assert.deepEqual([fox.name, [...fox.tags], fox.pos], ['wiki:fmbe', ['wiki:fmbe'], [1.5, 65, 2.5]]);
  assert.equal(fox.items['slot.weapon.mainhand:0'].id, 'minecraft:stone');
});

test('fox script as commands summons, fills and tags like the wiki setup', () => {
  const cmds = foxSetupCommands(spec({ mode: 'commands', position: null }));
  assert.deepEqual(cmds, [
    'summon fox ~ ~ ~ ~ ~ minecraft:as_adult "wiki:fmbe"',
    'replaceitem entity @n[name="wiki:fmbe"] slot.weapon.mainhand 0 stone',
    'tag @e[name="wiki:fmbe"] add wiki:fmbe',
  ]);
  const s = new Simulation(parse(''));
  for (const c of foxSetupCommands(spec({ mode: 'commands' }))) assert.equal(s.runCommand(`/${c}`, null, O), true, c);
  const fox = s.world.entities[0];
  assert.deepEqual([fox.type, fox.name, [...fox.tags], fox.pos, fox.items['slot.weapon.mainhand:0']?.id], ['minecraft:fox', 'wiki:fmbe', ['wiki:fmbe'], [1.5, 65, 2.5], 'minecraft:stone']);
  assert.equal(foxSetupCommands(spec({ adult: false }))[0], 'summon fox 1 65 2 ~ ~ "wiki:fmbe"');
  const chainP = parse(foxScript(spec({ mode: 'commands' })));
  assert.deepEqual(chainP.diagnostics, []);
  assert.equal(chainP.chains[0].name, 'fmbe_setup');
});

test('fox spec validation', () => {
  assert.throws(() => foxScript(spec({ name: 'bad name' })), /name may only/);
  assert.throws(() => foxScript(spec({ tag: 'a b' })), /tag may only/);
  assert.throws(() => foxScript(spec({ item: '  ' })), /item is empty/);
  assert.throws(() => foxScript(spec({ handle: '1x' })), /handle/);
  assert.throws(() => foxScript(spec({ position: null })), /needs a position/);
  assert.throws(() => foxSetupCommands(spec({ item: '' })), /item is empty/);
});

test('fill item replaces the held item of existing foxes', () => {
  const s = new Simulation(parse(foxScript(spec())));
  assert.equal(s.runCommand(`/${fillItemCommand(selectorFor('wiki:fmbe'), 'minecraft:gold_block')}`, null, O), true);
  assert.equal(s.world.entityByHandle('fmbe1')!.items['slot.weapon.mainhand:0'].id, 'minecraft:gold_block');
  assert.equal(fillItemCommand(' @n[name="a"] ', ' dirt '), 'replaceitem entity @n[name="a"] slot.weapon.mainhand 0 dirt');
  assert.throws(() => fillItemCommand('', 'dirt'), /selector/);
  assert.throws(() => fillItemCommand('@e', ''), /item is empty/);
});

test('transform command matches the wiki example and round-trips through readTransform', () => {
  const cmd = transformCommand({ selector: '@e[tag=wiki:fmbe]', values: { xrot: 35, ypos: 16, scale: 1.5 } });
  assert.equal(cmd, 'playanimation @e[tag=wiki:fmbe] animation.player.attack.positions none 0 "v.xrot=35;v.ypos=16;v.scale=1.5;" wiki:setvariable');
  const r = readTransform(`/${cmd}`)!;
  assert.deepEqual(r.values, { xrot: 35, ypos: 16, scale: 1.5 });
  assert.deepEqual([r.selector, r.animation, r.controller], ['@e[tag=wiki:fmbe]', 'animation.player.attack.positions', 'wiki:setvariable']);
  assert.deepEqual(readTransform('playanimation @e a none 0 "v.xpos=-4;v.zrot=+2;v.ypos=v.xpos;" c')!.values, { xpos: -4, zrot: 2 });
  assert.equal(readTransform('/say hi'), null);
  assert.equal(readTransform('/playanimation @e a none 0 "v.a=(" c'), null);
  assert.throws(() => transformCommand({ selector: '', values: { xpos: 1 } }), /selector/);
  assert.throws(() => transformCommand({ selector: '@e', values: {} }), /at least one/);
  assert.throws(() => transformCommand({ selector: '@e', values: { nope: 1 } }), /Unknown FMBE variable/);
  assert.throws(() => transformCommand({ selector: '@e', values: { xpos: NaN } }), /not a number/);
  assert.equal(VARIABLES.length, 12);
});

test('full flow: scene fox, prerequisite chain, set variables, derived values follow', () => {
  const p = parse(`${foxScript(spec())}\n${prerequisiteScript()}\nchain move:\n    /${transformCommand({ selector: selectorFor('wiki:fmbe'), values: { xrot: 30, yrot: 10, zrot: 5, xpos: 8, ypos: 16, zpos: 4, scale: 4 } })}`);
  assert.deepEqual(p.diagnostics, []);
  const s = new Simulation(p);
  s.advance(1);
  s.activate('move');
  s.advance(1);
  const v = s.world.entityByHandle('fmbe1')!.molang;
  assert.equal(v.body_x_rot, 120);
  assert.equal(v.body_z_rot, 100);
  assert.equal(v.attack_body_rot_y, -5);
  assert.equal(v.wing_flap, (16 - 8) * 3.3333333);
  assert.equal(v['rail_offset.y'], 1.6485 + 1);
  assert.equal(v['dance.x'], -4);
  assert.equal(v.swelling_scale1, 2.1385 * 2);
});
import { FMBE_DEFAULTS, cubeFaces, isFrontFacing, itemHue, modelMatrix, shade, transformPoint } from '../src/plugins/fmbe/render.ts';

const near = (a: number[], b: number[]) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-9, `${a} vs ${b}`));

test('FMBE model matrix follows the reference simulator (Basic Edition)', () => {
  near(transformPoint(modelMatrix({}), [0.5, 0.5, 0.5]), [0.5, 0.5, 0.5]);
  near(transformPoint(modelMatrix({ scale: 2 }), [0.5, 0.5, 0.5]), [1, 1, 1]);
  near(transformPoint(modelMatrix({ scale: 2, xzscale: 3, yscale: 0.5 }), [1, 1, 1]), [6, 1, 6]);
  near(transformPoint(modelMatrix({ ypos: 16, xpos: -8 }), [0, 0, 0]), [-0.5, 1, 0]);
  near(transformPoint(modelMatrix({ yrot: 90 }), [1, 0, 0]), [0, 0, 1]);
  near(transformPoint(modelMatrix({ xrot: 90 }), [0, 1, 0]), [0, 0, 1]);
  near(transformPoint(modelMatrix({ zrot: 90 }), [1, 0, 0]), [0, -1, 0]);
  near(transformPoint(modelMatrix({ xbasepos: 16, yrot: 90 }), [0, 0, 0]), [0, 0, 1]);
  near(transformPoint(modelMatrix({ xpos: 16, xbasepos: 16, yrot: 90 }), [0, 0, 0]), [1, 0, 1]);
  near(transformPoint(modelMatrix({ ybasepos: 16, scale: 2 }), [0, 0, 0]), [0, 2, 0]);
  assert.deepEqual(Object.keys(FMBE_DEFAULTS).length, 12);
  near(transformPoint(modelMatrix({ xpos: 'a', scale: null }), [1, 1, 1]), [1, 1, 1]);
});

test('cube faces: six quads, unit normals, three of them face the camera', () => {
  const faces = cubeFaces(modelMatrix({ yrot: 30, xrot: 20 }), [10, 0, 0]);
  assert.equal(faces.length, 6);
  for (const f of faces) {
    assert.equal(f.corners.length, 4);
    assert.ok(Math.abs(Math.hypot(...f.normal) - 1) < 1e-9);
  }
  const view = { yaw: 0.6, pitch: 0.45, zoom: 1 };
  assert.equal(faces.filter((f) => isFrontFacing(f.normal, view)).length, 3);
  const cx = faces.flatMap((f) => f.corners).reduce((s, p) => s + p[0], 0) / 24;
  assert.ok(Math.abs(cx - 10) < 1e-9);
  assert.ok(shade([0, 1, 0]) > shade([0, -1, 0]));
  assert.equal(itemHue('stone'), itemHue('stone'));
});
