export interface Item {
  id: string;
  count: number;
  data: number;
  components: Record<string, unknown>;
}

export type Inventory = Record<string, Item>;

export const MAX_ITEM_COUNT = 32767;

export function maxStack(id: string): number {
  const n = id.replace(/^minecraft:/, '');
  if (
    /_(sword|pickaxe|axe|shovel|hoe|helmet|chestplate|leggings|boots|boat|minecart|potion)$/.test(n) ||
    n.startsWith('music_disc_') ||
    ['bow', 'crossbow', 'shield', 'elytra', 'fishing_rod', 'flint_and_steel', 'shears', 'trident', 'mace', 'saddle', 'cake', 'potion', 'minecart'].includes(n)
  ) return 1;
  if (['ender_pearl', 'snowball', 'egg', 'bucket', 'banner', 'honey_bottle'].includes(n) || /_sign$/.test(n)) return 16;
  return 64;
}

const SLOTS: Record<string, { size: number; playerOnly: boolean }> = {
  'slot.weapon.mainhand': { size: 1, playerOnly: false },
  'slot.weapon.offhand': { size: 1, playerOnly: false },
  'slot.armor.head': { size: 1, playerOnly: false },
  'slot.armor.chest': { size: 1, playerOnly: false },
  'slot.armor.legs': { size: 1, playerOnly: false },
  'slot.armor.feet': { size: 1, playerOnly: false },
  'slot.armor.body': { size: 1, playerOnly: false },
  'slot.hotbar': { size: 9, playerOnly: true },
  'slot.inventory': { size: 27, playerOnly: true },
  'slot.enderchest': { size: 27, playerOnly: true },
};
const KNOWN_UNSUPPORTED = ['slot.saddle', 'slot.armor', 'slot.chest', 'slot.equippable'];

export interface SlotProblem {
  status: 'syntax_error' | 'unimplemented' | 'failed';
  message: string;
}

export function slotProblem(slot: string, index: number, isPlayer: boolean): SlotProblem | null {
  const s = SLOTS[slot];
  if (!s) {
    return KNOWN_UNSUPPORTED.includes(slot)
      ? { status: 'unimplemented', message: `Slot type ${slot} is not simulated yet` }
      : { status: 'syntax_error', message: `Unknown slot type "${slot}"` };
  }
  if (s.playerOnly && !isPlayer) return { status: 'failed', message: `Only players have ${slot} slots` };
  if (!Number.isInteger(index) || index < 0 || index >= s.size) {
    return { status: 'failed', message: `${slot} slot index must be between 0 and ${s.size - 1}, got ${index}` };
  }
  return null;
}

export const SLOT_NAMES = (): string[] => Object.keys(SLOTS);
export const slotSize = (slot: string): number | undefined => SLOTS[slot]?.size;

export const slotKey = (slot: string, index: number) => `${slot}:${index}`;

export function entitySlotKey(isPlayer: boolean, selected: number, slot: string, index: number): string {
  return isPlayer && slot === 'slot.weapon.mainhand' ? slotKey('slot.hotbar', selected) : slotKey(slot, index);
}

export const GIVE_ORDER: string[] = [
  ...Array.from({ length: 9 }, (_, i) => slotKey('slot.hotbar', i)),
  ...Array.from({ length: 27 }, (_, i) => slotKey('slot.inventory', i)),
];
export const CLEAR_ORDER: string[] = [
  ...GIVE_ORDER,
  ...['head', 'chest', 'legs', 'feet'].map((p) => slotKey(`slot.armor.${p}`, 0)),
  slotKey('slot.weapon.offhand', 0),
];

export const CONTAINER_SIZE: Record<string, number> = {
  'minecraft:chest': 27,
  'minecraft:trapped_chest': 27,
  'minecraft:barrel': 27,
  'minecraft:shulker_box': 27,
  'minecraft:undyed_shulker_box': 27,
  'minecraft:dispenser': 9,
  'minecraft:dropper': 9,
  'minecraft:hopper': 5,
};

export function containerProblem(blockId: string, index: number): string | null {
  const size = CONTAINER_SIZE[blockId];
  if (size === undefined) return `${blockId} is not a known container`;
  if (!Number.isInteger(index) || index < 0 || index >= size) return `slot.container index must be between 0 and ${size - 1} for ${blockId}, got ${index}`;
  return null;
}

export const sameItemKind = (a: Item, b: Item) =>
  a.id === b.id && a.data === b.data && JSON.stringify(a.components) === JSON.stringify(b.components);

export const fmtItem = (i: Item) => `${i.count}x ${i.id.replace(/^minecraft:/, '')}${i.data ? `:${i.data}` : ''}`;
