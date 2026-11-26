import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, splitTop } from '../src/language/parser.ts';
import { Simulation } from '../src/engine/simulation.ts';
import { matchCommand } from '../src/language/grammar.ts';

const words = (cmd: string) => splitTop(cmd.replace(/^\//, ''), (c) => /\s/.test(c)).map((t) => t.text);

const OK = [
  'say hello world', 'tag @a add x', 'tag @e[type=fox] remove y', 'tag @s list', 'tp @s 1 2 3', 'tp 1 2 3', 'tp @s ~ ~1 ~ 90 0', 'tp @s @a[name=bob]', 'tp @s ~~~',
  'teleport @a ^ ^ ^1', 'setblock 0 0 0 stone', 'setblock ~ ~-1 ~ lever ["open_bit"=true] keep', 'setblock 1 2 3 lever["open_bit"=false]',
  'scoreboard objectives add t dummy', 'scoreboard objectives add t dummy My Name', 'scoreboard objectives remove t', 'scoreboard players set @s t 5',
  'scoreboard players add @a t -1', 'scoreboard players reset @a', 'scoreboard players reset @a t', 'scoreboard players operation @s t += @a t',
  'summon fox', 'summon fox 0 64 0', 'summon fox ~ ~ ~ 90 0', 'summon fox ~~~ ~ ~ minecraft:as_adult "wiki:fmbe"', 'kill', 'kill @e[type=fox]',
  'fill 0 0 0 5 5 5 stone', 'fill 0 0 0 5 5 5 stone hollow', 'fill 0 0 0 5 5 5 air replace stone', 'clone 0 0 0 1 1 1 5 5 5', 'clone 0 0 0 1 1 1 5 5 5 masked move',
  'clone 0 0 0 1 1 1 5 5 5 filtered normal stone', 'testfor @a', 'testforblock 0 0 0 stone', 'tellraw @a {"rawtext":[{"text":"hi"}]}',
  'titleraw @a title {"rawtext":[{"text":"hi"}]}', 'titleraw @a times 1 2 3', 'titleraw @a clear', 'title @a title Hello there', 'title @a times 5 20 5', 'title @a reset',
  'give @a diamond', 'give @a diamond 5', 'give @a diamond 5 0', 'clear', 'clear @a', 'clear @a diamond', 'clear @a diamond 0 3',
  'replaceitem entity @s slot.weapon.mainhand 0 diamond', 'replaceitem entity @s slot.hotbar 2 keep apple 3', 'replaceitem block 0 0 0 slot.container 0 apple',
  'effect @a speed', 'effect @a speed 10 1 true', 'effect @a clear', 'effect @a clear speed', 'gamerule dodaylightcycle', 'gamerule dodaylightcycle false',
  'playanimation @e animation.a', 'playanimation @e animation.a none 0 "v.a=1;" ctl', 'stopsound @a', 'stopsound @a mob.fox.spit', 'particle minecraft:villager_happy',
  'particle minecraft:villager_happy 1 2 3', 'enchant @a sharpness', 'enchant @a sharpness 3', 'enchant @a 9 2', 'gamemode creative', 'gamemode c @a', 'gamemode 1 @a',
  'inputpermission set @a movement disabled', 'inputpermission query @a jump', 'inputpermission query @a jump enabled', 'kick @a bye now', 'list', 'xp 10', 'xp 5L @a',
  'structure save a 0 0 0 1 1 1', 'structure save a 0 0 0 1 1 1 memory', 'structure delete a', 'structure load a 1 2 3', 'structure load a 1 2 3 90_degrees x',
  'tickingarea add 0 0 0 15 10 15', 'tickingarea add 0 0 0 15 10 15 spawn true', 'tickingarea add circle 0 0 0 2', 'tickingarea remove spawn', 'tickingarea remove 0 0 0',
  'tickingarea remove_all', 'tickingarea list', 'tickingarea preload spawn false',
  'execute as @a run say hi', 'execute as @a at @s run tp @s ~ ~1 ~', 'execute if block 0 0 0 stone run say a', 'execute unless entity @e[type=fox] run say b',
  'execute if score @s t matches 1..5 run say c', 'execute if score @s t >= @a t run say d', 'execute positioned as @s rotated as @s positioned ^ ^ ^1 run particle minecraft:villager_happy ~ ~ ~',
  'execute facing entity @s eyes run say e', 'execute align xyz anchored eyes run say f', 'execute in overworld run say g', 'execute rotated 90 0 run say h',
  'execute if blocks 0 0 0 1 1 1 5 5 5 all run say i', 'execute as @a run execute at @s run kill @e',
];

const BAD = [
  'say', 'tag', 'tag @a add', 'tag @a bad x', 'tp', 'setblock 0 0 0', 'setblock 0 0', 'scoreboard', 'scoreboard objectives add t', 'scoreboard players set @s t',
  'scoreboard players set @s t x', 'summon', 'fill 0 0 0 1 1 1', 'clone 0 0 0 1 1 1', 'testforblock 0 0 0', 'tellraw @a', 'titleraw @a', 'titleraw @a times 1 2', 'title @a title',
  'title @a times 1 2', 'give', 'give @a', 'give @a diamond x', 'replaceitem entity @s', 'effect', 'effect @a', 'playanimation', 'playanimation @e', 'particle',
  'enchant', 'enchant @a', 'enchant @a sharpness x', 'gamemode', 'inputpermission', 'inputpermission set @a movement', 'inputpermission query @a', 'kick', 'kick @a', 'xp',
  'structure', 'structure save a', 'structure delete', 'tickingarea', 'tickingarea add', 'tickingarea add 0 0 0', 'execute', 'execute as', 'execute as @a', 'execute as @a run',
  'execute if', 'execute bogus @a run say x', 'list extra',
  'time', 'time set', 'time query', 'time bogus', 'weather', 'weather snow', 'difficulty', 'difficulty 9', 'setworldspawn 1 2', 'playsound', 'tell', 'tell @a',
  'testforblocks 0 0 0 1 1 1', 'testforblocks 0 0 0 1 1 1 5 5 5 bogus',
];

function engineSyntaxError(cmd: string): boolean {
  const s = new Simulation(parse('ent(type=player, position=(0,0,0), name=alice)\nent(type=fox, position=(1,0,0), name=f)\nblock(type=stone, position=(0,0,0))'));
  s.runCommand(`/${cmd}`, null, [0, 0, 0]);
  return s.events.some((e) => e.type === 'trace' && e.status === 'syntax_error');
}
const s2 = engineSyntaxError;

function engineRejects(cmd: string): boolean {
  const s = new Simulation(parse('ent(type=player, position=(0,0,0), name=alice)\nent(type=fox, position=(1,0,0), name=f)\nblock(type=stone, position=(0,0,0))'));
  return !s.runCommand(`/${cmd}`, null, [0, 0, 0]);
}

test('commands the grammar accepts are not syntax errors in the engine', () => {
  const bad: string[] = [];
  for (const c of OK) {
    const r = matchCommand(words(c));
    if (r.state !== 'ok') bad.push(`table rejects: ${c} (${r.state})`);
    else if (s2(c)) bad.push(`engine rejects: ${c}`);
  }
  assert.deepEqual(bad, []);
});

test('commands the grammar rejects or finds incomplete are syntax errors in the engine', () => {
  const bad: string[] = [];
  for (const c of BAD) {
    const r = matchCommand(words(c));
    if (r.state === 'ok') bad.push(`table accepts: ${c}`);
    else if (!engineRejects(c)) bad.push(`engine accepts: ${c}`);
  }
  assert.deepEqual(bad, []);
});

test('matchCommand reports what may come next', () => {
  const next = (c: string) => matchCommand(words(c)).expected.map((e) => (e.k === 'lit' ? e.v : e.k === 'kw' ? `<${e.name}>` : `<${e.k === 'val' ? e.name : e.name}>`));
  assert.ok(next('gamemode').includes('<mode>'));
  assert.deepEqual(next('inputpermission'), ['set', 'query']);
  assert.ok(next('execute as @a').includes('run') && next('execute as @a').includes('at'));
  assert.ok(next('execute as @a run').includes('say'));
  assert.deepEqual(next('tickingarea add circle 0 0 0 2').sort(), ['<name>']);
  assert.equal(matchCommand(words('bogus')).state, 'error');
});