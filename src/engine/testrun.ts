import type { Cond, Op, Program, TestCase } from '../language/types.ts';
import { holders } from './scoreboard.ts';
import { Simulation } from './simulation.ts';

export interface TestFailure {
  line: number;
  message: string;
}

export interface TestResult {
  name: string;
  line: number;
  passed: boolean;
  failures: TestFailure[];
  checks: number;
}

const compare = (a: number, op: Op, b: number) =>
  op === '==' ? a === b : op === '!=' ? a !== b : op === '>=' ? a >= b : op === '<=' ? a <= b : op === '>' ? a > b : a < b;

const id = (s: string) => (s.includes(':') ? s : `minecraft:${s}`);

/** Returns a failure message, or null when the condition holds. */
export function check(sim: Simulation, c: Cond): string | null {
  switch (c.k) {
    case 'entity': {
      const n = sim.select(c.selector).length;
      return compare(n, c.op, c.n) ? null : `expected ${c.selector} count ${c.op} ${c.n} but it was ${n}`;
    }
    case 'score': {
      const ctx = { executor: null, pos: [0, 0, 0] as [number, number, number], rot: [0, 0] as [number, number], anchor: 'feet' as const };
      const map = sim.world.scores.get(c.objective);
      if (!map) return `objective "${c.objective}" does not exist`;
      const keys = holders(c.holder, ctx, sim.world);
      if (keys.length !== 1) return `${c.holder} matches ${keys.length} holders; a test needs exactly one`;
      const v = map.get(keys[0]);
      if (v === undefined) return `${c.holder} has no score in ${c.objective}`;
      return compare(v, c.op, c.n) ? null : `expected score ${c.holder} ${c.objective} ${c.op} ${c.n} but it was ${v}`;
    }
    case 'block': {
      const b = sim.world.blocks.get(c.pos.join(','));
      const actual = b?.id ?? 'minecraft:air';
      return actual === id(c.id) ? null : `expected block ${c.pos.join(' ')} to be ${c.id} but it was ${actual.replace('minecraft:', '')}`;
    }
    case 'tag': {
      const ents = sim.select(c.selector);
      if (!ents.length) return `${c.selector} matches no entity`;
      const bad = ents.filter((e) => e.tags.has(c.tag) !== c.has);
      return bad.length ? `${bad.length} of ${ents.length} entities ${c.has ? 'lack' : 'have'} the tag ${c.tag}` : null;
    }
    case 'chat':
      return sim.events.some((e) => e.type === 'chat' && e.text.includes(c.text)) ? null : `no chat message contains "${c.text}"`;
    case 'particles': {
      const n = sim.events.filter((e) => e.type === 'effect' && e.kind === 'particle').length;
      return compare(n, c.op, c.n) ? null : `expected particles ${c.op} ${c.n} but there were ${n}`;
    }
  }
}

export function runTest(program: Program, t: TestCase, makeSim: (p: Program) => Simulation): TestResult {
  const sim = makeSim(program);
  const failures: TestFailure[] = [];
  let checks = 0;
  const chain = (name: string) => program.chains.find((x) => x.name === name);
  for (const s of t.steps) {
    switch (s.kind) {
      case 'run':
      case 'activate':
      case 'deactivate':
        if (!chain(s.chain)) failures.push({ line: s.line, message: `unknown chain "${s.chain}"` });
        else if (s.kind === 'run') sim.runChain(s.chain);
        else if (s.kind === 'activate') sim.activate(s.chain);
        else sim.deactivate(s.chain);
        break;
      case 'tick':
        sim.advance(s.n);
        break;
      case 'command':
        sim.runCommand(`/${s.text}`, null, [0, 0, 0], s.line);
        break;
      case 'expect': {
        checks++;
        const m = check(sim, s.cond);
        if (m) failures.push({ line: s.line, message: m });
        break;
      }
    }
  }  return { name: t.name, line: t.line, passed: failures.length === 0, failures, checks };
}

/** Runs the tests of the script; `only` limits it to the named ones (in script order). */
export function runTests(program: Program, makeSim: (p: Program) => Simulation = (p) => new Simulation(p), only?: ReadonlySet<string>): TestResult[] {
  return program.tests.filter((t) => !only || only.has(t.name)).map((t) => runTest(program, t, makeSim));
}