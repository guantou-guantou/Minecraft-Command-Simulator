import { splitTop, unquote, type Token } from '../language/parser.ts';
import type { Vec3 } from '../language/types.ts';
import {
  anchoredOrigin, box, checkVolume, eyeHeight, floorVec, fmt, isCoordToken, lookRot, matchBlock, readAngle, readBlock,
  readCoords, sameBlock, syntax, trace,
} from './args.ts';
import { clampPitch, wrapYaw } from './geometry.ts';
import { KNOWN_COMMANDS } from './known-commands.ts';
import { scoreCondition } from './scoreboard.ts';
import { resolveTargets } from './selector.ts';
import { CommandError, label, type Ctx, type Entity, type Env } from './types.ts';
import { AIR, fmtBlock } from './world.ts';

export function executeCommand(src: string, ctx: Ctx, env: Env): number {
  const tokens = splitTop(src, (c) => /\s/.test(c));
  if (!tokens.length) throw syntax('Empty command');
  const name = tokens[0].text.toLowerCase();
  const spec = env.commands.get(name);
  if (spec) return spec.run({ src, tokens, ctx, env });
  if (KNOWN_COMMANDS.has(name)) throw new CommandError('unimplemented', `/${name} is a Bedrock command that is not implemented yet`);
  throw syntax(`Unknown command: /${name}`);
}

export function execute({ src, tokens, ctx, env }: { src: string; tokens: Token[]; ctx: Ctx; env: Env }): number {
  return executeFrom(src, tokens, 1, ctx, env);
}

function branch(
  src: string, tokens: Token[], i: number, ctx: Ctx, env: Env, ents: Entity[], head: string,
  make: (e: Entity) => Ctx, desc?: (e: Entity) => string,
): number {
  trace(env, ctx, `${head} -> ${ents.length} match(es)`, ents.length ? null : 'no_targets');
  let n = 0;
  for (const e of ents) {
    const c = make(e);
    if (desc) trace(env, c, desc(e));
    n += executeFrom(src, tokens, i, c, env);
  }
  return n;
}

function allCells(a: Vec3, b: Vec3): Vec3[] {
  const { min, max } = box(a, b);
  const out: Vec3[] = [];
  for (let x = min[0]; x <= max[0]; x++) for (let y = min[1]; y <= max[1]; y++) for (let z = min[2]; z <= max[2]; z++) out.push([x, y, z]);
  return out;
}

