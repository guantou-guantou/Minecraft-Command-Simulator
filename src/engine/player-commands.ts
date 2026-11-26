import { floorVec, isCoordToken, readCoords, syntax, trace } from './args.ts';
import type { Vec3 } from '../language/types.ts';
import { ENCHANT_DATA, ENCHANT_NAMES, conflictWith, enchantById } from './enchant-data.ts';
import { keyFor } from './inventory.ts';
import { captureStructure, normalizeStructureName, placeStructure, type Mirror, type PlaceOptions, type Rotation } from './structure.ts';
import type { Cmd } from './registry.ts';
import { resolveTargets } from './selector.ts';
import { CommandError, label, type Entity, type Env } from './types.ts';

const failed = (m: string) => new CommandError('failed', m);
const isPlayer = (e: Entity) => e.type === 'minecraft:player';
const players = (text: string, { ctx, env }: Cmd) => resolveTargets(text, ctx, env.world).filter(isPlayer);

function int(text: string | undefined, what: string, lo: number, hi: number): number {
  if (text === undefined || !/^-?\d+$/.test(text)) throw syntax(`${what} must be an integer, got "${text ?? ''}"`);
  const n = Number(text);
  if (n < lo || n > hi) throw syntax(`${what} must be between ${lo} and ${hi}, got ${n}`);
  return n;
}

const bool = (text: string | undefined, what: string): boolean => {
  if (text !== 'true' && text !== 'false') throw syntax(`${what} must be true or false, got "${text ?? ''}"`);
  return text === 'true';
};

const chat = (env: Env, text: string) => env.emit({ type: 'chat', kind: 'system', tick: env.tick, line: env.line, sender: null, text });
const change = (env: Env, e: Entity, what: string) => env.emit({ type: 'change', tick: env.tick, line: env.line, target: label(e), what });

/** The explicit target, or the executor when it is a player. */
function targetOrSelf(cmd: Cmd, tok: { text: string } | undefined, name: string): Entity[] {
  if (tok) return players(tok.text, cmd);
  if (!cmd.ctx.executor || !isPlayer(cmd.ctx.executor)) throw failed(`${name}: no player given and the executor is not a player`);
  return [cmd.ctx.executor];
}

const noPlayers = (cmd: Cmd, name: string, sel: string): number => {
  trace(cmd.env, cmd.ctx, `${name} ${sel}: no player matches`, 'no_targets');
  return 0;
};

export const ENCHANTS = new Set(ENCHANT_NAMES);

export function enchant(cmd: Cmd): number {
  const { tokens, ctx, env } = cmd;
  if (!tokens[2]) throw syntax('Usage: enchant <player> <enchantment name|id> [level]');
  if (tokens[4]) throw syntax(`enchant: unexpected argument "${tokens[4].text}"`);
  const raw = tokens[2].text.replace(/^minecraft:/, '');
  let name: string;
  if (/^\d+$/.test(raw)) {
    const byId = enchantById(Number(raw));
    if (!byId) throw syntax(`enchant: unknown enchantment id ${raw}`);
    name = byId;
  } else if (ENCHANTS.has(raw)) name = raw;
  else throw syntax(`enchant: unknown enchantment "${raw}"`);
  const level = tokens[3] ? int(tokens[3].text, 'level', 1, 32767) : 1;
  const max = ENCHANT_DATA[name].max;
  if (level > max) throw failed(`enchant: level ${level} is too high for ${name} (maximum ${max})`);
  const targets = players(tokens[1].text, cmd);
  if (!targets.length) return noPlayers(cmd, 'enchant', tokens[1].text);
  let done = 0;
  let reason = 'no target holds an item';
  for (const p of targets) {
    const item = p.items[keyFor(p, 'slot.weapon.mainhand', 0)];
    if (!item) {
      trace(env, ctx, `enchant: ${label(p)} holds no item`, 'failed');
      continue;
    }
    const map = ((item.components['minecraft:enchantments'] as Record<string, number> | undefined) ??= {});
    const clash = conflictWith(name, Object.keys(map));
    if (clash) {
      reason = `${name} cannot be combined with ${clash} on ${item.id.replace('minecraft:', '')}`;
      trace(env, ctx, `enchant: ${label(p)}: ${reason}`, 'failed');
      continue;
    }
    map[name] = level;
    change(env, p, `${item.id} enchanted: ${name} ${level}`);
    done++;
  }
  if (!done) throw failed(`enchant: ${reason}`);
  trace(env, ctx, 'enchant: whether the item can take this enchantment at all is not checked', 'unimplemented');
  return done;
}
const MODES: Record<string, string> = {
  survival: 'survival', s: 'survival', '0': 'survival', creative: 'creative', c: 'creative', '1': 'creative',
  adventure: 'adventure', a: 'adventure', '2': 'adventure', default: 'default', d: 'default', '5': 'default', spectator: 'spectator', '6': 'spectator',
};

