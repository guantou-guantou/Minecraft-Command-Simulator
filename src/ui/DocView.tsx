import { useEffect, useMemo, useRef, useState } from 'react';
import { emptyHistory, loadHistory, newer, older, remember, saveHistory } from './termHistory.ts';
import { loadHintMode, saveHintMode, type HintMode } from './hints.ts';
import { MAX_TPS, MIN_TPS, loadTps, sanitizeTps, saveTps, ticksDue } from './tps.ts';
import { useLang, useT } from './I18n.tsx';
import { gameText } from './gameText.ts';
import { clockText, dayNumber, daytime } from '../engine/clock.ts';
import { lintProgram } from '../engine/lint.ts';
import { lintCommands } from '../language/cmdlint.ts';
import type { StructureTemplate } from '../engine/structure.ts';
import { sceneFrom } from '../language/complete.ts';
import { parse } from '../language/parser.ts';
import { Simulation } from '../engine/simulation.ts';
import { exportAllCommands, exportAllManifest } from '../export.ts';
import type { SimEvent } from '../engine/types.ts';
import { holderName } from '../engine/scoreboard.ts';
import { fmtBlock } from '../engine/world.ts';
import { joinScript, wrapScript } from '../language/format.ts';
import { logicalLines } from '../language/lines.ts';
import type { PluginHost } from '../plugins/host.ts';
import { EditorView } from '@codemirror/view';
import { ChainPicker } from './ChainPicker.tsx';
import { CodeEditor, type EditorHandle } from './CodeEditor.tsx';
import type { Doc } from './docs.ts';
import { Inspector, type Selection } from './Inspector.tsx';
import { MIN, MIN_REST, SPLITTER, DEFAULT_LAYOUT, maxC1, maxC2, type Layout } from './layout.ts';
import { parseMcText } from './mctext.ts';
import { Splitter } from './Splitter.tsx';

const MAX_ROWS = 500;

export interface ViewActions {
  run(): void;
  tick(): void;
  tick20(): void;
  reset(): void;
}

export interface FileActions {
  newDoc(): void;
  /** Opens generated text in a new, unsaved tab. */
  newDocWithText(text: string): void;
  open(): void;
  save(): void;
  saveAs(): void;
  exportText(name: string, content: string): void;
}

interface Props {
  doc: Doc;
  active: boolean;
  host: PluginHost;
  layout: Layout;
  setLayout: (l: Layout) => void;
  setText: (text: string) => void;
  files: FileActions;
  register: (id: number, actions: ViewActions) => void;
}

function McText({ text }: { text: string }) {
  return (
    <>
      {parseMcText(text).map((s, i) => (
        <span key={i} style={{ color: s.color ?? undefined, fontWeight: s.bold ? 'bold' : undefined, fontStyle: s.italic ? 'italic' : undefined }}>{s.text}</span>
      ))}
    </>
  );
}

const WEATHER_KEY = { clear: 'weather.clear', rain: 'weather.rain', thunder: 'weather.thunder' } as const;
const DIFF_KEY = { peaceful: 'diff.peaceful', easy: 'diff.easy', normal: 'diff.normal', hard: 'diff.hard' } as const;

const fmtPos = (p: number[]) => p.map((n) => +n.toFixed(2)).join(', ');

