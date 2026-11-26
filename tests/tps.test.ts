import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TPS, sanitizeTps, ticksDue } from '../src/ui/tps.ts';

test('sanitizeTps keeps whole numbers from 1 to 1000 and falls back to 20', () => {
  assert.equal(DEFAULT_TPS, 20);
  assert.deepEqual(['5', 5, 7.6, ' 40 ', '1000', 5000, 0, -3, '0.2'].map(sanitizeTps), [5, 5, 8, 40, 1000, 1000, 1, 1, 1]);
  assert.deepEqual(['', 'abc', NaN, undefined, null].map(sanitizeTps), [20, 20, 20, 20, 20]);
});

test('ticksDue turns elapsed time into whole ticks and carries the fraction', () => {
  assert.deepEqual(ticksDue(0, 20, 50), { ticks: 1, carry: 0 });
  let carry = 0;
  let total = 0;
  for (let i = 0; i < 40; i++) {
    const d = ticksDue(carry, 5, 25);
    carry = d.carry;
    total += d.ticks;
  }
  assert.equal(total, 5);
  const fast = ticksDue(0, 1000, 25);
  assert.equal(fast.ticks, 25);
  assert.deepEqual(ticksDue(0, 1000, 10_000), { ticks: 500, carry: 0 });
  assert.equal(ticksDue(0.5, 1, 500).ticks, 1);
});