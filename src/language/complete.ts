import { GAMERULE_DEFAULTS } from '../engine/gamerules.ts';
import { shortStructureName } from '../engine/structure.ts';
import { INPUT_PERMISSIONS, ENCHANTS } from '../engine/player-commands.ts';
import { EFFECTS } from '../engine/state-commands.ts';
import { KNOWN_COMMANDS } from '../engine/known-commands.ts';
import { COMMANDS, grammarOf, matchCommand, matchTest, type Leaf } from './grammar.ts';
import { COMMON_BLOCKS, COMMON_ITEMS, ENTITY_TYPES, GAME_MODES, PARTICLES } from './ids.ts';
import { SLOT_NAMES } from './items.ts';
import { splitTop, stripComment } from './parser.ts';
import type { Program } from './types.ts';

export type Kind = 'command' | 'keyword' | 'value' | 'variable' | 'param';

export interface Candidate {
  label: string;
  insert: string;
  kind: Kind;
  detail?: string;
}

export interface Scene {
  positions: string[];
  rotations: string[];
  handles: string[];
  names: string[];
  tags: string[];
  objectives: string[];
  chains: string[];
  /** Structure names known to the script or the structure library, without the default namespace. */
  structures: string[];
  entities: string[];
  blocks: string[];
  items: string[];
  /** How often each word occurs in the document; used to rank candidates. */
  freq: Map<string, number>;
  /** How often the user accepted each candidate before (kept between sessions). */
  history?: Record<string, number>;
}

export interface Completion {
  from: number;
  to: number;
  items: Candidate[];
}

const uniq = <T,>(xs: T[]) => [...new Set(xs)];
const strip = (id: string) => id.replace(/^minecraft:/, '');

