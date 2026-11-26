import { DIRS, DIR_ID, DIR_VEC, type Chain, type ChainNode, type Dir, type FunctionDecl, type Program, type Vec3 } from '../language/types.ts';
import type { StructureTemplate } from './structure.ts';
import { createBuiltinRegistry } from './builtins.ts';
import { tickAnimations } from './molang-commands.ts';
import { tickWorld } from './clock.ts';
import { executeCommand } from './commands.ts';
import { tickInstant } from './health-commands.ts';
import type { Registry } from './registry.ts';
import { resolveTargets } from './selector.ts';
import { CommandError, label, type BlockData, type CommandBlockData, type Entity, type SimEvent } from './types.ts';
import { COMMAND_BLOCK_MODE, buildWorld, type World } from './world.ts';

export interface NodeResult {
  line: number;
  success: boolean;
  skipped: boolean;
}

interface ChainState {
  powered: boolean;
  last: boolean[];
}

interface BlockRuntime {
  powered: boolean;
  last: boolean;
}

type Job = { tick: number; chain: Chain; idx: number } | { tick: number; pos: Vec3 };

const CHAIN_BLOCK = 'minecraft:chain_command_block';
const key = (p: Vec3) => p.join(',');
const add = (p: Vec3, d: Vec3) => p.map((v, i) => v + d[i]) as Vec3;
const dirOf = (data: BlockData): Dir => DIRS.find((d) => DIR_ID[d] === data.states.facing_direction) ?? 'east';

function cbOf(data: BlockData): CommandBlockData {
  const mode = COMMAND_BLOCK_MODE[data.id];
  return data.cb ?? { command: '', delay: 0, power: mode === 'cha' ? 'always_on' : 'needs_redstone', line: 0, rotation: [0, 0] };
}

export class Simulation {
  program: Program;
  world: World;
  /** Structures saved in `disk` mode or imported from files; unlike the world they survive Reset. */
  library = new Map<string, StructureTemplate>();
  events: SimEvent[] = [];
  tick = 0;
  commands: Registry = createBuiltinRegistry();
  /** Drops trace and change events entirely (used by analysis tools that only need results). */
  quiet = false;
  /** Maximum trace and change events recorded per command; the rest are counted and dropped. */
  traceBudget = 5000;
  private states = new Map<string, ChainState>();
  private blockRt = new Map<string, BlockRuntime>();
  private queue: Job[] = [];
  private functions: Map<string, FunctionDecl>;

  constructor(program: Program) {
    this.program = program;
    this.world = buildWorld(program);
    this.functions = new Map(program.functions.map((f) => [f.name, f]));
    this.initChains();
  }

  reset(): void {
    this.world = buildWorld(this.program);
    this.events = [];
    this.tick = 0;
    this.initChains();
  }

  private initChains(): void {
    this.queue = [];
    this.states.clear();
    this.blockRt.clear();
    for (const c of this.program.chains) this.states.set(c.name, { powered: false, last: c.nodes.map(() => false) });
    for (const c of this.program.chains) {
      const entry = c.nodes[0];
      if (entry && entry.cb.mode !== 'cha' && entry.cb.power === 'always_on') this.activate(c.name);
    }
  }

  findEntity(name: string): Entity | undefined {
    return this.world.entities.find((e) => e.name === name);
  }

  private chain(name: string): Chain {
    const chain = this.program.chains.find((c) => c.name === name);
    if (!chain) throw new Error(`Unknown chain "${name}"`);
    return chain;
  }

  private rt(p: Vec3): BlockRuntime {
    let r = this.blockRt.get(key(p));
    if (!r) this.blockRt.set(key(p), (r = { powered: false, last: false }));
    return r;
  }

  private emit = (e: SimEvent) => void this.events.push(e);

  /** Entities a selector matches when run from the console at the origin. */
  select(selector: string, from: Vec3 = [0, 0, 0]): Entity[] {
    return resolveTargets(selector, { executor: null, pos: from, rot: [0, 0], anchor: 'feet' }, this.world);
  }