export function gamemode(cmd: Cmd): number {
  const { tokens, env } = cmd;
  if (!tokens[1]) throw syntax('Usage: gamemode <mode> [player]');
  if (tokens[3]) throw syntax(`gamemode: unexpected argument "${tokens[3].text}"`);
  const mode = MODES[tokens[1].text];
  if (!mode) throw syntax(`gamemode: unknown game mode "${tokens[1].text}"`);
  const targets = targetOrSelf(cmd, tokens[2], 'gamemode');
  if (!targets.length) return noPlayers(cmd, 'gamemode', tokens[2]!.text);
  for (const p of targets) {
    p.gamemode = mode;
    change(env, p, `game mode set to ${mode}`);
  }
  return targets.length;
}

export const INPUT_PERMISSIONS = new Set([
  'camera', 'movement', 'jump', 'lateral_movement', 'sneak', 'dismount', 'mount', 'move_backward', 'move_forward', 'move_left', 'move_right',
]);

export function inputpermission(cmd: Cmd): number {
  const { tokens, ctx, env } = cmd;
  const sub = tokens[1]?.text;
  if (sub !== 'set' && sub !== 'query') throw syntax('Usage: inputpermission set <targets> <permission> <state> | query <targets> <permission> [state]');
  if (!tokens[3]) throw syntax(`inputpermission ${sub}: missing target or permission`);
  const perm = tokens[3].text;
  if (!INPUT_PERMISSIONS.has(perm)) throw syntax(`inputpermission: unknown permission "${perm}"`);
  const state = tokens[4]?.text;
  if (state !== undefined && state !== 'enabled' && state !== 'disabled') throw syntax(`inputpermission: state must be enabled or disabled, got "${state}"`);
  if (sub === 'set' && !state) throw syntax('inputpermission set: missing state');
  if (tokens[5]) throw syntax(`inputpermission: unexpected argument "${tokens[5].text}"`);
  const targets = players(tokens[2].text, cmd);
  if (!targets.length) return noPlayers(cmd, 'inputpermission', tokens[2].text);
  if (sub === 'set') {
    for (const p of targets) {
      p.inputs[perm] = state as 'enabled' | 'disabled';
      change(env, p, `input permission ${perm} ${state}`);
    }
    return targets.length;
  }
  let match = 0;
  for (const p of targets) {
    const now = p.inputs[perm] ?? 'enabled';
    trace(env, ctx, `${label(p)}: ${perm} is ${now}`, null);
    if (!state || now === state) match++;
  }
  if (!match) trace(env, ctx, 'inputpermission query: no player has that state', 'condition_false');
  return match;
}

export function kick(cmd: Cmd): number {
  const { src, tokens, env } = cmd;
  if (!tokens[2]) throw syntax('Usage: kick <player> <reason>');
  const reason = src.slice(tokens[2].start);
  const targets = players(tokens[1].text, cmd);
  if (!targets.length) return noPlayers(cmd, 'kick', tokens[1].text);
  for (const p of [...targets]) {
    env.world.removeEntity(p);
    chat(env, `Kicked ${p.name ?? label(p)} from the game: ${reason}`);
    change(env, p, `kicked: ${reason}`);
  }
  return targets.length;
}

export function list({ tokens, env }: Cmd): number {
  if (tokens[1]) throw syntax(`list: unexpected argument "${tokens[1].text}"`);
  const names = env.world.entities.filter(isPlayer).map((p) => p.name ?? label(p));
  chat(env, `There are ${names.length} players online: ${names.join(', ')}`);
  return names.length;
}

const xpNeeded = (level: number) => (level <= 15 ? 2 * level + 7 : level <= 30 ? 5 * level - 38 : 9 * level - 158);

