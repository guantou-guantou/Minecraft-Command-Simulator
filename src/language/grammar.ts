import { ADMIN_COMMANDS, KNOWN_COMMANDS, PRESENTATION_COMMANDS } from '../engine/known-commands.ts';
import { posSpan } from './coords.ts';
/** Declarative syntax of the commands the simulator knows, shared by completion and its tests. */

export type ValType =
  | 'int' | 'float' | 'bool' | 'coord' | 'coord3' | 'rotvalue' | 'rotpair' | 'target' | 'word' | 'entity' | 'block' | 'blockstates' | 'item' | 'objective' | 'tag';

export type G =
  | { k: 'lit'; v: string }
  | { k: 'kw'; name: string; values: string[] | string }
  | { k: 'val'; t: ValType; name: string }
  | { k: 'rest'; name: string }
  | { k: 'seq'; xs: G[] }
  | { k: 'alt'; xs: G[] }
  | { k: 'opt'; x: G }
  | { k: 'lazy'; f: () => G };

export type Leaf = Extract<G, { k: 'lit' | 'kw' | 'val' | 'rest' }>;

const L = (v: string): G => ({ k: 'lit', v });
const KW = (name: string, values: string[] | string): G => ({ k: 'kw', name, values });
const V = (t: ValType, name: string): G => ({ k: 'val', t, name });
const R = (name: string): G => ({ k: 'rest', name });
const S = (...xs: G[]): G => ({ k: 'seq', xs });
const A = (...xs: G[]): G => ({ k: 'alt', xs });
const O = (x: G): G => ({ k: 'opt', x });

const pos = (name: string): G => V('coord3', name);
const rotPair = A(S(V('rotvalue', 'yRot'), V('rotvalue', 'xRot')), V('rotpair', 'rotation'));
const target = (name = 'target') => V('target', name);
const block = (name = 'block'): G => S(V('block', name), O(V('blockstates', 'block states')));
const int = (name: string) => V('int', name);
const bool = (name: string) => KW(name, ['true', 'false']);
const cloneMode = KW('clone mode', ['normal', 'force', 'move']);
const itemTail = S(V('item', 'item'), O(S(int('amount'), O(S(int('data'), O(R('components')))))));

const execute: () => G = () => S(L('execute'), chain());
const chain = (): G =>
  A(
    S(L('run'), { k: 'lazy', f: anyCommand }),
    S(
      A(
        S(L('as'), target()),
        S(L('at'), target()),
        S(L('in'), KW('dimension', ['overworld', 'nether', 'the_end'])),
        S(L('positioned'), A(S(L('as'), target()), pos('position'))),
        S(L('rotated'), A(S(L('as'), target()), rotPair)),
        S(L('facing'), A(S(L('entity'), target(), KW('anchor', ['feet', 'eyes'])), pos('position'))),
        S(L('align'), V('word', 'axes')),
        S(L('anchored'), KW('anchor', ['feet', 'eyes'])),
      ),
      { k: 'lazy', f: chain },
    ),
    S(
      A(L('if'), L('unless')),
      A(
        S(L('block'), pos('position'), block()),
        S(L('blocks'), pos('begin'), pos('end'), pos('destination'), KW('mode', ['all', 'masked'])),
        S(L('entity'), target()),
        S(L('score'), target(), V('objective', 'objective'), A(S(KW('operator', ['<', '<=', '=', '>=', '>']), target('source'), V('objective', 'source objective')), S(L('matches'), V('word', 'range')))),
      ),
      O({ k: 'lazy', f: chain }),
    ),
  );

const titleBody = (text: string): G => A(L('clear'), L('reset'), S(L('times'), int('fade in'), int('stay'), int('fade out')), S(KW('location', ['title', 'subtitle', 'actionbar']), R(text)));

const slotTail = S(V('word', 'slot') , int('slot id'), O(KW('mode', ['destroy', 'keep'])), itemTail);

const tpTail = S(O(A(S(L('facing'), A(pos('facing position'), target('facing entity'))), rotPair)), O(KW('checkForBlocks', ['true', 'false'])));

