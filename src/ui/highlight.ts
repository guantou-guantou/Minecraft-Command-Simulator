import { logicalLines, stripComment } from '../language/lines.ts';
import { continuationIndex } from './editing.ts';

export type Kind = 'cmd' | 'chain' | 'decl' | 'declassign' | 'assign' | 'testhead' | 'testline' | 'other';

export interface Span {
  from: number;
  to: number;
  cls: string;
}

export interface LineInfo {
  kind: Kind;
  /** This physical line continues the previous one (backslash). */
  continued: boolean;
  /** The line starts inside an open double quoted string. */
  inString: boolean;
  /** Strings on this logical line are Molang (playanimation). */
  molang: boolean;
  /** Logical line number, or 0 for a continuation line. */
  number: number;
  /** Logical line number this physical line belongs to. */
  logical: number;
}

const EXEC_WORDS = new Set([
  'as', 'at', 'positioned', 'rotated', 'facing', 'align', 'anchored', 'if', 'unless', 'run',
  'block', 'entity', 'score', 'matches',
]);
const CONSTS = new Set(['true', 'false', 'imp', 'cha', 'rep', 'needs_redstone', 'always_on']);
export const TEST_WORDS = new Set(['expect', 'run', 'activate', 'deactivate', 'tick']);
const TEST_SUB = new Set(['entity', 'score', 'block', 'tag', 'chat', 'particles', 'count', 'has', 'lacks', 'contains']);
const TOKEN = /(\$\{[^}]*\}?)|("[^"]*"?)|(@[a-z](?:\[[^\]]*\]?)?)|([A-Za-z_][\w:.]*)|([~^]?-?(?:\d+\.?\d*|\.\d+)|[~^])|(\s+)|(.)/g;
const MOLANG_TOKEN = /(\d+\.?\d*|\.\d+)|((?:v|variable|t|temp)\.[A-Za-z_][\w.]*)|((?:math|q|query)\.[A-Za-z_]\w*)|([\s\S])/gi;

function commentStart(line: string): number {
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') quoted = !quoted;
    else if (line[i] === '#' && !quoted && (i === 0 || /\s/.test(line[i - 1]))) return i;
  }
  return -1;
}

