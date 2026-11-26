import { test } from 'node:test';
import assert from 'node:assert/strict';
import { continuationIndex } from '../src/ui/editing.ts';

test('continuationIndex finds only a trailing backslash', () => {
  assert.equal(continuationIndex('/execute as @a \\'), 15);
  assert.equal(continuationIndex('/execute as @a \\   '), 15);
  assert.equal(continuationIndex('/say a'), -1);
  assert.equal(continuationIndex('/say a \\b'), -1);
  assert.equal(continuationIndex(''), -1);
});
import { toggleComment, type CommentEdit } from '../src/ui/editing.ts';

const apply = (v: string, e: CommentEdit | null) => (e ? v.slice(0, e.from) + e.text + v.slice(e.to) : v);

test('toggleComment comments at the shallowest indent, skips blank lines, and round-trips', () => {
  const v = 'chain a:\n    /say 1\n\n      /say 2\nend';
  const s = v.indexOf('/say 1');
  const e = v.indexOf('/say 2') + 2;
  const commented = apply(v, toggleComment(v, s, e));
  assert.equal(commented, 'chain a:\n    # /say 1\n\n    #   /say 2\nend');
  const t = toggleComment(commented, commented.indexOf('/say 1'), commented.indexOf('/say 2'))!;
  assert.equal(apply(commented, t), v);
});

test('toggleComment: mixed selection comments everything, uncomment accepts # without a space', () => {
  assert.equal(apply('a\n# b', toggleComment('a\n# b', 0, 5)), '# a\n# # b');
  assert.equal(apply('#a\n  #  b', toggleComment('#a\n  #  b', 0, 9)), 'a\n   b');
  assert.equal(toggleComment('\n  \n', 0, 3), null);
});

test('toggleComment ignores a trailing line start of the selection and keeps the caret', () => {
  const v = 'one\ntwo\nthree';
  assert.equal(apply(v, toggleComment(v, 0, 8)), '# one\n# two\nthree');
  const c = toggleComment(v, 5, 5)!;
  assert.equal(apply(v, c), 'one\n# two\nthree');
  assert.equal(c.selStart, 7);
  const back = apply(v, c);
  const u = toggleComment(back, 7, 7)!;
  assert.equal(apply(back, u), v);
  assert.equal(u.selStart, 5);
});

test('toggleComment covers whole backslash-continued commands', () => {
  const v = '/execute as @a \\\n    run say hi\n/say next';
  const out = apply(v, toggleComment(v, v.indexOf('run'), v.indexOf('run') + 1));
  assert.equal(out, '# /execute as @a \\\n#     run say hi\n/say next');
  const back = apply(out, toggleComment(out, out.indexOf('run'), out.indexOf('run')))
  assert.equal(back, v);
});