export function addXp(e: Entity, amount: number, levels: boolean): void {
  if (levels) {
    e.xpLevel = Math.max(0, e.xpLevel + amount);
    e.xpPoints = Math.min(e.xpPoints, xpNeeded(e.xpLevel) - 1);
    return;
  }
  e.xpPoints += amount;
  while (e.xpPoints >= xpNeeded(e.xpLevel)) {
    e.xpPoints -= xpNeeded(e.xpLevel);
    e.xpLevel++;
  }
}

export function xp(cmd: Cmd): number {
  const { tokens, env } = cmd;
  const m = /^(-?\d+)([lL])?$/.exec(tokens[1]?.text ?? '');
  if (!m) throw syntax('Usage: xp <amount>[L] [player]');
  if (tokens[3]) throw syntax(`xp: unexpected argument "${tokens[3].text}"`);
  const amount = Number(m[1]);
  const levels = !!m[2];
  if (!levels && amount < 0) throw failed('xp: cannot give a player negative experience points (use the L suffix to remove levels)');
  if (Math.abs(amount) > 2147483647) throw syntax('xp: amount out of range');
  const targets = targetOrSelf(cmd, tokens[2], 'xp');
  if (!targets.length) return noPlayers(cmd, 'xp', tokens[2]!.text);
  for (const p of targets) {
    addXp(p, amount, levels);
    change(env, p, `experience ${amount >= 0 ? '+' : ''}${amount}${levels ? ' levels' : ' points'}; now level ${p.xpLevel} + ${p.xpPoints} points`);
  }
  return targets.length;
}

export function title(cmd: Cmd): number {
  const { src, tokens, ctx, env } = cmd;
  if (!tokens[2]) throw syntax('Usage: title <player> clear|reset|times <in> <stay> <out>|title|subtitle|actionbar <text>');
  const slot = tokens[2].text;
  let text = '';
  if (slot === 'clear' || slot === 'reset') {
    if (tokens[3]) throw syntax(`title ${slot}: unexpected argument "${tokens[3].text}"`);
  } else if (slot === 'times') {
    const t = [3, 4, 5].map((i) => int(tokens[i]?.text, 'time', 0, 1000000));
    if (tokens[6]) throw syntax(`title times: unexpected argument "${tokens[6].text}"`);
    text = t.join(' ');
  } else if (slot === 'title' || slot === 'subtitle' || slot === 'actionbar') {
    if (!tokens[3]) throw syntax(`title ${slot}: missing text`);
    text = src.slice(tokens[3].start).replace(/@[a-z](?:\[[^\]]*\])?/g, (sel) =>
      resolveTargets(sel, ctx, env.world).map((e) => e.name ?? label(e)).join(', '),
    );
  } else {
    throw syntax(`title: expected clear, reset, times, title, subtitle or actionbar, got "${slot}"`);
  }
  const targets = players(tokens[1].text, cmd);
  if (!targets.length) return noPlayers(cmd, 'title', tokens[1].text);
  for (const p of targets) env.emit({ type: 'screen', tick: env.tick, line: env.line, to: p.name ?? label(p), slot: slot as 'title', text });
  return targets.length;
}

const MIRRORS = ['x', 'z', 'none', 'xz'];

const ROT_Q: Record<string, Rotation> = { '0_degrees': 0, '90_degrees': 1, '180_degrees': 2, '270_degrees': 3 };

