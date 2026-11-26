import { diagnoseWords } from '../language/cmdlint.ts';
import { syntax, trace } from './args.ts';
import type { Cmd } from './registry.ts';
import { resolveTargets } from './selector.ts';

/** Commands that only change what a client shows or hears: they are checked, resolved against their targets and recorded, nothing else. */
const PRESENTATION: Record<string, { target?: (words: string[]) => number }> = {
  camera: { target: () => 1 },
  camerashake: { target: () => 2 },
  fog: { target: () => 1 },
  hud: { target: () => 1 },
  aimassist: { target: () => 1 },
  controlscheme: { target: () => 1 },
  music: {},
  dialogue: {},
};

function check(cmd: Cmd): string {
  const words = cmd.tokens.map((t) => t.text);
  const problem = diagnoseWords(words);
  if (problem) throw syntax(problem.message);
  return words[0].toLowerCase();
}

export function presentation(cmd: Cmd): number {
  const name = check(cmd);
  const spec = PRESENTATION[name];
  const at = spec.target?.(cmd.tokens.map((t) => t.text));
  const sel = at === undefined ? undefined : cmd.tokens[at]?.text;
  if (sel === undefined) {
    trace(cmd.env, cmd.ctx, `/${name} accepted: it only changes what a client shows or plays, so nothing is simulated`);
    return 1;
  }
  const players = resolveTargets(sel, cmd.ctx, cmd.env.world).filter((e) => e.type === 'minecraft:player');
  if (!players.length) {
    trace(cmd.env, cmd.ctx, `/${name} ${sel}: no player matches`, 'no_targets');
    return 0;
  }
  trace(cmd.env, cmd.ctx, `/${name} accepted for ${players.length} player(s): it only changes what their client shows or plays, so nothing is simulated`);
  return players.length;
}

export function admin(cmd: Cmd): number {
  const name = check(cmd);
  trace(cmd.env, cmd.ctx, `/${name} accepted: a server setting, so nothing is simulated`);
  return 1;
}

export const PRESENTATION_COMMANDS = Object.keys(PRESENTATION);