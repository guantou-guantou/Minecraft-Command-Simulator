import { wrapCommand } from '../../language/format.ts';
import type { Vec3 } from '../../language/types.ts';
import { parseMolang, type Node } from '../../engine/molang.ts';
import { parseExpression, parsePlayAnimation } from '../../engine/molang-commands.ts';
import { splitTop } from '../../language/parser.ts';
import { EX2D_PREREQ, EX3D_PREREQ, EXITEMS_PREREQ, type PrereqEntry } from './ex-data.ts';

export const DEFAULT_TAG = 'wiki:fmbe';
export const DEFAULT_SET_ANIMATION = 'animation.player.attack.positions';
export const DEFAULT_SET_CONTROLLER = 'wiki:setvariable';

/** The 8 playanimation commands of the Bedrock Wiki "FMBE - A New Way to Create Display Entities" system. */
export const PREREQ: PrereqEntry[] = [
  { animation: 'animation.player.sleeping', controller: 'controller.animation.fox.move', expression: '' },
  {
    animation: 'animation.creeper.swelling',
    controller: 'wiki.scale',
    expression:
      'v.xbasepos=v.xbasepos??0;v.ybasepos=v.ybasepos??0;v.zbasepos=v.zbasepos??0;v.xpos=v.xpos??0;v.ypos=v.ypos??0;v.zpos=v.zpos??0;' +
      'v.xrot=v.xrot??0;v.yrot=v.yrot??0;v.zrot=v.zrot??0;v.scale=v.scale??1;v.xzscale=v.xzscale??1;v.yscale=v.yscale??1;' +
      'v.swelling_scale1=2.1385*math.sqrt(v.xzscale*v.scale);v.swelling_scale2=2.1385*math.sqrt(v.yscale*v.scale);',
  },
  {
    animation: 'animation.ender_dragon.neck_head_movement',
    controller: 'wiki.shift_pos',
    expression:
      'v.head_rotation_x=0;v.head_rotation_y=0;v.head_rotation_z=0;v.head_position_x=(v.xbasepos*0.433875)*math.sqrt(v.xzscale*v.scale);' +
      'v.head_position_y=(10.05185375+v.ybasepos*0.467625)*math.sqrt(v.yscale*v.scale);' +
      'v.head_position_z=(17.108-v.zbasepos*0.433875)*math.sqrt(v.xzscale*v.scale);',
  },
  { animation: 'animation.warden.move', controller: 'wiki.xrot', expression: 'v.body_x_rot=90+v.xrot;v.body_z_rot=90+v.yrot;' },
  { animation: 'animation.player.attack.rotations', controller: 'wiki.zrot', expression: 'v.attack_body_rot_y=-v.zrot;' },
  { animation: 'animation.parrot.moving', controller: 'wiki.xpos', expression: 'v.wing_flap=(16-v.xpos)*3.3333333;' },
  { animation: 'animation.minecart.move.v1.0', controller: 'wiki.ypos', expression: 'v.rail_offset.x=0;v.rail_offset.y=1.6485+v.ypos/16;v.rail_offset.z=0;' },
  { animation: 'animation.parrot.dance', controller: 'wiki.zpos', expression: 'v.dance.x=-v.zpos;v.dance.y=0;' },
];

const NAME = /^[\w:.-]+$/;

function checkName(value: string, what: string): string {
  if (!NAME.test(value)) throw new Error(`${what} may only contain letters, digits, ":", ".", "_" and "-"`);
  return value;
}

export const selectorFor = (tag: string) => `@e[tag=${checkName(tag, 'The tag')}]`;

/** Which prerequisite: the Basic Edition (8 commands) or one of the three Advanced ("EX") display categories (5 commands each). */
export type FmbeVersion = 'standard' | 'ex3d' | 'ex2d' | 'exitems';
export const FMBE_VERSIONS: FmbeVersion[] = ['standard', 'ex3d', 'ex2d', 'exitems'];
export const PREREQ_SETS: Record<FmbeVersion, PrereqEntry[]> = { standard: PREREQ, ex3d: EX3D_PREREQ, ex2d: EX2D_PREREQ, exitems: EXITEMS_PREREQ };
export const isEx = (v: FmbeVersion) => v !== 'standard';

