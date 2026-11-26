import { useState } from 'react';
import { bdxToCells, buildBdx, cellsToTemplate, parseBdx, templateCells, type BdxCell } from '../../bdx/bdx.ts';
import { entityCommandCells } from '../../bdx/entity-commands.ts';
import { cellsToMcsim } from '../../convert/to-mcsim.ts';
import { SceneExportError, exportScene, exportSceneBlocks } from '../../engine/scene-export.ts';
import { AIR } from '../../engine/world.ts';
import { normalizeStructureName, type SavedEntity, type StructureTemplate } from '../../engine/structure.ts';
import type { Vec3 } from '../../language/types.ts';
import { exportMcstructure, importMcstructure } from '../../nbt/mcstructure.ts';
import { baseName, desktop } from '../../ui/desktop.ts';
import { useT } from '../../ui/I18n.tsx';
import type { PluginContext } from '../host.ts';

const toBase64 = (b: Uint8Array) => {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromBase64 = (t: string) => Uint8Array.from(atob(t), (c) => c.charCodeAt(0));

interface Pending {
  name: string;
  cells: BdxCell[];
  entities: SavedEntity[];
  /** Where the file says the structure stood (only .mcstructure files know). */
  fileOrigin: Vec3 | null;
  warnings: string[];
}

export function StructuresPanel({ ctx }: { ctx: PluginContext }) {
  const t = useT();
  const [msg, setMsg] = useState('');
  const [addToLibrary, setAddToLibrary] = useState(true);
  const [entityCmds, setEntityCmds] = useState(true);
  const [selfDestruct, setSelfDestruct] = useState(true);
  const [pending, setPending] = useState<Pending | null>(null);
  const [offset, setOffset] = useState<[string, string, string]>(['0', '0', '0']);
  const [fills, setFills] = useState(true);
  const [withEntities, setWithEntities] = useState(true);
  const rows: { name: string; kind: 'disk' | 'memory'; tpl: StructureTemplate }[] = [
    ...[...ctx.sim.library].map(([name, tpl]) => ({ name, kind: 'disk' as const, tpl })),
    ...[...ctx.sim.world.structures].map(([name, tpl]) => ({ name, kind: 'memory' as const, tpl })),
  ];
  const base = (p: Vec3) => t('struct.base', { pos: p.join(', ') });
  const libraryName = (file: string) => normalizeStructureName(file.replace(/\.(mcstructure|bdx)$/i, '').replace(/\s+/g, '_'));

  const readFile = async (): Promise<{ name: string; template?: StructureTemplate; cells: BdxCell[]; entities: SavedEntity[]; origin: Vec3 | null; warnings: string[] } | null> => {
    const f = await desktop?.importStructure();
    if (!f) return null;
    try {
      const bytes = fromBase64(f.base64);
      if (f.kind === 'bdx') {
        const r = bdxToCells(parseBdx(bytes));
        return { name: f.name, cells: r.cells, entities: [], origin: null, warnings: r.warnings };
      }
      const tpl = importMcstructure(bytes);
      return { name: f.name, template: tpl, cells: templateCells(tpl), entities: tpl.entities, origin: tpl.origin, warnings: [] };
    } catch (e) {
      setMsg(t('struct.bad', { error: (e as Error).message }));
      return null;
    }
  };
  const doImport = async () => {
    const f = await readFile();
    if (!f) return;
    try {
      const tpl = f.template ?? cellsToTemplate(f.cells);
      const name = libraryName(f.name);
      ctx.sim.library.set(name, tpl);
      setMsg([t('struct.imported', { name }), ...f.warnings].join('. '));
      ctx.refresh();
    } catch (e) {
      setMsg(t('struct.bad', { error: (e as Error).message }));
    }
  };
  const doToScript = async () => {
    const f = await readFile();
    if (f) openConvert({ name: f.name, cells: f.cells, entities: f.entities, fileOrigin: f.origin, warnings: f.warnings });
  };
  const openConvert = (p: Pending) => {
    setPending(p);
    setOffset(['0', '0', '0']);
  };
  const offsetVec = (): Vec3 => offset.map((s) => Math.trunc(Number(s) || 0)) as Vec3;
  const convert = () => {
    if (!pending) return;
    const r = cellsToMcsim(pending.cells, pending.entities, { offset: offsetVec(), fills, entities: withEntities, source: pending.name, warnings: pending.warnings });
    ctx.openAsNewDocument(r.text);
    setMsg(t('struct.converted', { name: pending.name, ...r.stats, notes: r.notes.length }));
    setPending(null);
  };

  const doScene = async () => {
    try {
      const r = exportScene(ctx.program);
      const path = await desktop?.exportStructure('scene.mcstructure', toBase64(exportMcstructure(r.template)));
      if (!path) return;
      if (addToLibrary) ctx.sim.library.set(libraryName(baseName(path)), r.template);
      const blocks = r.template.blocks.filter((b) => b.id !== AIR).length;
      const placed = r.placed.map((p) => t('struct.scenePlaced', { chain: p.chain, pos: p.pos.join(', ') })).join('; ');
      setMsg([t('struct.sceneDone', { size: r.template.size.join('x'), blocks, entities: r.template.entities.length }), placed, base(r.template.origin)].filter(Boolean).join('. '));
      ctx.refresh();
    } catch (e) {
      if (!(e instanceof SceneExportError)) throw e;
      setMsg(e.line ? `${e.message} (${t('struct.sceneLine', { line: e.line })})` : e.message);
      if (e.line) ctx.jump(e.line);
    }
  };

  /** Writes a BDX; entities become a chain of command blocks when that option is on. `origin` is the point the structure's lowest corner stands at. */
  const saveBdx = async (suggested: string, cells: BdxCell[], entities: SavedEntity[], origin: Vec3, extra = '') => {
    const parts: string[] = [];
    let all = cells;
    const live = entities.filter((e) => e.type !== 'minecraft:player');
    if (entityCmds && live.length) {
      const maxZ = Math.max(0, ...cells.map((c) => c.pos[2]), ...live.map((e) => Math.floor(e.pos[2])));
      const h = entityCommandCells(live, { start: [0, 0, maxZ + 2], selfDestruct });
      all = [...cells, ...h.cells];
      parts.push(t('struct.entityChain', { n: h.stats.entities, blocks: h.stats.commandBlocks }), ...h.notes);
    } else if (live.length) parts.push(t('struct.bdxSkipped', { n: live.length }));
    const { content, stats } = buildBdx(all);
    const path = await desktop?.exportBdx(suggested, toBase64(content));
    if (!path) return;
    setMsg([t('struct.bdxDone', { blocks: stats.blocks, commands: stats.commandBlocks, entities: stats.blockEntities }), ...parts, extra, base(origin)].filter(Boolean).join('. '));
  };
  const doSceneBdx = async () => {
    try {
      const r = exportSceneBlocks(ctx.program);
      await saveBdx('scene.bdx', r.cells, r.entities, r.origin, r.placed.map((p) => t('struct.scenePlaced', { chain: p.chain, pos: p.pos.join(', ') })).join('; '));
    } catch (e) {
      if (!(e instanceof SceneExportError)) throw e;
      setMsg(e.message);
    }
  };
  const doExport = async (name: string, tpl: StructureTemplate) => {
    const path = await desktop?.exportStructure(`${name.replace(/^.*:/, '')}.mcstructure`, toBase64(exportMcstructure(tpl)));
    if (path) setMsg(base(tpl.origin));
  };
  const remove = (name: string, kind: 'disk' | 'memory') => {
    (kind === 'disk' ? ctx.sim.library : ctx.sim.world.structures).delete(name);
    ctx.refresh();
  };
  return (
    <div className="nx">
      <div className="nxrow">
        <button onClick={doImport}>{t('struct.import')}</button>
        <button onClick={doToScript}>{t('struct.toScript')}</button>
        <button onClick={doScene}>{t('struct.scene')}</button>
        <button onClick={doSceneBdx}>{t('struct.sceneBdx')}</button>
        <label><input type="checkbox" checked={addToLibrary} onChange={(e) => setAddToLibrary(e.target.checked)} /> {t('struct.sceneAdd')}</label>
        <label><input type="checkbox" checked={entityCmds} onChange={(e) => setEntityCmds(e.target.checked)} /> {t('struct.entityCmds')}</label>
        <label><input type="checkbox" checked={selfDestruct} disabled={!entityCmds} onChange={(e) => setSelfDestruct(e.target.checked)} /> {t('struct.selfDestruct')}</label>
      </div>
      {msg && <div className="muted">{msg}</div>}
      {pending && (
        <div className="nxbox">
          <b>{t('struct.convertTitle', { name: pending.name })}</b>
          <div className="nxrow">
            {t('struct.offset')}
            {[0, 1, 2].map((i) => (
              <input key={i} style={{ width: 70 }} value={offset[i]} onChange={(e) => setOffset((o) => o.map((v, k) => (k === i ? e.target.value : v)) as [string, string, string])} />
            ))}
            {pending.fileOrigin && <button onClick={() => setOffset(pending.fileOrigin!.map(String) as [string, string, string])}>{t('struct.fileOrigin')}</button>}
          </div>
          <div className="nxrow">
            <label><input type="checkbox" checked={fills} onChange={(e) => setFills(e.target.checked)} /> {t('struct.fills')}</label>
            <label><input type="checkbox" checked={withEntities} onChange={(e) => setWithEntities(e.target.checked)} /> {t('struct.withEntities')}</label>
            <button onClick={convert}>{t('struct.convert')}</button>
            <button onClick={() => setPending(null)}>{t('struct.cancel')}</button>
          </div>
        </div>
      )}
      {!rows.length && <div className="muted">{t('struct.empty')}</div>}
      {rows.map((r) => (
        <div key={`${r.kind}:${r.name}`} className="nxrow">
          <b>{r.name}</b> <span className="muted">[{t(`struct.${r.kind}`)}] {t('struct.row', { size: r.tpl.size.join('x'), blocks: r.tpl.blocks.filter((b) => b.id !== AIR).length, entities: r.tpl.entities.length })}</span>{' '}
          <button onClick={() => doExport(r.name, r.tpl)}>{t('struct.export')}</button>
          <button onClick={() => saveBdx(`${r.name.replace(/^.*:/, '')}.bdx`, templateCells(r.tpl), r.tpl.entities, r.tpl.origin)}>{t('struct.bdx')}</button>
          <button onClick={() => openConvert({ name: r.name, cells: templateCells(r.tpl), entities: r.tpl.entities, fileOrigin: r.tpl.origin, warnings: [] })}>{t('struct.rowToScript')}</button>
          <button onClick={() => remove(r.name, r.kind)}>{t('struct.delete')}</button>
        </div>
      ))}
    </div>
  );
}