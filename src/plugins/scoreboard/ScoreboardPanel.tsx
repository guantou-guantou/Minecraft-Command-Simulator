import { holderName } from '../../engine/scoreboard.ts';
import { useT } from '../../ui/I18n.tsx';
import type { PluginContext } from '../host.ts';

export function ScoreboardPanel({ ctx }: { ctx: PluginContext }) {
  const t = useT();
  const world = ctx.sim.world;
  const rows = (name: string, order: string) => {
    const sorted = [...(world.scores.get(name) ?? [])].sort((a, b) => (order === 'ascending' ? a[1] - b[1] : b[1] - a[1]));
    return sorted.map(([key, v]) => <div key={key} className="nxrow"><span>{holderName(world, key)}</span> <b>{v}</b></div>);
  };
  const shown = ['sidebar', 'list', 'belowname'].flatMap((slot) => (world.scoreDisplay[slot] ? [{ slot, ...world.scoreDisplay[slot]! }] : []));
  const names = [...world.scores.keys()];
  return (
    <div className="nx">
      {!names.length && <div className="muted">{t('score.empty')}</div>}
      {shown.map((d) => (
        <div key={d.slot} className="nxbox">
          <b>{d.slot}: {world.objectiveNames.get(d.objective) ?? d.objective}</b>
          {rows(d.objective, d.order)}
        </div>
      ))}
      {names.filter((n) => !shown.some((d) => d.objective === n)).map((n) => (
        <div key={n} className="nxbox">
          <b>{world.objectiveNames.get(n) ?? n}</b> <span className="muted">({t('score.hidden')})</span>
          {rows(n, 'descending')}
        </div>
      ))}
    </div>
  );
}