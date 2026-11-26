import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_LAYOUT, MIN, clamp, maxC1, maxC2, sanitize } from '../src/ui/layout.ts';

test('clamp keeps values in range and survives max < min', () => {
  assert.equal(clamp(5, 10, 100), 10);
  assert.equal(clamp(500, 10, 100), 100);
  assert.equal(clamp(50, 10, 100), 50);
  assert.equal(clamp(50, 10, 3), 10);
});

test('sanitize fills defaults and rejects junk', () => {
  assert.deepEqual(sanitize(null), DEFAULT_LAYOUT);
  assert.deepEqual(sanitize('x'), DEFAULT_LAYOUT);
  assert.deepEqual(sanitize({ c1: 300, c2: 'no', term: NaN }), { ...DEFAULT_LAYOUT, c1: 300 });
  assert.equal(sanitize({ c1: 5 }).c1, MIN.c1);
});

test('column limits leave room for the third column and both splitters', () => {
  assert.equal(maxC1(1400, 360), 1400 - 360 - 12 - 160);
  assert.equal(maxC2(1400, 520), 1400 - 520 - 12 - 160);
});