export const COMMANDS: Record<string, () => G> = {
  execute,
  say: () => S(L('say'), R('message')),
  tag: () => S(L('tag'), target('targets'), A(S(L('add'), V('tag', 'tag')), S(L('remove'), V('tag', 'tag')), L('list'))),
  tp: () => S(L('tp'), A(S(pos('destination'), tpTail), S(target('victim'), A(S(pos('destination'), tpTail), S(target('destination'), O(KW('checkForBlocks', ['true', 'false']))))), S(target('destination'), O(KW('checkForBlocks', ['true', 'false']))))),
  setblock: () => S(L('setblock'), pos('position'), block(), O(KW('mode', ['replace', 'destroy', 'keep']))),
  scoreboard: () => S(
    L('scoreboard'),
    A(
      S(L('objectives'), A(S(L('add'), V('word', 'name'), L('dummy'), O(R('display name'))), S(L('remove'), V('objective', 'objective')), L('list'), S(L('setdisplay'), KW('slot', ['list', 'sidebar', 'belowname']), O(S(V('objective', 'objective'), O(KW('order', ['ascending', 'descending']))))))),
      S(
        L('players'),
        A(
          S(KW('action', ['set', 'add', 'remove']), target(), V('objective', 'objective'), int('value')),
          S(L('reset'), target(), O(V('objective', 'objective'))),
          S(L('list'), O(target())),
          S(L('test'), target(), V('objective', 'objective'), V('word', 'min'), O(V('word', 'max'))),
          S(L('random'), target(), V('objective', 'objective'), int('min'), int('max')),
          S(L('operation'), target(), V('objective', 'objective'), KW('operation', ['+=', '-=', '*=', '/=', '%=', '<', '>', '><', '=']), target('source'), V('objective', 'source objective')),
        ),
      ),
    ),
  ),
  summon: () => S(L('summon'), V('entity', 'entity type'), O(S(pos('position'), O(S(V('rotvalue', 'yRot'), V('rotvalue', 'xRot'), O(S(V('word', 'event'), O(V('word', 'name tag'))))))))),
  kill: () => S(L('kill'), O(target())),
  fill: () => S(L('fill'), pos('from'), pos('to'), block(), O(A(KW('mode', ['destroy', 'hollow', 'keep', 'outline']), S(L('replace'), O(block('replaced block')))))),
  clone: () => S(
    L('clone'), pos('begin'), pos('end'), pos('destination'),
    O(A(S(L('filtered'), cloneMode, block('filter block')), S(KW('mask mode', ['replace', 'masked']), O(cloneMode)))),
  ),
  testfor: () => S(L('testfor'), target()),
  testforblock: () => S(L('testforblock'), pos('position'), block()),
  tellraw: () => S(L('tellraw'), target(), R('json message')),
  titleraw: () => S(L('titleraw'), target('player'), titleBody('json message')),
  title: () => S(L('title'), target('player'), titleBody('text')),
  give: () => S(L('give'), target('player'), itemTail),
  clear: () => S(L('clear'), O(S(target('player'), O(S(V('item', 'item'), O(S(int('data'), O(int('max count'))))))))),
  replaceitem: () => S(L('replaceitem'), A(S(L('entity'), target(), slotTail), S(L('block'), pos('position'), slotTail))),
  effect: () => S(
    L('effect'),
    target(),
    A(
      S(L('clear'), O(KW('effect', 'effects'))),
      S(KW('effect', 'effects'), O(S(V('word', 'seconds'), O(S(int('amplifier'), O(bool('hide particles'))))))),
    ),
  ),
  gamerule: () => S(L('gamerule'), KW('rule', 'gamerules'), O(V('word', 'value'))),
  playanimation: () => S(L('playanimation'), target(), V('word', 'animation'), O(S(V('word', 'next state'), O(S(V('float', 'blend out time'), O(S(V('word', 'stop expression'), O(V('word', 'controller'))))))))),
  stopsound: () => S(L('stopsound'), target('player'), O(V('word', 'sound'))),
  particle: () => S(L('particle'), KW('effect', 'particles'), O(pos('position'))),
  enchant: () => S(L('enchant'), target('player'), A(KW('enchantment', 'enchants'), int('enchantment id')), O(int('level'))),
  gamemode: () => S(L('gamemode'), KW('mode', 'gamemodes'), O(target('player'))),
  inputpermission: () => S(
    L('inputpermission'),
    A(S(L('set'), target(), KW('permission', 'permissions'), KW('state', ['enabled', 'disabled'])), S(L('query'), target(), KW('permission', 'permissions'), O(KW('state', ['enabled', 'disabled'])))),
  ),
  kick: () => S(L('kick'), target('player'), R('reason')),
  list: () => L('list'),
  xp: () => S(L('xp'), V('word', 'amount'), O(target('player'))),
  structure: () => S(
    L('structure'),
    A(
      S(L('save'), V('word', 'structure'), pos('from'), pos('to'), O(R('options'))),
      S(L('delete'), V('word', 'structure')),
      S(L('load'), V('word', 'structure'), pos('destination'), O(R('options'))),
    ),
  ),
  tickingarea: () => S(
    L('tickingarea'),
    A(
      S(L('add'), A(S(L('circle'), pos('center'), int('radius')), S(pos('from'), pos('to'))), O(S(V('word', 'name'), O(bool('preload'))))),
      S(L('remove'), A(pos('position'), V('word', 'name'))),
      L('remove_all'),
      S(L('list'), O(L('all-dimensions'))),
      S(L('preload'), A(pos('position'), V('word', 'name')), O(bool('preload'))),
    ),
  ),
};
COMMANDS.time = () => S(
  L('time'),
  A(
    S(L('set'), A(KW('time', ['day', 'noon', 'sunset', 'night', 'midnight', 'sunrise']), int('ticks'))),
    S(L('add'), int('ticks')),
    S(L('query'), KW('what', ['daytime', 'gametime', 'day'])),
  ),
);
COMMANDS.weather = () => S(L('weather'), A(S(KW('type', ['clear', 'rain', 'thunder']), O(int('duration'))), L('query')));
COMMANDS.difficulty = () => S(L('difficulty'), A(KW('difficulty', ['peaceful', 'easy', 'normal', 'hard']), KW('level', ['0', '1', '2', '3'])));
COMMANDS.daylock = () => S(L('daylock'), O(bool('lock')));
COMMANDS.spawnpoint = () => S(L('spawnpoint'), O(A(pos('position'), S(target('player'), O(pos('position'))))));
COMMANDS.setworldspawn = () => S(L('setworldspawn'), O(pos('position')));
COMMANDS.clearspawnpoint = () => S(L('clearspawnpoint'), O(target('player')));
COMMANDS.playsound = () => S(
  L('playsound'),
  V('word', 'sound'),
  O(S(target('player'), O(S(pos('position'), O(S(V('float', 'volume'), O(S(V('float', 'pitch'), O(V('float', 'minimum volume')))))))))),
);
for (const name of ['tell', 'msg', 'w']) COMMANDS[name] = () => S(L(name), target('player'), R('message'));
COMMANDS.testforblocks = () => S(L('testforblocks'), pos('begin'), pos('end'), pos('destination'), O(KW('mode', ['all', 'masked'])));
COMMANDS.teleport = () => S(L('teleport'), (COMMANDS.tp() as Extract<G, { k: 'seq' }>).xs[1]);

