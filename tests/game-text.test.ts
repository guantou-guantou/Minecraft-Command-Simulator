import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameText } from '../src/ui/gameText.ts';

test('game output follows the interface language, English stays as it is', () => {
  for (const s of ['Applied damage to A', 'Toggled downfall', 'Gave 1 Air to A']) assert.equal(gameText(s, 'en'), s);
  const zh = (s: string) => gameText(s, 'zh');
  assert.equal(zh('Applied damage to A'), '已将伤害施加于A');
  assert.equal(zh('Unable to apply damage to A'), '无法将伤害施加于A');
  assert.equal(zh('Toggled downfall'), '天气已切换');
  assert.equal(zh('Function x not found.'), '未找到x函数。');
  assert.equal(zh('Game rule dodaylightcycle has been updated to false'), '游戏规则dodaylightcycle已更新为false');
  assert.equal(zh('Gave 1 Air to A'), '已将1个空气给予A');
  assert.equal(zh('You were given 1 Air'), '你被给予1个空气');
  assert.equal(zh('Gave 3 Some Odd Item to A'), '已将3个Some Odd Item给予A');
  assert.match(zh('Target data:[\n    {\n        "dimension" : 0\n    }\n]'), /^目标数据:\[\n/);
  assert.equal(zh('Set the time to 1000'), 'Set the time to 1000');
});

test('the grey [!: output] form of command blocks and players is translated inside', () => {
  assert.equal(gameText('\u00a77\u00a7o[!: Applied damage to A]\u00a7r', 'zh'), '\u00a77\u00a7o[!: 已将伤害施加于A]\u00a7r');
  assert.equal(gameText('\u00a77\u00a7o[B: Toggled downfall]\u00a7r', 'zh'), '\u00a77\u00a7o[B: 天气已切换]\u00a7r');
});