function executeFrom(src: string, tokens: Token[], i: number, ctx: Ctx, env: Env): number {
  const sub = tokens[i]?.text;
  if (!sub) throw syntax('execute: expected a subcommand');
  const need = (k: number, what: string) => {
    const t = tokens[k]?.text;
    if (!t) throw syntax(`execute ${sub}: missing ${what}`);
    return t;
  };
  switch (sub) {
    case 'run': {
      const next = tokens[i + 1];
      if (!next) throw syntax('execute run: missing command');
      return executeCommand(src.slice(next.start), ctx, env);
    }
    case 'as':
    case 'at': {
      const sel = need(i + 1, 'target');
      return branch(
        src, tokens, i + 2, ctx, env, resolveTargets(sel, ctx, env.world), `${sub} ${sel}`,
        (e) => (sub === 'as' ? { ...ctx, executor: e } : { ...ctx, pos: [...e.pos], rot: [...e.rot] }),
        sub === 'at' ? (e) => `at ${label(e)}: position ${fmt(e.pos)}, rotation ${fmt(e.rot)}` : undefined,
      );
    }
    case 'in': {
      const dim = need(i + 1, 'dimension');
      if (!['overworld', 'nether', 'the_end'].includes(dim)) throw syntax(`execute in: dimension must be overworld, nether or the_end, got "${dim}"`);
      if (dim !== 'overworld') trace(env, ctx, `execute in ${dim}: only one world is simulated, so the rest of the command runs in the main world`, 'unimplemented');
      return executeFrom(src, tokens, i + 2, ctx, env);
    }
    case 'positioned': {
      if (tokens[i + 1]?.text === 'as') {
        const sel = need(i + 2, 'target');
        return branch(
          src, tokens, i + 3, ctx, env, resolveTargets(sel, ctx, env.world), `positioned as ${sel}`,
          (e) => ({ ...ctx, pos: [...e.pos] }), (e) => `positioned as ${label(e)}: position ${fmt(e.pos)}`,
        );
      }
      const { pos, next } = readCoords(tokens, i + 1, ctx);
      trace(env, ctx, `positioned ${fmt(pos)}`);
      return executeFrom(src, tokens, next, { ...ctx, pos }, env);
    }
    case 'rotated': {
      if (tokens[i + 1]?.text === 'as') {
        const sel = need(i + 2, 'target');
        return branch(
          src, tokens, i + 3, ctx, env, resolveTargets(sel, ctx, env.world), `rotated as ${sel}`,
          (e) => ({ ...ctx, rot: [...e.rot] }), (e) => `rotated as ${label(e)}: rotation ${fmt(e.rot)}`,
        );
      }
      const rot: [number, number] = [wrapYaw(readAngle(tokens[i + 1], ctx.rot[0])), clampPitch(readAngle(tokens[i + 2], ctx.rot[1]))];
      trace(env, ctx, `rotated ${fmt(rot)}`);
      return executeFrom(src, tokens, i + 3, { ...ctx, rot }, env);
    }
    case 'facing': {
      if (tokens[i + 1]?.text === 'entity') {
        const sel = need(i + 2, 'target');
        const anchor = need(i + 3, 'anchor (eyes or feet)');
        if (anchor !== 'eyes' && anchor !== 'feet') throw syntax(`execute facing entity: anchor must be eyes or feet, got "${anchor}"`);
        const from = anchoredOrigin(ctx);
        const point = (e: Entity): Vec3 => [e.pos[0], e.pos[1] + (anchor === 'eyes' ? eyeHeight(e.type) : 0), e.pos[2]];
        return branch(
          src, tokens, i + 4, ctx, env, resolveTargets(sel, ctx, env.world), `facing entity ${sel} ${anchor}`,
          (e) => ({ ...ctx, rot: lookRot(from, point(e)) }),
          (e) => `facing ${label(e)} (${anchor}): rotation ${fmt(lookRot(from, point(e)))}`,
        );
      }
      const { pos, next } = readCoords(tokens, i + 1, ctx);
      const rot = lookRot(anchoredOrigin(ctx), pos);
      trace(env, ctx, `facing ${fmt(pos)}: rotation ${fmt(rot)}`);
      return executeFrom(src, tokens, next, { ...ctx, rot }, env);
    }
    case 'align': {
      const axes = need(i + 1, 'axes');
      if (!/^[xyz]{1,3}$/.test(axes) || new Set(axes).size !== axes.length) throw syntax(`execute align: invalid axes "${axes}"`);
      const pos = ctx.pos.map((v, k) => ('xyz'[k] && axes.includes('xyz'[k]) ? Math.floor(v) : v)) as Vec3;
      trace(env, ctx, `align ${axes} -> ${fmt(pos)}`);
      return executeFrom(src, tokens, i + 2, { ...ctx, pos }, env);
    }
    case 'anchored': {
      const a = need(i + 1, 'anchor (eyes or feet)');
      if (a !== 'eyes' && a !== 'feet') throw syntax(`execute anchored: expected eyes or feet, got "${a}"`);
      trace(env, ctx, `anchored ${a}`);
      return executeFrom(src, tokens, i + 2, { ...ctx, anchor: a }, env);
    }
    case 'if':
    case 'unless': {
      const kind = tokens[i + 1]?.text;
      let matched: boolean;
      let desc: string;
      let next: number;
      if (kind === 'block') {
        const read = readCoords(tokens, i + 2, ctx);
        const p = floorVec(read.pos);
        const wanted = readBlock(tokens, read.next);
        next = wanted.next;
        try {
          const actual = env.world.getBlockData(p);
          const m = matchBlock(actual, wanted.block);
          matched = m.ok;
          desc = `block ${fmt(p)} is ${fmtBlock(actual)}, expected ${fmtBlock(wanted.block)}${m.note}`;
        } catch (e) {
          if (!(e instanceof CommandError)) throw e;
          trace(env, ctx, `${sub} block ${fmt(p)}: ${e.message} -> condition not met`, 'condition_false');
          return 0;
        }
      } else if (kind === 'blocks') {
        const a = readCoords(tokens, i + 2, ctx);
        const b = readCoords(tokens, a.next, ctx);
        const d = readCoords(tokens, b.next, ctx);
        const mode = tokens[d.next]?.text;
        if (mode !== 'all' && mode !== 'masked') throw syntax('execute blocks: expected all or masked');
        next = d.next + 1;
        const src3 = box(floorVec(a.pos), floorVec(b.pos));
        checkVolume(src3.volume);
        const dst0 = floorVec(d.pos);
        try {
          matched = allCells(src3.min, src3.max).every((p) => {
            const s = env.world.getBlockData(p);
            if (mode === 'masked' && s.id === AIR) return true;
            return sameBlock(s, env.world.getBlockData(p.map((v, k) => v - src3.min[k] + dst0[k]) as Vec3));
          });
          desc = `blocks ${fmt(src3.min)}..${fmt(src3.max)} vs ${fmt(dst0)} (${mode}) ${matched ? 'are identical' : 'differ'}`;
        } catch (e) {
          if (!(e instanceof CommandError)) throw e;
          trace(env, ctx, `${sub} blocks: ${e.message} -> condition not met`, 'condition_false');
          return 0;
        }
      } else if (kind === 'entity') {
        const sel = need(i + 2, 'target');
        const n = resolveTargets(sel, ctx, env.world).length;
        matched = n > 0;
        desc = `entity ${sel} -> ${n} match(es)`;
        next = i + 3;
      } else if (kind === 'score') {
        ({ matched, desc, next } = scoreCondition(tokens, i + 2, ctx, env));
      } else {
        throw new CommandError('unimplemented', `execute ${sub} ${kind ?? ''} is not implemented yet`);
      }
      const pass = matched === (sub === 'if');
      trace(env, ctx, `${sub} ${desc} -> ${pass ? 'passed' : 'condition not met'}`, pass ? null : 'condition_false');
      if (!pass) return 0;
      return tokens[next] ? executeFrom(src, tokens, next, ctx, env) : 1;
    }
    default:
      throw new CommandError('unimplemented', `execute ${sub} is not implemented yet`);
  }
}

