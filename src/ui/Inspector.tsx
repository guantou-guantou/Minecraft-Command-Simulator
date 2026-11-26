import { useState } from 'react';
import { useT } from './I18n.tsx';
import { fmtValue } from '../engine/molang.ts';
import { CONTAINER_SIZE, fmtItem, slotKey, type Inventory, type Item } from '../language/items.ts';
import type { Simulation } from '../engine/simulation.ts';
import { label } from '../engine/types.ts';

export type Selection = { kind: 'entity'; id: number } | { kind: 'block'; key: string } | null;

function Cell({ item, title, selected }: { item?: Item; title: string; selected?: boolean }) {
  const name = item?.id.replace(/^minecraft:/, '') ?? '';
  return (
    <div className={`cell${item ? ' filled' : ''}${selected ? ' sel' : ''}`} title={item ? `${title}: ${fmtItem(item)}${Object.keys(item.components).length ? ` ${JSON.stringify(item.components)}` : ''}` : title}>
      <span className="cname">{name.slice(0, 9)}</span>
      {item && item.count > 1 && <span className="ccount">{item.count}</span>}
    </div>
  );
}

function Grid({ title, inv, slot, size, cols, selected }: { title: string; inv: Inventory; slot: string; size: number; cols: number; selected?: number }) {
  return (
    <div className="invsec">
      <div className="muted">{title}</div>
      <div className="grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        {Array.from({ length: size }, (_, i) => (
          <Cell key={i} item={inv[slotKey(slot, i)]} title={`${slot} ${i}`} selected={i === selected} />
        ))}
      </div>
    </div>
  );
}

function MolangSection({ e }: { e: import('../engine/types.ts').Entity }) {
  const t = useT();
  const [filter, setFilter] = useState('');
  const vars = Object.entries(e.molang).filter(([k]) => k.includes(filter.toLowerCase()));
  const anims = Object.entries(e.anims);
  if (!vars.length && !anims.length) return null;
  return (
    <div className="invsec">
      <div className="muted">{t('insp.molang', { vars: vars.length, anims: anims.length })}</div>
      {anims.map(([k, a]) => <div key={k} className="muted">{k}: {a.animation}</div>)}
      <input style={{ width: 140 }} placeholder={t('insp.filter')} value={filter} onChange={(ev) => setFilter(ev.target.value)} />
      <table>
        <tbody>{vars.map(([k, v]) => <tr key={k}><td>v.{k}</td><td>{fmtValue(v)}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

export function Inspector({ sim, sel }: { sim: Simulation; sel: Selection }) {
  const t = useT();
  if (!sel) return <div className="muted">{t('insp.hint')}</div>;
  if (sel.kind === 'entity') {
    const e = sim.world.entities.find((x) => x.id === sel.id);
    if (!e) return <div className="muted">{t('insp.noEntity')}</div>;
    const player = e.type === 'minecraft:player';
    return (
      <div>
        <div className="insphead"><b>{label(e)}</b> {e.handle && <span className="muted">handle {e.handle}</span>}</div>
        {e.maxHealth > 0 && <div className="muted">{t('insp.health', { hp: String(Math.round(e.health * 100) / 100), max: String(e.maxHealth) })}</div>}
        {e.type === 'minecraft:player' && (
          <div className="muted">
            {t('insp.player', { mode: e.gamemode, level: e.xpLevel, points: e.xpPoints, off: Object.entries(e.inputs).filter(([, v]) => v === 'disabled').map(([k]) => ` / ${k} off`).join('') })}
          </div>
        )}
        <MolangSection e={e} />
        {Object.keys(e.effects).length > 0 && (
          <div className="invsec">
            <div className="muted">{t('insp.effects')}</div>
            {Object.entries(e.effects).map(([id, fx]) => (
              <div key={id}>{id} <span className="muted">amplifier {fx.amplifier}, {fx.ticks === null ? 'infinite' : `${(fx.ticks / 20).toFixed(2)}s left`}{fx.hideParticles ? ', particles hidden' : ''}</span></div>
            ))}
          </div>
        )}
        {player ? (
          <>
            <Grid title={t('insp.hotbar')} inv={e.items} slot="slot.hotbar" size={9} cols={9} selected={e.selected} />
            <Grid title={t('insp.inventory')} inv={e.items} slot="slot.inventory" size={27} cols={9} />
            <Grid title={t('insp.ender')} inv={e.items} slot="slot.enderchest" size={27} cols={9} />
          </>
        ) : null}
        <div className="invsec">
          <div className="muted">{t('insp.equipment')}</div>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
            {['slot.armor.head', 'slot.armor.chest', 'slot.armor.legs', 'slot.armor.feet', 'slot.armor.body', 'slot.weapon.mainhand', 'slot.weapon.offhand'].map((s) => (
              <Cell key={s} item={e.items[slotKey(s, 0)] ?? (player && s === 'slot.weapon.mainhand' ? e.items[slotKey('slot.hotbar', e.selected)] : undefined)} title={s} />
            ))}
          </div>
        </div>
      </div>
    );
  }
  const b = sim.world.blocks.get(sel.key);
  if (!b) return <div className="muted">{t('insp.noBlock')}</div>;
  const size = CONTAINER_SIZE[b.id];
  return (
    <div>
      <div className="insphead"><b>{b.id.replace('minecraft:', '')}</b> <span className="muted">({sel.key.split(',').join(', ')})</span></div>
      {b.cb && (
        <div className="invsec">
          <div className="muted">{t('insp.commandBlock')}</div>
          <div>/{b.cb.command || '(empty)'} <span className="muted">delay {b.cb.delay}, {b.cb.power}, line {b.cb.line}</span></div>
        </div>
      )}
      {size !== undefined ? (
        <Grid title={t('insp.container')} inv={b.items ?? {}} slot="slot.container" size={size} cols={size === 5 ? 5 : size === 9 ? 3 : 9} />
      ) : null}
      {Object.keys(b.states).length > 0 && <div className="muted">{JSON.stringify(b.states)}</div>}
    </div>
  );
}