/** The prerequisite commands (without a leading slash) aimed at entities carrying `tag`. */
export function prerequisiteCommands(tag = DEFAULT_TAG, version: FmbeVersion = 'standard'): string[] {
  const sel = selectorFor(tag);
  const next = isEx(version) ? '_' : 'none';
  return PREREQ_SETS[version].map((p) => `playanimation ${sel} ${p.animation} ${next} 0 "${p.expression}" ${p.controller}`);
}

/** A script chain made of the given commands: a repeating block followed by chain blocks. */
export function commandsScript(commands: string[], chainName: string, width = 100): string {
  checkName(chainName, 'The chain name');
  const lines = [`chain ${chainName}:`, '    cb(mode=rep, power=always_on)'];
  for (const c of commands) lines.push(...wrapCommand(`    /${c}`, width));
  return lines.join('\n');
}

/** A script chain that runs the prerequisite every tick: a repeating block followed by chain blocks (7 for the basic edition, 4 for EX). */
export function prerequisiteScript(tag = DEFAULT_TAG, chainName = 'fmbe_render', width = 100, version: FmbeVersion = 'standard'): string {
  return commandsScript(prerequisiteCommands(tag, version), chainName, width);
}

/** The commands of a prerequisite the user pasted (one `playanimation` per line, with or without a slash, `#` comments allowed), checked one by one. */
export function parseCustomPrerequisite(text: string): string[] {
  const out: string[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const command = line.replace(/^\//, '').trim();
    const tokens = splitTop(command, (c) => /\s/.test(c));
    if (tokens[0]?.text !== 'playanimation') throw new Error(`Line ${i + 1}: only playanimation commands belong to a prerequisite`);
    try {
      parseExpression(parsePlayAnimation(tokens).expression);
    } catch (e) {
      throw new Error(`Line ${i + 1}: ${(e as Error).message}`);
    }
    out.push(command);
  });
  if (!out.length) throw new Error('Paste at least one playanimation command');
  return out;
}
export interface FoxSpec {
  name: string;
  tag: string;
  position: Vec3 | null;
  item: string;
  adult: boolean;
  mode: 'scene' | 'commands';
  handle: string;
}

export function foxSetupCommands(spec: FoxSpec): string[] {
  checkName(spec.name, 'The name');
  checkName(spec.tag, 'The tag');
  const item = spec.item.trim();
  if (!item) throw new Error('The item is empty');
  const [x, y, z] = spec.position ?? ['~', '~', '~'];
  return [
    `summon fox ${x} ${y} ${z} ~ ~ ${spec.adult ? 'minecraft:as_adult ' : ''}"${spec.name}"`.replace(/ +/g, ' '),
    `replaceitem entity @n[name="${spec.name}"] slot.weapon.mainhand 0 ${item}`,
    `tag @e[name="${spec.name}"] add ${spec.tag}`,
  ];
}

export function foxScript(spec: FoxSpec): string {
  if (spec.mode === 'commands') {
    return ['chain fmbe_setup:', ...foxSetupCommands(spec).map((c) => `    /${c}`)].join('\n');
  }
  checkName(spec.name, 'The name');
  checkName(spec.tag, 'The tag');
  if (!/^[A-Za-z_]\w*$/.test(spec.handle)) throw new Error('The handle must be an identifier such as fmbe1');
  if (!spec.item.trim()) throw new Error('The item is empty');
  if (!spec.position) throw new Error('A scene declaration needs a position');
  return [
    `${spec.handle} = ent(type=fox, position=(${spec.position.join(', ')}), name="${spec.name}", tags=["${spec.tag}"])`,
    `item(target=${spec.handle}, slot=slot.weapon.mainhand, type=${spec.item.trim()})`,
  ].join('\n');
}

export function fillItemCommand(selector: string, item: string): string {
  if (!selector.trim()) throw new Error('The target selector is empty');
  if (!item.trim()) throw new Error('The item is empty');
  return `replaceitem entity ${selector.trim()} slot.weapon.mainhand 0 ${item.trim()}`;
}

