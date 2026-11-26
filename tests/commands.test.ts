import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/language/parser.ts';
import { Simulation } from '../src/engine/simulation.ts';
import type { SimEvent } from '../src/engine/types.ts';

function load(src = ''): Simulation {
  const p = parse(src);
  assert.deepEqual(p.diagnostics, []);
  return new Simulation(p);
}

const O: [number, number, number] = [0, 0, 0];
const run = (s: Simulation, cmd: string, executor = null as ReturnType<Simulation['findEntity']> | null) => s.runCommand(cmd, executor ?? null, O);
const traces = (s: Simulation) => s.events.flatMap((e) => (e.type === 'trace' ? [e.message] : []));
const errors = (s: Simulation) => s.events.flatMap((e) => (e.type === 'chat' && e.kind === 'error' ? [e.text] : []));
const chats = (s: Simulation) => s.events.filter((e): e is Extract<SimEvent, { type: 'chat' }> => e.type === 'chat' && e.kind === 'say');
const particles = (s: Simulation) => s.events.flatMap((e) => (e.type === 'effect' ? [e.pos.join(',')] : []));
const block = (s: Simulation, p: [number, number, number]) => s.world.getBlock(p).replace('minecraft:', '');

test('registry: known-but-unimplemented vs unknown commands', () => {
  const s = load();
  assert.equal(run(s, '/locate biome plains'), false);
  assert.equal(run(s, '/frobnicate'), false);
  assert.deepEqual(errors(s), ['/locate is a Bedrock command that is not implemented yet', 'Unknown command: /frobnicate']);
  assert.deepEqual(
    s.events.flatMap((e) => (e.type === 'trace' ? [e.status] : [])),
    ['unimplemented', 'syntax_error'],
  );
  assert.equal(s.commands.get('particle')!.support, 'record');
  assert.equal(s.commands.get('teleport'), s.commands.get('tp'));
});

test('nx tree from the notes: 64 distinct points, 64 branches', () => {
  const s = load(`
ent(type=armor_stand, position=(9, 70, 9), rotation=(0, 0), tags=["p"])
ent(type=armor_stand, position=(9, 70, 9), rotation=(180, 0), tags=["p"])
ent(type=boat, position=(9, 70, 9), rotation=(0, -90), tags=["q"])
ent(type=boat, position=(9, 70, 9), rotation=(0, 90), tags=["q"])
`);
  const tree = 'execute positioned 2.0 66 2.0 rotated as @e[tag=p] positioned ^0.5 ^ ^ rotated as @e[tag=p] positioned ^1 ^ ^ rotated as @e[tag=p] positioned ^ ^ ^0.5 rotated as @e[tag=p] positioned ^ ^ ^1 rotated as @e[tag=q] positioned ^ ^ ^0.5 rotated as @e[tag=q] positioned ^ ^ ^1 run';
  assert.equal(run(s, `/${tree} particle minecraft:villager_happy ~ ~ ~`), true);
  const pts = particles(s);
  assert.equal(pts.length, 64);
  assert.equal(new Set(pts).size, 64);
  const expected = new Set<string>();
  for (const x of [0.5, 1.5, 2.5, 3.5]) for (const y of [64.5, 65.5, 66.5, 67.5]) for (const z of [0.5, 1.5, 2.5, 3.5]) expected.add(`${x},${y},${z}`);
  assert.deepEqual(new Set(pts), expected);
  run(s, '/scoreboard objectives add c dummy');
  run(s, `/${tree} scoreboard players add n c 1`);
  assert.equal(s.world.scores.get('c')!.get('n:n'), 64);
  run(s, `/${tree} scoreboard players add m c 1`);
  assert.equal(s.world.scores.get('c')!.get('n:m'), 64);
});

