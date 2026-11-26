import { useEffect, useRef, type RefObject } from 'react';
import { Annotation, Compartment, EditorState, Prec, RangeSet, RangeSetBuilder, StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, GutterMarker, drawSelection, gutterLineClass, keymap, lineNumbers, type DecorationSet, type ViewUpdate, ViewPlugin } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentLess, indentMore } from '@codemirror/commands';
import { indentUnit } from '@codemirror/language';
import { acceptCompletion, autocompletion, startCompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { complete, type Candidate, type Scene } from '../language/complete.ts';
import { stripComment } from '../language/lines.ts';
import { toggleComment } from './editing.ts';
import { hints } from './hints.ts';
import { analyzeDoc, lineSpans, type LineInfo } from './highlight.ts';
import { useLang } from './I18n.tsx';

const INDENT = '    ';
const HISTORY_KEY = 'mcsim:complete-history';

export interface EditorHandle {
  view: EditorView | null;
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  errLines: Set<number>;
  /** Exact places to underline (syntax errors). */
  spans?: { from: number; to: number }[];
  curLine: number;
  editorRef: RefObject<EditorHandle | null>;
  wrap: boolean;
  eol: boolean;
  scene: Scene;
  extra?: Extension;
}

const External = Annotation.define<boolean>();
const NO_SPANS: { from: number; to: number }[] = [];

function loadHistory(): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '{}') as Record<string, unknown>;
    return Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === 'number')) as Record<string, number>;
  } catch {
    return {};
  }
}

function saveHistory(h: Record<string, number>): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(h));
  } catch {
    /* the history is only an ordering hint */
  }
}

const analysisCache = new WeakMap<object, LineInfo[]>();
export function analysisOf(state: EditorState): LineInfo[] {
  let a = analysisCache.get(state.doc);
  if (!a) {
    a = analyzeDoc(state.doc.toString());
    analysisCache.set(state.doc, a);
  }
  return a;
}

const highlighter = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged) this.decorations = this.build(u.view);
    }
    build(view: EditorView): DecorationSet {
      const b = new RangeSetBuilder<Decoration>();
      const info = analysisOf(view.state);
      for (let n = 1; n <= view.state.doc.lines; n++) {
        const line = view.state.doc.line(n);
        for (const s of lineSpans(line.text, info[n - 1])) b.add(line.from + s.from, line.from + s.to, Decoration.mark({ class: s.cls }));
      }
      return b.finish();
    }
  },
  { decorations: (v) => v.decorations },
);

interface Marks {
  err: Set<number>;
  cur: number;
  spans: { from: number; to: number }[];
}
const setMarks = StateEffect.define<Marks>();
const marksField = StateField.define<Marks>({
  create: () => ({ err: new Set(), cur: 0, spans: [] }),
  update: (v, tr) => {
    for (const e of tr.effects) if (e.is(setMarks)) return e.value;
    return v;
  },
});

class ClassMarker extends GutterMarker {
  cls: string;
  elementClass: string;
  constructor(cls: string) {
    super();
    this.cls = cls;
    this.elementClass = cls;
  }
  eq(o: GutterMarker) {
    return o instanceof ClassMarker && o.cls === this.cls;
  }
}
const errMarker = new ClassMarker('cm-err-num');
const curMarker = new ClassMarker('cm-cur-num');

const markDecorations = EditorView.decorations.compute([marksField, 'doc'], (state) => {
  const { err, spans } = state.field(marksField);
  const info = analysisOf(state);
  const ranges = [];
  for (let n = 1; n <= state.doc.lines; n++) {
    const i = info[n - 1];
    if (err.has(i.logical) && !i.continued) ranges.push(Decoration.line({ class: 'cm-errline' }).range(state.doc.line(n).from));
  }
  for (const s of spans) {
    if (s.from >= 0 && s.to <= state.doc.length && s.to > s.from) ranges.push(Decoration.mark({ class: 'cm-diag' }).range(s.from, s.to));
  }
  return Decoration.set(ranges, true);
});

const markGutter = gutterLineClass.compute([marksField, 'doc'], (state) => {
  const { err, cur } = state.field(marksField);
  const info = analysisOf(state);
  const ranges = [];
  for (let n = 1; n <= state.doc.lines; n++) {
    const i = info[n - 1];
    if (i.continued) continue;
    const m = err.has(i.logical) ? errMarker : i.logical === cur ? curMarker : null;
    if (m) ranges.push(m.range(state.doc.line(n).from));
  }
  return RangeSet.of(ranges);
});

