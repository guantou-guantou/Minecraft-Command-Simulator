import { useEffect, useRef, useState } from 'react';
import { useT } from './I18n.tsx';

interface Props {
  chains: string[];
  /** Names that are switched off; every other chain counts as checked, so new chains start checked. */
  unchecked: Set<string>;
  onChange: (unchecked: Set<string>) => void;
}

export function ChainPicker({ chains, unchecked, onChange }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const checked = chains.filter((c) => !unchecked.has(c));

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const toggle = (name: string) => {
    const next = new Set(unchecked);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    onChange(next);
  };

  return (
    <div className="chainpicker" ref={box}>
      <button className={open ? 'on' : ''} disabled={!chains.length} onClick={() => setOpen(!open)} title={t('chains.tip')}>
        {t('chains.button', { n: checked.length, total: chains.length })} {'\u25be'}
      </button>
      {open && (
        <div className="chainlist">
          <div className="chainbtns">
            <button onClick={() => onChange(new Set())}>{t('chains.all')}</button>
            <button onClick={() => onChange(new Set(chains.filter((c) => !unchecked.has(c))))}>{t('chains.invert')}</button>
          </div>
          {chains.map((c) => (
            <label key={c} className="chainitem">
              <input type="checkbox" checked={!unchecked.has(c)} onChange={() => toggle(c)} /> {c}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}