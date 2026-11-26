import { unquote, type Token } from '../language/parser.ts';
import { syntax, trace } from './args.ts';
import { evaluate, fmtValue, MolangError, parseMolang, type MolangCtx, type Script } from './molang.ts';
import type { Cmd } from './registry.ts';
import { resolveTargets } from './selector.ts';
import { CommandError, label, type Entity, type SimEvent } from './types.ts';

export interface PlayAnimationArgs {
  target: string;
  animation: string;
  nextState: string;
  blendOut: number;
  expression: string;
  controller: string | null;
}

/** Parses `playanimation <entity> <animation> [next_state] [blend_out_time] [stop_expression] [controller]`. */
export function parsePlayAnimation(tokens: Token[]): PlayAnimationArgs {
  const t = (i: number) => tokens[i]?.text;
  if (!t(1) || !t(2)) throw syntax('Usage: playanimation <entity> <animation> [next_state] [blend_out_time] [stop_expression] [controller]');
  if (tokens[7]) throw syntax(`playanimation: unexpected argument "${t(7)}"`);
  if (!/^[\w.:-]+$/.test(t(2))) throw syntax(`playanimation: invalid animation name "${t(2)}"`);
  const blend = t(4) === undefined ? 0 : Number(t(4));
  if (!Number.isFinite(blend) || blend < 0) throw syntax(`playanimation: blend_out_time must be a non-negative number, got "${t(4)}"`);
  const controller = t(6) === undefined ? null : unquote(t(6));
  if (controller !== null && !/^[\w.:-]+$/.test(controller)) throw syntax(`playanimation: invalid controller name "${controller}"`);
  return { target: t(1), animation: t(2), nextState: t(3) ?? 'default', blendOut: blend, expression: t(5) === undefined ? '' : unquote(t(5)), controller };
}

export function parseExpression(source: string): Script {
  try {
    return parseMolang(source);
  } catch (e) {
    if (e instanceof MolangError) throw syntax(`Molang error at column ${e.index + 1}: ${e.message}`);
    throw e;
  }
}

function molangCtx(e: Entity, tick: number, since: number): MolangCtx {
  return {
    vars: e.molang,
    temp: {},
    query: (name, args) => {
      switch (name) {
        case 'life_time': return (tick - e.born) / 20;
        case 'anim_time': return (tick - since) / 20;
        case 'position': return e.pos[Math.max(0, Math.min(2, Math.trunc(args[0])))];
        case 'is_alive': return 1;
        default: return 0;
      }
    },
  };
}

/** Evaluates `script` on `e`; returns whether the animation asked to stop (its expression returned a true value). */
export function runOnEntity(e: Entity, script: Script, tick: number, since: number): boolean {
  const r = evaluate(script, molangCtx(e, tick, since));
  return r.returned && r.value !== 0 && r.value !== null && r.value !== '';
}

export function playanimation({ tokens, ctx, env }: Cmd): number {
  const a = parsePlayAnimation(tokens);
  const script = parseExpression(a.expression);
  const targets = resolveTargets(a.target, ctx, env.world);
  if (!targets.length) {
    trace(env, ctx, `playanimation ${a.target}: no targets`, 'no_targets');
    return 0;
  }
  const key = a.controller ?? a.animation;
  for (const e of targets) {
    const before = { ...e.molang };
    let stopped = false;
    try {
      stopped = runOnEntity(e, script, env.tick, env.tick);
    } catch (err) {
      if (err instanceof MolangError) throw new CommandError('failed', `Molang runtime error: ${err.message}`);
      throw err;
    }
    if (stopped) delete e.anims[key];
    else e.anims[key] = { animation: a.animation, nextState: a.nextState, blendOut: a.blendOut, source: a.expression, script, since: env.tick };
    const changed = Object.keys(e.molang).filter((k) => e.molang[k] !== before[k]);
    const shown = changed.slice(0, 6).map((k) => `${k}=${fmtValue(e.molang[k])}`).join(', ');
    env.emit({
      type: 'change', tick: env.tick, line: env.line, target: label(e),
      what: `${a.animation} on controller ${key}${stopped ? ' (stopped at once)' : ''}${changed.length ? `; set ${changed.length} variable(s): ${shown}${changed.length > 6 ? ', ...' : ''}` : ''}`,
    });
  }
  return targets.length;
}

/** `stopsound <player> [sound]`: sounds are not simulated, so this only checks the target. */
export function stopsound({ tokens, ctx, env }: Cmd): number {
  if (!tokens[1]) throw syntax('Usage: stopsound <player> [sound]');
  const players = resolveTargets(tokens[1].text, ctx, env.world).filter((e) => e.type === 'minecraft:player');
  if (!players.length) {
    trace(env, ctx, `stopsound ${tokens[1].text}: no player matches`, 'no_targets');
    return 0;
  }
  return players.length;
}

/** Runs every active animation once per game tick, in the order the animations were started. */
export function tickAnimations(entities: Entity[], tick: number, emit: (e: SimEvent) => void, quiet: boolean): void {
  for (const e of entities) {
    for (const [key, anim] of Object.entries(e.anims)) {
      try {
        if (runOnEntity(e, anim.script, tick, anim.since)) delete e.anims[key];
      } catch (err) {
        if (!(err instanceof MolangError)) throw err;
        delete e.anims[key];
        if (!quiet) {
          emit({ type: 'chat', kind: 'error', tick, line: 0, sender: null, text: `Molang runtime error in ${label(e)} / ${key}: ${err.message}; the animation was stopped` });
        }
      }
    }
  }
}