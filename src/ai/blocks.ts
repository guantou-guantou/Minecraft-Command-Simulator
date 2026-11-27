import { lintProgram } from '../engine/lint.ts';
import { lintCommands } from '../language/cmdlint.ts';
import { parse } from '../language/parser.ts';
import type { Diagnostic } from '../language/types.ts';

export interface Segment {
  kind: 'text' | 'code';
  text: string;
  lang?: string;
  /** A code block whose closing fence has not arrived yet (the reply is still streaming). */
  open?: boolean;
}

/** Splits a reply into prose and fenced code blocks. A fence is three or more backticks; the block ends at a fence at least as long. */
export function splitReply(reply: string): Segment[] {
  const out: Segment[] = [];
  const lines = reply.split('\n');
  let text: string[] = [];
  let code: string[] | null = null;
  let fenceLen = 0;
  let lang = '';
  const flushText = () => {
    const t = text.join('\n').replace(/^\n+|\n+$/g, '');
    if (t) out.push({ kind: 'text', text: t });
    text = [];
  };
  for (const line of lines) {
    if (code === null) {
      const m = /^\s*(`{3,})\s*([\w+-]*)\s*$/.exec(line);
      if (m) {
        flushText();
        code = [];
        fenceLen = m[1].length;
        lang = m[2];
      } else text.push(line);
    } else {
      const m = /^\s*(`{3,})\s*$/.exec(line);
      if (m && m[1].length >= fenceLen) {
        out.push({ kind: 'code', text: code.join('\n'), ...(lang ? { lang } : {}) });
        code = null;
      } else code.push(line);
    }
  }
  if (code !== null) out.push({ kind: 'code', text: code.join('\n'), open: true, ...(lang ? { lang } : {}) });
  else flushText();
  return out;
}

export interface DiffLine {
  kind: ' ' | '-' | '+';
  text: string;
}

/** A line diff (longest common subsequence) of two texts. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before === '' ? [] : before.split('\n');
  const b = after === '' ? [] : after.split('\n');
  const n = a.length;
  const m = b.length;
  const lcs = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) out.push({ kind: ' ', text: a[i++] }), j++;
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) out.push({ kind: '-', text: a[i++] });
    else out.push({ kind: '+', text: b[j++] });
  }
  while (i < n) out.push({ kind: '-', text: a[i++] });
  while (j < m) out.push({ kind: '+', text: b[j++] });
  return out;
}

/** Every problem the editor would underline in a script. */
export function analyse(text: string): Diagnostic[] {
  const program = parse(text);
  return [...program.diagnostics, ...lintProgram(program), ...lintCommands(text)];
}

export interface ChangeCheck {
  before: number;
  after: number;
  /** Problems that the change introduces: those whose message is not among the problems before. */
  added: Diagnostic[];
  result: string;
}

/** What the script would look like with [from, to) replaced, and which problems that adds. */
export function checkChange(source: string, from: number, to: number, replacement: string): ChangeCheck {
  const result = source.slice(0, from) + replacement + source.slice(to);
  const before = analyse(source);
  const after = analyse(result);
  const left = new Map<string, number>();
  for (const d of before) left.set(d.message, (left.get(d.message) ?? 0) + 1);
  const added = after.filter((d) => {
    const n = left.get(d.message) ?? 0;
    if (n > 0) {
      left.set(d.message, n - 1);
      return false;
    }
    return true;
  });
  return { before: before.length, after: after.length, added, result };
}