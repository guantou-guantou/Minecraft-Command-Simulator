import { useRef, useState, type KeyboardEvent } from 'react';
import { useT } from './I18n.tsx';

interface Props {
  dir: 'col' | 'row';
  value: number;
  min: number;
  max: () => number;
  /** Reads the size the panel really has right now; it can be smaller than alue when the window is narrow. */
  measure?: () => number;
  /** True when the sized panel is to the right of (or below) the splitter, so dragging left/up grows it. */
  invert?: boolean;
  onChange: (v: number) => void;
  onReset: () => void;
}

export function Splitter({ dir, value, min, max, measure, invert = false, onChange, onReset }: Props) {
  const t = useT();
  const start = useRef<{ pos: number; value: number } | null>(null);
  const [active, setActive] = useState(false);
  const limit = (v: number) => Math.max(min, Math.min(Math.max(min, max()), v));
  const pos = (e: { clientX: number; clientY: number }) => (dir === 'col' ? e.clientX : e.clientY);

  const onKey = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 40 : 10;
    const grow = dir === 'col' ? 'ArrowRight' : 'ArrowDown';
    const shrink = dir === 'col' ? 'ArrowLeft' : 'ArrowUp';
    if (e.key !== grow && e.key !== shrink) return;
    e.preventDefault();
    onChange(limit((measure?.() ?? value) + (e.key === grow ? step : -step) * (invert ? -1 : 1)));
  };

  return (
    <div
      className={`splitter ${dir}${active ? ' active' : ''}`}
      role="separator"
      aria-orientation={dir === 'col' ? 'vertical' : 'horizontal'}
      tabIndex={0}
      title={t('split.tip')}
      onDoubleClick={onReset}
      onKeyDown={onKey}
      onPointerDown={(e) => {
        start.current = { pos: pos(e), value: measure?.() ?? value };
        setActive(true);
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (!s) return;
        const delta = pos(e) - s.pos;
        onChange(limit(s.value + (invert ? -delta : delta)));
      }}
      onPointerUp={() => {
        start.current = null;
        setActive(false);
      }}
    />
  );
}