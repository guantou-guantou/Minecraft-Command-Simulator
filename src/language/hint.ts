import { posSpan } from './coords.ts';
import { KEYS, lastToken, logicalPrefix } from './complete.ts';
import { COMMANDS, grammarOf, matchCommand, type G } from './grammar.ts';
import { splitTop } from './parser.ts';
import { KNOWN_COMMANDS } from '../engine/known-commands.ts';

export interface Part {
  text: string;
  arg: boolean;
  optional: boolean;
  span: 'one' | 'pos' | 'rot' | 'rest';
}
export type Sig = Part[];

const MAX = 40;
const lit = (text: string): Part => ({ text, arg: false, optional: false, span: 'one' });

function expand(g: G): Sig[] {
  switch (g.k) {
    case 'lit': return [[lit(g.v)]];
    case 'kw': return [[{ text: `<${g.name}>`, arg: true, optional: false, span: 'one' }]];
    case 'val': return [[{ text: `<${g.name}>`, arg: true, optional: false, span: g.t === 'coord3' ? 'pos' : g.t === 'rotpair' ? 'rot' : 'one' }]];
    case 'rest': return [[{ text: `<${g.name}...>`, arg: true, optional: false, span: 'rest' }]];
    case 'lazy': return [[lit('...')]];
    case 'opt': return expand(g.x).map((s) => s.map((p) => ({ ...p, optional: true })));
    case 'alt': {
      const whole = g.xs.some((x) => x.k === 'val' && (x.t === 'coord3' || x.t === 'rotpair'));
      return g.xs.filter((x) => !(whole && x.k === 'seq' && x.xs[0].k === 'val' && (x.xs[0].t === 'coord' || x.xs[0].t === 'rotvalue'))).flatMap(expand).slice(0, MAX);
    }
    case 'seq': {
      let acc: Sig[] = [[]];
      for (const x of g.xs) {
        const next = expand(x);
        acc = acc.flatMap((a) => next.map((n) => [...a, ...n])).slice(0, MAX);
      }
      return acc;
    }
  }
}

export function signatures(name: string): Sig[] {
  const f = grammarOf(name);
  return f ? expand(f()) : [];
}

export const sigText = (s: Sig) => `/${s.map((p) => (p.optional ? `[${p.text}]` : p.text)).join(' ')}`;

/** Index of the part the next token belongs to, -1 when the typed words do not fit the signature, or the part count when the line is complete. */
export function align(sig: Sig, words: string[]): number {
  let ti = 0;
  for (let i = 0; i < sig.length; i++) {
    const p = sig[i];
    if (ti >= words.length) return i;
    if (!p.arg) {
      if (words[ti] !== p.text) {
        if (p.optional) continue;
        return -1;
      }
      ti++;
    } else if (p.span === 'rest') return i;
    else if (p.span === 'pos') {
      const span = posSpan(words, ti);
      if (span && !span.complete) return i;
      ti += span ? span.n : 3;
    } else if (p.span === 'rot') {
      const n = /^\$\{.*\}$/.test(words[ti]) ? 1 : 2;
      if (ti + n > words.length) return i;
      ti += n;
    } else ti++;
  }
  return ti >= words.length ? sig.length : -1;
}

export interface CommandHint {
  sigs: { sig: Sig; active: number }[];
}

/** Signatures that still fit the words typed so far (words[0] is the command name). */
export function commandHint(words: string[]): CommandHint | null {
  if (!words.length || !grammarOf(words[0])) return null;
  const fit = signatures(words[0])
    .map((sig) => ({ sig, active: align(sig, words) }))
    .filter((x) => x.active >= 0)
    .sort((a, b) => b.active - a.active);
  return fit.length ? { sigs: fit.slice(0, 3) } : null;
}

export interface DeclHint {
  name: string;
  keys: string[];
  /** The key whose value is being typed, if any. */
  current: string | null;
}

const CANON: Record<string, string> = { position: 'pos', rotation: 'rot', components: 'comp' };