export interface FmbeVariable {
  name: string;
  default: number;
  group: 'position' | 'rotation' | 'scale' | 'base position' | 'extension';
  hint: string;
}

export const VARIABLES: FmbeVariable[] = [
  { name: 'xpos', default: 0, group: 'position', hint: '1/16 block' },
  { name: 'ypos', default: 0, group: 'position', hint: '1/16 block' },
  { name: 'zpos', default: 0, group: 'position', hint: '1/16 block' },
  { name: 'xrot', default: 0, group: 'rotation', hint: 'degrees' },
  { name: 'yrot', default: 0, group: 'rotation', hint: 'degrees' },
  { name: 'zrot', default: 0, group: 'rotation', hint: 'degrees' },
  { name: 'scale', default: 1, group: 'scale', hint: 'overall' },
  { name: 'xzscale', default: 1, group: 'scale', hint: 'x and z' },
  { name: 'yscale', default: 1, group: 'scale', hint: 'y' },
  { name: 'xbasepos', default: 0, group: 'base position', hint: '1/16 block, follows rotation' },
  { name: 'ybasepos', default: 0, group: 'base position', hint: '1/16 block, follows rotation' },
  { name: 'zbasepos', default: 0, group: 'base position', hint: '1/16 block, follows rotation' },
];

/** The variables of the Advanced FMBE: no xzscale and yscale, three extension variables instead. */
export const EX_VARIABLES: FmbeVariable[] = [
  ...VARIABLES.filter((v) => v.name !== 'xzscale' && v.name !== 'yscale'),
  { name: 'extend_scale', default: 1, group: 'extension', hint: 'stretches the block along the direction' },
  { name: 'extend_xrot', default: -90, group: 'extension', hint: 'direction of the stretch, x rotation in degrees' },
  { name: 'extend_yrot', default: 0, group: 'extension', hint: 'direction of the stretch, y rotation in degrees' },
];

export const variablesFor = (version: FmbeVersion): FmbeVariable[] => (isEx(version) ? EX_VARIABLES : VARIABLES);

export interface TransformSpec {
  selector: string;
  values: Record<string, number>;
  animation?: string;
  controller?: string;
}

/** `playanimation <selector> <animation> none 0 "v.a=1;v.b=2;" <controller>` for the given variable values. */
export function transformCommand(spec: TransformSpec): string {
  if (!spec.selector.trim()) throw new Error('The target selector is empty');
  const entries = Object.entries(spec.values);
  if (!entries.length) throw new Error('Tick at least one variable');
  const known = new Set([...VARIABLES, ...EX_VARIABLES].map((v) => v.name));
  for (const [k, v] of entries) {
    if (!known.has(k)) throw new Error(`Unknown FMBE variable "${k}"`);
    if (!Number.isFinite(v)) throw new Error(`The value of ${k} is not a number`);
  }
  const expression = entries.map(([k, v]) => `v.${k}=${v};`).join('');
  return `playanimation ${spec.selector.trim()} ${spec.animation ?? DEFAULT_SET_ANIMATION} none 0 "${expression}" ${spec.controller ?? DEFAULT_SET_CONTROLLER}`;
}

function constant(n: Node): number | null {
  if (n.k === 'num') return n.v;
  if (n.k === 'un' && (n.op === '-' || n.op === '+')) {
    const v = constant(n.e);
    return v === null ? null : n.op === '-' ? -v : v;
  }
  return null;
}

/** Reads the `v.name=number;` assignments out of a playanimation command; null when it is not a playanimation or does not parse. */
export function readTransform(command: string): { selector: string; values: Record<string, number>; animation: string; controller: string | null } | null {
  const tokens = splitTop(command.trim().replace(/^\//, ''), (c) => /\s/.test(c));
  if (tokens[0]?.text !== 'playanimation') return null;
  try {
    const a = parsePlayAnimation(tokens);
    parseExpression(a.expression);
    const values: Record<string, number> = {};
    for (const s of parseMolang(a.expression).stmts) {
      if (s.k !== 'assign' || s.scope !== 'v') continue;
      const c = constant(s.e);
      if (c !== null) values[s.name] = c;
    }
    return { selector: a.target, values, animation: a.animation, controller: a.controller };
  } catch {
    return null;
  }
}