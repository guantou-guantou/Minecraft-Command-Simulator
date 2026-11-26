import { parse } from '../../language/parser.ts';
import type { Vec3 } from '../../language/types.ts';
import { Simulation } from '../../engine/simulation.ts';

export interface NxSpec {
  counts: Vec3;
  spacing: Vec3;
  center: Vec3;
  yawTag: string;
  pitchTag: string;
  action: string;
  helperPos: Vec3;
}

export interface NxLevel {
  axis: 'x' | 'y' | 'z';
  step: number;
  text: string;
}

export interface NxGenerated {
  command: string;
  entities: string;
  levels: NxLevel[];
  expectedPoints: number;
}

export const DEFAULT_SPEC: NxSpec = {
  counts: [4, 4, 4],
  spacing: [1, 1, 1],
  center: [2, 66, 2],
  yawTag: 'p',
  pitchTag: 'q',
  action: 'particle minecraft:villager_happy ~ ~ ~',
  helperPos: [9, 70, 9],
};

const clean = (n: number) => Math.round(n * 1e9) / 1e9;
const TAG = /^[A-Za-z0-9_.-]+$/;

export function levelsFor(count: number): number {
  if (!Number.isInteger(count) || count < 1) throw new Error(`Point count must be a positive integer, got ${count}`);
  const k = Math.log2(count);
  if (!Number.isInteger(k)) throw new Error(`Point count ${count} is not a power of 2; an nx tree only produces 2^k points per axis`);
  return k;
}

export function stepsFor(count: number, spacing: number): number[] {
  const k = levelsFor(count);
  return Array.from({ length: k }, (_, j) => clean(spacing * (j === 0 ? 0.5 : 2 ** (j - 1))));
}

export function generate(spec: NxSpec): NxGenerated {
  for (const t of [spec.yawTag, spec.pitchTag]) if (!TAG.test(t)) throw new Error(`Invalid tag "${t}"`);
  if (spec.yawTag === spec.pitchTag) throw new Error('The yaw tag and the pitch tag must differ');
  if (!spec.action.trim()) throw new Error('The final action is empty');
  if (spec.spacing.some((s) => !(s > 0))) throw new Error('Spacing must be positive');
  const levels: NxLevel[] = [];
  const axes: ['x' | 'y' | 'z', number][] = [['x', 0], ['z', 2], ['y', 1]];
  for (const [axis, i] of axes) {
    for (const step of stepsFor(spec.counts[i], spec.spacing[i])) {
      const tag = axis === 'y' ? spec.pitchTag : spec.yawTag;
      const local = axis === 'x' ? `^${step} ^ ^` : `^ ^ ^${step}`;
      levels.push({ axis, step, text: `rotated as @e[tag=${tag}] positioned ${local}` });
    }
  }
  const [cx, cy, cz] = spec.center;
  const exact = (n: number) => (Number.isInteger(n) ? n.toFixed(1) : String(n));
  const command = `execute positioned ${exact(cx)} ${cy} ${exact(cz)} ${levels.map((l) => l.text).join(' ')}${levels.length ? ' ' : ''}run ${spec.action.trim().replace(/^\//, '')}`;
  const [hx, hy, hz] = spec.helperPos;
  const at = `(${hx}, ${hy}, ${hz})`;
  const needPitch = spec.counts[1] > 1;
  const entities = [
    `ent(type=armor_stand, position=${at}, rotation=(0, 0), tags=["${spec.yawTag}"])`,
    `ent(type=armor_stand, position=${at}, rotation=(180, 0), tags=["${spec.yawTag}"])`,
    ...(needPitch
      ? [
          `ent(type=boat, position=${at}, rotation=(0, -90), tags=["${spec.pitchTag}"])`,
          `ent(type=boat, position=${at}, rotation=(0, 90), tags=["${spec.pitchTag}"])`,
        ]
      : []),
  ].join('\n');
  return { command, entities, levels, expectedPoints: spec.counts[0] * spec.counts[1] * spec.counts[2] };
}

export function expectedGrid(spec: NxSpec): Set<string> {
  const axisValues = (c: number, s: number, center: number) => Array.from({ length: c }, (_, i) => clean(center + (i - (c - 1) / 2) * s));
  const xs = axisValues(spec.counts[0], spec.spacing[0], spec.center[0]);
  const ys = axisValues(spec.counts[1], spec.spacing[1], spec.center[1]);
  const zs = axisValues(spec.counts[2], spec.spacing[2], spec.center[2]);
  const out = new Set<string>();
  for (const x of xs) for (const y of ys) for (const z of zs) out.add(`${x},${y},${z}`);
  return out;
}

export interface Probe {
  points: Vec3[];
  errors: string[];
  diagnostics: string[];
}

/** Runs a command in a throwaway simulation built from `scene` and collects every particle position it produces. */
export function probe(scene: string, command: string): Probe {
  const program = parse(scene);
  const sim = new Simulation(program);
  sim.quiet = true;
  sim.runCommand(command, null, [0, 0, 0]);
  return {
    points: sim.events.flatMap((e) => (e.type === 'effect' ? [e.pos] : [])),
    errors: sim.events.flatMap((e) => (e.type === 'chat' && e.kind === 'error' ? [e.text] : [])),
    diagnostics: program.diagnostics.map((d) => `line ${d.line}: ${d.message}`),
  };
}

export interface Analysis {
  branches: number;
  unique: number;
  duplicates: number;
  min: Vec3 | null;
  max: Vec3 | null;
  expectedPoints: number;
  matchesGrid: boolean;
  missing: number;
  unexpected: number;
  points: Vec3[];
  problems: string[];
}

export function analyzePoints(points: Vec3[], spec: NxSpec | null, expectedPoints: number): Analysis {
  const keys = points.map((p) => p.map(clean).join(','));
  const unique = new Set(keys);
  const dims = (f: (...n: number[]) => number): Vec3 | null =>
    points.length ? ([0, 1, 2].map((i) => f(...points.map((p) => p[i]))) as Vec3) : null;
  const expected = spec ? expectedGrid(spec) : null;
  const missing = expected ? [...expected].filter((k) => !unique.has(k)).length : 0;
  const unexpected = expected ? [...unique].filter((k) => !expected.has(k)).length : 0;
  const problems: string[] = [];
  if (points.length !== expectedPoints) problems.push(`Expected ${expectedPoints} branches, got ${points.length}`);
  if (unique.size !== points.length) problems.push(`${points.length - unique.size} branch(es) landed on an already used point`);
  if (expected && (missing || unexpected)) problems.push(`${missing} expected point(s) missing, ${unexpected} unexpected point(s)`);
  return {
    branches: points.length,
    unique: unique.size,
    duplicates: points.length - unique.size,
    min: dims(Math.min),
    max: dims(Math.max),
    expectedPoints,
    matchesGrid: !!expected && !missing && !unexpected,
    missing,
    unexpected,
    points,
    problems,
  };
}

/** Generates the command for `spec`, runs it with a particle probe as the final action, and checks the result. */
export function verify(spec: NxSpec): { generated: NxGenerated; analysis: Analysis; probe: Probe } {
  const generated = generate(spec);
  const probeCommand = generate({ ...spec, action: 'particle minecraft:nx_probe ~ ~ ~' }).command;
  const result = probe(generated.entities, probeCommand);
  const analysis = analyzePoints(result.points, spec, generated.expectedPoints);
  for (const e of [...result.diagnostics, ...result.errors]) analysis.problems.unshift(e);
  return { generated, analysis, probe: result };
}
