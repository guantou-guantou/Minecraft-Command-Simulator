/** Bedrock NBT: little endian, as used by .mcstructure files (no header, no compression). */
export type Nbt =
  | { t: 'byte'; v: number }
  | { t: 'short'; v: number }
  | { t: 'int'; v: number }
  | { t: 'long'; v: bigint }
  | { t: 'float'; v: number }
  | { t: 'double'; v: number }
  | { t: 'string'; v: string }
  | { t: 'bytes'; v: number[] }
  | { t: 'ints'; v: number[] }
  | { t: 'longs'; v: bigint[] }
  | { t: 'list'; of: TagId; v: Nbt[] }
  | { t: 'compound'; v: Record<string, Nbt> };

export type TagId = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

const ID: Record<Nbt['t'], TagId> = {
  byte: 1, short: 2, int: 3, long: 4, float: 5, double: 6, bytes: 7, string: 8, list: 9, compound: 10, ints: 11, longs: 12,
};
const NAME: Record<number, Nbt['t']> = Object.fromEntries(Object.entries(ID).map(([k, v]) => [v, k])) as Record<number, Nbt['t']>;

export const tagId = (n: Nbt): TagId => ID[n.t];

export const byte = (v: number): Nbt => ({ t: 'byte', v });
export const short = (v: number): Nbt => ({ t: 'short', v });
export const int = (v: number): Nbt => ({ t: 'int', v });
export const long = (v: bigint | number): Nbt => ({ t: 'long', v: BigInt(v) });
export const float = (v: number): Nbt => ({ t: 'float', v });
export const double = (v: number): Nbt => ({ t: 'double', v });
export const string = (v: string): Nbt => ({ t: 'string', v });
export const compound = (v: Record<string, Nbt>): Nbt => ({ t: 'compound', v });
export const list = (of: TagId, v: Nbt[]): Nbt => ({ t: 'list', of, v });

export class NbtWriter {
  private chunks: Uint8Array[] = [];
  private u8(n: number) {
    this.chunks.push(Uint8Array.of(n & 0xff));
  }
  private view(size: number, fill: (v: DataView) => void) {
    const b = new Uint8Array(size);
    fill(new DataView(b.buffer));
    this.chunks.push(b);
  }
  private str(s: string) {
    const b = new TextEncoder().encode(s);
    this.view(2, (v) => v.setUint16(0, b.length, true));
    this.chunks.push(b);
  }
  private payload(n: Nbt): void {
    switch (n.t) {
      case 'byte': return this.u8(n.v);
      case 'short': return this.view(2, (v) => v.setInt16(0, n.v, true));
      case 'int': return this.view(4, (v) => v.setInt32(0, n.v, true));
      case 'long': return this.view(8, (v) => v.setBigInt64(0, n.v, true));
      case 'float': return this.view(4, (v) => v.setFloat32(0, n.v, true));
      case 'double': return this.view(8, (v) => v.setFloat64(0, n.v, true));
      case 'string': return this.str(n.v);
      case 'bytes':
        this.view(4, (v) => v.setInt32(0, n.v.length, true));
        for (const b of n.v) this.u8(b);
        return;
      case 'ints':
        this.view(4, (v) => v.setInt32(0, n.v.length, true));
        for (const i of n.v) this.view(4, (v) => v.setInt32(0, i, true));
        return;
      case 'longs':
        this.view(4, (v) => v.setInt32(0, n.v.length, true));
        for (const i of n.v) this.view(8, (v) => v.setBigInt64(0, i, true));
        return;
      case 'list':
        this.u8(n.v.length ? tagId(n.v[0]) : n.of);
        this.view(4, (v) => v.setInt32(0, n.v.length, true));
        for (const item of n.v) this.payload(item);
        return;
      case 'compound':
        for (const [k, child] of Object.entries(n.v)) {
          this.u8(tagId(child));
          this.str(k);
          this.payload(child);
        }
        this.u8(0);
    }
  }
  write(root: Nbt, name = ''): Uint8Array {
    this.chunks = [];
    this.u8(tagId(root));
    this.str(name);
    this.payload(root);
    const out = new Uint8Array(this.chunks.reduce((s, c) => s + c.length, 0));
    let at = 0;
    for (const c of this.chunks) {
      out.set(c, at);
      at += c.length;
    }
    return out;
  }
}

export class NbtError extends Error {}

