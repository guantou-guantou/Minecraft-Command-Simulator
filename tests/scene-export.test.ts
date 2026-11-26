import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/language/parser.ts';
import { SceneExportError, exportScene } from '../src/engine/scene-export.ts';
import { cellIndex } from '../src/engine/structure.ts';
import { exportMcstructure, importMcstructure } from '../src/nbt/mcstructure.ts';

const get = (t: ReturnType<typeof exportScene>['template'], x: number, y: number, z: number) => t.blocks[cellIndex(t.size, x - t.origin[0], y - t.origin[1], z - t.origin[2])];
const fails = (src: string, re: RegExp) => assert.throws(() => exportScene(parse(src)), (e: unknown) => e instanceof SceneExportError && re.test(e.message));

test('the smallest box around blocks, containers, chains and entities is exported', () => {
  const r = exportScene(parse(`
block(type=stone, position=(2, 64, 3))
block(type=chest, position=(4, 66, 5))
item(target=(4, 66, 5), slot=slot.container, index=0, type=diamond, count=3)
ent(type=armor_stand, position=(1.5, 63, 3.5), name=s, tags=["t"])
ent(type=player, position=(0, 0, 0), name=alice)
chain c(pos=(3, 65, 3), facing=east):
    /say a
    cb(mode=cha, delay=7)
    /say b
`));
  const t = r.template;
  assert.deepEqual(t.origin, [1, 63, 3]);
  assert.deepEqual(t.size, [4, 4, 3]);
  assert.equal(get(t, 2, 64, 3).id, 'minecraft:stone');
  assert.equal(get(t, 4, 66, 5).items?.['slot.container:0']?.count, 3);
  assert.equal(get(t, 3, 65, 3).cb?.command, 'say a');
  assert.equal(get(t, 4, 65, 3).cb?.delay, 7);
  assert.equal(t.entities.length, 1);
  assert.deepEqual(t.entities[0].pos, [0.5, 0, 0.5]);
  assert.equal(r.skippedPlayers, 1);
  assert.deepEqual(r.placed, []);
  const back = importMcstructure(exportMcstructure(t));
  assert.deepEqual(back.size, t.size);
  assert.equal(back.entities[0].name, 's');
});

test('anything outside the region stops the export and points at its line', () => {
  fails('region(from=(0,0,0), to=(10,10,10))\nblock(type=stone, position=(3, 3, 3))\nblock(type=stone, position=(11, 3, 3))', /Block minecraft:stone at \(11, 3, 3\) is outside/);
  fails('region(from=(0,0,0), to=(10,10,10))\nent(type=cow, position=(5, 5, 11.5))', /Entity .* outside/);
  fails('region(from=(0,0,0), to=(10,10,10))\nchain c(pos=(9, 1, 1), facing=east):\n    /say a\n    cb(mode=cha)\n    /say b\n    cb(mode=cha)\n    /say c', /Chain c/);
  try {
    exportScene(parse('block(type=stone, position=(0, 0, 0))\nblock(type=stone, position=(0, 999, 0))'));
    assert.fail('should have thrown');
  } catch (e) {
    assert.equal((e as SceneExportError).line, 2);
  }
});

test('chains without a position are placed in free cells with a gap around them, facing east', () => {
  const r = exportScene(parse(`
block(type=stone, position=(0, 64, 0))
block(type=stone, position=(9, 70, 9))
ent(type=cow, position=(5.5, 66, 4.5))
/say first
cb(mode=cha, delay=3)
/say second
chain other:
    /say o1
    cb(mode=cha)
    /say o2
`));
  assert.equal(r.placed.length, 2);
  const t = r.template;
  assert.deepEqual(t.size.map((s) => s <= 64), [true, true, true]);
  const taken = new Set<string>(['0,64,0', '9,70,9', '5,66,4']);
  for (const p of r.placed) {
    const n = p.chain === 'main' ? 2 : 2;
    for (let dx = -1; dx <= n; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) assert.ok(!taken.has(`${p.pos[0] + dx},${p.pos[1] + dy},${p.pos[2] + dz}`), `${p.chain} touches something at ${dx},${dy},${dz}`);
    for (let i = 0; i < n; i++) taken.add(`${p.pos[0] + i},${p.pos[1]},${p.pos[2]}`);
    assert.deepEqual(t.origin.map((o, i) => p.pos[i] >= o), [true, true, true]);
    const first = get(t, p.pos[0], p.pos[1], p.pos[2]);
    assert.equal(first.id, 'minecraft:command_block');
    assert.equal(first.states.facing_direction, 5);
    assert.equal(get(t, p.pos[0] + 1, p.pos[1], p.pos[2]).id, 'minecraft:chain_command_block');
  }
  assert.equal(get(t, ...r.placed[0].pos).cb?.command, 'say first');
  assert.equal(get(t, r.placed[0].pos[0] + 1, r.placed[0].pos[1], r.placed[0].pos[2]).cb?.delay, 3);
  const [a, b] = r.placed;
  assert.notDeepEqual(a.pos, b.pos);
});

test('a scene with only a main chain exports it, an empty one and an oversized one do not', () => {
  const r = exportScene(parse('/say hi\ncb(mode=cha)\n/say there'));
  assert.deepEqual(r.template.size, [2, 1, 1]);
  assert.equal(r.template.blocks[0].id, 'minecraft:command_block');
  fails('', /nothing to export/);
  fails('ent(type=player, position=(0,0,0), name=a)', /nothing to export/);
  fails('block(type=stone, position=(0, 0, 0))\nblock(type=stone, position=(64, 0, 0))', /65 x 1 x 1/);
  assert.doesNotThrow(() => exportScene(parse('block(type=stone, position=(0, 0, 0))\nblock(type=stone, position=(63, 0, 0))')));
});

test('chains that do not fit inside the box are placed next to it, still inside the region', () => {
  const r = exportScene(parse(`
region(from=(0,0,0), to=(30,5,30))
block(type=stone, position=(0, 0, 0))
block(type=stone, position=(1, 0, 0))
/say a
cb(mode=cha)
/say b
cb(mode=cha)
/say c
cb(mode=cha)
/say d
`));
  const [p] = r.placed;
  assert.ok(p.pos[0] >= 0 && p.pos[0] + 3 <= 30 && p.pos[1] >= 0 && p.pos[1] <= 5 && p.pos[2] >= 0 && p.pos[2] <= 30);
  assert.ok(Math.abs(p.pos[2]) >= 2 || Math.abs(p.pos[1]) >= 2);
  assert.equal(get(r.template, p.pos[0] + 3, p.pos[1], p.pos[2]).cb?.command, 'say d');
});