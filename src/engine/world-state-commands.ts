import { box, checkVolume, floorVec, fmt, isCoordToken, readCoords, sameBlock, syntax, trace } from './args.ts';
import { TIME_NAMES, dayNumber, daytime, setDaytime } from './clock.ts';
import type { Cmd } from './registry.ts';
import { resolveTargets } from './selector.ts';
import { CommandError, label, type Difficulty, type Entity, type Env, type Weather } from './types.ts';
import type { Vec3 } from '../language/types.ts';

const failed = (m: string) => new CommandError('failed', m);
const isPlayer = (e: Entity) => e.type === 'minecraft:player';
const chat = (env: Env, text: string, to?: string) => env.emit({ type: 'chat', kind: 'system', tick: env.tick, line: env.line, sender: null, text, ...(to ? { to } : {}) });
const change = (env: Env, target: string, what: string) => env.emit({ type: 'change', tick: env.tick, line: env.line, target, what });

function int(text: string | undefined, what: string, lo: number, hi: number): number {
  if (text === undefined || !/^-?\d+$/.test(text)) throw syntax(`${what} must be an integer, got "${text ?? ''}"`);
  const n = Number(text);
  if (n < lo || n > hi) throw syntax(`${what} must be between ${lo} and ${hi}, got ${n}`);
  return n;
}

function num(text: string | undefined, what: string, lo: number, hi: number): number {
  if (text === undefined || !/^-?(\d+\.?\d*|\.\d+)$/.test(text)) throw syntax(`${what} must be a number, got "${text ?? ''}"`);
  const n = Number(text);
  if (n < lo || n > hi) throw syntax(`${what} must be between ${lo} and ${hi}, got ${n}`);
  return n;
}

export function time({ tokens, env }: Cmd): number {
  const sub = tokens[1]?.text;
  const w = env.world;
  if (sub === 'set') {
    const a = tokens[2]?.text;
    if (a === undefined) throw syntax('Usage: time set <ticks|day|noon|sunset|night|midnight|sunrise>');
    if (tokens[3]) throw syntax(`time set: unexpected argument "${tokens[3].text}"`);
    const value = a in TIME_NAMES ? TIME_NAMES[a] : int(a, 'time', 0, 2147483647);
    setDaytime(w, value);
    chat(env, `Set the time to ${daytime(w)}`);
    return 1;
  }
  if (sub === 'add') {
    const n = int(tokens[2]?.text, 'amount', -2147483647, 2147483647);
    if (tokens[3]) throw syntax(`time add: unexpected argument "${tokens[3].text}"`);
    w.time = Math.max(0, w.time + n);
    chat(env, `Added ${n} to the time`);
    return 1;
  }
  if (sub === 'query') {
    const what = tokens[2]?.text;
    if (tokens[3]) throw syntax(`time query: unexpected argument "${tokens[3].text}"`);
    if (what === 'daytime') chat(env, `Daytime is ${daytime(w)}`);
    else if (what === 'gametime') chat(env, `The game time is ${w.gameTime}`);
    else if (what === 'day') chat(env, `Day is ${dayNumber(w)}`);
    else throw syntax('time query: expected daytime, gametime or day');
    return 1;
  }
  throw syntax('Usage: time set <value> | time add <amount> | time query daytime|gametime|day');
}

const WEATHERS: Weather[] = ['clear', 'rain', 'thunder'];
const WEATHER_TEXT: Record<Weather, string> = { clear: 'Changing to clear weather', rain: 'Changing to rainy weather', thunder: 'Changing to rain and thunder' };

export function weather({ tokens, env }: Cmd): number {
  const a = tokens[1]?.text;
  const w = env.world;
  if (a === 'query') {
    if (tokens[2]) throw syntax(`weather query: unexpected argument "${tokens[2].text}"`);
    chat(env, `Weather is ${w.weather}`);
    return 1;
  }
  if (!a || !WEATHERS.includes(a as Weather)) throw syntax('Usage: weather clear|rain|thunder [duration] | weather query');
  const duration = tokens[2] ? int(tokens[2].text, 'duration', 1, 1000000) : 0;
  if (tokens[3]) throw syntax(`weather: unexpected argument "${tokens[3].text}"`);
  w.weather = a as Weather;
  w.weatherTicks = a === 'clear' ? 0 : duration;
  chat(env, WEATHER_TEXT[a as Weather]);
  return 1;
}