export function say({ src, tokens, ctx, env }: { src: string; tokens: Token[]; ctx: Ctx; env: Env }): number {
  if (!tokens[1]) throw syntax('say: missing message');
  const raw = src.slice(tokens[1].start);
  const text = raw.replace(/@[a-z](?:\[[^\]]*\])?/g, (sel) =>
    resolveTargets(sel, ctx, env.world).map((e) => e.name ?? label(e)).join(', '),
  );
  env.emit({ type: 'chat', kind: 'say', tick: env.tick, line: env.line, sender: ctx.executor ? (ctx.executor.name ?? label(ctx.executor)) : env.source === 'block' ? '!' : null, text });
  return 1;
}

export function tag({ tokens, ctx, env }: { tokens: Token[]; ctx: Ctx; env: Env }): number {
  const [, target, action, rawName] = tokens;
  const name = rawName && { ...rawName, text: unquote(rawName.text) };
  if (target && action?.text === 'list' && !name) {
    const listed = resolveTargets(target.text, ctx, env.world);
    if (!listed.length) {
      trace(env, ctx, `tag ${target.text}: no targets`, 'no_targets');
      return 0;
    }
    for (const e of listed) trace(env, ctx, `tag: ${label(e)} has tags [${[...e.tags].join(', ')}]`, null);
    return listed.length;
  }
  if (!target || !action || !name) throw syntax('Usage: tag <targets> add|remove <name> | tag <targets> list');
  if (action.text !== 'add' && action.text !== 'remove') throw syntax(`tag: expected add or remove, got "${action.text}"`);
  const ents = resolveTargets(target.text, ctx, env.world);
  if (!ents.length) {
    trace(env, ctx, `tag ${target.text}: no targets`, 'no_targets');
    return 0;
  }
  let changed = 0;
  for (const e of ents) {
    const has = e.tags.has(name.text);
    if (action.text === 'add' ? has : !has) {
      trace(env, ctx, `${label(e)} ${has ? 'already has' : 'does not have'} tag ${name.text}`, 'failed');
      continue;
    }
    if (action.text === 'add') e.tags.add(name.text);
    else e.tags.delete(name.text);
    env.emit({ type: 'change', tick: env.tick, line: env.line, target: label(e), what: `${action.text === 'add' ? 'added' : 'removed'} tag ${name.text}` });
    changed++;
  }
  return changed;
}

