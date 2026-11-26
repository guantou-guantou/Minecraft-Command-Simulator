import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/language/parser.ts';
import { runTests } from '../src/engine/testrun.ts';
import { extractTests } from '../src/language/testdsl.ts';

const SCRIPT = `alice = ent(type=player, position=(0, 0, 0), name=alice)
block(type=stone, position=(3, 0, 0))

chain count:
    /scoreboard objectives add n dummy
    /scoreboard players add alice n 1
    /tag @a add ready
    /say counted

test counts:
    run count
    expect score alice n == 1
    expect tag @a has ready
    expect chat contains "counted"
    expect entity @a count 1
    expect block 3 0 0 stone

test fails:
    run count
    expect score alice n == 2   # wrong on purpose
    expect entity @e[type=fox] 1
    expect block 3 0 0 dirt
    expect tag @a lacks ready
    expect chat contains "nothing"
`;

test('test blocks are cut out of the script and keep every line number', () => {
  const ex = extractTests(SCRIPT);
  assert.equal(ex.source.split('\n').length, SCRIPT.split('\n').length);
  assert.ok(!ex.source.includes('expect'));
  assert.deepEqual(ex.tests.map((t) => [t.name, t.steps.length]), [['counts', 6], ['fails', 6]]);
  const p = parse(SCRIPT);
  assert.deepEqual(p.diagnostics, []);
  assert.equal(p.chains.map((c) => c.name).join(), 'count');
  assert.equal(p.tests[0].line, 10);
  assert.equal(p.tests[0].steps[1].line, 12);
});

test('runTests reports passes and precise failures per line', () => {
  const [a, b] = runTests(parse(SCRIPT));
  assert.deepEqual([a.name, a.passed, a.checks, a.failures], ['counts', true, 5, []]);
  assert.equal(b.passed, false);
  assert.deepEqual(b.failures.map((f) => f.line), [20, 21, 22, 23, 24]);
  assert.match(b.failures[0].message, /score alice n == 2 but it was 1/);
  assert.match(b.failures[1].message, /count == 1 but it was 0/);
  assert.match(b.failures[2].message, /to be dirt but it was stone/);
  assert.match(b.failures[3].message, /have the tag ready/);
  assert.match(b.failures[4].message, /no chat message contains "nothing"/);
});

test('each test starts from a fresh world', () => {
  const p = parse(`block(type=stone, position=(0,0,0))\ntest a:\n    /setblock 0 0 0 dirt\n    expect block 0 0 0 dirt\ntest b:\n    expect block 0 0 0 stone\n`);
  assert.deepEqual(runTests(p).map((r) => r.passed), [true, true]);
});

test('ticks, activate, particles and comparison operators', () => {
  const p = parse(`chain boot:\n    cb(mode=rep, power=always_on)\n    /particle minecraft:villager_happy 0 0 0\n\ntest ticking:\n    activate boot\n    tick 5\n    expect particles >= 5\n    expect particles != 0\n    expect particles < 100\n    tick 0\n    deactivate boot\n`);
  assert.deepEqual(p.diagnostics, []);
  assert.deepEqual(runTests(p).map((r) => r.passed), [true]);
});

test('syntax problems inside a test are diagnostics with the right line', () => {
  const p = parse(`test t:\n    run\n    tick x\n    expect score a b 3\n    expect block 1 2 stone\n    expect nothing\n    bogus\n    /\n    expect entity @a count ==\n`);
  assert.deepEqual(p.diagnostics.map((d) => d.line), [2, 3, 4, 5, 6, 7, 8, 9]);
  assert.ok(p.diagnostics.every((d) => d.message.startsWith('test t:')));
  assert.equal(parse('test a:\n    tick 1\ntest a:\n    tick 1\n').diagnostics[0].message, 'Duplicate test "a"');
});

test('unknown chains fail the test; a missing objective is reported, not thrown', () => {
  const p = parse(`test t:\n    run ghost\n    expect score x nope == 1\n`);
  const [r] = runTests(p);
  assert.deepEqual(r.failures.map((f) => f.message), ['unknown chain "ghost"', 'objective "nope" does not exist']);
});

test('lines after a test block that are not indented are normal script again', () => {
  const p = parse(`test t:\n    tick 1\nent(type=fox, position=(0,0,0), name=f)\n# comment\n`);
  assert.equal(p.entities.length, 1);
  assert.equal(p.tests[0].steps.length, 1);
});
test('runTests can run a chosen subset, in script order', () => {
  const p = parse('test a:\n    tick 1\ntest b:\n    expect entity @e 1\ntest c:\n    tick 1\n');
  assert.deepEqual(runTests(p).map((r) => [r.name, r.passed]), [['a', true], ['b', false], ['c', true]]);
  assert.deepEqual(runTests(p, undefined, new Set(['c', 'a'])).map((r) => r.name), ['a', 'c']);
  assert.deepEqual(runTests(p, undefined, new Set()).length, 0);
  assert.deepEqual(runTests(p, undefined, new Set(['nope'])).length, 0);
});
