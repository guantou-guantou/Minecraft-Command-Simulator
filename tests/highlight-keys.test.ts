import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeDoc, lineSpans } from '../src/ui/highlight.ts';
import { parse } from '../src/language/parser.ts';
import { Simulation } from '../src/engine/simulation.ts';

const classes = (line: string) => {
  const info = analyzeDoc(line);
  return Object.fromEntries(lineSpans(line, info[0]).map((s) => [line.slice(s.from, s.to), s.cls]));
};

test('argument names get the property colour in every declaration form, short or long', () => {
  const a = classes('t1 = ent(type=armor_stand,pos=p2,rot=b, name="t")');
  assert.deepEqual([a.t1, a.ent, a.type, a.pos, a.rot, a.name], ['hl-var', 'hl-fn', 'hl-prop', 'hl-prop', 'hl-prop', 'hl-prop']);
  const b = classes('chain gate(pos=(8,65,0), facing=south, rot=rot(90, 0)):');
  assert.deepEqual([b.chain, b.gate, b.pos, b.facing], ['hl-kw', 'hl-fn', 'hl-prop', 'hl-prop']);
  const c = classes('ent(type=cow, position=(1,2,3), rotation=(0,0))');
  assert.deepEqual([c.ent, c.position, c.rotation], ['hl-fn', 'hl-prop', 'hl-prop']);
  const d = classes('    cb(mode=rep, delay=2, first_tick=true)');
  assert.deepEqual([d.cb, d.mode, d.delay, d.first_tick, d.rep, d.true], ['hl-fn', 'hl-prop', 'hl-prop', 'hl-prop', 'hl-const', 'hl-const']);
  const e = classes('b = rot(90, 0)');
  assert.deepEqual([e.b, e.rot], ['hl-var', 'hl-fn']);
});

test('an unimplemented command after run is reported as not implemented, and other branches still run', () => {
  const s = new Simulation(parse('ent(type=tnt, position=(1.0, 0, 1.0), name=a)\nent(type=cow, position=(3.0, 0, 3.0), name=b)'));
  assert.equal(s.runCommand('/execute as @e run damage @a 9 entity_explosion', null, [0, 0, 0]), false);
  assert.ok(s.events.some((e) => e.type === 'trace' && e.status === 'unimplemented' && /damage/.test(e.message)));
  assert.equal(s.runCommand('/execute as @e run say still works', null, [0, 0, 0]), true);
});