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

/** Maximum health by entity type (Bedrock ids without the minecraft: prefix), from the Chinese Minecraft Wiki's health page; entities that are not listed (and are alive) have 20. Horses, donkeys, mules and llamas have a random value between 15 and 30, the table uses 22.5. */
export const MAX_HEALTH: Record<string, number> = {
  player: 20, allay: 20, armadillo: 12, armor_stand: 6, axolotl: 14, bat: 6, bee: 10, camel: 32, camel_husk: 32, cat: 10, chicken: 4, cod: 3,
  copper_golem: 12, cow: 10, dolphin: 10, donkey: 22.5, fox: 10, frog: 10, glow_squid: 10, goat: 10, ghast: 10, happy_ghast: 20, horse: 22.5,
  iron_golem: 100, llama: 22.5, mooshroom: 10, mule: 22.5, nautilus: 15, ocelot: 10, panda: 20, parrot: 6, pig: 10, polar_bear: 30,
  pufferfish: 3, rabbit: 3, salmon: 3, sheep: 8, skeleton_horse: 15, sniffer: 14, snow_golem: 4, squid: 10, strider: 20, tadpole: 6,
  trader_llama: 22.5, tropicalfish: 3, turtle: 30, villager: 20, villager_v2: 20, wandering_trader: 20, wolf: 8, zombie_horse: 25, zombie_nautilus: 15,
  blaze: 20, bogged: 16, breeze: 30, cave_spider: 12, creaking: 1, creeper: 20, drowned: 20, elder_guardian: 80, ender_dragon: 200, enderman: 40,
  endermite: 8, evocation_illager: 24, guardian: 30, hoglin: 40, husk: 20, magma_cube: 16, phantom: 20, piglin: 16, piglin_brute: 50, pillager: 24,
  ravager: 100, shulker: 30, silverfish: 8, skeleton: 20, slime: 16, spider: 16, stray: 20, vex: 14, vindicator: 24, warden: 500, witch: 26,
  wither: 300, wither_skeleton: 20, zoglin: 40, zombie: 20, zombie_pigman: 20, zombie_villager: 20, zombie_villager_v2: 20,
};

/** Undead: instant health hurts them and instant damage heals them. */
export const UNDEAD = new Set([
  'zombie', 'husk', 'drowned', 'zombie_villager', 'zombie_villager_v2', 'zombie_pigman', 'skeleton', 'stray', 'wither_skeleton', 'bogged',
  'zombie_horse', 'skeleton_horse', 'phantom', 'wither', 'zoglin', 'camel_husk', 'zombie_nautilus',
]);

/** Armor points of the four pieces (helmet, chestplate, leggings, boots) by material, and the toughness each piece of that material gives. */
const ARMOR: Record<string, { points: [number, number, number, number]; toughness: number }> = {
  leather: { points: [1, 3, 2, 1], toughness: 0 }, copper: { points: [2, 4, 3, 1], toughness: 0 }, golden: { points: [2, 5, 3, 1], toughness: 0 },
  chainmail: { points: [2, 5, 4, 1], toughness: 0 }, iron: { points: [2, 6, 5, 2], toughness: 0 },
  diamond: { points: [3, 8, 6, 3], toughness: 2 }, netherite: { points: [3, 8, 6, 3], toughness: 3 },
};
const PIECE = ['helmet', 'chestplate', 'leggings', 'boots'];

/** Armor points and toughness of one worn item (0 for anything that is not armor). */
export function armorOfItem(id: string): { armor: number; toughness: number } {
  const n = id.replace(/^minecraft:/, '');
  if (n === 'turtle_helmet') return { armor: 2, toughness: 0 };
  const m = /^(\w+?)_(helmet|chestplate|leggings|boots)$/.exec(n);
  const mat = m && ARMOR[m[1]];
  return mat ? { armor: mat.points[PIECE.indexOf(m![2])], toughness: mat.toughness } : { armor: 0, toughness: 0 };
}
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