test('execute: facing, facing entity, align, anchored, positioned as, in', () => {
  const s = load(`
ent(type=player, position=(1.5, 10, 1.5), name=p)
ent(type=armor_stand, position=(1.5, 10, 6.5), name=a)
`);
  const seen = (cmd: string, prefix: string) => {
    s.events = [];
    run(s, cmd);
    return traces(s).filter((t) => t.startsWith(prefix));
  };
  assert.deepEqual(seen('/execute facing 0.0 0 5.0 run say x', 'facing'), ['facing (0, 0, 5): rotation (0, 0)']);
  assert.deepEqual(seen('/execute facing 5.0 0 0.0 run say x', 'facing'), ['facing (5, 0, 0): rotation (-90, 0)']);
  assert.deepEqual(seen('/execute facing 0.0 5 0.0 run say x', 'facing'), ['facing (0, 5, 0): rotation (0, -90)']);
  assert.deepEqual(seen('/execute positioned 1.5 10 1.5 facing entity @e[name=a] feet run say x', 'facing'), [
    'facing entity @e[name=a] feet -> 1 match(es)', 'facing a (armor_stand) (feet): rotation (0, 0)',
  ].filter((t) => t.startsWith('facing')));
  assert.deepEqual(seen('/execute positioned 1.7 2.9 -0.2 align xz run say x', 'align'), ['align xz -> (1, 2.9, -1)']);
  assert.deepEqual(seen('/execute positioned as @e[name=a] run say x', 'positioned').slice(-1), ['positioned as a (armor_stand): position (1.5, 10, 6.5)']);
  assert.equal(run(s, '/execute in overworld run say ok'), true);
  assert.equal(run(s, '/execute in nether run say warned'), true);
  assert.equal(run(s, '/execute in limbo run say no'), false);
  assert.equal(run(s, '/execute align xx run say no'), false);

  s.events = [];
  assert.equal(run(s, '/execute as @e[name=p] at @s anchored eyes positioned ^ ^ ^ run say x'), true);
  assert.deepEqual(traces(s).filter((t) => t.startsWith('positioned')), ['positioned (1.5, 11.62, 1.5)']);
  s.events = [];
  s.world.addEntity('minecraft:ghast', 'g', [0, 0, 0]);
  assert.equal(run(s, '/execute as @e[name=g] at @s anchored eyes positioned ^ ^ ^ run say x'), false);
  assert.match(errors(s)[0], /eye height of minecraft:ghast is not known/);
});

test('execute if/unless blocks', () => {
  const s = load(`
block(type=stone, position=(0,0,0))
block(type=dirt, position=(1,0,0))
block(type=stone, position=(0,0,5))
block(type=dirt, position=(1,0,5))
block(type=gold_block, position=(0,0,9))
`);
  const says = () => chats(s).length;
  run(s, '/execute if blocks 0 0 0 1 0 0 0 0 5 all run say same');
  assert.equal(says(), 1);
  run(s, '/execute if blocks 0 0 0 1 0 0 0 0 9 all run say no');
  assert.equal(says(), 1);
  run(s, '/execute unless blocks 0 0 0 1 0 0 0 0 9 all run say differ');
  assert.equal(says(), 2);
  run(s, '/execute if blocks 0 0 0 1 0 0 0 0 9 masked run say masked');
  assert.equal(says(), 2);
  run(s, '/execute if blocks 0 1 0 1 1 0 0 1 9 masked run say airs');
  assert.equal(says(), 3);
});

test('summon: forms and errors', () => {
  const s = load();
  const last = () => s.world.entities[s.world.entities.length - 1];
  assert.equal(run(s, '/summon armor_stand 1 2 3'), true);
  assert.deepEqual([last().type, last().pos, last().name, last().rot], ['minecraft:armor_stand', [1.5, 2, 3.5], null, [0, 0]]);
  run(s, '/summon armor_stand "Bob Smith" 4 5 6');
  assert.deepEqual([last().name, last().pos], ['Bob Smith', [4.5, 5, 6.5]]);
  run(s, '/summon armor_stand ~ ~1 ~ 90 -10 minecraft:ev "N"');
  assert.deepEqual([last().pos, last().rot, last().name], [[0, 1, 0], [90, -10], 'N']);
  assert.ok(s.events.some((e) => e.type === 'change' && /spawn event minecraft:ev is not simulated/.test(e.what)));
  run(s, '/summon armor_stand 0 0 0 facing 5 0 0');
  assert.deepEqual(last().rot, [-90, 0]);
  run(s, '/summon armor_stand');
  assert.deepEqual(last().pos, [0, 0, 0]);
  const before = s.world.entities.length;
  assert.equal(run(s, '/summon player'), false);
  assert.equal(run(s, '/summon armor_stand 0 0 0 0 0 a b c'), false);
  assert.equal(s.world.entities.length, before);
});

