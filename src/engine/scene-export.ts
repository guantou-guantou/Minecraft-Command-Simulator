import { DEFAULT_REGION, DIR_ID, type Chain, type Program, type Vec3 } from '../language/types.ts';
import { captureStructure, type SavedEntity, type StructureTemplate } from './structure.ts';
import type { BlockData } from './types.ts';
import { AIR, COMMAND_BLOCK_ID, buildWorld, type World } from './world.ts';

/** The game's structure block cannot hold more than this many blocks along one side. */
export const MAX_STRUCTURE_SIDE = 64;

export class SceneExportError extends Error {
  line: number | null;
  constructor(message: string, line: number | null = null) {
    super(message);
    this.line = line;
  }
}

export interface SceneExport {
  template: StructureTemplate;
  /** Where the chains without a position of their own were placed. */
  placed: { chain: string; pos: Vec3 }[];
  skippedPlayers: number;
}

const cell = (p: Vec3) => p.map(Math.floor) as Vec3;
const key = (p: Vec3) => p.join(',');

function checkInRegion(world: World, program: Program): void {
  const out = (p: Vec3) => !world.inRegion(cell(p));
  const where = (p: Vec3) => `(${p.join(', ')})`;
  for (const b of program.blocks) if (out(b.position)) throw new SceneExportError(`Block ${b.type} at ${where(b.position)} is outside the region`, b.line);
  for (const f of program.fills) if (out(f.from) || out(f.to)) throw new SceneExportError(`Fill ${f.type} from ${where(f.from)} to ${where(f.to)} is outside the region`, f.line);
  for (const e of program.entities) if (out(e.position)) throw new SceneExportError(`Entity ${e.type} at ${where(e.position)} is outside the region`, e.line);
  for (const c of program.chains) for (const n of c.nodes) if (n.pos && out(n.pos)) throw new SceneExportError(`Chain ${c.name}: a command block at ${where(n.pos)} is outside the region`, n.line);
}

interface Box {
  min: Vec3;
  max: Vec3;
}

function contentBox(world: World): Box | null {
  const cells = [
    ...[...world.blocks.keys()].map((k) => k.split(',').map(Number) as Vec3),
    ...world.entities.filter((e) => e.type !== 'minecraft:player').map((e) => cell(e.pos)),
  ];
  if (!cells.length) return null;
  return {
    min: [0, 1, 2].map((i) => Math.min(...cells.map((c) => c[i]))) as Vec3,
    max: [0, 1, 2].map((i) => Math.max(...cells.map((c) => c[i]))) as Vec3,
  };
}

/** Puts every chain that has no position of its own in a free straight run of blocks, facing east, with free cells all around. */
function placeVirtualChains(world: World, chains: Chain[]): { chain: string; pos: Vec3 }[] {
  const placed: { chain: string; pos: Vec3 }[] = [];
  const taken = new Set<string>();
  for (const [k] of world.blocks) taken.add(k);
  for (const e of world.entities) if (e.type !== 'minecraft:player') taken.add(key(cell(e.pos)));
  const { min: rmin, max: rmax } = world.region;
  for (const chain of chains) {
    const n = chain.nodes.length;
    if (!n) continue;
    const free = (x: number, y: number, z: number) => {
      if (x < rmin[0] || x + n - 1 > rmax[0] || y < rmin[1] || y > rmax[1] || z < rmin[2] || z > rmax[2]) return false;
      for (let dx = -1; dx <= n; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) if (taken.has(key([x + dx, y + dy, z + dz]))) return false;
      return true;
    };
    const box = contentBox(world) ?? { min: [0, 0, 0] as Vec3, max: [0, 0, 0] as Vec3 };
    let at: Vec3 | null = null;
    let tries = 0;
    const scan = (ys: number[], zs: number[], xs: number[]) => {
      for (const y of ys) for (const z of zs) for (const x of xs) if (!at && ++tries < 2_000_000 && free(x, y, z)) at = [x, y, z];
    };
    const range = (a: number, b: number, step = 1) => Array.from({ length: Math.max(0, Math.floor((b - a) / step) + 1) }, (_, i) => a + i * step);
    scan(range(box.min[1], box.max[1]), range(box.min[2], box.max[2]), range(box.min[0], box.max[0] - n + 1));
    if (!at) scan(range(box.min[1], rmax[1] - 1, 2), range(box.min[2], rmax[2], 2), [box.min[0]]);
    if (!at) throw new SceneExportError(`There is no free place inside the region for chain ${chain.name} (${n} command blocks)`, chain.line);
    const [x, y, z] = at as Vec3;
    chain.nodes.forEach((node, i) => {
      const pos: Vec3 = [x + i, y, z];
      world.setBlockData(pos, {
        id: COMMAND_BLOCK_ID[node.cb.mode],
        states: { facing_direction: DIR_ID.east, conditional_bit: node.cb.conditional },
        cb: { command: node.command, delay: node.cb.delay, power: node.cb.power, line: node.line, rotation: [...chain.rotation] },
      });
      taken.add(key(pos));
    });
    placed.push({ chain: chain.name, pos: [x, y, z] });
  }
  return placed;
}

