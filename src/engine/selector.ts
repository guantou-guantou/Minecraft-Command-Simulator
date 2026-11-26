import { normalizeId, splitTop, unquote } from '../language/parser.ts';
import { FAMILIES, HITBOX } from './entity-data.ts';
import { hasItemFilter } from './inventory.ts';
import { inRange } from './range.ts';
import { CommandError, type Ctx, type Entity } from './types.ts';
import type { Vec3 } from '../language/types.ts';
import type { World } from './world.ts';

const syntax = (m: string) => new CommandError('syntax_error', m);
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const isPlayer = (e: Entity) => e.type === 'minecraft:player';

function num(v: string, what: string): number {
  const n = Number(v);
  if (v === '' || !Number.isFinite(n)) throw syntax(`Selector argument ${what} must be a number, got "${v}"`);
  return n;
}

/** A coordinate: a number, or ~ / ~offset relative to the execution position. */
function coord(v: string, base: number, what: string): number {
  if (v.startsWith('~')) return base + (v.length > 1 ? num(v.slice(1), what) : 0);
  return num(v, what);
}

const MODES: Record<string, string> = {
  survival: 'survival', s: 'survival', '0': 'survival', creative: 'creative', c: 'creative', '1': 'creative',
  adventure: 'adventure', a: 'adventure', '2': 'adventure', default: 'default', d: 'default', '5': 'default', spectator: 'spectator', '6': 'spectator',
};

const UNIQUE = new Set(['x', 'y', 'z', 'dx', 'dy', 'dz', 'r', 'rm', 'l', 'lm', 'm', 'c', 'rx', 'rxm', 'ry', 'rym', 'scores', 'haspermission']);
const KINDS = new Set(['a', 'e', 'p', 's', 'n', 'r']);

const wrap180 = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;

/** `a=1..5,b=!3` or `{...}`-style bodies: key=value pairs split at top level commas. */
function pairs(body: string, what: string): [string, string][] {
  const inner = body.trim().replace(/^\{/, '').replace(/\}$/, '');
  return splitTop(inner, (c) => c === ',').flatMap((p) => {
    if (!p.text.trim()) return [];
    const eq = p.text.indexOf('=');
    if (eq < 0) throw syntax(`Selector argument ${what}: expected name=value, got "${p.text.trim()}"`);
    return [[p.text.slice(0, eq).trim(), p.text.slice(eq + 1).trim()] as [string, string]];
  });
}

