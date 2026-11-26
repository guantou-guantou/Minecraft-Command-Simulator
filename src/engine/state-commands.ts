import { EFFECT_IDS } from '../language/ids.generated.ts';
import { syntax, trace } from './args.ts';
import { applyDamage, applyHeal } from './health-commands.ts';
import { GAMERULE_DEFAULTS, isIntRule } from './gamerules.ts';
import { parseJson, renderRawtext } from './rawtext.ts';
import type { Cmd } from './registry.ts';
import { resolveTargets } from './selector.ts';
import { CommandError, label, type Env } from './types.ts';

const failed = (m: string) => new CommandError('failed', m);

export const EFFECTS = new Set([...EFFECT_IDS,
  'wither', 'speed', 'slowness', 'haste', 'mining_fatigue', 'strength', 'instant_health', 'instant_damage', 'jump_boost',
  'nausea', 'regeneration', 'resistance', 'fire_resistance', 'water_breathing', 'invisibility', 'blindness', 'night_vision',
  'hunger', 'weakness', 'poison', 'health_boost', 'absorption', 'saturation', 'levitation', 'fatal_poison', 'conduit_power',
  'slow_falling', 'bad_omen', 'village_hero', 'darkness', 'trial_omen', 'wind_charged', 'weaving', 'oozing', 'infested',
  'raid_omen', 'breath_of_the_nautilus',
]);
const INSTANT = new Set(['instant_health', 'instant_damage']);

function feedback(env: Env, text: string): void {
  if (env.world.gamerules.sendcommandfeedback !== false) {
    env.emit({ type: 'chat', kind: 'system', tick: env.tick, line: env.line, sender: null, text });
  }
}

function effectId(text: string | undefined): string {
  if (!text) throw syntax('Missing effect name');
  const id = text.replace(/^minecraft:/, '');
  if (!EFFECTS.has(id)) throw syntax(`Unknown effect "${text}"`);
  return id;
}

function intRange(text: string | undefined, what: string, fallback: number, lo: number, hi: number): number {
  if (text === undefined) return fallback;
  if (!/^-?\d+$/.test(text)) throw syntax(`${what} must be an integer, got "${text}"`);
  const n = Number(text);
  if (n < lo || n > hi) throw failed(`${what} must be between ${lo} and ${hi}, got ${n}`);
  return n;
}

export function effect({ tokens, ctx, env }: Cmd): number {
  if (!tokens[2]) throw syntax('Usage: effect <target> clear [effect] | effect <target> <effect> [seconds] [amplifier] [hideParticles]');
  const targets = resolveTargets(tokens[1].text, ctx, env.world);
  if (tokens[2].text === 'clear') {
    const only = tokens[3] ? effectId(tokens[3].text) : null;
    if (!targets.length) {
      trace(env, ctx, `effect ${tokens[1].text}: no targets`, 'no_targets');
      return 0;
    }
    let n = 0;
    for (const e of targets) {
      const ids = Object.keys(e.effects).filter((k) => !only || k === only);
      if (!ids.length) continue;
      for (const id of ids) delete e.effects[id];
      env.emit({ type: 'change', tick: env.tick, line: env.line, target: label(e), what: `cleared effect(s) ${ids.join(', ')}` });
      n++;
    }
    if (!n) trace(env, ctx, 'effect clear: the targets have no such effect', 'failed');
    return n;
  }
  const id = effectId(tokens[2].text);
  const infinite = tokens[3]?.text === 'infinite';
  const seconds = infinite ? null : intRange(tokens[3]?.text, 'seconds', 30, 0, 1000000);
  const amplifier = intRange(tokens[4]?.text, 'amplifier', 0, 0, 255);
  const hide = tokens[5]?.text;
  if (hide !== undefined && hide !== 'true' && hide !== 'false') throw syntax(`hideParticles must be true or false, got "${hide}"`);
  if (tokens[6]) throw syntax(`effect: unexpected argument "${tokens[6].text}"`);
  if (!targets.length) {
    trace(env, ctx, `effect ${tokens[1].text}: no targets`, 'no_targets');
    return 0;
  }
  let n = 0;
  for (const e of targets) {
    if (INSTANT.has(id)) {
      if (e.maxHealth > 0) {
        if (id === 'instant_damage') applyDamage(env, e, 6 * 2 ** amplifier, 'magic');
        else applyHeal(env, e, 4 * 2 ** amplifier);
        n++;
      }
      continue;
    }
    if (seconds === 0) {
      if (!e.effects[id]) continue;
      delete e.effects[id];
      env.emit({ type: 'change', tick: env.tick, line: env.line, target: label(e), what: `removed effect ${id}` });
      n++;
      continue;
    }
    e.effects[id] = { amplifier, ticks: seconds === null ? null : seconds * 20, hideParticles: hide === 'true' };
    env.emit({
      type: 'change', tick: env.tick, line: env.line, target: label(e),
      what: `effect ${id} amplifier ${amplifier}, ${seconds === null ? 'infinite' : `${seconds}s`}${hide === 'true' ? ', particles hidden' : ''}`,
    });
    n++;
  }
  if (!n) trace(env, ctx, 'effect: nothing was changed', 'failed');
  return n;
}

