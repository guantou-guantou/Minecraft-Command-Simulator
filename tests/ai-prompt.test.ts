import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { aiPromptDoc } from '../src/ai/doc.ts';
import { Simulation } from '../src/engine/simulation.ts';
import { parse } from '../src/language/parser.ts';
import { buildSystemPrompt, commandLists, contextSection } from '../src/ai/prompt.ts';

test('docs/AI提示词.md is what npm run ai:doc generates', () => {
  const file = readFileSync(new URL('../docs/AI提示词.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(file, aiPromptDoc(), 'run npm run ai:doc');
});

test('the command lists follow the registry and do not overlap', () => {
  const c = commandLists();
  assert.ok(c.full.includes('execute') && c.full.includes('setblock') && c.record.includes('camera'));
  const all = [...c.full, ...c.record, ...c.syntaxOnly, ...c.unimplemented];
  assert.equal(new Set(all).size, all.length);
  for (const n of c.unimplemented) assert.ok(!c.full.includes(n));
});

test('the prompt carries the rules, the context the user chose and the reply language', () => {
  const p = buildSystemPrompt('zh', { script: '/say ```', quotes: [{ text: '/say hi', fromLine: 3, toLine: 4 }], diagnostics: [{ line: 3, message: 'bad' }] });
  assert.match(p, /Never use Java Edition syntax/);
  assert.match(p, /## Quoted lines 3-4\n```\n\/say hi\n```/);
  assert.match(p, /- line 3: bad/);
  assert.match(p, /````\n\/say ```\n````/);
  assert.match(p, /Reply in Chinese/);
  assert.equal(contextSection({}), '');
  assert.ok(!buildSystemPrompt('en').includes('# Context'));
});

test('the execution facts in the prompt match what the engine does', () => {
  const sim = new Simulation(parse([0, 90, -90, 180].map((y, i) => `ent(type=armor_stand, position=(0, 0, 0), rotation=(${y}, 0), name=y${i})`).join('\n') + '\nent(type=armor_stand, position=(0, 0, 0), rotation=(0, 90), name=down)\nent(type=armor_stand, position=(0, 0, 0), rotation=(0, -90), name=up)\n'));
  const at = (name: string) => {
    sim.events = [];
    sim.runCommand(`/execute positioned 0.0 0.0 0.0 rotated as @e[name=${name}] positioned ^^^1 run particle p ~~~`, null, [0, 0, 0]);
    const e = sim.events.find((x) => x.type === 'effect' && x.kind === 'particle');
    return e && e.type === 'effect' ? e.pos.map((v) => Math.round(v * 1000) / 1000 + 0) : null;
  };
  assert.deepEqual([at('y0'), at('y1'), at('y2'), at('y3'), at('down'), at('up')], [[0, 0, 1], [-1, 0, 0], [1, 0, 0], [0, 0, -1], [0, -1, 0], [0, 1, 0]]);
  const p = buildSystemPrompt('en');
  assert.match(p, /yaw 0 faces \+z, yaw 90 faces -x, yaw -90 faces \+x, yaw 180 faces -z; pitch 90 looks down/);
  assert.match(p, /`particle` is recorded with a result/);
});

test('a chain of rotated as steps over three entities runs 3^5 times', () => {
  const sim = new Simulation(parse('ent1 = ent(type=armor_stand,position=(0,0,0),rotation=(90,0),name=a)\nent2 = ent(type=armor_stand,position=(0,0,0),rotation=(0,0),name=a)\nent3 = ent(type=armor_stand,position=(0,0,0),rotation=(-90,0),name=a)\n'));
  const steps = [8, 4, 2, 1, 0.5].map((d) => `rotated as @e[name=a] positioned ^^^${d}`).join(' ');
  sim.runCommand(`/execute positioned 0.0 0.0 0.0 ${steps} run particle p ~~~`, null, [0, 0, 0]);
  const points = sim.events.flatMap((e) => (e.type === 'effect' && e.kind === 'particle' ? [e.pos.map((v) => Math.round(v * 1000) / 1000 + 0).join(',')] : []));
  assert.equal(points.length, 243);
  assert.equal(new Set(points).size, 243);
  assert.ok(points.every((p) => Number(p.split(',')[1]) === 0));
});