import type { BlockStates, Vec3 } from '../language/types.ts';
import { COMMAND_BLOCK_ID, COMMAND_BLOCK_MODE, AIR, fmtStates } from '../engine/world.ts';
import { cellIndex, type StructureTemplate } from '../engine/structure.ts';
import type { BlockData, CommandBlockData } from '../engine/types.ts';
import { parseStates } from '../language/parser.ts';
import { applyBlockEntity, blockEntityOf } from '../nbt/mcstructure.ts';
import { NbtError, readNbtPrefix, writeNbt, type Nbt } from '../nbt/nbt.ts';

/**
 * BDX (BDump v3, the format of PhoenixBuilder / FastBuilder): a file is `BD@` followed by the brotli-compressed content below.
 * Content = `BDX\0` + author + `\0` + a list of one-byte operations that move a "pen" and place blocks, ending with `XE`.
 * Numbers are big endian; the NBT inside operation 41 is little endian (like .mcstructure).
 * Compression is done by the caller (the desktop app uses Node's brotli); this module only builds and reads the content.
 */
export interface BdxCell {
  /** Position relative to the pen's starting point; may be negative. */
  pos: Vec3;
  block: BlockData;
}

export interface BdxStats {
  blocks: number;
  commandBlocks: number;
  blockEntities: number;
  constants: number;
}

const OP = {
  CreateConstantString: 1,
  PlaceBlockWithBlockStates: 5,
  AddInt16ZValue0: 6,
  PlaceBlock: 7,
  AddZValue0: 8,
  NOP: 9,
  AddInt32ZValue0: 12,
  PlaceBlockWithBlockStatesDeprecated: 13,
  AddX: 14, SubX: 15, AddY: 16, SubY: 17, AddZ: 18, SubZ: 19,
  AddInt16X: 20, AddInt32X: 21, AddInt16Y: 22, AddInt32Y: 23, AddInt16Z: 24, AddInt32Z: 25,
  AddInt8X: 28, AddInt8Y: 29, AddInt8Z: 30,
  PlaceCommandBlockWithCommandBlockData: 36,
  PlaceBlockWithNBTData: 41,
  Terminate: 88,
} as const;

const MOVE = [
  { add: OP.AddX, sub: OP.SubX, i8: OP.AddInt8X, i16: OP.AddInt16X, i32: OP.AddInt32X },
  { add: OP.AddY, sub: OP.SubY, i8: OP.AddInt8Y, i16: OP.AddInt16Y, i32: OP.AddInt32Y },
  { add: OP.AddZ, sub: OP.SubZ, i8: OP.AddInt8Z, i16: OP.AddInt16Z, i32: OP.AddInt32Z },
];

const MODE_NUM = { imp: 0, rep: 1, cha: 2 } as const;
const MODE_FROM_NUM = ['imp', 'rep', 'cha'] as const;

class Out {
  bytes: number[] = [];
  u8(n: number) { this.bytes.push(n & 255); }
  u16(n: number) { this.u8(n >> 8); this.u8(n); }
  u32(n: number) { this.u16(n >>> 16); this.u16(n & 0xffff); }
  cstr(s: string) { this.bytes.push(...new TextEncoder().encode(s), 0); }
  raw(b: Uint8Array) { for (const x of b) this.bytes.push(x); }
}

/** The name the game and the builders expect: `stone`, not `minecraft:stone`; other namespaces stay. */
export const bdxBlockName = (id: string) => id.replace(/^minecraft:/, '');
/** Block states in the command syntax, e.g. `["open_bit"=true,"direction"=2]`. */
export const bdxStates = (states: BlockStates) => fmtStates(states) || '[]';

/** The blocks of a structure as BDX cells (air is left out). */
export function templateCells(t: StructureTemplate): BdxCell[] {
  const cells: BdxCell[] = [];
  for (let x = 0; x < t.size[0]; x++)
    for (let y = 0; y < t.size[1]; y++)
      for (let z = 0; z < t.size[2]; z++) {
        const block = t.blocks[cellIndex(t.size, x, y, z)];
        if (block.id !== AIR) cells.push({ pos: [x, y, z], block });
      }
  return cells;
}

