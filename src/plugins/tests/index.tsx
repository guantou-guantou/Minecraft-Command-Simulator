import { TestsPanel } from './TestsPanel.tsx';
import type { Plugin } from '../host.ts';

export const testsPlugin: Plugin = {
  id: 'tests',
  name: 'Script tests',
  version: '0.1.0',
  setup(api) {
    api.registerPanel({ id: 'panel', title: 'Tests', render: (ctx) => <TestsPanel ctx={ctx} /> });
  },
};