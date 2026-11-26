import type { BdxCell } from '../bdx/bdx.ts';
import type { SavedEntity } from '../engine/structure.ts';
import type { BlockData } from '../engine/types.ts';
import { AIR, COMMAND_BLOCK_MODE, fmtStates } from '../engine/world.ts';
import { DEFAULT_REGION, DIR_ID, DIR_VEC, type Dir, type Vec3 } from '../language/types.ts';
import type { Nbt } from '../nbt/nbt.ts';
import { formatSnbt } from '../nbt/snbt.ts';

export interface ToMcsimOptions {
  /** Where the lowest corner of the structure goes in the script (the structure's cell (0,0,0)). */
  offset: Vec3;
  /** Merge boxes of identical plain blocks into `fill(...)` lines. */
  fills: boolean;
  entities: boolean;
  /** Name of the source file, for the header comment. */
  source: string;
  /** Problems found while reading the file; they are repeated in the header. */
  warnings?: string[];
}

export interface ToMcsimResult {
  text: string;
  notes: string[];
  stats: { blocks: number; fills: number; chains: number; commandBlocks: number; blockEntities: number; entities: number; items: number };
}

const DIR_BY_ID = Object.fromEntries(Object.entries(DIR_ID).map(([d, id]) => [id, d])) as Record<number, Dir>;
const IDENT = /^[A-Za-z_]\w*$/;
const key = (p: Vec3) => p.join(',');
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const short = (id: string) => id.replace(/^minecraft:/, '');
const round = (n: number, d = 5) => Math.round(n * 10 ** d) / 10 ** d;
const vec = (p: Vec3) => `(${p.join(', ')})`;
/** An exact coordinate: always with a decimal point, because a whole x or z means "centre of the block". */
const exact = (n: number) => (Number.isInteger(round(n)) ? `${round(n)}.0` : String(round(n)));
const dirOf = (b: BlockData): Dir => DIR_BY_ID[Number(b.states.facing_direction ?? 0)] ?? 'down';
const modeOf = (b: BlockData) => COMMAND_BLOCK_MODE[b.id] ?? 'imp';

const DEFAULT_ENTITY_NBT = new Set(['id', 'isMovable', 'Findable', 'IsIgnoreShuffle', 'IsOpened']);

/** The block entity data worth writing as `nbt=...` (without position, and without what the script models separately). */
function nbtText(b: BlockData): string | null {
  if (b.entityNbt?.t !== 'compound') return null;
  const v: Record<string, Nbt> = { ...b.entityNbt.v };
  delete v.x;
  delete v.y;
  delete v.z;
  if (b.items) delete v.Items;
  if (Object.keys(v).every((k) => DEFAULT_ENTITY_NBT.has(k))) return null;
  return formatSnbt({ t: 'compound', v });
}

interface Box {
  from: Vec3;
  to: Vec3;
  block: BlockData;
}

/** Merges plain blocks into as few boxes as a simple greedy sweep finds. */
function mergeBoxes(cells: BdxCell[]): Box[] {
  const kinds = new Map<string, { block: BlockData; set: Set<string>; pos: Vec3[] }>();
  for (const c of cells) {
    const k = `${c.block.id}${fmtStates(c.block.states)}`;
    let g = kinds.get(k);
    if (!g) kinds.set(k, (g = { block: c.block, set: new Set(), pos: [] }));
    g.set.add(key(c.pos));
    g.pos.push(c.pos);
  }
  const out: Box[] = [];
  for (const g of kinds.values()) {
    const used = new Set<string>();
    const free = (x: number, y: number, z: number) => g.set.has(`${x},${y},${z}`) && !used.has(`${x},${y},${z}`);
    for (const [x, y, z] of g.pos.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2])) {
      if (!free(x, y, z)) continue;
      let z2 = z;
      while (free(x, y, z2 + 1)) z2++;
      let y2 = y;
      const rowFree = (yy: number, xx: number) => Array.from({ length: z2 - z + 1 }, (_, i) => z + i).every((zz) => free(xx, yy, zz));
      while (rowFree(y2 + 1, x)) y2++;
      let x2 = x;
      const slabFree = (xx: number) => Array.from({ length: y2 - y + 1 }, (_, i) => y + i).every((yy) => rowFree(yy, xx));
      while (slabFree(x2 + 1)) x2++;
      for (let a = x; a <= x2; a++) for (let b = y; b <= y2; b++) for (let c = z; c <= z2; c++) used.add(`${a},${b},${c}`);
      out.push({ from: [x, y, z], to: [x2, y2, z2], block: g.block });
    }
  }
  return out.sort((a, b) => a.from[1] - b.from[1] || a.from[2] - b.from[2] || a.from[0] - b.from[0]);
}

const statesArg = (b: BlockData) => (Object.keys(b.states).length ? `, states=${fmtStates(b.states)}` : '');

