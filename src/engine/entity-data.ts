/**
 * Small starter tables used by selectors. They come from general Bedrock knowledge, not from the game files,
 * and only cover common entities; anything missing is reported instead of guessed.
 */
const e = (type: string) => `minecraft:${type}`;

/** Collision box (width, height) in blocks. */
export const HITBOX: Record<string, [number, number]> = {
  [e('player')]: [0.6, 1.8], [e('zombie')]: [0.6, 1.95], [e('skeleton')]: [0.6, 1.99], [e('creeper')]: [0.6, 1.7],
  [e('spider')]: [1.4, 0.9], [e('enderman')]: [0.6, 2.9], [e('cow')]: [0.9, 1.4], [e('pig')]: [0.9, 0.9], [e('sheep')]: [0.9, 1.3],
  [e('chicken')]: [0.4, 0.7], [e('villager')]: [0.6, 1.95], [e('iron_golem')]: [1.4, 2.7], [e('armor_stand')]: [0.5, 1.975],
  [e('fox')]: [0.6, 0.7], [e('wolf')]: [0.6, 0.85], [e('cat')]: [0.6, 0.7], [e('horse')]: [1.396, 1.6], [e('bee')]: [0.55, 0.5],
  [e('item')]: [0.25, 0.25], [e('tnt')]: [0.98, 0.98], [e('boat')]: [1.4, 0.455], [e('minecart')]: [0.98, 0.7],
  [e('xp_orb')]: [0.25, 0.25], [e('arrow')]: [0.5, 0.5], [e('snowball')]: [0.25, 0.25],
};

/** Entity families (the `family=` selector argument). */
export const FAMILIES: Record<string, string[]> = {
  [e('player')]: ['player'],
  [e('zombie')]: ['zombie', 'monster', 'undead', 'mob'],
  [e('skeleton')]: ['skeleton', 'monster', 'undead', 'mob'],
  [e('creeper')]: ['creeper', 'monster', 'mob'],
  [e('spider')]: ['spider', 'arthropod', 'monster', 'mob'],
  [e('enderman')]: ['enderman', 'monster', 'mob'],
  [e('witch')]: ['witch', 'monster', 'mob'],
  [e('slime')]: ['slime', 'monster', 'mob'],
  [e('cow')]: ['cow', 'mob'],
  [e('pig')]: ['pig', 'mob'],
  [e('sheep')]: ['sheep', 'mob'],
  [e('chicken')]: ['chicken', 'mob'],
  [e('villager')]: ['villager', 'mob'],
  [e('iron_golem')]: ['irongolem', 'mob'],
  [e('fox')]: ['fox', 'mob'],
  [e('wolf')]: ['wolf', 'mob'],
  [e('cat')]: ['cat', 'mob'],
  [e('horse')]: ['horse', 'mob'],
  [e('bee')]: ['bee', 'arthropod', 'mob'],
  [e('armor_stand')]: ['inanimate'],
  [e('item')]: ['inanimate'],
  [e('tnt')]: ['inanimate'],
  [e('boat')]: ['boat', 'inanimate'],
  [e('minecart')]: ['minecart', 'inanimate'],
};

/** Maximum health of the common mobs, without the minecraft: prefix; entities that are not listed (and are alive) have 20. Unverified against the NetEase edition. */
export const MAX_HEALTH: Record<string, number> = {
  player: 20, zombie: 20, husk: 20, drowned: 20, skeleton: 20, stray: 20, creeper: 20, spider: 16, cave_spider: 12, enderman: 40, witch: 26,
  pig: 10, cow: 10, mooshroom: 10, sheep: 8, chicken: 4, rabbit: 3, bat: 6, cat: 10, ocelot: 10, fox: 10, bee: 10, villager: 20,
  wandering_trader: 20, iron_golem: 100, snow_golem: 4, armor_stand: 6, squid: 10, glow_squid: 10, blaze: 20, ghast: 10, ender_dragon: 200,
  zombie_pigman: 20, piglin: 16, hoglin: 40, turtle: 30, parrot: 6, dolphin: 10, panda: 20, polar_bear: 30, llama: 22, axolotl: 14, goat: 10, frog: 10,
};

/** Things that have no health: items, projectiles, vehicles, markers and the like (damage cannot be dealt to them). */
export const NON_LIVING = new Set([
  'item', 'xp_orb', 'arrow', 'area_effect_cloud', 'falling_block', 'painting', 'boat', 'chest_boat', 'minecart', 'chest_minecart', 'hopper_minecart',
  'tnt_minecart', 'command_block_minecart', 'furnace_minecart', 'tnt', 'lightning_bolt', 'snowball', 'egg', 'ender_pearl', 'thrown_trident',
  'fireball', 'small_fireball', 'dragon_fireball', 'wither_skull', 'wither_skull_dangerous', 'shulker_bullet', 'eye_of_ender_signal', 'splash_potion',
  'lingering_potion', 'xp_bottle', 'fireworks_rocket', 'ender_crystal', 'leash_knot', 'evocation_fang', 'fishing_hook', 'ominous_item_spawner',
  'wind_charge_projectile', 'breeze_wind_charge_projectile', 'npc', 'agent', 'balloon', 'ice_bomb', 'tripod_camera',
]);

export function maxHealthOf(type: string): number {
  const id = type.replace(/^minecraft:/, '');
  if (NON_LIVING.has(id)) return 0;
  return MAX_HEALTH[id] ?? 20;
}