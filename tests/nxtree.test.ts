import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SPEC, analyzePoints, generate, levelsFor, probe, stepsFor, verify, type NxSpec } from '../src/plugins/nxtree/core.ts';

const spec = (over: Partial<NxSpec>): NxSpec => ({ ...DEFAULT_SPEC, ...over });

test('steps: s/2, s, 2s, ... per axis', () => {
  assert.deepEqual(stepsFor(1, 1), []);
  assert.deepEqual(stepsFor(2, 1), [0.5]);
  assert.deepEqual(stepsFor(4, 1), [0.5, 1]);
  assert.deepEqual(stepsFor(8, 1), [0.5, 1, 2]);
  assert.deepEqual(stepsFor(4, 0.1), [0.05, 0.1]);
  assert.equal(levelsFor(16), 4);
  assert.throws(() => levelsFor(6), /not a power of 2/);
  assert.throws(() => levelsFor(0), /positive integer/);
});

test('generate reproduces the 4x4x4 command from the notes', () => {
  const g = generate(DEFAULT_SPEC);
  assert.equal(
    g.command,
    'execute positioned 2.0 66 2.0 rotated as @e[tag=p] positioned ^0.5 ^ ^ rotated as @e[tag=p] positioned ^1 ^ ^ ' +
      'rotated as @e[tag=p] positioned ^ ^ ^0.5 rotated as @e[tag=p] positioned ^ ^ ^1 ' +
      'rotated as @e[tag=q] positioned ^ ^ ^0.5 rotated as @e[tag=q] positioned ^ ^ ^1 run particle minecraft:villager_happy ~ ~ ~',
  );
  assert.equal(g.expectedPoints, 64);
  assert.equal(g.entities.split('\n').length, 4);
  assert.match(g.entities, /type=boat.*tags=\["q"\]/);
});

test('generate: single points and flat grids need fewer helpers; bad input is rejected', () => {
  assert.equal(generate(spec({ counts: [1, 1, 1] })).command, 'execute positioned 2.0 66 2.0 run particle minecraft:villager_happy ~ ~ ~');
  const flat = generate(spec({ counts: [4, 1, 4] }));
  assert.equal(flat.entities.split('\n').length, 2);
  assert.ok(!flat.command.includes('@e[tag=q]'));
  assert.throws(() => generate(spec({ counts: [3, 1, 1] })), /power of 2/);
  assert.throws(() => generate(spec({ pitchTag: 'p' })), /must differ/);
  assert.throws(() => generate(spec({ yawTag: 'bad tag' })), /Invalid tag/);
  assert.throws(() => generate(spec({ spacing: [1, 0, 1] })), /Spacing/);
  assert.throws(() => generate(spec({ action: '  ' })), /empty/);
  assert.match(generate(spec({ action: '/say hi' })).command, / run say hi$/);
});

test('verify: default grid is exact', () => {
  const { analysis } = verify(DEFAULT_SPEC);
  assert.deepEqual(analysis.problems, []);
  assert.equal(analysis.branches, 64);
  assert.equal(analysis.unique, 64);
  assert.equal(analysis.matchesGrid, true);
  assert.deepEqual(analysis.min, [0.5, 64.5, 0.5]);
  assert.deepEqual(analysis.max, [3.5, 67.5, 3.5]);
});

test('verify: assorted shapes, spacings and centers', () => {
  const shapes: Partial<NxSpec>[] = [
    { counts: [2, 2, 2], spacing: [1, 1, 1] },
    { counts: [8, 1, 2], spacing: [0.5, 1, 3], center: [-10.5, 0, 7.25] },
    { counts: [1, 4, 1], spacing: [1, 2, 1], center: [0, 100, 0] },
    { counts: [16, 16, 16], spacing: [1, 1, 1], center: [0, 80, 0] },
  ];
  for (const s of shapes) {
    const { analysis } = verify(spec(s));
    assert.deepEqual(analysis.problems, [], JSON.stringify(s));
    assert.equal(analysis.matchesGrid, true, JSON.stringify(s));
  }
});

test('verify: a hand-written command with a mistake is caught', () => {
  const scene = [
    'ent(type=armor_stand, position=(9,70,9), rotation=(0, 0), tags=["p"])',
    'ent(type=armor_stand, position=(9,70,9), rotation=(180, 0), tags=["p"])',
  ].join('\n');
  const good = probe(scene, 'execute positioned 0 0 0 rotated as @e[tag=p] positioned ^1 ^ ^ rotated as @e[tag=p] positioned ^1 ^ ^ run particle a ~ ~ ~');
  const a = analyzePoints(good.points, null, 4);
  assert.equal(a.branches, 4);
  assert.equal(a.duplicates, 1);
  assert.match(a.problems.join('\n'), /1 branch\(es\) landed on an already used point/);
  const none = probe(scene, 'execute positioned 0 0 0 rotated as @e[tag=zzz] positioned ^1 ^ ^ run particle a ~ ~ ~');
  assert.equal(none.points.length, 0);
  const bad = probe(scene, 'execute positioned 0 0 0 rotated as @e[tag=p] positioned ^ 1 ^ run particle a ~ ~ ~');
  assert.equal(bad.points.length, 0);
  assert.match(bad.errors.join(''), /mix local/);
  assert.equal(probe('nonsense line', 'say x').diagnostics.length, 1);
});
