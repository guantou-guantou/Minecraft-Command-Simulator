import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/language/parser.ts';
import { Simulation } from '../src/engine/simulation.ts';
import { parseMcText } from '../src/ui/mctext.ts';
import type { SimEvent } from '../src/engine/types.ts';

const O: [number, number, number] = [0, 0, 0];

function load(src = ''): Simulation {
  const p = parse(src);
  assert.deepEqual(p.diagnostics, []);
  return new Simulation(p);
}

const run = (s: Simulation, cmd: string) => s.runCommand(cmd, null, O);
const errors = (s: Simulation) => s.events.flatMap((e) => (e.type === 'chat' && e.kind === 'error' ? [e.text] : []));
const screens = (s: Simulation) => s.events.filter((e): e is Extract<SimEvent, { type: 'screen' }> => e.type === 'screen');
const chats = (s: Simulation, kind: 'say' | 'system') =>
  s.events.flatMap((e) => (e.type === 'chat' && e.kind === kind ? [[e.to ?? null, e.text]] : []));

const PLAYERS = `
alice = ent(type=player, position=(0,0,0), name=alice)
bob = ent(type=player, position=(1,0,0), name=bob)
stand = ent(type=armor_stand, position=(2,0,0), name=stand)
`;

test('tellraw: translate with arguments, nested rawtext, and a note that keys are not looked up', () => {
  const s = load(PLAYERS);
  run(s, '/scoreboard objectives add n dummy');
  run(s, '/scoreboard players set alice n 3');
  assert.equal(run(s, '/tellraw alice {"rawtext":[{"translate":"key.%s.of.%2$s","with":["A","B"]},{"text":"|"},{"translate":"x %s y","with":{"rawtext":[{"score":{"name":"alice","objective":"n"}}]}}]}'), true);
  assert.deepEqual(chats(s, 'say'), [['alice', 'key.A.of.B|x 3 y']]);
  assert.ok(s.events.some((e) => e.type === 'trace' && e.status === 'unimplemented' && /translation keys/.test(e.message)));
  assert.equal(run(s, '/tellraw alice {"rawtext":[{"nope":1}]}'), false);
  assert.equal(run(s, '/tellraw alice {"rawtext":5}'), false);
  assert.match(errors(s).join('\n'), /unsupported rawtext component/);
});

test('titleraw: slots, times, clear, reset, errors', () => {
  const s = load(PLAYERS);
  assert.equal(run(s, '/titleraw @a title {"rawtext":[{"text":"§aHello"}]}'), true);
  assert.equal(run(s, '/titleraw alice subtitle {"rawtext":[{"text":"sub"}]}'), true);
  assert.equal(run(s, '/titleraw bob actionbar {"rawtext":[{"selector":"@e[name=stand]"}]}'), true);
  assert.equal(run(s, '/titleraw @a times 10 70 20'), true);
  assert.equal(run(s, '/titleraw @a clear'), true);
  assert.equal(run(s, '/titleraw @a reset'), true);
  assert.deepEqual(screens(s).map((e) => [e.to, e.slot, e.text]), [
    ['alice', 'title', '§aHello'], ['bob', 'title', '§aHello'], ['alice', 'subtitle', 'sub'], ['bob', 'actionbar', 'stand'],
    ['alice', 'times', '10 70 20'], ['bob', 'times', '10 70 20'], ['alice', 'clear', ''], ['bob', 'clear', ''],
    ['alice', 'reset', ''], ['bob', 'reset', ''],
  ]);
  assert.equal(run(s, '/titleraw @e[name=stand] title {"rawtext":[{"text":"x"}]}'), false);
  assert.equal(run(s, '/titleraw @a title {"text":"java"}'), false);
  assert.equal(run(s, '/titleraw @a title'), false);
  assert.equal(run(s, '/titleraw @a times 1 2'), false);
  assert.equal(run(s, '/titleraw @a bogus x'), false);
  assert.equal(run(s, '/titleraw @a clear extra'), false);
});

