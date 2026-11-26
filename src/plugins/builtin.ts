import { PluginHost } from './host.ts';
import { fmbePlugin } from './fmbe/index.tsx';
import { nxTreePlugin } from './nxtree/index.tsx';
import { particlePlugin } from './particles/index.tsx';
import { scoreboardPlugin } from './scoreboard/index.tsx';
import { structuresPlugin } from './structures/index.tsx';
import { testsPlugin } from './tests/index.tsx';

export function createHost(): PluginHost {
  const host = new PluginHost();
  host.install(nxTreePlugin);
  host.install(particlePlugin);
  host.install(fmbePlugin);
  host.install(scoreboardPlugin);
  host.install(structuresPlugin);
  host.install(testsPlugin);
  return host;
}
