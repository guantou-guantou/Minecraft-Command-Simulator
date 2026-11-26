import { NbtError, type Nbt, type TagId } from './nbt.ts';

/**
 * Text form of NBT ("SNBT"): `{id:"Sign",FrontText:{Text:"hi"},IsWaxed:1b,Items:[{Count:1b,Slot:3b}]}`.
 * Numbers carry a suffix: `1b` byte, `1s` short, `1` int, `1L` long, `1.5f` float, `1.5d` double (a plain decimal is a double).
 * Arrays are `[B;1,2]`, `[I;1,2]` and `[L;1,2]`. `true` and `false` are bytes.
 */
const KEY = /^[A-Za-z_][\w.+-]*$/;
/** Quotes are written as \u0022 so the text can sit inside a script argument, whose parser only looks at plain double quotes. */
const quote = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\u0022').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')}"`;

const idOf = (n: Nbt): TagId => ({ byte: 1, short: 2, int: 3, long: 4, float: 5, double: 6, bytes: 7, string: 8, list: 9, compound: 10, ints: 11, longs: 12 } as const)[n.t];

function num(v: number, suffix: string): string {
  if (Number.isInteger(v) && (suffix === 'f' || suffix === 'd')) return `${v}.0${suffix}`;
  return `${v}${suffix}`;
}

export function formatSnbt(n: Nbt): string {
  switch (n.t) {
    case 'byte': return `${n.v}b`;
    case 'short': return `${n.v}s`;
    case 'int': return String(n.v);
    case 'long': return `${n.v}L`;
    case 'float': return num(n.v, 'f');
    case 'double': return num(n.v, 'd');
    case 'string': return quote(n.v);
    case 'bytes': return `[B;${n.v.join(',')}]`;
    case 'ints': return `[I;${n.v.join(',')}]`;
    case 'longs': return `[L;${n.v.map((x) => `${x}`).join(',')}]`;
    case 'list': return `[${n.v.map(formatSnbt).join(',')}]`;
    case 'compound': return `{${Object.entries(n.v).map(([k, v]) => `${KEY.test(k) ? k : quote(k)}:${formatSnbt(v)}`).join(',')}}`;
  }
}

class Parser {
  at = 0;
  text: string;
  constructor(text: string) {
    this.text = text;
  }
  ws() {
    while (this.at < this.text.length && /\s/.test(this.text[this.at])) this.at++;
  }
  fail(msg: string): never {
    throw new NbtError(`SNBT: ${msg} at character ${this.at}`);
  }
  eat(c: string) {
    this.ws();
    if (this.text[this.at] !== c) this.fail(`expected "${c}"`);
    this.at++;
  }
  peek() {
    this.ws();
    return this.text[this.at];
  }
  string(): string {
    const q = this.text[this.at++];
    let out = '';
    while (this.at < this.text.length && this.text[this.at] !== q) {
      let c = this.text[this.at++];
      if (c === '\\') {
        const e = this.text[this.at++];
        if (e === 'u') {
          const hex = this.text.slice(this.at, this.at + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.fail('bad \\u escape');
          this.at += 4;
          c = String.fromCharCode(parseInt(hex, 16));
        } else c = e === 'n' ? '\n' : e === 'r' ? '\r' : e === 't' ? '\t' : e;
      }
      out += c;
    }
    if (this.text[this.at++] !== q) this.fail('unterminated string');
    return out;
  }
  key(): string {
    const c = this.peek();
    if (c === '"' || c === "'") return this.string();
    const m = /^[\w.+-]+/.exec(this.text.slice(this.at));
    if (!m) this.fail('expected a key');
    this.at += m[0].length;
    return m[0];
  }
  value(): Nbt {
    const c = this.peek();
    if (c === '{') return this.compound();
    if (c === '[') return this.list();
    if (c === '"' || c === "'") return { t: 'string', v: this.string() };
    const m = /^(-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)([bBsSlLfFdD]?)(?![\w.])/.exec(this.text.slice(this.at));
    if (m) {
      this.at += m[0].length;
      const v = Number(m[1]);
      switch (m[2].toLowerCase()) {
        case 'b': return { t: 'byte', v };
        case 's': return { t: 'short', v };
        case 'l': return { t: 'long', v: BigInt(m[1]) };
        case 'f': return { t: 'float', v };
        case 'd': return { t: 'double', v };
        default: return /^-?\d+$/.test(m[1]) ? { t: 'int', v } : { t: 'double', v };
      }
    }
    const w = /^[A-Za-z_][\w.+-]*/.exec(this.text.slice(this.at));
    if (w && (w[0] === 'true' || w[0] === 'false')) {
      this.at += w[0].length;
      return { t: 'byte', v: w[0] === 'true' ? 1 : 0 };
    }
    return this.fail('expected a value');
  }
  compound(): Nbt {
    this.eat('{');
    const v: Record<string, Nbt> = {};
    if (this.peek() === '}') {
      this.at++;
      return { t: 'compound', v };
    }
    for (;;) {
      const k = this.key();
      this.eat(':');
      v[k] = this.value();
      const c = this.peek();
      this.at++;
      if (c === '}') return { t: 'compound', v };
      if (c !== ',') this.fail('expected "," or "}"');
    }
  }
  list(): Nbt {
    this.eat('[');
    const arr = /^\s*([BIL]);/.exec(this.text.slice(this.at));
    if (arr) {
      this.at += arr[0].length;
      const items: bigint[] = [];
      if (this.peek() !== ']') {
        for (;;) {
          this.ws();
          const m = /^-?\d+[bBlL]?/.exec(this.text.slice(this.at));
          if (!m) this.fail('expected a whole number');
          this.at += m[0].length;
          items.push(BigInt(m[0].replace(/[bBlL]$/, '')));
          const c = this.peek();
          if (c === ']') break;
          this.eat(',');
        }
      }
      this.eat(']');
      return arr[1] === 'B' ? { t: 'bytes', v: items.map(Number) } : arr[1] === 'I' ? { t: 'ints', v: items.map(Number) } : { t: 'longs', v: items };
    }
    const items: Nbt[] = [];
    if (this.peek() !== ']') {
      for (;;) {
        items.push(this.value());
        const c = this.peek();
        if (c === ']') break;
        this.eat(',');
      }
    }
    this.eat(']');
    const of = items.length ? idOf(items[0]) : 0;
    if (items.some((i) => idOf(i) !== of)) this.fail('a list may only hold values of one type');
    return { t: 'list', of: of as TagId, v: items };
  }
}

export function parseSnbt(text: string): Nbt {
  const p = new Parser(text);
  const v = p.value();
  p.ws();
  if (p.at < text.length) p.fail('unexpected text after the value');
  return v;
}