import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EN, ZH, detectLang, format, translate, type Key } from '../src/ui/i18n.ts';

const keys = Object.keys(EN) as Key[];
const params = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test('every English string has a Chinese translation with the same placeholders', () => {
  assert.deepEqual(Object.keys(ZH).sort(), [...keys].sort());
  for (const k of keys) {
    assert.ok(ZH[k].trim().length > 0, k);
    assert.deepEqual(params(ZH[k]), params(EN[k]), k);
  }
});

test('format fills placeholders and leaves unknown ones', () => {
  assert.equal(format('a {x} b {y}', { x: 1 }), 'a 1 b {y}');
  assert.equal(translate('en', 'tb.tick', { n: 5 }), 'tick 5');
  assert.equal(translate('zh', 'tb.tick', { n: 5 }), '第 5 刻');
  assert.equal(translate('zh', 'tb.save'), '保存');
});

test('detectLang picks Chinese for zh locales and English otherwise', () => {
  assert.equal(detectLang('zh-CN'), 'zh');
  assert.equal(detectLang('ZH-tw'), 'zh');
  assert.equal(detectLang('en-US'), 'en');
  assert.equal(detectLang(undefined), 'en');
});