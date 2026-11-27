import { lintCommands } from '../language/cmdlint.ts';

self.onmessage = (e: MessageEvent<{ id: number; text: string }>) => {
  self.postMessage({ id: e.data.id, diagnostics: lintCommands(e.data.text) });
};