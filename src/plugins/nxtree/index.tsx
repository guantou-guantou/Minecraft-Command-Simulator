import { NxTreePanel } from './NxTreePanel.tsx';
import type { Plugin } from '../host.ts';

export const nxTreePlugin: Plugin = {
  id: 'nxtree',
  name: 'nx tree generator and verifier',
  version: '0.1.0',
  setup(api) {
    api.registerPanel({ id: 'panel', title: 'nx tree', render: (ctx) => <NxTreePanel ctx={ctx} /> });
  },
};
