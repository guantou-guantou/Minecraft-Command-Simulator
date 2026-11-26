import type { BlockStates, Vec3 } from '../language/types.ts';
import { entitySlotKey, type Inventory, type Item } from '../language/items.ts';
import { ENCHANT_DATA, enchantById } from '../engine/enchant-data.ts';
import { cellIndex, type SavedEntity, type StructureTemplate } from '../engine/structure.ts';
import type { BlockData } from '../engine/types.ts';
import { AIR, COMMAND_BLOCK_MODE } from '../engine/world.ts';
import { byte, compound, float, int, list, long, readNbt, short, string, writeNbt, NbtError, type Nbt } from './nbt.ts';

/** Block state version written into palettes (what the NetEase sample file used); newer games upgrade older versions on load. */
export const BLOCK_VERSION = 18168865;
const CB_VERSION = 45;

const CONTAINERS: Record<string, string> = {
  'minecraft:chest': 'Chest', 'minecraft:trapped_chest': 'Chest', 'minecraft:barrel': 'Barrel', 'minecraft:hopper': 'Hopper',
  'minecraft:dispenser': 'Dispenser', 'minecraft:dropper': 'Dropper', 'minecraft:shulker_box': 'ShulkerBox', 'minecraft:undyed_shulker_box': 'ShulkerBox',
};
const MODE_ID = { imp: 0, rep: 1, cha: 2 } as const;
const ARMOR = ['head', 'chest', 'legs', 'feet'];

const ints3 = (v: Vec3) => list(3, v.map((n) => int(n)));
const field = <T extends Nbt['t']>(c: Nbt | undefined, k: string, t: T): Extract<Nbt, { t: T }> | undefined => {
  const n = c?.t === 'compound' ? c.v[k] : undefined;
  return n && n.t === t ? (n as Extract<Nbt, { t: T }>) : undefined;
};
const num = (c: Nbt | undefined, k: string, d = 0): number => {
  const n = c?.t === 'compound' ? c.v[k] : undefined;
  return n && (n.t === 'byte' || n.t === 'short' || n.t === 'int' || n.t === 'float' || n.t === 'double') ? n.v : d;
};
const str = (c: Nbt | undefined, k: string, d = ''): string => field(c, k, 'string')?.v ?? d;
const listOf = (c: Nbt | undefined, k: string): Nbt[] => field(c, k, 'list')?.v ?? [];

function stateNbt(v: string | number | boolean): Nbt {
  return typeof v === 'boolean' ? byte(v ? 1 : 0) : typeof v === 'number' ? int(v) : string(v);
}

function itemNbt(item: Item, slot?: number): Nbt {
  const v: Record<string, Nbt> = { Count: byte(item.count), Damage: short(item.data), Name: string(item.id), WasPickedUp: byte(0) };
  if (slot !== undefined) v.Slot = byte(slot);
  const ench = item.components['minecraft:enchantments'] as Record<string, number> | undefined;
  const entries = Object.entries(ench ?? {}).flatMap(([n, lvl]) => (ENCHANT_DATA[n]?.id !== undefined ? [[ENCHANT_DATA[n].id!, lvl]] : []));
  if (entries.length) v.tag = compound({ ench: list(10, entries.map(([id, lvl]) => compound({ id: short(id), lvl: short(lvl) }))) });
  return compound(v);
}

function itemFrom(c: Nbt): Item | null {
  const name = str(c, 'Name');
  if (!name || num(c, 'Count') <= 0) return null;
  const components: Record<string, unknown> = {};
  const ench = listOf(field(c, 'tag', 'compound'), 'ench');
  if (ench.length) components['minecraft:enchantments'] = Object.fromEntries(ench.map((e) => [enchantById(num(e, 'id')) ?? `id:${num(e, 'id')}`, num(e, 'lvl')]));
  return { id: name, count: num(c, 'Count'), data: num(c, 'Damage'), components };
}

