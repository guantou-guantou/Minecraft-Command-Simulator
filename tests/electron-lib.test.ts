import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const lib = createRequire(import.meta.url)('../electron/lib.cjs') as {
  pickFileArg(argv: string[], cwd: string): string | null;
  atomicWrite(fs: unknown, file: string, content: string): void;
  decodeText(raw: string): { content: string; eol: 'lf' | 'crlf' };
  encodeText(content: string, eol: 'lf' | 'crlf'): string;
  windowOptions(saved: unknown, areas: { x: number; y: number; width: number; height: number }[]): { width: number; height: number; x?: number; y?: number; maximized: boolean };
};

test('pickFileArg accepts .mcsim and .txt scripts', () => {
  assert.equal(lib.pickFileArg(['app', '--flag', 'a.TXT'], 'C:\\w'), path.resolve('C:\\w', 'a.TXT'));
  assert.equal(lib.pickFileArg(['app', 'b.mcsim'], 'C:\\w'), path.resolve('C:\\w', 'b.mcsim'));
  assert.equal(lib.pickFileArg(['app', 'c.png', '-x.txt'], 'C:\\w'), null);
});

test('atomicWrite replaces the file and leaves no temporary file behind', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcsim-'));
  const file = path.join(dir, 'a.mcsim');
  fs.writeFileSync(file, 'old');
  lib.atomicWrite(fs, file, 'new');
  assert.equal(fs.readFileSync(file, 'utf8'), 'new');
  assert.deepEqual(fs.readdirSync(dir), ['a.mcsim']);
  assert.throws(() => lib.atomicWrite(fs, path.join(dir, 'missing', 'x.mcsim'), 'x'));
  assert.deepEqual(fs.readdirSync(dir), ['a.mcsim']);
  fs.rmSync(dir, { recursive: true });
});

test('decodeText strips a BOM and normalises line endings; encodeText restores them', () => {
  assert.deepEqual(lib.decodeText('\ufeffa\r\nb\r\n'), { content: 'a\nb\n', eol: 'crlf' });
  assert.deepEqual(lib.decodeText('a\nb'), { content: 'a\nb', eol: 'lf' });
  assert.equal(lib.decodeText('a\rb').content, 'a\nb');
  assert.equal(lib.encodeText('a\nb\n', 'crlf'), 'a\r\nb\r\n');
  assert.equal(lib.encodeText('a\nb', 'lf'), 'a\nb');
  assert.equal(lib.encodeText('a\r\nb', 'crlf'), 'a\r\nb');
});

test('windowOptions keeps a visible window and drops positions outside every display', () => {
  const screens = [{ x: 0, y: 0, width: 1920, height: 1040 }];
  assert.deepEqual(lib.windowOptions(null, screens), { width: 1400, height: 900, maximized: false });
  assert.deepEqual(lib.windowOptions({ x: 100, y: 50, width: 1000, height: 700, maximized: true }, screens), { x: 100, y: 50, width: 1000, height: 700, maximized: true });
  assert.equal(lib.windowOptions({ x: 5000, y: 50, width: 1000, height: 700 }, screens).x, undefined);
  assert.equal(lib.windowOptions({ x: -990, y: 50, width: 1000, height: 700 }, screens).x, undefined);
  assert.equal(lib.windowOptions({ x: -400, y: 50, width: 1000, height: 700 }, screens).x, -400);
  const small = lib.windowOptions({ width: 100, height: 100 }, screens);
  assert.deepEqual([small.width, small.height], [900, 600]);
  const huge = lib.windowOptions({ width: 9000, height: 9000 }, screens);
  assert.deepEqual([huge.width, huge.height], [1920, 1040]);
  assert.equal(lib.windowOptions({ x: 'a', y: 1, width: 1000, height: 700 }, screens).x, undefined);
  assert.equal(lib.windowOptions({ x: 1500, y: 0, width: 1000, height: 700 }, [...screens, { x: 1920, y: 0, width: 1280, height: 1024 }]).x, 1500);
});