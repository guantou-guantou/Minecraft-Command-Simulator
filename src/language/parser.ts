import {
  DEFAULT_REGION,
  DIRS,
  DIR_VEC,
  type BlockStates,
  type CbMode,
  type CbPower,
  type Chain,
  type CommandBlockSpec,
  type Dir,
  type Program,
  type WorldDecl,
  type Vec3,
} from './types.ts';
import { parseSnbt } from '../nbt/snbt.ts';
import { logicalLines, stripComment } from './lines.ts';
import { extractFunctions } from './functions.ts';
import { expandGates, type Entry } from './gates.ts';
import { extractTests } from './testdsl.ts';
import { TIME_NAMES } from '../engine/clock.ts';
import { MAX_ITEM_COUNT, containerProblem, entitySlotKey, maxStack, slotKey, slotProblem, type Item } from './items.ts';

const IDENT = /^[A-Za-z_]\w*$/;
const MODES: CbMode[] = ['imp', 'cha', 'rep'];
const POWERS: CbPower[] = ['needs_redstone', 'always_on'];
type Rot = [number, number];

export interface Token {
  text: string;
  start: number;
}

export { stripComment };

export function normalizeId(id: string): string {
  return id.includes(':') ? id : `minecraft:${id}`;
}

export function unquote(s: string): string {
  return s.length >= 2 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s;
}

export function splitTop(s: string, isSep: (c: string) => boolean): Token[] {
  const out: Token[] = [];
  let depth = 0;
  let quoted = false;
  let start = -1;
  for (let i = 0; i <= s.length; i++) {
    const c = i < s.length ? s[i] : '';
    if (i === s.length || (!quoted && depth === 0 && isSep(c))) {
      if (start >= 0) out.push({ text: s.slice(start, i), start });
      start = -1;
      continue;
    }
    if (start < 0) start = i;
    if (c === '"') quoted = !quoted;
    else if (!quoted) {
      if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) depth = Math.max(0, depth - 1);
    }
  }
  return out;
}

/** Short names accepted for scene arguments. */
export const ARG_ALIASES: Record<string, string> = { pos: 'position', rot: 'rotation', comp: 'components' };

export function parseArgs(s: string): Record<string, string> {
  const args: Record<string, string> = {};
  for (const item of splitTop(s, (c) => c === ',')) {
    const eq = item.text.indexOf('=');
    if (eq < 0) throw new Error(`Expected key=value, got "${item.text.trim()}"`);
    const written = item.text.slice(0, eq).trim();
    if (!IDENT.test(written)) throw new Error(`Invalid argument name "${written}"`);
    const key = ARG_ALIASES[written] ?? written;
    if (key in args) throw new Error(key === written ? `Duplicate argument "${key}"` : `Argument "${key}" is given twice (as "${written}" and in full)`);
    args[key] = unquote(item.text.slice(eq + 1).trim());
  }
  return args;
}

export function parseStates(text: string): BlockStates {
  const t = text.trim();
  const m = /^\[(.*)\]$/s.exec(t);
  if (!m) throw new Error(`Expected block states like ["name"=value], got "${t}"`);
  const out: BlockStates = {};
  for (const item of splitTop(m[1], (c) => c === ',')) {
    const eq = item.text.indexOf('=');
    if (eq < 0) throw new Error(`Expected "name"=value in block states, got "${item.text.trim()}"`);
    const key = unquote(item.text.slice(0, eq).trim());
    if (!key) throw new Error('Empty block state name');
    if (key in out) throw new Error(`Duplicate block state "${key}"`);
    const raw = item.text.slice(eq + 1).trim();
    if (raw === 'true' || raw === 'false') out[key] = raw === 'true';
    else if (/^-?\d+$/.test(raw)) out[key] = Number(raw);
    else if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) out[key] = raw.slice(1, -1);
    else throw new Error(`Block state "${key}" needs true, false, an integer or a "quoted string"`);
  }
  return out;
}

function parseList(text: string, what: string): string[] {
  const m = /^\[(.*)\]$/s.exec(text.trim());
  if (!m) throw new Error(`${what} must be a list like ["a", "b"]`);
  return splitTop(m[1], (c) => c === ',').map((t) => unquote(t.text.trim()));
}