export function structure(cmd: Cmd): number {
  const { tokens, ctx, env } = cmd;
  const sub = tokens[1]?.text;
  if (!tokens[2] || (sub !== 'save' && sub !== 'load' && sub !== 'delete')) throw syntax('Usage: structure save|load|delete <name> ...');
  const name = normalizeStructureName(tokens[2].text);
  let i = 3;
  const coord = (what: string): Vec3 => {
    if (!isCoordToken(tokens[i])) throw syntax(`structure ${sub}: expected the ${what} position`);
    const r = readCoords(tokens, i, ctx);
    i = r.next;
    return r.pos;
  };
  const opt = (): string | undefined => tokens[i]?.text;
  const world = env.world;
  if (sub === 'delete') {
    if (tokens[3]) throw syntax(`structure delete: unexpected argument "${tokens[3].text}"`);
    const a = world.structures.delete(name);
    const b = env.library.delete(name);
    if (!a && !b) throw failed(`structure delete: no structure named "${name}"`);
    trace(env, ctx, `structure "${name}" deleted`, 'executed');
    return 1;
  }
  if (sub === 'save') {
    const from = floorVec(coord('from'));
    const to = floorVec(coord('to'));
    let includeEntities = true;
    let includeBlocks = true;
    let mode = 'disk';
    if (opt() === 'true' || opt() === 'false') includeEntities = bool(tokens[i++].text, 'includeEntities');
    if (opt() === 'disk' || opt() === 'memory') mode = tokens[i++].text;
    else if (opt() !== undefined && opt() !== 'true' && opt() !== 'false') throw syntax(`structure save: saveMode must be disk or memory, got "${opt()}"`);
    if (opt() !== undefined) includeBlocks = bool(tokens[i++]?.text, 'includeBlocks');
    if (tokens[i]) throw syntax(`structure save: unexpected argument "${tokens[i].text}"`);
    const tpl = captureStructure(world, from, to, includeEntities, includeBlocks);
    (mode === 'memory' ? world.structures : env.library).set(name, tpl);
    (mode === 'memory' ? env.library : world.structures).delete(name);
    trace(env, ctx, `structure "${name}" saved (${mode}): ${tpl.size.join('x')} blocks, ${tpl.entities.length} entities`, 'executed');
    return 1;
  }
  const at = floorVec(coord('destination'));
  const o: PlaceOptions = { rotation: 0, mirror: 'none', includeEntities: true, includeBlocks: true, integrity: 100, seed: null };
  if (opt() !== undefined) {
    if (!(opt()! in ROT_Q)) throw syntax(`structure load: rotation must be one of ${Object.keys(ROT_Q).join(', ')}, got "${opt()}"`);
    o.rotation = ROT_Q[tokens[i++].text];
  }
  if (opt() !== undefined) {
    if (!MIRRORS.includes(opt()!)) throw syntax(`structure load: mirror must be one of ${MIRRORS.join(', ')}, got "${opt()}"`);
    o.mirror = tokens[i++].text as Mirror;
  }
  let animated = false;
  if (opt() === 'block_by_block' || opt() === 'layer_by_layer') {
    i++;
    animated = true;
    if (!/^-?(\d+\.?\d*|\.\d+)$/.test(opt() ?? '')) throw syntax('structure load: animationSeconds must be a number');
    i++;
  }
  if (opt() !== undefined) o.includeEntities = bool(tokens[i++].text, 'includeEntities');
  if (opt() !== undefined) o.includeBlocks = bool(tokens[i++].text, 'includeBlocks');
  let waterlogged = false;
  if (opt() !== undefined) waterlogged = bool(tokens[i++].text, 'waterlogged');
  if (opt() !== undefined) {
    if (!/^-?(\d+\.?\d*|\.\d+)$/.test(opt()!)) throw syntax(`structure load: integrity must be a number, got "${opt()}"`);
    o.integrity = Number(tokens[i++].text);
    if (o.integrity < 0 || o.integrity > 100) throw syntax('structure load: integrity must be between 0 and 100');
  }
  if (opt() !== undefined) o.seed = tokens[i++].text;
  if (tokens[i]) throw syntax(`structure load: unexpected argument "${tokens[i].text}"`);
  const tpl = world.structures.get(name) ?? env.library.get(name);
  if (!tpl) throw failed(`structure load: no structure named "${name}"`);
  const r = placeStructure(world, tpl, at, o, env.line);
  trace(env, ctx, `structure "${name}" loaded at (${at.join(', ')}): ${r.blocks} blocks, ${r.entities} entities`, 'executed');
  if (animated || waterlogged) trace(env, ctx, 'structure load: animation and waterlogged options are accepted but have no effect', 'unimplemented');
  if (o.rotation || o.mirror !== 'none') trace(env, ctx, 'structure load: only facing_direction, cardinal_direction, direction, weirdo_direction and ground_sign_direction states are turned or mirrored', 'unimplemented');
  return 1;
}
const NAME_OK = (n: string) => n.length > 0;