const DIFFICULTIES: Record<string, Difficulty> = {
  peaceful: 'peaceful', p: 'peaceful', '0': 'peaceful', easy: 'easy', e: 'easy', '1': 'easy', normal: 'normal', n: 'normal', '2': 'normal', hard: 'hard', h: 'hard', '3': 'hard',
};

export function difficulty({ tokens, env }: Cmd): number {
  const d = DIFFICULTIES[tokens[1]?.text ?? ''];
  if (!d) throw syntax('Usage: difficulty peaceful|easy|normal|hard (or 0 to 3)');
  if (tokens[2]) throw syntax(`difficulty: unexpected argument "${tokens[2].text}"`);
  env.world.difficulty = d;
  chat(env, `Set game difficulty to ${d[0].toUpperCase()}${d.slice(1)}`);
  return 1;
}

export function daylock({ tokens, env }: Cmd): number {
  const a = tokens[1]?.text;
  if (a !== undefined && a !== 'true' && a !== 'false') throw syntax(`daylock: expected true or false, got "${a}"`);
  if (tokens[2]) throw syntax(`daylock: unexpected argument "${tokens[2].text}"`);
  const lock = a !== 'false';
  env.world.gamerules.dodaylightcycle = !lock;
  chat(env, lock ? 'Day-Night cycle locked' : 'Day-Night cycle unlocked');
  return 1;
}

const players = (text: string, cmd: Cmd) => resolveTargets(text, cmd.ctx, cmd.env.world).filter(isPlayer);

export function spawnpoint(cmd: Cmd): number {
  const { tokens, ctx, env } = cmd;
  let i = 1;
  let targets: Entity[];
  if (tokens[1] && !isCoordToken(tokens[1])) {
    targets = players(tokens[1].text, cmd);
    i = 2;
  } else if (ctx.executor && isPlayer(ctx.executor)) targets = [ctx.executor];
  else throw failed('spawnpoint: no player given and the executor is not a player');
  let pos: Vec3 | null = null;
  if (tokens[i]) {
    if (!isCoordToken(tokens[i])) throw syntax(`spawnpoint: expected a position, got "${tokens[i].text}"`);
    const r = readCoords(tokens, i, ctx);
    pos = floorVec(r.pos);
    i = r.next;
  }
  if (tokens[i]) throw syntax(`spawnpoint: unexpected argument "${tokens[i].text}"`);
  if (!targets.length) {
    trace(env, ctx, `spawnpoint ${tokens[1]?.text}: no player matches`, 'no_targets');
    return 0;
  }
  for (const p of targets) {
    p.spawn = pos ?? floorVec(p.pos);
    chat(env, `Set ${p.name ?? label(p)}'s spawn point to (${p.spawn.join(', ')})`);
    change(env, label(p), `spawn point ${fmt(p.spawn)}`);
  }
  return targets.length;
}

export function setworldspawn({ tokens, ctx, env }: Cmd): number {
  let pos: Vec3 = floorVec(ctx.pos);
  if (tokens[1]) {
    if (!isCoordToken(tokens[1])) throw syntax(`setworldspawn: expected a position, got "${tokens[1].text}"`);
    const r = readCoords(tokens, 1, ctx);
    if (tokens[r.next]) throw syntax(`setworldspawn: unexpected argument "${tokens[r.next].text}"`);
    pos = floorVec(r.pos);
  }
  env.world.spawn = pos;
  chat(env, `Set world spawn point to (${pos.join(', ')})`);
  return 1;
}

export function clearspawnpoint(cmd: Cmd): number {
  const { tokens, ctx, env } = cmd;
  if (tokens[2]) throw syntax(`clearspawnpoint: unexpected argument "${tokens[2].text}"`);
  let targets: Entity[];
  if (tokens[1]) targets = players(tokens[1].text, cmd);
  else if (ctx.executor && isPlayer(ctx.executor)) targets = [ctx.executor];
  else throw failed('clearspawnpoint: no player given and the executor is not a player');
  if (!targets.length) {
    trace(env, ctx, `clearspawnpoint ${tokens[1]?.text}: no player matches`, 'no_targets');
    return 0;
  }
  for (const p of targets) {
    p.spawn = null;
    chat(env, `Cleared spawn point for ${p.name ?? label(p)}`);
    change(env, label(p), 'spawn point cleared');
  }
  return targets.length;
}

