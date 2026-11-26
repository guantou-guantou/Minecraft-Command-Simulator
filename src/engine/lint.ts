import { splitTop } from '../language/parser.ts';
import type { Diagnostic, Program } from '../language/types.ts';
import { parseExpression, parsePlayAnimation } from './molang-commands.ts';
import { CommandError } from './types.ts';

/** Static checks of commands that the parser does not look into: the Molang in playanimation and the functions that `/function` and `/schedule` name. */
export function lintProgram(program: Program): Diagnostic[] {
  const out: Diagnostic[] = [];
  const known = new Set(program.functions.map((f) => f.name));
  const commands = [...program.chains.flatMap((c) => c.nodes.map((n) => ({ line: n.line, text: n.command }))), ...program.functions.flatMap((f) => f.commands)];
  for (const { line, text } of commands) {
    const tokens = splitTop(text, (c) => /\s/.test(c));
    const at = (name: string) => tokens.findIndex((t, k) => t.text === name && (k === 0 || tokens[k - 1].text === 'run'));
    const fn = at('function');
    const sched = at('schedule');
    const called = fn >= 0 ? tokens[fn + 1]?.text : sched >= 0 ? tokens[tokens.length - 1]?.text : undefined;
    if (called && !known.has(called) && (fn >= 0 || tokens[sched + 1]?.text === 'on_area_loaded')) out.push({ line, message: `Function ${called} not found.` });
    const i = at('playanimation');
    if (i < 0) continue;
    try {
      parseExpression(parsePlayAnimation(tokens.slice(i)).expression);
    } catch (e) {
      if (!(e instanceof CommandError)) throw e;
      out.push({ line, message: e.message });
    }
  }
  return out.sort((a, b) => a.line - b.line);
}