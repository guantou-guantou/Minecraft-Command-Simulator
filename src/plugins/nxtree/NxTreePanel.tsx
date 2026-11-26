import { useMemo, useState } from 'react';
import { useT } from '../../ui/I18n.tsx';
import type { Vec3 } from '../../language/types.ts';
import type { PluginContext } from '../host.ts';
import { wrapCommand } from '../../language/format.ts';
import { DEFAULT_SPEC, generate, verify, type NxSpec } from './core.ts';

const LIVE_LIMIT = 32768;
const PREVIEW_LIMIT = 4096;

function Num({ value, onChange, width = 56 }: { value: string; onChange: (v: string) => void; width?: number }) {
  return <input style={{ width }} value={value} onChange={(e) => onChange(e.target.value)} />;
}

function Triple({ label, value, onChange }: { label: string; value: [string, string, string]; onChange: (v: [string, string, string]) => void }) {
  return (
    <div className="nxrow">
      <span className="nxlabel">{label}</span>
      {value.map((v, i) => (
        <Num key={i} value={v} onChange={(x) => onChange(value.map((o, k) => (k === i ? x : o)) as [string, string, string])} />
      ))}
    </div>
  );
}

function Scatter({ points, axes, title }: { points: Vec3[]; axes: [number, number]; title: string }) {
  const shown = points.length > PREVIEW_LIMIT ? points.filter((_, i) => i % Math.ceil(points.length / PREVIEW_LIMIT) === 0) : points;
  const [a, b] = axes;
  const range = (i: number) => {
    const vs = points.map((p) => p[i]);
    const lo = Math.min(...vs);
    const hi = Math.max(...vs);
    return { lo, span: hi - lo || 1 };
  };
  const ra = range(a);
  const rb = range(b);
  const size = 150;
  const pad = 10;
  return (
    <div>
      <div className="muted">{title}</div>
      <svg width={size + 2 * pad} height={size + 2 * pad} className="scatter">
        {shown.map((p, i) => (
          <circle key={i} cx={pad + ((p[a] - ra.lo) / ra.span) * size} cy={pad + size - ((p[b] - rb.lo) / rb.span) * size} r={shown.length > 1000 ? 1 : 2.5} />
        ))}
      </svg>
    </div>
  );
}

