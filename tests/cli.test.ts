import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const SCRIPT = `A = ent(type=player, pos=(0.5, 4.0, 0.5), name=A)
chain gate(pos=(0, 4, 0)):
    cb(mode=imp, power=always_on)
    /scoreboard objectives add n dummy
    /scoreboard players add A n 5
chain other(pos=(0, 6, 0)):
    /say other
test t:
    run gate
    expect score A n == 5
`;

const mcsim = (args: string[], input?: string) => {
  const r = spawnSync(process.execPath, ['src/cli.ts', ...args], { encoding: 'utf8', input });
  return { code: r.status, out: r.stdout, err: r.stderr };
};

test('check reports every editor diagnostic, with a column, as text or JSON', () => {
  const bad = SCRIPT + '/damagex @a 1\n';
  const r = mcsim(['check', '-', '--json'], bad);
  assert.equal(r.code, 1);
  const j = JSON.parse(r.out);
  assert.equal(j.ok, false);
  assert.match(j.diagnostics[0].message, /Unknown command \/damagex/);
  assert.equal(typeof j.diagnostics[0].column, 'number');
  const text = mcsim(['check', '-'], bad);
  assert.equal(text.code, 1);
  assert.match(text.err, /<stdin>:\d+:\d+: Unknown command/);
  const ok = mcsim(['check', '-', '--json'], SCRIPT);
  assert.equal(ok.code, 0);
  assert.deepEqual(JSON.parse(ok.out), { ok: true, diagnostics: [] });
});

test('run --json gives events and, with --state, the final world', () => {
  const r = mcsim(['run', '-', 'gate', '--ticks', '1', '--state', '--json'], SCRIPT);
  assert.equal(r.code, 0);
  const j = JSON.parse(r.out);
  assert.equal(j.ok, true);
  assert.equal(j.errors, 0);
  assert.equal(j.world.scores.n.A, 5);
  assert.equal(j.world.entities[0].name, 'A');
  assert.ok(j.world.blocks.some((b: { id: string }) => b.id === 'minecraft:command_block'));
});

test('run takes several chains, --all and console commands; errors give exit code 1', () => {
  const two = mcsim(['run', '-', 'gate', '--chain', 'other', '--json'], SCRIPT);
  assert.equal(JSON.parse(two.out).events.filter((e: { type: string; kind?: string }) => e.type === 'chat' && e.kind === 'say').length, 1);
  const all = mcsim(['run', '-', '--all', '--command', '/scoreboard players add A n 1', '--state', '--json'], SCRIPT);
  assert.equal(JSON.parse(all.out).world.scores.n.A, 6);
  const bad = mcsim(['run', '-', 'gate', '--command', '/scoreboard players add A nope 1'], SCRIPT);
  assert.equal(bad.code, 1);
  assert.match(bad.err, /1 command error/);
});

test('test, export and usage errors', () => {
  const t = mcsim(['test', '-', '--json'], SCRIPT);
  assert.equal(t.code, 0);
  const j = JSON.parse(t.out);
  assert.deepEqual([j.ok, j.total, j.passed, j.failed], [true, 1, 1, 0]);
  assert.equal(mcsim(['test', '-', '--only', 'nope'], SCRIPT).code, 2);
  const ex = mcsim(['export', '-', '--all'], SCRIPT);
  assert.match(ex.out, /# chain gate\nscoreboard objectives add n dummy/);
  assert.equal(mcsim(['export', '-', 'gate', '--format', 'manifest'], SCRIPT).out.startsWith('# chain gate at (0, 4, 0)'), true);
  assert.equal(mcsim(['run', '-', 'nochain'], SCRIPT).code, 2);
  assert.equal(mcsim(['check', 'no-such-file.mcsim']).code, 2);
  assert.equal(mcsim(['run']).code, 2);
  assert.equal(mcsim(['--help']).code, 0);
});

test('the legacy form still works', () => {
  const r = mcsim(['--help']);
  assert.match(r.out, /Legacy form/);
});