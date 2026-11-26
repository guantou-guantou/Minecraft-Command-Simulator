import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, fmtValue, lintMolang, parseMolang, type MolangCtx, type MolangValue } from '../src/engine/molang.ts';
import { lintProgram } from '../src/engine/lint.ts';
import { parse } from '../src/language/parser.ts';
import { Simulation } from '../src/engine/simulation.ts';

function ctx(vars: Record<string, MolangValue> = {}): MolangCtx {
  return { vars, temp: {}, query: (n, a) => (n === 'life_time' ? 2 : n === 'position' ? 10 + a[0] : 0) };
}
const ev = (src: string, vars: Record<string, MolangValue> = {}) => evaluate(parseMolang(src), ctx(vars));

test('arithmetic, precedence, unary and division by zero', () => {
  assert.equal(ev('1+2*3').value, 7);
  assert.equal(ev('(1+2)*3').value, 9);
  assert.equal(ev('-2*-3').value, 6);
  assert.equal(ev('10/4').value, 2.5);
  assert.equal(ev('1/0').value, 0);
  assert.equal(ev('!0').value, 1);
  assert.equal(ev('!5').value, 0);
  assert.equal(ev('3>2&&2>1').value, 1);
  assert.equal(ev('0||0').value, 0);
  assert.equal(ev('1==1').value, 1);
  assert.equal(ev('1!=1').value, 0);
  assert.equal(ev("'a'=='a'").value, 1);
  assert.equal(ev('true+true').value, 2);
});

test('ternary, binary conditional, and null coalescing', () => {
  assert.equal(ev('1?2:3').value, 2);
  assert.equal(ev('0?2:3').value, 3);
  assert.equal(ev('0?2').value, 0);
  assert.equal(ev('1==1||0?5:6').value, 5);
  const vars: Record<string, MolangValue> = {};
  assert.equal(ev('v.a??7', vars).value, 7);
  vars.a = 0;
  assert.equal(ev('v.a??7', vars).value, 0);
  assert.equal(ev('v.zz??v.yy??9').value, 9);
});

test('variables: assignment, scopes, case-insensitivity, dotted names, chained assignment', () => {
  const vars: Record<string, MolangValue> = {};
  const r = evaluate(parseMolang('v.A=1;V.b.c=v.a+1;t.tmp=5;variable.d=t.tmp*2;v.e=v.f=3;'), { ...ctx(vars) });
  assert.deepEqual({ ...vars }, { a: 1, 'b.c': 2, d: 10, e: 3, f: 3 });
  assert.equal(r.value, 0);
  assert.equal(r.returned, false);
  const nested = evaluate(parseMolang('v.x=2*(v.y=(v.z=4));'), ctx(vars));
  assert.deepEqual([vars.x, vars.y, vars.z], [8, 4, 4]);
  assert.equal(nested.returned, false);
  assert.equal(ev('v.q=5').value, 5);
});

test('return and the value of scripts', () => {
  assert.deepEqual(ev('return 3;'), { value: 3, returned: true });
  assert.deepEqual(ev('v.a=1;return v.a+1;v.a=99;'), { value: 2, returned: true });
  assert.deepEqual(ev('v.a=1;'), { value: 0, returned: false });
  assert.deepEqual(ev('4'), { value: 4, returned: false });
  assert.deepEqual(ev(''), { value: 0, returned: false });
  assert.deepEqual(ev(';;1;;'), { value: 0, returned: false });
});

test('math functions use degrees', () => {
  const near = (src: string, want: number) => assert.ok(Math.abs((ev(src).value as number) - want) < 1e-9, `${src} = ${ev(src).value}`);
  near('math.sin(90)', 1);
  near('math.cos(180)', -1);
  near('math.atan2(1,1)', 45);
  near('math.asin(1)', 90);
  near('math.acos(0)', 90);
  near('math.sqrt(16)', 4);
  near('math.pow(2,10)', 1024);
  near('math.abs(-3)', 3);
  near('math.floor(2.7)+math.ceil(2.1)+math.round(2.5)+math.trunc(-2.7)', 2 + 3 + 3 - 2);
  near('math.clamp(5,0,3)', 3);
  near('math.min(2,3)+math.max(2,3)', 5);
  near('math.lerp(0,10,0.25)', 2.5);
  near('math.lerprotate(170,-170,0.5)', 180);
  near('math.min_angle(270)', -90);
  near('math.mod(7,3)', 1);
  near('math.mod(7,0)', 0);
  near('math.pi', Math.PI);
  near('math.hermite_blend(0.5)', 0.5);
  near('math.exp(0)+math.ln(1)', 1);
});