function parseTuple(text: string, n?: number): number[] | null {
  const m = /^\((.*)\)$/.exec(text.trim());
  if (!m) return null;
  const parts = splitTop(m[1], (c) => c === ',').map((p) => p.text.trim());
  const nums = parts.map(Number);
  if ((n !== undefined && parts.length !== n) || parts.some((p, i) => p === '' || !Number.isFinite(nums[i]))) {
    throw new Error(`Expected ${n ?? 'a list of'} comma-separated numbers in parentheses, got "${text.trim()}"`);
  }
  return nums;
}

/** The written texts of the numbers in `(a, b, c)`, so `1` and `1.0` can be told apart. */
function tupleParts(text: string): string[] | null {
  const m = /^\((.*)\)$/.exec(text.trim());
  return m ? splitTop(m[1], (c) => c === ',').map((p) => p.text.trim()) : null;
}

function checkRot(r: number[], text: string): Rot {
  if (r[1] < -90 || r[1] > 90) throw new Error(`Pitch (xrot) must be between -90 and 90, got ${r[1]} in "${text.trim()}"`);
  return [r[0], r[1]];
}

interface Scope {
  vars: Map<string, Vec3>;
  /** How each coordinate of a position variable was written. */
  texts: Map<string, string[]>;
  rots: Map<string, Rot>;
  handles: Set<string>;
}

function resolveVec(text: string, s: Scope): Vec3 {
  const t = parseTuple(text, 3);
  if (t) return t as Vec3;
  const name = text.trim();
  const v = s.vars.get(name);
  if (!v) throw new Error(s.rots.has(name) ? `"${name}" is a rotation, expected a position` : `Unknown position variable "${name}"`);
  return [...v];
}

/** Position of an entity: like in the game, an x or z written without a decimal point is the centre of that block. */
function resolveEntityPos(text: string, s: Scope): Vec3 {
  const pos = resolveVec(text, s);
  const parts = tupleParts(text) ?? s.texts.get(text.trim()) ?? [];
  return pos.map((v, i) => (i !== 1 && parts[i] !== undefined && !parts[i].includes('.') ? v + 0.5 : v)) as Vec3;
}

const VAR_REF = /\$\{\s*([A-Za-z_]\w*)(?:\.(x|y|z|yrot|xrot))?\s*\}/g;
const PARTS: Record<string, number> = { x: 0, y: 1, z: 2, yrot: 0, xrot: 1 };

export function expandVars(command: string, vars: Map<string, Vec3>, rots: Map<string, Rot>, texts: Map<string, string[]> = new Map()): string {
  return command.replace(VAR_REF, (ref, name: string, part?: string) => {
    const v: number[] | undefined = vars.get(name) ?? rots.get(name);
    if (!v) throw new Error(`Unknown variable "${name}" in ${ref}`);
    const raw = vars.has(name) ? texts.get(name) : undefined;
    if (!part) return (raw ?? v).join(' ');
    const isPos = v.length === 3;
    if (isPos !== ['x', 'y', 'z'].includes(part)) {
      throw new Error(`${ref}: ".${part}" does not apply to a ${isPos ? 'position (use .x .y .z)' : 'rotation (use .yrot .xrot)'}`);
    }
    return raw?.[PARTS[part]] ?? String(v[PARTS[part]]);
  });
}

function resolveRot(text: string, s: Scope): Rot {
  const call = /^rot\s*(\(.*\))$/.exec(text.trim());
  const t = parseTuple(call ? call[1] : text, 2);
  if (t) return checkRot(t, text);
  const name = text.trim();
  const r = s.rots.get(name);
  if (!r) throw new Error(s.vars.has(name) ? `"${name}" is a position, expected a rotation` : `Unknown rotation variable "${name}"`);
  return [...r];
}

function parseDir(text: string, what: string): Dir {
  if (!DIRS.includes(text as Dir)) throw new Error(`${what}: facing must be one of ${DIRS.join(', ')}`);
  return text as Dir;
}

function intArg(text: string, what: string): number {
  if (!/^-?\d+$/.test(text.trim()) || !Number.isSafeInteger(Number(text))) throw new Error(`${what} must be an integer, got "${text}"`);
  return Number(text);
}

function required(args: Record<string, string>, key: string, what: string): string {
  if (!(key in args)) throw new Error(`${what} requires ${key}=...`);
  return args[key];
}

