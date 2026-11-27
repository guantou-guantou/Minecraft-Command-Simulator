import type { Chain, FunctionDecl, Program } from './language/types.ts';

export function exportCommands(chain: Chain): string {
  return chain.nodes.filter((n) => n.command).map((n) => n.command).join('\n') + '\n';
}

/** One chain keeps the plain format; several chains get a # chain name heading each. */
function joinChains(chains: Chain[], one: (c: Chain) => string, heading: boolean): string {
  if (chains.length === 1) return one(chains[0]);
  return chains.map((c) => (heading ? `# chain ${c.name}\n${one(c)}` : one(c))).join('\n');
}

export const exportAllCommands = (chains: Chain[]) => joinChains(chains, exportCommands, true);
/** Every manifest entry already starts with its own # chain line. */
export const exportAllManifest = (chains: Chain[]) => joinChains(chains, exportManifest, false);

export function exportManifest(chain: Chain): string {
  const place = chain.positioned ? ` at (${chain.position.join(', ')}) facing ${chain.facing}` : ' (no position)';
  const lines = [`# chain ${chain.name}${place} rotation (${chain.rotation.join(', ')})`];
  chain.nodes.forEach((n, i) => {
    const { mode, power, conditional, delay } = n.cb;
    const at = n.pos ? ` | at (${n.pos.join(', ')})` : '';
    lines.push(`[${i + 1}] ${mode} | ${power} | ${conditional ? 'conditional' : 'unconditional'} | delay ${delay} | facing ${n.facing}${at}`);
    lines.push(n.command || 'pass');
  });
  return lines.join('\n') + '\n';
}

export interface FunctionFile {
  /** Relative path with forward slashes, e.g. pack/start.mcfunction. */
  path: string;
  content: string;
}

/** The body of a function as a .mcfunction file: one command per line, without the leading slash. */
export function mcfunctionText(fn: FunctionDecl): string {
  return fn.commands.map((c) => c.text.trim().replace(/^\//, '')).filter(Boolean).join('\n') + '\n';
}

/** One .mcfunction file per function; the name's slashes make sub folders. */
export function exportFunctionFiles(program: Program): FunctionFile[] {
  return program.functions.map((f) => {
    if (f.name.split('/').some((p) => !p || p === '.' || p === '..')) throw new Error(`Bad function name "${f.name}"`);
    return { path: `${f.name}.mcfunction`, content: mcfunctionText(f) };
  });
}

/** What an export that leaves functions out should warn about: every defined function, and which of them the given commands call. */
export function functionWarning(program: Program, commands: string[] = []): { defined: string[]; called: string[] } {
  const defined = program.functions.map((f) => f.name);
  const called = defined.filter((n) => commands.some((c) => new RegExp(`(^|[\\s/])function\\s+${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`).test(c)));
  return { defined, called };
}