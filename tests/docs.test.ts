import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  activate, activeDoc, addDoc, closeDoc, cycle, dirtyLabel, docName, initialDocs, isDirty, isPristine, markSaved, moveDoc, openFile, setText,
} from '../src/ui/docs.ts';

const names = (s: ReturnType<typeof initialDocs>) => s.docs.map(docName);

test('new tabs get increasing Untitled numbers and become active', () => {
  let s = initialDocs('a');
  s = addDoc(s, 'b');
  s = addDoc(s, 'c');
  assert.deepEqual(names(s), ['Untitled-1.mcsim', 'Untitled-2.mcsim', 'Untitled-3.mcsim']);
  assert.equal(activeDoc(s).text, 'c');
});

test('openFile replaces an untouched untitled tab, otherwise adds one, and focuses duplicates', () => {
  let s = initialDocs('sample');
  s = openFile(s, { path: 'C:\\x\\a.mcsim', content: 'A' });
  assert.deepEqual(names(s), ['a.mcsim']);
  assert.equal(isDirty(activeDoc(s)), false);
  s = openFile(s, { path: 'C:\\x\\b.mcsim', content: 'B' });
  assert.deepEqual(names(s), ['a.mcsim', 'b.mcsim']);
  s = openFile(s, { path: 'c:\\X\\A.MCSIM', content: 'ignored' });
  assert.equal(s.docs.length, 2);
  assert.equal(docName(activeDoc(s)), 'a.mcsim');
  assert.equal(activeDoc(s).text, 'A');
  s = addDoc(s, 'blank');
  s = setText(s, s.activeId, 'edited');
  s = openFile(s, { path: 'C:\\x\\c.mcsim', content: 'C' });
  assert.equal(s.docs.length, 4);
  assert.equal(isPristine(s.docs[2]), false);
});

test('openFile with a browser file name (no path) keeps the name', () => {
  const s = openFile(initialDocs('x'), { path: null, name: 'demo.mcsim', content: 'D' });
  assert.deepEqual(names(s), ['demo.mcsim']);
  assert.equal(isPristine(activeDoc(s)), false);
});

test('closeDoc activates the neighbour, keeps the active tab otherwise, and never leaves zero tabs', () => {
  let s = initialDocs('a');
  s = addDoc(s, 'b');
  s = addDoc(s, 'c');
  const [a, b, c] = s.docs.map((d) => d.id);
  s = activate(s, b);
  s = closeDoc(s, b, 'blank');
  assert.equal(s.activeId, c);
  s = closeDoc(s, a, 'blank');
  assert.equal(s.activeId, c);
  s = closeDoc(s, c, '# blank\n');
  assert.equal(s.docs.length, 1);
  assert.equal(activeDoc(s).text, '# blank\n');
  assert.equal(closeDoc(s, 999, 'x'), s);
});

test('dirty tracking, saving and the window label', () => {
  let s = initialDocs('a');
  s = addDoc(s, 'b');
  assert.deepEqual(dirtyLabel(s), { dirty: false, name: 'Untitled-2.mcsim' });
  s = setText(s, s.docs[0].id, 'a2');
  assert.deepEqual(dirtyLabel(s), { dirty: true, name: 'Untitled-1.mcsim' });
  s = setText(s, s.docs[1].id, 'b2');
  assert.deepEqual(dirtyLabel(s), { dirty: true, name: '2 documents' });
  s = markSaved(s, s.docs[0].id, 'C:\\p\\one.mcsim', 'a2');
  assert.equal(docName(s.docs[0]), 'one.mcsim');
  assert.equal(isDirty(s.docs[0]), false);
  assert.deepEqual(dirtyLabel(s), { dirty: true, name: 'Untitled-2.mcsim' });
});

test('cycle wraps around and moveDoc reorders', () => {
  let s = initialDocs('a');
  s = addDoc(s, 'b');
  s = addDoc(s, 'c');
  const ids = s.docs.map((d) => d.id);
  assert.equal(cycle(s, 1).activeId, ids[0]);
  assert.equal(cycle(activate(s, ids[0]), -1).activeId, ids[2]);
  assert.deepEqual(moveDoc(s, ids[2], 0).docs.map((d) => d.id), [ids[2], ids[0], ids[1]]);
  assert.deepEqual(moveDoc(s, ids[0], 99).docs.map((d) => d.id), [ids[1], ids[2], ids[0]]);
});
test('the line ending of an opened file is kept per document', () => {
  let s = initialDocs('x');
  s = openFile(s, { path: 'C:\\a.mcsim', content: 'A', eol: 'crlf' });
  assert.equal(activeDoc(s).eol, 'crlf');
  s = addDoc(s, 'new');
  assert.equal(activeDoc(s).eol, 'lf');
  s = openFile(s, { path: 'C:\\b.mcsim', content: 'B' });
  assert.equal(activeDoc(s).eol, 'lf');
});
