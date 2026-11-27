import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyHistory, newer, older, remember } from '../src/ui/termHistory.ts';

test('the up and down keys walk through the sent lines and give back the draft', () => {
  let h = emptyHistory();
  for (const l of ['/say a', '/say b', '/say c']) h = remember(h, l);
  let r = older(h, 'half typed');
  assert.equal(r.text, '/say c');
  r = older(r.history, r.text);
  assert.equal(r.text, '/say b');
  r = older(r.history, r.text);
  r = older(r.history, r.text);
  assert.equal(r.text, '/say a');
  r = newer(r.history, r.text);
  assert.equal(r.text, '/say b');
  r = newer(r.history, r.text);
  r = newer(r.history, r.text);
  assert.equal(r.text, 'half typed');
  r = newer(r.history, r.text);
  assert.equal(r.text, 'half typed');
});

test('sending remembers a line once in a row, keeps 100 and ends browsing', () => {
  let h = remember(remember(emptyHistory(), '/a'), '/a');
  assert.deepEqual(h.items, ['/a']);
  const r = older(h, '');
  h = remember(r.history, '/b');
  assert.equal(h.index, null);
  for (let i = 0; i < 150; i++) h = remember(h, `/n${i}`);
  assert.equal(h.items.length, 100);
  assert.equal(h.items.at(-1), '/n149');
  assert.equal(older(emptyHistory(), 'x').text, 'x');
});