export function tp({ tokens, ctx, env }: { tokens: Token[]; ctx: Ctx; env: Env }): number {
  const needExecutor = () => {
    if (!ctx.executor) throw new CommandError('failed', 'teleport without a victim needs an executor');
    return [ctx.executor];
  };
  if (!tokens[1]) throw syntax('Usage: tp [victim] <x y z | destination> [yRot] [xRot]');
  let victims: Entity[];
  let at = 1;
  let dest: Token | undefined;
  if (isCoordToken(tokens[1])) victims = needExecutor();
  else if (!tokens[2]) {
    victims = needExecutor();
    dest = tokens[1];
  } else {
    victims = resolveTargets(tokens[1].text, ctx, env.world);
    at = 2;
    if (!isCoordToken(tokens[2])) dest = tokens[2];
  }

  let pos: Vec3 | null = null;
  let yaw: Token | undefined;
  let pitch: Token | undefined;
  let look: Vec3 | null = null;
  let checkTok: Token | undefined;
  let to: { pos: Vec3; rot: [number, number] } | null = null;
  if (dest) {
    const ds = resolveTargets(dest.text, ctx, env.world);
    if (ds.length > 1) throw new CommandError('failed', 'tp destination must be a single entity');
    if (!ds.length) {
      trace(env, ctx, `tp: no destination matches ${dest.text}`, 'no_targets');
      return 0;
    }
    to = { pos: [...ds[0].pos], rot: [...ds[0].rot] };
    checkTok = tokens[dest === tokens[1] ? 2 : 3];
  } else {
    const read = readCoords(tokens, at, ctx);
    pos = read.pos;
    let k = read.next;
    if (tokens[k]?.text === 'facing') {
      k++;
      if (!tokens[k]) throw syntax('tp facing: expected a position or an entity');
      if (isCoordToken(tokens[k])) {
        const r = readCoords(tokens, k, ctx);
        look = r.pos;
        k = r.next;
      } else {
        const fs = resolveTargets(tokens[k].text, ctx, env.world);
        if (fs.length > 1) throw new CommandError('failed', 'tp facing needs a single entity');
        if (!fs.length) {
          trace(env, ctx, `tp: no entity matches ${tokens[k].text}`, 'no_targets');
          return 0;
        }
        look = [...fs[0].pos];
        k++;
      }
    } else if (tokens[k] && tokens[k].text !== 'true' && tokens[k].text !== 'false') {
      [yaw, pitch] = [tokens[k], tokens[k + 1]];
      k += 2;
    }
    checkTok = tokens[k];
  }
  if (checkTok && checkTok.text !== 'true' && checkTok.text !== 'false') throw syntax(`tp: checkForBlocks must be true or false, got "${checkTok.text}"`);
  const checkBlocks = checkTok?.text === 'true';
  if (!victims.length) {
    trace(env, ctx, `tp: no targets for ${tokens[1].text}`, 'no_targets');
    return 0;
  }
  let moved = 0;
  for (const v of victims) {
    const oldPos = fmt(v.pos);
    const oldRot = fmt(v.rot);
    if (checkBlocks) {
      const dp = to ? to.pos : pos!;
      const cell = dp.map(Math.floor) as Vec3;
      const blocked = [cell, [cell[0], cell[1] + 1, cell[2]] as Vec3].some((c) => env.world.inRegion(c) && env.world.getBlock(c) !== AIR);
      if (blocked) {
        trace(env, ctx, `tp: ${label(v)} was not teleported, the destination is blocked`, 'failed');
        continue;
      }
    }
    if (to) {
      v.pos = [...to.pos];
      v.rot = [...to.rot];
    } else {
      v.pos = [...pos!];
      if (yaw) v.rot[0] = wrapYaw(readAngle(yaw, ctx.rot[0]));
      if (pitch) v.rot[1] = clampPitch(readAngle(pitch, ctx.rot[1]));
      if (look) v.rot = lookRot(v.pos, look);
    }
    moved++;
    env.emit({
      type: 'change', tick: env.tick, line: env.line, target: label(v),
      what: `moved ${oldPos} -> ${fmt(v.pos)}, rotation ${oldRot} -> ${fmt(v.rot)}`,
    });
  }
  if (!moved) throw new CommandError('failed', 'tp: no target could be teleported');
  return moved;
}

export function setblock({ tokens, ctx, env }: { tokens: Token[]; ctx: Ctx; env: Env }): number {
  const read = readCoords(tokens, 1, ctx);
  const p = floorVec(read.pos);
  const { block, next } = readBlock(tokens, read.next);
  const mode = tokens[next]?.text ?? 'replace';
  if (!['replace', 'destroy', 'keep'].includes(mode)) throw syntax(`setblock: unknown mode "${mode}"`);
  const old = env.world.getBlockData(p);
  if (sameBlock(old, block) || (mode === 'keep' && old.id !== AIR)) {
    trace(env, ctx, `setblock ${fmt(p)}: block unchanged (${fmtBlock(old)})`, 'failed');
    return 0;
  }
  env.world.setBlock(p, block.id, block.states);
  env.emit({ type: 'change', tick: env.tick, line: env.line, target: `block ${fmt(p)}`, what: `${fmtBlock(old)} -> ${fmtBlock(block)}` });
  return 1;
}
