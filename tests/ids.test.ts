import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BLOCK_IDS, EFFECT_IDS, ENCHANTMENT_IDS, ENTITY_IDS, IDS_VERSION, ITEM_IDS } from '../src/language/ids.generated.ts';
import { COMMON_BLOCKS, COMMON_ITEMS, ENTITY_TYPES } from '../src/language/ids.ts';
import { ENCHANT_DATA } from '../src/engine/enchant-data.ts';
import { EFFECTS } from '../src/engine/state-commands.ts';

test('the generated id tables are full and sorted without prefixes', () => {
  assert.match(IDS_VERSION, /^\d+\.\d+\.\d+$/);
  assert.ok(ENTITY_IDS.length > 100 && BLOCK_IDS.length > 1000 && ITEM_IDS.length > 1000);
  for (const list of [ENTITY_IDS, BLOCK_IDS, ITEM_IDS, EFFECT_IDS, ENCHANTMENT_IDS]) {
    assert.ok(list.every((id) => !id.includes(':') && /^[a-z0-9_]+$/.test(id)), 'ids are plain snake_case');
    assert.deepEqual(list, [...new Set(list)].sort());
  }
  for (const id of ['zombie', 'armor_stand', 'fox']) assert.ok(ENTITY_IDS.includes(id), id);
  for (const id of ['stone', 'standing_sign', 'command_block', 'lever']) assert.ok(BLOCK_IDS.includes(id), id);
});

test('completion lists put the common ids first and contain every generated id', () => {
  assert.equal(ENTITY_TYPES[0], 'slime');
  assert.ok(ENTITY_IDS.filter((id) => id !== 'player').every((id) => ENTITY_TYPES.includes(id)));
  assert.ok(BLOCK_IDS.every((id) => COMMON_BLOCKS.includes(id)) && COMMON_BLOCKS.length === BLOCK_IDS.length);
  assert.ok(ITEM_IDS.every((id) => COMMON_ITEMS.includes(id)));
  assert.equal(COMMON_BLOCKS[0], 'air');
  assert.ok(!COMMON_BLOCKS.includes('concrete'), 'ids the game does not have are not suggested');
  assert.ok(!ENTITY_TYPES.includes('player'));
});

test('effects and enchantments of the game are known to the commands', () => {
  for (const id of EFFECT_IDS) assert.ok(EFFECTS.has(id), `effect ${id}`);
  const missing = ENCHANTMENT_IDS.filter((id) => !(id in ENCHANT_DATA));
  assert.deepEqual(missing, [], 'enchantments missing from src/engine/enchant-data.ts');
});