const numberCache = new WeakMap<object, string[]>();
function numbersFor(state: EditorState): string[] {
  let a = numberCache.get(state.doc);
  if (!a) {
    a = analysisOf(state).map((i) => (i.number ? String(i.number) : ''));
    numberCache.set(state.doc, a);
  }
  return a;
}

const theme = EditorView.theme(
  {
    '&': { height: '100%', backgroundColor: '#1e1e1e', color: '#d4d4d4', fontSize: '13px' },
    '.cm-scroller': { fontFamily: 'Consolas, "Courier New", monospace', lineHeight: '18px', overflow: 'auto' },
    '.cm-content': { caretColor: '#fff', padding: '4px 0 24px' },
    '.cm-line': { padding: '0 8px' },
    '.cm-gutters': { backgroundColor: '#1b1b1b', color: '#777', border: 'none', borderRight: '1px solid #2a2a2a' },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 12px', minWidth: '34px' },
    '&.cm-focused': { outline: 'none' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: '#264f78aa !important' },
    '.cm-cursor': { borderLeftColor: '#fff' },
    '.cm-tooltip': { backgroundColor: '#252526', border: '1px solid #454545', color: '#d4d4d4' },
    '.cm-tooltip-autocomplete ul': { fontFamily: 'Consolas, "Courier New", monospace', fontSize: '12px' },
    '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: '#04395e', color: '#fff' },
    '.cm-completionDetail': { color: '#888', marginLeft: '12px', fontStyle: 'normal' },
    '.cm-panels': { backgroundColor: '#252526', color: '#d4d4d4' },
    '.cm-panels input, .cm-panels button': { fontSize: '12px' },
    '.cm-searchMatch': { backgroundColor: '#515c6a88' },
    '.cm-searchMatch-selected': { backgroundColor: '#a8ac9455' },
  },
  { dark: true },
);

const ZH_PHRASES: Record<string, string> = {
  Find: '查找', Replace: '替换', next: '下一个', previous: '上一个', all: '全部', 'match case': '区分大小写', regexp: '正则', 'by word': '全字匹配',
  replace: '替换', 'replace all': '全部替换', close: '关闭', 'Go to line': '跳到行', go: '跳转',
};

const TYPE_OF: Record<Candidate['kind'], string> = { command: 'function', keyword: 'keyword', value: 'constant', variable: 'variable', param: 'property' };

