import { syntax, trace } from './args.ts';
import { UNDEAD, armorOfItem } from './entity-data.ts';
import type { Cmd } from './registry.ts';
import { resolveTargets } from './selector.ts';
import { CommandError, label, type Entity, type Env } from './types.ts';

const failed = (m: string) => new CommandError('failed', m);
const fmtHp = (n: number) => String(Math.round(n * 100) / 100);
const nameOf = (e: Entity) => e.name ?? label(e);

const feedback = (env: Env, text: string) => {
  if (env.world.gamerules.sendcommandfeedback !== false) env.emit({ type: 'chat', kind: 'system', tick: env.tick, line: env.line, sender: null, text });
};

/** Damage that armor does not reduce (fall, fire, suffocation, drowning, starvation, magic, kinetic, freezing, void, world border, kill). */
const IGNORES_ARMOR = new Set(['fall', 'fire', 'fire_tick', 'lava', 'suffocation', 'drowning', 'starve', 'magic', 'fly_into_wall', 'freezing', 'sonic_boom', 'void', 'override', 'suicide']);
/** Damage that the resistance effect does not reduce. */
const IGNORES_RESISTANCE = new Set(['starve', 'void', 'override', 'suicide']);

const wornArmor = (e: Entity) => {
  let armor = 0;
  let toughness = 0;
  for (const part of ['head', 'chest', 'legs', 'feet']) {
    const item = e.items[`slot.armor.${part}:0`];
    if (!item) continue;
    const a = armorOfItem(item.id);
    armor += a.armor;
    toughness += a.toughness;
  }
  return { armor, toughness };
};

/**
 * The damage that gets through armor (armor points and toughness) and the resistance effect, as on the Minecraft Wiki:
 * D = d * (1 - min(20, max(armor / 5, armor - d / (2 + toughness / 4))) / 25), then 20% less per level of resistance.
 * Protection enchantments, absorption and the armor's own wear are not simulated.
 */
export function reducedDamage(e: Entity, amount: number, cause: string): number {
  let d = amount;
  const { armor, toughness } = wornArmor(e);
  if (armor > 0 && !IGNORES_ARMOR.has(cause)) d *= 1 - Math.min(20, Math.max(armor / 5, armor - d / (2 + toughness / 4))) / 25;
  const res = e.effects.resistance;
  if (res && !IGNORES_RESISTANCE.has(cause)) d *= Math.max(0, 1 - 0.2 * (res.amplifier + 1));
  return Math.fround(d);
}

/** Creative players take no damage at all and spectators none except from /kill. */
export const isInvulnerable = (e: Entity) => e.type === 'minecraft:player' && (e.gamemode === 'creative' || e.gamemode === 'spectator');

/**
 * Takes health off a living entity (after armor and resistance). An entity that reaches 0 is removed; a player stays
 * (death and respawn are not simulated). Returns false when the entity is invulnerable.
 */
export function applyDamage(env: Env, e: Entity, amount: number, cause: string): boolean {
  if (isInvulnerable(e)) return false;
  const taken = reducedDamage(e, amount, cause);
  e.health = Math.fround(Math.max(0, e.health - taken));
  const isPlayer = e.type === 'minecraft:player';
  let what = `took ${fmtHp(taken)} damage${taken === amount ? '' : ` (${fmtHp(amount)} before armor and resistance)`} (${cause}), health ${fmtHp(e.health)}/${e.maxHealth}`;
  if (e.health === 0) {
    if (!isPlayer) env.world.removeEntity(e);
    what += isPlayer ? '; died (death and respawn are not simulated, the player stays with 0 health)' : '; died and was removed';
  }
  env.emit({ type: 'change', tick: env.tick, line: env.line, target: label(e), what });
  return true;
}

export function applyHeal(env: Env, e: Entity, amount: number): void {
  const before = e.health;
  e.health = Math.fround(Math.min(e.maxHealth, e.health + amount));
  env.emit({ type: 'change', tick: env.tick, line: env.line, target: label(e), what: `healed ${fmtHp(e.health - before)}, health ${fmtHp(e.health)}/${e.maxHealth}` });
}

const isUndead = (e: Entity) => UNDEAD.has(e.type.replace(/^minecraft:/, ''));

/** One application of instant_health or instant_damage (amplifier counts modulo 32): the effect heals the living and hurts the undead, or the other way round. */
export function applyInstant(env: Env, e: Entity, id: 'instant_health' | 'instant_damage', amplifier: number): void {
  const level = (amplifier % 32) + 1;
  const undead = isUndead(e);
  if ((id === 'instant_health') !== undead) {
    if (id === 'instant_health') applyHeal(env, e, 2 * 2 ** level);
    else applyHeal(env, e, 3 * 2 ** level);
  } else applyDamage(env, e, id === 'instant_damage' ? 3 * 2 ** level : 2 * 2 ** level, 'magic');
}

/** One tick of an instant effect that /effect gave for a number of ticks: healing acts every tick, hurting at most once every 10 ticks (hit immunity). */
export function tickInstant(env: Env, e: Entity, id: 'instant_health' | 'instant_damage', fx: { amplifier: number; cooldown?: number }): void {
  if ((id === 'instant_health') === isUndead(e)) {
    if ((fx.cooldown ?? 0) > 0) {
      fx.cooldown = (fx.cooldown ?? 0) - 1;
      return;
    }
    fx.cooldown = 9;
  }
  applyInstant(env, e, id, fx.amplifier);
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
  if (!living.length) throw failed(`Unable to apply damage to ${targets.map(nameOf).join(', ')}`);
  const hit = [...living].filter((e) => applyDamage(env, e, Number(amount), damager ? `${cause}, by ${label(damager)}` : cause));
  if (!hit.length) throw failed(`Unable to apply damage to ${living.map(nameOf).join(', ')}`);
  feedback(env, hit.length === 1 ? `Applied damage to ${nameOf(hit[0])}` : `Applied damage to ${hit.length} entities`);
  return hit.length;
}