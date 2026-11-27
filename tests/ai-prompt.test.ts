import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { aiPromptDoc } from '../src/ai/doc.ts';
import { buildSystemPrompt, commandLists, contextSection } from '../src/ai/prompt.ts';

test('docs/AI提示词.md is what npm run ai:doc generates', () => {
  const file = readFileSync(new URL('../docs/AI提示词.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(file, aiPromptDoc(), 'run npm run ai:doc');
});

test('the command lists follow the registry and do not overlap', () => {
  const c = commandLists();
  assert.ok(c.full.includes('execute') && c.full.includes('setblock') && c.record.includes('camera'));
  const all = [...c.full, ...c.record, ...c.syntaxOnly, ...c.unimplemented];
  assert.equal(new Set(all).size, all.length);
  for (const n of c.unimplemented) assert.ok(!c.full.includes(n));
});

test('the prompt carries the rules, the context the user chose and the reply language', () => {
  const p = buildSystemPrompt('zh', { script: '/say ```', quotes: [{ text: '/say hi', fromLine: 3, toLine: 4 }], diagnostics: [{ line: 3, message: 'bad' }] });
  assert.match(p, /Never use Java Edition syntax/);
  assert.match(p, /## Quoted lines 3-4\n```\n\/say hi\n```/);
  assert.match(p, /- line 3: bad/);
  assert.match(p, /````\n\/say ```\n````/);
  assert.match(p, /Reply in Chinese/);
  assert.equal(contextSection({}), '');
  assert.ok(!buildSystemPrompt('en').includes('# Context'));
});