  runCommand(text: string, executor: Entity | null, pos: Vec3, line = 0, rotation?: [number, number], source: 'block' | 'console' = 'console'): boolean {
    const rot: [number, number] = rotation ? [...rotation] : executor ? [...executor.rot] : [0, 0];
    const src = text.trim().replace(/^\//, '');
    let used = 0;
    let dropped = 0;
    const emit = (raw: SimEvent) => {
      let e = raw;
      if (source === 'block' && e.type === 'chat' && e.kind === 'system' && !e.to) {
        if (this.world.gamerules.commandblockoutput === false) return;
        e = { ...e, text: `\u00a77\u00a7o[!: ${e.text}]\u00a7r` };
      }
      if (e.type === 'trace' || e.type === 'change') {
        if (this.quiet) return;
        if (++used > this.traceBudget) {
          dropped++;
          return;
        }
      }
      this.emit(e);
    };
    const env = { world: this.world, library: this.library, commands: this.commands, functions: this.functions, source, tick: this.tick, line, emit };
    try {
      const ok = executeCommand(src, { executor, pos, rot, anchor: 'feet' as const }, env) > 0;
      if (dropped) {
        this.note(line, 'unimplemented', ` further trace/change event(s) were not recorded (budget: ${this.traceBudget} per command)`);
      }
      return ok;
    } catch (e) {
      if (!(e instanceof CommandError)) throw e;
      this.emit({ type: 'trace', tick: this.tick, line, branch: null, status: e.status, message: e.message });
      this.emit({ type: 'chat', kind: 'error', tick: this.tick, line, sender: null, text: e.message });
      return false;
    }
  }

  sendChat(text: string, sender: Entity | null): void {
    this.emit({ type: 'chat', kind: 'say', tick: this.tick, line: 0, sender: sender ? (sender.name ?? sender.type) : null, text });
  }

  private origin(node: ChainNode): Vec3 {
    if (!node.pos) return [0, 0, 0];
    const [x, y, z] = node.pos;
    return [x + 0.5, y, z + 0.5];
  }

  private note(line: number, status: 'condition_false' | 'unimplemented', message: string): void {
    this.emit({ type: 'trace', tick: this.tick, line, branch: null, status, message });
  }

  private execNode(chain: Chain, idx: number, last: boolean[]): NodeResult {
    const node = chain.nodes[idx];
    if (node.cb.conditional && !last[idx - 1]) {
      this.note(node.line, 'condition_false', 'skipped: conditional block, previous block did not succeed');
      last[idx] = false;
      return { line: node.line, success: false, skipped: true };
    }
    last[idx] = this.runCommand(node.command, null, this.origin(node), node.line, chain.rotation, 'block');
    return { line: node.line, success: last[idx], skipped: false };
  }

  /** Runs every block once, in order, ignoring mode, power and delay (debug helper). */
  runChain(name: string): NodeResult[] {
    const chain = this.chain(name);
    const last: boolean[] = [];
    return chain.nodes.map((node, idx) => {
      if (node.cb.mode === 'rep' || node.cb.delay > 0) {
        this.note(node.line, 'unimplemented', 'repeat mode and delay are ignored by an immediate run; use activate() and advance()');
      }
      return this.execNode(chain, idx, last);
    });
  }

  /** Sends a redstone signal to the chain entry. Repeat chains stay active until deactivate(). */
  activate(name: string): void {
    const chain = this.chain(name);
    const entry = chain.nodes[0];
    if (!entry) return;
    if (entry.pos) {
      this.activateAt(entry.pos, chain.nodes.flatMap((n) => (n.pos ? [n.pos] : [])), entry.line);
      return;
    }
    const st = this.states.get(name)!;
    if (entry.cb.mode === 'rep' && st.powered) return;
    st.powered = true;
    this.enqueueOnce({ tick: this.tick + (entry.cb.mode === 'rep' && entry.cb.firstTick ? 0 : entry.cb.delay), chain, idx: 0 });
  }

  /** Powers the command block at a world position (and optionally more blocks) and triggers it. */
  activateAt(pos: Vec3, alsoPower: Vec3[] = [], line = 0): void {
    const data = this.blockAt(pos);
    const mode = data && COMMAND_BLOCK_MODE[data.id];
    if (!data || !mode) {
      this.note(line, 'condition_false', `not activated: (${pos.join(', ')}) is not a command block`);
      return;
    }
    if (mode === 'rep' && this.rt(pos).powered) return;
    this.rt(pos).powered = true;
    for (const p of alsoPower) this.rt(p).powered = true;
    this.enqueueOnce({ tick: this.tick + (mode === 'rep' && cbOf(data).firstTick ? 0 : cbOf(data).delay), pos });
  }

  /** A block that is triggered twice in the same tick (for example by initChains and an explicit activate) still runs once. */
  private enqueueOnce(job: Job): void {
    const same = (j: Job) =>
      j.tick === job.tick && ('pos' in j && 'pos' in job ? key(j.pos) === key(job.pos) : 'chain' in j && 'chain' in job && j.chain === job.chain && j.idx === job.idx);
    if (!this.queue.some(same)) this.queue.push(job);
  }

  deactivateAt(pos: Vec3): void {
    this.rt(pos).powered = false;
  }

  deactivate(name: string): void {
    const chain = this.chain(name);
    this.states.get(name)!.powered = false;
    for (const n of chain.nodes) if (n.pos) this.rt(n.pos).powered = false;
  }

  advance(ticks = 1): void {
    for (let n = 0; n < ticks; n++) {
      tickWorld(this.world);
      this.tickEffects();
      tickAnimations(this.world.entities, this.tick + 1, this.emit, this.quiet);
      this.processTick();
      this.runScheduled();
      this.tick++;
    }
  }

  private runScheduled(): void {
    const due = this.world.scheduled.filter((s) => s.tick <= this.tick);
    if (!due.length) return;
    this.world.scheduled = this.world.scheduled.filter((s) => s.tick > this.tick);
    for (const s of due) this.runCommand(`/function ${s.fn}`, null, s.pos, s.line);
  }

  private tickEffects(): void {
    for (const e of [...this.world.entities]) {
      for (const [id, fx] of Object.entries(e.effects)) {
        if (id === 'instant_health' || id === 'instant_damage') {
          if (this.world.entities.includes(e)) tickInstant({ world: this.world, library: this.library, commands: this.commands, functions: this.functions, source: 'console', tick: this.tick, line: 0, emit: this.emit }, e, id, fx);
        }
        if (fx.ticks === null) continue;
        fx.ticks--;
        if (fx.ticks > 0) continue;
        delete e.effects[id];
        if (!this.quiet) this.emit({ type: 'change', tick: this.tick, line: 0, target: label(e), what: `effect ${id} expired` });
      }
    }
  }

  private processTick(): void {
    let jobs = 0;
    const cap = Number(this.world.gamerules.maxcommandchainlength);
    for (;;) {
      const i = this.queue.findIndex((j) => j.tick <= this.tick);
      if (i < 0) return;
      if (++jobs > cap) {
        this.queue = this.queue.filter((j) => j.tick > this.tick);
        const text = `Command chain limit (maxcommandchainlength = ${cap}) exceeded in one tick; remaining blocks dropped`;
        this.emit({ type: 'chat', kind: 'error', tick: this.tick, line: 0, sender: null, text });
        return;
      }
      const [job] = this.queue.splice(i, 1);
      if ('pos' in job) this.runBlock(job.pos);
      else this.runVirtual(job.chain, job.idx);
    }
  }

  private enabled(line: number): boolean {
    if (this.world.gamerules.commandblocksenabled !== false) return true;
    this.note(line, 'condition_false', 'not run: the commandblocksenabled game rule is false');
    return false;
  }

  private blockAt(p: Vec3): BlockData | null {
    try {
      return this.world.getBlockData(p);
    } catch {
      return null;
    }
  }

  private runBlock(pos: Vec3): void {
    const data = this.blockAt(pos);
    const mode = data && COMMAND_BLOCK_MODE[data.id];
    if (!data || !mode) return;
    const cb = cbOf(data);
    const rt = this.rt(pos);
    if (!this.enabled(cb.line)) return;
    if (mode === 'rep' && !rt.powered) return;
    if (mode === 'cha' && cb.power === 'needs_redstone' && !rt.powered) {
      this.note(cb.line, 'condition_false', 'not run: block needs redstone and the chain is not powered');
      rt.last = false;
      return;
    }
    const facing = dirOf(data);
    const behind = add(pos, DIR_VEC[facing].map((v) => -v) as Vec3);
    if (data.states.conditional_bit === true && !this.blockRt.get(key(behind))?.last) {
      this.note(cb.line, 'condition_false', 'skipped: conditional block, previous block did not succeed');
      rt.last = false;
    } else if (cb.command) {
      rt.last = this.runCommand(cb.command, null, [pos[0] + 0.5, pos[1], pos[2] + 0.5], cb.line, cb.rotation);
    } else {
      rt.last = false;
    }
    const target = add(pos, DIR_VEC[facing]);
    const next = this.blockAt(target);
    if (next?.id === CHAIN_BLOCK) this.queue.push({ tick: this.tick + cbOf(next).delay, pos: target });
    if (mode === 'rep' && rt.powered) this.queue.push({ tick: this.tick + Math.max(1, cb.delay), pos });
  }

  private runVirtual(chain: Chain, idx: number): void {
    const st = this.states.get(chain.name)!;
    const node = chain.nodes[idx];
    if (!this.enabled(node.line)) return;
    if (idx === 0 && node.cb.mode === 'rep' && !st.powered) return;
    if (node.cb.mode === 'cha' && node.cb.power === 'needs_redstone' && !st.powered) {
      this.note(node.line, 'condition_false', 'not run: block needs redstone and the chain is not powered');
      st.last[idx] = false;
      return;
    }
    this.execNode(chain, idx, st.last);
    if (idx + 1 < chain.nodes.length) this.queue.push({ tick: this.tick + chain.nodes[idx + 1].cb.delay, chain, idx: idx + 1 });
    if (idx === 0 && node.cb.mode === 'rep' && st.powered) this.queue.push({ tick: this.tick + Math.max(1, node.cb.delay), chain, idx: 0 });
  }
}
