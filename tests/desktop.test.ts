import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import lib from '../electron/lib.cjs';

const { pickFileArg, addRecent, windowTitle } = lib;

test('pickFileArg: finds a .mcsim or .txt argument, ignores flags, the app path and other files', () => {
  const cwd = path.resolve('/work');
  assert.equal(pickFileArg(['app.exe'], cwd), null);
  assert.equal(pickFileArg(['app.exe', '.'], cwd), null);
  assert.equal(pickFileArg(['app.exe', '--flag', 'notes.txt'], cwd), path.resolve(cwd, 'notes.txt'));
  assert.equal(pickFileArg(['app.exe', 'image.png'], cwd), null);
  assert.equal(pickFileArg(['app.exe', 'demo.mcsim'], cwd), path.resolve(cwd, 'demo.mcsim'));
  assert.equal(pickFileArg(['app.exe', '--x=1', 'DEMO.MCSIM'], cwd), path.resolve(cwd, 'DEMO.MCSIM'));
  assert.equal(pickFileArg(['electron', '.', path.resolve('/a/b.mcsim')], cwd), path.resolve('/a/b.mcsim'));
});

test('addRecent: newest first, no duplicates (case-insensitive), capped', () => {
  assert.deepEqual(addRecent([], 'a'), ['a']);
  assert.deepEqual(addRecent(['a', 'b'], 'b'), ['b', 'a']);
  assert.deepEqual(addRecent(['C:\\X\\a.mcsim', 'b'], 'c:\\x\\A.MCSIM'), ['c:\\x\\A.MCSIM', 'b']);
  const many = Array.from({ length: 10 }, (_, i) => `f${i}`);
  assert.equal(addRecent(many, 'new').length, 10);
  assert.equal(addRecent(many, 'new')[0], 'new');
  assert.ok(!addRecent(many, 'new').includes('f9'));
});

test('windowTitle marks unsaved documents', () => {
  assert.equal(windowTitle('a.mcsim', false), 'a.mcsim - MC Command Simulator');
  assert.equal(windowTitle('a.mcsim', true), '* a.mcsim - MC Command Simulator');
});
