import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintCommands } from '../src/language/cmdlint.ts';

const script = (n: number) => Array.from({ length: n }, (_, i) => `/execute as @a at @s run say hi ${i}\n/scoreboard players add @a s 1\n/tp @e[type=!player,r=5] ~ ~1 ~ \\\n    ~`).join('\n');

test('checking the commands of a script takes time in proportion to its length', () => {
  const time = (src: string) => {
    const t = performance.now();
    lintCommands(src);
    return performance.now() - t;
  };
  time(script(200));
  const small = Math.max(time(script(1500)), 1);
  const big = time(script(6000));
  assert.ok(big / small < 9, `4 times the lines took ${(big / small).toFixed(1)} times as long`);
});