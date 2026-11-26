import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/language/parser.ts';
import { Simulation } from '../src/engine/simulation.ts';
import { clockText } from '../src/engine/clock.ts';

const O: [number, number, number] = [0, 0, 0];
const make = (src = 'a = ent(type=player, position=(1, 65, 2), name=alice)\nent(type=player, position=(5, 65, 5), name=bob)') => new Simulation(parse(src));
const chats = (s: Simulation) => s.events.flatMap((e) => (e.type === 'chat' ? [e.text] : []));

test('time set keeps the current day; add and query work on the same clock', () => {
  const s = make();
  assert.equal(s.runCommand('/time set night', null, O), true);
  assert.equal(s.world.time, 13000);
  s.world.time = 2 * 24000 + 500;
  assert.equal(s.runCommand('/time set noon', null, O), true);
  assert.equal(s.world.time, 2 * 24000 + 6000);
  assert.equal(s.runCommand('/time set 30000', null, O), true);
  assert.equal(s.world.time, 2 * 24000 + 6000);
  assert.equal(s.runCommand('/time add 24000', null, O), true);
  assert.equal(s.world.time, 3 * 24000 + 6000);
  assert.equal(s.runCommand('/time add -999999', null, O), true);
  assert.equal(s.world.time, 0);
  s.world.time = 2 * 24000 + 100;
  s.runCommand('/time query daytime', null, O);
  s.runCommand('/time query day', null, O);
  s.runCommand('/time query gametime', null, O);
  assert.deepEqual(chats(s).slice(-3), ['Daytime is 100', 'Day is 2', 'The game time is 0']);
  for (const bad of ['/time', '/time set', '/time set bogus', '/time set -5', '/time query hour', '/time add x', '/time set day extra', '/time sunrise']) {
    assert.equal(s.runCommand(bad, null, O), false, bad);
  }
});

test('the clock runs with the ticks and stops when the daylight cycle is locked', () => {
  const s = make();
  s.advance(100);
  assert.deepEqual([s.world.time, s.world.gameTime], [100, 100]);
  assert.equal(s.runCommand('/daylock true', null, O), true);
  assert.equal(s.world.gamerules.dodaylightcycle, false);
  s.advance(50);
  assert.deepEqual([s.world.time, s.world.gameTime], [100, 150]);
  assert.equal(s.runCommand('/daylock false', null, O), true);
  s.advance(10);
  assert.equal(s.world.time, 110);
  assert.equal(s.runCommand('/gamerule dodaylightcycle false', null, O), true);
  s.advance(10);
  assert.equal(s.world.time, 110);
  assert.equal(s.runCommand('/daylock maybe', null, O), false);
  assert.equal(clockText(0), '06:00');
  assert.equal(clockText(6000), '12:00');
  assert.equal(clockText(18000), '00:00');
  assert.equal(clockText(24000 + 1500), '07:30');
});

test('weather: set, timed expiry, query; difficulty names, letters and numbers', () => {
  const s = make();
  assert.equal(s.runCommand('/weather rain 20', null, O), true);
  assert.equal(s.world.weather, 'rain');
  s.advance(19);
  assert.equal(s.world.weather, 'rain');
  s.advance(1);
  assert.equal(s.world.weather, 'clear');
  s.runCommand('/weather thunder', null, O);
  s.advance(5000);
  assert.equal(s.world.weather, 'thunder');
  s.runCommand('/weather query', null, O);
  assert.equal(chats(s).at(-1), 'Weather is thunder');
  s.runCommand('/weather rain 5', null, O);
  s.runCommand('/weather clear', null, O);
  s.advance(10);
  assert.equal(s.world.weather, 'clear');
  for (const bad of ['/weather', '/weather snow', '/weather rain 0', '/weather rain x', '/weather rain 5 5', '/weather query x']) assert.equal(s.runCommand(bad, null, O), false, bad);
  for (const [c, d] of [['hard', 'hard'], ['0', 'peaceful'], ['e', 'easy'], ['2', 'normal'], ['p', 'peaceful']]) {
    assert.equal(s.runCommand(`/difficulty ${c}`, null, O), true, c);
    assert.equal(s.world.difficulty, d);
  }
  assert.equal(s.world.difficulty, 'peaceful');
  assert.equal(s.runCommand('/difficulty 4', null, O), false);
  assert.equal(s.runCommand('/difficulty', null, O), false);
});

test('spawn points: world spawn, player spawn defaults to the executor and floors positions', () => {
  const s = make();
  assert.equal(s.runCommand('/setworldspawn 10 64 -3', null, O), true);
  assert.deepEqual(s.world.spawn, [10, 64, -3]);
  assert.equal(s.runCommand('/setworldspawn ~ ~ ~', null, [4.7, 70.2, 9.9]), true);
  assert.deepEqual(s.world.spawn, [4, 70, 9]);
  assert.equal(s.runCommand('/setworldspawn', null, [1.5, 2, 3.5]), true);
  assert.deepEqual(s.world.spawn, [1, 2, 3]);
  const alice = s.world.entityByHandle('a')!;
  assert.equal(s.runCommand('/spawnpoint @a[name=alice] 7 8 9', null, O), true);
  assert.deepEqual(alice.spawn, [7, 8, 9]);
  assert.equal(s.runCommand('/spawnpoint @a[name=bob]', null, O), true);
  assert.deepEqual(s.world.entities.find((e) => e.name === 'bob')!.spawn, [5, 65, 5]);
  assert.equal(s.runCommand('/spawnpoint', null, O), false);
  assert.equal(s.runCommand('/spawnpoint 1 2 3', alice, O), true);
  assert.deepEqual(alice.spawn, [1, 2, 3]);
  assert.equal(s.runCommand('/clearspawnpoint @a[name=alice]', null, O), true);
  assert.equal(alice.spawn, null);
  assert.equal(s.runCommand('/clearspawnpoint', alice, O), true);
  assert.equal(s.runCommand('/clearspawnpoint @a[name=ghost]', null, O), false);
  assert.equal(s.runCommand('/setworldspawn 1 2', null, O), false);
});

