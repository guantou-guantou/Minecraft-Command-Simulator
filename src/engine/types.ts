import type { Inventory } from '../language/items.ts';
import type { BlockStates, CbPower, Vec3 } from '../language/types.ts';
import type { Nbt } from '../nbt/nbt.ts';

export type Status = 'executed' | 'failed' | 'no_targets' | 'condition_false' | 'syntax_error' | 'unimplemented';

export interface CommandBlockData {
  command: string;
  delay: number;
  power: CbPower;
  line: number;
  rotation: [number, number];
  /** Custom name, "execute on first tick" and "track output" of the command block (the game defaults when missing). */
  name?: string;
  firstTick?: boolean;
  track?: boolean;
}

export interface BlockData {
  id: string;
  states: BlockStates;
  cb?: CommandBlockData;
  items?: Inventory;
  /** The block entity data (signs, banners, skulls, ...) kept as read from a file so nothing is lost on export. */
  entityNbt?: Nbt;
}

import type { MolangValue, Script } from './molang.ts';

export interface AnimState {
  animation: string;
  nextState: string;
  blendOut: number;
  source: string;
  script: Script;
  since: number;
}

export type Weather = 'clear' | 'rain' | 'thunder';
export type Difficulty = 'peaceful' | 'easy' | 'normal' | 'hard';

export interface TickingArea {
  name: string;
  kind: 'box' | 'circle';
  from: Vec3;
  to: Vec3;
  radius: number;
  preload: boolean;
}

export interface EffectState {
  amplifier: number;
  ticks: number | null;
  hideParticles: boolean;
}

export interface Entity {
  id: number;
  handle: string | null;
  type: string;
  name: string | null;
  pos: Vec3;
  rot: [number, number];
  tags: Set<string>;
  items: Inventory;
  selected: number;
  effects: Record<string, EffectState>;
  born: number;
  gamemode: string;
  spawn: Vec3 | null;
  xpLevel: number;
  xpPoints: number;
  inputs: Record<string, 'enabled' | 'disabled'>;
  molang: Record<string, MolangValue>;
  anims: Record<string, AnimState>;
}

export type SimEvent =
  | { type: 'chat'; kind: 'say' | 'error' | 'system'; tick: number; line: number; sender: string | null; text: string; to?: string }
  | { type: 'screen'; tick: number; line: number; to: string; slot: 'title' | 'subtitle' | 'actionbar' | 'clear' | 'reset' | 'times'; text: string }
  | { type: 'effect'; kind: 'particle'; tick: number; line: number; id: string; pos: Vec3 }
  | { type: 'trace'; tick: number; line: number; branch: string | null; status: Status | null; message: string }
  | { type: 'change'; tick: number; line: number; target: string; what: string };

export interface Ctx {
  executor: Entity | null;
  pos: Vec3;
  rot: [number, number];
  anchor: 'feet' | 'eyes';
}

export interface Env {
  world: import('./world.ts').World;
  /** Structures kept on disk (the project's structure library): they survive a reset. */
  library: Map<string, import('./structure.ts').StructureTemplate>;
  commands: import('./registry.ts').Registry;
  /** The unction name: blocks of the script. */
  functions: Map<string, import('../language/types.ts').FunctionDecl>;
  /** How deep function calls are nested, and how many commands the running function calls may still run. */
  fnDepth?: number;
  fnBudget?: { left: number };
  emit: (e: SimEvent) => void;
  line: number;
  tick: number;
}

export class CommandError extends Error {
  status: 'syntax_error' | 'unimplemented' | 'failed';
  constructor(status: 'syntax_error' | 'unimplemented' | 'failed', message: string) {
    super(message);
    this.status = status;
  }
}

export function label(e: Entity | null): string {
  if (!e) return '(no executor)';
  const type = e.type.replace(/^minecraft:/, '');
  return e.name ? `${e.name} (${type})` : `${type}#${e.id}`;
}
