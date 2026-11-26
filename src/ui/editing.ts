import { stripComment } from '../language/lines.ts';

/** Index of a trailing continuation backslash in `code` (comment already removed), or -1. */
export function continuationIndex(code: string): number {
  const t = code.trimEnd();
  return t.endsWith('\\') ? t.length - 1 : -1;
}

export interface CommentEdit {
  /** Replace value.slice(from, to) with `text`, then select [selStart, selEnd). */
  from: number;
  to: number;
  text: string;
  selStart: number;
  selEnd: number;
}

/** True when the line (commented or not) ends with a continuation backslash. */
function continues(line: string): boolean {
  const body = /^\s*#/.test(line) ? line.replace(/^\s*#\s?/, '') : line;
  return stripComment(body).trimEnd().endsWith('\\');
}

/**
 * Toggles `# ` comments on the lines touched by the selection. The range grows to whole backslash-continued
 * commands so a command is never half commented. Returns null when there is nothing to toggle.
 */
export function toggleComment(value: string, start: number, end: number): CommentEdit | null {
  const lines = value.split('\n');
  const starts: number[] = [];
  let pos = 0;
  for (const l of lines) {
    starts.push(pos);
    pos += l.length + 1;
  }
  const lineOf = (p: number) => {
    let i = 0;
    while (i + 1 < lines.length && starts[i + 1] <= p) i++;
    return i;
  };
  let first = lineOf(start);
  let last = lineOf(end > start && value[end - 1] === '\n' ? end - 1 : end);
  while (first > 0 && continues(lines[first - 1])) first--;
  while (last < lines.length - 1 && continues(lines[last])) last++;
  const target = lines.slice(first, last + 1);
  const filled = target.filter((l) => l.trim() !== '');
  if (!filled.length) return null;
  const uncomment = filled.every((l) => l.trimStart().startsWith('#'));
  const indent = Math.min(...filled.map((l) => l.length - l.trimStart().length));
  const next = target.map((l) => {
    if (l.trim() === '') return l;
    return uncomment ? l.replace(/^(\s*)# ?/, '$1') : `${l.slice(0, indent)}# ${l.slice(indent)}`;
  });
  const from = starts[first];
  const to = starts[last] + lines[last].length;
  const text = next.join('\n');
  if (start === end) {
    const li = lineOf(start) - first;
    const col = start - starts[lineOf(start)];
    const delta = next[li].length - target[li].length;
    const caret = delta > 0 ? (col >= indent ? start + delta : start) : Math.max(starts[first + li], start + delta);
    const pos2 = from + next.slice(0, li).reduce((n, l) => n + l.length + 1, 0) + (caret - starts[first + li]);
    return { from, to, text, selStart: pos2, selEnd: pos2 };
  }
  return { from, to, text, selStart: from, selEnd: from + text.length };
}
