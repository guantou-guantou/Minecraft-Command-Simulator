import { ParticlePanel } from './ParticlePanel.tsx';
import type { Plugin } from '../host.ts';

export const particlePlugin: Plugin = {
  id: 'particles',
  name: 'particle viewer',
  version: '0.1.0',
  setup(api) {
    api.registerPanel({ id: 'panel', title: 'Particles', render: (ctx) => <ParticlePanel ctx={ctx} /> });
  },
};
