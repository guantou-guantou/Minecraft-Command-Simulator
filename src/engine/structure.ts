import type { Vec3, BlockStates } from '../language/types.ts';
import type { Inventory } from '../language/items.ts';
import type { Nbt } from '../nbt/nbt.ts';
import { clampPitch, wrapYaw } from './geometry.ts';
import { AIR, type World } from './world.ts';
import { CommandError, type BlockData } from './types.ts';

export interface SavedEntity {
  type: string;
  name: string | null;
  /** Position relative to the structure's lowest corner. */
  pos: Vec3;
  rot: [number, number];
  tags: string[];
  items: Inventory;
  /** The entity's original NBT when it came from a file, so unknown fields survive an export. */
  raw?: Nbt;
}

/** Everything a structure holds, shaped like a .mcstructure file so importing and exporting are lossless for what we model. */
export interface StructureTemplate {
  size: Vec3;
  /** Where the structure stood when it was saved. */
  origin: Vec3;
  /** Cells in file order: index = (x * sizeY + y) * sizeZ + z. Empty cells are air. */
  blocks: BlockData[];
  entities: SavedEntity[];
}

/** Structures live in a namespace; the game stores `house` as `mystructure:house` and accepts either spelling. */
export const DEFAULT_NAMESPACE = 'mystructure';
export const normalizeStructureName = (name: string) => (name.includes(':') ? name : `${DEFAULT_NAMESPACE}:${name}`);
/** The name the way a user would type it: the default namespace is left out. */
export const shortStructureName = (name: string) => (name.startsWith(`${DEFAULT_NAMESPACE}:`) ? name.slice(DEFAULT_NAMESPACE.length + 1) : name);

export const cellIndex = (size: Vec3, x: number, y: number, z: number) => (x * size[1] + y) * size[2] + z;

export type Rotation = 0 | 1 | 2 | 3;
export type Mirror = 'none' | 'x' | 'z' | 'xz';

export function captureStructure(world: World, a: Vec3, b: Vec3, includeEntities: boolean, includeBlocks: boolean): StructureTemplate {
  const min = a.map((v, i) => Math.min(v, b[i])) as Vec3;
  const max = a.map((v, i) => Math.max(v, b[i])) as Vec3;
  if (!world.inRegion(min) || !world.inRegion(max)) throw new CommandError('failed', 'structure save: the area is outside the simulated region');
  const size = max.map((v, i) => v - min[i] + 1) as Vec3;
  const blocks: BlockData[] = [];
  for (let x = 0; x < size[0]; x++)
    for (let y = 0; y < size[1]; y++)
      for (let z = 0; z < size[2]; z++) {
        blocks.push(includeBlocks ? structuredClone(world.getBlockData([min[0] + x, min[1] + y, min[2] + z])) : { id: AIR, states: {} });
      }
  const entities: SavedEntity[] = [];
  if (includeEntities) {
    for (const e of world.entities) {
      if (e.type === 'minecraft:player') continue;
      if (e.pos.every((v, i) => v >= min[i] && v < max[i] + 1)) {
        entities.push({ type: e.type, name: e.name, pos: e.pos.map((v, i) => v - min[i]) as Vec3, rot: [...e.rot], tags: [...e.tags], items: structuredClone(e.items) });
      }
    }
  }
  return { size, origin: min, blocks, entities };
}

const FACING_CW: Record<number, number> = { 2: 5, 5: 3, 3: 4, 4: 2 };
const CARD_CW: Record<string, string> = { north: 'east', east: 'south', south: 'west', west: 'north' };
const DIRECTION_CW = [1, 2, 3, 0];
const WEIRDO_CW = [2, 3, 1, 0];
const FACING_MX: Record<number, number> = { 4: 5, 5: 4 };
const FACING_MZ: Record<number, number> = { 2: 3, 3: 2 };
const CARD_MX: Record<string, string> = { east: 'west', west: 'east' };
const CARD_MZ: Record<string, string> = { north: 'south', south: 'north' };
const DIRECTION_MX = [0, 3, 2, 1];
const DIRECTION_MZ = [2, 1, 0, 3];
const WEIRDO_MX = [1, 0, 2, 3];
const WEIRDO_MZ = [0, 1, 3, 2];

