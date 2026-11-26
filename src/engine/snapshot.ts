import type { Vec3 } from '../language/types.ts';
import type { Simulation } from './simulation.ts';
import { AIR } from './world.ts';

export interface WorldSnapshot {
  tick: number;
  gameTime: number;
  timeOfDay: number;
  day: number;
  weather: string;
  difficulty: string;
  spawn: Vec3 | null;
  entities: { id: number; type: string; name: string | null; pos: Vec3; rot: [number, number]; tags: string[]; gamemode: string; effects: Record<string, { amplifier: number; ticks: number | null }> }[];
  blocks: { pos: Vec3; id: string; states: Record<string, unknown>; command?: string }[];
  blocksTruncated: boolean;
  scores: Record<string, Record<string, number>>;
  gamerules: Record<string, unknown>;
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;

/** A plain-data picture of the world, for tools that read results (the CLI and tests). */
export function snapshot(sim: Simulation, maxBlocks = 2000): WorldSnapshot {
  const w = sim.world;
  const blocks: WorldSnapshot['blocks'] = [];
  let truncated = false;
  for (const [key, b] of w.blocks) {
    if (b.id === AIR) continue;
    if (blocks.length >= maxBlocks) {
      truncated = true;
      break;
    }
    const pos = key.split(',').map(Number) as Vec3;
    blocks.push({ pos, id: b.id, states: { ...b.states }, ...(b.cb ? { command: b.cb.command } : {}) });
  }
  blocks.sort((a, b) => a.pos[0] - b.pos[0] || a.pos[1] - b.pos[1] || a.pos[2] - b.pos[2]);
  const scores: WorldSnapshot['scores'] = {};
  const holderName = (key: string) => {
    const e = key.startsWith('e:') ? w.entities.find((x) => x.id === Number(key.slice(2))) : undefined;
    return e ? (e.name ?? `${e.type.replace('minecraft:', '')}#${e.id}`) : key;
  };
  for (const [objective, holders] of w.scores) scores[objective] = Object.fromEntries([...holders].map(([k, v]) => [holderName(k), v]));
  return {
    tick: sim.tick,
    gameTime: w.gameTime,
    timeOfDay: ((w.time % 24000) + 24000) % 24000,
    day: Math.floor(w.time / 24000),
    weather: w.weather,
    difficulty: w.difficulty,
    spawn: w.spawn,
    entities: w.entities.map((e) => ({
      id: e.id,
      type: e.type,
      name: e.name,
      pos: e.pos.map(round) as Vec3,
      rot: e.rot.map(round) as [number, number],
      tags: [...e.tags].sort(),
      gamemode: e.gamemode,
      effects: Object.fromEntries(Object.entries(e.effects).map(([k, v]) => [k, { amplifier: v.amplifier, ticks: v.ticks }])),
    })),
    blocks,
    blocksTruncated: truncated,
    scores,
    gamerules: { ...w.gamerules },
  };
}