function itemLine(target: string, slotKey: string, item: { id: string; count: number; data: number; components: Record<string, unknown> }): string {
  const [slot, index] = slotKey.split(':');
  const comp = Object.keys(item.components).length ? `, comp=${JSON.stringify(item.components)}` : '';
  return `item(target=${target}, slot=${slot}, index=${index ?? 0}, type=${short(item.id)}, count=${item.count}${item.data ? `, data=${item.data}` : ''}${comp})`;
}

/** Turns the blocks (and entities) of a structure file into script text that builds the same scene. */
export function cellsToMcsim(allCells: BdxCell[], entities: SavedEntity[], o: ToMcsimOptions): ToMcsimResult {
  const notes: string[] = [...(o.warnings ?? [])];
  const at = (p: Vec3): Vec3 => add(p, o.offset);
  const cells = allCells.filter((c) => c.block.id !== AIR).map((c) => ({ pos: at(c.pos), block: c.block }));
  const stats = { blocks: 0, fills: 0, chains: 0, commandBlocks: 0, blockEntities: 0, entities: 0, items: 0 };

  const isChainCell = (c: BdxCell) => !!c.block.cb && c.block.cb.command.trim() !== '';
  const chainCells = cells.filter(isChainCell);
  const rest = cells.filter((c) => !isChainCell(c));
  const emptyCbs = rest.filter((c) => c.block.cb).length;
  if (emptyCbs) notes.push(`${emptyCbs} command block(s) without a command are written as plain blocks (block(...)); their command block data is not kept`);

  const lines: string[] = [];
  const special: BdxCell[] = [];
  const plain: BdxCell[] = [];
  for (const c of rest) (c.block.items || nbtText(c.block) || c.block.cb ? special : plain).push(c);

  const blockLines: string[] = [];
  if (o.fills) {
    for (const b of mergeBoxes(plain)) {
      const same = b.from.every((v, i) => v === b.to[i]);
      blockLines.push(same ? `block(type=${short(b.block.id)}, pos=${vec(b.from)}${statesArg(b.block)})` : `fill(type=${short(b.block.id)}, from=${vec(b.from)}, to=${vec(b.to)}${statesArg(b.block)})`);
      if (same) stats.blocks++;
      else stats.fills++;
    }
  } else {
    for (const c of [...plain].sort((a, b) => a.pos[1] - b.pos[1] || a.pos[2] - b.pos[2] || a.pos[0] - b.pos[0])) {
      blockLines.push(`block(type=${short(c.block.id)}, pos=${vec(c.pos)}${statesArg(c.block)})`);
      stats.blocks++;
    }
  }
  const specialLines: string[] = [];
  for (const c of [...special].sort((a, b) => a.pos[1] - b.pos[1] || a.pos[2] - b.pos[2] || a.pos[0] - b.pos[0])) {
    const nbt = nbtText(c.block);
    specialLines.push(`block(type=${short(c.block.id)}, pos=${vec(c.pos)}${statesArg(c.block)}${nbt ? `, nbt=${nbt}` : ''})`);
    stats.blocks++;
    if (nbt) stats.blockEntities++;
    for (const [slotKey, item] of Object.entries(c.block.items ?? {})) {
      specialLines.push(itemLine(vec(c.pos), slotKey, item));
      stats.items++;
    }
  }

  // command block chains: follow the facing of each block
  const byPos = new Map(chainCells.map((c) => [key(c.pos), c]));
  const next = (c: BdxCell) => {
    const t = byPos.get(key(add(c.pos, DIR_VEC[dirOf(c.block)])));
    return t && modeOf(t.block) === 'cha' ? t : undefined;
  };
  const pointedAt = new Set<string>();
  for (const c of chainCells) {
    const t = next(c);
    if (t) pointedAt.add(key(t.pos));
  }
  const order = [...chainCells].sort((a, b) => a.pos[1] - b.pos[1] || a.pos[2] - b.pos[2] || a.pos[0] - b.pos[0]);
  const visited = new Set<string>();
  const chains: BdxCell[][] = [];
  const walk = (head: BdxCell) => {
    const nodes = [head];
    visited.add(key(head.pos));
    for (let t = next(head); t && !visited.has(key(t.pos)); t = next(t)) {
      nodes.push(t);
      visited.add(key(t.pos));
    }
    chains.push(nodes);
  };
  for (const c of order) if (!visited.has(key(c.pos)) && (modeOf(c.block) !== 'cha' || !pointedAt.has(key(c.pos)))) walk(c);
  for (const c of order) if (!visited.has(key(c.pos))) walk(c);

  const used = new Set<string>(['main']);
  const chainLines: string[] = [];
  chains.forEach((nodes, ci) => {
    const customName = nodes[0].block.cb?.name ?? '';
    let name = IDENT.test(customName) && !/^e\d+$/.test(customName) && !used.has(customName) ? customName : '';
    for (let n = ci + 1; !name; n++) if (!used.has(`chain${n}`)) name = `chain${n}`;
    used.add(name);
    const facing = dirOf(nodes[0].block);
    chainLines.push(`chain ${name}(pos=${vec(nodes[0].pos)}, facing=${facing}):`);
    nodes.forEach((node, i) => {
      const cb = node.block.cb!;
      const mode = modeOf(node.block);
      const spec: string[] = [];
      if (mode !== (i === 0 ? 'imp' : 'cha')) spec.push(`mode=${mode}`);
      if (node.block.states.conditional_bit === true) {
        if (i === 0) notes.push(`The first command block of chain ${name} at ${vec(node.pos)} is conditional; a script chain cannot start with a conditional block, so the condition was dropped`);
        else spec.push('conditional=true');
      }
      if (cb.power !== (mode === 'cha' ? 'always_on' : 'needs_redstone')) spec.push(`power=${cb.power}`);
      if (cb.delay > 0) spec.push(`delay=${cb.delay}`);
      if (cb.firstTick) spec.push('first_tick=true');
      const inherited = i === 0 ? facing : dirOf(nodes[i - 1].block);
      if (dirOf(node.block) !== inherited) spec.push(`facing=${dirOf(node.block)}`);
      if (spec.length) chainLines.push(`    cb(${spec.join(', ')})`);
      let command = cb.command.trim().replace(/^\//, '');
      if (/[\r\n]/.test(command)) {
        command = command.replace(/\s*[\r\n]+\s*/g, ' ');
        notes.push(`The command at ${vec(node.pos)} had line breaks; they were replaced by spaces`);
      }
      if (command.endsWith('\\')) {
        command = command.replace(/\\+$/, '').trimEnd();
        notes.push(`The command at ${vec(node.pos)} ended with a backslash, which a script would read as a line continuation; it was removed`);
      }
      if (/(^|\s)#/.test(command.replace(/"[^"]*"/g, ''))) notes.push(`The command at ${vec(node.pos)} contains " #" outside quotes, which a script reads as a comment`);
      chainLines.push(`    /${command}`);
      stats.commandBlocks++;
    });
    stats.chains++;
  });

  // entities
  const entityLines: string[] = [];
  const usable = o.entities ? entities.filter((e) => e.type !== 'minecraft:player') : [];
  if (!o.entities && entities.length) notes.push(`${entities.length} entities were not converted (entities are switched off)`);
  usable.forEach((e, i) => {
    const handle = `e${i + 1}`;
    const clean = (s: string) => {
      if (!s.includes('"')) return s;
      notes.push(`A double quote in "${s}" was replaced by a single quote (a script cannot hold one inside a string)`);
      return s.replace(/"/g, "'");
    };
    const parts = [`type=${short(e.type)}`];
    const p = e.pos.map((v, k) => v + o.offset[k]);
    parts.push(`pos=(${exact(p[0])}, ${exact(p[1])}, ${exact(p[2])})`);
    if (e.rot[0] || e.rot[1]) parts.push(`rot=(${round(e.rot[0], 3)}, ${round(e.rot[1], 3)})`);
    if (e.name) parts.push(`name="${clean(e.name)}"`);
    if (e.tags.length) parts.push(`tags=[${e.tags.map((t) => `"${clean(t)}"`).join(', ')}]`);
    entityLines.push(`${handle} = ent(${parts.join(', ')})`);
    for (const [slotKey, item] of Object.entries(e.items)) {
      entityLines.push(itemLine(handle, slotKey, item));
      stats.items++;
    }
    stats.entities++;
  });
  if (usable.some((e) => e.raw)) notes.push('Entities keep their type, position, rotation, name, tags and held/worn items; all other data (poses, variants, health, effects, ...) is not stored in a script');

  // region
  const all: Vec3[] = [...cells.map((c) => c.pos), ...usable.map((e) => e.pos.map((v, k) => Math.floor(v + o.offset[k])) as Vec3)];
  const region = all.length
    ? {
        min: [0, 1, 2].map((i) => Math.min(DEFAULT_REGION.min[i], ...all.map((p) => p[i]))) as Vec3,
        max: [0, 1, 2].map((i) => Math.max(DEFAULT_REGION.max[i], ...all.map((p) => p[i]))) as Vec3,
      }
    : null;
  const low = all.length ? ([0, 1, 2].map((i) => Math.min(...all.map((p) => p[i]))) as Vec3) : o.offset;
  const high = all.length ? ([0, 1, 2].map((i) => Math.max(...all.map((p) => p[i]))) as Vec3) : o.offset;

  lines.push(`# Converted from ${o.source}`);
  lines.push(`# Lowest corner (${low.join(', ')}), highest corner (${high.join(', ')}); the file's first block is at ${vec(o.offset)}`);
  for (const n of notes) lines.push(`# note: ${n}`);
  lines.push('');
  if (region && (region.min.some((v, i) => v !== DEFAULT_REGION.min[i]) || region.max.some((v, i) => v !== DEFAULT_REGION.max[i]))) lines.push(`region(from=${vec(region.min)}, to=${vec(region.max)})`, '');
  for (const group of [blockLines, specialLines, chainLines, entityLines]) if (group.length) lines.push(...group, '');
  return { text: `${lines.join('\n').trimEnd()}\n`, notes, stats };
}