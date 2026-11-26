import { normalizeId, unquote, type Token } from '../language/parser.ts';
import { ENTITY_TYPES, EXTRA_ENTITY_TYPES } from '../language/ids.ts';
import type { Vec3 } from '../language/types.ts';
import {
  box, checkVolume, floorVec, fmt, isCoordToken, lookRot, matchBlock, readAngle, readBlock, readCoords, sameBlock, syntax, trace,
} from './args.ts';
import type { Cmd } from './registry.ts';
import { clampPitch, wrapYaw } from './geometry.ts';
import { parseJson, renderRawtext } from './rawtext.ts';
import { resolveTargets } from './selector.ts';
import { CommandError, label, type BlockData, type Ctx, type Env } from './types.ts';
import { AIR, fmtBlock } from './world.ts';

const failed = (m: string) => new CommandError('failed', m);

function cells(min: Vec3, max: Vec3): Vec3[] {
  const out: Vec3[] = [];
  for (let x = min[0]; x <= max[0]; x++) for (let y = min[1]; y <= max[1]; y++) for (let z = min[2]; z <= max[2]; z++) out.push([x, y, z]);
  return out;
}

function checkBox(env: Env, min: Vec3, max: Vec3): void {
  for (const p of [min, max]) if (!env.world.inRegion(p)) throw failed(`(${p.join(', ')}) is outside the simulated region`);
}

const KNOWN_ENTITIES = new Set([...ENTITY_TYPES, ...EXTRA_ENTITY_TYPES].map((id) => id.replace(/^minecraft:/, '')));

export function summon({ tokens, ctx, env }: Cmd): number {
  const typeTok = tokens[1];
  if (!typeTok) throw syntax('Usage: summon <entityType> [spawnPos] [yRot] [xRot] [event] [nameTag]');
  const type = normalizeId(typeTok.text);
  if (type === 'minecraft:player') throw failed('A player cannot be summoned');
  if (type.startsWith('minecraft:') && !KNOWN_ENTITIES.has(type.slice(10))) throw failed(`Unknown entity type \"${type.slice(10)}\"`);
  let pos: Vec3 = [...ctx.pos];
  let rot: [number, number] = [0, 0];
  let name: string | null = null;
  let event: string | null = null;
  let i = 2;
  const first = tokens[2];
  if (first && !isCoordToken(first) && first.text !== 'facing') {
    name = unquote(first.text);
    i = 3;
    if (tokens[i]) {
      const r = readCoords(tokens, i, ctx);
      pos = r.pos;
      i = r.next;
    }
  } else if (first && first.text !== 'facing') {
    const r = readCoords(tokens, 2, ctx);
    pos = r.pos;
    i = r.next;
  }
  if (name === null && tokens[i]?.text === 'facing') {
    const t = tokens[i + 1];
    if (!t) throw syntax('summon facing: missing target');
    let target: Vec3;
    if (isCoordToken(t)) {
      const r = readCoords(tokens, i + 1, ctx);
      target = r.pos;
      i = r.next;
    } else {
      const es = resolveTargets(t.text, ctx, env.world);
      if (es.length !== 1) throw failed('summon facing expects exactly one target entity');
      target = [...es[0].pos];
      i += 2;
    }
    rot = lookRot(pos, target);
  } else if (name === null && tokens[i] && /^(~|-?[\d.])/.test(tokens[i].text)) {
    rot[0] = wrapYaw(readAngle(tokens[i], ctx.rot[0]));
    i++;
    if (tokens[i] && /^(~|-?[\d.])/.test(tokens[i].text)) rot[1] = clampPitch(readAngle(tokens[i++], ctx.rot[1]));
  }
  if (name === null) {
    if (tokens[i]) event = tokens[i++].text;
    if (tokens[i]) name = unquote(tokens[i++].text);
  }
  if (tokens[i]) throw syntax(`summon: unexpected argument "${tokens[i].text}"`);
  const e = env.world.addEntity(type, name, pos, rot, { born: env.tick });
  env.emit({
    type: 'change', tick: env.tick, line: env.line, target: label(e),
    what: `summoned at ${fmt(pos)}, rotation ${fmt(rot)}${event ? ` (spawn event ${event} is not simulated)` : ''}`,
  });
  return 1;
}

