import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintCommands, diagnoseWords } from '../src/language/cmdlint.ts';
import { logicalLines } from '../src/language/lines.ts';
import { mapLogical } from '../src/language/spans.ts';

const at = (src: string, d: { span?: { from: number; to: number } }) => (d.span ? src.slice(d.span.from, d.span.to) : null);

test('mapLogical maps joined characters back through continuation lines, indents and comments', () => {
  const src = '/execute as @a \\\n    run say hi # note\n/say next';
  const g = logicalLines(src)[0];
  const m = mapLogical(src, g);
  assert.equal(m.text, '/execute as @a run say hi');
  assert.equal(src[m.offsets[m.text.indexOf('run')]], 'r');
  assert.equal(src.slice(m.offsets[m.text.indexOf('say')], m.offsets[m.text.indexOf('say')] + 3), 'say');
  assert.equal(m.offsets.length, m.text.length);
});

test('a wrong word is pinpointed, with the right offsets', () => {
  const cases: [string, string, RegExp][] = [
    ['/setblock 0 0 stone', 'stone', /Unexpected "stone"/],
    ['/gamemode', 'gamemode', /Incomplete/],
    ['/execute as @a runn say hi', 'runn', /Unexpected "runn"/],
    ['/list extra', 'extra', /nothing more is expected/],
    ['/zzz 1 2', 'zzz', /Unknown command/],
    ['/kill @e extra', 'extra', /Unexpected/],
  ];
  for (const [src, word, re] of cases) {
    const d = lintCommands(src);
    assert.equal(d.length, 1, src);
    assert.equal(at(src, d[0]), word, src);
    assert.match(d[0].message, re, src);
  }
});

test('continuation lines, nested run and text after other lines keep exact positions', () => {
  const src = 'say x\n/execute as @a \\\n    at @s \\\n    run setblock ~ ~ stone\n/say fine';
  const d = lintCommands(src);
  assert.equal(d.length, 1);
  assert.equal(d[0].line, 2);
  assert.equal(at(src, d[0]), 'stone');
  assert.equal(src.slice(0, d[0].span!.from).split('\n').length, 4);
});

test('valid commands, interpolation, comments and unimplemented commands are not reported', () => {
  const src = [
    '/tp @s ${pos1} ${r1}', '/tp @s ${pos1.x} ${pos1.y} ${pos1.z} ${r1.yrot} ${r1.xrot}', '/say hi # /zzz', '# /zzz', '/time set day',
    '/execute as @a at @s if block ~ ~-1 ~ gold_block run tag @s add ready', '/locate structure village', '    /scoreboard players set @s t 5',
  ].join('\n');
  assert.deepEqual(lintCommands(src), []);
});

test('chinese text before the error does not shift the offsets', () => {
  const src = '/say 你好\n/setblock 1 2 oops';
  const d = lintCommands(src);
  assert.equal(at(src, d[0]), 'oops');
});

test('diagnoseWords describes what was expected', () => {
  assert.match(diagnoseWords(['inputpermission', 'bad'])!.message, /set \| query/);
  assert.match(diagnoseWords(['weather', 'snow'])!.message, /clear \| rain \| thunder|<type>/);
  assert.equal(diagnoseWords(['time', 'set', 'day']), null);
  assert.equal(diagnoseWords(['allowlist', 'x']), null);
});
test('coordinates may be split over the words in any way', () => {
  const ok = ['~~ 0', '~ 0~', '~0~0~', '~0 0~0', '~~0 ~', '~ ~0 0', '1 ~ ~', '~1~ 2', '~~~', '~-1~~1', '1~2 3', '^ ^1^', '^^^', '^1^^-2', '${p}', '${p.x} ${p.y} ${p.z}', '${p.x} ~ 3'];
  for (const c of ok) {
    assert.deepEqual(lintCommands(`/summon fox ${c}\n/setblock ${c} stone\n/execute positioned ${c} run say x\n/tp @s ${c} facing ${c}`), [], c);
  }
  for (const c of ['~ ~', '~~~~', '0~ ~0~', '^^ 1', '~ ^ ~', 'a b c', '~~ 0 0']) {
    assert.ok(lintCommands(`/setblock ${c} stone`).length > 0, c);
  }
  assert.match(lintCommands('/setblock ~ ~ stone')[0].message, /expected <position>|Unexpected "stone"/);
});

test('commands without an implementation are still syntax checked, also after execute ... run', () => {
  const ok = [
    '/damage @a[r=4] 9 entity_explosion', '/damage @s 5', '/damage @e[type=cow] 3 fall entity @p',
    '/execute as @e[type=tnt] at @s run damage @a[r=4] 9 entity_explosion', '/execute as @a run camera @s clear', '/camera @a fade time 1 2 3 color 0 0 0',
    '/ride @s start_riding @e[type=horse,c=1] teleport_rider if_group_fits', '/ride @e[type=horse] evict_riders', '/ride @s summon_ride horse reassign_rides', '/event entity @e[type=cow] minecraft:ageable_grow_up',
    '/fog @a push minecraft:fog_hell my_fog', '/fog @a remove my_fog', '/loot spawn ~ ~ ~ loot entities/zombie', '/loot replace entity @s slot.weapon.mainhand 0 loot x',
    '/locate structure village', '/locate biome plains', '/place structure mineshaft ~ ~ ~', '/spreadplayers 0 0 5 20 @a', '/spreadplayers ~ ~ 5 20 @a',
    '/schedule on_area_loaded add 0 0 0 5 5 5 fn', '/schedule on_area_loaded add tickingarea t fn', '/execute run ride @s stop_riding', '/execute if entity @s run locate biome plains',
    '/execute run function mypack/start', '/execute run camerashake add @a', '/execute run allowlist list',
  ];
  for (const c of ok) assert.deepEqual(lintCommands(c), [], c);
  const cases: [string, string][] = [
    ['/damage @a nine', 'nine'], ['/damage @a 5 magicc', 'magicc'], ['/damage', 'damage'], ['/execute run damage @a 5 fall entity', 'entity'],
    ['/ride @s dance', 'dance'], ['/event @s x', '@s'], ['/fog @a add x y', 'add'], ['/locate nothing x', 'nothing'], ['/spreadplayers a b 5 20 @a', 'a'], ['/execute run nosuchcommand 1', 'nosuchcommand'],
  ];
  for (const [src, word] of cases) {
    const d = lintCommands(src);
    assert.equal(d.length, 1, src);
    assert.equal(src.slice(d[0].span!.from, d[0].span!.to), word, src);
  }
  assert.match(lintCommands('/execute run nosuchcommand')[0].message, /Unknown command \/nosuchcommand|expected a command name/);
  assert.match(lintCommands('/execute run 5')[0].message, /expected a command name/);
});
