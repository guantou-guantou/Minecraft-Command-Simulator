import { useState } from 'react';
import { useLang, useT } from './I18n.tsx';
import type { Lang } from './i18n.ts';
import { docName, isDirty, type Doc } from './docs.ts';

interface Props {
  docs: Doc[];
  activeId: number;
  onSelect: (id: number) => void;
  onClose: (id: number) => void;
  onNew: () => void;
  onMove: (id: number, toIndex: number) => void;
}

export function TabBar({ docs, activeId, onSelect, onClose, onNew, onMove }: Props) {
  const t = useT();
  const [lang, setLang] = useLang();
  const [dragId, setDragId] = useState<number | null>(null);
  const [overId, setOverId] = useState<number | null>(null);
  return (
    <div className="tabbar" role="tablist">
      {docs.map((d, i) => (
        <div
          key={d.id}
          role="tab"
          aria-selected={d.id === activeId}
          className={`tab${d.id === activeId ? ' on' : ''}${overId === d.id && dragId !== d.id ? ' over' : ''}`}
          title={d.path ?? docName(d)}
          draggable
          onClick={() => onSelect(d.id)}
          onAuxClick={(e) => {
            if (e.button === 1) {
              e.preventDefault();
              onClose(d.id);
            }
          }}
          onDragStart={(e) => {
            setDragId(d.id);
            e.dataTransfer.effectAllowed = 'move';
          }}
          onDragOver={(e) => {
            if (dragId === null) return;
            e.preventDefault();
            setOverId(d.id);
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (dragId !== null && dragId !== d.id) onMove(dragId, i);
            setDragId(null);
            setOverId(null);
          }}
          onDragEnd={() => {
            setDragId(null);
            setOverId(null);
          }}
        >
          <span className="tabname">{docName(d)}</span>
          {isDirty(d) && <span className="dot" title={t('tab.unsaved')}>●</span>}
          <button
            className="tabclose"
            title={t('tab.close')}
            onClick={(e) => {
              e.stopPropagation();
              onClose(d.id);
            }}
          >
            x
          </button>
        </div>
      ))}
      <button className="tabnew" title={t('tab.new')} onClick={onNew}>+</button>
      <select className="langsel" title={t('lang.title')} value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
        <option value="en">English</option>
        <option value="zh">中文</option>
      </select>
    </div>
  );
}