export function kill({ tokens, ctx, env }: Cmd): number {
  let victims = tokens[1] ? resolveTargets(tokens[1].text, ctx, env.world) : ctx.executor ? [ctx.executor] : null;
  if (!victims) throw failed('kill without a target needs an executor');
  if (!victims.length) {
    trace(env, ctx, `kill ${tokens[1].text}: no targets`, 'no_targets');
    return 0;
  }
  victims = [...victims];
  for (const v of victims) {
    const isPlayer = v.type === 'minecraft:player';
    if (!isPlayer) env.world.removeEntity(v);
    env.emit({
      type: 'change', tick: env.tick, line: env.line, target: label(v),
      what: isPlayer ? 'killed (death and respawn are not simulated; the player stays)' : 'killed and removed',
    });
  }
  return victims.length;
}

export function fill({ tokens, ctx, env }: Cmd): number {
  const a = readCoords(tokens, 1, ctx);
  const b = readCoords(tokens, a.next, ctx);
  const { block, next } = readBlock(tokens, b.next);
  const mode = tokens[next]?.text ?? 'replace';
  if (!['replace', 'destroy', 'keep', 'hollow', 'outline'].includes(mode)) throw syntax(`fill: unknown mode "${mode}"`);
  let filter: BlockData | null = null;
  if (mode === 'replace' && tokens[next + 1]) filter = readBlock(tokens, next + 1).block;
  const { min, max, volume } = box(floorVec(a.pos), floorVec(b.pos));
  checkVolume(volume);
  checkBox(env, min, max);
  let changed = 0;
  for (const p of cells(min, max)) {
    const edge = p.some((v, k) => v === min[k] || v === max[k]);
    const old = env.world.getBlockData(p);
    let next: BlockData | null = null;
    if (mode === 'outline') next = edge ? block : null;
    else if (mode === 'hollow') next = edge ? block : { id: AIR, states: {} };
    else if (mode === 'keep') next = old.id === AIR ? block : null;
    else next = !filter || matchBlock(old, filter).ok ? block : null;
    if (next && !sameBlock(old, next)) {
      env.world.setBlock(p, next.id, next.states);
      changed++;
    }
  }
  if (!changed) {
    trace(env, ctx, 'fill: no blocks were changed', 'failed');
    return 0;
  }
  env.emit({
    type: 'change', tick: env.tick, line: env.line, target: `fill ${fmt(min)}..${fmt(max)}`,
    what: `${changed} block(s) changed (${mode}, ${fmtBlock(block)})`,
  });
  return changed;
}

