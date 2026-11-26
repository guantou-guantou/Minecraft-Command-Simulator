import { EditorState, Prec, StateEffect, StateField, type Extension } from '@codemirror/state';
import { EditorView, hoverTooltip, keymap, showPanel, showTooltip, type Panel, type Tooltip } from '@codemirror/view';
import { explainAt, hintAt, type Hint } from '../language/hint.ts';

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function renderHint(h: Hint): HTMLElement {
  const box = el('div', 'cm-hint');
  if (h.kind === 'command') {
    for (const { sig, active } of h.hint.sigs) {
      const row = el('div', 'cm-hint-row');
      row.appendChild(el('span', 'cm-hint-slash', '/'));
      sig.forEach((p, i) => {
        const span = el('span', i === active ? 'cm-hint-active' : p.arg ? 'cm-hint-arg' : 'cm-hint-lit', p.optional ? `[${p.text}]` : p.text);
        row.appendChild(span);
        if (i < sig.length - 1) row.appendChild(document.createTextNode(' '));
      });
      box.appendChild(row);
    }
  } else {
    const row = el('div', 'cm-hint-row');
    row.appendChild(el('span', 'cm-hint-lit', `${h.hint.name}(`));
    h.hint.keys.forEach((k, i) => {
      row.appendChild(el('span', k === h.hint.current ? 'cm-hint-active' : 'cm-hint-arg', k));
      if (i < h.hint.keys.length - 1) row.appendChild(document.createTextNode(', '));
    });
    row.appendChild(el('span', 'cm-hint-lit', ')'));
    box.appendChild(row);
  }
  return box;
}

export type HintMode = 'bar' | 'float' | 'off';
const MODE_KEY = 'mcsim:hintMode';

export function loadHintMode(): HintMode {
  try {
    const v = localStorage.getItem(MODE_KEY);
    return v === 'float' || v === 'off' ? v : 'bar';
  } catch {
    return 'bar';
  }
}

export function saveHintMode(m: HintMode): void {
  try {
    localStorage.setItem(MODE_KEY, m);
  } catch {
    /* the setting is only a convenience */
  }
}

/** Press Escape to hide the hint until the cursor moves; Ctrl+Shift+Space shows it again. */
const dismissHint = StateEffect.define<boolean>();

const hintField = StateField.define<Hint | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(dismissHint)) return e.value ? null : currentHint(tr.state);
    }
    if (!tr.docChanged && !tr.selection) return value;
    return currentHint(tr.state);
  },
});

function currentHint(state: EditorState): Hint | null {
  const sel = state.selection.main;
  return sel.empty ? hintAt(state.doc.toString(), sel.head) : null;
}

const floatTooltip = showTooltip.compute([hintField], (state): Tooltip | null => {
  const hint = state.field(hintField);
  if (!hint) return null;
  return { pos: state.doc.lineAt(state.selection.main.head).from, above: true, strictSide: true, arrow: false, create: () => ({ dom: renderHint(hint) }) };
});

/** A fixed strip under the editor: it never covers code, and its height only changes with the number of usages. */
const hintBar = showPanel.of((view: EditorView): Panel => {
  const dom = el('div', 'cm-hintbar');
  let shown: Hint | null | undefined;
  const paint = (h: Hint | null) => {
    if (h === shown) return;
    shown = h;
    dom.replaceChildren(h ? renderHint(h) : el('div', 'cm-hint cm-hint-idle', ''));
  };
  paint(view.state.field(hintField));
  return { dom, update: (u) => paint(u.state.field(hintField)) };
});

export const hintModeExtension = (mode: HintMode): Extension => (mode === 'float' ? floatTooltip : mode === 'bar' ? hintBar : []);

const hintKeys = Prec.low(
  keymap.of([
    { key: 'Escape', run: (view) => (view.state.field(hintField) ? (view.dispatch({ effects: dismissHint.of(true) }), true) : false) },
    { key: 'Ctrl-Shift-Space', run: (view) => (view.dispatch({ effects: dismissHint.of(false) }), true) },
  ]),
);
const hover = hoverTooltip(
  (view, pos) => {
    const line = view.state.doc.lineAt(pos);
    const info = explainAt(line.text, pos - line.from, view.state.doc.toString());
    if (!info) return null;
    return {
      pos: line.from + info.from,
      end: line.from + info.to,
      above: true,
      create() {
        const dom = el('div', 'cm-hint');
        info.lines.forEach((t, i) => dom.appendChild(el('div', i === 0 ? 'cm-hint-title' : 'cm-hint-row', t)));
        return { dom };
      },
    };
  },
  { hideOnChange: true },
);

export const hints: Extension = [hintField, hover, hintKeys, EditorView.baseTheme({})];