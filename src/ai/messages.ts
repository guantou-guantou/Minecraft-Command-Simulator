import { buildSystemPrompt, contextSection, type PromptContext, type ReplyLanguage } from './prompt.ts';

export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface Quote {
  text: string;
  fromLine: number;
  toLine: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  quotes?: Quote[];
}

/** What a user message looks like to the model: the lines it quoted first, then the question. */
export function userContent(m: ChatMessage): string {
  const q = m.quotes?.length ? `${contextSection({ quotes: m.quotes })}\n\n` : '';
  return `${q}${m.content}`;
}

export interface RequestOptions {
  language: ReplyLanguage;
  /** Sent only when the user allows the whole script to go. */
  script?: string;
  diagnostics?: PromptContext['diagnostics'];
}

/** The messages of one request: the system prompt, the conversation so far and the new question. */
export function buildRequest(history: ChatMessage[], next: ChatMessage, opts: RequestOptions): AiMessage[] {
  const system = buildSystemPrompt(opts.language, { script: opts.script, diagnostics: opts.diagnostics });
  return [{ role: 'system', content: system }, ...[...history, next].map((m): AiMessage => ({ role: m.role, content: m.role === 'user' ? userContent(m) : m.content }))];
}

export const CHAT_VERSION = 1;

/** The text of a saved conversation (.mcchat). */
export function serializeChat(messages: ChatMessage[]): string {
  return JSON.stringify({ version: CHAT_VERSION, messages }, null, 2) + '\n';
}

/** Reads a saved conversation; throws a readable error when the file is not one. */
export function parseChat(text: string): ChatMessage[] {
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error('This is not a conversation file');
  }
  const v = j as { version?: unknown; messages?: unknown };
  if (!v || v.version !== CHAT_VERSION || !Array.isArray(v.messages)) throw new Error('This is not a conversation file of this version');
  return v.messages.map((m: unknown, i: number): ChatMessage => {
    const x = m as Partial<ChatMessage>;
    if (!x || (x.role !== 'user' && x.role !== 'assistant') || typeof x.content !== 'string') throw new Error(`Message ${i + 1} is damaged`);
    const quotes = Array.isArray(x.quotes)
      ? x.quotes.filter((q): q is Quote => !!q && typeof q.text === 'string' && Number.isInteger(q.fromLine) && Number.isInteger(q.toLine))
      : undefined;
    return { role: x.role, content: x.content, ...(quotes?.length ? { quotes } : {}) };
  });
}