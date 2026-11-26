import type { SavedEntity } from '../engine/structure.ts';
import type { BlockData } from '../engine/types.ts';
import { DIR_ID, type Dir, type Vec3 } from '../language/types.ts';
import type { Nbt } from '../nbt/nbt.ts';
import type { BdxCell } from './bdx.ts';

/**
 * BDX cannot hold entities, so they are turned into a chain of command blocks that summons them when it is triggered.
 * Each entity becomes: summon, then (when it has tags or items) a temporary tag to pick exactly that entity,
 * its own tags, its items, and removal of the temporary tag. Entities are handled one after the other, so two entities of
 * the same type and name never get each other's tags.
 */
export const TEMP_TAG = 'mcsim_tmp';
/** Marks entities that are already finished, so a look-alike summoned at the same place is not mistaken for them; removed at the end. */
export const DONE_TAG = 'mcsim_old';

export interface EntityCommandOptions {
  /** Where the first (impulse) command block goes, in the frame of the structure's cells. The chain winds along +x, then -x on the next row, and so on. */
  start: Vec3;
  /** Last block clears the whole helper area including the button. */
  selfDestruct: boolean;
  /** Command blocks per row of the winding chain. */
  rowLength?: number;
}

export interface EntityCommandResult {
  cells: BdxCell[];
  notes: string[];
  stats: { entities: number; commandBlocks: number; skipped: number; selfDestruct: boolean };
  /** The impulse command block and the button that starts it. */
  head: Vec3 | null;
  button: Vec3 | null;
}

const BABY_EVENTS: Record<string, string> = {
  ...Object.fromEntries(['cow', 'pig', 'sheep', 'chicken', 'horse', 'donkey', 'mule', 'llama', 'mooshroom', 'rabbit', 'goat', 'ocelot', 'cat', 'wolf', 'panda', 'polar_bear', 'turtle', 'camel', 'sniffer'].map((t) => [`minecraft:${t}`, 'minecraft:ageable_set_baby'])),
  ...Object.fromEntries(['zombie', 'husk', 'drowned', 'zombie_villager', 'zombie_pigman', 'fox'].map((t) => [`minecraft:${t}`, 'minecraft:as_baby'])),
};