export function sceneFrom(text: string, program: Program, structures: string[] = []): Scene {
  const all = (re: RegExp, group = 1) => [...text.matchAll(re)].map((m) => m[group]);
  const freq = new Map<string, number>();
  for (const w of text.match(/[\w:.@~^${}-]+/g) ?? []) freq.set(w, (freq.get(w) ?? 0) + 1);
  return {
    positions: uniq(all(/^\s*(\w+)\s*=\s*\(\s*[^()]*,[^()]*,[^()]*\)/gm)),
    rotations: uniq(all(/^\s*(\w+)\s*=\s*(?:rot\(|\(\s*[^(),]*,[^(),]*\)\s*(?:#.*)?$)/gm)),
    handles: uniq(all(/^\s*(\w+)\s*=\s*ent\(/gm)),
    names: uniq(program.entities.flatMap((e) => (e.name ? [e.name] : []))),
    tags: uniq([...program.entities.flatMap((e) => e.tags), ...all(/\btag\s+\S+\s+add\s+([\w:.-]+)/g), ...all(/\btag=([\w:.-]+)/g)]),
    objectives: uniq(all(/scoreboard\s+objectives\s+add\s+([\w.-]+)/g)),
    chains: program.chains.map((c) => c.name),
    structures: uniq([...structures, ...all(/\bstructure\s+save\s+(\S+)/g)].map(shortStructureName)),
    entities: uniq(program.entities.map((e) => strip(e.type))),
    blocks: uniq(program.blocks.map((b) => strip(b.type))),
    items: uniq(program.items.map((i) => strip(i.item.id))),
    freq,
  };
}

export const KEYS: Record<string, string[]> = {
  ent: ['type', 'pos', 'name', 'rot', 'tags', 'selected'],
  block: ['type', 'pos', 'states', 'nbt'],
  item: ['target', 'slot', 'index', 'type', 'count', 'data', 'comp'],
  region: ['from', 'to'],
  fill: ['type', 'from', 'to', 'states'],
  cb: ['mode', 'conditional', 'power', 'delay', 'first_tick', 'facing'],
  chain: ['pos', 'facing', 'rot'],
  world: ['time', 'weather', 'difficulty', 'spawn', 'seed'],
};
const CANON: Record<string, string> = { position: 'pos', rotation: 'rot', components: 'comp' };
const DIRS = ['up', 'down', 'north', 'south', 'east', 'west'];
const TOP_LEVEL = ['ent(', 'block(', 'fill(', 'item(', 'region(', 'world(', 'chain ', 'cb(', 'test '];
const SELECTOR_KEYS = ['name', 'type', 'tag', 'family', 'x', 'y', 'z', 'r', 'rm', 'dx', 'dy', 'dz', 'c', 'scores', 'hasitem', 'haspermission', 'l', 'lm', 'm', 'rx', 'rxm', 'ry', 'rym'];

const c = (label: string, kind: Kind, detail?: string, insert = label): Candidate => ({ label, insert, kind, detail });

/** The text from the start of the token that ends at the end of `s` (tokens split on whitespace outside brackets and quotes). */
export function lastToken(s: string): { start: number; depth: number } {
  let start = 0;
  let depth = 0;
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"') quoted = !quoted;
    else if (!quoted) {
      if ('([{'.includes(ch)) depth++;
      else if (')]}'.includes(ch)) depth = Math.max(0, depth - 1);
      else if (/\s/.test(ch) && depth === 0) start = i + 1;
    }
  }
  return { start, depth: quoted ? depth + 1 : depth };
}

const continues = (line: string) => stripComment(line).trimEnd().endsWith('\\');

export function logicalPrefix(text: string, cursor: number): { prefix: string; curLineStart: number } {
  const lineStart = text.lastIndexOf('\n', cursor - 1) + 1;
  let prefix = text.slice(lineStart, cursor);
  let ls = lineStart;
  while (ls > 0) {
    const prevStart = text.lastIndexOf('\n', ls - 2) + 1;
    const prev = text.slice(prevStart, ls - 1);
    if (!continues(prev)) break;
    prefix = `${stripComment(prev).trimEnd().slice(0, -1).trimEnd()} ${prefix.trimStart()}`;
    ls = prevStart;
  }
  return { prefix, curLineStart: lineStart };
}

function selectorCandidates(partial: string, scene: Scene): { cut: number; items: Candidate[] } | null {
  if (/^@[a-z]?$/.test(partial)) return { cut: partial.length, items: ['@a', '@e', '@p', '@r', '@s', '@n'].map((s) => c(s, 'value', 'selector')) };
  const open = partial.indexOf('[');
  if (!partial.startsWith('@') || open < 0) return null;
  const inner = partial.slice(open + 1);
  if (inner.includes(']')) return null;
  const piece = inner.slice(inner.lastIndexOf(',') + 1).trimStart();
  const eq = piece.indexOf('=');
  if (eq < 0) return { cut: piece.length, items: SELECTOR_KEYS.map((k) => c(`${k}=`, 'param', 'selector argument')) };
  const key = piece.slice(0, eq).replace(/^!/, '');
  const value = piece.slice(eq + 1);
  const vals: Record<string, Candidate[]> = {
    type: uniq([...scene.entities, ...ENTITY_TYPES]).map((v) => c(v, 'value')),
    tag: scene.tags.map((v) => c(v, 'value', 'tag in this script')),
    name: scene.names.map((v) => c(v, 'value', 'name in this script')),
    hasitem: [c('{item=', 'param', 'inventory filter')],
    family: ['monster', 'mob', 'undead', 'arthropod', 'inanimate', 'player'].map((v) => c(v, 'value', 'family')),
    m: ['survival', 'creative', 'adventure', 'spectator'].map((v) => c(v, 'value', 'game mode')),
    scores: [c('{', 'param', 'name=range')],
    haspermission: [c('{movement=', 'param', 'permission=state')],
  };
  return { cut: value.length, items: vals[key] ?? [] };
}

function leafCandidates(leaf: Leaf, scene: Scene): Candidate[] {
  if (leaf.k === 'lit') return [c(leaf.v, 'keyword')];
  if (leaf.k === 'rest') return [];
  if (leaf.k === 'kw') {
    if (Array.isArray(leaf.values)) return leaf.values.map((v) => c(v, 'keyword'));
    switch (leaf.values) {
      case 'effects': return [...EFFECTS].map((v) => c(v, 'value', 'effect'));
      case 'gamerules': return Object.keys(GAMERULE_DEFAULTS).map((v) => c(v, 'value', 'game rule'));
      case 'enchants': return [...ENCHANTS].map((v) => c(v, 'value', 'enchantment'));
      case 'permissions': return [...INPUT_PERMISSIONS].map((v) => c(v, 'value', 'input permission'));
      case 'gamemodes': return GAME_MODES.map((v) => c(v, 'value', 'game mode'));
      case 'particles': return PARTICLES.map((v) => c(v, 'value', 'particle'));
      default: return [];
    }
  }
  switch (leaf.t) {
    case 'target':
      return [...['@s', '@a', '@e', '@p', '@r', '@n'].map((s) => c(s, 'value', 'selector')), ...scene.names.map((n) => c(n, 'value', 'entity name'))];
    case 'coord':
      return [c('~', 'value', 'relative'), c('^', 'value', 'local'), ...(leaf.name.endsWith(' x') ? scene.positions.map((p) => c(`\${${p}}`, 'variable', 'position (three coordinates)')) : [])];
    case 'coord3':
      return [...scene.positions.map((p) => c(`\${${p}}`, 'variable', 'position (three coordinates)')), c('~', 'value', 'relative'), c('^', 'value', 'local'), c('~~~', 'value')];
    case 'rotvalue':
      return [c('~', 'value', 'relative'), ...(leaf.name === 'yRot' ? scene.rotations.map((r) => c(`\${${r}}`, 'variable', 'rotation (two values)')) : [])];
    case 'rotpair':
      return scene.rotations.map((r) => c(`\${${r}}`, 'variable', 'rotation (two values)'));
    case 'entity':
      return uniq([...scene.entities, ...ENTITY_TYPES]).map((v) => c(v, 'value', 'entity type'));
    case 'block':
      return uniq([...scene.blocks, ...COMMON_BLOCKS]).map((v) => c(v, 'value', 'block'));
    case 'item':
      return uniq([...scene.items, ...COMMON_ITEMS]).map((v) => c(v, 'value', 'item'));
    case 'tag':
      return scene.tags.map((v) => c(v, 'value', 'tag in this script'));
    case 'objective':
      return scene.objectives.map((v) => c(v, 'value', 'objective in this script'));
    case 'word':
      if (leaf.name === 'chain') return scene.chains.map((v) => c(v, 'value', 'chain in this script'));
      if (leaf.name === 'structure') return scene.structures.map((v) => c(v, 'value', 'structure'));
      return leaf.name === 'slot' ? SLOT_NAMES().map((v) => c(v, 'value', 'slot')) : [];
    case 'bool':
      return ['true', 'false'].map((v) => c(v, 'keyword'));
    default:
      return [];
  }
}

function declCandidates(head: string, partialOffset: number, scene: Scene, cursor: number): Completion | null {
  const m = /^(?:\w+\s*=\s*)?(ent|block|fill|item|region|cb|world)\s*\(|^chain\s+\w+\s*\(/.exec(head);
  if (!m) return null;
  const decl = m[1] ?? 'chain';
  const inner = head.slice(m[0].length);
  const segs = splitTop(inner, (ch) => ch === ',').map((t) => t.text);
  const closed = inner.includes(')') && lastToken(inner).depth === 0 && /\)\s*:?\s*$/.test(inner);
  if (closed) return null;
  const parts = inner.length ? segs : [''];
  const last = parts[parts.length - 1] ?? '';
  const used = new Set(parts.slice(0, -1).map((s) => s.split('=')[0].trim()).map((k) => CANON[k] ?? k));
  const piece = last.trimStart();
  const eq = piece.indexOf('=');
  const to = cursor;
  if (eq < 0) {
    if (/[([{]/.test(piece)) return null;
    return {
      from: cursor - piece.length,
      to,
      items: (KEYS[decl] ?? []).filter((k) => !used.has(k)).map((k) => c(`${k}=`, 'param', `${decl} argument`)),
    };
  }
  const key = CANON[piece.slice(0, eq).trim()] ?? piece.slice(0, eq).trim();
  const value = piece.slice(eq + 1).trimStart();
  if (/[([{"]/.test(value) && !value.startsWith('(')) return null;
  const idLeaf = (t: 'entity' | 'block' | 'item'): Candidate[] => leafCandidates({ k: 'val', t, name: 'type' }, scene);
  const by: Record<string, Candidate[]> = {
    type: decl === 'ent' ? idLeaf('entity') : decl === 'block' || decl === 'fill' ? idLeaf('block') : decl === 'item' ? idLeaf('item') : [],
    pos: [...scene.positions.map((p) => c(p, 'variable', 'position')), c('(', 'value', 'x, y, z')],
    from: scene.positions.map((p) => c(p, 'variable', 'position')),
    to: scene.positions.map((p) => c(p, 'variable', 'position')),
    rot: [...scene.rotations.map((r) => c(r, 'variable', 'rotation')), c('rot(', 'value', 'rot(yrot, xrot)')],
    target: [...scene.handles.map((h) => c(h, 'variable', 'entity handle')), ...scene.positions.map((p) => c(p, 'variable', 'position'))],
    slot: SLOT_NAMES().map((v) => c(v, 'value', 'slot')),
    mode: ['imp', 'cha', 'rep'].map((v) => c(v, 'keyword', 'impulse / chain / repeating')),
    conditional: ['true', 'false'].map((v) => c(v, 'keyword')),
    power: ['needs_redstone', 'always_on'].map((v) => c(v, 'keyword')),
    facing: DIRS.map((v) => c(v, 'keyword')),
    time: ['day', 'noon', 'sunset', 'night', 'midnight', 'sunrise'].map((v) => c(v, 'keyword')),
    weather: ['clear', 'rain', 'thunder'].map((v) => c(v, 'keyword')),
    difficulty: ['peaceful', 'easy', 'normal', 'hard'].map((v) => c(v, 'keyword')),
    spawn: scene.positions.map((p) => c(p, 'variable', 'position')),
  };
  void partialOffset;
  return { from: cursor - value.length, to, items: by[key] ?? [] };
}

function rank(items: Candidate[], partial: string, scene: Scene): Candidate[] {
  const p = partial.toLowerCase();
  const seen = new Set<string>();
  const scored: { cand: Candidate; tier: number; order: number }[] = [];
  items.forEach((cand, order) => {
    if (seen.has(cand.label)) return;
    seen.add(cand.label);
    const l = cand.label.toLowerCase();
    let tier = -1;
    if (l.startsWith(p)) tier = 0;
    else if (l.includes(p)) tier = 1;
    else if (p.length >= 3) {
      let k = 0;
      for (const ch of l) if (ch === p[k]) k++;
      if (k === p.length) tier = 2;
    }
    if (tier >= 0) scored.push({ cand, tier, order });
  });
  const f = (x: Candidate) => (scene.freq.get(x.label) ?? 0) + 2 * (scene.history?.[x.label] ?? 0);
  scored.sort((a, b) => a.tier - b.tier || f(b.cand) - f(a.cand) || a.order - b.order);
  return scored.slice(0, 12).map((s) => s.cand);
}

/** True when the line at lineStart sits inside a 	est name: block. */
function inTestBlock(text: string, lineStart: number): boolean {
  const lines = text.slice(0, lineStart).split('\n');
  lines.pop();
  for (let i = lines.length - 1; i >= 0; i--) {
    const code = stripComment(lines[i]).trim();
    if (code === '' || /^\s/.test(lines[i])) continue;
    return /^test\s+[\w.-]+\s*:$/.test(code);
  }
  return false;
}

export function complete(text: string, cursor: number, scene: Scene): Completion {
  const none: Completion = { from: cursor, to: cursor, items: [] };
  const { prefix, curLineStart } = logicalPrefix(text, cursor);
  const curLine = text.slice(curLineStart, cursor);
  if (stripComment(curLine).length < curLine.length) return none;
  const head = prefix.trimStart();
  const tok = lastToken(prefix);
  const partial = prefix.slice(tok.start);
  const finish = (from: number, items: Candidate[], part: string, space = false): Completion => ({
    from,
    to: cursor,
    items: rank(items, part, scene).map((x) =>
      space && x.kind !== 'param' && x.detail !== 'selector' && !/[=[{(]$/.test(x.label) ? { ...x, insert: `${x.insert} ` } : x,
    ),
  });

  if (head.startsWith('/')) {
    if (partial.includes('"') && !partial.startsWith('"')) return none;
    const before = head.slice(0, head.length - partial.length).replace(/^\//, '');
    const words = splitTop(before, (ch) => /\s/.test(ch)).map((t) => t.text);
    const partialClean = head.length === partial.length ? partial.replace(/^\//, '') : partial;
    const from = cursor - partialClean.length;
    if (!words.length) {
      const impl = Object.keys(COMMANDS).map((n) => c(n, 'command'));
      const rest = [...KNOWN_COMMANDS].filter((n) => !(n in COMMANDS)).map((n) => c(n, 'command', 'not implemented'));
      return finish(from, [...impl, ...rest], partialClean, true);
    }
    if (!grammarOf(words[0])) return none;
    const { expected } = matchCommand(words);
    const sel = partialClean.startsWith('@') && expected.some((l) => l.k === 'val' && l.t === 'target') ? selectorCandidates(partialClean, scene) : null;
    if (sel) return finish(cursor - sel.cut, sel.items, partialClean.slice(partialClean.length - sel.cut));
    return finish(from, expected.flatMap((l) => leafCandidates(l, scene)), partialClean, true);
  }

  const decl = declCandidates(head, 0, scene, cursor);
  if (decl) return { ...decl, items: rank(decl.items, text.slice(decl.from, cursor), scene) };

  if (/^\s/.test(curLine) && inTestBlock(text, curLineStart)) {
    const before = head.slice(0, head.length - partial.length);
    const words = splitTop(before, (ch) => /\s/.test(ch)).map((t) => t.text);
    const { expected } = matchTest(words);
    const sel = partial.startsWith('@') && expected.some((l) => l.k === 'val' && l.t === 'target') ? selectorCandidates(partial, scene) : null;
    if (sel) return finish(cursor - sel.cut, sel.items, partial.slice(partial.length - sel.cut));
    return finish(cursor - partial.length, expected.flatMap((l) => leafCandidates(l, scene)), partial, true);
  }

  if (/^\w+\s*=\s*\w*$/.test(head)) {
    const part = /\w*$/.exec(head)![0];
    return finish(cursor - part.length, [c('ent(', 'keyword', 'entity'), c('rot(', 'keyword', 'rotation')], part);
  }
  if (head.length === partial.length && /^\w*$/.test(partial)) {
    return finish(cursor - partial.length, TOP_LEVEL.map((k) => c(k, 'keyword')), partial);
  }
  return none;
}