const cmp = KW('operator', ['==', '!=', '>=', '<=', '>', '<']);

/** A step inside a 	est name: block. */
export const TEST_LINE: G = A(
  S(L('run'), V('word', 'chain')),
  S(L('activate'), V('word', 'chain')),
  S(L('deactivate'), V('word', 'chain')),
  S(L('tick'), int('ticks')),
  S(
    L('expect'),
    A(
      S(L('entity'), target('selector'), O(L('count')), O(cmp), int('count')),
      S(L('score'), target('holder'), V('objective', 'objective'), cmp, int('value')),
      S(L('block'), pos('position'), V('block', 'block')),
      S(L('tag'), target('selector'), A(L('has'), L('lacks')), V('tag', 'tag')),
      S(L('chat'), L('contains'), R('text')),
      S(L('particles'), O(cmp), int('count')),
    ),
  ),
);

COMMANDS.alwaysday = () => S(L('alwaysday'), O(bool('lock')));
COMMANDS.toggledownfall = () => S(L('toggledownfall'));
COMMANDS.me = () => S(L('me'), R('message'));
COMMANDS.querytarget = () => S(L('querytarget'), target());
COMMANDS.spreadplayers = () => S(L('spreadplayers'), V('coord', 'x'), V('coord', 'z'), V('float', 'spread distance'), V('float', 'max range'), target('victim'));
COMMANDS.function = () => S(L('function'), V('word', 'function'));
COMMANDS.schedule = () => S(
    L('schedule'), L('on_area_loaded'), L('add'),
    A(S(L('circle'), pos('center'), V('float', 'radius'), V('word', 'function')), S(L('tickingarea'), V('word', 'name'), V('word', 'function')), S(pos('from'), pos('to'), V('word', 'function'))),
  );
