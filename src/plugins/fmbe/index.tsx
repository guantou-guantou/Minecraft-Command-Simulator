import { FmbePanel } from './FmbePanel.tsx';
import type { Plugin } from '../host.ts';

export const fmbePlugin: Plugin = {
  id: 'fmbe',
  name: 'FMBE (fox display entities)',
  version: '0.1.0',
  setup(api) {
    api.registerPanel({ id: 'panel', title: 'FMBE', render: (ctx) => <FmbePanel ctx={ctx} /> });
  },
};