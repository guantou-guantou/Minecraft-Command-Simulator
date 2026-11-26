import { StateField, type Extension } from '@codemirror/state';
import { EditorView, hoverTooltip, showTooltip, type Tooltip } from '@codemirror/view';
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

const signatureField = StateField.define<Tooltip | null>({
  create: () => null,
  update(value, tr) {
    if (!tr.docChanged && !tr.selection) return value;
    const sel = tr.state.selection.main;
    if (!sel.empty) return null;
    const hint = hintAt(tr.state.doc.toString(), sel.head);
    if (!hint) return null;
    const line = tr.state.doc.lineAt(sel.head);
    return { pos: line.from, above: true, strictSide: true, arrow: false, create: () => ({ dom: renderHint(hint) }) };
  },
  provide: (f) => showTooltip.from(f),
});

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

export const hints: Extension = [signatureField, hover, EditorView.baseTheme({})];