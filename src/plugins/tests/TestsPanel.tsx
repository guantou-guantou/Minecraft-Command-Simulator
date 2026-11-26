import { useState } from 'react';
import { runTests, type TestResult } from '../../engine/testrun.ts';
import { useT } from '../../ui/I18n.tsx';
import type { PluginContext } from '../host.ts';

const EXAMPLE = `test counts:
    run main
    expect score alice n == 1
    expect tag @a has ready
    expect entity @e[type=fox] count 2
    expect block 0 64 0 gold_block
    expect chat contains "hello"
    expect particles >= 64`;

export function TestsPanel({ ctx }: { ctx: PluginContext }) {
  const t = useT();
  const [results, setResults] = useState<Record<string, TestResult>>({});
  const names = ctx.program.tests.map((x) => x.name);
  const { unchecked, set } = ctx.testSelection;
  const checked = names.filter((n) => !unchecked.has(n));

  const run = (only: ReadonlySet<string>) => {
    const list = runTests(ctx.program, () => ctx.newSim(), only);
    setResults((prev) => ({ ...prev, ...Object.fromEntries(list.map((r) => [r.name, r])) }));
  };
  const toggle = (name: string) => {
    const next = new Set(unchecked);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    set(next);
  };
  const shown = names.flatMap((n) => (results[n] ? [results[n]] : []));
  const passed = shown.filter((r) => r.passed).length;

  return (
    <div className="nx">
      <div className="nxrow">
        <button disabled={!names.length} onClick={() => run(new Set(names))}>{t('tests.run')}</button>
        <button disabled={!checked.length} onClick={() => run(new Set(checked))}>{t('tests.runChecked', { n: checked.length, total: names.length })}</button>
        <button disabled={!names.length} onClick={() => set(new Set())}>{t('tests.all')}</button>
        <button disabled={!names.length} onClick={() => set(new Set(names.filter((n) => !unchecked.has(n))))}>{t('tests.invert')}</button>
      </div>
      {shown.length > 0 && <div className="nxrow"><b className={passed === shown.length ? 'tests-ok' : 'tests-bad'}>{t('tests.summary', { passed, total: shown.length })}</b></div>}
      {!names.length && (
        <>
          <div className="muted">{t('tests.empty')}</div>
          <pre className="nxbox">{EXAMPLE}</pre>
        </>
      )}
      {ctx.program.tests.map((test) => {
        const r = results[test.name];
        return (
          <div key={test.name} className={`test-row ${r ? (r.passed ? 'ok' : 'bad') : ''}`}>
            <div className="test-head">
              <input type="checkbox" checked={!unchecked.has(test.name)} onChange={() => toggle(test.name)} />{' '}
              <span className="test-mark">{r ? (r.passed ? '\u2713' : '\u2717') : '\u00b7'}</span>
              <b onClick={() => ctx.jump(test.line)} style={{ cursor: 'pointer' }}>{test.name}</b>
              <span className="muted"> {r ? t('tests.checks', { n: r.checks }) : t('tests.notRun')}</span>{' '}
              <button title={t('tests.runOne')} onClick={() => run(new Set([test.name]))}>{'\u25b6'}</button>
            </div>
            {r?.failures.map((f, i) => (
              <div key={i} className="test-fail" onClick={() => ctx.jump(f.line)}>
                <span className="muted">{t('tests.line', { n: f.line })}</span> {f.message}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}