export function CodeEditor({ value, onChange, errLines, spans = NO_SPANS, curLine, editorRef, wrap, eol, scene, extra }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const live = useRef({ onChange, scene });
  live.current = { onChange, scene };
  const history$ = useRef<Record<string, number>>(loadHistory());
  const wrapC = useRef(new Compartment());
  const langC = useRef(new Compartment());
  const [lang] = useLang();

  useEffect(() => {
    const source = (ctx: CompletionContext): CompletionResult | null => {
      const text = ctx.state.doc.toString();
      const r = complete(text, ctx.pos, { ...live.current.scene, history: history$.current });
      if (!r.items.length) return null;
      const lineStart = text.lastIndexOf('\n', ctx.pos - 1) + 1;
      const lineEmpty = text.slice(lineStart, r.to).trim() === '';
      const typed = text.slice(ctx.pos - 1, ctx.pos);
      if (!ctx.explicit && r.from === r.to && (lineEmpty || ![' ', '(', '[', ',', '=', '/'].includes(typed))) return null;
      if (!ctx.explicit && r.items.length === 1 && text.slice(r.from, r.to) === r.items[0].label) return null;
      return {
        from: r.from,
        to: r.to,
        filter: false,
        options: r.items.map((it): Completion => ({
          label: it.label,
          detail: it.detail,
          type: TYPE_OF[it.kind],
          apply: (v, _c, from, to) => {
            history$.current[it.label] = (history$.current[it.label] ?? 0) + 1;
            saveHistory(history$.current);
            v.dispatch({ changes: { from, to, insert: it.insert }, selection: { anchor: from + it.insert.length }, userEvent: 'input.complete' });
            setTimeout(() => startCompletion(v), 0);
          },
        })),
      };
    };

    const smartEnter = (v: EditorView): boolean => {
      const { state } = v;
      const sel = state.selection.main;
      const line = state.doc.lineAt(sel.from);
      const before = line.text.slice(0, sel.from - line.from);
      const indent = /^[ \t]*/.exec(before)![0];
      const code = before.replace(/(^|\s)#.*$/, '').trimEnd();
      const insert = `\n${indent}${code.endsWith(':') ? INDENT : ''}`;
      v.dispatch({ changes: { from: sel.from, to: sel.to, insert }, selection: { anchor: sel.from + insert.length }, userEvent: 'input' });
      return true;
    };

    const continuation = (v: EditorView): boolean => {
      const { state } = v;
      const sel = state.selection.main;
      const line = state.doc.lineAt(sel.from);
      const before = line.text.slice(0, sel.from - line.from);
      const indent = /^[ \t]*/.exec(before)![0];
      const prev = line.number > 1 ? state.doc.line(line.number - 1).text : '';
      const continued = stripComment(prev).trimEnd().endsWith('\\');
      const insert = `${before.endsWith(' ') ? '\\' : ' \\'}\n${indent}${continued ? '' : INDENT}`;
      v.dispatch({ changes: { from: sel.from, to: sel.to, insert }, selection: { anchor: sel.from + insert.length }, userEvent: 'input' });
      return true;
    };

    const tab = (v: EditorView): boolean => {
      const sel = v.state.selection.main;
      const multi = v.state.doc.lineAt(sel.from).number !== v.state.doc.lineAt(sel.to).number;
      if (multi) return indentMore(v);
      const line = v.state.doc.lineAt(sel.from);
      const col = sel.from - line.from;
      const spaces = ' '.repeat(INDENT.length - (col % INDENT.length));
      v.dispatch({ changes: { from: sel.from, to: sel.to, insert: spaces }, selection: { anchor: sel.from + spaces.length }, userEvent: 'input' });
      return true;
    };

    const comment = (v: EditorView): boolean => {
      const sel = v.state.selection.main;
      const e = toggleComment(v.state.doc.toString(), sel.from, sel.to);
      if (!e) return true;
      v.dispatch({ changes: { from: e.from, to: e.to, insert: e.text }, selection: { anchor: e.selStart, head: e.selEnd }, userEvent: 'input' });
      return true;
    };

    const state = EditorState.create({
      doc: value,
      extensions: [
        theme,
        lineNumbers({ formatNumber: (n, s) => numbersFor(s)[n - 1] ?? '' }),
        history(),
        drawSelection(),
        indentUnit.of(INDENT),
        EditorState.tabSize.of(4),
        marksField,
        markDecorations,
        markGutter,
        highlighter,
        highlightSelectionMatches(),
        hints,
        search({ top: true }),
        wrapC.current.of(wrap ? EditorView.lineWrapping : []),
        langC.current.of(EditorState.phrases.of(lang === 'zh' ? ZH_PHRASES : {})),
        autocompletion({ override: [source], activateOnTyping: true, closeOnBlur: true, icons: false, maxRenderedOptions: 12 }),
        Prec.high(
          keymap.of([
            { key: 'Tab', run: acceptCompletion },
            { key: 'Mod-/', run: comment },
            { key: 'Shift-Enter', run: continuation },
            { key: 'Enter', run: smartEnter },
            { key: 'Tab', run: tab },
            { key: 'Shift-Tab', run: indentLess },
          ]),
        ),
        keymap.of([...searchKeymap, ...historyKeymap, ...defaultKeymap]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged && !u.transactions.some((t) => t.annotation(External))) live.current.onChange(u.state.doc.toString());
        }),
        extra ?? [],
      ],
    });
    const v = new EditorView({ state, parent: host.current! });
    (v.dom as unknown as { cmView: EditorView }).cmView = v;
    editorRef.current = { view: v };
    return () => {
      v.destroy();
      editorRef.current = { view: null };
    };
    // The editor is created once; props are pushed in through the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const v = editorRef.current?.view;
    if (!v || v.state.doc.toString() === value) return;
    const head = Math.min(v.state.selection.main.head, value.length);
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value }, selection: { anchor: head }, annotations: External.of(true) });
  }, [value, editorRef]);

  useEffect(() => {
    editorRef.current?.view?.dispatch({ effects: setMarks.of({ err: errLines, cur: curLine, spans }) });
  }, [errLines, spans, curLine, value, editorRef]);

  useEffect(() => {
    editorRef.current?.view?.dispatch({ effects: wrapC.current.reconfigure(wrap ? EditorView.lineWrapping : []) });
  }, [wrap, editorRef]);

  useEffect(() => {
    editorRef.current?.view?.dispatch({ effects: langC.current.reconfigure(EditorState.phrases.of(lang === 'zh' ? ZH_PHRASES : {})) });
  }, [lang, editorRef]);

  return <div className={`editor${eol ? ' eol' : ''}`} ref={host} />;
}