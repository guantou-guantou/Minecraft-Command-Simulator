import { MAX_ITEM_COUNT, containerProblem, fmtItem, maxStack, slotKey, slotProblem, type Item } from '../language/items.ts';
import { normalizeId, type Token } from '../language/parser.ts';
import type { Vec3 } from '../language/types.ts';
import { floorVec, fmt, readCoords, syntax, trace } from './args.ts';
import { clearFrom, giveTo, isPlayer, keyFor, type SlotChange } from './inventory.ts';
import type { Cmd } from './registry.ts';
import { resolveTargets } from './selector.ts';
import { CommandError, label, type Ctx, type Env } from './types.ts';

const failed = (m: string) => new CommandError('failed', m);
const short = (i: Item | null) => (i ? fmtItem(i) : 'empty');

function intTok(tok: Token | undefined, what: string, fallback: number): number {
  if (!tok) return fallback;
  if (!/^-?\d+$/.test(tok.text) || !Number.isSafeInteger(Number(tok.text))) throw syntax(`${what} must be an integer, got "${tok.text}"`);
  return Number(tok.text);
}

function itemId(tok: Token | undefined): string {
  if (!tok) throw syntax('Missing item name');
  const id = normalizeId(tok.text);
  if (id === 'minecraft:air') throw failed('air is not an item');
  return id;
}

