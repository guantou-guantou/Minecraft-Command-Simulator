import { syntax } from './args.ts';
import { holders } from './scoreboard.ts';
import { resolveTargets } from './selector.ts';
import { label, type Ctx, type Env } from './types.ts';

export function parseJson(text: string, what: string): unknown {
  try {
    return JSON.parse(text);
  } catch (e) {
    throw syntax(`${what}: invalid JSON (${(e as Error).message})`);
  }
}

type Part = Record<string, unknown>;

function renderParts(list: unknown, ctx: Ctx, env: Env, what: string, flags: { usedTranslate: boolean }): string[] {
  if (!Array.isArray(list)) throw syntax(`${what}: rawtext must be a list`);
  return list.map((part: Part) => renderPart(part, ctx, env, what, flags));
}

function renderPart(part: Part, ctx: Ctx, env: Env, what: string, flags: { usedTranslate: boolean }): string {
  if (typeof part?.text === 'string') return part.text;
  if (typeof part?.selector === 'string') return resolveTargets(part.selector, ctx, env.world).map((e) => e.name ?? label(e)).join(', ');
  const score = part?.score as { name?: string; objective?: string } | undefined;
  if (score?.name && score.objective) {
    const holder = score.name === '*' ? ctx.executor && `e:${ctx.executor.id}` : holders(score.name, ctx, env.world)[0];
    const v = holder ? env.world.scores.get(score.objective)?.get(holder) : undefined;
    return v === undefined ? '' : String(v);
  }
  if (typeof part?.translate === 'string') {
    flags.usedTranslate = true;
    const w = part.with;
    const args = Array.isArray(w)
      ? w.map(String)
      : w && typeof w === 'object' && 'rawtext' in w
        ? renderParts((w as { rawtext: unknown }).rawtext, ctx, env, what, flags)
        : [];
    let next = 0;
    return part.translate.replace(/%(?:(\d+)\$)?s/g, (_m, n?: string) => args[n ? Number(n) - 1 : next++] ?? '');
  }
  throw syntax(`${what}: unsupported rawtext component ${JSON.stringify(part)}`);
}

export function renderRawtext(json: unknown, ctx: Ctx, env: Env, what: string): { text: string; usedTranslate: boolean } {
  const list = (json as { rawtext?: unknown })?.rawtext;
  if (!Array.isArray(list)) throw syntax(`${what}: expected {"rawtext":[...]} (Java style JSON text is not supported)`);
  const flags = { usedTranslate: false };
  return { text: renderParts(list, ctx, env, what, flags).join(''), usedTranslate: flags.usedTranslate };
}
