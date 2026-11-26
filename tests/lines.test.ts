import { test } from 'node:test';
import assert from 'node:assert/strict';
import { logicalLines } from '../src/language/lines.ts';
import { joinScript, wrapCommand, wrapScript } from '../src/language/format.ts';
import { parse } from '../src/language/parser.ts';
import { Simulation } from '../src/engine/simulation.ts';
import { DEFAULT_SPEC, generate } from '../src/plugins/nxtree/core.ts';

test('logicalLines: continuation joins physical lines under one number', () => {
  const ls = logicalLines('a \\\n   b \\\n   c\nd\n\n# e \\\nf');
  assert.deepEqual(ls.map((l) => [l.line, l.physical, l.count, l.text]), [
    [1, 0, 3, 'a b c'], [2, 3, 1, 'd'], [3, 4, 1, ''], [4, 5, 1, ''], [5, 6, 1, 'f'],
  ]);
});

test('logicalLines: trailing comment after the backslash, empty continuation pieces, backslash at end of file', () => {
  assert.equal(logicalLines('a \\ # note\n  b').length, 1);
  assert.equal(logicalLines('a \\ # note\n  b')[0].text, 'a b');
  assert.equal(logicalLines('a \\\n\\\n  b')[0].text, 'a b');
  assert.deepEqual(logicalLines('a \\').map((l) => l.text), ['a']);
  assert.equal(logicalLines('a\r\nb \\\r\n c').length, 2);
});

test('parser: continued commands and declarations count as one line', () => {
  const p = parse(`
ent(type=armor_stand, \\
    position=(0, 0, 0), \\
    name=a)
/execute as @e[name=a] \\
    at @s \\
    run say hi
/frobnicate
cb(type=imp)
/say last
`);
  assert.deepEqual(p.diagnostics.map((d) => d.line), [5, 6].map(() => 0).length ? p.diagnostics.map((d) => d.line) : []);
  assert.deepEqual(p.entities.map((e) => e.name), ['a']);
  assert.deepEqual(p.chains[0].nodes.map((n) => [n.line, n.command]), [
    [3, 'execute as @e[name=a] at @s run say hi'], [4, 'frobnicate'], [6, 'say last'],
  ]);
  assert.deepEqual(p.diagnostics.map((d) => d.line), [5]);
});

test('a continued command runs and errors are reported on its logical line', () => {
  const s = new Simulation(parse('ent(type=armor_stand, position=(0,0,0), name=a)\n/execute as @e[name=a] \\\n    at @s \\\n    run say hi\n/frobnicate'));
  s.runChain('main');
  const chat = s.events.filter((e) => e.type === 'chat');
  assert.deepEqual(chat.map((c) => [c.kind, c.line]), [['say', 2], ['error', 3]]);
});

test('wrapCommand: breaks only between execute subcommands', () => {
  const cmd = '/execute positioned 2 66 2 rotated as @e[tag=p] positioned ^0.5 ^ ^ rotated as @e[tag=p] positioned ^1 ^ ^ run particle minecraft:villager_happy ~ ~ ~';
  const lines = wrapCommand(cmd, 60);
  assert.ok(lines.length > 1);
  assert.ok(lines.slice(0, -1).every((l) => l.endsWith(' \\')));
  assert.ok(lines.slice(1).every((l) => l.startsWith('    ')));
  assert.ok(lines.every((l) => !/rotated\s*\\?$/.test(l) && !/\bas \\$/.test(l)));
  assert.ok(lines.at(-1)!.includes('run particle minecraft:villager_happy ~ ~ ~'));
  assert.equal(logicalLines(lines.join('\n'))[0].text.replace(/\s+/g, ' '), cmd.trim().replace(/\s+/g, ' ').replace(/^\//, '/'));
  assert.deepEqual(wrapCommand('/say hello world this is a long message that never gets split no matter how long it is', 20), [
    '/say hello world this is a long message that never gets split no matter how long it is',
  ]);
  assert.deepEqual(wrapCommand('/execute run say a', 5), ['/execute run say a']);
  assert.equal(wrapCommand('/execute as @a run say hi', 200).length, 1);
});

test('wrapScript and joinScript are inverses for plain commands', () => {
  const long = `/${generate(DEFAULT_SPEC).command}`;
  const script = `# scene\nchain a:\n    ${long}\n    /say short\n`;
  const wrapped = wrapScript(script, 100);
  assert.ok(wrapped.split('\n').length > script.split('\n').length);
  assert.ok(wrapped.includes('/say short'));
  assert.equal(joinScript(wrapped), script);
  const withComment = `/execute as @a ${'at @s '.repeat(30)}run say hi # keep\n`;
  assert.equal(wrapScript(withComment, 50), withComment);
  assert.equal(joinScript('/say a \\ # not joined\n b'), '/say a \\ # not joined\n b');
});

test('a wrapped nx tree command parses to the same command and the same 64 particles', () => {
  const g = generate(DEFAULT_SPEC);
  const wrapped = wrapCommand(`/${g.command}`, 80).join('\n');
  assert.ok(wrapped.split('\n').length >= 3);
  const p = parse(`${g.entities}\n${wrapped}`);
  assert.deepEqual(p.diagnostics, []);
  assert.equal(p.chains[0].nodes[0].command, g.command);
  const s = new Simulation(p);
  s.runChain('main');
  assert.equal(s.events.filter((e) => e.type === 'effect').length, 64);
});
test('wrapCommand splits a long playanimation Molang string after semicolons and it still parses', () => {
  const cmd = '/playanimation @e[tag=wiki:fmbe] animation.creeper.swelling none 0 "v.xbasepos=v.xbasepos??0;v.ybasepos=v.ybasepos??0;v.zbasepos=v.zbasepos??0;v.xpos=v.xpos??0;v.ypos=v.ypos??0;v.zpos=v.zpos??0;v.scale=v.scale??1;" wiki.scale';
  const lines = wrapCommand(cmd, 80);
  assert.ok(lines.length > 2);
  assert.ok(lines.slice(0, -1).every((l) => l.endsWith(' \\') && l.length <= 82));
  assert.ok(lines.at(-1)!.endsWith('" wiki.scale'));
  const p = parse(lines.join('\n'));
  assert.deepEqual(p.diagnostics, []);
  assert.equal(p.chains[0].nodes[0].command.replace(/; /g, ';').replace('0 " v', '0 "v'), cmd.slice(1));
  assert.deepEqual(wrapCommand('/playanimation @e a none 0 "v.a=1;" c', 80), ['/playanimation @e a none 0 "v.a=1;" c']);
  assert.deepEqual(wrapCommand(`/playanimation @e a none 0 "${'v.a=1'.repeat(40)}" c`, 80).length, 1);
});
