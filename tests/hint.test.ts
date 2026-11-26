import { test } from 'node:test';
import assert from 'node:assert/strict';
import { align, commandHint, declHint, explainAt, hintAt, sigText, signatures } from '../src/language/hint.ts';

test('signatures list the forms of a command with optional parts marked', () => {
  assert.deepEqual(signatures('gamemode').map(sigText), ['/gamemode <mode> [<player>]']);
  assert.ok(signatures('inputpermission').map(sigText).includes('/inputpermission set <target> <permission> <state>'));
  assert.ok(signatures('tp').map(sigText).some((s) => s.includes('<destination>')));
  assert.deepEqual(signatures('nope'), []);
  assert.ok(signatures('execute').length > 5);
  assert.ok(signatures('setblock').map(sigText)[0].startsWith('/setblock <position>'));
});

test('align finds the part the next token belongs to', () => {
  const [sig] = signatures('setblock');
  assert.equal(align(sig, ['setblock']), 1);
  assert.equal(align(sig, ['setblock', '1', '2']), 1);
  assert.equal(align(sig, ['setblock', '1', '2', '3']), 2);
  assert.equal(align(sig, ['setblock', '~~~']), 2);
  assert.equal(align(sig, ['setblock', '${p}']), 2);
  assert.equal(align(sig, ['setblock', '1', '2', '3', 'stone']), 3);
});

test('commandHint keeps only the signatures that fit and reports the active part', () => {
  const h = commandHint(['inputpermission', 'query'])!;
  assert.equal(h.sigs.length, 1);
  assert.equal(h.sigs[0].sig[h.sigs[0].active].text, '<target>');
  assert.equal(commandHint(['inputpermission', 'bogus']), null);
  assert.equal(commandHint(['bogus']), null);
  assert.equal(commandHint([]), null);
  const kick = commandHint(['kick', '@a', 'a', 'b'])!;
  assert.equal(kick.sigs[0].sig[kick.sigs[0].active].text, '<reason...>');
});

test('hintAt: command words before the caret, declaration keys', () => {
  const t = '/gamemode ';
  assert.equal(hintAt(t, t.length)!.kind, 'command');
  const text = 'ent(type=fox, ';
  const d = hintAt(text, text.length)!;
  assert.equal(d.kind === 'decl' && d.hint.current, null);
  const t2 = 'ent(type=fox, rotation=';
  const d2 = hintAt(t2, t2.length)!;
  assert.equal(d2.kind === 'decl' && d2.hint.current, 'rot');
  assert.equal(hintAt('hello', 5), null);
  assert.equal(declHint('ent(type=fox)'), null);
  assert.ok(declHint('chain gate(')!.keys.includes('facing'));
});

test('explainAt: command usage, argument meaning, keys, variables', () => {
  const line = '/gamemode creative @a';
  assert.deepEqual(explainAt(line, 3, line)!.lines.slice(0, 2), ['/gamemode', '/gamemode <mode> [<player>]']);
  assert.match(explainAt(line, 12, line)!.lines.join('\n'), /<mode>/);
  assert.match(explainAt('/locate structure x', 2, '')!.lines.join('\n'), /Not implemented yet/);
  assert.match(explainAt('/allowlist list', 2, '')!.lines.join('\n'), /not implemented/);
  assert.match(explainAt('/zzz', 2, '')!.lines.join('\n'), /Unknown/);
  assert.equal(explainAt('/say hi', 99, ''), null);
  const decl = 'a = ent(type=fox, pos=pos1)';
  assert.equal(explainAt(decl, 11, decl)!.lines[0], 'type=');
  const whole = 'pos1 = (1, 2, 3)\n' + decl;
  assert.deepEqual(explainAt(decl, 24, whole)!.lines, ['pos1 = (1, 2, 3)']);
});