export function clone({ tokens, ctx, env }: Cmd): number {
  const a = readCoords(tokens, 1, ctx);
  const b = readCoords(tokens, a.next, ctx);
  const d = readCoords(tokens, b.next, ctx);
  let i = d.next;
  let mask = 'replace';
  let filter: BlockData | null = null;
  let mode = 'normal';
  if (tokens[i]?.text === 'filtered') {
    mask = 'filtered';
    mode = tokens[i + 1]?.text ?? '';
    const r = readBlock(tokens, i + 2);
    filter = r.block;
    i = r.next;
  } else {
    if (tokens[i] && ['replace', 'masked'].includes(tokens[i].text)) mask = tokens[i++].text;
    if (tokens[i]) mode = tokens[i++].text;
  }
  if (!['normal', 'force', 'move'].includes(mode)) throw syntax(`clone: unknown clone mode "${mode}"`);
  if (tokens[i]) throw syntax(`clone: unexpected argument "${tokens[i].text}"`);
  const src = box(floorVec(a.pos), floorVec(b.pos));
  checkVolume(src.volume);
  const dstMin = floorVec(d.pos);
  const dstMax = dstMin.map((v, k) => v + src.size[k] - 1) as Vec3;
  checkBox(env, src.min, src.max);
  checkBox(env, dstMin, dstMax);
  const overlap = src.min.every((v, k) => v <= dstMax[k] && dstMin[k] <= src.max[k]);
  if (overlap && mode !== 'force') throw failed('The source and destination regions overlap; use force mode to allow it');
  const picked = cells(src.min, src.max)
    .map((p) => ({ p, data: env.world.getBlockData(p) }))
    .filter(({ data }) => (mask === 'masked' ? data.id !== AIR : mask === 'filtered' ? matchBlock(data, filter!).ok : true));
  for (const { p, data } of picked) {
    env.world.setBlockData(p.map((v, k) => v - src.min[k] + dstMin[k]) as Vec3, data);
  }
  if (mode === 'move') {
    for (const { p } of picked) {
      if (!p.every((v, k) => v >= dstMin[k] && v <= dstMax[k])) env.world.setBlock(p, AIR);
    }
  }
  if (!picked.length) {
    trace(env, ctx, 'clone: no blocks were cloned', 'failed');
    return 0;
  }
  env.emit({
    type: 'change', tick: env.tick, line: env.line, target: `clone ${fmt(src.min)}..${fmt(src.max)}`,
    what: `${picked.length} block(s) copied to ${fmt(dstMin)} (${mask}, ${mode})`,
  });
  return picked.length;
}

export function testfor({ tokens, ctx, env }: Cmd): number {
  if (!tokens[1]) throw syntax('Usage: testfor <victim>');
  const ents = resolveTargets(tokens[1].text, ctx, env.world);
  trace(env, ctx, `testfor ${tokens[1].text} -> ${ents.length} match(es)`, ents.length ? null : 'no_targets');
  return ents.length;
}

export function testforblock({ tokens, ctx, env }: Cmd): number {
  const r = readCoords(tokens, 1, ctx);
  const p = floorVec(r.pos);
  const want = readBlock(tokens, r.next).block;
  const actual = env.world.getBlockData(p);
  const m = matchBlock(actual, want);
  trace(env, ctx, `testforblock ${fmt(p)}: ${fmtBlock(actual)}${m.ok ? ' matches' : ` does not match ${fmtBlock(want)}`}${m.note}`, m.ok ? null : 'failed');
  return m.ok ? 1 : 0;
}

export function tellraw({ src, tokens, ctx, env }: Cmd): number {
  if (!tokens[2]) throw syntax('Usage: tellraw <target> <raw json message>');
  const { text, usedTranslate } = renderRawtext(parseJson(src.slice(tokens[2].start), 'tellraw'), ctx, env, 'tellraw');
  const players = resolveTargets(tokens[1].text, ctx, env.world).filter((e) => e.type === 'minecraft:player');
  if (!players.length) {
    trace(env, ctx, `tellraw ${tokens[1].text}: no player matches`, 'no_targets');
    return 0;
  }
  if (usedTranslate) trace(env, ctx, 'tellraw: translation keys are not looked up; the key itself is shown', 'unimplemented');
  for (const p of players) {
    env.emit({ type: 'chat', kind: 'say', tick: env.tick, line: env.line, sender: env.source === 'block' ? '!' : null, text, to: p.name ?? label(p) });
  }
  return players.length;
}
export function particle({ tokens, ctx, env }: Cmd): number {
  if (!tokens[1]) throw syntax('Usage: particle <effect> [position]');
  const pos = tokens[2] ? readCoords(tokens, 2, ctx).pos : ([...ctx.pos] as Vec3);
  env.emit({ type: 'effect', kind: 'particle', tick: env.tick, line: env.line, id: tokens[1].text, pos });
  return 1;
}
