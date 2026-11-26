import { syntax, trace } from './args.ts';
import type { Cmd } from './registry.ts';
import { resolveTargets } from './selector.ts';
import { CommandError, label, type Entity, type Env } from './types.ts';

const failed = (m: string) => new CommandError('failed', m);
const fmtHp = (n: number) => String(Math.round(n * 100) / 100);

const feedback = (env: Env, text: string) => {
  if (env.world.gamerules.sendcommandfeedback !== false) env.emit({ type: 'chat', kind: 'system', tick: env.tick, line: env.line, sender: null, text });
};

/**
 * Takes health off a living entity. Armor, resistance, absorption and game modes are not considered.
 * An entity that reaches 0 is removed; a player stays (death and respawn are not simulated).
 */
export function applyDamage(env: Env, e: Entity, amount: number, cause: string): void {
  e.health = Math.max(0, e.health - amount);
  const isPlayer = e.type === 'minecraft:player';
  let what = `took ${fmtHp(amount)} damage (${cause}), health ${fmtHp(e.health)}/${e.maxHealth}`;
  if (e.health === 0) {
    if (!isPlayer) env.world.removeEntity(e);
    what += isPlayer ? '; died (death and respawn are not simulated, the player stays with 0 health)' : '; died and was removed';
  }
  env.emit({ type: 'change', tick: env.tick, line: env.line, target: label(e), what });
}

export function applyHeal(env: Env, e: Entity, amount: number): void {
  const before = e.health;
  e.health = Math.min(e.maxHealth, e.health + amount);
  env.emit({ type: 'change', tick: env.tick, line: env.line, target: label(e), what: `healed ${fmtHp(e.health - before)}, health ${fmtHp(e.health)}/${e.maxHealth}` });
}

export function damage({ tokens, ctx, env }: Cmd): number {
  if (!tokens[1] || !tokens[2]) throw syntax('Usage: damage <target> <amount> [cause] [entity <damager>]');
  const amount = tokens[2].text;
  if (!/^\d+$/.test(amount)) throw syntax(`damage: amount must be a whole number of at least 0, got "${amount}"`);
  const cause = tokens[3]?.text ?? 'none';
  let damager: Entity | null = null;
  if (tokens[4]) {
    if (tokens[4].text !== 'entity' || !tokens[5]) throw syntax('damage: expected "entity <damager>" after the cause');
    if (tokens[6]) throw syntax(`damage: unexpected argument "${tokens[6].text}"`);
    const found = resolveTargets(tokens[5].text, ctx, env.world);
    if (!found.length) {
      trace(env, ctx, `damage: no damager matches ${tokens[5].text}`, 'no_targets');
      return 0;
    }
    damager = found[0];
  }
  const targets = resolveTargets(tokens[1].text, ctx, env.world);
  if (!targets.length) {
    trace(env, ctx, `damage ${tokens[1].text}: no targets`, 'no_targets');
    return 0;
  }
  const living = targets.filter((e) => e.maxHealth > 0);
  if (!living.length) throw failed(`${targets.length === 1 ? label(targets[0]) : 'The targets'} cannot be damaged (no health)`);
  for (const e of [...living]) applyDamage(env, e, Number(amount), damager ? `${cause}, by ${label(damager)}` : cause);
  feedback(env, living.length === 1 ? `Applied ${amount} damage to ${label(living[0])}` : `Applied ${amount} damage to ${living.length} entities`);
  return living.length;
}