export function declHint(head: string): DeclHint | null {
  const m = /^(?:\w+\s*=\s*)?(ent|block|fill|item|region|cb|world)\s*\(|^chain\s+\w+\s*\(/.exec(head);
  if (!m) return null;
  const inner = head.slice(m[0].length);
  if (inner.includes(')')) return null;
  const name = m[1] ?? 'chain';
  const parts = splitTop(inner, (c) => c === ',').map((t) => t.text);
  const last = (parts[parts.length - 1] ?? '').trimStart();
  const eq = last.indexOf('=');
  const key = eq >= 0 ? last.slice(0, eq).trim() : null;
  return { name, keys: KEYS[name] ?? [], current: key ? (CANON[key] ?? key) : null };
}

export type Hint = { kind: 'command'; hint: CommandHint } | { kind: 'decl'; hint: DeclHint };

/** What to show while the caret is at `cursor`: command signatures or the parameters of a declaration. */
export function hintAt(text: string, cursor: number): Hint | null {
  const { prefix } = logicalPrefix(text, cursor);
  const head = prefix.trimStart();
  if (head.startsWith('/')) {
    const tok = lastToken(prefix);
    const before = head.slice(0, head.length - (prefix.length - tok.start)).replace(/^\//, '');
    const words = splitTop(before, (c) => /\s/.test(c)).map((t) => t.text);
    const h = commandHint(words);
    return h ? { kind: 'command', hint: h } : null;
  }
  const d = declHint(head);
  return d ? { kind: 'decl', hint: d } : null;
}

const KEY_DOCS: Record<string, string> = {
  type: 'entity, block or item id (the minecraft: prefix may be left out)',
  pos: 'position: (x, y, z) or a position variable',
  rot: 'rotation: (yrot, xrot), rot(yrot, xrot) or a rotation variable',
  name: 'name tag (not unique; use a handle to point at one entity)',
  tags: 'list of tags, for example ["a", "b"]',
  selected: 'selected hotbar slot, 0 to 8 (players only)',
  states: 'block states, for example ["open_bit"=true]',
  nbt: 'block entity data as text NBT, for example {id:"Sign",FrontText:{Text:"hi"}}',
  target: 'entity handle, or the position of a container block',
  slot: 'slot name, for example slot.hotbar or slot.weapon.mainhand',
  index: 'slot number inside the slot group',
  count: 'stack size',
  data: 'data value',
  comp: 'item components as JSON',
  from: 'first corner of the region',
  to: 'opposite corner of the region',
  mode: 'imp (impulse), cha (chain) or rep (repeating)',
  conditional: 'true when the block only runs if the previous block succeeded',
  power: 'needs_redstone or always_on',
  delay: 'delay in ticks',
  first_tick: 'true/false: a repeating block runs once at once when powered, then every delay ticks',
  facing: 'up, down, north, south, east or west',
  time: 'time of day in ticks (0 to 23999) or day, noon, sunset, night, midnight, sunrise',
  weather: 'clear, rain or thunder',
  difficulty: 'peaceful, easy, normal or hard',
  spawn: 'world spawn point: (x, y, z) or a position variable',
  seed: 'integer seed for @r and scoreboard players random',
};

const LEAF_DOC: Record<string, string> = {
  target: 'a selector (@a, @e, @p, @s, @n) or an entity name',
  coord: 'a coordinate: number, ~relative or ^local',
  coord3: 'three coordinates, or ${position variable}',
  rotvalue: 'an angle, or ~relative',
  rotpair: '${rotation variable}',
  block: 'a block id',
  item: 'an item id',
  entity: 'an entity type id',
  int: 'an integer',
  float: 'a number',
  bool: 'true or false',
};

/** Text for the tooltip shown when the mouse rests on `col` of `line` (the line is one physical line). */
export function explainAt(line: string, col: number, whole: string): { from: number; to: number; lines: string[] } | null {
  const head = line.trimStart();
  const lead = line.length - head.length;
  if (head.startsWith('/')) {
    const body = head.slice(1);
    const toks = splitTop(body, (c) => /\s/.test(c));
    const i = toks.findIndex((t) => col >= lead + 1 + t.start && col <= lead + 1 + t.start + t.text.length);
    if (i < 0) return null;
    const t = toks[i];
    const from = lead + 1 + t.start;
    const name = toks[0].text;
    if (i === 0) {
      const sigs = signatures(name);
      if (!sigs.length) return { from, to: from + t.text.length, lines: [`/${name}`, KNOWN_COMMANDS.has(name) ? 'A Bedrock command that is not implemented yet.' : 'Unknown command.'] };
      const text = new Set(sigs.map(sigText));
      const note = name in COMMANDS ? [] : ['Not implemented yet: only its syntax is checked.'];
      return { from, to: from + t.text.length, lines: [`/${name}`, ...[...text].slice(0, 6), ...note] };
    }
    const words = toks.slice(0, i).map((x) => x.text);
    const expected = matchCommand(words).expected;
    if (!expected.length) return null;
    const seen = new Set<string>();
    const lines: string[] = [];
    for (const e of expected) {
      const d = e.k === 'lit' ? `keyword "${e.v}"` : e.k === 'kw' ? `<${e.name}>${Array.isArray(e.values) ? `: ${e.values.slice(0, 10).join(', ')}` : ''}` : e.k === 'rest' ? `<${e.name}>: the rest of the line` : `<${e.name}>: ${LEAF_DOC[e.t] ?? e.t}`;
      if (!seen.has(d)) {
        seen.add(d);
        lines.push(d);
      }
    }
    return { from, to: from + t.text.length, lines: [`argument of /${name}`, ...lines.slice(0, 6)] };
  }
  const word = /[\w]+/g;
  for (const m of line.matchAll(word)) {
    const from = m.index ?? 0;
    if (col < from || col > from + m[0].length) continue;
    const next = line.slice(from + m[0].length);
    const key = CANON[m[0]] ?? m[0];
    if (/^\s*=(?!=)/.test(next) && KEY_DOCS[key] && /\(/.test(line.slice(0, from))) return { from, to: from + m[0].length, lines: [`${key}=`, KEY_DOCS[key]] };
    const decl = new RegExp(`^\\s*${m[0]}\\s*=\\s*(.+)$`, 'm').exec(whole);
    if (decl) return { from, to: from + m[0].length, lines: [`${m[0]} = ${decl[1].trim()}`] };
  }
  return null;
}