test('effect: apply, replace, expire, infinite, remove, clear, errors', () => {
  const s = load(PLAYERS);
  const alice = () => s.findEntity('alice')!;
  assert.equal(run(s, '/effect alice speed 2 1'), true);
  assert.deepEqual(alice().effects.speed, { amplifier: 1, ticks: 40, hideParticles: false });
  assert.equal(run(s, '/effect alice minecraft:speed 1 3 true'), true);
  assert.deepEqual(alice().effects.speed, { amplifier: 3, ticks: 20, hideParticles: true });
  s.advance(19);
  assert.equal(alice().effects.speed.ticks, 1);
  s.advance(1);
  assert.equal(alice().effects.speed, undefined);
  assert.ok(s.events.some((e) => e.type === 'change' && /effect speed expired/.test(e.what)));
  assert.equal(run(s, '/effect alice haste'), true);
  assert.equal(alice().effects.haste.ticks, 600);
  assert.equal(run(s, '/effect alice strength infinite 4'), true);
  assert.deepEqual(alice().effects.strength, { amplifier: 4, ticks: null, hideParticles: false });
  s.advance(5000);
  assert.ok(alice().effects.strength);
  assert.equal(alice().effects.haste, undefined);
  run(s, '/effect alice haste 5');
  assert.equal(run(s, '/effect alice haste 0'), true);
  assert.equal(run(s, '/effect alice haste 0'), false);
  assert.equal(run(s, '/effect @a clear strength'), true);
  assert.equal(run(s, '/effect @a clear'), false);
  assert.equal(run(s, '/effect alice instant_health 1 1'), true);
  assert.deepEqual(alice().effects, {});
  assert.equal(run(s, '/effect alice bogus'), false);
  assert.equal(run(s, '/effect alice speed 1 256'), false);
  assert.equal(run(s, '/effect alice speed -1'), false);
  assert.equal(run(s, '/effect alice speed 1 0 maybe'), false);
  assert.equal(run(s, '/effect @e[name=zzz] speed'), false);
  assert.equal(run(s, '/effect alice'), false);
  s.reset();
  assert.deepEqual(alice().effects, {});
});

test('gamerule: query, set, validation, feedback switch', () => {
  const s = load();
  assert.equal(run(s, '/gamerule pvp'), true);
  assert.deepEqual(chats(s, 'system'), [[null, 'pvp = true']]);
  assert.equal(run(s, '/gamerule PvP false'), true);
  assert.equal(s.world.gamerules.pvp, false);
  assert.equal(chats(s, 'system').at(-1)![1], 'Game rule pvp has been updated to false');
  assert.equal(run(s, '/gamerule randomtickspeed 7'), true);
  assert.equal(s.world.gamerules.randomtickspeed, 7);
  assert.equal(run(s, '/gamerule pvp maybe'), false);
  assert.equal(run(s, '/gamerule randomtickspeed x'), false);
  assert.equal(run(s, '/gamerule randomtickspeed -1'), false);
  assert.equal(run(s, '/gamerule nonsense'), false);
  assert.equal(run(s, '/gamerule'), false);
  assert.equal(run(s, '/gamerule pvp true extra'), false);
  const before = chats(s, 'system').length;
  run(s, '/gamerule sendcommandfeedback false');
  run(s, '/gamerule pvp');
  run(s, '/gamerule pvp true');
  assert.equal(chats(s, 'system').length, before);
  s.reset();
  assert.equal(s.world.gamerules.pvp, true);
});

test('gamerules that the simulator enforces', () => {
  const s = load('chain a:\n /say hi\nchain b(position=(0, 5, 0)):\n /say block');
  run(s, '/gamerule commandblocksenabled false');
  s.activate('a');
  s.activate('b');
  s.advance(1);
  assert.equal(s.events.filter((e) => e.type === 'chat' && e.kind === 'say').length, 0);
  assert.equal(s.events.filter((e) => e.type === 'trace' && /commandblocksenabled/.test(e.message)).length, 2);
  run(s, '/gamerule commandblocksenabled true');
  s.activate('a');
  s.advance(1);
  assert.equal(s.events.filter((e) => e.type === 'chat' && e.kind === 'say').length, 1);

  const loop = load('chain x(position=(0,0,0)):\n cb(mode=rep, power=always_on)\n /say tick\nchain y(position=(5,0,0)):\n cb(mode=rep, power=always_on)\n /say tock');
  loop.world.gamerules.maxcommandchainlength = 1;
  loop.advance(1);
  assert.match(JSON.stringify(loop.events), /maxcommandchainlength = 1/);
  assert.equal(loop.events.filter((e) => e.type === 'chat' && e.kind === 'say').length, 1);
});

test('mctext: colors, bold, italic, reset, unknown codes', () => {
  assert.deepEqual(parseMcText('plain'), [{ text: 'plain', color: null, bold: false, italic: false }]);
  assert.deepEqual(parseMcText('\u00a7cred \u00a7lbold\u00a7r none'), [
    { text: 'red ', color: '#ff5555', bold: false, italic: false },
    { text: 'bold', color: '#ff5555', bold: true, italic: false },
    { text: ' none', color: null, bold: false, italic: false },
  ]);
  assert.equal(parseMcText('a\u00a7zb').map((x) => x.text).join(''), 'a\u00a7zb');
  assert.equal(parseMcText('x\u00a7').map((x) => x.text).join(''), 'x\u00a7');
  assert.deepEqual(parseMcText('\u00a7o\u00a7gG').map((x) => [x.text, x.color, x.italic]), [['G', '#ddd605', true]]);
});