COMMANDS.camera = () => S(
    L('camera'), target('players'),
    A(L('clear'), L('fov_clear'), S(L('fade'), O(R('options'))), S(L('set'), V('word', 'preset'), O(R('options'))), S(L('target'), R('options')), S(L('fov_set'), V('float', 'fov'), O(R('options')))),
  );
COMMANDS.fog = () => S(L('fog'), target('victim'), A(S(L('push'), V('word', 'fog id'), V('word', 'user id')), S(KW('action', ['pop', 'remove']), V('word', 'user id'))));

/** Recorded commands without a detailed grammar accept any arguments; being in COMMANDS marks them as supported. */
for (const n of [...PRESENTATION_COMMANDS, ...ADMIN_COMMANDS]) if (!(n in COMMANDS)) COMMANDS[n] = () => S(L(n), O(R('arguments')));

/** Commands the simulator does not run yet but whose syntax is known, so they are still checked (and can follow `execute ... run`). */
const DAMAGE_CAUSES = ['anvil', 'block_explosion', 'charging', 'contact', 'drowning', 'entity_attack', 'entity_explosion', 'fall', 'falling_block', 'fire', 'fire_tick', 'fly_into_wall', 'freezing', 'lava', 'lightning', 'magic', 'magma', 'none', 'override', 'piston', 'projectile', 'ram_attack', 'self_destruct', 'sonic_boom', 'soul_campfire', 'stalactite', 'stalagmite', 'starve', 'suffocation', 'suicide', 'temperature', 'thorns', 'void', 'wither'];
const lootSource = (): G => R('loot source');

export const SYNTAX_ONLY: Record<string, () => G> = {
  damage: () => S(L('damage'), target(), int('amount'), O(S(KW('cause', DAMAGE_CAUSES), O(S(L('entity'), target('damager')))))),
  ride: () => S(
    L('ride'), target(),
    A(
      S(L('start_riding'), target('ride'), O(S(KW('teleport rules', ['teleport_ride', 'teleport_rider']), O(KW('fill type', ['until_full', 'if_group_fits']))))),
      L('stop_riding'),
      L('evict_riders'),
      S(L('summon_rider'), V('entity', 'entity type'), O(S(V('word', 'event'), O(V('word', 'name tag'))))),
      S(L('summon_ride'), V('entity', 'entity type'), O(S(KW('ride rules', ['reassign_rides', 'skip_riders']), O(S(V('word', 'event'), O(V('word', 'name tag'))))))),
    ),
  ),
  event: () => S(L('event'), L('entity'), target(), V('word', 'event')),
  loot: () => S(
    L('loot'),
    A(
      S(L('spawn'), pos('position'), lootSource()),
      S(L('give'), target('players'), lootSource()),
      S(L('insert'), pos('position'), lootSource()),
      S(L('replace'), A(S(L('block'), pos('position'), R('slot and source')), S(L('entity'), target(), R('slot and source')))),
    ),
  ),
  locate: () => S(L('locate'), A(S(L('structure'), V('word', 'structure'), O(V('bool', 'useNewChunksOnly'))), S(L('biome'), V('word', 'biome')))),
  place: () => S(
    L('place'),
    A(
      S(KW('what', ['feature', 'featurerule', 'structure']), V('word', 'name'), O(pos('position'))),
      S(L('jigsaw'), V('word', 'pool'), V('word', 'target'), int('max depth'), O(R('options'))),
    ),
  ),
};