class Reader {
  at = 0;
  view: DataView;
  bytes: Uint8Array;
  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  need(n: number) {
    if (this.at + n > this.bytes.length) throw new NbtError(`Unexpected end of data at byte ${this.at}`);
  }
  u8() {
    this.need(1);
    return this.bytes[this.at++];
  }
  i8() {
    this.need(1);
    return this.view.getInt8(this.at++);
  }
  i16() {
    this.need(2);
    const v = this.view.getInt16(this.at, true);
    this.at += 2;
    return v;
  }
  i32() {
    this.need(4);
    const v = this.view.getInt32(this.at, true);
    this.at += 4;
    return v;
  }
  i64() {
    this.need(8);
    const v = this.view.getBigInt64(this.at, true);
    this.at += 8;
    return v;
  }
  f32() {
    this.need(4);
    const v = this.view.getFloat32(this.at, true);
    this.at += 4;
    return v;
  }
  f64() {
    this.need(8);
    const v = this.view.getFloat64(this.at, true);
    this.at += 8;
    return v;
  }
  str() {
    const n = this.view.getUint16((this.need(2), this.at), true);
    this.at += 2;
    this.need(n);
    const s = new TextDecoder().decode(this.bytes.subarray(this.at, this.at + n));
    this.at += n;
    return s;
  }
  count() {
    const n = this.i32();
    if (n < 0 || n > this.bytes.length) throw new NbtError(`Bad length ${n} at byte ${this.at}`);
    return n;
  }
  payload(id: number, depth: number): Nbt {
    if (depth > 512) throw new NbtError('NBT nested too deeply');
    switch (id) {
      case 1: return { t: 'byte', v: this.i8() };
      case 2: return { t: 'short', v: this.i16() };
      case 3: return { t: 'int', v: this.i32() };
      case 4: return { t: 'long', v: this.i64() };
      case 5: return { t: 'float', v: this.f32() };
      case 6: return { t: 'double', v: this.f64() };
      case 7: return { t: 'bytes', v: Array.from({ length: this.count() }, () => this.i8()) };
      case 8: return { t: 'string', v: this.str() };
      case 9: {
        const of = this.u8();
        const n = this.count();
        if (of === 0 && n > 0) throw new NbtError('List of end tags');
        return { t: 'list', of: of as TagId, v: Array.from({ length: n }, () => this.payload(of, depth + 1)) };
      }
      case 10: {
        const v: Record<string, Nbt> = {};
        for (;;) {
          const t = this.u8();
          if (t === 0) break;
          const k = this.str();
          v[k] = this.payload(t, depth + 1);
        }
        return { t: 'compound', v };
      }
      case 11: return { t: 'ints', v: Array.from({ length: this.count() }, () => this.i32()) };
      case 12: return { t: 'longs', v: Array.from({ length: this.count() }, () => this.i64()) };
      default: throw new NbtError(`Unknown tag type ${id} at byte ${this.at - 1}`);
    }
  }
}

/** Reads one named root tag from the start of `bytes` and tells how many bytes it took. */
export function readNbtPrefix(bytes: Uint8Array): { name: string; value: Nbt; length: number } {
  const r = new Reader(bytes);
  const id = r.u8();
  if (id !== 10) throw new NbtError(`Expected a compound at the root, found tag ${id}`);
  const name = r.str();
  const value = r.payload(id, 0);
  return { name, value, length: r.at };
}

/** Reads one named root tag. */
export function readNbt(bytes: Uint8Array): { name: string; value: Nbt } {
  const { name, value } = readNbtPrefix(bytes);
  return { name, value };
}

export const writeNbt = (root: Nbt, name = ''): Uint8Array => new NbtWriter().write(root, name);

export { NAME as TAG_NAMES };

/** Compact text form for debugging and tests. */
export function dump(n: Nbt, depth = 0, max = 6): string {
  const pad = '  '.repeat(depth);
  switch (n.t) {
    case 'compound':
      return `{\n${Object.entries(n.v).map(([k, c]) => `${pad}  ${k}: ${dump(c, depth + 1, max)}`).join('\n')}\n${pad}}`;
    case 'list':
      return `[${n.v.length}x ${NAME[n.of] ?? n.of}]${n.v.length && n.v.length <= max ? ` [${n.v.map((c) => dump(c, depth + 1, max)).join(', ')}]` : n.v.length ? ` first=${dump(n.v[0], depth + 1, max)}` : ''}`;
    case 'bytes': case 'ints': return `${n.t}(${n.v.length})`;
    case 'longs': return `longs(${n.v.length})`;
    case 'string': return JSON.stringify(n.v);
    case 'long': return `${n.v}L`;
    default: return `${n.v}${n.t === 'byte' ? 'b' : n.t === 'short' ? 's' : n.t === 'float' ? 'f' : ''}`;
  }
}