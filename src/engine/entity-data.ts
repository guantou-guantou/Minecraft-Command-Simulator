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