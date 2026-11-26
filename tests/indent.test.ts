import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/language/parser.ts';
import { Simulation } from '../src/engine/simulation.ts';

const shape = (src: string) => Object.fromEntries(parse(src).chains.map((c) => [c.name, c.nodes.map((n) => `${n.cb.mode}${n.cb.conditional ? '+c' : ''}:${n.command.split(' ')[0]}`)]));

test('indentation decides which chain a command belongs to; unindented commands share one main chain', () => {
  const src = `ent(type=player, position=(0,0,0), name=test)
/tp @a[name=test] 1 2 3
chain chain1:
    /say in-chain
    cb(conditional=true)
    /execute as @a run say cond
/setblock 0 0 0 stone
/say tail
`;
  assert.deepEqual(parse(src).diagnostics, []);
  assert.deepEqual(shape(src), { main: ['imp:tp', 'cha:setblock', 'cha:say'], chain1: ['imp:say', 'cha+c:execute'] });
  assert.deepEqual(parse(src).chains.map((c) => c.name), ['main', 'chain1']);
});

test('main is shared across segments and can come after chains', () => {
  const src = `chain a:\n    /say a1\n/say m1\nchain b:\n    /say b1\n/say m2\n    /say a-or-b\n`;
  assert.deepEqual(shape(src), { a: ['imp:say'], main: ['imp:say', 'cha:say'], b: ['imp:say', 'cha:say'] });
});

test('indented commands with no chain header still go to main', () => {
  assert.deepEqual(shape('    /say a\n    /say b\n'), { main: ['imp:say', 'cha:say'] });
});

test('cb outside a chain applies to the next unindented command and can make main repeat', () => {
  const p = parse('cb(mode=rep, power=always_on, delay=20)\n/say tick\n/scoreboard objectives add n dummy\n');
  assert.deepEqual(p.diagnostics, []);
  assert.deepEqual(p.chains[0].nodes.map((n) => [n.cb.mode, n.cb.delay]), [['rep', 20], ['cha', 0]]);
  assert.match(parse('/say a\ncb(mode=rep)\n/say b').diagnostics[0].message, /Only the first block/);
});

test('a cb written in one chain does not leak into the command of another', () => {
  const p = parse('chain a:\n    cb(mode=rep)\n/say m\n');
  assert.ok(p.diagnostics.some((d) => /cb\(\.\.\.\) is not followed by a command/.test(d.message)));
  assert.deepEqual(p.chains.find((c) => c.name === 'main')!.nodes.map((n) => n.cb.mode), ['imp']);
});

test('an unindented command right after a chain header gets a hint, once', () => {
  const p = parse('chain a:\n/say x\n/say y\n');
  assert.equal(p.diagnostics.length, 1);
  assert.equal(p.diagnostics[0].line, 2);
  assert.match(p.diagnostics[0].message, /not indented, so it is not part of chain "a"/);
  assert.deepEqual(shape('chain a:\n/say x\n'), { a: [], main: ['imp:say'] });
});

test('an explicit chain called main collects the unindented commands', () => {
  const p = parse('chain main(pos=(1, 2, 3)):\n    /say a\n/say b\n');
  assert.deepEqual(p.diagnostics, []);
  assert.equal(p.chains.length, 1);
  assert.deepEqual(p.chains[0].nodes.map((n) => n.pos), [[1, 2, 3], [2, 2, 3]]);
});

test('running the chains the user wrote: main and chain1 do what the indentation says', () => {
  const src = `ent(type=player, position=(10,0,10), name=test)\n/say from-main\nchain chain1:\n    /say from-chain1\n/say main-again\n`;
  const s = new Simulation(parse(src));
  s.runChain('chain1');
  assert.deepEqual(s.events.flatMap((e) => (e.type === 'chat' ? [e.text] : [])), ['from-chain1']);
  s.runChain('main');
  assert.deepEqual(s.events.flatMap((e) => (e.type === 'chat' ? [e.text] : [])), ['from-chain1', 'from-main', 'main-again']);
});
test('exporting several chains labels each one; a single chain keeps the plain format', async () => {
  const { exportAllCommands, exportAllManifest, exportCommands } = await import('../src/export.ts');
  const p = parse('/say m\nchain a:\n    /say a1\n    /say a2\n');
  const [main, a] = p.chains;
  assert.equal(exportAllCommands([a]), exportCommands(a));
  assert.equal(exportAllCommands([main, a]), '# chain main\nsay m\n\n# chain a\nsay a1\nsay a2\n');
  assert.equal((exportAllManifest([main, a]).match(/^# chain /gm) ?? []).length, 2);
});