export function NxTreePanel({ ctx }: { ctx: PluginContext }) {
  const t = useT();
  const [counts, setCounts] = useState<[string, string, string]>(DEFAULT_SPEC.counts.map(String) as [string, string, string]);
  const [spacing, setSpacing] = useState<[string, string, string]>(DEFAULT_SPEC.spacing.map(String) as [string, string, string]);
  const [center, setCenter] = useState<[string, string, string]>(DEFAULT_SPEC.center.map(String) as [string, string, string]);
  const [helper, setHelper] = useState<[string, string, string]>(DEFAULT_SPEC.helperPos.map(String) as [string, string, string]);
  const [yawTag, setYawTag] = useState(DEFAULT_SPEC.yawTag);
  const [pitchTag, setPitchTag] = useState(DEFAULT_SPEC.pitchTag);
  const [action, setAction] = useState(DEFAULT_SPEC.action);
  const [split, setSplit] = useState(true);

  const result = useMemo(() => {
    const nums = (t: string[]) => t.map((x) => (x.trim() === '' ? NaN : Number(x)));
    const parsed = { counts: nums(counts), spacing: nums(spacing), center: nums(center), helper: nums(helper) };
    if (Object.values(parsed).some((v) => v.some((n) => !Number.isFinite(n)))) return { error: 'Every number field needs a valid number' } as const;
    const spec: NxSpec = {
      counts: parsed.counts as Vec3, spacing: parsed.spacing as Vec3, center: parsed.center as Vec3,
      helperPos: parsed.helper as Vec3, yawTag, pitchTag, action,
    };
    try {
      const total = spec.counts[0] * spec.counts[1] * spec.counts[2];
      return { spec, total, ...verifyOrSkip(spec, total) } as const;
    } catch (e) {
      return { error: (e as Error).message } as const;
    }
  }, [counts, spacing, center, helper, yawTag, pitchTag, action]);

  if ('error' in result) return <div className="nxerr">{result.error}</div>;
  const { generated, analysis, skipped } = result;
  const ok = analysis && analysis.problems.length === 0 && analysis.matchesGrid;

  return (
    <div className="nx">
      <Triple label={t('nx.points')} value={counts} onChange={setCounts} />
      <Triple label={t('nx.spacing')} value={spacing} onChange={setSpacing} />
      <Triple label={t('nx.center')} value={center} onChange={setCenter} />
      <Triple label={t('nx.helperAt')} value={helper} onChange={setHelper} />
      <div className="nxrow">
        <span className="nxlabel">{t('nx.tags')}</span>
        <Num value={yawTag} onChange={setYawTag} />
        <Num value={pitchTag} onChange={setPitchTag} />
      </div>
      <div className="nxrow">
        <span className="nxlabel">{t('nx.action')}</span>
        <input style={{ flex: 1 }} value={action} onChange={(e) => setAction(e.target.value)} />
      </div>

      <div className={`nxstatus ${skipped ? 'warn' : ok ? 'ok' : 'bad'}`}>
        {skipped
          ? t('nx.tooMany', { n: result.total, limit: LIVE_LIMIT })
          : ok
            ? t('nx.ok', { branches: analysis!.branches, unique: analysis!.unique })
            : analysis!.problems.map((p, i) => <div key={i}>{p}</div>)}
      </div>
      {analysis && (
        <div className="muted">
          bounds {analysis.min?.join(', ') ?? '-'} .. {analysis.max?.join(', ') ?? '-'} | verified in the simulator, not on the target game version
        </div>
      )}

      <div className="nxhead">{t('nx.command')}</div>
      <textarea className="nxbox" readOnly value={`/${generated.command}`} rows={5} />
      <div className="nxrow">
        <button onClick={() => ctx.insertText(split ? wrapCommand(`/${generated.command}`, 100).join('\n') : `/${generated.command}`)}>{t('nx.insertCommand')}</button>
        <label><input type="checkbox" checked={split} onChange={(e) => setSplit(e.target.checked)} /> {t('nx.split')}</label>
        <button onClick={() => navigator.clipboard?.writeText(generated.command)}>{t('nx.copy')}</button>
      </div>
      <div className="nxhead">{t('nx.helpers')}</div>
      <textarea className="nxbox" readOnly value={generated.entities} rows={4} />
      <div className="nxrow">
        <button onClick={() => ctx.insertText(generated.entities)}>{t('nx.insertEntities')}</button>
      </div>

      <div className="nxhead">{t('nx.levels')}</div>
      <table>
        <thead><tr><th>#</th><th>{t('nx.axis')}</th><th>{t('nx.step')}</th></tr></thead>
        <tbody>{generated.levels.map((l, i) => <tr key={i}><td>{i + 1}</td><td>{l.axis}</td><td>{l.step}</td></tr>)}</tbody>
      </table>

      {analysis && analysis.points.length > 0 && (
        <>
          <div className="nxhead">Preview{analysis.points.length > PREVIEW_LIMIT ? ` (sampled to ${PREVIEW_LIMIT})` : ''}</div>
          <div className="nxrow">
            <Scatter points={analysis.points} axes={[0, 2]} title={t('nx.top')} />
            <Scatter points={analysis.points} axes={[0, 1]} title={t('nx.side')} />
          </div>
        </>
      )}
    </div>
  );
}

function verifyOrSkip(spec: NxSpec, total: number) {
  if (total > LIVE_LIMIT) return { generated: generate(spec), analysis: null, skipped: true };
  const { generated, analysis } = verify(spec);
  return { generated, analysis, skipped: false };
}