/** Mirrors, then turns `rot` quarter turns clockwise, the direction-like block states that we know about. */
export function turnStates(states: BlockStates, rot: Rotation, mirror: Mirror): BlockStates {
  const out: BlockStates = { ...states };
  const mx = mirror === 'x' || mirror === 'xz';
  const mz = mirror === 'z' || mirror === 'xz';
  for (const k of Object.keys(out)) {
    const base = k.replace(/^minecraft:/, '');
    const v = out[k];
    if (base === 'facing_direction' && typeof v === 'number') {
      let n = v;
      if (mx) n = FACING_MX[n] ?? n;
      if (mz) n = FACING_MZ[n] ?? n;
      for (let i = 0; i < rot; i++) n = FACING_CW[n] ?? n;
      out[k] = n;
    } else if (base === 'cardinal_direction' && typeof v === 'string') {
      let s = v;
      if (mx) s = CARD_MX[s] ?? s;
      if (mz) s = CARD_MZ[s] ?? s;
      for (let i = 0; i < rot; i++) s = CARD_CW[s] ?? s;
      out[k] = s;
    } else if ((base === 'direction' || base === 'weirdo_direction') && typeof v === 'number') {
      const d = base === 'direction';
      let n = v;
      if (mx) n = (d ? DIRECTION_MX : WEIRDO_MX)[n] ?? n;
      if (mz) n = (d ? DIRECTION_MZ : WEIRDO_MZ)[n] ?? n;
      for (let i = 0; i < rot; i++) n = (d ? DIRECTION_CW : WEIRDO_CW)[n] ?? n;
      out[k] = n;
    } else if (base === 'ground_sign_direction' && typeof v === 'number') {
      let n = v;
      if (mx) n = (16 - n) % 16;
      if (mz) n = (8 - n + 16) % 16;
      out[k] = (n + 4 * rot) % 16;
    }
  }
  return out;
}

export interface PlaceOptions {
  rotation: Rotation;
  mirror: Mirror;
  includeEntities: boolean;
  includeBlocks: boolean;
  /** 0..100: the share of blocks that are placed. */
  integrity: number;
  seed: string | null;
}

export interface PlaceResult {
  blocks: number;
  entities: number;
  size: Vec3;
}

function hash(text: string): number {
  let h = 2166136261;
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    let t = (s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The footprint of a structure after turning it. */
export function turnedSize(size: Vec3, rot: Rotation): Vec3 {
  return rot % 2 ? [size[2], size[1], size[0]] : [...size];
}

export function placeStructure(world: World, tpl: StructureTemplate, at: Vec3, o: PlaceOptions, line = 0): PlaceResult {
  const [sx, sy, sz] = tpl.size;
  const out = turnedSize(tpl.size, o.rotation);
  const far: Vec3 = [at[0] + out[0] - 1, at[1] + out[1] - 1, at[2] + out[2] - 1];
  if (!world.inRegion(at) || !world.inRegion(far)) throw new CommandError('failed', 'structure load: the destination is outside the simulated region');
  const rnd = o.integrity < 100 ? (o.seed !== null ? seeded(hash(o.seed)) : () => world.random()) : null;
  let blocks = 0;
  if (o.includeBlocks) {
    for (let x = 0; x < sx; x++)
      for (let y = 0; y < sy; y++)
        for (let z = 0; z < sz; z++) {
          if (rnd && rnd() * 100 >= o.integrity) continue;
          let nx = o.mirror === 'x' || o.mirror === 'xz' ? sx - 1 - x : x;
          let nz = o.mirror === 'z' || o.mirror === 'xz' ? sz - 1 - z : z;
          let w = sx;
          let d = sz;
          for (let i = 0; i < o.rotation; i++) {
            [nx, nz] = [d - 1 - nz, nx];
            [w, d] = [d, w];
          }
          const cell = structuredClone(tpl.blocks[cellIndex(tpl.size, x, y, z)]);
          cell.states = turnStates(cell.states, o.rotation, o.mirror);
          if (cell.cb) cell.cb.line = line;
          world.setBlockData([at[0] + nx, at[1] + y, at[2] + nz], cell);
          blocks++;
        }
  }
  let entities = 0;
  if (o.includeEntities) {
    for (const se of tpl.entities) {
      let [px, py, pz] = se.pos;
      let yaw = se.rot[0];
      if (o.mirror === 'x' || o.mirror === 'xz') {
        px = sx - px;
        yaw = -yaw;
      }
      if (o.mirror === 'z' || o.mirror === 'xz') {
        pz = sz - pz;
        yaw = 180 - yaw;
      }
      let w = sx;
      let d = sz;
      for (let i = 0; i < o.rotation; i++) {
        [px, pz] = [d - pz, px];
        [w, d] = [d, w];
        yaw += 90;
      }
      const e = world.addEntity(se.type, se.name, [at[0] + px, at[1] + py, at[2] + pz], [wrapYaw(yaw), clampPitch(se.rot[1])], { tags: se.tags });
      e.items = structuredClone(se.items);
      entities++;
    }
  }
  return { blocks, entities, size: out };
}