export function lineKind(line: string): Kind {
  const cut = commentStart(line);
  const trimmed = (cut < 0 ? line : line.slice(0, cut)).trim();
  if (trimmed.startsWith('/')) return 'cmd';
  if (/^chain\s/.test(trimmed)) return 'chain';
  if (/^[A-Za-z_]\w*\s*\(/.test(trimmed)) return 'decl';
  if (/^[A-Za-z_]\w*\s*=\s*(ent|block|fill|item)\s*\(/.test(trimmed)) return 'declassign';
  if (/^[A-Za-z_]\w*\s*=/.test(trimmed)) return 'assign';
  return 'other';
}

/** Per physical line: its kind and the state carried over from the lines before it. */
export function analyzeDoc(doc: string): LineInfo[] {
  const lines = doc.split('\n');
  const out: LineInfo[] = new Array(lines.length);
  let inTest = false;
  for (const g of logicalLines(doc)) {
    const first = lines[g.physical] ?? '';
    const code = stripComment(first).trim();
    const indented = /^\s/.test(first);
    let kind: Kind = lineKind(first);
    if (!indented && /^test\s+\S+\s*:$/.test(code)) {
      kind = 'testhead';
      inTest = true;
    } else if (inTest && indented && code !== '' && kind !== 'cmd') kind = 'testline';
    else if (code !== '' && !indented) inTest = false;
    const molang = /\bplayanimation\b/.test(g.text);
    let open = false;
    for (let k = 0; k < g.count; k++) {
      const i = g.physical + k;
      out[i] = { kind, continued: k > 0, inString: open, molang, number: k === 0 ? g.line : 0, logical: g.line };
      const quotes = (stripComment(lines[i] ?? '').match(/"/g) ?? []).length % 2;
      open = (open ? 1 : 0) + quotes === 1;
    }
  }
  for (let i = 0; i < out.length; i++) out[i] ??= { kind: 'other', continued: false, inString: false, molang: false, number: 0, logical: 0 };
  return out;
}

function molangSpans(text: string, base: number, out: Span[]): void {
  for (const m of text.matchAll(MOLANG_TOKEN)) {
    const cls = m[1] ? 'hl-num' : m[2] ? 'hl-var' : m[3] ? 'hl-fn' : null;
    const from = base + (m.index ?? 0);
    out.push({ from, to: from + m[0].length, cls: cls ?? 'hl-str' });
  }
}

function codeSpans(code: string, info: LineInfo, out: Span[]): void {
  const { kind, continued, molang } = info;
  let wordIdx = continued ? 1 : 0;
  let seenSlash = continued;
  const add = (from: number, to: number, cls: string | null) => cls && out.push({ from, to, cls });
  const string = (from: number, text: string, opening: boolean) => {
    if (!molang) return add(from, from + text.length, 'hl-str');
    const closed = text.length > (opening ? 1 : 0) && text.endsWith('"');
    const lead = opening ? 1 : 0;
    if (opening) add(from, from + 1, 'hl-str');
    molangSpans(text.slice(lead, closed ? -1 : undefined), from + lead, out);
    if (closed) add(from + text.length - 1, from + text.length, 'hl-str');
  };
  let start = 0;
  if (info.inString) {
    const m = /^[^"]*"?/.exec(code)!;
    if (m[0]) string(0, m[0], false);
    start = m[0].length;
  }
  for (const m of code.slice(start).matchAll(TOKEN)) {
    const text = m[0];
    const at = start + (m.index ?? 0);
    if (m[1]) add(at, at + text.length, 'hl-var');
    else if (m[2]) string(at, text, true);
    else if (m[3]) add(at, at + text.length, 'hl-sel');
    else if (m[4]) {
      const idx = wordIdx++;
      const next = code.slice(at + text.length);
      let cls: string | null = null;
      if (kind === 'cmd') cls = idx === 0 ? 'hl-cmd' : EXEC_WORDS.has(text) ? 'hl-kw' : null;
      else if (kind === 'chain') {
        if (idx === 0 || text === 'at') cls = 'hl-kw';
        else if (idx === 1) cls = 'hl-fn';
        else if (/^\s*=/.test(next) && !/^\s*==/.test(next)) cls = 'hl-prop';
        else if (text === 'rot' && /^\s*\(/.test(next)) cls = 'hl-fn';
        else if (CONSTS.has(text)) cls = 'hl-const';
      }
      else if (kind === 'testhead') cls = idx === 0 ? 'hl-kw' : idx === 1 ? 'hl-fn' : null;
      else if (kind === 'testline') cls = idx === 0 && TEST_WORDS.has(text) ? 'hl-kw' : TEST_SUB.has(text) ? 'hl-kw' : null;
      else if (kind === 'assign') cls = idx === 0 ? 'hl-var' : text === 'rot' ? 'hl-fn' : null;
      else if (kind === 'decl' || kind === 'declassign') {
        if (kind === 'declassign' && idx === 0) cls = 'hl-var';
        else if (idx === (kind === 'declassign' ? 1 : 0)) cls = 'hl-fn';
        else if (/^\s*=/.test(next) && !/^\s*==/.test(next)) cls = 'hl-prop';
        else if (text === 'rot' && /^\s*\(/.test(next)) cls = 'hl-fn';
        else if (CONSTS.has(text)) cls = 'hl-const';
      }
      add(at, at + text.length, cls);
    } else if (m[5]) add(at, at + text.length, 'hl-num');
    else if (m[0] === '/' && kind === 'cmd' && !seenSlash) {
      seenSlash = true;
      add(at, at + 1, 'hl-cmd');
    }
  }
}

/** Highlight spans of one physical line, relative to the start of the line. */
export function lineSpans(line: string, info: LineInfo): Span[] {
  const out: Span[] = [];
  const cut = commentStart(line);
  const code = cut < 0 ? line : line.slice(0, cut);
  const bs = continuationIndex(code);
  codeSpans(bs >= 0 ? code.slice(0, bs) : code, info, out);
  if (bs >= 0) out.push({ from: bs, to: code.length, cls: 'hl-cont' });
  if (cut >= 0) out.push({ from: cut, to: line.length, cls: 'hl-cm' });
  return out.filter((s) => s.to > s.from).sort((a, b) => a.from - b.from || a.to - b.to);
}