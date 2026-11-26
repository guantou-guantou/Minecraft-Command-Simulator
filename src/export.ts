import type { Chain } from './language/types.ts';

export function exportCommands(chain: Chain): string {
  return chain.nodes.map((n) => n.command).join('\n') + '\n';
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
    lines.push(n.command);
  });
  return lines.join('\n') + '\n';
}