export const grammarOf = (name: string): (() => G) | undefined => COMMANDS[name] ?? SYNTAX_ONLY[name];

export function anyCommand(): G {
  const known = [...KNOWN_COMMANDS].filter((n) => !(n in COMMANDS) && !(n in SYNTAX_ONLY)).map((n) => S(L(n), O(R('arguments'))));
  return A(...Object.values(COMMANDS).map((f) => f()), ...Object.values(SYNTAX_ONLY).map((f) => f()), ...known);
}

const NUM = '-?(?:\\d+\\.?\\d*|\\.\\d+)';
const INTERP = /^\$\{[^}]+\}$/;
const VALID: Record<ValType, (t: string) => boolean> = {
  int: (t) => INTERP.test(t) || /^-?\d+$/.test(t),
  float: (t) => INTERP.test(t) || new RegExp(`^${NUM}$`).test(t),
  bool: (t) => t === 'true' || t === 'false',
  coord: (t) => INTERP.test(t) || new RegExp(`^[~^]?(${NUM.slice(0)})?$`).test(t) && t !== '' && t !== '-',
  coord3: (t) => INTERP.test(t) || new RegExp(`^([~^]${NUM}?|${NUM}){3}$`).test(t) || /^([~^](-?[\d.]+)?){3}$/.test(t),
  rotvalue: (t) => INTERP.test(t) || new RegExp(`^~?(${NUM})?$`).test(t) && t !== '' && t !== '-',
  rotpair: (t) => INTERP.test(t),
  target: (t) => /^@[aeprsn](\[.*\])?$/.test(t) || /^[^@\s[\]].*$/.test(t),
  word: () => true,
  entity: (t) => /^[\w:.-]+$/.test(t),
  block: (t) => /^[\w:.]+(\[.*\])?$/.test(t),
  blockstates: (t) => /^\[.*\]$/.test(t),
  item: (t) => /^[\w:.]+$/.test(t),
  objective: () => true,
  tag: () => true,
};

export interface MatchResult {
  state: 'ok' | 'incomplete' | 'error';
  /** What may come next after the given tokens. */
  expected: Leaf[];
}

function walk(g: G, t: string[], i: number, expect: Leaf[], k: (i: number) => void): void {
  switch (g.k) {
    case 'lit':
      if (i === t.length) expect.push(g);
      else if (t[i] === g.v) k(i + 1);
      return;
    case 'kw':
      if (i === t.length) expect.push(g);
      else if (typeof g.values === 'string' || g.values.includes(t[i])) k(i + 1);
      return;
    case 'val':
      if (i === t.length) expect.push(g);
      else if (g.t === 'coord3') {
        const span = posSpan(t, i);
        if (!span) return;
        if (span.complete) k(i + span.n);
        else expect.push(g);
      } else if (VALID[g.t](t[i])) k(i + 1);
      return;
    case 'rest':
      if (i === t.length) expect.push(g);
      else k(t.length);
      return;
    case 'seq': {
      const go = (n: number, j: number): void => (n === g.xs.length ? k(j) : walk(g.xs[n], t, j, expect, (m) => go(n + 1, m)));
      go(0, i);
      return;
    }
    case 'alt':
      for (const x of g.xs) walk(x, t, i, expect, k);
      return;
    case 'opt':
      k(i);
      walk(g.x, t, i, expect, k);
      return;
    case 'lazy':
      walk(g.f(), t, i, expect, k);
  }
}

/** Matches the command words (without the leading slash) against the grammar. */
export function matchCommand(tokens: string[]): MatchResult {
  return matchGrammar(anyCommand(), tokens);
}

export const matchTest = (tokens: string[]): MatchResult => matchGrammar(TEST_LINE, tokens);

function matchGrammar(root: G, tokens: string[]): MatchResult {
  const expected: Leaf[] = [];
  let complete = false;
  walk(root, tokens, 0, expected, (j) => {
    if (j === tokens.length) complete = true;
  });
  return { state: complete ? 'ok' : expected.length ? 'incomplete' : 'error', expected };
}