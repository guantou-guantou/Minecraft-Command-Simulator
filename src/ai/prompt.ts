import { createBuiltinRegistry } from '../engine/builtins.ts';
import { KNOWN_COMMANDS } from '../engine/known-commands.ts';
import { COMMANDS, SYNTAX_ONLY } from '../language/grammar.ts';

export type ReplyLanguage = 'en' | 'zh';

export interface PromptContext {
  /** The whole script, when the user allows it to be sent. */
  script?: string;
  /** Lines the user quoted, 1-based and inclusive. */
  quotes?: { text: string; fromLine: number; toLine: number }[];
  diagnostics?: { line: number; message: string }[];
}

/** The commands by how far the simulator supports them. */
export function commandLists(): { full: string[]; record: string[]; syntaxOnly: string[]; unimplemented: string[] } {
  const list = createBuiltinRegistry().list();
  const full = list.filter((s) => s.support === 'full').map((s) => s.name);
  const record = list.filter((s) => s.support === 'record').map((s) => s.name);
  const implemented = new Set(list.flatMap((s) => [s.name, ...(s.aliases ?? [])]));
  const syntaxOnly = Object.keys(SYNTAX_ONLY).filter((n) => !implemented.has(n));
  const unimplemented = [...KNOWN_COMMANDS].filter((n) => !implemented.has(n) && !(n in COMMANDS) && !(n in SYNTAX_ONLY));
  return { full: full.sort(), record: record.sort(), syntaxOnly: syntaxOnly.sort(), unimplemented: unimplemented.sort() };
}

const RULES = `You help write scripts for a Minecraft Bedrock Edition (NetEase China edition) command simulator. Never use Java Edition syntax.

# Script basics
- A script is plain text. Every command inside a chain, function or test body starts with "/".
- Declarations: \`name = ent(type=..., pos=(x, y, z), name=..., tags=["a"])\`, \`block(type=..., pos=(x, y, z))\`, \`item(target=name, slot=..., type=...)\`.
- Command block chains: \`chain a at (x, y, z):\` followed by indented lines. Put \`cb(mode=imp|cha|rep, power=always_on|needs_redstone, conditional=true|false, delay=N)\` on its own line before a command to set that block. The first block of a chain is an impulse block unless set; the others are chain blocks. Only the first block may be impulse or repeating.
- Chains cannot be nested. \`pass\` is an empty command block: it passes the chain on but counts as failed.
- Break chains: inside a chain write \`if:\` (a detector; its LAST command decides) and \`run:\` (blocks that run once when it succeeds). A \`run:\` may end with another \`if:\`/\`run:\` pair.
- Functions: \`function pack/name:\` with an indented body, one "/command" per line. Tests: \`test name:\` with \`run chain\`, \`expect ...\` lines.
- The interface language never changes the script: commands and names stay in English.

# Rules
- Use Bedrock selectors (\`@e[type=zombie,tag=x,r=5]\`). Never use Java NBT selectors. Do not use /data, /attribute, /bossbar or other Java-only commands.
- x/z written without a decimal point are block centres.
- Use only the commands listed below. "recorded" commands are checked but have no effect in the simulator.

# Output
- Reply with one fenced code block that contains only script text: a complete script, or only the lines that replace the quoted selection. Keep explanations outside the block and short.
- Before answering, check for unknown commands, selector syntax, chain/cb rules and missing leading "/".`;

const fence = (text: string) => {
  const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map((m) => m.length));
  const f = '`'.repeat(longest + 1);
  return `${f}\n${text}\n${f}`;
};

function commandSection(): string {
  const c = commandLists();
  return [
    '# Supported commands',
    `Fully simulated: ${c.full.join(', ')}`,
    `Recorded only (checked, no effect): ${c.record.join(', ')}`,
    c.syntaxOnly.length ? `Syntax checked only: ${c.syntaxOnly.join(', ')}` : '',
    `Not implemented (do not use): ${c.unimplemented.join(', ')}`,
  ].filter(Boolean).join('\n');
}

export function contextSection(ctx: PromptContext): string {
  const parts: string[] = [];
  if (ctx.script !== undefined) parts.push(`## Current script\n${fence(ctx.script)}`);
  for (const q of ctx.quotes ?? []) parts.push(`## Quoted lines ${q.fromLine}-${q.toLine}\n${fence(q.text)}`);
  if (ctx.diagnostics?.length) parts.push(`## Problems the simulator reports\n${ctx.diagnostics.map((d) => `- line ${d.line}: ${d.message}`).join('\n')}`);
  return parts.length ? `# Context\n${parts.join('\n\n')}` : '';
}

const LANGUAGE: Record<ReplyLanguage, string> = {
  en: 'Reply in English. The script itself stays English.',
  zh: 'Reply in Chinese (简体中文). The script itself stays English.',
};

/** The system prompt: fixed rules, the generated command list, the context the user chose to send, and the reply language. */
export function buildSystemPrompt(language: ReplyLanguage, ctx: PromptContext = {}): string {
  return [RULES, commandSection(), contextSection(ctx), LANGUAGE[language]].filter(Boolean).join('\n\n');
}