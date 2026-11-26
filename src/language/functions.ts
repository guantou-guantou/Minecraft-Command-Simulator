import { logicalLines, stripComment } from './lines.ts';
import type { Diagnostic, FunctionDecl } from './types.ts';

const HEADER = /^function\s+([\w.-]+(?:\/[\w.-]+)*)\s*:\s*(?:#.*)?$/;

/**
 * Takes the `function name:` blocks out of the source, like `test` blocks: the body is the indented lines
 * (commands with or without a leading slash, ` \` continues a command). The returned source has the same number
 * of lines, with the function lines blanked, so line numbers elsewhere do not change.
 */
export function extractFunctions(source: string): { source: string; functions: FunctionDecl[]; diagnostics: Diagnostic[] } {
  const lines = source.split('\n');
  const blocks: { name: string; head: number; body: number[] }[] = [];
  let cur: (typeof blocks)[number] | null = null;
  lines.forEach((raw, i) => {
    const line = raw.replace(/\r$/, '');
    const code = stripComment(line).trim();
    const indented = /^\s/.test(line);
    const m = !indented ? HEADER.exec(line.trim()) : null;
    if (m) {
      cur = { name: m[1], head: i, body: [] };
      blocks.push(cur);
    } else if (cur && (code === '' || indented)) cur.body.push(i);
    else if (code !== '') cur = null;
  });
  if (!blocks.length) return { source, functions: [], diagnostics: [] };
  const blanked = [...lines];
  for (const b of blocks) for (const i of [b.head, ...b.body]) blanked[i] = blanked[i].endsWith('\r') ? '\r' : '';
  const number = new Map<number, number>();
  for (const g of logicalLines(blanked.join('\n'))) for (let k = 0; k < g.count; k++) number.set(g.physical + k, g.line);
  const diagnostics: Diagnostic[] = [];
  const functions: FunctionDecl[] = [];
  const seen = new Set<string>();
  for (const b of blocks) {
    const line = number.get(b.head) ?? b.head + 1;
    if (seen.has(b.name)) diagnostics.push({ line, message: `Duplicate function "${b.name}"` });
    seen.add(b.name);
    const commands: FunctionDecl['commands'] = [];
    let pending: { text: string; line: number } | null = null;
    const push = (p: { text: string; line: number }) => {
      if (!p.text.startsWith('/')) diagnostics.push({ line: p.line, message: `function ${b.name}: expected a /command, got "${p.text}"` });
      else if (p.text.length > 1) commands.push({ line: p.line, text: p.text.slice(1).trim() });
    };
    for (const i of b.body) {
      const raw = lines[i].replace(/\r$/, '');
      const code = stripComment(raw).trim();
      if (!code && !pending) continue;
      const n = number.get(i) ?? i + 1;
      const continued = / \\$/.test(code) || code === '\\';
      const piece = continued ? code.replace(/\s*\\$/, '') : code;
      if (pending) pending.text += ` ${piece}`;
      else pending = { text: piece, line: n };
      if (continued) continue;
      push(pending);
      pending = null;
    }
    if (pending?.text.trim()) push(pending);
    functions.push({ name: b.name, line, commands });
  }
  return { source: blanked.join('\n'), functions, diagnostics };
}