export function DocView({ doc, active, host, layout, setLayout, setText, files, register }: Props) {
  const t = useT();
  const text = doc.text;
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());
  const [uncheckedTests, setUncheckedTests] = useState<Set<string>>(new Set());
  const [playing, setPlaying] = useState(false);
  const [tps, setTps] = useState(loadTps);
  const [curLine, setCurLine] = useState(0);
  const [rev, bump] = useState(0);
  const [lang] = useLang();
  const [termText, setTermText] = useState('');
  const termHist = useRef(emptyHistory(loadHistory()));
  const [execId, setExecId] = useState('');
  const [sel, setSel] = useState<Selection>(null);
  const [softWrap, setSoftWrap] = useState(true);
  const [showEol, setShowEol] = useState(false);
  const [hintMode, setHintMode] = useState<HintMode>(loadHintMode);
  const [panelId, setPanelId] = useState<string | null>(null);
  const editor = useRef<EditorHandle | null>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<HTMLDivElement>(null);
  const pane1 = useRef<HTMLDivElement>(null);
  const pane2 = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<HTMLDivElement>(null);

  const refresh = () => bump((n) => n + 1);
  const program = useMemo(() => parse(text), [text]);
  const library = useRef(new Map<string, StructureTemplate>());
  const panelState = useRef(new Map<string, unknown>());
  const sim = useMemo(() => {
    const s = new Simulation(program);
    s.library = library.current;
    host.apply(s);
    return s;
  }, [program, host]);
  const checked = useMemo(() => program.chains.filter((c) => !unchecked.has(c.name)), [program, unchecked]);
  const runChecked = (f: (name: string) => void) => () => checked.forEach((c) => f(c.name));
  const diagnostics = useMemo(() => [...program.diagnostics, ...lintProgram(program), ...lintCommands(text)].sort((a, b) => a.line - b.line), [program, text]);
  const spans = useMemo(() => diagnostics.flatMap((d) => (d.span ? [d.span] : [])), [diagnostics]);
  const scene = useMemo(() => sceneFrom(text, program, [...library.current.keys(), ...sim.world.structures.keys()]), [text, program, sim, rev]);
  const errLines = useMemo(() => new Set(diagnostics.map((d) => d.line)), [diagnostics]);

  const [logFrom, setLogFrom] = useState(0);
  const [logShow, setLogShow] = useState({ trace: true, change: true, effect: true });
  useEffect(() => {
    setPlaying(false);
    setLogFrom(0);
  }, [sim]);
  useEffect(() => {
    if (!playing || !active) return;
    let last = performance.now();
    let carry = 0;
    const id = setInterval(() => {
      const now = performance.now();
      const due = ticksDue(carry, tps, now - last);
      last = now;
      carry = due.carry;
      if (due.ticks > 0) {
        sim.advance(due.ticks);
        refresh();
      }
    }, 25);
    return () => clearInterval(id);
  }, [playing, active, sim, tps]);

  const jump = (line: number, span?: { from: number; to: number }) => {
    const view = editor.current?.view;
    if (!view || line < 1) return;
    if (span && span.to <= view.state.doc.length) {
      view.dispatch({ selection: { anchor: span.from, head: span.to }, effects: EditorView.scrollIntoView(span.from, { y: 'center' }) });
      view.focus();
      setCurLine(line);
      return;
    }
    const logical = logicalLines(text).find((l) => l.line === line);
    if (!logical) return;
    const doc = view.state.doc;
    const start = doc.line(logical.physical + 1).from;
    const end = doc.line(Math.min(doc.lines, logical.physical + logical.count)).to;
    view.dispatch({ selection: { anchor: start, head: end }, effects: EditorView.scrollIntoView(start, { y: 'start', yMargin: 60 }) });
    view.focus();
    setCurLine(line);
  };
  const act = (f: () => void) => () => {
    f();
    refresh();
  };

  register(doc.id, {
    run: () => checked.length && act(runChecked((n) => sim.runChain(n)))(),
    tick: act(() => sim.advance(1)),
    tick20: act(() => sim.advance(20)),
    reset: act(() => {
      setPlaying(false);
      setLogFrom(0);
      sim.reset();
    }),
  });

  const rows = sim.events
    .slice(Math.min(logFrom, sim.events.length))
    .filter((e): e is Exclude<SimEvent, { type: 'chat' | 'screen' }> => e.type !== 'chat' && e.type !== 'screen')
    .filter((e) => logShow[e.type === 'trace' ? 'trace' : e.type === 'change' ? 'change' : 'effect'])
    .slice(-MAX_ROWS)
    .reverse();
  const chats = sim.events
    .filter((e): e is Extract<SimEvent, { type: 'chat' | 'screen' }> => e.type === 'chat' || e.type === 'screen')
    .slice(-MAX_ROWS);
  const executor = sim.world.entities.find((e) => String(e.id) === execId) ?? null;

  const submitTerm = () => {
    const t = termText.trim();
    if (!t) return;
    termHist.current = remember(termHist.current, t);
    saveHistory(termHist.current.items);
    sim.events.push({ type: 'chat', kind: 'system', tick: sim.tick, line: 0, sender: null, text: `> ${t}` });
    if (t.startsWith('/')) sim.runCommand(t, executor, executor ? [...executor.pos] : [0, 0, 0]);
    else sim.sendChat(t, executor);
    setTermText('');
    refresh();
  };

  const size = (el: HTMLElement | null, axis: 'width' | 'height') => el?.getBoundingClientRect()[axis] ?? 0;
  const mainWidth = () => size(mainRef.current, 'width') || 1200;
  const panel = host.panels.find((p) => p.id === panelId);

  return (
    <div className="docview" ref={docRef} style={{ display: active ? 'flex' : 'none' }}>
      <div className="toolbar">
        <ChainPicker chains={program.chains.map((c) => c.name)} unchecked={unchecked} onChange={setUnchecked} />
        <button disabled={!checked.length} onClick={act(runChecked((n) => sim.runChain(n)))} title={t('tb.runOnceTip')}>{t('tb.runOnce')}</button>
        <button disabled={!checked.length} onClick={act(runChecked((n) => sim.activate(n)))}>{t('tb.activate')}</button>
        <button disabled={!checked.length} onClick={act(runChecked((n) => sim.deactivate(n)))}>{t('tb.deactivate')}</button>
        <span className="sep" />
        <button onClick={act(() => sim.advance(1))}>{t('tb.tick1')}</button>
        <button onClick={act(() => sim.advance(20))}>{t('tb.tick20')}</button>
        <button onClick={() => setPlaying(!playing)}>{playing ? t('tb.pause') : t('tb.play')}</button>
          <label className="tpsbox" title={t('tb.tpsTip')}>
            <input
              type="number" min={MIN_TPS} max={MAX_TPS} step={1} style={{ width: 56 }} value={tps}
              onChange={(e) => { const v = sanitizeTps(e.target.value); setTps(v); saveTps(v); }}
            /> {t('tb.tps')}
          </label>
        <button onClick={act(() => { setPlaying(false); setLogFrom(0); sim.reset(); })}>{t('tb.reset')}</button>
        <span>{t('tb.tick', { n: sim.tick })}</span>
        <span className="sep" />
        <button disabled={!checked.length} onClick={() => files.exportText(checked.length === 1 ? `${checked[0].name}.txt` : 'chains.txt', exportAllCommands(checked))}>{t('tb.exportCommands')}</button>
        <button disabled={!checked.length} onClick={() => files.exportText(checked.length === 1 ? `${checked[0].name}.manifest.txt` : 'chains.manifest.txt', exportAllManifest(checked))}>{t('tb.exportManifest')}</button>
        <span className="sep" />
        {host.panels.map((p) => (
          <button key={p.id} className={panelId === p.id ? 'on' : ''} onClick={() => setPanelId(panelId === p.id ? null : p.id)}>{p.title}</button>
        ))}
        <span className="sep" />
        <button onClick={files.newDoc}>{t('tb.new')}</button>
        <button onClick={files.open}>{t('tb.open')}</button>
        <button onClick={files.save}>{t('tb.save')}</button>
        <button onClick={files.saveAs}>{t('tb.saveAs')}</button>
      </div>

      <div className="mainrow" ref={rowRef}>
        <div
          className="main"
          ref={mainRef}
          style={{ gridTemplateColumns: `minmax(0, ${layout.c1}px) ${SPLITTER}px minmax(0, ${layout.c2}px) ${SPLITTER}px minmax(${MIN_REST}px, 1fr)` }}
        >
          <div className="pane" ref={pane1}>
            <h3>
              {t('script.title')}
              <span className="tools">
                <label><input type="checkbox" checked={softWrap} onChange={(e) => setSoftWrap(e.target.checked)} /> {t('script.wrap')}</label>
                <label title={t('script.hintTip')}>{t('script.hint')} <select value={hintMode} onChange={(e) => { const m = e.target.value as HintMode; setHintMode(m); saveHintMode(m); }}>
          <option value="bar">{t('script.hintBar')}</option>
          <option value="float">{t('script.hintFloat')}</option>
          <option value="off">{t('script.hintOff')}</option>
        </select></label>
        <label title={t('script.eolTip')}><input type="checkbox" checked={showEol} onChange={(e) => setShowEol(e.target.checked)} /> {t('script.eol')}</label>
                <button title={t('script.splitTip')} onClick={() => setText(wrapScript(text, 100))}>{t('script.split')}</button>
                <button title={t('script.joinTip')} onClick={() => setText(joinScript(text))}>{t('script.join')}</button>
              </span>
            </h3>
            <CodeEditor value={text} onChange={setText} errLines={errLines} curLine={curLine} editorRef={editor} wrap={softWrap} eol={showEol} hintMode={hintMode} scene={scene} spans={spans} />
            {diagnostics.length > 0 && (
              <div className="diags">
                {diagnostics.map((d, i) => <div key={i} onClick={() => jump(d.line, d.span)}>line {d.line}: {d.message}</div>)}
              </div>
            )}
          </div>

          <Splitter
            dir="col"
            value={layout.c1}
            min={MIN.c1}
            measure={() => size(pane1.current, 'width')}
            max={() => maxC1(mainWidth(), size(pane2.current, 'width'))}
            onChange={(c1) => setLayout({ ...layout, c1 })}
            onReset={() => setLayout({ ...layout, c1: DEFAULT_LAYOUT.c1 })}
          />

          <div className="pane" ref={pane2}>
            <h3>
              {t('log.title')}
              <span className="tools">
                {(['trace', 'change', 'effect'] as const).map((k) => (
                  <label key={k}>
                    <input type="checkbox" checked={logShow[k]} onChange={(e) => setLogShow({ ...logShow, [k]: e.target.checked })} /> {t(`log.${k}`)}
                  </label>
                ))}
                <button onClick={() => setLogFrom(sim.events.length)}>{t('log.clear')}</button>
              </span>
            </h3>
            <div className="scroll">
              {rows.length === 0 && <div className="muted">{t('log.empty')}</div>}
              {rows.map((e, i) => (
                <div key={i} className={`row ${e.type === 'trace' ? (e.status ?? '') : e.type === 'change' ? 'change' : 'effect'}`} onClick={() => jump(e.line, e.type === 'trace' && e.status === 'syntax_error' ? diagnostics.find((d) => d.line === e.line && d.span)?.span : undefined)}>
                  <span className="t">t{e.tick}</span>
                  <span className="l">L{e.line}</span>
                  {e.type === 'trace'
                    ? `${e.branch ? `[${e.branch}] ` : ''}${e.message}`
                    : e.type === 'change'
                      ? `${e.target}: ${e.what}`
                      : `particle ${e.id} at (${e.pos.map((n: number) => +n.toFixed(2)).join(', ')})`}
                </div>
              ))}
            </div>
          </div>

          <Splitter
            dir="col"
            value={layout.c2}
            min={MIN.c2}
            measure={() => size(pane2.current, 'width')}
            max={() => maxC2(mainWidth(), size(pane1.current, 'width'))}
            onChange={(c2) => setLayout({ ...layout, c2 })}
            onReset={() => setLayout({ ...layout, c2: DEFAULT_LAYOUT.c2 })}
          />

          <div className="pane">
            <h3>{t('world.title')}</h3>
            <div className="worldstatus">
              {t('world.status', {
                clock: clockText(daytime(sim.world)),
                tick: daytime(sim.world),
                day: dayNumber(sim.world),
                weather: t(WEATHER_KEY[sim.world.weather]),
                difficulty: t(DIFF_KEY[sim.world.difficulty]),
                spawn: sim.world.spawn ? t('world.spawn', { pos: sim.world.spawn.join(', ') }) : '',
              })}
            </div>
            <div className="scroll">
              <table>
                <thead><tr><th>{t('world.entity')}</th><th>{t('world.position')}</th><th>{t('world.rot')}</th><th>{t('world.tags')}</th></tr></thead>
                <tbody>
                  {sim.world.entities.map((e) => (
                    <tr key={e.id} className={sel?.kind === 'entity' && sel.id === e.id ? 'selrow' : ''} onClick={() => setSel({ kind: 'entity', id: e.id })}>
                      <td>{e.handle && <b>{e.handle} </b>}{e.name ? <>"{e.name}" </> : null}<span className="muted">{e.type.replace('minecraft:', '')}</span></td>
                      <td>{fmtPos(e.pos)}</td>
                      <td>{fmtPos(e.rot)}</td>
                      <td>{[...e.tags].map((t) => <span className="tag" key={t}>{t}</span>)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <table>
                <thead><tr><th>{t('world.position')}</th><th>{t('world.type')}</th></tr></thead>
                <tbody>
                  {[...sim.world.blocks].map(([k, v]) => (
                    <tr key={k} className={sel?.kind === 'block' && sel.key === k ? 'selrow' : ''} onClick={() => setSel({ kind: 'block', key: k })}>
                      <td className="nowrap">{k.split(',').join(', ')}</td>
                      <td title={v.cb?.command ? `/${v.cb.command}` : undefined}>
                        {fmtBlock(v).replace('minecraft:', '')}
                        {v.cb && v.cb.command && <span className="muted"> : /{v.cb.command.length > 30 ? `${v.cb.command.slice(0, 30)}…` : v.cb.command}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <table>
                <thead><tr><th>{t('world.objective')}</th><th>{t('world.holder')}</th><th>{t('world.score')}</th></tr></thead>
                <tbody>
                  {[...sim.world.scores].flatMap(([obj, m]) =>
                    m.size === 0
                      ? [<tr key={obj}><td>{obj}</td><td className="muted">-</td><td /></tr>]
                      : [...m].map(([h, v]) => <tr key={`${obj}/${h}`}><td>{obj}</td><td>{holderName(sim.world, h)}</td><td>{v}</td></tr>),
                  )}
                </tbody>
              </table>
              <h3>{t('world.inspector')}</h3>
              <div style={{ padding: 8 }}><Inspector sim={sim} sel={sel} /></div>
            </div>
          </div>
        </div>

        {panel && (
          <>
            <Splitter
              dir="col"
              invert
              value={layout.drawer}
              min={MIN.drawer}
              measure={() => size(drawerRef.current, 'width')}
              max={() => size(rowRef.current, 'width') - SPLITTER - (MIN.c1 + MIN.c2 + 2 * SPLITTER + MIN_REST)}
              onChange={(drawer) => setLayout({ ...layout, drawer })}
              onReset={() => setLayout({ ...layout, drawer: DEFAULT_LAYOUT.drawer })}
            />
            <div className="drawer" ref={drawerRef} style={{ flex: `0 1 ${layout.drawer}px`, minWidth: MIN.drawer }}>
              <h3>{panel.title}<button className="close" onClick={() => setPanelId(null)}>x</button></h3>
              <div className="drawerbody">
                {panel.render({ sim, refresh, program, jump, testSelection: { unchecked: uncheckedTests, set: setUncheckedTests }, openAsNewDocument: files.newDocWithText, panelState: panelState.current, newSim: () => { const s = new Simulation(program); s.library = library.current; host.apply(s); return s; }, insertText: (t) => setText(`${text.replace(/\s*$/, '')}\n${t}\n`) })}
              </div>
            </div>
          </>
        )}
      </div>

      <Splitter
        dir="row"
        invert
        value={layout.term}
        min={MIN.term}
        measure={() => size(termRef.current, 'height')}
        max={() => size(docRef.current, 'height') - 220}
        onChange={(term) => setLayout({ ...layout, term })}
        onReset={() => setLayout({ ...layout, term: DEFAULT_LAYOUT.term })}
      />
      <div className="terminal" ref={termRef} style={{ height: layout.term, maxHeight: '60%' }}>
        <h3 style={{ margin: 0, padding: '4px 8px', fontSize: 12, background: '#252526', color: '#aaa' }}>{t('term.title')}</h3>
        <div className="scroll" ref={(el) => { if (el) el.scrollTop = el.scrollHeight; }}>
          {chats.map((c, i) =>
            c.type === 'screen' ? (
              <div key={i} className="chat system" onClick={() => jump(c.line)}>
                [{c.slot} to {c.to}]{c.text ? ' ' : ''}<McText text={c.text} />
              </div>
            ) : (
              <div key={i} className={`chat ${c.kind}`} onClick={() => jump(c.line)}>
                {c.kind === 'say' || c.to ? `${c.to ? `(to ${c.to}) ` : ''}${c.sender === null && c.to ? '' : `[${c.sender ?? '@'}] `}` : ''}
                <McText text={c.kind === 'system' || c.kind === 'error' ? gameText(c.text, lang) : c.text} />
              </div>
            ),
          )}
        </div>
        <div className="termin">
          <select value={execId} onChange={(e) => setExecId(e.target.value)} title={t('term.executorTip')}>
            <option value="">{t('term.console')}</option>
            {sim.world.entities.map((e) => <option key={e.id} value={e.id}>{e.handle ?? e.name ?? `${e.type}#${e.id}`}</option>)}
          </select>
          <input
            type="text"
            placeholder={t('term.placeholder')}
            value={termText}
            onChange={(e) => setTermText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitTerm();
              else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault();
                const r = (e.key === 'ArrowUp' ? older : newer)(termHist.current, termText);
                termHist.current = r.history;
                setTermText(r.text);
              }
            }}
          />
          <button onClick={submitTerm}>{t('term.send')}</button>
        </div>
      </div>
    </div>
  );
}