function checkKeys(args: Record<string, string>, allowed: string[], what: string): void {
  for (const k of Object.keys(args)) {
    if (!allowed.includes(k)) throw new Error(`${what}: unknown argument "${k}"`);
  }
}

function parseCb(args: Record<string, string>): { spec: Partial<CommandBlockSpec>; facing: Dir | null } {
  if ('type' in args) throw new Error('cb(type=...) is not supported; use mode=imp|cha|rep');
  checkKeys(args, ['mode', 'conditional', 'power', 'delay', 'first_tick', 'facing'], 'cb');
  const spec: Partial<CommandBlockSpec> = {};
  if ('mode' in args) {
    if (!MODES.includes(args.mode as CbMode)) throw new Error(`cb: mode must be one of ${MODES.join(', ')}`);
    spec.mode = args.mode as CbMode;
  }
  if ('conditional' in args) {
    if (args.conditional !== 'true' && args.conditional !== 'false') throw new Error('cb: conditional must be true or false');
    spec.conditional = args.conditional === 'true';
  }
  if ('power' in args) {
    if (!POWERS.includes(args.power as CbPower)) throw new Error(`cb: power must be one of ${POWERS.join(', ')}`);
    spec.power = args.power as CbPower;
  }
  if ('first_tick' in args) {
    if (args.first_tick !== 'true' && args.first_tick !== 'false') throw new Error('cb: first_tick must be true or false');
    spec.firstTick = args.first_tick === 'true';
  }
  if ('delay' in args) {
    const d = Number(args.delay);
    if (!/^\d+$/.test(args.delay) || !Number.isSafeInteger(d)) throw new Error('cb: delay must be a non-negative integer');
    spec.delay = d;
  }
  return { spec, facing: 'facing' in args ? parseDir(args.facing, 'cb') : null };
}

const key3 = (p: Vec3) => p.join(',');
const inRegion = (p: Vec3, r: { min: Vec3; max: Vec3 }) => p.every((v, i) => v >= r.min[i] && v <= r.max[i]);

function validateLayout(prog: Program, diag: (line: number, message: string) => void): void {
  const region = prog.region ?? DEFAULT_REGION;
  const taken = new Map<string, string>();
  for (const b of prog.blocks) {
    if (!inRegion(b.position, region)) diag(b.line, `block(...) at (${b.position.join(', ')}) is outside the simulated region`);
    taken.set(key3(b.position), `block(...) declared on line ${b.line}`);
  }
  for (const f of prog.fills) {
    if (!inRegion(f.from, region) || !inRegion(f.to, region)) diag(f.line, `fill(...) from (${f.from.join(', ')}) to (${f.to.join(', ')}) is outside the simulated region`);
  }
  for (const c of prog.chains) {
    for (const n of c.nodes) {
      if (!n.pos) continue;
      const fill = prog.fills.find((f) => n.pos!.every((v, i) => v >= f.from[i] && v <= f.to[i]));
      if (fill) diag(n.line, `Command block at (${n.pos.join(', ')}) is inside the fill(...) on line ${fill.line}`);
      if (!inRegion(n.pos, region)) diag(n.line, `Command block at (${n.pos.join(', ')}) is outside the simulated region`);
      const other = taken.get(key3(n.pos));
      if (other) diag(n.line, `Command block at (${n.pos.join(', ')}) overlaps ${other}`);
      else taken.set(key3(n.pos), `a command block of chain "${c.name}" (line ${n.line})`);
    }
  }
}

/** Fills in the <<tpl:chain>> and <<gap:chain>> coordinates that chains with if:/run: parts leave for later, once every position is known. */
function resolvePlaceholders(prog: Program, diag: (line: number, message: string) => void): void {
  for (const c of prog.chains) {
    for (const n of c.nodes) {
      if (!n.command.includes('<<')) continue;
      n.command = n.command.replace(/<<(tpl|gap):(\w+)>>/g, (all, kind: string, name: string) => {
        const ref = prog.chains.find((x) => x.name === name);
        const p = kind === 'tpl' ? ref?.nodes[0]?.pos : ref?.gapAt;
        if (!p) {
          diag(n.line, `cannot place ${all}`);
          return all;
        }
        return p.join(' ');
      });
    }
    if (!c.gapAt) continue;
    const gap = c.gapAt;
    const hit = prog.chains.find((o) => o.nodes.some((n) => n.pos && key3(n.pos) === key3(gap)));
    const block = prog.blocks.find((b) => key3(b.position) === key3(gap));
    if (hit || block) diag(c.line, `The gap cell (${gap.join(', ')}) in front of chain "${c.name}" must stay empty, but it is used by ${hit ? `chain "${hit.name}"` : `a block(...)`}`);
  }
}

