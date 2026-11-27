import { useState } from 'react';
import { useT } from '../../ui/I18n.tsx';
import type { Vec3 } from '../../language/types.ts';
import { Fmbe3D } from './Fmbe3D.tsx';
import { evaluate, fmtValue, MolangError, parseMolang } from '../../engine/molang.ts';
import type { PluginContext } from '../host.ts';
import {
  DEFAULT_SET_ANIMATION, DEFAULT_SET_CONTROLLER, DEFAULT_TAG, EX_VARIABLES, FMBE_VERSIONS, VARIABLES, commandsScript, fillItemCommand, foxScript, foxSetupCommands,
  parseCustomPrerequisite, prerequisiteCommands, prerequisiteScript, readTransform, selectorFor, transformCommand, variablesFor, type FmbeVersion, type FoxSpec,
} from './core.ts';

const O: Vec3 = [0, 0, 0];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="fm-section">
      <div className="nxhead">{title}</div>
      {children}
    </div>
  );
}

export function FmbePanel({ ctx }: { ctx: PluginContext }) {
  const t = useT();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const report = (ok: boolean, text: string) => setMessage({ ok, text });
  const attempt = (f: () => string) => {
    try {
      report(true, f());
    } catch (e) {
      report(false, (e as Error).message);
    }
  };
  const runAll = (cmds: string[]): string => {
    let failed = 0;
    for (const c of cmds) if (!ctx.sim.runCommand(`/${c}`, null, O)) failed++;
    ctx.refresh();
    if (failed) throw new Error(`${failed} of ${cmds.length} command(s) failed; see the execution log and the chat`);
    return `Ran ${cmds.length} command(s) in the live simulation`;
  };

  const [tag, setTag] = useState(DEFAULT_TAG);
  const [chainName, setChainName] = useState('fmbe_render');
  const [version, setVersion] = useState<FmbeVersion>('standard');
  const [custom, setCustom] = useState('');

  const [name, setName] = useState('wiki:fmbe');
  const [handle, setHandle] = useState('fmbe1');
  const [pos, setPos] = useState<[string, string, string]>(['0', '65', '0']);
  const [item, setItem] = useState('minecraft:stone');
  const [adult, setAdult] = useState(true);
  const [mode, setMode] = useState<'scene' | 'commands'>('scene');

  const [fillSel, setFillSel] = useState('@e[tag=wiki:fmbe]');
  const [fillItem, setFillItem] = useState('minecraft:gold_block');

  const [selector, setSelector] = useState('@e[tag=wiki:fmbe]');
  const [animation, setAnimation] = useState(DEFAULT_SET_ANIMATION);
  const [controller, setController] = useState(DEFAULT_SET_CONTROLLER);
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries([...VARIABLES, ...EX_VARIABLES].map((v) => [v.name, String(v.default)])));
  const [pasted, setPasted] = useState('');

  const [consoleTarget, setConsoleTarget] = useState('');
  const [expr, setExpr] = useState('v.xrot=35;v.ypos=16;v.scale=1.5;');
  const [filter, setFilter] = useState('');
  const [result, setResult] = useState('');

  const foxSpec = (): FoxSpec => ({
    name, tag, handle, item, adult, mode,
    position: pos.some((p) => p.trim() === '' || !Number.isFinite(Number(p))) ? null : (pos.map(Number) as Vec3),
  });
  const transformValues = () =>
    Object.fromEntries(variablesFor(version).filter((v) => enabled[v.name]).map((v) => [v.name, Number(values[v.name])])) as Record<string, number>;
  const currentTransform = () => transformCommand({ selector, values: transformValues(), animation, controller });

  const entities = ctx.sim.world.entities;
  const target = entities.find((e) => String(e.id) === consoleTarget) ?? entities.find((e) => e.type === 'minecraft:fox') ?? null;
  const shown = target ? Object.entries(target.molang).filter(([k]) => k.includes(filter.toLowerCase())) : [];

  const evaluateConsole = () => {
    if (!target) return setResult('There is no entity to run it on.');
    try {
      const before = { ...target.molang };
      const r = evaluate(parseMolang(expr), { vars: target.molang, temp: {}, query: (n, a) => (n === 'life_time' ? (ctx.sim.tick - target.born) / 20 : n === 'position' ? target.pos[Math.trunc(a[0]) % 3] : n === 'is_alive' ? 1 : 0) });
      const changed = Object.keys(target.molang).filter((k) => target.molang[k] !== before[k]);
      setResult(`value ${fmtValue(r.value)}${r.returned ? ' (returned)' : ''}; ${changed.length} variable(s) changed${changed.length ? `: ${changed.map((k) => `${k}=${fmtValue(target.molang[k])}`).join(', ')}` : ''}`);
      ctx.refresh();
    } catch (e) {
      setResult(e instanceof MolangError ? `Error at column ${e.index + 1}: ${e.message}` : (e as Error).message);
    }
  };

  return (
    <div className="nx">
      {message && <div className={`nxstatus ${message.ok ? 'ok' : 'bad'}`}>{message.text}</div>}

      <Section title={t('fm.preview')}>
        <Fmbe3D sim={ctx.sim} label={t('fm.noModels')} axesLabel={t('fm.axes')} />
      </Section>

      <Section title={t('fm.s1')}>
        <div className="nxrow">
          <span className="nxlabel">{t('fm.tagOfFoxes')}</span>
          <input value={tag} onChange={(e) => setTag(e.target.value)} />
          <span className="nxlabel" style={{ width: 'auto' }}>{t('fm.chain')}</span>
          <input style={{ width: 110 }} value={chainName} onChange={(e) => setChainName(e.target.value)} />
        </div>
        <div className="nxrow">
          <span className="nxlabel">{t('fm.version')}</span>
          <select value={version} onChange={(e) => setVersion(e.target.value as FmbeVersion)}>
            {FMBE_VERSIONS.map((v) => <option key={v} value={v}>{t(`fm.v.${v}` as 'fm.v.standard')}</option>)}
          </select>
        </div>
        <div className="nxrow">
          <button onClick={() => attempt(() => { ctx.insertText(prerequisiteScript(tag, chainName, 100, version)); return `Inserted the chain (one repeating block and ${prerequisiteCommands(tag, version).length - 1} chain blocks)`; })}>{t('fm.insertChain')}</button>
          <button onClick={() => attempt(() => runAll(prerequisiteCommands(tag, version)))}>{t('fm.runOnceNow')}</button>
        </div>
        <div className="nxhead">{t('fm.custom')}</div>
        <textarea className="nxbox" rows={3} placeholder={t('fm.customHint')} value={custom} onChange={(e) => setCustom(e.target.value)} />
        <div className="nxrow">
          <button onClick={() => attempt(() => { ctx.insertText(commandsScript(parseCustomPrerequisite(custom), chainName)); return 'Inserted the pasted prerequisite as a chain'; })}>{t('fm.insertChain')}</button>
          <button onClick={() => attempt(() => runAll(parseCustomPrerequisite(custom)))}>{t('fm.runOnceNow')}</button>
        </div>
      </Section>

      <Section title={t('fm.s2')}>
        <div className="nxrow"><span className="nxlabel">{t('fm.nameTag')}</span><input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="nxrow"><span className="nxlabel">{t('world.position')}</span>{pos.map((p, i) => <input key={i} style={{ width: 56 }} value={p} onChange={(e) => setPos(pos.map((o, k) => (k === i ? e.target.value : o)) as [string, string, string])} />)}</div>
        <div className="nxrow"><span className="nxlabel">{t('fm.heldItem')}</span><input value={item} onChange={(e) => setItem(e.target.value)} /></div>
        <div className="nxrow">
          <label><input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} /> {t('fm.asAdult')}</label>
          <select value={mode} onChange={(e) => setMode(e.target.value as 'scene' | 'commands')}>
            <option value="scene">{t('fm.modeScene')}</option>
            <option value="commands">{t('fm.modeCommands')}</option>
          </select>
          {mode === 'scene' && <input style={{ width: 80 }} title={t('fm.handle')} value={handle} onChange={(e) => setHandle(e.target.value)} />}
        </div>
        <div className="nxrow">
          <button onClick={() => attempt(() => { ctx.insertText(foxScript(foxSpec())); return 'Inserted into the script'; })}>{t('fm.insertIntoScript')}</button>
          <button onClick={() => attempt(() => runAll(foxSetupCommands({ ...foxSpec(), mode: 'commands' })))}>{t('fm.createNow')}</button>
        </div>
      </Section>

      <Section title={t('fm.s3')}>
        <div className="nxrow"><span className="nxlabel">{t('fm.targets')}</span><input style={{ flex: 1 }} value={fillSel} onChange={(e) => setFillSel(e.target.value)} /></div>
        <div className="nxrow"><span className="nxlabel">{t('fm.item')}</span><input value={fillItem} onChange={(e) => setFillItem(e.target.value)} /></div>
        <div className="nxrow">
          <button onClick={() => attempt(() => runAll([fillItemCommand(fillSel, fillItem)]))}>{t('fm.fillNow')}</button>
          <button onClick={() => attempt(() => { ctx.insertText(`/${fillItemCommand(fillSel, fillItem)}`); return 'Inserted into the script'; })}>{t('fm.insertCommand')}</button>
          <button onClick={() => setFillSel(selectorFor(tag))}>{t('fm.allFoxes')}</button>
        </div>
      </Section>

      <Section title={t('fm.s4')}>
        <div className="nxrow"><span className="nxlabel">{t('fm.targets')}</span><input style={{ flex: 1 }} value={selector} onChange={(e) => setSelector(e.target.value)} /></div>
        <table>
          <thead><tr><th /><th>{t('fm.variable')}</th><th>{t('fm.value')}</th><th>{t('fm.unit')}</th></tr></thead>
          <tbody>
            {variablesFor(version).map((v) => (
              <tr key={v.name}>
                <td><input type="checkbox" checked={!!enabled[v.name]} onChange={(e) => setEnabled({ ...enabled, [v.name]: e.target.checked })} /></td>
                <td>v.{v.name}</td>
                <td><input style={{ width: 70 }} value={values[v.name]} onChange={(e) => { setValues({ ...values, [v.name]: e.target.value }); setEnabled({ ...enabled, [v.name]: true }); }} /></td>
                <td className="muted">{v.group}, {v.hint}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="nxrow">
          <button onClick={() => attempt(() => runAll([currentTransform()]))}>{t('fm.applyNow')}</button>
          <button onClick={() => attempt(() => { ctx.insertText(`/${currentTransform()}`); return 'Inserted into the script'; })}>{t('fm.insertCommand')}</button>
        </div>
        <textarea className="nxbox" readOnly rows={3} value={(() => { try { return `/${currentTransform()}`; } catch (e) { return (e as Error).message; } })()} />
        <div className="nxhead">{t('fm.readTitle')}</div>
        <textarea className="nxbox" rows={2} placeholder={t('fm.paste')} value={pasted} onChange={(e) => setPasted(e.target.value)} />
        <div className="nxrow">
          <button
            onClick={() => {
              const t = readTransform(pasted);
              if (!t) return report(false, 'That is not a valid playanimation command');
              setSelector(t.selector);
              setAnimation(t.animation);
              if (t.controller) setController(t.controller);
              setValues({ ...values, ...Object.fromEntries(Object.entries(t.values).map(([k, v]) => [k, String(v)])) });
              setEnabled({ ...enabled, ...Object.fromEntries(Object.keys(t.values).map((k) => [k, true])) });
              report(true, `Read ${Object.keys(t.values).length} constant assignment(s)`);
            }}
          >
            {t('fm.readInto')}
          </button>
        </div>
      </Section>

      <Section title={t('fm.s5')}>
        <div className="nxrow">
          <select value={target ? String(target.id) : ''} onChange={(e) => setConsoleTarget(e.target.value)}>
            {entities.map((e) => <option key={e.id} value={e.id}>{e.handle ?? e.name ?? `${e.type}#${e.id}`}</option>)}
          </select>
          <input style={{ width: 120 }} placeholder={t('insp.filter')} value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        <textarea className="nxbox" rows={3} value={expr} onChange={(e) => setExpr(e.target.value)} />
        <div className="nxrow"><button onClick={evaluateConsole}>{t('fm.evaluate')}</button></div>
        {result && <div className="muted">{result}</div>}
        <table>
          <thead><tr><th>{t('fm.variable')}</th><th>{t('fm.value')}</th></tr></thead>
          <tbody>{shown.map(([k, v]) => <tr key={k}><td>v.{k}</td><td>{fmtValue(v)}</td></tr>)}</tbody>
        </table>
        {target && <div className="muted">{Object.keys(target.anims).length} active animation(s); each runs once per game tick.</div>}
      </Section>
    </div>
  );
}