export function resolveTargets(text: string, ctx: Ctx, world: World): Entity[] {
  if (!text.startsWith('@')) {
    const name = unquote(text);
    return world.entities.filter((e) => e.name === name);
  }
  const m = /^@([a-z]+)(?:\[(.*)\])?$/s.exec(text);
  if (!m) throw syntax(`Invalid selector: ${text}`);
  const kind = m[1];
  if (!KINDS.has(kind)) throw new CommandError('unimplemented', `Selector @${kind} is not implemented`);

  const args: { k: string; raw: string; neg: boolean }[] = [];
  for (const p of splitTop(m[2] ?? '', (c) => c === ',')) {
    const eq = p.text.indexOf('=');
    if (eq < 0) throw syntax(`Invalid selector argument "${p.text.trim()}"`);
    let raw = p.text.slice(eq + 1).trim();
    const neg = raw.startsWith('!');
    if (neg) raw = raw.slice(1);
    args.push({ k: p.text.slice(0, eq).trim(), raw, neg });
  }
  const seen = new Set<string>();
  for (const a of args) {
    if (UNIQUE.has(a.k) && seen.has(a.k)) throw syntax(`Selector argument "${a.k}" can only be given once`);
    seen.add(a.k);
    if (a.neg && !['name', 'type', 'tag', 'family', 'hasitem', 'm'].includes(a.k)) throw syntax(`Selector argument "${a.k}" cannot be negated`);
  }
  const get = (k: string) => args.find((a) => a.k === k);

  let pool: Entity[];
  if (kind === 'a' || kind === 'p') pool = world.entities.filter(isPlayer);
  else if (kind === 'r') pool = args.some((a) => a.k === 'type' && !a.neg) ? world.entities : world.entities.filter(isPlayer);
  else if (kind === 's') {
    if (!ctx.executor) throw new CommandError('failed', '@s has no executor here');
    pool = [ctx.executor];
  } else pool = world.entities;

  const origin: Vec3 = [
    get('x') ? coord(get('x')!.raw, ctx.pos[0], 'x') : ctx.pos[0],
    get('y') ? coord(get('y')!.raw, ctx.pos[1], 'y') : ctx.pos[1],
    get('z') ? coord(get('z')!.raw, ctx.pos[2], 'z') : ctx.pos[2],
  ];
  const filters: ((e: Entity) => boolean)[] = [];
  let count: number | null = kind === 'p' || kind === 'n' || kind === 'r' ? 1 : null;
  let sortNearest = kind === 'p' || kind === 'n';

  for (const a of args) {
    const v = unquote(a.raw);
    switch (a.k) {
      case 'x': case 'y': case 'z': break;
      case 'name': filters.push((e) => (e.name === v) !== a.neg); break;
      case 'type': filters.push((e) => (e.type === normalizeId(v)) !== a.neg); break;
      case 'tag': filters.push((e) => (v === '' ? (e.tags.size > 0) === a.neg : e.tags.has(v) !== a.neg)); break;
      case 'family':
        filters.push((e) => {
          const fam = FAMILIES[e.type];
          if (!fam) throw new CommandError('unimplemented', `Selector family: no family data for ${e.type.replace('minecraft:', '')}`);
          return fam.includes(v) !== a.neg;
        });
        break;
      case 'hasitem': {
        const has = hasItemFilter(a.raw);
        filters.push((e) => has(e) !== a.neg);
        break;
      }
      case 'c': {
        const n = Math.trunc(num(v, 'c'));
        if (n === 0) throw syntax('Selector argument "c" cannot be 0');
        count = n;
        sortNearest = true;
        break;
      }
      case 'r': { const r = num(v, 'r'); filters.push((e) => dist(e.pos, origin) <= r); break; }
      case 'rm': { const r = num(v, 'rm'); filters.push((e) => dist(e.pos, origin) >= r); break; }
      case 'dx': case 'dy': case 'dz': break;
      case 'l': { const n = num(v, 'l'); filters.push((e) => isPlayer(e) && e.xpLevel <= n); break; }
      case 'lm': { const n = num(v, 'lm'); filters.push((e) => isPlayer(e) && e.xpLevel >= n); break; }
      case 'm': {
        const mode = MODES[v];
        if (!mode) throw syntax(`Selector argument m: unknown game mode "${v}"`);
        filters.push((e) => isPlayer(e) && (e.gamemode === mode) !== a.neg);
        break;
      }
      case 'rx': { const n = num(v, 'rx'); filters.push((e) => e.rot[1] <= n); break; }
      case 'rxm': { const n = num(v, 'rxm'); filters.push((e) => e.rot[1] >= n); break; }
      case 'ry': case 'rym': {
        const n = wrap180(num(v, a.k));
        const other = a.k === 'ry' ? get('rym') : get('ry');
        const hi = a.k === 'ry' ? n : other ? wrap180(num(unquote(other.raw), 'ry')) : null;
        const lo = a.k === 'rym' ? n : other ? wrap180(num(unquote(other.raw), 'rym')) : null;
        if (a.k === 'ry' || !get('ry')) {
          filters.push((e) => {
            const y = wrap180(e.rot[0]);
            if (lo !== null && hi !== null) return lo <= hi ? y >= lo && y <= hi : y >= lo || y <= hi;
            return hi !== null ? y <= hi : y >= lo!;
          });
        }
        break;
      }
      case 'scores': {
        const conds = pairs(a.raw, 'scores');
        for (const [obj] of conds) if (!world.scores.has(obj)) throw new CommandError('failed', `Objective "${obj}" does not exist`);
        filters.push((e) =>
          conds.every(([obj, range]) => {
            const s = world.scores.get(obj)!.get(`e:${e.id}`);
            return s !== undefined && inRange(s, range);
          }),
        );
        break;
      }
      case 'haspermission': {
        const conds = pairs(a.raw, 'haspermission');
        for (const [, st] of conds) if (st !== 'enabled' && st !== 'disabled') throw syntax(`Selector haspermission: state must be enabled or disabled, got "${st}"`);
        filters.push((e) => isPlayer(e) && conds.every(([perm, st]) => (e.inputs[perm] ?? 'enabled') === st));
        break;
      }
      default:
        throw new CommandError('unimplemented', `Selector argument "${a.k}" is not implemented`);
    }
  }

  const box = args.some((a) => a.k === 'dx' || a.k === 'dy' || a.k === 'dz');
  if (box) {
    const span = (k: 'dx' | 'dy' | 'dz', o: number, rawOrigin: string | undefined) => {
      const d = get(k) ? num(unquote(get(k)!.raw), k) : 0;
      const whole = rawOrigin === undefined || Number.isInteger(Number(rawOrigin.replace(/^~/, '') || 0));
      return [Math.min(o, o + d), Math.max(o, o + d) + (whole ? 1 : 0)] as [number, number];
    };
    const bx = span('dx', origin[0], get('x')?.raw);
    const by = span('dy', origin[1], get('y')?.raw);
    const bz = span('dz', origin[2], get('z')?.raw);
    filters.push((e) => {
      const [w, h] = HITBOX[e.type] ?? [0, 0];
      const overlap = (lo: number, hi: number, a: number, b: number) => b >= lo && a <= hi && (a < hi || a === b);
      return (
        overlap(bx[0], bx[1], e.pos[0] - w / 2, e.pos[0] + w / 2) &&
        overlap(by[0], by[1], e.pos[1], e.pos[1] + h) &&
        overlap(bz[0], bz[1], e.pos[2] - w / 2, e.pos[2] + w / 2)
      );
    });
  }

  let result = pool.filter((e) => filters.every((f) => f(e)));
  if (kind === 'r') {
    const shuffled = [...result];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(world.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    result = shuffled;
  } else if (sortNearest) {
    const nearFirst = (count ?? 1) > 0;
    result = [...result].sort((a, b) => (dist(a.pos, origin) - dist(b.pos, origin)) * (nearFirst ? 1 : -1));
  }
  if (count === null) return result;
  return result.slice(0, Math.abs(count));
}