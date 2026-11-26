import { useCallback, useEffect, useRef, useState } from 'react';
import { createHost } from '../plugins/builtin.ts';
import { DocView, type FileActions, type ViewActions } from './DocView.tsx';
import { desktop, type DesktopApi } from './desktop.ts';
import {
  activate, activeDoc, addDoc, addScriptDoc, closeDoc, cycle, dirtyLabel, docName, initialDocs, isDirty, markSaved, moveDoc, openFile, setText,
  type Docs,
} from './docs.ts';
import { loadLayout, saveLayout, type Layout } from './layout.ts';
import { TabBar } from './TabBar.tsx';

const host = createHost();

const NEW_TEXT = '';

export function App() {
  if (!desktop) return <div style={{ padding: 24 }}>This program only runs inside the desktop app. / 请使用桌面程序打开。</div>;
  return <Workspace d={desktop} />;
}

function Workspace({ d }: { d: DesktopApi }) {
  const [s, setS] = useState<Docs>(() => initialDocs(''));
  const [layout, setLayoutState] = useState<Layout>(loadLayout);
  const sRef = useRef(s);
  sRef.current = s;
  const viewActions = useRef(new Map<number, ViewActions>());
  const active = activeDoc(s);

  const setLayout = useCallback((l: Layout) => {
    setLayoutState(l);
    saveLayout(l);
  }, []);

  useEffect(() => {
    void d.setState(dirtyLabel(s));
  }, [s, d]);

  const saveDoc = async (id: number, as = false): Promise<boolean> => {
    const doc = sRef.current.docs.find((x) => x.id === id);
    if (!doc) return false;
    const p = doc.path && !as ? await d.saveFile(doc.path, doc.text, doc.eol) : await d.saveAsDialog(doc.path ?? docName(doc), doc.text, doc.eol);
    if (!p) return false;
    const saved = doc.text;
    setS((prev) => markSaved(prev, id, p, saved));
    return true;
  };

  const closeTab = async (id: number) => {
    const doc = sRef.current.docs.find((x) => x.id === id);
    if (!doc) return;
    if (isDirty(doc) && !(await d.confirmDiscard(docName(doc)))) return;
    viewActions.current.delete(id);
    setS((prev) => closeDoc(prev, id, NEW_TEXT));
  };

  const openExternal = async (path: string) => {
    const f = await d.readFile(path);
    if (f) setS((prev) => openFile(prev, f));
  };

  const openFromDialog = async () => {
    const f = await d.openDialog();
    if (f) setS((prev) => openFile(prev, f));
  };

  const view = (k: keyof ViewActions) => () => viewActions.current.get(sRef.current.activeId)?.[k]();
  const actions: Record<string, () => void | Promise<unknown>> = {
    new: () => setS((prev) => addDoc(prev, NEW_TEXT)),
    open: openFromDialog,
    save: () => saveDoc(sRef.current.activeId),
    saveAs: () => saveDoc(sRef.current.activeId, true),
    closeTab: () => closeTab(sRef.current.activeId),
    nextTab: () => setS((prev) => cycle(prev, 1)),
    prevTab: () => setS((prev) => cycle(prev, -1)),
    run: view('run'),
    tick: view('tick'),
    tick20: view('tick20'),
    reset: view('reset'),
  };
  const latest = useRef({ actions, openExternal, saveDoc });
  latest.current = { actions, openExternal, saveDoc };

  useEffect(() => {
    const offs = [
      d.onMenu((a) => void latest.current.actions[a]?.()),
      d.onOpenRecent((p) => void latest.current.openExternal(p)),
      d.onOpenExternal((p) => void latest.current.openExternal(p)),
      d.onSaveAndClose(async () => {
        for (const doc of sRef.current.docs.filter(isDirty)) {
          if (!(await latest.current.saveDoc(doc.id))) return;
        }
        await d.forceClose();
      }),
    ];
    void d.launchFile().then((f) => f && setS((prev) => openFile(prev, f)));
    return () => offs.forEach((off) => off());
  }, [d]);

  const files: FileActions = {
    newDoc: () => void actions.new(),
    newDocWithText: (text) => setS((prev) => addScriptDoc(prev, text)),
    open: () => void actions.open(),
    save: () => void actions.save(),
    saveAs: () => void actions.saveAs(),
    exportText: (name, content) => void d.exportText(name, content),
  };

  const register = useCallback((id: number, a: ViewActions) => {
    viewActions.current.set(id, a);
  }, []);

  return (
    <div className="app">
      <TabBar
        docs={s.docs}
        activeId={active.id}
        onSelect={(id) => setS((prev) => activate(prev, id))}
        onClose={(id) => void closeTab(id)}
        onNew={() => void actions.new()}
        onMove={(id, to) => setS((prev) => moveDoc(prev, id, to))}
      />
      {s.docs.map((doc) => (
        <DocView
          key={doc.id}
          doc={doc}
          active={doc.id === active.id}
          host={host}
          layout={layout}
          setLayout={setLayout}
          setText={(text) => setS((prev) => setText(prev, doc.id, text))}
          files={files}
          register={register}
        />
      ))}
    </div>
  );
}