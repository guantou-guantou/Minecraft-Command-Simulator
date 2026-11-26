import type { Nbt } from '../nbt/nbt.ts';
import type { Item } from './items.ts';

export type Vec3 = [number, number, number];

export interface Diagnostic {
  line: number;
  message: string;
  /** The exact text the problem is about, as offsets into the script (when known). */
  span?: { from: number; to: number };
}

export type Dir = 'up' | 'down' | 'north' | 'south' | 'east' | 'west';
export const DIRS: Dir[] = ['up', 'down', 'north', 'south', 'east', 'west'];
export const DIR_VEC: Record<Dir, Vec3> = {
  up: [0, 1, 0],
  down: [0, -1, 0],
  north: [0, 0, -1],
  south: [0, 0, 1],
  east: [1, 0, 0],
  west: [-1, 0, 0],
};
export const DIR_ID: Record<Dir, number> = { down: 0, up: 1, north: 2, south: 3, west: 4, east: 5 };

export type BlockStates = Record<string, string | number | boolean>;

export interface EntityDecl {
  line: number;
  handle: string | null;
  type: string;
  name: string | null;
  position: Vec3;
  rotation: [number, number];
  tags: string[];
  selected: number;
}

export interface BlockDecl {
  line: number;
  type: string;
  position: Vec3;
  states: BlockStates;
  /** Block entity data written as `nbt={...}` (signs, banners, ...). */
  entityNbt?: Nbt;
}

/** `fill(type=..., from=..., to=...)`: a whole box of one block. */
export interface FillDecl {
  line: number;
  type: string;
  /** Lowest and highest corner, whole numbers. */
  from: Vec3;
  to: Vec3;
  states: BlockStates;
}

export interface ItemDecl {
  line: number;
  target: { handle: string } | { pos: Vec3 };
  slot: string;
  index: number;
  item: Item;
}

export interface Region {
  min: Vec3;
  max: Vec3;
}

export const DEFAULT_REGION: Region = { min: [-64, -64, -64], max: [64, 320, 64] };

export type CbMode = 'imp' | 'cha' | 'rep';
export type CbPower = 'needs_redstone' | 'always_on';

export interface CommandBlockSpec {
  mode: CbMode;
  conditional: boolean;
  power: CbPower;
  delay: number;
  /** "Execute on first tick": a repeating block runs once at once when it is powered, then every `delay` ticks. */
  firstTick?: boolean;
}

export interface ChainNode {
  line: number;
  command: string;
  cb: CommandBlockSpec;
  facing: Dir;
  pos: Vec3 | null;
}

export interface Chain {
  name: string;
  line: number;
  position: Vec3;
  positioned: boolean;
  facing: Dir;
  rotation: [number, number];
  nodes: ChainNode[];
}

export type Op = '==' | '!=' | '>=' | '<=' | '>' | '<';

export type Cond =
  | { k: 'entity'; selector: string; op: Op; n: number }
  | { k: 'score'; holder: string; objective: string; op: Op; n: number }
  | { k: 'block'; pos: Vec3; id: string }
  | { k: 'tag'; selector: string; has: boolean; tag: string }
  | { k: 'chat'; text: string }
  | { k: 'particles'; op: Op; n: number };

export type StepBody =
  | { kind: 'run' | 'activate' | 'deactivate'; chain: string }
  | { kind: 'tick'; n: number }
  | { kind: 'command'; text: string }
  | { kind: 'expect'; cond: Cond; text: string };

export type Step = StepBody & { line: number };

export interface TestCase {
  name: string;
  line: number;
  steps: Step[];
}

export interface WorldDecl {
  line: number;
  /** Time of day in ticks (0 to 23999). */
  time?: number;
  weather?: 'clear' | 'rain' | 'thunder';
  difficulty?: 'peaceful' | 'easy' | 'normal' | 'hard';
  spawn?: Vec3;
  /** Seed of the random numbers (`@r`, `scoreboard players random`). */
  seed?: number;
}

/** A unction name: block: commands run one after the other by /function name. */
export interface FunctionDecl {
  name: string;
  line: number;
  commands: { line: number; text: string }[];
}

export interface Program {
  world: WorldDecl | null;
  tests: TestCase[];
  functions: FunctionDecl[];
  entities: EntityDecl[];
  blocks: BlockDecl[];
  fills: FillDecl[];
  items: ItemDecl[];
  region: Region | null;
  chains: Chain[];
  diagnostics: Diagnostic[];
}