test('kill: removes mobs, keeps players, invalidates handles', () => {
  const s = load(`
h = ent(type=armor_stand, position=(0,0,0), name=a)
ent(type=player, position=(0,0,0), name=p)
`);
  assert.equal(run(s, '/kill'), false);
  assert.equal(run(s, '/kill @e[name=nobody]'), false);
  assert.equal(run(s, '/kill @e[name=a]'), true);
  assert.equal(s.world.entityByHandle('h'), undefined);
  assert.equal(run(s, '/kill @a'), true);
  assert.equal(s.world.entities.length, 1);
  const p = s.findEntity('p')!;
  s.events = [];
  assert.equal(s.runCommand('/kill', p, O), true);
  assert.match(JSON.stringify(s.events), /respawn are not simulated/);
});

test('fill: modes, filter, limits', () => {
  const s = load('region(from=(0,0,0), to=(40,40,40))');
  assert.equal(run(s, '/fill 0 0 0 2 2 2 stone'), true);
  assert.equal(block(s, [1, 1, 1]), 'stone');
  assert.equal(run(s, '/fill 0 0 0 2 2 2 stone'), false);
  run(s, '/fill 0 0 0 2 2 2 glass hollow');
  assert.deepEqual([block(s, [0, 0, 0]), block(s, [1, 1, 1])], ['glass', 'air']);
  run(s, '/fill 0 0 0 2 2 2 dirt keep');
  assert.deepEqual([block(s, [0, 0, 0]), block(s, [1, 1, 1])], ['glass', 'dirt']);
  run(s, '/fill 0 0 0 2 2 2 gold_block outline');
  assert.deepEqual([block(s, [0, 0, 0]), block(s, [1, 1, 1])], ['gold_block', 'dirt']);
  assert.equal(run(s, '/fill 0 0 0 2 2 2 air replace dirt'), true);
  assert.deepEqual([block(s, [0, 0, 0]), block(s, [1, 1, 1])], ['gold_block', 'air']);
  assert.equal(run(s, '/fill 0 0 0 40 40 40 stone'), false);
  assert.match(errors(s).at(-1)!, /Too many blocks/);
  assert.equal(run(s, '/fill 0 0 0 50 0 0 stone'), false);
  assert.match(errors(s).at(-1)!, /outside the simulated region/);
  run(s, '/fill 5 5 5 6 5 5 lever ["open_bit"=true]');
  assert.deepEqual(s.world.getBlockData([6, 5, 5]).states, { open_bit: true });
  assert.equal(run(s, '/fill 0 0 0 1 1 1 stone bogus'), false);
});

