import { maxHealthOf } from './entity-data.ts';
import { DEFAULT_REGION, DIR_ID, type BlockStates, type CbMode, type Program, type Region, type Vec3 } from '../language/types.ts';
import { entitySlotKey, slotKey } from '../language/items.ts';
import { clampPitch, wrapYaw } from './geometry.ts';
import { GAMERULE_DEFAULTS, type GameRuleValue } from './gamerules.ts';
import { CommandError, type BlockData, type Difficulty, type Entity, type TickingArea, type Weather } from './types.ts';

export const AIR = 'minecraft:air';
export const COMMAND_BLOCK_ID: Record<CbMode, string> = {
  imp: 'minecraft:command_block',
  cha: 'minecraft:chain_command_block',
  rep: 'minecraft:repeating_command_block',
};
export const COMMAND_BLOCK_MODE: Record<string, CbMode> = Object.fromEntries(
  Object.entries(COMMAND_BLOCK_ID).map(([mode, id]) => [id, mode as CbMode]),
);

const key = (p: Vec3) => p.join(',');

export function fmtStates(s: BlockStates): string {
  const keys = Object.keys(s).sort();
  return keys.length ? `[${keys.map((k) => `"${k}"=${typeof s[k] === 'string' ? `"${s[k]}"` : s[k]}`).join(',')}]` : '';
}

export const fmtBlock = (b: BlockData) => `${b.id}${fmtStates(b.states)}`;

export class World {
  entities: Entity[] = [];
  blocks = new Map<string, BlockData>();
  scores = new Map<string, Map<string, number>>();
  gamerules: Record<string, GameRuleValue> = { ...GAMERULE_DEFAULTS };
  region: Region;
  tickingAreas: TickingArea[] = [];
  /** Functions waiting for schedule on_area_loaded. */
  scheduled: { tick: number; fn: string; pos: Vec3; line: number }[] = [];
  /** Which objective each scoreboard display slot shows. */
  scoreDisplay: Record<string, { objective: string; order: string } | undefined> = {};
  /** Display names of objectives (the optional last argument of `objectives add`). */
  objectiveNames = new Map<string, string>();
  /** Structures saved with `/structure save ... memory`; they vanish when the world is reset. */
  structures = new Map<string, import('./structure.ts').StructureTemplate>();
  /** Total ticks since the world started; always advances. */
  gameTime = 0;
  /** Time of day in ticks, counting whole days; only advances while dodaylightcycle is true. */
  time = 0;
  weather: Weather = 'clear';
  /** Ticks left of a timed weather, 0 when it lasts until changed. */
  weatherTicks = 0;
  difficulty: Difficulty = 'normal';
  spawn: Vec3 | null = null;
  private rngState = 0x2545f491;
  private nextId = 1;

  /** Deterministic random numbers in [0, 1): the same script and seed always give the same sequence. */
  random(): number {
    let t = (this.rngState += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  setSeed(seed: number): void {
    this.rngState = seed | 0;
  }

  constructor(region: Region | null) {
    this.region = region ?? DEFAULT_REGION;
  }

  addEntity(
    type: string, name: string | null, pos: Vec3, rot: [number, number] = [0, 0],
    opts: { handle?: string | null; tags?: string[]; selected?: number; born?: number } = {},
  ): Entity {
    const e: Entity = {
      id: this.nextId++, handle: opts.handle ?? null, type, name,
      pos: [...pos], rot: [...rot], tags: new Set(opts.tags ?? []), items: {}, selected: opts.selected ?? 0, effects: {},
      health: maxHealthOf(type), maxHealth: maxHealthOf(type), born: opts.born ?? 0, gamemode: 'survival', spawn: null, xpLevel: 0, xpPoints: 0, inputs: {}, molang: {}, anims: {},
    };
    this.entities.push(e);
    return e;
  }

  removeEntity(e: Entity): void {
    this.entities = this.entities.filter((x) => x !== e);
  }

  entityByHandle(handle: string): Entity | undefined {
    return this.entities.find((e) => e.handle === handle);
  }

  inRegion(p: Vec3): boolean {
    return p.every((v, i) => v >= this.region.min[i] && v <= this.region.max[i]);
  }

  private check(p: Vec3): void {
    if (!this.inRegion(p)) throw new CommandError('failed', `(${p.join(', ')}) is outside the simulated region`);
  }

  getBlockData(p: Vec3): BlockData {
    this.check(p);
    return this.blocks.get(key(p)) ?? { id: AIR, states: {} };
  }

  getBlock(p: Vec3): string {
    return this.getBlockData(p).id;
  }

  setBlock(p: Vec3, id: string, states: BlockStates = {}): void {
    this.setBlockData(p, { id, states });
  }

  setBlockData(p: Vec3, data: BlockData): void {
    this.check(p);
    if (data.id === AIR) this.blocks.delete(key(p));
    else this.blocks.set(key(p), structuredClone(data));
  }
}

export function buildWorld(program: Program): World {
  const world = new World(program.region);
  if (program.world) {
    const w = program.world;
    if (w.time !== undefined) world.time = w.time;
    if (w.weather) world.weather = w.weather;
    if (w.difficulty) world.difficulty = w.difficulty;
    if (w.spawn) world.spawn = [...w.spawn];
    if (w.seed !== undefined) world.setSeed(w.seed);
  }
  const put = (p: Vec3, data: BlockData) => {
    if (world.inRegion(p)) world.setBlockData(p, data);
  };
  for (const f of program.fills) {
    const lo = f.from.map((v, i) => Math.max(v, world.region.min[i])) as Vec3;
    const hi = f.to.map((v, i) => Math.min(v, world.region.max[i])) as Vec3;
    for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) world.setBlockData([x, y, z], { id: f.type, states: f.states });
  }
  for (const b of program.blocks) put(b.position, { id: b.type, states: b.states, ...(b.entityNbt ? { entityNbt: b.entityNbt } : {}) });
  for (const c of program.chains) {
    for (const n of c.nodes) {
      if (!n.pos) continue;
      put(n.pos, {
        id: COMMAND_BLOCK_ID[n.cb.mode],
        states: { facing_direction: DIR_ID[n.facing], conditional_bit: n.cb.conditional },
        cb: { command: n.command, delay: n.cb.delay, power: n.cb.power, line: n.line, rotation: [...c.rotation], ...(n.cb.firstTick !== undefined ? { firstTick: n.cb.firstTick } : {}) },
      });
    }
  }
  for (const e of program.entities) {
    world.addEntity(e.type, e.name, e.position, [wrapYaw(e.rotation[0]), clampPitch(e.rotation[1])], { handle: e.handle, tags: e.tags, selected: e.selected });
  }
  for (const it of program.items) {
    if ('handle' in it.target) {
      const ent = world.entityByHandle(it.target.handle);
      if (ent) ent.items[entitySlotKey(ent.type === 'minecraft:player', ent.selected, it.slot, it.index)] = structuredClone(it.item);
    } else if (world.inRegion(it.target.pos)) {
      const b = world.getBlockData(it.target.pos);
      if (b.id !== AIR) world.setBlockData(it.target.pos, { ...b, items: { ...b.items, [slotKey(it.slot, it.index)]: structuredClone(it.item) } });
    }
  }
  return world;
}