/** `playsound` has no audio: it checks the arguments and records which players would hear the sound. */
export function playsound(cmd: Cmd): number {
  const { tokens, ctx, env } = cmd;
  const sound = tokens[1]?.text;
  if (!sound) throw syntax('Usage: playsound <sound> [player] [position] [volume] [pitch] [minimumVolume]');
  let i = 2;
  let targets: Entity[];
  if (tokens[i] && !isCoordToken(tokens[i])) targets = players(tokens[i++].text, cmd);
  else if (ctx.executor && isPlayer(ctx.executor)) targets = [ctx.executor];
  else throw failed('playsound: no player given and the executor is not a player');
  let pos: Vec3 | null = null;
  if (tokens[i] && isCoordToken(tokens[i]) && isCoordToken(tokens[i + 1]) && isCoordToken(tokens[i + 2])) {
    const r = readCoords(tokens, i, ctx);
    pos = r.pos;
    i = r.next;
  }
  const volume = tokens[i] ? num(tokens[i++].text, 'volume', 0, 3.4028235e38) : 1;
  const pitch = tokens[i] ? num(tokens[i++].text, 'pitch', 0, 256) : 1;
  const minVolume = tokens[i] ? num(tokens[i++].text, 'minimumVolume', 0, 1) : 0;
  if (tokens[i]) throw syntax(`playsound: unexpected argument "${tokens[i].text}"`);
  if (!targets.length) {
    trace(env, ctx, 'playsound: no player matches', 'no_targets');
    return 0;
  }
  for (const p of targets) {
    change(env, label(p), `hears ${sound} (volume ${volume}, pitch ${pitch}${minVolume ? `, minimum ${minVolume}` : ''})${pos ? ` at ${fmt(pos)}` : ''}`);
  }
  trace(env, ctx, 'playsound: sounds are not played; the command is only recorded', 'unimplemented');
  return targets.length;
}

/** `tell` (also `msg` and `w`): a private message, shown the way the game shows whispers. */
export function tell(cmd: Cmd): number {
  const { src, tokens, ctx, env } = cmd;
  if (!tokens[2]) throw syntax('Usage: tell <player> <message>');
  const message = src.slice(tokens[2].start);
  const targets = players(tokens[1].text, cmd);
  if (!targets.length) {
    trace(env, ctx, `tell ${tokens[1].text}: no player matches`, 'no_targets');
    return 0;
  }
  const sender = ctx.executor ? (ctx.executor.name ?? label(ctx.executor)) : '@';
  for (const p of targets) {
    const name = p.name ?? label(p);
    chat(env, `<${sender}> \u00a7o${sender} whispers to you: ${message}\u00a7r`, name);
    if (ctx.executor && isPlayer(ctx.executor)) chat(env, `You whisper to ${name}: ${message}`, sender);
  }
  return targets.length;
}

export function testforblocks({ tokens, ctx, env }: Cmd): number {
  const a = readCoords(tokens, 1, ctx);
  const b = readCoords(tokens, a.next, ctx);
  const d = readCoords(tokens, b.next, ctx);
  const mode = tokens[d.next]?.text ?? 'all';
  if (mode !== 'all' && mode !== 'masked') throw syntax('testforblocks: expected all or masked');
  if (tokens[d.next + 1]) throw syntax(`testforblocks: unexpected argument "${tokens[d.next + 1].text}"`);
  const src3 = box(floorVec(a.pos), floorVec(b.pos));
  checkVolume(src3.volume);
  const dst = floorVec(d.pos);
  let compared = 0;
  for (let x = src3.min[0]; x <= src3.max[0]; x++) {
    for (let y = src3.min[1]; y <= src3.max[1]; y++) {
      for (let z = src3.min[2]; z <= src3.max[2]; z++) {
        const p: Vec3 = [x, y, z];
        const s = env.world.getBlockData(p);
        if (mode === 'masked' && s.id === 'minecraft:air') continue;
        const q = p.map((v, k) => v - src3.min[k] + dst[k]) as Vec3;
        if (!sameBlock(s, env.world.getBlockData(q))) throw failed('Source and destination regions do not match');
        compared++;
      }
    }
  }
  trace(env, ctx, `${compared} blocks compared`, null);
  return Math.max(1, compared);
}