function prepare(program: Program, unlimited: boolean): { world: World; placed: { chain: string; pos: Vec3 }[] } {
  let prog = program;
  if (unlimited) {
    const spots: Vec3[] = [
      ...program.blocks.map((b) => b.position),
      ...program.fills.flatMap((f) => [f.from, f.to]),
      ...program.entities.map((e) => cell(e.position)),
      ...program.chains.flatMap((c) => c.nodes.flatMap((n) => (n.pos ? [n.pos] : []))),
    ];
    const base = program.region ?? DEFAULT_REGION;
    const min = [0, 1, 2].map((i) => Math.min(base.min[i], ...spots.map((p) => p[i]))) as Vec3;
    const max = [0, 1, 2].map((i) => Math.max(base.max[i], ...spots.map((p) => p[i]))) as Vec3;
    prog = { ...program, region: { min, max } };
  }
  const world = buildWorld(prog);
  if (!unlimited) checkInRegion(world, prog);
  const virtual = prog.chains.filter((c) => c.nodes.length && c.nodes.every((n) => !n.pos));
  return { world, placed: placeVirtualChains(world, virtual) };
}

/**
 * Builds the starting scene of the script (after Reset) as one structure: every block, command block chain,
 * container and entity inside the smallest box that holds them. Chains without a position are laid out in free places first.
 */
export function exportScene(program: Program): SceneExport {
  const { world, placed } = prepare(program, false);
  const box = contentBox(world);
  if (!box || (![...world.blocks.values()].some((b) => b.id !== AIR) && !world.entities.some((e) => e.type !== 'minecraft:player'))) throw new SceneExportError('There is nothing to export');
  const tooBig = (b: Box) => {
    const size = [0, 1, 2].map((i) => b.max[i] - b.min[i] + 1);
    return size.some((s) => s > MAX_STRUCTURE_SIDE) ? size : null;
  };
  const size = tooBig(box);
  if (size) throw new SceneExportError(`The scene is ${size.join(' x ')} blocks; a structure can be at most ${MAX_STRUCTURE_SIDE} blocks along each side`);
  const template = captureStructure(world, box.min, box.max, true, true);
  return { template, placed, skippedPlayers: world.entities.filter((e) => e.type === 'minecraft:player').length };
}

export interface SceneBlocks {
  /** Blocks relative to `origin`. */
  cells: { pos: Vec3; block: BlockData }[];
  /** Entities relative to `origin` (BDX cannot store them; they can be turned into commands). */
  entities: SavedEntity[];
  /** The lowest corner of everything in the scene, in script coordinates: the base point for importing it. */
  origin: Vec3;
  size: Vec3;
  placed: { chain: string; pos: Vec3 }[];
}

/** The blocks of the starting scene without any size limit, for formats that are built block by block (BDX). */
export function exportSceneBlocks(program: Program): SceneBlocks {
  const { world, placed } = prepare(program, true);
  const entries = [...world.blocks].filter(([, b]) => b.id !== AIR).map(([k, b]) => ({ pos: k.split(',').map(Number) as Vec3, block: b }));
  const ents = world.entities.filter((e) => e.type !== 'minecraft:player');
  if (!entries.length && !ents.length) throw new SceneExportError('There is nothing to export');
  const spots = [...entries.map((e) => e.pos), ...ents.map((e) => cell(e.pos))];
  const min = [0, 1, 2].map((i) => Math.min(...spots.map((p) => p[i]))) as Vec3;
  const max = [0, 1, 2].map((i) => Math.max(...spots.map((p) => p[i]))) as Vec3;
  return {
    cells: entries.map((e) => ({ pos: e.pos.map((v, i) => v - min[i]) as Vec3, block: e.block })),
    entities: ents.map((e) => ({ type: e.type, name: e.name, pos: e.pos.map((v, i) => v - min[i]) as Vec3, rot: [...e.rot], tags: [...e.tags], items: structuredClone(e.items) })),
    origin: min,
    size: max.map((v, i) => v - min[i] + 1) as Vec3,
    placed,
  };
}