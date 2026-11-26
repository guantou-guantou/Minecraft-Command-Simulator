import { defineConfig } from 'vite';

/** Bundles the command line tool into one plain JavaScript file that needs only Node. */
export default defineConfig({
  build: {
    ssr: 'src/cli.ts',
    outDir: 'dist-cli',
    emptyOutDir: true,
    target: 'node18',
    rollupOptions: { output: { format: 'es', entryFileNames: 'mcsim.mjs', banner: '#!/usr/bin/env node' } },
  },
  ssr: { noExternal: true },
});