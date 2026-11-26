export type MolangValue = number | string | null;

export class MolangError extends Error {
  index: number;
  constructor(message: string, index: number) {
    super(message);
    this.index = index;
  }
}

interface Tok {
  t: 'num' | 'str' | 'id' | 'op' | 'end';
  v: string;
  n?: number;
  i: number;
}

const OPS2 = ['??', '==', '!=', '<=', '>=', '&&', '||', '->'];
const OPS1 = '+-*/()?:;=,<>![]{}';

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const rest = src.slice(i);
    let m: RegExpExecArray | null;
    if ((m = /^(?:\d+\.?\d*|\.\d+)/.exec(rest))) {
      out.push({ t: 'num', v: m[0], n: Number(m[0]), i });
      i += m[0].length;
    } else if ((m = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/.exec(rest))) {
      out.push({ t: 'id', v: m[0], i });
      i += m[0].length;
    } else if (c === "'") {
      const end = src.indexOf("'", i + 1);
      if (end < 0) throw new MolangError('Unterminated string', i);
      out.push({ t: 'str', v: src.slice(i + 1, end), i });
      i = end + 1;
    } else if (OPS2.includes(src.slice(i, i + 2))) {
      out.push({ t: 'op', v: src.slice(i, i + 2), i });
      i += 2;
    } else if (OPS1.includes(c)) {
      out.push({ t: 'op', v: c, i });
      i++;
    } else {
      throw new MolangError(`Unexpected character "${c}"`, i);
    }
  }
  out.push({ t: 'end', v: '', i: src.length });
  return out;
}

export type Node =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'var'; scope: 'v' | 't'; name: string }
  | { k: 'call'; name: string; args: Node[]; i: number }
  | { k: 'un'; op: string; e: Node }
  | { k: 'bin'; op: string; l: Node; r: Node }
  | { k: 'cond'; c: Node; a: Node; b: Node | null }
  | { k: 'assign'; scope: 'v' | 't'; name: string; e: Node }
  | { k: 'return'; e: Node };

export interface Script {
  stmts: Node[];
  /** True when the script is one bare expression (no semicolon), whose value is the result. */
  single: boolean;
}

const MATH_ARITY: Record<string, number> = {
  abs: 1, acos: 1, asin: 1, atan: 1, atan2: 2, ceil: 1, clamp: 3, cos: 1, exp: 1, floor: 1, hermite_blend: 1, lerp: 3,
  lerprotate: 3, ln: 1, max: 2, min: 2, min_angle: 1, mod: 2, pi: 0, pow: 2, round: 1, sin: 1, sqrt: 1, trunc: 1,
};
const MATH_RANDOM = ['random', 'die_roll', 'die_roll_integer', 'random_integer'];
export const QUERY_ARITY: Record<string, number> = { life_time: 0, anim_time: 0, position: 1, is_alive: 0, is_baby: 0 };
const UNSUPPORTED_WORDS = ['loop', 'for_each', 'break', 'continue'];

class Parser {
  toks: Tok[];
  p = 0;
  constructor(src: string) {
    this.toks = tokenize(src);
  }
  get cur() {
    return this.toks[this.p];
  }
  atEnd() {
    return this.cur.t === 'end';
  }
  isOp(v: string) {
    return this.cur.t === 'op' && this.cur.v === v;
  }
  eat(v: string): boolean {
    if (!this.isOp(v)) return false;
    this.p++;
    return true;
  }
  expect(v: string) {
    if (!this.eat(v)) throw new MolangError(`Expected "${v}" but found ${this.cur.t === 'end' ? 'the end' : `"${this.cur.v}"`}`, this.cur.i);
  }

  script(): Script {
    const stmts: Node[] = [];
    let sawSemicolon = false;
    while (!this.atEnd()) {
      if (this.eat(';')) {
        sawSemicolon = true;
        continue;
      }
      if (this.cur.t === 'id' && this.cur.v.toLowerCase() === 'return') {
        this.p++;
        stmts.push({ k: 'return', e: this.expr() });
      } else stmts.push(this.expr());
      if (!this.atEnd()) {
        if (this.isOp('[') || this.isOp('{')) throw new MolangError(`"${this.cur.v}" (arrays and scopes) is not supported`, this.cur.i);
        if (!this.isOp(';')) throw new MolangError(`Expected ";" but found "${this.cur.v}"`, this.cur.i);
        sawSemicolon = true;
      }
    }
    return { stmts, single: stmts.length === 1 && !sawSemicolon };
  }

  expr(): Node {
    if (this.cur.t === 'id' && this.toks[this.p + 1]?.t === 'op' && this.toks[this.p + 1].v === '=') {
      const target = this.lvalue(this.cur);
      this.p += 2;
      return { k: 'assign', scope: target.scope, name: target.name, e: this.expr() };
    }
    return this.nullish();
  }

