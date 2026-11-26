import { logicalLines, stripComment } from './lines.ts';
import { splitTop, unquote } from './parser.ts';
import type { Cond, Diagnostic, Op, Step, StepBody, TestCase } from './types.ts';

const OPS: Op[] = ['==', '!=', '>=', '<=', '>', '<'];
const HEADER = /^test\s+([\w.-]+)\s*:\s*(?:#.*)?$/;

const isOp = (t: string | undefined): t is Op => OPS.includes(t as Op);
const isInt = (t: string | undefined) => t !== undefined && /^-?\d+$/.test(t);

function parseExpect(words: string[], code: string): Cond {
  const kind = words[1];
  const fail = (m: string): never => {
    throw new Error(m);
  };
  const num = (t: string | undefined, what: string) => (isInt(t) ? Number(t) : fail(`expect ${kind}: ${what} must be an integer, got "${t ?? ''}"`));
  switch (kind) {
    case 'entity': {
      if (!words[2]) fail('expect entity <selector> [count] [op] <n>');
      let i = 3;
      if (words[i] === 'count') i++;
      const op = isOp(words[i]) ? (words[i++] as Op) : '==';
      if (words[i + 1] !== undefined) fail(`expect entity: unexpected "${words[i + 1]}"`);
      return { k: 'entity', selector: words[2], op, n: num(words[i], 'the count') };
    }
    case 'score': {
      if (!words[3]) fail('expect score <holder> <objective> <op> <n>');
      if (!isOp(words[4])) fail(`expect score: expected a comparison (==, !=, >=, <=, >, <), got "${words[4] ?? ''}"`);
      if (words[6] !== undefined) fail(`expect score: unexpected "${words[6]}"`);
      return { k: 'score', holder: words[2], objective: words[3], op: words[4] as Op, n: num(words[5], 'the value') };
    }
    case 'block': {
      const pos = [2, 3, 4].map((i) => num(words[i], 'a coordinate'));
      if (!words[5]) fail('expect block <x> <y> <z> <id>');
      if (words[6] !== undefined) fail(`expect block: unexpected "${words[6]}"`);
      return { k: 'block', pos: pos as [number, number, number], id: words[5] };
    }
    case 'tag': {
      if (!words[4] || (words[3] !== 'has' && words[3] !== 'lacks')) fail('expect tag <selector> has|lacks <tag>');
      if (words[5] !== undefined) fail(`expect tag: unexpected "${words[5]}"`);
      return { k: 'tag', selector: words[2], has: words[3] === 'has', tag: words[4] };
    }
    case 'chat': {
      if (words[2] !== 'contains') fail('expect chat contains <text>');
      const at = code.indexOf('contains') + 'contains'.length;
      const text = unquote(code.slice(at).trim());
      if (!text) fail('expect chat contains: the text is empty');
      return { k: 'chat', text };
    }
    case 'particles': {
      let i = 2;
      const op = isOp(words[i]) ? (words[i++] as Op) : '==';
      if (words[i + 1] !== undefined) fail(`expect particles: unexpected "${words[i + 1]}"`);
      return { k: 'particles', op, n: num(words[i], 'the count') };
    }
    default:
      return fail('expect: expected entity, score, block, tag, chat or particles');
  }
}

function parseStep(code: string): StepBody {
  if (code.startsWith('/')) {
    if (code.length < 2) throw new Error('empty command');
    return { kind: 'command', text: code.slice(1) };
  }
  const words = splitTop(code, (c) => /\s/.test(c)).map((t) => t.text);
  switch (words[0]) {
    case 'run':
    case 'activate':
    case 'deactivate':
      if (!words[1] || words[2]) throw new Error(`${words[0]} <chain>`);
      return { kind: words[0], chain: words[1] };
    case 'tick': {
      if (!isInt(words[1]) || Number(words[1]) < 0 || Number(words[1]) > 100000 || words[2]) throw new Error('tick <n> with n from 0 to 100000');
      return { kind: 'tick', n: Number(words[1]) };
    }
    case 'expect':
      return { kind: 'expect', cond: parseExpect(words, code), text: code };
    default:
      throw new Error(`unknown test step "${words[0]}" (use run, activate, deactivate, tick, expect or a /command)`);
  }
}

/**
 * Takes the `test name:` blocks out of the source. The returned source has the same number of lines, with the
 * test lines blanked, so line numbers elsewhere do not change.
 */
export function extractTests(source: string): { source: string; tests: TestCase[]; diagnostics: Diagnostic[] } {
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
  if (!blocks.length) return { source, tests: [], diagnostics: [] };
  const blanked = [...lines];
  for (const b of blocks) for (const i of [b.head, ...b.body]) blanked[i] = blanked[i].endsWith('\r') ? '\r' : '';
  const number = new Map<number, number>();
  for (const g of logicalLines(blanked.join('\n'))) for (let k = 0; k < g.count; k++) number.set(g.physical + k, g.line);
  const diagnostics: Diagnostic[] = [];
  const tests: TestCase[] = [];
  const seen = new Set<string>();
  for (const b of blocks) {
    const line = number.get(b.head) ?? b.head + 1;
    if (seen.has(b.name)) diagnostics.push({ line, message: `Duplicate test "${b.name}"` });
    seen.add(b.name);
    const steps: Step[] = [];
    for (const i of b.body) {
      const code = stripComment(lines[i].replace(/\r$/, '')).trim();
      if (!code) continue;
      const n = number.get(i) ?? i + 1;
      try {
        steps.push({ ...parseStep(code), line: n } as Step);
      } catch (e) {
        diagnostics.push({ line: n, message: `test ${b.name}: ${(e as Error).message}` });
      }
    }
    tests.push({ name: b.name, line, steps });
  }
  return { source: blanked.join('\n'), tests, diagnostics };
}