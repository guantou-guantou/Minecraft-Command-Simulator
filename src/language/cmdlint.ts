import { KNOWN_COMMANDS } from '../engine/known-commands.ts';
import { grammarOf, matchCommand, type Leaf } from './grammar.ts';
import { logicalLines } from './lines.ts';
import { splitTop } from './parser.ts';
import { mapLogical, spanOf } from './spans.ts';
import type { Diagnostic } from './types.ts';

function describe(expected: Leaf[]): string {
  const seen = new Set<string>();
  for (const e of expected) {
    seen.add(e.k === 'lit' ? e.v : e.k === 'kw' ? (Array.isArray(e.values) && e.values.length <= 6 ? e.values.join(' | ') : `<${e.name}>`) : `<${e.name}>`);
  }
  if (seen.size > 8) return [...seen].every((s) => /^[a-z_]+$/.test(s)) && expected.every((e) => e.k === 'lit') && seen.has('execute') ? 'a command name' : `${[...seen].slice(0, 8).join(' | ')} | ...`;
  return [...seen].join(' | ');
}

export interface TokenProblem {
  index: number;
  message: string;
}

/** The first word of a command (without the slash) that does not fit the grammar, or null when it fits. */
export function diagnoseWords(words: string[]): TokenProblem | null {
  if (!words.length) return { index: 0, message: 'Empty command' };
  if (!grammarOf(words[0])) {
    if (KNOWN_COMMANDS.has(words[0])) return null;
    return { index: 0, message: `Unknown command /${words[0]}` };
  }
  const full = matchCommand(words);
  if (full.state === 'ok') return null;
  if (full.state === 'incomplete') return { index: words.length - 1, message: `Incomplete command: expected ${describe(full.expected)} after "${words[words.length - 1]}"` };
  for (let k = 1; k <= words.length; k++) {
    if (matchCommand(words.slice(0, k)).state !== 'error') continue;
    const expected = matchCommand(words.slice(0, k - 1)).expected;
    return { index: k - 1, message: `Unexpected "${words[k - 1]}"${expected.length ? `; expected ${describe(expected)}` : '; nothing more is expected here'}` };
  }
  return null;
}

/** Checks every `/command` line against the command grammar and points at the first word that does not fit. */
export function lintCommands(source: string): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const g of logicalLines(source)) {
    const m = mapLogical(source, g);
    const lead = m.text.length - m.text.trimStart().length;
    if (m.text[lead] !== '/') continue;
    const body = m.text.slice(lead + 1);
    const toks = splitTop(body, (c) => /\s/.test(c));
    const words = toks.map((t) => t.text);
    const problem = diagnoseWords(words);
    if (!problem) continue;
    const t = toks[problem.index];
    const from = t ? lead + 1 + t.start : lead;
    const to = t ? from + t.text.length : lead + 1;
    out.push({ line: g.line, message: problem.message, span: spanOf(m, from, to) });
  }
  return out;
}