test('clone: masks, modes, overlap', () => {
  const s = load(`
region(from=(0,0,0), to=(40,10,10))
block(type=stone, position=(0,0,0))
block(type=dirt, position=(2,0,0))
`);
  assert.equal(run(s, '/clone 0 0 0 2 0 0 10 0 0'), true);
  assert.deepEqual([10, 11, 12].map((x) => block(s, [x, 0, 0])), ['stone', 'air', 'dirt']);
  run(s, '/fill 20 0 0 22 0 0 glass');
  run(s, '/clone 0 0 0 2 0 0 20 0 0 masked');
  assert.deepEqual([20, 21, 22].map((x) => block(s, [x, 0, 0])), ['stone', 'glass', 'dirt']);
  assert.equal(run(s, '/clone 0 0 0 2 0 0 1 0 0'), false);
  assert.match(errors(s).at(-1)!, /overlap/);
  assert.equal(run(s, '/clone 0 0 0 2 0 0 1 0 0 replace force'), true);
  assert.deepEqual([0, 1, 2, 3].map((x) => block(s, [x, 0, 0])), ['stone', 'stone', 'air', 'dirt']);
  run(s, '/clone 10 0 0 12 0 0 30 0 0 replace move');
  assert.deepEqual([10, 12, 30, 32].map((x) => block(s, [x, 0, 0])), ['air', 'air', 'stone', 'dirt']);
  assert.equal(run(s, '/clone 30 0 0 32 0 0 0 5 0 filtered normal dirt'), true);
  assert.deepEqual([0, 1, 2].map((x) => block(s, [x, 5, 0])), ['air', 'air', 'dirt']);
  assert.equal(run(s, '/clone 0 0 0 2 0 0 100 0 0'), false);
});

test('clone copies the complete block, including command block contents', () => {
  const s = load(`
chain a(position=(0, 5, 0), facing=east, rotation=rot(90, 0)):
    /say first
    cb(delay=3, conditional=true)
    /say second
block(type=lever, position=(0, 8, 0), states=["open_bit"=true])
`);
  assert.equal(s.runCommand('/clone 0 5 0 1 5 0 0 5 5', null, O), true);
  assert.equal(s.runCommand('/clone 0 8 0 0 8 0 5 8 0', null, O), true);
  assert.deepEqual(s.world.getBlockData([0, 5, 5]), s.world.getBlockData([0, 5, 0]));
  assert.deepEqual(s.world.getBlockData([1, 5, 5]), s.world.getBlockData([1, 5, 0]));
  assert.deepEqual(s.world.getBlockData([5, 8, 0]).states, { open_bit: true });
  assert.equal(s.world.getBlockData([1, 5, 5]).cb!.command, 'say second');
  s.world.getBlockData([0, 5, 0]).cb!.command = 'say changed';
  assert.equal(s.world.getBlockData([0, 5, 5]).cb!.command, 'say first');
  s.events = [];
  s.activateAt([0, 5, 5]);
  s.advance(5);
  assert.deepEqual(chats(s).map((c) => [c.tick, c.text]), [[0, 'first'], [3, 'second']]);
  s.world.getBlockData([0, 5, 5]).cb!.command = 'say ok';
  assert.equal(s.world.getBlockData([0, 5, 5]).cb!.rotation[0], 90);
});

test('replacing a copied command block with setblock drops its contents', () => {
  const s = load('chain a(position=(0, 5, 0)):\n /say first');
  s.runCommand('/clone 0 5 0 0 5 0 3 5 0', null, O);
  s.runCommand('/setblock 3 5 0 command_block ["facing_direction"=4,"conditional_bit"=false] destroy', null, O);
  assert.equal(s.world.getBlockData([3, 5, 0]).cb, undefined);
  s.events = [];
  s.activateAt([3, 5, 0]);
  s.advance(1);
  assert.deepEqual(chats(s), []);
});
test('testfor / testforblock', () => {
  const s = load(`
ent(type=player, position=(0,0,0), name=p)
block(type=lever, position=(0,0,0), states=["open_bit"=true])
`);
  assert.equal(run(s, '/testfor @a'), true);
  assert.equal(run(s, '/testfor @e[name=zzz]'), false);
  assert.equal(run(s, '/testforblock 0 0 0 lever ["open_bit"=true]'), true);
  assert.equal(run(s, '/testforblock 0 0 0 lever ["open_bit"=false]'), false);
  assert.equal(run(s, '/testforblock 0 0 0 stone'), false);
});

