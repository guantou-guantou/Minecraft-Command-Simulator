import { splitTop } from '../language/parser.ts';
import type { Diagnostic, Program } from '../language/types.ts';
import { parseExpression, parsePlayAnimation } from './molang-commands.ts';
import { CommandError } from './types.ts';

/** Static checks of commands that the parser does not look into: currently the Molang in playanimation. */
export function lintProgram(program: Program): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const chain of program.chains) {
    for (const node of chain.nodes) {
      const tokens = splitTop(node.command, (c) => /\s/.test(c));
      const i = tokens.findIndex((t, k) => t.text === 'playanimation' && (k === 0 || tokens[k - 1].text === 'run'));
      if (i < 0) continue;
      try {
        parseExpression(parsePlayAnimation(tokens.slice(i)).expression);
      } catch (e) {
        if (!(e instanceof CommandError)) throw e;
        out.push({ line: node.line, message: e.message });
      }
    }
  }
  return out;
}