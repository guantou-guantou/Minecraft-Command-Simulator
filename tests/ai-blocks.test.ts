import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkChange, diffLines, splitReply } from '../src/ai/blocks.ts';
import { buildRequest, parseChat, serializeChat, userContent, type ChatMessage } from '../src/ai/messages.ts';

test('a reply is split into prose and code blocks, including a block that is still streaming', () => {
  const s = splitReply('Here you go:\n\n```text\n/say hi\n/say there\n```\nDone.\n````\nnested ``` fence\n````');
  assert.deepEqual(s.map((x) => [x.kind, x.text, x.lang ?? '']), [
    ['text', 'Here you go:', ''],
    ['code', '/say hi\n/say there', 'text'],
    ['text', 'Done.', ''],
    ['code', 'nested ``` fence', ''],
  ]);
  const open = splitReply('Start\n```\n/say a');
  assert.deepEqual(open.map((x) => [x.kind, x.text, !!x.open]), [['text', 'Start', false], ['code', '/say a', true]]);
  assert.deepEqual(splitReply('just words'), [{ kind: 'text', text: 'just words' }]);
});

test('diffLines marks removed and added lines', () => {
  assert.deepEqual(diffLines('a\nb\nc', 'a\nx\nc').map((d) => d.kind + d.text), [' a', '-b', '+x', ' c']);
  assert.deepEqual(diffLines('', 'a').map((d) => d.kind + d.text), ['+a']);
  assert.deepEqual(diffLines('a', '').map((d) => d.kind + d.text), ['-a']);
});

test('checkChange reports the problems a replacement adds', () => {
  const src = 'chain a at (0, 0, 0):\n    /say one\n    /say two\n';
  const from = src.indexOf('/say two');
  const good = checkChange(src, from, from + 8, '/say three');
  assert.deepEqual([good.before, good.after, good.added.length], [0, 0, 0]);
  assert.equal(good.result, 'chain a at (0, 0, 0):\n    /say one\n    /say three\n');
  const bad = checkChange(src, from, from + 8, '/nosuchcommand x');
  assert.equal(bad.added.length, 1);
  assert.match(bad.added[0].message, /nosuchcommand/);
  const already = checkChange('/nosuchcommand x\n', 0, 0, '/say hi\n');
  assert.equal(already.added.length, 0);
});

test('a request holds the system prompt, the history with its quotes and the new question', () => {
  const history: ChatMessage[] = [
    { role: 'user', content: 'what does this do?', quotes: [{ text: '/say hi', fromLine: 2, toLine: 2 }] },
    { role: 'assistant', content: 'It says hi.' },
  ];
  const next: ChatMessage = { role: 'user', content: 'make it say bye' };
  const m = buildRequest(history, next, { language: 'en', script: '/say hi\n', diagnostics: [{ line: 1, message: 'bad' }] });
  assert.deepEqual(m.map((x) => x.role), ['system', 'user', 'assistant', 'user']);
  assert.match(m[0].content, /## Current script/);
  assert.match(m[0].content, /- line 1: bad/);
  assert.match(m[1].content, /## Quoted lines 2-2\n```\n\/say hi\n```\n\nwhat does this do\?/);
  assert.equal(m[3].content, 'make it say bye');
  assert.ok(!buildRequest([], next, { language: 'en' })[0].content.includes('## Current script'));
  assert.equal(userContent(next), 'make it say bye');
});

test('a conversation survives saving and a damaged file is refused', () => {
  const messages: ChatMessage[] = [{ role: 'user', content: 'hi', quotes: [{ text: 'x', fromLine: 1, toLine: 2 }] }, { role: 'assistant', content: 'hello' }];
  assert.deepEqual(parseChat(serializeChat(messages)), messages);
  assert.throws(() => parseChat('nope'), /not a conversation/);
  assert.throws(() => parseChat('{"version":9,"messages":[]}'), /version/);
  assert.throws(() => parseChat('{"version":1,"messages":[{"role":"system","content":"x"}]}'), /Message 1/);
});