test('tellraw: rawtext parts, recipients, errors; particle is recorded', () => {
  const s = load(`
ent(type=player, position=(0,0,0), name=alice)
ent(type=player, position=(5,0,0), name=bob)
ent(type=armor_stand, position=(0,0,0), name=stand)
`);
  run(s, '/scoreboard objectives add money dummy');
  run(s, '/scoreboard players set alice money 7');
  assert.equal(run(s, '/tellraw @a {"rawtext":[{"text":"§aHi "},{"selector":"@e[name=stand]"},{"text":" "},{"score":{"name":"alice","objective":"money"}}]}'), true);
  assert.deepEqual(chats(s).map((c) => [c.to, c.text]), [['alice', '§aHi stand 7'], ['bob', '§aHi stand 7']]);
  assert.equal(run(s, '/tellraw @e[name=stand] {"rawtext":[{"text":"x"}]}'), false);
  assert.equal(run(s, '/tellraw @a {"text":"java style"}'), false);
  assert.equal(run(s, '/tellraw @a {not json'), false);
  assert.equal(errors(s).length, 2);
  assert.equal(run(s, '/particle minecraft:heart 1 2 3'), true);
  assert.deepEqual(particles(s), ['1.5,2,3.5']);
});

test('short argument names pos, rot and comp work and may not be mixed with the long ones', () => {
  const p = parse(`h = ent(type=armor_stand, pos=(1, 2, 3), rot=(90, 10), name=a)
block(type=chest, pos=(5, 0, 5))
item(target=(5, 0, 5), slot=slot.container, index=0, type=apple, comp={"minecraft:item_lock":{"mode":"lock_in_slot"}})
chain c(pos=(0, 0, 0), rot=rot(90, 0), facing=east):
    /say hi`);
  assert.deepEqual(p.diagnostics, []);
  const s = new Simulation(p);
  assert.deepEqual([s.world.entityByHandle('h')!.pos, s.world.entityByHandle('h')!.rot], [[1.5, 2, 3.5], [90, 10]]);
  assert.deepEqual(s.world.blocks.get('5,0,5')?.id, 'minecraft:chest');
  assert.ok(JSON.stringify(s.world.blocks.get('5,0,5')?.items ?? s.world.blocks.get('5,0,5')).includes('item_lock'));
  for (const bad of ['ent(type=fox, pos=(0,0,0), position=(1,1,1))', 'ent(type=fox, rot=(0,0), rotation=(0,0), pos=(0,0,0))']) {
    assert.match(parse(bad).diagnostics[0].message, /Duplicate argument|given twice/, bad);
  }
  assert.deepEqual(parse('ent(type=fox, position=(0,0,0), rotation=(5,0))').diagnostics, []);
});

