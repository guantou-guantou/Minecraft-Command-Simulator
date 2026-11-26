import { fmt, isCoordToken, readCoords, syntax, trace } from './args.ts';
import { executeCommand } from './commands.ts';
import type { Cmd } from './registry.ts';
import { CommandError, type Ctx, type Env } from './types.ts';
import type { Vec3 } from '../language/types.ts';

const failed = (m: string) => new CommandError('failed', m);
const MAX_DEPTH = 100;
const MAX_COMMANDS = 10000;

const feedback = (env: Env, text: string) => {
  if (env.world.gamerules.sendcommandfeedback !== false) env.emit({ type: 'chat', kind: 'system', tick: env.tick, line: env.line, sender: null, text });
};

/**
 * Runs the commands of a `function name:` block one after the other with the caller's executor and position.
 * A command that fails is reported and the rest still run. Returns how many commands succeeded.
 */
export function runFunction(name: string, ctx: Ctx, env: Env): number {
  const fn = env.functions.get(name);
  if (!fn) throw failed(`Function not found: ${name}`);
  const depth = env.fnDepth ?? 0;
  if (depth >= MAX_DEPTH) throw failed(`Function calls are nested more than ${MAX_DEPTH} deep (in ${name})`);
  const budget = env.fnBudget ?? { left: MAX_COMMANDS };
  let ok = 0;
  for (const c of fn.commands) {
    if (--budget.left < 0) throw failed(`Function ${name} ran more than ${MAX_COMMANDS} commands; stopped`);
    const inner: Env = { ...env, line: c.line, fnDepth: depth + 1, fnBudget: budget };
    try {
      if (executeCommand(c.text, ctx, inner) > 0) ok++;
    } catch (e) {
      if (!(e instanceof CommandError)) throw e;
      env.emit({ type: 'trace', tick: env.tick, line: c.line, branch: null, status: e.status, message: `function ${name}: ${e.message}` });
      env.emit({ type: 'chat', kind: 'error', tick: env.tick, line: c.line, sender: null, text: e.message });
    }
  }
  return ok;
}

export function functionCmd({ tokens, ctx, env }: Cmd): number {
  const name = tokens[1]?.text;
  if (!name) throw syntax('Usage: function <name>');
  if (tokens[2]) throw syntax(`function: unexpected argument "${tokens[2].text}"`);
  const ok = runFunction(name, ctx, env);
  feedback(env, `Executed ${ok} command${ok === 1 ? '' : 's'} from function '${name}'`);
  return 1;
}

/** `schedule on_area_loaded add ...`: the world is always loaded here, so the function runs on the next tick that is processed. */
export function schedule({ tokens, ctx, env }: Cmd): number {
  if (tokens[1]?.text !== 'on_area_loaded' || tokens[2]?.text !== 'add') throw syntax('Usage: schedule on_area_loaded add <circle|tickingarea|from to> ... <function>');
  const mid = (a: Vec3, b: Vec3): Vec3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  let pos: Vec3;
  let fn: string | undefined;
  let rest: number;
  const kind = tokens[3]?.text;
  if (kind === 'circle') {
    const c = readCoords(tokens, 4, ctx);
    pos = c.pos;
    const r = tokens[c.next]?.text;
    if (r === undefined || !/^\d+(\.\d+)?$/.test(r)) throw syntax('schedule circle: expected a radius');
    rest = c.next + 1;
  } else if (kind === 'tickingarea') {
    const area = env.world.tickingAreas.find((a) => a.name === tokens[4]?.text);
    if (!tokens[4]) throw syntax('schedule tickingarea: expected an area name');
    if (!area) throw failed(`Ticking area not found: ${tokens[4].text}`);
    pos = mid(area.from, area.to);
    rest = 5;
  } else if (isCoordToken(tokens[3])) {
    const a = readCoords(tokens, 3, ctx);
    const b = readCoords(tokens, a.next, ctx);
    pos = mid(a.pos, b.pos);
    rest = b.next;
  } else throw syntax('Usage: schedule on_area_loaded add <circle|tickingarea|from to> ... <function>');
  fn = tokens[rest]?.text;
  if (!fn) throw syntax('schedule: expected a function name');
  if (tokens[rest + 1]) throw syntax(`schedule: unexpected argument "${tokens[rest + 1].text}"`);
  if (!env.functions.has(fn)) throw failed(`Function not found: ${fn}`);
  env.world.scheduled.push({ tick: env.tick, fn, pos, line: env.line });
  trace(env, ctx, `schedule: function ${fn} will run when the area around ${fmt(pos)} is loaded (the next processed tick)`);
  feedback(env, `Scheduled function '${fn}' to run when the area is loaded`);
  return 1;
}