function parseComponents(src: string, tok: Token | undefined): Record<string, unknown> {
  if (!tok) return {};
  let json: unknown;
  try {
    json = JSON.parse(src.slice(tok.start));
  } catch (e) {
    throw syntax(`components is not valid JSON (${(e as Error).message})`);
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw syntax('components must be a JSON object');
  return json as Record<string, unknown>;
}

function players(ctx: Ctx, env: Env, text: string | undefined, what: string) {
  const found = text ? resolveTargets(text, ctx, env.world).filter(isPlayer) : ctx.executor && isPlayer(ctx.executor) ? [ctx.executor] : null;
  if (!found) throw failed(`${what} without a target needs an executing player`);
  return found;
}

function report(env: Env, who: string, changes: SlotChange[]): void {
  env.emit({
    type: 'change', tick: env.tick, line: env.line, target: who,
    what: changes.map((c) => `${c.key} ${short(c.before)} -> ${short(c.after)}`).join('; '),
  });
}

export function give({ src, tokens, ctx, env }: Cmd): number {
  if (!tokens[2]) throw syntax('Usage: give <player> <item> [amount] [data] [components]');
  const id = normalizeId(tokens[2].text);
  const count = intTok(tokens[3], 'amount', 1);
  const data = intTok(tokens[4], 'data', 0);
  if (count < 1 || count > MAX_ITEM_COUNT) throw failed(`amount must be between 1 and ${MAX_ITEM_COUNT}`);
  if (data < 0) throw failed('data cannot be negative');
  const item: Item = { id, count, data, components: parseComponents(src, tokens[5]) };
  const targets = players(ctx, env, tokens[1].text, 'give');
  if (!targets.length) {
    trace(env, ctx, `give ${tokens[1].text}: no player matches`, 'no_targets');
    return 0;
  }
  const shown = id.replace(/^minecraft:/, '').split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
  for (const p of targets) {
    const name = p.name ?? label(p);
    if (id !== 'minecraft:air') {
      const { leftover, changes } = giveTo(p, item);
      if (changes.length) report(env, label(p), changes);
      if (leftover > 0) {
        trace(env, ctx, `${label(p)}: inventory full, ${leftover} item(s) would drop as an item entity (not simulated)`, 'unimplemented');
      }
    }
    if (env.world.gamerules.sendcommandfeedback !== false) env.emit({ type: 'chat', kind: 'system', tick: env.tick, line: env.line, sender: null, text: `Gave ${count} ${shown} to ${name}` });
    env.emit({ type: 'chat', kind: 'system', tick: env.tick, line: env.line, sender: null, to: name, text: `You were given ${count} ${shown}` });
  }
  return targets.length;
}

export function clear({ tokens, ctx, env }: Cmd): number {
  const targets = players(ctx, env, tokens[1]?.text, 'clear');
  const id = tokens[2] ? itemId(tokens[2]) : null;
  const data = intTok(tokens[3], 'data', -1);
  const max = intTok(tokens[4], 'maxCount', -1);
  if (!targets.length) {
    trace(env, ctx, `clear ${tokens[1].text}: no player matches`, 'no_targets');
    return 0;
  }
  let total = 0;
  for (const p of targets) {
    const { found, changes } = clearFrom(p, id, data, max);
    total += found;
    if (changes.length) report(env, label(p), changes);
  }
  if (!total) {
    trace(env, ctx, 'clear: no matching items were found', 'failed');
    return 0;
  }
  trace(env, ctx, max === 0 ? `clear: ${total} matching item(s) found (nothing removed)` : `clear: ${total} item(s) matched`);
  return targets.length;
}

export function replaceitem({ src, tokens, ctx, env }: Cmd): number {
  const kind = tokens[1]?.text;
  if (kind !== 'entity' && kind !== 'block') throw syntax('Usage: replaceitem entity|block ...');
  let i = 2;
  let ents: ReturnType<typeof resolveTargets> = [];
  let blockPos: Vec3 | null = null;
  if (kind === 'entity') {
    if (!tokens[i]) throw syntax('replaceitem entity: missing target');
    ents = resolveTargets(tokens[i++].text, ctx, env.world);
  } else {
    const r = readCoords(tokens, i, ctx);
    blockPos = floorVec(r.pos);
    i = r.next;
  }
  const slot = tokens[i++]?.text;
  if (!slot) throw syntax('replaceitem: missing slot type');
  const index = intTok(tokens[i++], 'slot id', NaN);
  if (Number.isNaN(index)) throw syntax('replaceitem: missing slot id');
  let mode = 'destroy';
  if (tokens[i] && (tokens[i].text === 'destroy' || tokens[i].text === 'keep')) mode = tokens[i++].text;
  const idTok = tokens[i++];
  if (!idTok) throw syntax('replaceitem: missing item name');
  const id = normalizeId(idTok.text);
  const count = intTok(tokens[i++], 'amount', 1);
  const data = intTok(tokens[i++], 'data', 0);
  const clearSlot = id === 'minecraft:air';
  if (!clearSlot) {
    if (count < 1 || count > MAX_ITEM_COUNT) throw failed(`amount must be between 1 and ${MAX_ITEM_COUNT}`);
    if (count > maxStack(id)) throw failed(`${id} stacks to at most ${maxStack(id)}`);
    if (data < 0) throw failed('data cannot be negative');
  }
  const item: Item = { id, count, data, components: parseComponents(src, tokens[i]) };

  if (blockPos) {
    if (slot !== 'slot.container') throw failed('blocks only have slot.container slots');
    const block = env.world.getBlockData(blockPos);
    const problem = containerProblem(block.id, index);
    if (problem) throw failed(problem);
    const key = slotKey(slot, index);
    const old = block.items?.[key] ?? null;
    if (mode === 'keep' && old) {
      trace(env, ctx, `replaceitem: ${key} is not empty`, 'failed');
      return 0;
    }
    const items = { ...block.items };
    if (clearSlot) delete items[key];
    else items[key] = item;
    env.world.setBlockData(blockPos, { ...block, items });
    env.emit({ type: 'change', tick: env.tick, line: env.line, target: `block ${fmt(blockPos)}`, what: `${key} ${short(old)} -> ${short(clearSlot ? null : item)}` });
    return 1;
  }

  if (!ents.length) {
    trace(env, ctx, 'replaceitem: no targets', 'no_targets');
    return 0;
  }
  let n = 0;
  for (const e of ents) {
    const problem = slotProblem(slot, index, isPlayer(e));
    if (problem) {
      if (problem.status !== 'failed') throw new CommandError(problem.status, problem.message);
      trace(env, ctx, `${label(e)}: ${problem.message}`, 'failed');
      continue;
    }
    const key = keyFor(e, slot, index);
    const old = e.items[key] ?? null;
    if (mode === 'keep' && old) {
      trace(env, ctx, `${label(e)}: ${key} is not empty`, 'failed');
      continue;
    }
    if (clearSlot) delete e.items[key];
    else e.items[key] = structuredClone(item);
    report(env, label(e), [{ key, before: old, after: clearSlot ? null : item }]);
    n++;
  }
  return n;
}