test('enchant, gamemode, xp, inputpermission, kick and list act on players', () => {
  const s = new Simulation(parse('a = ent(type=player, position=(0,0,0), name=alice)\nent(type=player, position=(1,0,0), name=bob)\nent(type=fox, position=(2,0,0), name=f)\nitem(target=a, slot=slot.weapon.mainhand, type=diamond_sword)'));
  const run = (c: string) => s.runCommand(c, null, [0, 0, 0]);
  assert.equal(run('/enchant @a[name=alice] sharpness 3'), true);
  assert.deepEqual(s.world.entityByHandle('a')!.items['slot.hotbar:0'].components['minecraft:enchantments'], { sharpness: 3 });
  assert.equal(run('/enchant @a[name=bob] sharpness'), false);
  assert.equal(run('/enchant @a[name=alice] nope'), false);
  assert.equal(run('/enchant @a[name=alice] 9 0'), false);
  assert.equal(run('/enchant @e[type=fox] sharpness'), false);
  assert.equal(run('/gamemode creative @a[name=bob]'), true);
  assert.equal(s.world.entities.find((e) => e.name === 'bob')!.gamemode, 'creative');
  assert.equal(run('/gamemode c @e[type=fox]'), false);
  assert.equal(run('/gamemode 3 @a'), false);
  assert.equal(run('/gamemode s'), false);
  assert.equal(run('/gamemode 6 @a'), true);
  assert.equal(s.world.entityByHandle('a')!.gamemode, 'spectator');
  assert.equal(run('/xp 10 @a[name=alice]'), true);
  assert.deepEqual([s.world.entityByHandle('a')!.xpLevel, s.world.entityByHandle('a')!.xpPoints], [1, 3]);
  assert.equal(run('/xp 3L @a[name=alice]'), true);
  assert.equal(s.world.entityByHandle('a')!.xpLevel, 4);
  assert.equal(run('/xp -9L @a[name=alice]'), true);
  assert.equal(s.world.entityByHandle('a')!.xpLevel, 0);
  assert.equal(run('/xp -5 @a'), false);
  assert.equal(run('/xp abc'), false);
  assert.equal(run('/inputpermission set @a[name=bob] movement disabled'), true);
  assert.equal(run('/inputpermission query @a[name=bob] movement disabled'), true);
  assert.equal(run('/inputpermission query @a[name=bob] movement enabled'), false);
  assert.equal(run('/inputpermission query @a[name=alice] movement enabled'), true);
  assert.equal(run('/inputpermission set @a fly enabled'), false);
  assert.equal(run('/list'), true);
  const chat = s.events.flatMap((e) => (e.type === 'chat' ? [e.text] : []));
  assert.ok(chat.some((t) => t === 'There are 2 players online: alice, bob'));
  assert.equal(run('/kick @a[name=bob] being rude'), true);
  assert.equal(s.world.entities.some((e) => e.name === 'bob'), false);
  assert.ok(s.events.some((e) => e.type === 'chat' && e.text === 'Kicked bob from the game: being rude'));
  assert.equal(run('/kick @a[name=alice]'), false);
  assert.equal(run('/kick @a[name=ghost] x'), false);
});

test('title sends plain text to players', () => {
  const s = new Simulation(parse('ent(type=player, position=(0,0,0), name=alice)'));
  const run = (c: string) => s.runCommand(c, null, [0, 0, 0]);
  assert.equal(run('/title @a title Hello  world'), true);
  assert.equal(run('/title @a subtitle sub'), true);
  assert.equal(run('/title @a times 5 20 5'), true);
  assert.equal(run('/title @a clear'), true);
  assert.equal(run('/title @a bad x'), false);
  assert.equal(run('/title @a times 5 x 5'), false);
  assert.equal(run('/title @a title'), false);
  const screens = s.events.flatMap((e) => (e.type === 'screen' ? [`${e.slot}:${e.text}`] : []));
  assert.deepEqual(screens, ['title:Hello  world', 'subtitle:sub', 'times:5 20 5', 'clear:']);
});

test('structure syntax is checked; tickingarea keeps a list', () => {
  const s = new Simulation(parse(''));
  const run = (c: string) => s.runCommand(c, null, [0, 0, 0]);
  for (const ok of [
    '/structure save a 0 0 0 5 5 5', '/structure save a 0 0 0 5 5 5 memory', '/structure save a ~ ~ ~ ~5 ~5 ~5 true disk false',
    '/structure load a 1 2 3', '/structure load a 1 2 3 90_degrees xz', '/structure load a 1 2 3 0_degrees none layer_by_layer 2.5 true true false 80 seed', '/structure delete a',
  ]) assert.equal(run(ok), true, ok);
  for (const bad of [
    '/structure', '/structure save a', '/structure save a 0 0 0 5 5', '/structure save a 0 0 0 5 5 5 tape', '/structure delete', '/structure load a 1 2 3 45_degrees',
    '/structure load a 1 2 3 0_degrees side', '/structure load a 1 2 3 0_degrees none layer_by_layer x', '/structure load a 1 2 3 0_degrees none yes', '/structure copy a',
  ]) assert.equal(run(bad), false, bad);
  assert.equal(s.world.blocks.size, 0);
  assert.equal(run('/tickingarea add 0 0 0 15 10 15 spawn true'), true);
  assert.equal(run('/tickingarea add circle 100 64 100 2'), true);
  assert.equal(run('/tickingarea add 0 0 0 1 1 1 spawn'), false);
  assert.deepEqual(s.world.tickingAreas.map((a) => [a.name, a.kind, a.preload]), [['spawn', 'box', true], ['Area2', 'circle', false]]);
  assert.equal(run('/tickingarea preload Area2 true'), true);
  assert.equal(s.world.tickingAreas[1].preload, true);
  assert.equal(run('/tickingarea remove 5 5 5'), true);
  assert.deepEqual(s.world.tickingAreas.map((a) => a.name), ['Area2']);
  assert.equal(run('/tickingarea remove nope'), false);
  assert.equal(run('/tickingarea list'), true);
  assert.equal(run('/tickingarea remove_all'), true);
  assert.equal(s.world.tickingAreas.length, 0);
  assert.equal(run('/tickingarea add 0 0 0'), false);
  assert.equal(run('/tickingarea'), false);
});