/** The block entity data of a block (command block, container, or anything kept in `entityNbt`), placed at `at`. */
export function blockEntityOf(b: BlockData, at: Vec3): Nbt | null {
  const raw: Record<string, Nbt> = b.entityNbt?.t === 'compound' ? { ...b.entityNbt.v } : {};
  const pos = { x: int(at[0]), y: int(at[1]), z: int(at[2]) };
  const fill = (defaults: Record<string, Nbt>) => Object.fromEntries([...Object.entries(defaults).filter(([k]) => !(k in raw)), ...Object.entries(raw)]);
  if (b.cb) {
    const mode = COMMAND_BLOCK_MODE[b.id] ?? 'imp';
    return compound({
      ...fill({
        LPCondionalMode: byte(0), LPRedstoneMode: byte(0), LastExecution: long(0), LastOutput: string(''), LastOutputParams: list(8, []),
        SuccessCount: int(0), Version: int(CB_VERSION), conditionMet: byte(0), isMovable: byte(1), powered: byte(0),
      }),
      Command: string(b.cb.command), CustomName: string(b.cb.name ?? ''), ExecuteOnFirstTick: byte(b.cb.firstTick ? 1 : 0), LPCommandMode: int(MODE_ID[mode]),
      TickDelay: int(b.cb.delay), TrackOutput: byte(b.cb.track === false ? 0 : 1), auto: byte(b.cb.power === 'always_on' ? 1 : 0),
      conditionalMode: byte(b.states.conditional_bit === true ? 1 : 0), id: string('CommandBlock'), ...pos,
    });
  }
  const kind = CONTAINERS[b.id];
  if (kind) {
    const items = Object.entries(b.items ?? {}).flatMap(([k, it]) => {
      const m = /:(\d+)$/.exec(k);
      return m ? [itemNbt(it, Number(m[1]))] : [];
    });
    return compound({ ...fill({ Findable: byte(0), IsIgnoreShuffle: byte(0), IsOpened: byte(0), isMovable: byte(1) }), Items: list(10, items), id: string(kind), ...pos });
  }
  return b.entityNbt ? compound({ ...raw, ...pos }) : null;
}
function entityNbt(e: SavedEntity, origin: Vec3, uid: number): Nbt {
  const base = e.raw?.t === 'compound' ? { ...e.raw.v } : {};
  const slot = (key: string) => (e.items[key] ? itemNbt(e.items[key]) : compound({ Count: byte(0), Damage: short(0), Name: string(''), WasPickedUp: byte(0) }));
  const v: Record<string, Nbt> = {
    Persistent: byte(1), OnGround: byte(1), Dead: byte(0), FallDistance: float(0), Invulnerable: byte(0),
    Mainhand: list(10, [slot(entitySlotKey(false, 0, 'slot.weapon.mainhand', 0))]),
    Offhand: list(10, [slot(entitySlotKey(false, 0, 'slot.weapon.offhand', 0))]),
    Armor: list(10, [...ARMOR.map((p) => slot(`slot.armor.${p}:0`)), compound({ Count: byte(0), Damage: short(0), Name: string(''), WasPickedUp: byte(0) })]),
    definitions: list(8, [string(`+${e.type}`)]),
    ...base,
    identifier: string(e.type),
    Pos: list(5, e.pos.map((n, i) => float(n + origin[i]))),
    Rotation: list(5, [float(e.rot[0]), float(e.rot[1])]),
    Tags: list(8, e.tags.map((t) => string(t))),
    UniqueID: long(-4294967296n + BigInt(uid)),
  };
  if (e.name) {
    v.CustomName = string(e.name);
    v.CustomNameVisible = byte(1);
  } else if (!e.raw) delete v.CustomName;
  return compound(v);
}

/** Builds the NBT tree of a .mcstructure file. */
export function templateToNbt(t: StructureTemplate): Nbt {
  const palette: Nbt[] = [];
  const seen = new Map<string, number>();
  const layer: Nbt[] = [];
  const positionData: Record<string, Nbt> = {};
  for (let x = 0; x < t.size[0]; x++)
    for (let y = 0; y < t.size[1]; y++)
      for (let z = 0; z < t.size[2]; z++) {
        const i = cellIndex(t.size, x, y, z);
        const b = t.blocks[i];
        const k = `${b.id}|${JSON.stringify(Object.entries(b.states).sort())}`;
        let p = seen.get(k);
        if (p === undefined) {
          p = palette.length;
          seen.set(k, p);
          const val = b.cb ? Number(b.states.facing_direction ?? 0) | (b.states.conditional_bit === true ? 8 : 0) : 0;
          palette.push(compound({
            name: string(b.id),
            states: compound(Object.fromEntries(Object.entries(b.states).map(([sk, sv]) => [sk, stateNbt(sv)]))),
            val: short(val), version: int(BLOCK_VERSION),
          }));
        }
        layer.push(int(p));
        const be = blockEntityOf(b, [t.origin[0] + x, t.origin[1] + y, t.origin[2] + z]);
        if (be) positionData[String(i)] = compound({ block_entity_data: be });
      }
  return compound({
    format_version: int(1),
    size: ints3(t.size),
    structure: compound({
      block_indices: list(9, [list(3, layer), list(3, layer.map(() => int(-1)))]),
      entities: list(10, t.entities.map((e, i) => entityNbt(e, t.origin, i + 1))),
      palette: compound({ default: compound({ block_palette: list(10, palette), block_position_data: compound(positionData) }) }),
    }),
    structure_world_origin: ints3(t.origin),
  });
}

export const exportMcstructure = (t: StructureTemplate): Uint8Array => writeNbt(templateToNbt(t));

