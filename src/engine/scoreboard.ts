import { unquote, type Token } from '../language/parser.ts';
import { trace } from './args.ts';
import { inRange } from './range.ts';
import { resolveTargets } from './selector.ts';
import { CommandError, label, type Ctx, type Env } from './types.ts';
import type { World } from './world.ts';

const syntax = (m: string) => new CommandError('syntax_error', m);
const note = (env: Env, ctx: Ctx, message: string) => trace(env, ctx, message, 'executed');

export function holders(text: string, ctx: Ctx, world: World): string[] {
  if (text.startsWith('@')) return resolveTargets(text, ctx, world).map((e) => `e:${e.id}`);
  const name = unquote(text);
  const player = world.entities.find((e) => e.type === 'minecraft:player' && e.name === name);
  return [player ? `e:${player.id}` : `n:${name}`];
}

export function holderName(world: World, key: string): string {
  if (key.startsWith('n:')) return key.slice(2);
  const e = world.entities.find((x) => `e:${x.id}` === key);
  return e ? label(e) : key;
}

function objective(world: World, name: Token | undefined): Map<string, number> {
  if (!name) throw syntax('Missing objective name');
  const o = world.scores.get(name.text);
  if (!o) throw new CommandError('failed', `Objective "${name.text}" does not exist`);
  return o;
}

function int(tok: Token | undefined, what: string): number {
  if (!tok || !/^-?\d+$/.test(tok.text) || !Number.isSafeInteger(Number(tok.text))) throw syntax(`${what} must be an integer`);
  return Number(tok.text) | 0;
}

export function scoreCondition(
  tokens: Token[], i: number, ctx: Ctx, env: Env,
): { matched: boolean; desc: string; next: number } {
  const target = tokens[i];
  if (!target) throw syntax('score: missing target');
  const scores = objective(env.world, tokens[i + 1]);
  const op = tokens[i + 2]?.text;
  const hs = holders(target.text, ctx, env.world);
  if (hs.length > 1) throw new CommandError('failed', 'score condition expects a single target');
  const left = hs.length ? scores.get(hs[0]) : undefined;
  if (op === 'matches') {
    const range = tokens[i + 3]?.text;
    if (!range) throw syntax('score matches: missing range');
    return { matched: left !== undefined && inRange(left, range), desc: `score ${target.text} ${tokens[i + 1].text} = ${left ?? 'unset'} matches ${range}`, next: i + 4 };
  }
  if (!op || !['<', '<=', '=', '>=', '>'].includes(op)) throw syntax('score: expected matches or a comparison operator');
  if (!tokens[i + 3]) throw syntax('score: missing source');
  const otherScores = objective(env.world, tokens[i + 4]);
  const oh = holders(tokens[i + 3].text, ctx, env.world);
  if (oh.length > 1) throw new CommandError('failed', 'score condition expects a single source');
  const right = oh.length ? otherScores.get(oh[0]) : undefined;
  const matched =
    left !== undefined && right !== undefined &&
    { '<': left < right, '<=': left <= right, '=': left === right, '>=': left >= right, '>': left > right }[op]!;
  return { matched, desc: `score ${left ?? 'unset'} ${op} ${right ?? 'unset'}`, next: i + 5 };
}

function change(env: Env, key: string, obj: string, before: number | undefined, after: number | undefined): void {
  env.emit({
    type: 'change', tick: env.tick, line: env.line, target: holderName(env.world, key),
    what: `score ${obj}: ${before ?? 'unset'} -> ${after ?? 'unset'}`,
  });
}