export function gamerule({ tokens, ctx, env }: Cmd): number {
  const raw = tokens[1]?.text;
  if (!raw) throw new CommandError('unimplemented', 'Listing all game rules is not implemented; name a rule, for example /gamerule pvp');
  const rule = raw.toLowerCase();
  if (!(rule in GAMERULE_DEFAULTS)) throw syntax(`Unknown game rule "${raw}"`);
  if (tokens[2] === undefined) {
    feedback(env, `${rule} = ${env.world.gamerules[rule]}`);
    return 1;
  }
  if (tokens[3]) throw syntax(`gamerule: unexpected argument "${tokens[3].text}"`);
  const v = tokens[2].text;
  let value: boolean | number;
  if (isIntRule(rule)) {
    if (!/^-?\d+$/.test(v) || !Number.isSafeInteger(Number(v))) throw syntax(`${rule} needs an integer, got "${v}"`);
    value = Number(v) | 0;
    if (value < 0) throw failed(`${rule} cannot be negative`);
  } else {
    const l = v.toLowerCase();
    if (l !== 'true' && l !== 'false') throw syntax(`${rule} needs true or false, got "${v}"`);
    value = l === 'true';
  }
  const old = env.world.gamerules[rule];
  env.world.gamerules[rule] = value;
  env.emit({ type: 'change', tick: env.tick, line: env.line, target: 'gamerule', what: `${rule}: ${old} -> ${value}` });
  feedback(env, `Game rule ${rule} has been updated to ${value}`);
  void ctx;
  return 1;
}

export function titleraw({ src, tokens, ctx, env }: Cmd): number {
  if (!tokens[2]) throw syntax('Usage: titleraw <player> clear|reset|times <in> <stay> <out>|title|subtitle|actionbar <json>');
  const players = resolveTargets(tokens[1].text, ctx, env.world).filter((e) => e.type === 'minecraft:player');
  const slot = tokens[2].text;
  let text = '';
  if (slot === 'clear' || slot === 'reset') {
    if (tokens[3]) throw syntax(`titleraw ${slot}: unexpected argument "${tokens[3].text}"`);
  } else if (slot === 'times') {
    const t = [3, 4, 5].map((i) => intRange(tokens[i]?.text, 'time', NaN, 0, 1000000));
    if (t.some(Number.isNaN)) throw syntax('Usage: titleraw <player> times <fadeIn> <stay> <fadeOut>');
    text = t.join(' ');
  } else if (slot === 'title' || slot === 'subtitle' || slot === 'actionbar') {
    if (!tokens[3]) throw syntax(`titleraw ${slot}: missing raw json message`);
    const r = renderRawtext(parseJson(src.slice(tokens[3].start), 'titleraw'), ctx, env, 'titleraw');
    text = r.text;
    if (r.usedTranslate) trace(env, ctx, 'titleraw: translation keys are not looked up; the key itself is shown', 'unimplemented');
  } else {
    throw syntax(`titleraw: expected clear, reset, times, title, subtitle or actionbar, got "${slot}"`);
  }
  if (!players.length) {
    trace(env, ctx, `titleraw ${tokens[1].text}: no player matches`, 'no_targets');
    return 0;
  }
  for (const p of players) {
    env.emit({ type: 'screen', tick: env.tick, line: env.line, to: p.name ?? label(p), slot: slot as 'title', text });
  }
  return players.length;
}
