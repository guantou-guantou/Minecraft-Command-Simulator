import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseInline, parseMarkdown } from '../src/ai/markdown.ts';

test('inline markdown: code, bold, italic, strike, links; underscores stay', () => {
  assert.deepEqual(parseInline('a **b `c`** d'), [
    { t: 'text', text: 'a ' },
    { t: 'bold', children: [{ t: 'text', text: 'b ' }, { t: 'code', text: 'c' }] },
    { t: 'text', text: ' d' },
  ]);
  assert.deepEqual(parseInline('*x* ~~y~~'), [{ t: 'italic', children: [{ t: 'text', text: 'x' }] }, { t: 'text', text: ' ' }, { t: 'strike', children: [{ t: 'text', text: 'y' }] }]);
  assert.deepEqual(parseInline('[doc](https://a.b/c)'), [{ t: 'link', href: 'https://a.b/c', children: [{ t: 'text', text: 'doc' }] }]);
  assert.deepEqual(parseInline('minecraft:command_block and chain_command_block'), [{ t: 'text', text: 'minecraft:command_block and chain_command_block' }]);
  assert.deepEqual(parseInline('2 * 3 * 4'), [{ t: 'text', text: '2 * 3 * 4' }]);
  assert.deepEqual(parseInline('<b>x</b>'), [{ t: 'text', text: '<b>x</b>' }]);
});

test('block markdown: headings, lists, quotes, rules, tables and paragraphs', () => {
  const b = parseMarkdown('## Title\n\nSome *text*\nmore\n\n- a\n- b\n  - c\n\n1. one\n2. two\n\n> quoted\n> lines\n\n---\n\n| x | y |\n|---|:-:|\n| 1 | `2` |');
  assert.deepEqual(b.map((x) => x.t), ['h', 'p', 'list', 'list', 'quote', 'hr', 'table']);
  assert.equal((b[0] as { level: number }).level, 2);
  const ul = b[2] as { ordered: boolean; items: { depth: number }[] };
  assert.deepEqual([ul.ordered, ul.items.map((i) => i.depth)], [false, [0, 0, 1]]);
  assert.equal((b[3] as { ordered: boolean }).ordered, true);
  const table = b[6] as { head: unknown[]; rows: unknown[][] };
  assert.deepEqual([table.head.length, table.rows.length, table.rows[0].length], [2, 1, 2]);
  assert.deepEqual(parseMarkdown('line one\nline two')[0], { t: 'p', inline: [{ t: 'text', text: 'line one\nline two' }] });
  assert.deepEqual(parseMarkdown(''), []);
});