const short = (id: string) => id.replace(/^minecraft:/, '');
const round = (n: number, d = 5) => Math.round(n * 10 ** d) / 10 ** d;
const rel = (n: number) => (round(n) === 0 ? '~' : `~${round(n)}`);
const tagArg = (t: string) => (/^[\w.:-]+$/.test(t) ? t : `"${t.replace(/"/g, "'")}"`);
const nameArg = (s: string) => s.replace(/"/g, "'");

function flag(raw: Nbt | undefined, key: string): boolean {
  const n = raw?.t === 'compound' ? raw.v[key] : undefined;
  return !!n && n.t === 'byte' && n.v !== 0;
}

interface Step {
  /** The command for the block at `bp` (the block's own position, in the structure's frame). */
  make: (bp: Vec3) => string;
}

export function entityCommandCells(entities: SavedEntity[], o: EntityCommandOptions): EntityCommandResult {
  const notes: string[] = [];
  const steps: Step[] = [];
  let skipped = 0;
  let lostItemData = 0;
  let babyLost = 0;
  let extras = 0;
  const usable = entities.filter((e) => {
    if (e.type === 'minecraft:player') return false;
    if (e.type === 'minecraft:item') {
      skipped++;
      return false;
    }
    return true;
  });
  const close = (a: SavedEntity, b: SavedEntity) => a.type === b.type && a.name === b.name && Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1], a.pos[2] - b.pos[2]) <= 0.6;
  let marked = false;
  usable.forEach((e, idx) => {
    const type = short(e.type);
    const baby = flag(e.raw, 'IsBaby');
    const babyEvent = baby ? BABY_EVENTS[e.type] : undefined;
    if (baby && !babyEvent) babyLost++;
    if (e.raw) extras++;
    const event = babyEvent ?? (e.name ? 'minecraft:entity_spawned' : '');
    const [px, py, pz] = e.pos;
    const here = (bp: Vec3) => `${rel(px - (bp[0] + 0.5))} ${rel(py - bp[1])} ${rel(pz - (bp[2] + 0.5))}`;
    steps.push({
      make: (bp) => `summon ${type} ${here(bp)} ${round(e.rot[0], 3)} ${round(e.rot[1], 3)}${event ? ` ${event}` : ''}${e.name ? ` "${nameArg(e.name)}"` : ''}`,
    });
    const items = Object.entries(e.items);
    const clash = usable.slice(idx + 1).some((o) => close(e, o));
    if (!e.tags.length && !items.length && !clash) return;
    steps.push({
      make: (bp) => `execute positioned ${here(bp)} run tag @e[type=${type},${e.name ? `name="${nameArg(e.name)}",` : ''}r=0.5,c=1,tag=!${TEMP_TAG},tag=!${DONE_TAG}] add ${TEMP_TAG}`,
    });
    for (const t of e.tags) steps.push({ make: () => `tag @e[tag=${TEMP_TAG}] add ${tagArg(t)}` });
    for (const [slotKey, item] of items) {
      const [slot, index] = slotKey.split(':');
      if (Object.keys(item.components).length) lostItemData++;
      steps.push({ make: () => `replaceitem entity @e[tag=${TEMP_TAG}] ${slot} ${index ?? 0} ${short(item.id)} ${item.count} ${item.data}` });
    }
    if (clash) {
      marked = true;
      steps.push({ make: () => `tag @e[tag=${TEMP_TAG}] add ${DONE_TAG}` });
    }
    steps.push({ make: () => `tag @e[tag=${TEMP_TAG}] remove ${TEMP_TAG}` });
  });
  if (marked) steps.push({ make: () => `tag @e[tag=${DONE_TAG}] remove ${DONE_TAG}` });
  if (skipped) notes.push(`${skipped} dropped item entities cannot be summoned and were left out`);
  if (lostItemData) notes.push(`${lostItemData} item(s) had enchantments or other components, which replaceitem cannot set; they were left out`);
  if (babyLost) notes.push(`${babyLost} baby entities have no known spawn event, so they come out as adults`);
  if (extras) notes.push('Entities keep type, position, rotation, name, tags, held/worn items and (for common mobs) the baby state; poses, variants, colours, health and effects are lost');
  if (!steps.length) return { cells: [], notes, stats: { entities: 0, commandBlocks: 0, skipped, selfDestruct: false }, head: null, button: null };

  const L = Math.max(2, o.rowLength ?? 32);
  const total = steps.length + 1;
  const rows = Math.ceil(total / L);
  const pos = (i: number): Vec3 => {
    const row = Math.floor(i / L);
    const col = i % L;
    return [o.start[0] + (row % 2 === 0 ? col : L - 1 - col), o.start[1], o.start[2] + row];
  };
  const clearVolume = (L + 1) * rows;
  const destruct = o.selfDestruct && clearVolume <= 32768;
  if (o.selfDestruct && !destruct) notes.push('The helper area is too big for one fill command, so the chain does not remove itself');
  const count = steps.length + (destruct ? 1 : 0);
  const head = pos(0);
  const button: Vec3 = [head[0] - 1, head[1], head[2]];
  const faceOf = (i: number): Dir => {
    const row = Math.floor(i / L);
    if (i % L === L - 1 && i !== count - 1) return 'south';
    return row % 2 === 0 ? 'east' : 'west';
  };
  const all: Step[] = [...steps];
  if (destruct) {
    all.push({
      make: (bp) => {
        const x0 = o.start[0] - 1;
        const x1 = o.start[0] + L - 1;
        const z1 = o.start[2] + rows - 1;
        const r = (a: number, b: number) => `~${a - b}`.replace(/^~0$/, '~');
        return `fill ${r(x0, bp[0])} ${r(o.start[1], bp[1])} ${r(o.start[2], bp[2])} ${r(x1, bp[0])} ${r(o.start[1], bp[1])} ${r(z1, bp[2])} air`;
      },
    });
  }
  const cells: BdxCell[] = all.map((s, i) => {
    const bp = pos(i);
    const block: BlockData = {
      id: i === 0 ? 'minecraft:command_block' : 'minecraft:chain_command_block',
      states: { conditional_bit: false, facing_direction: DIR_ID[faceOf(i)] },
      cb: { command: s.make(bp), delay: 0, power: i === 0 ? 'needs_redstone' : 'always_on', line: 0, rotation: [0, 0], name: '', firstTick: false, track: false },
    };
    return { pos: bp, block };
  });
  cells.push({ pos: button, block: { id: 'minecraft:stone_button', states: { button_pressed_bit: false, facing_direction: DIR_ID.west } } });
  notes.push(`Press the stone button at ${button.join(', ')} (relative to the structure's lowest corner) to summon the entities${destruct ? '; the chain then removes itself' : ''}`);
  return { cells, notes, stats: { entities: usable.length, commandBlocks: all.length, skipped, selfDestruct: destruct }, head, button };
}