export function parse(input: string): Program {
  const fx = extractFunctions(input);
  const extracted = extractTests(fx.source);
  const source = extracted.source;
  const scope: Scope = { vars: new Map(), texts: new Map(), rots: new Map(), handles: new Set() };
  const { vars, rots, handles } = scope;
  const prog: Program = { entities: [], blocks: [], fills: [], items: [], region: null, world: null, chains: [], diagnostics: [...fx.diagnostics, ...extracted.diagnostics], tests: extracted.tests, functions: fx.functions };
  const itemSlots = new Map<string, number>();
  let current: Chain | null = null;
  /** The last chain ...: header; indented commands belong to it. */
  let headerChain: Chain | null = null;
  let pending: { spec: Partial<CommandBlockSpec>; facing: Dir | null; line: number; owner: 'header' | 'main' } | null = null;
  let lineIndented = false;
  const physical = source.split('\n');
  const hinted = new Set<string>();

  /** Unindented commands run in one implicit chain called main; indented ones belong to the last chain header. */
  const chainFor = (owner: 'header' | 'main'): Chain => {
    if (owner === 'header' && headerChain) return headerChain;
    let m = prog.chains.find((c) => c.name === 'main');
    if (!m) {
      m = { name: 'main', line: 0, position: [0, 0, 0], positioned: false, facing: 'east', rotation: [0, 0], nodes: [] };
      prog.chains.push(m);
    }
    return m;
  };
  const ownerOf = (): 'header' | 'main' => (lineIndented && headerChain ? 'header' : 'main');

  const diag = (line: number, message: string) => prog.diagnostics.push({ line, message });
  const flushPending = () => {
    if (pending) diag(pending.line, 'cb(...) is not followed by a command');
    pending = null;
  };
  const claim = (name: string) => {
    if (handles.has(name) || vars.has(name) || rots.has(name)) throw new Error(`"${name}" is already defined`);
  };

  const declareEntity = (line: number, argText: string, handle: string | null) => {
    const args = parseArgs(argText);
    checkKeys(args, ['type', 'position', 'name', 'rotation', 'tags', 'selected'], 'ent');
    if (handle) claim(handle);
    const type = normalizeId(required(args, 'type', 'ent'));
    const selected = args.selected !== undefined ? intArg(args.selected, 'ent: selected') : 0;
    if (selected < 0 || selected > 8) throw new Error('ent: selected must be a hotbar slot from 0 to 8');
    if (args.selected !== undefined && type !== 'minecraft:player') throw new Error('ent: selected only applies to players');
    prog.entities.push({
      line,
      handle,
      type,
      position: resolveEntityPos(required(args, 'position', 'ent'), scope),
      name: args.name ?? null,
      rotation: args.rotation ? resolveRot(args.rotation, scope) : [0, 0],
      tags: args.tags ? parseList(args.tags, 'ent: tags') : [],
      selected,
    });
    if (handle) handles.add(handle);
  };

  const entries: Entry[] = [];
  for (const logical of logicalLines(source)) {
    const text = stripComment(logical.text).trim();
    if (text) entries.push({ line: logical.line, text, indent: (/^\s*/.exec(physical[logical.physical] ?? '') ?? [''])[0].length });
  }
  const gx = expandGates(entries);
  prog.diagnostics.push(...gx.diagnostics);
  const gateChains = new Set<Chain>();
  const fromGap = new Set<Chain>();

  gx.entries.forEach((entry) => {
    const line = entry.line;
    const text = entry.text;
    lineIndented = entry.indent > 0;
    try {
      if (text.startsWith('/') || text === 'pass') {
        let command = text === 'pass' ? '' : text.slice(1).trim();
        if (text !== 'pass' && !command) throw new Error('Empty command');
        try {
          if (command) command = expandVars(command, vars, rots, scope.texts);
        } catch (e) {
          pending = null;
          throw e;
        }
        const owner = ownerOf();
        if (pending && pending.owner !== owner) flushPending();
        current = chainFor(owner);
        if (owner === 'main' && headerChain && headerChain.nodes.length === 0 && !hinted.has(headerChain.name)) {
          hinted.add(headerChain.name);
          diag(line, `this command is not indented, so it is not part of chain "${headerChain.name}" (it runs in main); indent it to put it in the chain`);
        }
        const prev: Chain['nodes'][number] | undefined = current.nodes[current.nodes.length - 1];
        const first = !prev;
        const gate = first && gateChains.has(current);
        const mode: CbMode = pending?.spec.mode ?? (first ? (gate ? 'rep' : fromGap.has(current) ? 'cha' : 'imp') : 'cha');
        const cb: CommandBlockSpec = {
          mode,
          conditional: false,
          power: mode === 'cha' || (gate && mode === 'rep') ? 'always_on' : 'needs_redstone',
          delay: 0,
          ...pending?.spec,
        };
        const facing: Dir = pending?.facing ?? prev?.facing ?? current.facing;
        const pos: Vec3 | null = !current.positioned
          ? null
          : prev?.pos
            ? (prev.pos.map((v, i) => v + DIR_VEC[prev.facing][i]) as Vec3)
            : [...current.position];
        pending = null;
        if (first && cb.conditional) diag(line, 'The first command block of a chain cannot be conditional');
        if (!first && cb.mode !== 'cha') diag(line, 'Only the first block of a chain can use mode=imp or mode=rep');
        current.nodes.push({ line, command, cb, facing, pos });
        return;
      }

      const header = /^chain\s+(\w+)(?:\s+at\s+(.+?)|\s*\((.*)\))?\s*:$/.exec(text);
      if (header) {
        flushPending();
        const name = header[1];
        if (!IDENT.test(name)) throw new Error(`Invalid chain name "${name}"`);
        if (prog.chains.some((c) => c.name === name)) throw new Error(`Duplicate chain "${name}"`);
        let position: Vec3 | null = header[2] ? resolveVec(header[2], scope) : null;
        let facing: Dir = 'east';
        let rotation: Rot = [0, 0];
        let gapAt: Vec3 | undefined;
        let followed = false;
        if (header[3] !== undefined) {
          const args = parseArgs(header[3]);
          checkKeys(args, ['position', 'facing', 'rotation', 'after', 'beside', 'gap'], 'chain');
          if (args.position) position = resolveVec(args.position, scope);
          if (args.after || args.beside || args.gap) {
            if (args.after && args.beside) throw new Error('chain: after= and beside= cannot be combined');
            if (!args.after && !args.beside) throw new Error('chain: gap= needs after=');
            if (args.gap && !args.after) throw new Error('chain: gap= only goes with after=');
            if (args.position || args.facing) throw new Error('chain: after= and beside= place the chain themselves, so position= and facing= are not allowed');
            const refName = (args.after ?? args.beside)!;
            const ref = prog.chains.find((c) => c.name === refName);
            if (!ref) throw new Error(`chain: unknown chain "${refName}" in after=/beside= (it must be written before this chain)`);
            const first = ref.nodes[0];
            const last = ref.nodes[ref.nodes.length - 1];
            if (!ref.positioned || !first?.pos || !last?.pos) throw new Error(`chain: "${refName}" must be a chain with a position and at least one command block`);
            const step = DIR_VEC[last.facing];
            facing = last.facing;
            rotation = [...ref.rotation];
            if (args.after) {
              const gap = args.gap !== undefined ? intArg(args.gap, 'chain: gap') : 1;
              if (gap < 0) throw new Error('chain: gap cannot be negative');
              position = last.pos.map((v, i) => v + step[i] * (gap + 1)) as Vec3;
              gapAt = last.pos.map((v, i) => v + step[i]) as Vec3;
            } else {
              const side = last.facing === 'up' || last.facing === 'down' ? [1, 0, 0] : [0, 1, 0];
              position = first.pos.map((v, i) => v + side[i]) as Vec3;
            }
            followed = true;
          }
          if (args.facing) {
            if (!args.position) throw new Error('chain: facing requires position=...');
            facing = parseDir(args.facing, 'chain');
          }
          if (args.rotation) rotation = resolveRot(args.rotation, scope);
        }
        current = {
          name, line, position: position ? (position.map(Math.floor) as Vec3) : [0, 0, 0],
          positioned: !!position, facing, rotation, nodes: [], ...(gapAt ? { gapAt } : {}),
        };
        prog.chains.push(current);
        if (entry.gate) gateChains.add(current);
        if (followed) fromGap.add(current);
        headerChain = current;
        return;
      }

      const entAssign = /^([A-Za-z_]\w*)\s*=\s*ent\s*\((.*)\)$/.exec(text);
      if (entAssign) {
        declareEntity(line, entAssign[2], entAssign[1]);
        return;
      }

      const assign = /^([A-Za-z_]\w*)\s*=\s*(.+)$/.exec(text);
      if (assign) {
        const name = assign[1];
        if (handles.has(name)) throw new Error(`"${name}" is already an entity handle`);
        const value = assign[2].trim();
        const rotCall = /^rot\s*(\(.*\))$/.exec(value);
        const v = parseTuple(rotCall ? rotCall[1] : value, rotCall ? 2 : undefined);
        if (!v) throw new Error('Expected a position (x, y, z) or a rotation rot(yrot, xrot)');
        if (v.length === 3) {
          vars.set(name, v as Vec3);
          scope.texts.set(name, tupleParts(value) ?? []);
          rots.delete(name);
        } else if (v.length === 2) {
          rots.set(name, checkRot(v, value));
          vars.delete(name);
          scope.texts.delete(name);
        } else throw new Error('Expected 3 numbers for a position or 2 numbers for a rotation');
        return;
      }

      const call = /^([A-Za-z_]\w*)\s*\((.*)\)$/.exec(text);
      if (call) {
        const args = parseArgs(call[2]);
        switch (call[1]) {
          case 'ent':
            declareEntity(line, call[2], null);
            return;
          case 'block': {
            checkKeys(args, ['type', 'position', 'states', 'nbt'], 'block');
            const entityNbt = args.nbt !== undefined ? parseSnbt(args.nbt) : undefined;
            if (entityNbt && entityNbt.t !== 'compound') throw new Error('block: nbt must be a compound like {id:\"Sign\"}');
            prog.blocks.push({
              line,
              type: normalizeId(required(args, 'type', 'block')),
              position: resolveVec(required(args, 'position', 'block'), scope).map(Math.floor) as Vec3,
              states: args.states ? parseStates(args.states) : {},
              ...(entityNbt ? { entityNbt } : {}),
            });
            return;
          }
          case 'fill': {
            checkKeys(args, ['type', 'from', 'to', 'states'], 'fill');
            const a = resolveVec(required(args, 'from', 'fill'), scope).map(Math.floor) as Vec3;
            const b = resolveVec(required(args, 'to', 'fill'), scope).map(Math.floor) as Vec3;
            prog.fills.push({
              line,
              type: normalizeId(required(args, 'type', 'fill')),
              from: a.map((v, i) => Math.min(v, b[i])) as Vec3,
              to: a.map((v, i) => Math.max(v, b[i])) as Vec3,
              states: args.states ? parseStates(args.states) : {},
            });
            return;
          }
          case 'item': {
            checkKeys(args, ['target', 'slot', 'index', 'type', 'count', 'data', 'components'], 'item');
            const tgt = required(args, 'target', 'item').trim();
            const slot = required(args, 'slot', 'item');
            const index = args.index !== undefined ? intArg(args.index, 'item: index') : 0;
            const id = normalizeId(required(args, 'type', 'item'));
            const count = args.count !== undefined ? intArg(args.count, 'item: count') : 1;
            const data = args.data !== undefined ? intArg(args.data, 'item: data') : 0;
            if (count < 1 || count > MAX_ITEM_COUNT) throw new Error(`item: count must be between 1 and ${MAX_ITEM_COUNT}`);
            if (count > maxStack(id)) throw new Error(`item: ${id} stacks to at most ${maxStack(id)}`);
            if (data < 0) throw new Error('item: data cannot be negative');
            let components: Record<string, unknown> = {};
            if (args.components) {
              try {
                components = JSON.parse(args.components);
              } catch (e) {
                throw new Error(`item: components is not valid JSON (${(e as Error).message})`);
              }
              if (!components || typeof components !== 'object' || Array.isArray(components)) {
                throw new Error('item: components must be a JSON object');
              }
            }
            const ent = handles.has(tgt) ? prog.entities.find((e) => e.handle === tgt) : undefined;
            let target: { handle: string } | { pos: Vec3 };
            let dup: string;
            if (ent) {
              const isPlayer = ent.type === 'minecraft:player';
              const problem = slotProblem(slot, index, isPlayer);
              if (problem) throw new Error(`item: ${problem.message}`);
              dup = `h:${tgt}/${entitySlotKey(isPlayer, ent.selected, slot, index)}`;
              target = { handle: tgt };
            } else {
              let pos: Vec3;
              try {
                pos = resolveVec(tgt, scope).map(Math.floor) as Vec3;
              } catch {
                throw new Error(`item: unknown target "${tgt}" (expected an entity handle or a block position)`);
              }
              if (slot !== 'slot.container') throw new Error('item: blocks only have slot.container slots');
              dup = `b:${pos.join(',')}/${slotKey(slot, index)}`;
              target = { pos };
            }
            const prev = itemSlots.get(dup);
            if (prev !== undefined) throw new Error(`item: that slot was already filled on line ${prev}`);
            itemSlots.set(dup, line);
            const item: Item = { id, count, data, components };
            prog.items.push({ line, target, slot, index, item });
            return;
          }
          case 'region': {
            checkKeys(args, ['from', 'to'], 'region');
            const a = resolveVec(required(args, 'from', 'region'), scope);
            const b = resolveVec(required(args, 'to', 'region'), scope);
            prog.region = {
              min: a.map((v, i) => Math.floor(Math.min(v, b[i]))) as Vec3,
              max: a.map((v, i) => Math.floor(Math.max(v, b[i]))) as Vec3,
            };
            return;
          }
          case 'world': {
            checkKeys(args, ['time', 'weather', 'difficulty', 'spawn', 'seed'], 'world');
            if (prog.world) throw new Error('world(...) is declared twice');
            const w: WorldDecl = { line };
            if ('time' in args) {
              const t = args.time;
              const v = t in TIME_NAMES ? TIME_NAMES[t] : /^\d+$/.test(t) ? Number(t) : NaN;
              if (!Number.isFinite(v)) throw new Error(`world: time must be a tick count or one of ${Object.keys(TIME_NAMES).join(', ')}, got "${t}"`);
              w.time = v % 24000;
            }
            if ('weather' in args) {
              if (!['clear', 'rain', 'thunder'].includes(args.weather)) throw new Error(`world: weather must be clear, rain or thunder, got "${args.weather}"`);
              w.weather = args.weather as WorldDecl['weather'];
            }
            if ('difficulty' in args) {
              if (!['peaceful', 'easy', 'normal', 'hard'].includes(args.difficulty)) throw new Error(`world: difficulty must be peaceful, easy, normal or hard, got "${args.difficulty}"`);
              w.difficulty = args.difficulty as WorldDecl['difficulty'];
            }
            if ('seed' in args) {
              if (!/^-?\d+$/.test(args.seed)) throw new Error(`world: seed must be an integer, got "${args.seed}"`);
              w.seed = Number(args.seed) | 0;
            }
            if ('spawn' in args) w.spawn = resolveVec(args.spawn, scope).map(Math.floor) as Vec3;
            prog.world = w;
            return;
          }
          case 'cb':
            flushPending();
            pending = { ...parseCb(args), line, owner: ownerOf() };
            return;
          default:
            throw new Error(`Unknown declaration "${call[1]}(...)"`);
        }
      }
      throw new Error(`Unrecognized line: ${text}`);
    } catch (e) {
      diag(line, (e as Error).message);
    }
  });
  flushPending();
  resolvePlaceholders(prog, diag);
  validateLayout(prog, diag);
  for (const it of prog.items) {
    if (!('pos' in it.target)) continue;
    const pos = it.target.pos.join(',');
    const b = prog.blocks.find((x) => x.position.join(',') === pos);
    const problem = b ? containerProblem(b.type, it.index) : `no block(...) is declared at (${pos})`;
    if (problem) diag(it.line, `item: ${problem}`);
  }
  prog.diagnostics.sort((a, b) => a.line - b.line);
  return prog;
}