test('enchant checks the level limit and refuses incompatible enchantments', () => {
  const s = new Simulation(parse('a = ent(type=player, position=(0,0,0), name=alice)\nitem(target=a, slot=slot.weapon.mainhand, type=diamond_sword)'));
  const run = (c: string) => s.runCommand(c, null, [0, 0, 0]);
  const ench = () => s.world.entityByHandle('a')!.items['slot.hotbar:0'].components['minecraft:enchantments'];
  assert.equal(run('/enchant @a sharpness 5'), true);
  assert.equal(run('/enchant @a sharpness 6'), false);
  assert.equal(run('/enchant @a smite 1'), false);
  assert.equal(run('/enchant @a 10 1'), false);
  assert.equal(run('/enchant @a sharpness 2'), true);
  assert.deepEqual(ench(), { sharpness: 2 });
  assert.equal(run('/enchant @a unbreaking 3'), true);
  assert.equal(run('/enchant @a unbreaking 4'), false);
  assert.equal(run('/enchant @a mending'), true);
  assert.equal(run('/enchant @a infinity'), false);
  assert.equal(run('/enchant @a 17 3'), true);
  assert.equal(run('/enchant @a 99'), false);
  assert.equal(run('/enchant @a looting 0'), false);
  assert.deepEqual(ench(), { sharpness: 2, unbreaking: 3, mending: 1 });
  const msgs = s.events.flatMap((e) => (e.type === 'trace' ? [e.message] : []));
  assert.ok(msgs.some((m) => /level 6 is too high for sharpness \(maximum 5\)/.test(m)));
  assert.ok(msgs.some((m) => /smite cannot be combined with sharpness/.test(m)));
});

test('absolute x and z without a decimal point are block centres, like in the game', () => {
  const s = new Simulation(parse(''));
  const fox = () => s.world.entities[s.world.entities.length - 1].pos;
  const run = (c: string) => s.runCommand(c, null, [0, 0, 0]);
  run('/summon fox 1 2 3');
  assert.deepEqual(fox(), [1.5, 2, 3.5]);
  run('/summon fox 1.0 2 3.0');
  assert.deepEqual(fox(), [1, 2, 3]);
  run('/summon fox -5 64 -0');
  assert.deepEqual(fox(), [-4.5, 64, 0.5]);
  run('/summon fox 0.0 7 ~');
  assert.deepEqual(fox(), [0, 7, 0]);
  run('/execute positioned 0 0 0 run summon fox ~ ~ ~');
  assert.deepEqual(fox(), [0.5, 0, 0.5]);
  run('/execute positioned 2.5 0 4 facing 0 0 0 run summon fox ^^^1');
  const [x, , z] = fox();
  assert.ok(Math.abs(x - (2.5 - 2 / Math.hypot(2, 4))) < 1e-9 && Math.abs(z - (4.5 - 4 / Math.hypot(2, 4))) < 1e-9);
  run('/setblock 5 6 7 stone');
  assert.equal(s.world.getBlock([5, 6, 7]), 'minecraft:stone');
});