test('queries come from the context and unknown ones are rejected', () => {
  assert.equal(ev('q.life_time*2').value, 4);
  assert.equal(ev('query.position(1)').value, 11);
  assert.match(lintMolang('q.nope')!.message, /not simulated/);
  assert.match(lintMolang('q.position')!.message, /takes 1 argument/);
});

test('syntax errors carry a column', () => {
  const cases: [string, RegExp, number][] = [
    ['1+', /end of expression/, 2],
    ['(1', /Expected "\)"/, 2],
    ['v.a=', /end of expression/, 4],
    ['1 2', /Expected ";"/, 2],
    ['foo.bar', /Unknown identifier/, 0],
    ['math.nope(1)', /Unknown function/, 0],
    ['math.sin()', /takes 1 argument/, 0],
    ['math.random(1,2)', /not simulated/, 0],
    ['3=4', /Expected ";"/, 1],
    ['q.life_time=3', /Only variables/, 0],
    ['v.a[0]', /not supported/, 3],
    ['loop(3,{})', /not supported/, 0],
    ['c.x', /not supported/, 0],
    ["'abc", /Unterminated/, 0],
    ['1 # 2', /Unexpected character/, 2],
    ['return', /end of expression/, 6],
  ];
  for (const [src, re, idx] of cases) {
    const e = lintMolang(src);
    assert.ok(e, `expected an error for ${src}`);
    assert.match(e.message, re, src);
    assert.equal(e.index, idx, src);
  }
  assert.equal(lintMolang(''), null);
  assert.equal(lintMolang('v.a=1;v.b=2;'), null);
});

test('strings cannot be used as numbers, null is zero in arithmetic', () => {
  assert.throws(() => ev("'a'+1"), /string/);
  assert.equal(ev('v.unset+1').value, 1);
  assert.equal(fmtValue(1.23456789), '1.234568');
  assert.equal(fmtValue(-0), '0');
  assert.equal(fmtValue(null), 'null');
});

const PREREQ = [
  'playanimation @e[tag=wiki:fmbe] animation.player.sleeping none 0 "" controller.animation.fox.move',
  'playanimation @e[tag=wiki:fmbe] animation.creeper.swelling none 0 "v.xbasepos=v.xbasepos??0;v.ybasepos=v.ybasepos??0;v.zbasepos=v.zbasepos??0;v.xpos=v.xpos??0;v.ypos=v.ypos??0;v.zpos=v.zpos??0;v.xrot=v.xrot??0;v.yrot=v.yrot??0;v.zrot=v.zrot??0;v.scale=v.scale??1;v.xzscale=v.xzscale??1;v.yscale=v.yscale??1;v.swelling_scale1=2.1385*math.sqrt(v.xzscale*v.scale);v.swelling_scale2=2.1385*math.sqrt(v.yscale*v.scale);" wiki.scale',
  'playanimation @e[tag=wiki:fmbe] animation.ender_dragon.neck_head_movement none 0 "v.head_rotation_x=0;v.head_rotation_y=0;v.head_rotation_z=0;v.head_position_x=(v.xbasepos*0.433875)*math.sqrt(v.xzscale*v.scale);v.head_position_y=(10.05185375+v.ybasepos*0.467625)*math.sqrt(v.yscale*v.scale);v.head_position_z=(17.108-v.zbasepos*0.433875)*math.sqrt(v.xzscale*v.scale);" wiki.shift_pos',
  'playanimation @e[tag=wiki:fmbe] animation.warden.move none 0 "v.body_x_rot=90+v.xrot;v.body_z_rot=90+v.yrot;" wiki.xrot',
  'playanimation @e[tag=wiki:fmbe] animation.player.attack.rotations none 0 "v.attack_body_rot_y=-v.zrot;" wiki.zrot',
  'playanimation @e[tag=wiki:fmbe] animation.parrot.moving none 0 "v.wing_flap=(16-v.xpos)*3.3333333;" wiki.xpos',
  'playanimation @e[tag=wiki:fmbe] animation.minecart.move.v1.0 none 0 "v.rail_offset.x=0;v.rail_offset.y=1.6485+v.ypos/16;v.rail_offset.z=0;" wiki.ypos',
  'playanimation @e[tag=wiki:fmbe] animation.parrot.dance none 0 "v.dance.x=-v.zpos;v.dance.y=0;" wiki.zpos',
];

