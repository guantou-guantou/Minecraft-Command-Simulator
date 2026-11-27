import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { parse } from '../src/language/parser.ts';
import { exportFunctionFiles, functionWarning } from '../src/export.ts';

const SRC = 'function pack/start:\n    /say start\n    /function pack/inner\nfunction pack/inner:\n    /say inner\nchain a at (0, 0, 0):\n    /function pack/start\n';

test('every function becomes a .mcfunction file without leading slashes', () => {
  const files = exportFunctionFiles(parse(SRC));
  assert.deepEqual(files.map((f) => f.path), ['pack/start.mcfunction', 'pack/inner.mcfunction']);
  assert.equal(files[0].content, 'say start\nfunction pack/inner\n');
  assert.equal(files[1].content, 'say inner\n');
});

test('the warning lists the defined functions and the ones the commands call', () => {
  const p = parse(SRC);
  assert.deepEqual(functionWarning(p, ['function pack/start', 'say hi']), { defined: ['pack/start', 'pack/inner'], called: ['pack/start'] });
  assert.deepEqual(functionWarning(p, ['execute as @a run function pack/inner']).called, ['pack/inner']);
  assert.deepEqual(functionWarning(p, ['say function pack/innerx']).called, []);
  assert.deepEqual(functionWarning(parse('chain a at (0,0,0):\n    /say hi\n'), []), { defined: [], called: [] });
});

test('mcsim export --format functions writes the files, the other formats warn on stderr', () => {
  const dir = mkdtempSync(path.join(process.cwd(), '.tmp-fn-'));
  try {
    const run = (...args: string[]) => spawnSync(process.execPath, ['src/cli.ts', 'export', '-', ...args], { input: SRC, encoding: 'utf8' });
    const r = run('--format', 'functions', '--out', dir);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readFileSync(path.join(dir, 'pack', 'inner.mcfunction'), 'utf8'), 'say inner\n');
    const c = run();
    assert.equal(c.status, 0);
    assert.equal(c.stdout, 'function pack/start\n');
    assert.match(c.stderr, /defines 2 function\(s\)/);
    assert.equal(run('--format', 'functions').status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});