test('playsound only records and validates its arguments', () => {
  const s = make();
  assert.equal(s.runCommand('/playsound random.levelup @a', null, O), true);
  assert.equal(s.runCommand('/playsound mob.fox.spit @a[name=alice] 1 2 3 0.5 2 0.1', null, O), true);
  assert.equal(s.runCommand('/playsound ambient.cave', s.world.entityByHandle('a')!, O), true);
  assert.ok(s.events.some((e) => e.type === 'change' && e.what.includes('hears random.levelup')));
  for (const bad of ['/playsound', '/playsound x @a 1 2 3 -1', '/playsound x @a 1 2 3 1 1 2', '/playsound x', '/playsound x @a[name=ghost]']) {
    assert.equal(s.runCommand(bad, null, O), false, bad);
  }
});

test('tell sends a private whisper in the game format', () => {
  const s = make();
  const alice = s.world.entityByHandle('a')!;
  assert.equal(s.runCommand('/tell @a[name=bob] hello  there', alice, O), true);
  assert.deepEqual(chats(s), ['<alice> \u00a7oalice whispers to you: hello  there\u00a7r', 'You whisper to bob: hello  there']);
  s.events = [];
  assert.equal(s.runCommand('/msg bob hi', null, O), true);
  assert.deepEqual(chats(s), ['<@> \u00a7o@ whispers to you: hi\u00a7r']);
  assert.equal(s.runCommand('/w @a[name=ghost] hi', alice, O), false);
  assert.equal(s.runCommand('/tell bob', alice, O), false);
  assert.equal(s.runCommand('/tell', alice, O), false);
});

test('testforblocks compares regions', () => {
  const s = make('block(type=stone, position=(0,0,0))\nblock(type=stone, position=(1,0,0))\nblock(type=stone, position=(10,0,0))\nblock(type=stone, position=(11,0,0))\nblock(type=dirt, position=(20,0,0))');
  assert.equal(s.runCommand('/testforblocks 0 0 0 1 0 0 10 0 0', null, O), true);
  assert.equal(s.runCommand('/testforblocks 0 0 0 1 0 0 20 0 0', null, O), false);
  assert.equal(s.runCommand('/testforblocks 0 0 0 1 0 0 20 0 0 masked', null, O), false);
  assert.equal(s.runCommand('/testforblocks 5 5 5 6 5 5 30 5 5 masked', null, O), true);
  assert.equal(s.runCommand('/testforblocks 5 5 5 6 5 5 30 5 5 all', null, O), true);
  assert.equal(s.runCommand('/testforblocks 0 0 0 1 0 0', null, O), false);
  assert.equal(s.runCommand('/testforblocks 0 0 0 1 0 0 10 0 0 bogus', null, O), false);
});
test('world(...) declares the starting time, weather, difficulty and spawn', () => {
  const p = parse('sp = (3, 64, -4)\nworld(time=night, weather=rain, difficulty=hard, spawn=sp)');
  assert.deepEqual(p.diagnostics, []);
  const s = new Simulation(p);
  assert.deepEqual([s.world.time, s.world.weather, s.world.difficulty, s.world.spawn], [13000, 'rain', 'hard', [3, 64, -4]]);
  s.runCommand('/time set noon', null, O);
  s.reset();
  assert.equal(s.world.time, 13000);
  assert.equal(new Simulation(parse('world(time=30000)')).world.time, 6000);
  assert.equal(new Simulation(parse('')).world.difficulty, 'normal');
  for (const bad of ['world(time=bogus)', 'world(weather=snow)', 'world(difficulty=insane)', 'world(spawn=(1,2))', 'world(speed=1)', 'world(time=day)\nworld(time=night)']) {
    assert.ok(parse(bad).diagnostics.length > 0, bad);
  }
  assert.deepEqual(parse('world(pos=(0,0,0))').diagnostics.length, 1);
});

test('world(...) and the new commands complete and explain themselves', async () => {
  const { complete, sceneFrom } = await import('../src/language/complete.ts');
  const at = (src: string) => {
    const cursor = src.indexOf('|');
    const text = src.replace('|', '');
    return complete(text, cursor, sceneFrom(text, parse(text))).items.map((i) => i.label);
  };
  assert.deepEqual(at('world(|').sort(), ['difficulty=', 'seed=', 'spawn=', 'time=', 'weather=']);
  assert.ok(at('world(time=|').includes('midnight'));
  assert.ok(at('world(weather=|').includes('thunder'));
  assert.ok(at('/tim|').includes('time'));
  assert.ok(at('/time set |').includes('noon'));
  assert.ok(at('/tel|').includes('tell'));
});