export function buildBdx(cells: BdxCell[], author = 'MCSim'): { content: Uint8Array; stats: BdxStats } {
  const out = new Out();
  out.raw(new TextEncoder().encode('BDX'));
  out.u8(0);
  out.cstr(author);
  const consts = new Map<string, number>();
  const constant = (s: string) => {
    let id = consts.get(s);
    if (id === undefined) {
      id = consts.size;
      if (id > 0xffff) throw new Error('A BDX file holds at most 65536 different block names and block state strings');
      consts.set(s, id);
      out.u8(OP.CreateConstantString);
      out.cstr(s);
    }
    return id;
  };
  const pen: Vec3 = [0, 0, 0];
  const moveTo = (to: Vec3) => {
    for (let a = 0; a < 3; a++) {
      const d = to[a] - pen[a];
      if (d === 0) continue;
      const m = MOVE[a];
      if (d === 1) out.u8(m.add);
      else if (d === -1) out.u8(m.sub);
      else if (d >= -128 && d <= 127) { out.u8(m.i8); out.u8(d); }
      else if (d >= -32768 && d <= 32767) { out.u8(m.i16); out.u16(d); }
      else { out.u8(m.i32); out.u32(d); }
      pen[a] = to[a];
    }
  };
  const stats: BdxStats = { blocks: 0, commandBlocks: 0, blockEntities: 0, constants: 0 };
  const sorted = [...cells].filter((c) => c.block.id !== AIR).sort((a, b) => a.pos[0] - b.pos[0] || a.pos[1] - b.pos[1] || a.pos[2] - b.pos[2]);
  for (const { pos, block: b } of sorted) {
    moveTo(pos);
    stats.blocks++;
    if (b.cb) {
      const mode = COMMAND_BLOCK_MODE[b.id] ?? 'imp';
      const conditional = b.states.conditional_bit === true;
      out.u8(OP.PlaceCommandBlockWithCommandBlockData);
      out.u16((Number(b.states.facing_direction ?? 0) & 7) | (conditional ? 8 : 0));
      out.u32(MODE_NUM[mode]);
      out.cstr(b.cb.command);
      out.cstr(b.cb.name ?? '');
      out.cstr('');
      out.u32(b.cb.delay | 0);
      out.u8(b.cb.firstTick ? 1 : 0);
      out.u8(b.cb.track === false ? 0 : 1);
      out.u8(conditional ? 1 : 0);
      out.u8(b.cb.power === 'needs_redstone' ? 1 : 0);
      stats.commandBlocks++;
      continue;
    }
    const nameId = constant(bdxBlockName(b.id));
    const statesId = constant(bdxStates(b.states));
    const be = blockEntityOf(b, pos);
    if (be) {
      out.u8(OP.PlaceBlockWithNBTData);
      out.u16(nameId);
      out.u16(statesId);
      out.u16(statesId);
      out.raw(writeNbt(be));
      stats.blockEntities++;
    } else {
      out.u8(OP.PlaceBlockWithBlockStates);
      out.u16(nameId);
      out.u16(statesId);
    }
  }
  out.u8(OP.Terminate);
  out.u8(0x45);
  stats.constants = consts.size;
  return { content: Uint8Array.from(out.bytes), stats };
}

export interface ParsedBdxBlock {
  pos: Vec3;
  name: string;
  /** The block states as written in the file (command syntax). */
  states: string;
  /** A numeric data value, for the old operations that use one instead of block states. */
  data?: number;
  cb?: CommandBlockData & { mode: 'imp' | 'rep' | 'cha'; conditional: boolean; data: number };
  nbt?: Nbt;
  /** Container contents from operation 40. */
  chest?: { name: string; count: number; data: number; slot: number }[];
}

