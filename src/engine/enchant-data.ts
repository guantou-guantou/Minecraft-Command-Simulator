export interface EnchantInfo {
  /** Bedrock numeric id, when known. Newer enchantments have no confirmed id and can only be named. */
  id?: number;
  max: number;
}

/**
 * Maximum levels and ids of the Bedrock enchantments. Taken from general Bedrock knowledge,
 * not verified on the NetEase edition: correct the numbers here if the game disagrees.
 */
export const ENCHANT_DATA: Record<string, EnchantInfo> = {
  protection: { id: 0, max: 4 },
  fire_protection: { id: 1, max: 4 },
  feather_falling: { id: 2, max: 4 },
  blast_protection: { id: 3, max: 4 },
  projectile_protection: { id: 4, max: 4 },
  thorns: { id: 5, max: 3 },
  respiration: { id: 6, max: 3 },
  depth_strider: { id: 7, max: 3 },
  aqua_affinity: { id: 8, max: 1 },
  sharpness: { id: 9, max: 5 },
  smite: { id: 10, max: 5 },
  bane_of_arthropods: { id: 11, max: 5 },
  knockback: { id: 12, max: 2 },
  fire_aspect: { id: 13, max: 2 },
  looting: { id: 14, max: 3 },
  efficiency: { id: 15, max: 5 },
  silk_touch: { id: 16, max: 1 },
  unbreaking: { id: 17, max: 3 },
  fortune: { id: 18, max: 3 },
  power: { id: 19, max: 5 },
  punch: { id: 20, max: 2 },
  flame: { id: 21, max: 1 },
  infinity: { id: 22, max: 1 },
  luck_of_the_sea: { id: 23, max: 3 },
  lure: { id: 24, max: 3 },
  frost_walker: { id: 25, max: 2 },
  mending: { id: 26, max: 1 },
  binding: { id: 27, max: 1 },
  vanishing: { id: 28, max: 1 },
  impaling: { id: 29, max: 5 },
  riptide: { id: 30, max: 3 },
  loyalty: { id: 31, max: 3 },
  channeling: { id: 32, max: 1 },
  multishot: { id: 33, max: 1 },
  piercing: { id: 34, max: 4 },
  quick_charge: { id: 35, max: 3 },
  soul_speed: { id: 36, max: 3 },
  swift_sneak: { id: 37, max: 3 },
  wind_burst: { max: 3 },
  density: { max: 5 },
  breach: { max: 4 },
  lunge: { max: 3 },
};

/** Sets of enchantments of which an item can only have one. */
export const EXCLUSIVE_GROUPS: string[][] = [
  ['protection', 'fire_protection', 'blast_protection', 'projectile_protection'],
  ['sharpness', 'smite', 'bane_of_arthropods', 'density', 'breach'],
  ['fortune', 'silk_touch'],
  ['infinity', 'mending'],
  ['depth_strider', 'frost_walker'],
  ['multishot', 'piercing'],
  ['riptide', 'loyalty'],
  ['riptide', 'channeling'],
];

export const ENCHANT_NAMES = Object.keys(ENCHANT_DATA);

export function enchantById(id: number): string | undefined {
  return ENCHANT_NAMES.find((n) => ENCHANT_DATA[n].id === id);
}

/** The enchantment in `existing` that cannot be combined with `name`, if any (the same enchantment never conflicts). */
export function conflictWith(name: string, existing: Iterable<string>): string | undefined {
  for (const other of existing) {
    if (other !== name && EXCLUSIVE_GROUPS.some((g) => g.includes(name) && g.includes(other))) return other;
  }
  return undefined;
}