  lvalue(t: Tok): { scope: 'v' | 't'; name: string } {
    const m = /^(v|variable|t|temp)\.(.+)$/i.exec(t.v);
    if (!m) throw new MolangError(`Only variables (v.* or t.*) can be assigned, not "${t.v}"`, t.i);
    return { scope: /^v/i.test(m[1]) ? 'v' : 't', name: m[2].toLowerCase() };
  }

  nullish(): Node {
    const l = this.ternary();
    if (this.eat('??')) return { k: 'bin', op: '??', l, r: this.nullish() };
    return l;
  }

  ternary(): Node {
    const c = this.or();
    if (!this.eat('?')) return c;
    const a = this.ternary();
    return { k: 'cond', c, a, b: this.eat(':') ? this.ternary() : null };
  }

  binary(next: () => Node, ops: string[]): Node {
    let l = next();
    while (this.cur.t === 'op' && ops.includes(this.cur.v)) {
      const op = this.cur.v;
      this.p++;
      l = { k: 'bin', op, l, r: next() };
    }
    return l;
  }
  or = () => this.binary(() => this.and(), ['||']);
  and = () => this.binary(() => this.eq(), ['&&']);
  eq = () => this.binary(() => this.rel(), ['==', '!=']);
  rel = () => this.binary(() => this.add(), ['<', '<=', '>', '>=']);
  add = () => this.binary(() => this.mul(), ['+', '-']);
  mul = () => this.binary(() => this.unary(), ['*', '/']);

  unary(): Node {
    if (this.cur.t === 'op' && (this.cur.v === '-' || this.cur.v === '+' || this.cur.v === '!')) {
      const op = this.cur.v;
      this.p++;
      return { k: 'un', op, e: this.unary() };
    }
    return this.primary();
  }

  primary(): Node {
    const t = this.cur;
    if (t.t === 'num') {
      this.p++;
      return { k: 'num', v: t.n! };
    }
    if (t.t === 'str') {
      this.p++;
      return { k: 'str', v: t.v };
    }
    if (t.t === 'op' && t.v === '(') {
      this.p++;
      const e = this.expr();
      this.expect(')');
      return e;
    }
    if (t.t === 'id') {
      this.p++;
      return this.identifier(t);
    }
    if (t.t === 'op' && (t.v === '[' || t.v === '{')) throw new MolangError(`"${t.v}" (arrays and scopes) is not supported`, t.i);
    throw new MolangError(t.t === 'end' ? 'Unexpected end of expression' : `Unexpected "${t.v}"`, t.i);
  }

  args(): Node[] {
    const out: Node[] = [];
    if (this.eat(')')) return out;
    do out.push(this.expr());
    while (this.eat(','));
    this.expect(')');
    return out;
  }

  identifier(t: Tok): Node {
    const low = t.v.toLowerCase();
    if (low === 'true' || low === 'false') return { k: 'num', v: low === 'true' ? 1 : 0 };
    if (low === 'return') throw new MolangError('"return" must start a statement', t.i);
    if (UNSUPPORTED_WORDS.includes(low)) throw new MolangError(`"${t.v}" is not supported`, t.i);
    const m = /^(v|variable|t|temp|q|query|math|c|context|array|geometry|texture|material)\.(.+)$/i.exec(t.v);
    if (!m) throw new MolangError(`Unknown identifier "${t.v}"`, t.i);
    const prefix = m[1].toLowerCase();
    const name = m[2].toLowerCase();
    if (prefix === 'v' || prefix === 'variable' || prefix === 't' || prefix === 'temp') {
      return { k: 'var', scope: prefix[0] === 'v' ? 'v' : 't', name };
    }
    if (prefix === 'math') {
      if (MATH_RANDOM.includes(name)) throw new MolangError(`math.${name} is not simulated (the simulator is deterministic)`, t.i);
      if (!(name in MATH_ARITY)) throw new MolangError(`Unknown function math.${name}`, t.i);
      const args = this.eat('(') ? this.args() : [];
      if (args.length !== MATH_ARITY[name]) throw new MolangError(`math.${name} takes ${MATH_ARITY[name]} argument(s), got ${args.length}`, t.i);
      return { k: 'call', name: `math.${name}`, args, i: t.i };
    }
    if (prefix === 'q' || prefix === 'query') {
      if (!(name in QUERY_ARITY)) throw new MolangError(`Query q.${name} is not simulated`, t.i);
      const args = this.eat('(') ? this.args() : [];
      if (args.length !== QUERY_ARITY[name]) throw new MolangError(`q.${name} takes ${QUERY_ARITY[name]} argument(s), got ${args.length}`, t.i);
      return { k: 'call', name: `q.${name}`, args, i: t.i };
    }
    throw new MolangError(`"${prefix}." is not supported`, t.i);
  }
}

