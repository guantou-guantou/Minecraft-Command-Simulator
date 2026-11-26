import { StructuresPanel } from './StructuresPanel.tsx';
import type { Plugin } from '../host.ts';

export const structuresPlugin: Plugin = {
  id: 'structures',
  name: 'Structures',
  version: '0.1.0',
  setup(api) {
    api.registerPanel({ id: 'panel', title: 'Structures', render: (ctx) => <StructuresPanel ctx={ctx} /> });
  },
};