import { serializeChat, type ChatMessage } from '../ai/messages.ts';
import { baseName } from './desktop.ts';

export interface Doc {
  id: number;
  path: string | null;
  /** Display name for files opened without a real path (browser). */
  fileName: string | null;
  text: string;
  savedText: string;
  untitled: number;
  /** Line ending of the file on disk; the editor itself always uses LF. */
  eol: 'lf' | 'crlf';
  /** The AI conversation that belongs to this script; kept in a .mcchat file like a project file. */
  chat?: ChatState;
}

export interface ChatState {
  messages: ChatMessage[];
  path: string | null;
  /** The serialized messages as they were last saved or opened; the conversation is unsaved when they differ. */
  saved: string;
}

export interface Docs {
  docs: Doc[];
  activeId: number;
  nextId: number;
  nextUntitled: number;
}

export interface OpenedFile {
  path: string | null;
  name?: string | null;
  content: string;
  eol?: 'lf' | 'crlf';
}

export const isDirty = (d: Doc) => d.text !== d.savedText;
export const emptyChat = (): ChatState => ({ messages: [], path: null, saved: serializeChat([]) });
export const chatOf = (d: Doc): ChatState => d.chat ?? emptyChat();
export const isChatDirty = (d: Doc) => !!d.chat && serializeChat(d.chat.messages) !== d.chat.saved;
/** The script or its conversation has unsaved changes. */
export const isUnsaved = (d: Doc) => isDirty(d) || isChatDirty(d);
export const isPristine = (d: Doc) => d.path === null && d.fileName === null && !isDirty(d);
export const docName = (d: Doc) => (d.path ? baseName(d.path) : (d.fileName ?? `Untitled-${d.untitled}.mcsim`));
export const activeDoc = (s: Docs) => s.docs.find((d) => d.id === s.activeId) ?? s.docs[0];

const samePath = (a: string | null, b: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

export function initialDocs(text: string): Docs {
  return { docs: [{ id: 1, path: null, fileName: null, text, savedText: text, untitled: 1, eol: 'lf' }], activeId: 1, nextId: 2, nextUntitled: 2 };
}

export function addDoc(s: Docs, text: string, path: string | null = null, fileName: string | null = null, eol: 'lf' | 'crlf' = 'lf'): Docs {
  const doc: Doc = { id: s.nextId, path, fileName, text, savedText: text, untitled: path || fileName ? 0 : s.nextUntitled, eol };
  return { docs: [...s.docs, doc], activeId: doc.id, nextId: s.nextId + 1, nextUntitled: doc.untitled ? s.nextUntitled + 1 : s.nextUntitled };
}

/** A new untitled tab holding generated text; it counts as unsaved so closing it asks first. */
export function addScriptDoc(s: Docs, text: string): Docs {
  const added = addDoc(s, text);
  return { ...added, docs: added.docs.map((d) => (d.id === added.activeId ? { ...d, savedText: '' } : d)) };
}

/** Opens a file: focuses an existing tab for the same path, replaces an untouched untitled active tab, or adds a tab. */
export function openFile(s: Docs, file: OpenedFile): Docs {
  const existing = s.docs.find((d) => samePath(d.path, file.path));
  if (existing) return { ...s, activeId: existing.id };
  const active = activeDoc(s);
  if (active && isPristine(active)) {
    const docs = s.docs.map((d) =>
      d.id === active.id ? { ...d, path: file.path, fileName: file.name ?? null, text: file.content, savedText: file.content, eol: file.eol ?? 'lf' } : d,
    );
    return { ...s, docs };
  }
  return addDoc(s, file.content, file.path, file.name ?? null, file.eol ?? 'lf');
}

export function closeDoc(s: Docs, id: number, blankText: string): Docs {
  const idx = s.docs.findIndex((d) => d.id === id);
  if (idx < 0) return s;
  const docs = s.docs.filter((d) => d.id !== id);
  if (!docs.length) return addDoc({ ...s, docs: [] }, blankText);
  const activeId = s.activeId === id ? docs[Math.min(idx, docs.length - 1)].id : s.activeId;
  return { ...s, docs, activeId };
}

export function setText(s: Docs, id: number, text: string): Docs {
  return { ...s, docs: s.docs.map((d) => (d.id === id ? { ...d, text } : d)) };
}

export function markSaved(s: Docs, id: number, path: string | null, text: string): Docs {
  return { ...s, docs: s.docs.map((d) => (d.id === id ? { ...d, path: path ?? d.path, text: d.text, savedText: text } : d)) };
}

export function activate(s: Docs, id: number): Docs {
  return s.docs.some((d) => d.id === id) ? { ...s, activeId: id } : s;
}

export function cycle(s: Docs, dir: 1 | -1): Docs {
  const i = s.docs.findIndex((d) => d.id === s.activeId);
  return { ...s, activeId: s.docs[(i + dir + s.docs.length) % s.docs.length].id };
}

export function moveDoc(s: Docs, id: number, toIndex: number): Docs {
  const from = s.docs.findIndex((d) => d.id === id);
  if (from < 0) return s;
  const docs = [...s.docs];
  const [d] = docs.splice(from, 1);
  docs.splice(Math.max(0, Math.min(docs.length, toIndex)), 0, d);
  return { ...s, docs };
}

/** The label the window uses when asking about unsaved changes. */
export function dirtyLabel(s: Docs): { dirty: boolean; name: string } {
  const dirty = s.docs.filter(isUnsaved);
  if (dirty.length > 1) return { dirty: true, name: `${dirty.length} documents` };
  return { dirty: dirty.length === 1, name: docName(dirty[0] ?? activeDoc(s)) };
}

/** Replaces the conversation of a tab; path and saved change only when the conversation was just saved or opened. */
export function setChat(s: Docs, id: number, messages: ChatMessage[], saved?: { path: string | null; text: string }): Docs {
  return {
    ...s,
    docs: s.docs.map((d) => {
      if (d.id !== id) return d;
      const cur = chatOf(d);
      return { ...d, chat: { messages, path: saved ? saved.path : cur.path, saved: saved ? saved.text : cur.saved } };
    }),
  };
}
