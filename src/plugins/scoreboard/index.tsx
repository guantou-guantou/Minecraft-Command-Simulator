import { ScoreboardPanel } from './ScoreboardPanel.tsx';
import type { Plugin } from '../host.ts';

export const scoreboardPlugin: Plugin = {
  id: 'scoreboard',
  name: 'Scoreboard',
  version: '0.1.0',
  setup(api) {
    api.registerPanel({ id: 'panel', title: 'Scoreboard', render: (ctx) => <ScoreboardPanel ctx={ctx} /> });
  },
};