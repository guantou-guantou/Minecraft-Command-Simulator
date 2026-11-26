/** Entity ids from the Bedrock command reference (the minecraft: prefix may be left out). */
export const ENTITY_TYPES: string[] = ['slime', 'tnt', 'camel', 'turtle', 'chicken', 'bee', 'axolotl', 'pig', 'hoglin', 'sniffer', 'cat', 'cow', 'sheep', 'armadillo', 'wolf', 'villager', 'wandering_trader', 'mooshroom', 'squid', 'glow_squid', 'strider', 'rabbit', 'happy_ghast', 'bat', 'iron_golem', 'nautilus', 'snow_golem', 'zombie_nautilus', 'ocelot', 'horse', 'trader_llama', 'llama', 'polar_bear', 'parrot', 'dolphin', 'panda', 'fox', 'goat', 'frog', 'tadpole', 'allay', 'tropicalfish', 'cod', 'zombie_villager', 'pufferfish', 'salmon', 'donkey', 'mule', 'skeleton_horse', 'zombie_horse', 'zombie', 'drowned', 'creeper', 'skeleton', 'spider', 'zombie_pigman', 'enderman', 'silverfish', 'cave_spider', 'ghast', 'magma_cube', 'blaze', 'warden', 'witch', 'stray', 'husk', 'wither_skeleton', 'guardian', 'elder_guardian', 'elder_guardian_ghost', 'wither', 'ender_dragon', 'shulker', 'endermite', 'vindicator', 'evocation_illager', 'vex', 'phantom', 'pillager', 'ravager', 'piglin_brute', 'piglin', 'zoglin', 'breeze', 'bogged', 'creaking', 'copper_golem', 'parched', 'camel_husk', 'sulfur_cube', 'minecart', 'hopper_minecart', 'tnt_minecart', 'chest_minecart', 'command_block_minecart', 'xp_bottle', 'xp_orb', 'ender_crystal', 'arrow', 'snowball', 'egg', 'splash_potion', 'leash_knot', 'wind_charge_projectile', 'boat', 'chest_boat', 'lightning_bolt', 'evocation_fang', 'armor_stand', 'fireworks_rocket', 'npc'];

/** A starter list for completion only; ids that appear in the script are suggested as well. */
export const COMMON_BLOCKS: string[] = [
  'air', 'stone', 'dirt', 'grass_block', 'cobblestone', 'oak_planks', 'sand', 'gravel', 'gold_block', 'iron_block', 'diamond_block',
  'emerald_block', 'redstone_block', 'glass', 'obsidian', 'bedrock', 'water', 'lava', 'chest', 'trapped_chest', 'barrel', 'hopper',
  'dispenser', 'dropper', 'lever', 'stone_button', 'redstone_lamp', 'redstone_wire', 'repeater', 'comparator', 'observer', 'piston',
  'sticky_piston', 'command_block', 'chain_command_block', 'repeating_command_block', 'structure_block', 'barrier', 'stone_bricks',
  'oak_stairs', 'stone_slab', 'oak_log', 'oak_leaves', 'white_wool', 'netherrack', 'end_stone', 'glowstone', 'sea_lantern', 'tnt',
  'shulker_box', 'ender_chest', 'furnace', 'crafting_table', 'bookshelf', 'ice', 'snow', 'clay', 'concrete', 'terracotta',
];

export const COMMON_ITEMS: string[] = [
  'diamond', 'iron_ingot', 'gold_ingot', 'emerald', 'apple', 'golden_apple', 'bread', 'cooked_beef', 'stick', 'coal', 'redstone',
  'diamond_sword', 'iron_sword', 'diamond_pickaxe', 'iron_pickaxe', 'diamond_axe', 'diamond_shovel', 'bow', 'arrow', 'shield',
  'diamond_helmet', 'diamond_chestplate', 'diamond_leggings', 'diamond_boots', 'ender_pearl', 'snowball', 'egg', 'bucket',
  'water_bucket', 'lava_bucket', 'compass', 'clock', 'book', 'paper', 'name_tag', 'lead', 'saddle', 'totem_of_undying', 'elytra',
  'firework_rocket', 'trident', 'crossbow', 'fishing_rod', 'shears', 'flint_and_steel', 'torch', 'oak_boat', 'minecart', 'potion',
];

export const PARTICLES: string[] = [
  'minecraft:villager_happy', 'minecraft:endrod', 'minecraft:basic_flame_particle', 'minecraft:heart_particle', 'minecraft:redstone_ore_dust_particle',
];

export const GAME_MODES = ['survival', 'creative', 'adventure', 'spectator', 'default', 's', 'c', 'a', 'd'];
export const STRUCTURE_ROTATIONS = ['0_degrees', '90_degrees', '180_degrees', '270_degrees'];
export const STRUCTURE_MIRRORS = ['none', 'x', 'z', 'xz'];