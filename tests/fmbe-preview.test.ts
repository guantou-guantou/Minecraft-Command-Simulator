import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/language/parser.ts';
import { Simulation } from '../src/engine/simulation.ts';
import { PREREQ, prerequisiteCommands } from '../src/plugins/fmbe/core.ts';
import { effectiveVars, modelMatrix } from '../src/plugins/fmbe/render.ts';

const fox = () => new Simulation(parse('f = ent(type=fox, pos=(0.5, 4, 0.5), tags=["wiki:fmbe"])\n'));
const close = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);

test('the preview matrix worked out from the game-side outputs equals the one from the custom inputs', () => {
  let seed = 7;
  const rnd = (lo: number, hi: number) => lo + ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) * (hi - lo);
  for (let n = 0; n < 40; n++) {
    const set = { xpos: rnd(-8, 8), ypos: rnd(-8, 8), zpos: rnd(-8, 8), xrot: rnd(-180, 180), yrot: rnd(-180, 180), zrot: rnd(-180, 180), scale: rnd(0.3, 3), xzscale: rnd(0.3, 3), yscale: rnd(0.3, 3), xbasepos: rnd(-8, 8), ybasepos: rnd(-8, 8), zbasepos: rnd(-8, 8) };
    const sim = fox();
    for (const c of prerequisiteCommands('wiki:fmbe')) sim.runCommand(`/${c}`, null, [0, 0, 0]);
    const expr = Object.entries(set).map(([k, v]) => `v.${k}=${v};`).join('');
    sim.runCommand(`/playanimation @e[tag=wiki:fmbe] animation.player.attack.positions none 0 "${expr}" wiki:setvariable`, null, [0, 0, 0]);
    sim.advance(3);
    const vars = sim.world.entities[0].molang;
    assert.ok(close(modelMatrix(effectiveVars(vars)), modelMatrix(set)), `sample ${n}`);
  }
});

test('renaming the custom variables of a prerequisite does not change the preview', () => {
  const rename = (s: string) => s.replace(/v\.xrot/g, 'v.pitch').replace(/v\.scale/g, 'v.size').replace(/v\.xzscale/g, 'v.wide');
  const sim = fox();
  for (const p of PREREQ) sim.runCommand(`/playanimation @e[tag=wiki:fmbe] ${p.animation} none 0 "${rename(p.expression)}" ${p.controller}`, null, [0, 0, 0]);
  sim.runCommand('/playanimation @e[tag=wiki:fmbe] animation.player.attack.positions none 0 "v.pitch=35;v.size=1.5;v.ypos=16;" wiki:setvariable', null, [0, 0, 0]);
  sim.advance(3);
  const vars = sim.world.entities[0].molang;
  assert.equal(vars.xrot, undefined);
  assert.ok(close(modelMatrix(effectiveVars(vars)), modelMatrix({ xrot: 35, scale: 1.5, ypos: 16 })));
});

test('extend_scale stretches the preview block along the direction of extend_xrot and extend_yrot', () => {
  const m = modelMatrix({ extend_scale: 2 });
  assert.deepEqual([m[0], m[5], m[10]].map((v) => Math.round(v * 1e9) / 1e9), [1, 1, 2]);
  const up = modelMatrix({ extend_scale: 3, extend_xrot: 0 });
  assert.deepEqual([up[0], up[5], up[10]].map((v) => Math.round(v * 1e9) / 1e9), [1, 3, 1]);
  const plain = modelMatrix({});
  assert.ok(close(modelMatrix({ extend_scale: 1, extend_xrot: 45 }), plain));
});