function fox(): Simulation {
  const s = new Simulation(parse('f = ent(type=fox, position=(0, 0, 0), name="wiki:fmbe", tags=["wiki:fmbe"])'));
  assert.deepEqual(s.program.diagnostics, []);
  return s;
}
const O: [number, number, number] = [0, 0, 0];
const vars = (s: Simulation) => s.world.entityByHandle('f')!.molang;

test('the 8 FMBE prerequisite commands run and compute the wiki defaults', () => {
  const s = fox();
  for (const c of PREREQ) assert.equal(s.runCommand(`/${c}`, null, O), true, c);
  const v = vars(s);
  assert.equal(v.scale, 1);
  assert.equal(v.swelling_scale1, 2.1385);
  assert.equal(v.head_position_y, 10.05185375);
  assert.equal(v.head_position_z, 17.108);
  assert.equal(v.body_x_rot, 90);
  assert.equal(v.body_z_rot, 90);
  assert.equal(v.wing_flap, 16 * 3.3333333);
  assert.equal(v['rail_offset.y'], 1.6485);
  assert.equal(v['dance.x'], 0);
  assert.deepEqual(Object.keys(s.world.entityByHandle('f')!.anims), [
    'controller.animation.fox.move', 'wiki.scale', 'wiki.shift_pos', 'wiki.xrot', 'wiki.zrot', 'wiki.xpos', 'wiki.ypos', 'wiki.zpos',
  ]);
  assert.deepEqual(lintProgram(parse(PREREQ.map((c) => `/${c}`).join('\n'))), []);
});

test('setting FMBE variables updates the derived values every tick', () => {
  const s = fox();
  for (const c of PREREQ) s.runCommand(`/${c}`, null, O);
  assert.equal(s.runCommand('/playanimation @e[tag=wiki:fmbe] animation.player.attack.positions none 0 "v.xrot=35;v.ypos=16;v.scale=4;" wiki:setvariable', null, O), true);
  assert.equal(vars(s).xrot, 35);
  assert.equal(vars(s).body_x_rot, 90);
  s.advance(1);
  assert.equal(vars(s).body_x_rot, 125);
  assert.equal(vars(s)['rail_offset.y'], 1.6485 + 1);
  assert.equal(vars(s).swelling_scale1, 2.1385 * 2);
  assert.equal(vars(s).head_position_y, 10.05185375 * 2);
});

test('time based expressions advance with the tick and return stops an animation', () => {
  const s = fox();
  s.runCommand('/playanimation @e[tag=wiki:fmbe] animation.x none 0 "v.t=q.life_time;" ctl', null, O);
  s.advance(40);
  assert.equal(vars(s).t, 2);
  assert.equal(s.runCommand('/playanimation @e[tag=wiki:fmbe] animation.x none 0 "v.once=(v.once??0)+1;return 1;" ctl', null, O), true);
  assert.equal(vars(s).once, 1);
  assert.deepEqual(Object.keys(s.world.entityByHandle('f')!.anims), []);
  s.runCommand('/playanimation @e[tag=wiki:fmbe] animation.x none 0 "v.n=(v.n??0)+1;return v.n>=3;" stopper', null, O);
  assert.equal(vars(s).n, 1);
  s.advance(5);
  assert.equal(vars(s).n, 3);
  assert.equal(s.world.entityByHandle('f')!.anims.stopper, undefined);
});

test('a controller name is replaced, not duplicated; the animation name is the default controller', () => {
  const s = fox();
  s.runCommand('/playanimation @e[tag=wiki:fmbe] animation.a none 0 "v.a=1;" c1', null, O);
  s.runCommand('/playanimation @e[tag=wiki:fmbe] animation.b none 0 "v.a=2;" c1', null, O);
  s.runCommand('/playanimation @e[tag=wiki:fmbe] animation.c none 0 "v.c=1;"', null, O);
  assert.deepEqual(Object.keys(s.world.entityByHandle('f')!.anims), ['c1', 'animation.c']);
  assert.equal(s.world.entityByHandle('f')!.anims.c1.animation, 'animation.b');
});

