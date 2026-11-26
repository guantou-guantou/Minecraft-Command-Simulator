import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** The core (parser, engine, NBT, BDX, converters) must run in plain Node: the CLI, tests and a future editor extension depend on that. */
const CORE = ['src/language', 'src/engine', 'src/nbt', 'src/bdx', 'src/convert', 'src/export.ts'];

function files(path: string): string[] {
  if (statSync(path).isFile()) return [path];
  return readdirSync(path).flatMap((n) => files(join(path, n)));
}

test('core modules do not import the UI, plugins, React or Electron, and use no browser globals', () => {
  const problems: string[] = [];
  for (const file of CORE.flatMap(files).filter((f) => /\.tsx?$/.test(f))) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
      const spec = m[1];
      if (/(^|\/)(ui|plugins)\//.test(spec) || spec === 'react' || spec.startsWith('react/') || spec === 'react-dom' || spec === 'electron' || spec.startsWith('@codemirror/')) problems.push(`${file}: imports ${spec}`);
    }
    for (const g of ['document.', 'window.', 'localStorage', 'navigator.']) if (new RegExp(`(^|[^\\w.])${g.replace('.', '\\.')}`).test(text)) problems.push(`${file}: uses ${g}`);
  }
  assert.deepEqual(problems, []);
});