export function parseMolang(src: string): Script {
  return new Parser(src).script();
}

/** Returns the first syntax problem in `src`, or null. An empty string is valid. */
export function lintMolang(src: string): MolangError | null {
  try {
    parseMolang(src);
    return null;
  } catch (e) {
    if (e instanceof MolangError) return e;
    throw e;
  }
}

export interface MolangCtx {
  vars: Record<string, MolangValue>;
  temp: Record<string, MolangValue>;
  query(name: string, args: number[]): number;
}

const RAD = Math.PI / 180;

function num(v: MolangValue): number {
  if (typeof v === 'number') return v;
  if (v === null) return 0;
  throw new MolangError('A string cannot be used as a number', 0);
}

const truthy = (v: MolangValue) => (typeof v === 'string' ? v !== '' : num(v) !== 0);

function wrap180(a: number): number {
  const r = ((((a + 180) % 360) + 360) % 360) - 180;
  return r === -180 ? 180 : r;
}

const MATH: Record<string, (...a: number[]) => number> = {
  abs: Math.abs, acos: (x) => Math.acos(x) / RAD, asin: (x) => Math.asin(x) / RAD, atan: (x) => Math.atan(x) / RAD,
  atan2: (y, x) => Math.atan2(y, x) / RAD, ceil: Math.ceil, clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)),
  cos: (x) => Math.cos(x * RAD), exp: Math.exp, floor: Math.floor, hermite_blend: (t) => 3 * t * t - 2 * t * t * t,
  lerp: (a, b, t) => a + (b - a) * t, lerprotate: (a, b, t) => wrap180(a + wrap180(b - a) * t), ln: Math.log, max: Math.max,
  min: Math.min, min_angle: wrap180, mod: (a, b) => (b === 0 ? 0 : a % b), pi: () => Math.PI, pow: Math.pow,
  round: (x) => Math.round(x), sin: (x) => Math.sin(x * RAD), sqrt: Math.sqrt, trunc: Math.trunc,
};

function run(n: Node, ctx: MolangCtx): MolangValue {
  switch (n.k) {
    case 'num':
    case 'str':
      return n.v;
    case 'var':
      return (n.scope === 'v' ? ctx.vars : ctx.temp)[n.name] ?? null;
    case 'assign': {
      const v = run(n.e, ctx);
      const store = n.scope === 'v' ? ctx.vars : ctx.temp;
      if (v === null) delete store[n.name];
      else store[n.name] = v;
      return v;
    }
    case 'un': {
      const v = run(n.e, ctx);
      if (n.op === '!') return truthy(v) ? 0 : 1;
      return n.op === '-' ? 0 - num(v) : num(v);
    }
    case 'cond':
      return truthy(run(n.c, ctx)) ? run(n.a, ctx) : n.b ? run(n.b, ctx) : 0;
    case 'call': {
      const args = n.args.map((a) => num(run(a, ctx)));
      if (n.name.startsWith('math.')) return MATH[n.name.slice(5)](...args);
      return ctx.query(n.name.slice(2), args);
    }
    case 'return':
      return run(n.e, ctx);
    case 'bin': {
      if (n.op === '??') {
        const l = run(n.l, ctx);
        return l === null ? run(n.r, ctx) : l;
      }
      if (n.op === '&&') return truthy(run(n.l, ctx)) && truthy(run(n.r, ctx)) ? 1 : 0;
      if (n.op === '||') return truthy(run(n.l, ctx)) || truthy(run(n.r, ctx)) ? 1 : 0;
      const l = run(n.l, ctx);
      const r = run(n.r, ctx);
      if (n.op === '==' || n.op === '!=') {
        const eq = typeof l === 'string' || typeof r === 'string' ? l === r : num(l) === num(r);
        return (n.op === '==') === eq ? 1 : 0;
      }
      const a = num(l);
      const b = num(r);
      switch (n.op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': return b === 0 ? 0 : a / b;
        case '<': return a < b ? 1 : 0;
        case '<=': return a <= b ? 1 : 0;
        case '>': return a > b ? 1 : 0;
        default: return a >= b ? 1 : 0;
      }
    }
  }
}

export interface MolangResult {
  value: MolangValue;
  /** True when a `return` statement ended the script. */
  returned: boolean;
}

export function evaluate(script: Script, ctx: MolangCtx): MolangResult {
  let last: MolangValue = 0;
  for (const s of script.stmts) {
    last = run(s, ctx);
    if (s.k === 'return') return { value: last, returned: true };
  }
  return { value: script.single ? last : 0, returned: false };
}

export function fmtValue(v: MolangValue): string {
  if (v === null) return 'null';
  if (typeof v === 'string') return `'${v}'`;
  return String(+v.toFixed(6) + 0);
}