/** Reads BDX content (already decompressed). Understands the operations this program writes plus the common movement and placement ones. */
export function parseBdx(content: Uint8Array): { author: string; blocks: ParsedBdxBlock[]; warnings: string[] } {
  const view = new DataView(content.buffer, content.byteOffset, content.byteLength);
  let at = 0;
  const need = (n: number) => { if (at + n > content.length) throw new NbtError('BDX content is truncated'); };
  const u8 = () => (need(1), content[at++]);
  const i8 = () => (need(1), view.getInt8(at++));
  const u16 = () => (need(2), ((at += 2), view.getUint16(at - 2)));
  const i16 = () => (need(2), ((at += 2), view.getInt16(at - 2)));
  const u32 = () => (need(4), ((at += 4), view.getUint32(at - 4)));
  const i32 = () => (need(4), ((at += 4), view.getInt32(at - 4)));
  const cstr = () => {
    const start = at;
    while (at < content.length && content[at] !== 0) at++;
    need(1);
    return new TextDecoder().decode(content.subarray(start, at++));
  };
  if (cstr() !== 'BDX') throw new NbtError('Not BDX content: missing the BDX header');
  const author = cstr();
  const consts: string[] = [];
  const pen: Vec3 = [0, 0, 0];
  const blocks: ParsedBdxBlock[] = [];
  const warnings: string[] = [];
  const constant = (id: number) => {
    if (id >= consts.length) throw new NbtError(`BDX refers to an unknown string ${id}`);
    return consts[id];
  };
  /** The command block fields shared by operations 26, 27 and 36. */
  const cbFields = (data: number) => {
    const mode = MODE_FROM_NUM[u32()] ?? 'imp';
    const command = cstr();
    const name = cstr();
    cstr();
    const delay = i32();
    const firstTick = u8() !== 0;
    const track = u8() !== 0;
    const conditional = u8() !== 0;
    const needsRedstone = u8() !== 0;
    return { mode, data, command, name, delay, firstTick, track, conditional, power: (needsRedstone ? 'needs_redstone' : 'always_on') as 'needs_redstone' | 'always_on', line: 0, rotation: [0, 0] as [number, number] };
  };
  const dataWarning = (name: string, data: number) => {
    if (data) warnings.push(`${name} at (${pen.join(', ')}) is placed with the data value ${data}; its block states are not known, so the default states are used`);
  };
  for (;;) {
    const op = u8();
    switch (op) {
      case OP.CreateConstantString: consts.push(cstr()); break;
      case OP.PlaceBlockWithBlockStates: { const n = constant(u16()); blocks.push({ pos: [...pen], name: n, states: constant(u16()) }); break; }
      case OP.PlaceBlock: {
        const n = constant(u16());
        const data = u16();
        dataWarning(n, data);
        blocks.push({ pos: [...pen], name: n, states: '[]', data });
        break;
      }
      case OP.PlaceBlockWithBlockStatesDeprecated: { const n = constant(u16()); blocks.push({ pos: [...pen], name: n, states: cstr() }); break; }
      case OP.PlaceBlockWithNBTData: {
        const n = constant(u16());
        const s = constant(u16());
        u16();
        const { value, length } = readNbtPrefix(content.subarray(at));
        at += length;
        blocks.push({ pos: [...pen], name: n, states: s, nbt: value });
        break;
      }
      case OP.PlaceCommandBlockWithCommandBlockData: {
        const cb = cbFields(u16());
        blocks.push({ pos: [...pen], name: COMMAND_BLOCK_ID[cb.mode].replace(/^minecraft:/, ''), states: '[]', cb });
        break;
      }
      case 27: {
        const n = constant(u16());
        const data = u16();
        const cb = cbFields(data);
        blocks.push({ pos: [...pen], name: COMMAND_BLOCK_ID[cb.mode].replace(/^minecraft:/, ''), states: '[]', cb });
        void n;
        break;
      }
      case 26: {
        const cb = cbFields(0);
        const last = blocks[blocks.length - 1];
        if (last && last.pos.every((v, i) => v === pen[i])) {
          cb.data = Number(/"facing_direction"=(\d+)/.exec(last.states)?.[1] ?? 0);
          last.cb = cb;
        } else warnings.push(`A command block setting at (${pen.join(', ')}) has no block to apply to and was skipped`);
        break;
      }
      case 40: {
        const n = constant(u16());
        const data = u16();
        dataWarning(n, data);
        const chest = Array.from({ length: u8() }, () => ({ name: cstr(), count: u8(), data: u16(), slot: u8() }));
        blocks.push({ pos: [...pen], name: n, states: '[]', data, chest });
        break;
      }
      case OP.AddX: pen[0]++; break;
      case OP.SubX: pen[0]--; break;
      case OP.AddY: pen[1]++; break;
      case OP.SubY: pen[1]--; break;
      case OP.AddZ: case OP.AddZValue0: pen[2]++; break;
      case OP.SubZ: pen[2]--; break;
      case OP.AddInt8X: pen[0] += i8(); break;
      case OP.AddInt8Y: pen[1] += i8(); break;
      case OP.AddInt8Z: pen[2] += i8(); break;
      case OP.AddInt16X: pen[0] += i16(); break;
      case OP.AddInt16Y: pen[1] += i16(); break;
      case OP.AddInt16Z: pen[2] += i16(); break;
      case OP.AddInt32X: pen[0] += i32(); break;
      case OP.AddInt32Y: pen[1] += i32(); break;
      case OP.AddInt32Z: pen[2] += i32(); break;
      case OP.AddInt16ZValue0: pen[2] += u16(); break;
      case OP.AddInt32ZValue0: pen[2] += u32(); break;
      case OP.NOP: break;
      case OP.Terminate: return { author, blocks, warnings };
      default:
        if (op >= 31 && op <= 35 || op === 37 || op === 38) throw new NbtError('This BDX uses runtime block ids, which need a block id table that this program does not have');
        throw new NbtError(`Unsupported BDX operation ${op} at byte ${at - 1}`);
    }
  }
}