export function scoreboard(tokens: Token[], ctx: Ctx, env: Env): number {
  const [, group, action] = tokens;
  const world = env.world;
  if (group?.text === 'objectives') {
    const name = tokens[3];
    if (action?.text === 'add') {
      if (!name) throw syntax('Usage: scoreboard objectives add <name> dummy [displayName]');
      if (tokens[4]?.text !== 'dummy') throw syntax('Only the dummy criteria is supported');
      if (world.scores.has(name.text)) throw new CommandError('failed', `Objective "${name.text}" already exists`);
      world.scores.set(name.text, new Map());
      const display = tokens.slice(5).map((t) => unquote(t.text)).join(' ');
      if (display) world.objectiveNames.set(name.text, display);
      return 1;
    }
    if (action?.text === 'remove') {
      objective(world, name);
      world.scores.delete(name.text);
      world.objectiveNames.delete(name.text);
      for (const slot of Object.keys(world.scoreDisplay)) if (world.scoreDisplay[slot]?.objective === name.text) delete world.scoreDisplay[slot];
      return 1;
    }
    if (action?.text === 'list') {
      const names = [...world.scores.keys()];
      note(env, ctx, names.length ? `There are ${names.length} objectives: ${names.map((n) => (world.objectiveNames.get(n) ? `[${world.objectiveNames.get(n)}]` : n)).join(', ')}` : 'There are no objectives');
      return names.length;
    }
    if (action?.text === 'setdisplay') {
      if (!['list', 'sidebar', 'belowname'].includes(name?.text ?? '')) throw syntax('Usage: scoreboard objectives setdisplay <list|sidebar|belowname> [objective] [ascending|descending]');
      const order = tokens[5]?.text ?? 'descending';
      if (order !== 'ascending' && order !== 'descending') throw syntax(`setdisplay: order must be ascending or descending, got "${order}"`);
      if (tokens[6]) throw syntax(`setdisplay: unexpected argument "${tokens[6].text}"`);
      if (!tokens[4]) delete world.scoreDisplay[name.text];
      else {
        objective(world, tokens[4]);
        world.scoreDisplay[name.text] = { objective: tokens[4].text, order };
      }
      return 1;
    }
    throw new CommandError('unimplemented', `scoreboard objectives ${action?.text ?? ''} is not implemented yet`);
  }
  if (group?.text !== 'players') throw new CommandError('unimplemented', `scoreboard ${group?.text ?? ''} is not implemented yet`);
  const a = action?.text;
  const target = tokens[3];
  if (a === 'list') {
    const keys = target ? holders(target.text, ctx, world) : [...new Set([...world.scores.values()].flatMap((m) => [...m.keys()]))];
    if (!keys.length) {
      trace(env, ctx, `scoreboard: no targets for ${target?.text}`, 'no_targets');
      return 0;
    }
    for (const k of keys) {
      const own = [...world.scores].flatMap(([n, m]) => (m.has(k) ? [`[${n}]: ${m.get(k)}`] : []));
      note(env, ctx, own.length ? `${holderName(world, k)} has ${own.length} tracked objective(s): ${own.join(', ')}` : `${holderName(world, k)} has no scores recorded`);
    }
    return keys.length;
  }
  if (!a || !target) throw syntax('Usage: scoreboard players <action> <target> ...');
  if (a === 'test') {
    const scores = objective(world, tokens[4]);
    const bound = (t: Token | undefined, d: number) => (!t || t.text === '*' ? d : int(t, 'range bound'));
    if (!tokens[5]) throw syntax('Usage: scoreboard players test <target> <objective> <min|*> [max|*]');
    const lo = bound(tokens[5], -2147483648);
    const hi = bound(tokens[6], 2147483647);
    const hs = holders(target.text, ctx, world);
    if (hs.length !== 1) throw new CommandError('failed', 'scoreboard players test expects a single target');
    const v = scores.get(hs[0]);
    if (v === undefined) throw new CommandError('failed', `Target has no score in ${tokens[4].text}`);
    if (v < lo || v > hi) throw new CommandError('failed', `Score ${v} is not in the range ${lo}..${hi}`);
    note(env, ctx, `Score ${v} is in range ${lo} to ${hi}`);
    return 1;
  }
  if (a === 'random') {
    const scores = objective(world, tokens[4]);
    const lo = int(tokens[5], 'min');
    const hi = int(tokens[6], 'max');
    if (lo > hi) throw syntax('scoreboard players random: min must not be greater than max');
    const hs = holders(target.text, ctx, world);
    if (!hs.length) {
      trace(env, ctx, `scoreboard: no targets for ${target.text}`, 'no_targets');
      return 0;
    }
    for (const h of hs) {
      const old = scores.get(h);
      const next = lo + Math.floor(world.random() * (hi - lo + 1));
      scores.set(h, next);
      change(env, h, tokens[4].text, old, next);
    }
    return hs.length;
  }

  if (a === 'reset') {
    const names = tokens[4] ? [objective(world, tokens[4])] : [...world.scores.values()];
    const objNames = tokens[4] ? [tokens[4].text] : [...world.scores.keys()];
    const hs = target.text === '*' ? [...new Set(names.flatMap((m) => [...m.keys()]))] : holders(target.text, ctx, world);
    let n = 0;
    hs.forEach((h) =>
      names.forEach((m, k) => {
        if (!m.has(h)) return;
        change(env, h, objNames[k], m.get(h), undefined);
        m.delete(h);
        n++;
      }),
    );
    return n;
  }
  if (a === 'set' || a === 'add' || a === 'remove') {
    const scores = objective(world, tokens[4]);
    const value = int(tokens[5], 'score value');
    const hs = holders(target.text, ctx, world);
    if (!hs.length) {
      env.emit({ type: 'trace', tick: env.tick, line: env.line, branch: null, status: 'no_targets', message: `scoreboard: no targets for ${target.text}` });
      return 0;
    }
    for (const h of hs) {
      const old = scores.get(h);
      const next = a === 'set' ? value : ((old ?? 0) + (a === 'add' ? value : -value)) | 0;
      scores.set(h, next);
      change(env, h, tokens[4].text, old, next);
    }
    return hs.length;
  }
  if (a === 'operation') {
    const scores = objective(world, tokens[4]);
    const op = tokens[5]?.text;
    if (!tokens[6]) throw syntax('Usage: scoreboard players operation <target> <obj> <op> <source> <obj>');
    const srcScores = objective(world, tokens[7]);
    const targets = holders(target.text, ctx, world);
    const sources = holders(tokens[6].text, ctx, world);
    if (!targets.length || !sources.length) return 0;
    if (sources.length > 1) throw new CommandError('failed', 'operation expects a single source');
    const s = srcScores.get(sources[0]);
    if (s === undefined) throw new CommandError('failed', `Source has no score in ${tokens[7].text}`);
    let n = 0;
    for (const h of targets) {
      const t = scores.get(h) ?? 0;
      let r: number;
      switch (op) {
        case '+=': r = t + s; break;
        case '-=': r = t - s; break;
        case '*=': r = Math.imul(t, s); break;
        case '/=':
        case '%=':
          if (s === 0) throw new CommandError('failed', 'Cannot divide by zero');
          r = op === '/=' ? Math.floor(t / s) : ((t % s) + s) % s;
          break;
        case '=': r = s; break;
        case '<': r = Math.min(t, s); break;
        case '>': r = Math.max(t, s); break;
        case '><': {
          change(env, h, tokens[4].text, scores.get(h), s);
          change(env, sources[0], tokens[7].text, s, t);
          scores.set(h, s);
          srcScores.set(sources[0], t);
          n++;
          continue;
        }
        default: throw syntax(`Unknown operation "${op ?? ''}"`);
      }
      r |= 0;
      change(env, h, tokens[4].text, scores.get(h), r);
      scores.set(h, r);
      n++;
    }
    return n;
  }
  throw new CommandError('unimplemented', `scoreboard players ${a} is not implemented yet`);
}
