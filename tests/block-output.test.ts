import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/language/parser.ts';
import { Simulation } from '../src/engine/simulation.ts';
import type { SimEvent } from '../src/engine/types.ts';

const SCRIPT = `A = ent(type=player, pos=(0.5, 4.0, 0.5), name=A)
chain c(pos=(0, 4, 0)):
    /say hi
    /tellraw @a {"rawtext":[{"text":"raw"}]}
    /time set day
    /me waves
    /tell A psst
    /alwaysday
`;
const chats = (events: SimEvent[]) => events.flatMap((e) => (e.type === 'chat' ? [{ kind: e.kind, sender: e.sender, to: e.to, text: e.text }] : []));

test('chat output of command blocks has the [!] form and the command output is grey italic', () => {
  const sim = new Simulation(parse(SCRIPT));
  sim.runChain('c');
  const out = chats(sim.events);
  assert.deepEqual(out.find((c) => c.text === 'hi'), { kind: 'say', sender: '!', to: undefined, text: 'hi' });
  assert.deepEqual(out.find((c) => c.text === 'raw'), { kind: 'say', sender: '!', to: 'A', text: 'raw' });
  assert.ok(out.some((c) => c.kind === 'system' && c.text === '\u00a77\u00a7o[!: Set the time to 1000]\u00a7r'));
  assert.ok(out.some((c) => c.kind === 'plain' && c.text === '* ! waves'));
  assert.ok(out.some((c) => c.to === 'A' && c.text.includes('<!> ')));
  assert.equal(out.filter((c) => c.text.includes('[!: ')).length, 1);
});

test('with commandblockoutput off the command output of command blocks is not shown', () => {
  const sim = new Simulation(parse(SCRIPT));
  sim.runCommand('/gamerule commandblockoutput false', null, [0, 0, 0]);
  sim.events.length = 0;
  sim.runChain('c');
  const out = chats(sim.events);
  assert.equal(out.some((c) => c.text.includes('[!: ')), false);
  assert.ok(out.some((c) => c.text === 'hi'));
});

test('the terminal keeps plain output and alwaysday prints nothing', () => {
  const sim = new Simulation(parse(SCRIPT));
  sim.runCommand('/time set day', null, [0, 0, 0]);
  sim.runCommand('/alwaysday', null, [0, 0, 0]);
  sim.runCommand('/alwaysday false', null, [0, 0, 0]);
  sim.runCommand('/daylock true', null, [0, 0, 0]);
  const out = chats(sim.events);
  assert.deepEqual(out.map((c) => c.text), ['Set the time to 1000']);
});

test('other players see the command output of a player in grey italic, say excepted', () => {
  const sim = new Simulation(parse('A = ent(type=player, pos=(0.5, 4.0, 0.5), name=A)\nB = ent(type=player, pos=(2.5, 4.0, 0.5), name=B)\n'));
  const a = sim.findEntity('A')!;
  sim.runCommand('/time set day', a, [0, 0, 0]);
  sim.runCommand('/execute as @a run say hello', a, [0, 0, 0]);
  const out = chats(sim.events);
  assert.deepEqual(out.filter((c) => c.to === 'B' && c.kind === 'system').map((c) => c.text), ['\u00a77\u00a7o[A: Set the time to 1000]\u00a7r']);
  assert.ok(out.some((c) => c.text === 'Set the time to 1000' && c.to === undefined));
  assert.equal(out.some((c) => c.to === 'B' && c.text.includes('hello')), false);
  sim.runCommand('/gamerule sendcommandfeedback false', a, [0, 0, 0]);
  sim.events.length = 0;
  sim.runCommand('/time set night', a, [0, 0, 0]);
  assert.equal(chats(sim.events).some((c) => c.to === 'B'), false);
});