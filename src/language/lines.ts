export function stripComment(line: string): string {
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') quoted = !quoted;
    else if (c === '#' && !quoted && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
}

export interface LogicalLine {
  /** The joined text with comments removed. */
  text: string;
  /** 1-based number counting each logical line once. */
  line: number;
  /** 0-based index of the first physical line. */
  physical: number;
  /** How many physical lines it spans. */
  count: number;
}

/**
 * Groups physical lines into logical lines. A physical line whose last character (ignoring a trailing
 * comment) is a backslash continues on the next physical line; the whole group gets a single line number.
 */
export function logicalLines(source: string): LogicalLine[] {
  const phys = source.split(/\r?\n/);
  const out: LogicalLine[] = [];
  let i = 0;
  while (i < phys.length) {
    const parts: string[] = [];
    let j = i;
    for (;;) {
      const s = stripComment(phys[j]).trimEnd();
      const backslash = s.endsWith('\\');
      parts.push(backslash ? s.slice(0, -1).trimEnd() : s);
      j++;
      if (!backslash || j >= phys.length) break;
    }
    const text = parts
      .map((p, k) => (k === 0 ? p : p.trimStart()))
      .filter((p, k) => k === 0 || p.trim() !== '')
      .join(' ');
    out.push({ text, line: out.length + 1, physical: i, count: j - i });
    i = j;
  }
  return out;
}