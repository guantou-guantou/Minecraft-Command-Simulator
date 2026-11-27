import { logicalLines, stripComment, type LogicalLine } from './lines.ts';

export interface MappedLine {
  /** The joined text of the logical line (what the parser sees). */
  text: string;
  /** For each character of `text`, its offset in the script. */
  offsets: number[];
}

/** Joins the physical lines of a logical line like logicalLines does, remembering where every character came from. */
let layoutCache: { source: string; lines: string[]; starts: number[] } | null = null;

/** The physical lines of a script and where each starts; kept for the last script so that mapping every line stays linear. */
function layoutOf(source: string) {
  if (layoutCache?.source === source) return layoutCache;
  const lines = source.split('\n');
  const starts: number[] = [];
  let pos = 0;
  for (const l of lines) {
    starts.push(pos);
    pos += l.length + 1;
  }
  return (layoutCache = { source, lines, starts });
}

export function mapLogical(source: string, g: LogicalLine): MappedLine {
  const { lines, starts } = layoutOf(source);
  const text: string[] = [];
  const offsets: number[] = [];
  let first = true;
  for (let k = 0; k < g.count; k++) {
    const idx = g.physical + k;
    const s = stripComment(lines[idx] ?? '').trimEnd();
    let part = s.endsWith('\\') ? s.slice(0, -1).trimEnd() : s;
    let lead = 0;
    if (k > 0) {
      const t = part.trimStart();
      lead = part.length - t.length;
      part = t;
      if (part.trim() === '') continue;
    }
    if (!first) {
      text.push(' ');
      offsets.push((offsets[offsets.length - 1] ?? 0) + 1);
    }
    first = false;
    for (let i = 0; i < part.length; i++) {
      text.push(part[i]);
      offsets.push(starts[idx] + lead + i);
    }
  }
  return { text: text.join(''), offsets };
}

/** Script offsets of the characters [from, to) of a mapped line (the end is the offset after the last character). */
export function spanOf(m: MappedLine, from: number, to: number): { from: number; to: number } {
  const a = m.offsets[from] ?? m.offsets[m.offsets.length - 1] ?? 0;
  const b = to > from ? (m.offsets[to - 1] ?? a) + 1 : a;
  return { from: a, to: Math.max(a, b) };
}

export { logicalLines };