test('playanimation errors: bad arguments, Molang syntax, runtime errors, no targets', () => {
  const s = fox();
  const bad = (cmd: string) => assert.equal(s.runCommand(cmd, null, O), false, cmd);
  bad('/playanimation');
  bad('/playanimation @e[tag=wiki:fmbe]');
  bad('/playanimation @e[tag=wiki:fmbe] bad!name');
  bad('/playanimation @e[tag=wiki:fmbe] animation.a none abc "" c');
  bad('/playanimation @e[tag=wiki:fmbe] animation.a none 0 "1+" c');
  bad('/playanimation @e[tag=wiki:fmbe] animation.a none 0 "" c extra');
  bad('/playanimation @e[tag=nobody] animation.a none 0 "" c');
  bad("/playanimation @e[tag=wiki:fmbe] animation.a none 0 \"'a'+1;\" c");
  const errs = s.events.flatMap((e) => (e.type === 'chat' && e.kind === 'error' ? [e.text] : []));
  assert.match(errs.join('\n'), /Molang error at column 3/);
  assert.match(errs.join('\n'), /Molang runtime error/);
  s.runCommand("/playanimation @e[tag=wiki:fmbe] animation.a none 0 \"v.s='a';v.k=0;\" late", null, O);
  s.runCommand('/playanimation @e[tag=wiki:fmbe] animation.a none 0 "v.k=v.k+1;v.bad=v.s+1;" breaks', null, O);
});

test('a runtime error while ticking stops that animation and reports it once', () => {
  const s = fox();
  s.runCommand("/playanimation @e[tag=wiki:fmbe] animation.a none 0 \"v.s='a';\" a1", null, O);
  s.runCommand("/playanimation @e[tag=wiki:fmbe] animation.a none 0 \"v.bad=v.s+1;\" a2", null, O);
  assert.equal(s.world.entityByHandle('f')!.anims.a2, undefined);
  s.events = [];
  s.runCommand("/playanimation @e[tag=wiki:fmbe] animation.a none 0 \"v.n=(v.n??0)+1;v.bad=v.n>1?(v.s+1):0;\" a3", null, O);
  s.advance(3);
  const errs = s.events.filter((e) => e.type === 'chat' && e.kind === 'error');
  assert.ok(errs.length >= 1);
  assert.equal(s.world.entityByHandle('f')!.anims.a3, undefined);
});

test('lintProgram reports Molang problems on the right logical line, including after run', () => {
  const p = parse(`
/say fine
/playanimation @e animation.a none 0 "v.a=1;" c
/execute as @e run playanimation @s animation.a none 0 "v.a=(" c
/playanimation @e animation.a none 0 "q.bogus" c
`);
  assert.deepEqual(lintProgram(p).map((d) => d.line), [4, 5]);
  assert.match(lintProgram(p)[0].message, /column 6/);
});

test('@n picks the nearest entity of any type; stopsound validates its target', () => {
  const s = new Simulation(parse('ent(type=armor_stand, position=(5,0,0), name=far)\nent(type=fox, position=(1,0,0), name=near)\nent(type=player, position=(9,0,0), name=p)'));
  s.runCommand('/tag @n add hit', null, O);
  assert.deepEqual(s.world.entities.filter((e) => e.tags.has('hit')).map((e) => e.name), ['near']);
  s.runCommand('/tag @n[type=armor_stand] add hit2', null, O);
  assert.deepEqual(s.world.entities.filter((e) => e.tags.has('hit2')).map((e) => e.name), ['far']);
  assert.equal(s.runCommand('/stopsound @a mob.fox.spit', null, O), true);
  assert.equal(s.runCommand('/stopsound @e[name=far] x', null, O), false);
  assert.equal(s.runCommand('/stopsound', null, O), false);
});

test('summon sets the birth tick used by q.life_time', () => {
  const s = new Simulation(parse(''));
  s.advance(10);
  s.runCommand('/summon fox ~~~ ~ ~ minecraft:as_adult "wiki:fmbe"', null, O);
  s.runCommand('/tag @e[name="wiki:fmbe"] add wiki:fmbe', null, O);
  s.runCommand('/playanimation @e[tag=wiki:fmbe] animation.a none 0 "v.life=q.life_time;" c', null, O);
  s.advance(20);
  assert.equal(s.world.entities[0].molang.life, 1);
});