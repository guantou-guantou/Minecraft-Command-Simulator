import { logicalLines, stripComment } from './lines.ts';
import { splitTop } from './parser.ts';

const BREAK_BEFORE = new Set(['rotated', 'positioned', 'facing', 'align', 'anchored', 'in', 'as', 'at', 'if', 'unless', 'run']);
const GLUE_AFTER = new Set(['rotated', 'positioned', 'facing', 'entity']);

/**
 * Splits a long /execute command into lines that end with a backslash. Lines only break before execute
 * subcommands, and everything after `run` stays together. Other commands are returned unchanged.
 */
export function wrapCommand(command: string, width = 100, indent = '    '): string[] {
  const trimmed = command.trim();
  const lead = command.slice(0, command.length - command.trimStart().length);
  const body = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;
  const tokens = splitTop(body, (c) => /\s/.test(c)).map((t) => t.text);
  if (tokens[0] === 'playanimation') return wrapPlayAnimation(command, width, indent);
  if (tokens[0] !== 'execute') return [command];
  const units: string[][] = [[tokens[0]]];
  let inRun = false;
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (!inRun && BREAK_BEFORE.has(t) && !GLUE_AFTER.has(tokens[i - 1]) && tokens[i - 1] !== 'execute') {
      units.push([t]);
      if (t === 'run') inRun = true;
    } else units[units.length - 1].push(t);
  }
  const prefix = trimmed.startsWith('/') ? '/' : '';
  const lines: string[] = [];
  let cur = `${lead}${prefix}${units[0].join(' ')}`;
  for (const unit of units.slice(1)) {
    const text = unit.join(' ');
    if (cur.length + 1 + text.length + 2 > width && cur.trim().length > 0 && cur !== `${lead}${prefix}execute`) {
      lines.push(`${cur} \\`);
      cur = `${lead}${indent}${text}`;
    } else cur = `${cur} ${text}`;
  }
  lines.push(cur);
  return lines;
}

/** Splits a long quoted Molang argument after its semicolons; the joined text only gains spaces after ;. */
function wrapPlayAnimation(command: string, width: number, indent: string): string[] {
  if (command.length <= width) return [command];
  const open = command.indexOf('"');
  const close = command.lastIndexOf('"');
  if (open < 0 || close <= open) return [command];
  const head = command.slice(0, open + 1);
  const tail = command.slice(close);
  const pieces = command.slice(open + 1, close).split(/(?<=;)/).map((p) => p.trim()).filter(Boolean);
  if (pieces.length < 2) return [command];
  const lead = command.slice(0, command.length - command.trimStart().length);
  const lines: string[] = [];
  let cur = head;
  let first = true;
  for (const piece of pieces) {
    const sep = first ? '' : ' ';
    if (cur.length + sep.length + piece.length + 2 > width) {
      lines.push(`${cur} \\`);
      cur = `${lead}${indent}${piece}`;
    } else cur += sep + piece;
    first = false;
  }
  lines.push(cur + tail);
  return lines;
}

/** Wraps every standalone command line (no trailing comment, not already continued) that exceeds `width`. */
export function wrapScript(source: string, width = 100): string {
  const physical = source.split(/\r?\n/);
  const out: string[] = [];
  for (const l of logicalLines(source)) {
    const raw = physical.slice(l.physical, l.physical + l.count);
    const only = raw[0];
    if (l.count === 1 && only.trim().startsWith('/') && stripComment(only) === only && only.length > width) out.push(...wrapCommand(only, width));
    else out.push(...raw);
  }
  return out.join('\n');
}

/** Joins every continued line back into a single line. Lines whose backslash is followed by a comment are left alone. */
export function joinScript(source: string): string {
  return source.replace(/[ \t]*\\[ \t]*\r?\n[ \t]*/g, ' ');
}