export function tickingarea(cmd: Cmd): number {
  const { tokens, ctx, env } = cmd;
  const world = env.world;
  const sub = tokens[1]?.text;
  const areas = world.tickingAreas;
  const inside = (a: { kind: string; from: Vec3; to: Vec3; radius: number }, p: Vec3) => {
    if (a.kind === 'circle') return Math.hypot(p[0] - a.from[0], p[2] - a.from[2]) <= a.radius * 16;
    return [0, 1, 2].every((k) => p[k] >= Math.min(a.from[k], a.to[k]) && p[k] <= Math.max(a.from[k], a.to[k]));
  };
  const find = (): { idx: number[]; what: string } => {
    if (!tokens[2]) throw syntax(`tickingarea ${sub}: missing name or position`);
    if (isCoordToken(tokens[2]) && !areas.some((a) => a.name === tokens[2].text)) {
      const p = floorVec(readCoords(tokens, 2, ctx).pos);
      return { idx: areas.flatMap((a, k) => (inside(a, p) ? [k] : [])), what: `position ${p.join(' ')}` };
    }
    return { idx: areas.flatMap((a, k) => (a.name === tokens[2].text ? [k] : [])), what: `"${tokens[2].text}"` };
  };
  if (sub === 'add') {
    const circle = tokens[2]?.text === 'circle';
    let i = circle ? 3 : 2;
    if (!isCoordToken(tokens[i])) throw syntax(`tickingarea add: expected ${circle ? 'the center' : 'the from'} position`);
    const a = readCoords(tokens, i, ctx);
    i = a.next;
    let to = a.pos;
    let radius = 0;
    if (circle) radius = int(tokens[i++]?.text, 'radius', 1, 1000);
    else {
      if (!isCoordToken(tokens[i])) throw syntax('tickingarea add: expected the to position');
      const b = readCoords(tokens, i, ctx);
      to = b.pos;
      i = b.next;
    }
    let name = `Area${areas.length + 1}`;
    if (tokens[i] && tokens[i].text !== 'true' && tokens[i].text !== 'false') name = tokens[i++].text;
    if (!NAME_OK(name)) throw syntax('tickingarea add: empty name');
    const preload = tokens[i] ? bool(tokens[i++].text, 'preload') : false;
    if (tokens[i]) throw syntax(`tickingarea add: unexpected argument "${tokens[i].text}"`);
    if (areas.some((x) => x.name === name)) throw failed(`tickingarea add: an area named "${name}" already exists`);
    areas.push({ name, kind: circle ? 'circle' : 'box', from: floorVec(a.pos), to: floorVec(to), radius, preload });
    env.emit({ type: 'change', tick: env.tick, line: env.line, target: 'ticking areas', what: `added "${name}"` });
    return 1;
  }
  if (sub === 'remove') {
    const { idx, what } = find();
    if (!idx.length) throw failed(`tickingarea remove: no ticking area at ${what}`);
    for (const k of [...idx].reverse()) areas.splice(k, 1);
    env.emit({ type: 'change', tick: env.tick, line: env.line, target: 'ticking areas', what: `removed ${idx.length} area(s) at ${what}` });
    return idx.length;
  }
  if (sub === 'remove_all') {
    if (tokens[2]) throw syntax(`tickingarea remove_all: unexpected argument "${tokens[2].text}"`);
    const n = areas.length;
    areas.length = 0;
    env.emit({ type: 'change', tick: env.tick, line: env.line, target: 'ticking areas', what: `removed all (${n})` });
    return Math.max(1, n);
  }
  if (sub === 'list') {
    if (tokens[2] && tokens[2].text !== 'all-dimensions') throw syntax(`tickingarea list: expected all-dimensions, got "${tokens[2].text}"`);
    chat(env, areas.length ? `Ticking areas: ${areas.map((a) => `${a.name} (${a.kind === 'circle' ? `circle r=${a.radius} at ${a.from.join(' ')}` : `${a.from.join(' ')} to ${a.to.join(' ')}`}${a.preload ? ', preload' : ''})`).join('; ')}` : 'There are no ticking areas');
    return Math.max(1, areas.length);
  }
  if (sub === 'preload') {
    const { idx, what } = find();
    if (!idx.length) throw failed(`tickingarea preload: no ticking area at ${what}`);
    const flag = tokens[3] ? bool(tokens[3].text, 'preload') : true;
    if (tokens[4]) throw syntax(`tickingarea preload: unexpected argument "${tokens[4].text}"`);
    for (const k of idx) areas[k].preload = flag;
    return idx.length;
  }
  throw syntax('Usage: tickingarea add|remove|remove_all|list|preload ...');
}