function stateValue(n: Nbt): string | number | boolean {
  if (n.t === 'byte') return n.v !== 0;
  if (n.t === 'string') return n.v;
  if (n.t === 'short' || n.t === 'int' || n.t === 'float' || n.t === 'double') return n.v;
  throw new NbtError(`Unsupported block state value of type ${n.t}`);
}

/** Fills `b.cb`, `b.items` and `b.entityNbt` from the block entity data of a block (the reverse of blockEntityOf). */
export function applyBlockEntity(b: BlockData, be: Nbt): void {
  const id = str(be, 'id');
  if (id === 'CommandBlock') {
    b.cb = {
      command: str(be, 'Command'), delay: num(be, 'TickDelay'), power: num(be, 'auto') ? 'always_on' : 'needs_redstone', line: 0, rotation: [0, 0],
      name: str(be, 'CustomName'), firstTick: num(be, 'ExecuteOnFirstTick') !== 0, track: num(be, 'TrackOutput', 1) !== 0,
    };
  } else if (Object.values(CONTAINERS).includes(id)) {
    const items: Inventory = {};
    for (const it of listOf(be, 'Items')) {
      const item = itemFrom(it);
      if (item) items[`slot.container:${num(it, 'Slot')}`] = item;
    }
    b.items = items;
  }
  b.entityNbt = be;
}
/** Reads a .mcstructure file into a structure template. Throws NbtError for anything that is not a structure. */
export function importMcstructure(bytes: Uint8Array): StructureTemplate {
  const root = readNbt(bytes).value;
  const sizeL = field(root, 'size', 'list');
  const st = field(root, 'structure', 'compound');
  if (root.t !== 'compound' || !sizeL || sizeL.v.length !== 3 || !st) throw new NbtError('Not a .mcstructure file: size or structure is missing');
  const size = sizeL.v.map((n) => (n.t === 'int' ? n.v : 0)) as Vec3;
  const oL = field(root, 'structure_world_origin', 'list');
  const origin = (oL ? oL.v.map((n) => (n.t === 'int' ? n.v : 0)) : [0, 0, 0]) as Vec3;
  const dflt = field(field(st, 'palette', 'compound'), 'default', 'compound');
  const pal = listOf(dflt, 'block_palette');
  const layer0 = listOf(st, 'block_indices')[0];
  if (!dflt || !layer0 || layer0.t !== 'list') throw new NbtError('Not a .mcstructure file: block_indices or palette is missing');
  const total = size[0] * size[1] * size[2];
  if (layer0.v.length !== total) throw new NbtError(`Block count ${layer0.v.length} does not match size ${size.join('x')}`);
  const positionData = field(dflt, 'block_position_data', 'compound')?.v ?? {};
  const blocks: BlockData[] = layer0.v.map((idx, i) => {
    const k = idx.t === 'int' ? idx.v : -1;
    const entry = pal[k];
    if (!entry) return { id: AIR, states: {} };
    const states: BlockStates = {};
    for (const [sk, sv] of Object.entries(field(entry, 'states', 'compound')?.v ?? {})) states[sk] = stateValue(sv);
    const b: BlockData = { id: str(entry, 'name'), states };
    const be = field(field(positionData[String(i)], 'block_entity_data', 'compound'), 'id', 'string') ? field(positionData[String(i)], 'block_entity_data', 'compound') : undefined;
    if (be) applyBlockEntity(b, be);
    return b;
  });
  const entities: SavedEntity[] = listOf(st, 'entities').map((e) => {
    const pos = listOf(e, 'Pos').map((n) => (n.t === 'float' || n.t === 'double' ? n.v : 0));
    const rot = listOf(e, 'Rotation').map((n) => (n.t === 'float' ? n.v : 0));
    const items: Inventory = {};
    const main = itemFrom(listOf(e, 'Mainhand')[0] ?? compound({}));
    const off = itemFrom(listOf(e, 'Offhand')[0] ?? compound({}));
    if (main) items['slot.weapon.mainhand:0'] = main;
    if (off) items['slot.weapon.offhand:0'] = off;
    listOf(e, 'Armor').slice(0, 4).forEach((a, i) => {
      const it = itemFrom(a);
      if (it) items[`slot.armor.${ARMOR[i]}:0`] = it;
    });
    return {
      type: str(e, 'identifier'), name: str(e, 'CustomName') || null,
      pos: [(pos[0] ?? 0) - origin[0], (pos[1] ?? 0) - origin[1], (pos[2] ?? 0) - origin[2]], rot: [rot[0] ?? 0, rot[1] ?? 0],
      tags: listOf(e, 'Tags').flatMap((t) => (t.t === 'string' ? [t.v] : [])), items, raw: e,
    };
  });
  return { size, origin, blocks, entities };
}