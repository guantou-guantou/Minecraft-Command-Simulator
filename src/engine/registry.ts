import type { Token } from '../language/parser.ts';
import type { Ctx, Env } from './types.ts';

export type Support = 'full' | 'record';

export interface Cmd {
  src: string;
  tokens: Token[];
  ctx: Ctx;
  env: Env;
}

export interface CommandSpec {
  name: string;
  aliases?: string[];
  support: Support;
  run: (cmd: Cmd) => number;
}

export class Registry {
  private map = new Map<string, CommandSpec>();

  register(spec: CommandSpec): void {
    for (const n of [spec.name, ...(spec.aliases ?? [])]) this.map.set(n, spec);
  }

  get(name: string): CommandSpec | undefined {
    return this.map.get(name);
  }

  list(): CommandSpec[] {
    return [...new Set(this.map.values())];
  }
}