/** A dense structure holding the cells (for the structure library). Refuses boxes that would take too much memory. */
export function cellsToTemplate(cells: BdxCell[]): StructureTemplate {
  if (!cells.length) return { size: [1, 1, 1], origin: [0, 0, 0], blocks: [{ id: AIR, states: {} }], entities: [] };
  const min = [0, 1, 2].map((i) => Math.min(...cells.map((c) => c.pos[i]))) as Vec3;
  const max = [0, 1, 2].map((i) => Math.max(...cells.map((c) => c.pos[i]))) as Vec3;
  const size = max.map((v, i) => v - min[i] + 1) as Vec3;
  if (size[0] * size[1] * size[2] > 4_000_000) throw new Error(`This is ${size.join(' x ')} blocks, too big to keep in the structure library; convert it to a script instead`);
  const blocks: BlockData[] = Array.from({ length: size[0] * size[1] * size[2] }, () => ({ id: AIR, states: {} }));
  for (const c of cells) blocks[cellIndex(size, c.pos[0] - min[0], c.pos[1] - min[1], c.pos[2] - min[2])] = c.block;
  return { size, origin: [0, 0, 0], blocks, entities: [] };
}

/** The blocks of a parsed BDX file as the program's own block data. */
export function bdxToCells(parsed: { blocks: ParsedBdxBlock[]; warnings: string[] }): { cells: BdxCell[]; warnings: string[] } {
  const warnings = [...parsed.warnings];
  const cells = parsed.blocks.map((p): BdxCell => {
    const id = p.name.includes(':') ? p.name : `minecraft:${p.name}`;
    if (p.cb) {
      const { mode, conditional, data, ...cb } = p.cb;
      return { pos: p.pos, block: { id: COMMAND_BLOCK_ID[mode], states: { conditional_bit: conditional, facing_direction: data & 7 }, cb } };
    }
    let states: BlockStates = {};
    try {
      states = parseStates(p.states);
    } catch (e) {
      warnings.push(`${id} at (${p.pos.join(', ')}): ${(e as Error).message}`);
    }
    const block: BlockData = { id, states };
    if (p.nbt) applyBlockEntity(block, p.nbt);
    if (p.chest) {
      block.items = Object.fromEntries(p.chest.map((c) => [`slot.container:${c.slot}`, { id: c.name.includes(':') ? c.name : `minecraft:${c.name}`, count: c.count, data: c.data, components: {} }]));
    }
    return { pos: p.pos, block };
  });
  return { cells, warnings };
}