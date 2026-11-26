import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import lib from '../electron/lib.cjs';
import { parse } from '../src/language/parser.ts';
import { Simulation } from '../src/engine/simulation.ts';
import { exportScene, exportSceneBlocks } from '../src/engine/scene-export.ts';
import { bdxToCells, buildBdx, parseBdx, templateCells } from '../src/bdx/bdx.ts';
import { cellsToMcsim } from '../src/convert/to-mcsim.ts';

const SCRIPT = `
region(from=(-100,0,-100), to=(100,100,100))
block(type=stone, pos=(10, 20, 30))
block(type=oak_trapdoor, pos=(12, 21, 33), states=["direction"=2,"open_bit"=true,"upside_down_bit"=false])
fill(type=dirt, from=(11, 20, 30), to=(11, 20, 32))
block(type=oak_sign, pos=(14, 20, 31), states=["ground_sign_direction"=3], nbt={id:"Sign",FrontText:{Text:"hi"}})
chain c(pos=(13, 22, 30), facing=east):
    /say a
    cb(mode=cha, delay=4)
    /say b
`;

test('the base point: importing at it puts every block on the script coordinates (.mcstructure and BDX)', () => {
  const p = parse(SCRIPT);
  const mc = exportScene(p);
  assert.deepEqual(mc.template.origin, [10, 20, 30]);
  const viaMc = templateCells(mc.template).map((c) => c.pos.map((v, i) => v + mc.template.origin[i]).join(','));
  const bdx = exportSceneBlocks(p);
  assert.deepEqual(bdx.origin, [10, 20, 30]);
  const viaBdx = parseBdx(buildBdx(bdx.cells).content).blocks.map((b) => b.pos.map((v, i) => v + bdx.origin[i]).join(','));
  const want = ['10,20,30', '12,21,33', '11,20,30', '11,20,31', '11,20,32', '14,20,31', '13,22,30', '14,22,30'].sort();
  assert.deepEqual(viaMc.sort(), want);
  assert.deepEqual(viaBdx.sort(), want);
});

test('script -> BDX -> script gives the same scene', () => {
  const p = parse(SCRIPT);
  const first = exportSceneBlocks(p);
  const parsed = bdxToCells(parseBdx(buildBdx(first.cells).content));
  const text = cellsToMcsim(parsed.cells, [], { offset: first.origin, fills: true, entities: false, source: 'x.bdx', warnings: parsed.warnings }).text;
  const q = parse(text);
  assert.deepEqual(q.diagnostics, [], text);
  const a = new Simulation(p).world;
  const b = new Simulation(q).world;
  const dump = (w: typeof a) => [...w.blocks].map(([k, v]) => `${k} ${v.id} ${JSON.stringify(Object.entries(v.states).sort())} ${v.cb ? `${v.cb.command}|${v.cb.delay}|${v.cb.power}` : ''} ${v.entityNbt ? JSON.stringify(v.entityNbt, (_k, x) => (typeof x === 'bigint' ? String(x) : x)).includes('"hi"') : ''}`).sort();
  assert.deepEqual(dump(b), dump(a));
});

test('decodeStructureFile unpacks BD@ (brotli) and BDZ (gzip) and passes other files through', () => {
  const content = buildBdx(templateCells({ size: [1, 1, 1], origin: [0, 0, 0], blocks: [{ id: 'minecraft:stone', states: {} }], entities: [] })).content;
  const viaBr = lib.decodeStructureFile(lib.bdxFile(content));
  assert.equal(viaBr.kind, 'bdx');
  assert.deepEqual([...viaBr.content], [...content]);
  const viaGz = lib.decodeStructureFile(Buffer.concat([Buffer.from('BDZ'), zlib.gzipSync(Buffer.from(content))]));
  assert.deepEqual([...viaGz.content], [...content]);
  const other = lib.decodeStructureFile(Buffer.from([10, 0, 0, 0]));
  assert.equal(other.kind, 'mcstructure');
});