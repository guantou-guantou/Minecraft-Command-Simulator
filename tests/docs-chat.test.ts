import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serializeChat } from '../src/ai/messages.ts';
import { chatOf, dirtyLabel, initialDocs, isChatDirty, isUnsaved, markSaved, setChat, setText } from '../src/ui/docs.ts';

test('a conversation is unsaved until it is saved, like a project file', () => {
  let s = initialDocs('');
  const doc = () => s.docs[0];
  assert.equal(isChatDirty(doc()), false);
  assert.equal(isUnsaved(doc()), false);
  s = setChat(s, 1, [{ role: 'user', content: 'hi' }]);
  assert.equal(isChatDirty(doc()), true);
  assert.deepEqual(dirtyLabel(s), { dirty: true, name: 'Untitled-1.mcsim' });
  const messages = chatOf(doc()).messages;
  s = setChat(s, 1, messages, { path: 'C:\\chats\\a.mcchat', text: serializeChat(messages) });
  assert.equal(isChatDirty(doc()), false);
  assert.equal(chatOf(doc()).path, 'C:\\chats\\a.mcchat');
  s = setChat(s, 1, [...messages, { role: 'assistant', content: 'hello' }]);
  assert.equal(isChatDirty(doc()), true);
  assert.equal(chatOf(doc()).path, 'C:\\chats\\a.mcchat');
  s = setChat(s, 1, messages);
  assert.equal(isChatDirty(doc()), false);
});

test('the script and its conversation are unsaved separately', () => {
  let s = setText(initialDocs(''), 1, '/say hi');
  assert.equal(isUnsaved(s.docs[0]), true);
  s = markSaved(s, 1, 'C:\\a.mcsim', '/say hi');
  assert.equal(isUnsaved(s.docs[0]), false);
  s = setChat(s, 1, [{ role: 'user', content: 'x' }]);
  assert.equal(isUnsaved(s.docs[0]), true);
  assert.equal(dirtyLabel(s).dirty, true);
});