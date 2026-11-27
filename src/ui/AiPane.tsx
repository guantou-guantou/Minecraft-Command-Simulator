import { useEffect, useMemo, useRef, useState } from 'react';
import { checkChange, diffLines, splitReply, type ChangeCheck } from '../ai/blocks.ts';
import { buildRequest, type ChatMessage, type Quote } from '../ai/messages.ts';
import { buildSystemPrompt } from '../ai/prompt.ts';
import { desktop, type AiSettings } from './desktop.ts';
import { isChatDirty, type ChatState } from './docs.ts';
import { useLang, useT } from './I18n.tsx';

export interface ChatApi {
  chat: ChatState;
  set(messages: ChatMessage[]): void;
  save(): Promise<boolean>;
  saveAs(): Promise<boolean>;
  open(): Promise<void>;
}

/** What the pane needs from the editor it sits next to. */
export interface AiHost {
  scriptText: string;
  /** The selected lines, or null when nothing is selected. */
  selection(): Quote | null;
  /** The selection (or the cursor, when from equals to) as offsets in the script. */
  range(): { from: number; to: number };
  replace(from: number, to: number, text: string): void;
  diagnostics: { line: number; message: string }[];
  /** Moves to a line of the editor (1-based) and selects it. */
  goto(line: number): void;
}

interface Pending {
  code: string;
  from: number;
  to: number;
  base: string;
  check: ChangeCheck;
  old: string;
  replacement: string;
}

const short = (s: string) => (s.length > 40 ? `${s.slice(0, 40)}...` : s).replace(/\s+/g, ' ');

export function AiPane({ host, chatApi }: { host: AiHost; chatApi: ChatApi }) {
  const t = useT();
  const [lang] = useLang();
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [form, setForm] = useState({ enabled: false, baseUrl: '', model: '', includeScript: true, key: '' });
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [input, setInput] = useState('');
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [stream, setStream] = useState<{ id: string; text: string } | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [, bump] = useState(0);
  const live = useRef({ chatApi, stream, testId: '' });
  live.current = { chatApi, stream, testId: live.current.testId };
  const listEnd = useRef<HTMLDivElement>(null);

  const load = (s: AiSettings) => {
    setSettings(s);
    setForm({ enabled: s.enabled, baseUrl: s.baseUrl, model: s.model, includeScript: s.includeScript, key: '' });
  };
  useEffect(() => {
    void desktop?.aiGetSettings().then((s) => {
      load(s);
      if (!s.enabled) setShowSettings(true);
    });
  }, []);

  useEffect(() => {
    const off = desktop?.onAiEvent((e) => {
        const { chatApi: api, stream: cur, testId } = live.current;
        if (e.id === testId) {
          live.current.testId = '';
          if (e.type === 'done') setNote({ ok: true, text: t('ai.testOk') });
          else if (e.type === 'error') setNote({ ok: false, text: e.text });
          return;
        }
        if (!cur || e.id !== cur.id) return;
        if (e.type === 'delta') setStream({ id: cur.id, text: cur.text + e.text });
        else {
          const text = e.type === 'done' ? e.text : cur.text;
          if (text) api.set([...api.chat.messages, { role: 'assistant', content: e.type === 'cancelled' ? `${text}\n\n${t('ai.stopped')}` : text }]);
          if (e.type === 'error') setNote({ ok: false, text: e.text });
          setStream(null);
        }
    });
    return () => {
      off?.();
    };
  }, [t]);
  useEffect(() => {
    listEnd.current?.scrollIntoView?.({ block: 'end' });
  }, [chatApi.chat.messages.length, stream?.text]);

  const saveSettings = async () => {
    const r = await desktop?.aiSetSettings({ enabled: form.enabled, baseUrl: form.baseUrl, model: form.model, includeScript: form.includeScript, ...(form.key ? { key: form.key } : {}) });
    if (!r) return;
    if (r.error) setNote({ ok: false, text: r.error });
    else if (r.settings) {
      load(r.settings);
      setNote({ ok: true, text: t('ai.settingsSaved') });
    }
  };
  const removeKey = async () => {
    const r = await desktop?.aiSetSettings({ key: '' });
    if (r?.settings) load(r.settings);
  };
  const test = async () => {
    await saveSettings();
    const id = `test-${Date.now()}`;
    live.current.testId = id;
    const r = await desktop?.aiChat(id, [{ role: 'user', content: 'Reply with OK.' }], { test: true });
    if (r?.error) setNote({ ok: false, text: r.error });
  };

  const request = (next: ChatMessage) =>
    buildRequest(chatApi.chat.messages, next, { language: lang, script: settings?.includeScript ? host.scriptText : undefined, diagnostics: host.diagnostics });
  const next: ChatMessage = { role: 'user', content: input.trim(), ...(quotes.length ? { quotes } : {}) };
  const preview = useMemo(() => (showSettings ? '' : request(next).map((m) => `[${m.role}]\n${m.content}`).join('\n\n')), [showSettings, input, quotes, chatApi.chat.messages, settings, host.scriptText, lang]);

  const send = async () => {
    if (!input.trim() || stream) return;
    setNote(null);
    const messages = request(next);
    const id = `chat-${Date.now()}`;
    chatApi.set([...chatApi.chat.messages, next]);
    live.current.stream = { id, text: '' };
    setStream({ id, text: '' });
    setInput('');
    setQuotes([]);
    const r = await desktop?.aiChat(id, messages);
    if (r?.error) {
      setNote({ ok: false, text: r.error });
      setStream(null);
    }
  };

  const quoteSelection = () => {
    const q = host.selection();
    if (!q) return setNote({ ok: false, text: t('ai.quoteNone') });
    setNote(null);
    setQuotes([...quotes, q]);
  };

  const preparePending = (code: string, replace: boolean) => {
    const r = host.range();
    if (replace && r.from === r.to) return setNote({ ok: false, text: t('ai.needSelection') });
    const text = host.scriptText;
    const atLineStart = r.from === 0 || text[r.from - 1] === '\n';
    const replacement = replace ? code : atLineStart ? `${code}\n` : `\n${code}`;
    const old = replace ? text.slice(r.from, r.to) : '';
    setNote(null);
    setPending({ code, from: r.from, to: replace ? r.to : r.from, base: text, check: checkChange(text, r.from, replace ? r.to : r.from, replacement), old, replacement });
  };
  const apply = () => {
    if (!pending) return;
    if (host.scriptText !== pending.base) {
      setPending(null);
      return setNote({ ok: false, text: t('ai.changed') });
    }
    host.replace(pending.from, pending.to, pending.replacement);
    setPending(null);
  };

  const copy = (text: string) => void navigator.clipboard?.writeText(text).then(() => setNote({ ok: true, text: t('ai.copied') }));
  const newChat = async () => {
    if (isChatDirty({ chat: chatApi.chat } as never) && (await desktop?.choose(t('ai.discard'), [t('ai.discardYes'), t('ai.cancel')])) !== 0) return;
    chatApi.set([]);
    void chatApi.chat.path;
  };
  const dirty = isChatDirty({ chat: chatApi.chat } as never);

  const renderMessage = (m: ChatMessage, key: string) => (
    <div key={key} className={`aimsg ${m.role}`}>
      <div className="aiwho">{m.role === 'user' ? t('ai.you') : t('ai.assistant')}</div>
      {m.quotes?.map((q, i) => (
        <button key={i} className="aiquote" onClick={() => host.goto(q.fromLine)} title={q.text}>{t('ai.lines', { from: q.fromLine, to: q.toLine })}: {short(q.text)}</button>
      ))}
      {m.role === 'user' ? (
        <div className="aitext">{m.content}</div>
      ) : (
        splitReply(m.content).map((s, i) =>
          s.kind === 'text' ? (
            <div key={i} className="aitext">{s.text}</div>
          ) : (
            <div key={i} className="aicode">
              <div className="aibar">
                <button onClick={() => copy(s.text)}>{t('ai.copy')}</button>
                <button disabled={s.open} onClick={() => preparePending(s.text, false)}>{t('ai.insert')}</button>
                <button disabled={s.open} onClick={() => preparePending(s.text, true)}>{t('ai.replace')}</button>
              </div>
              <pre>{s.text}</pre>
            </div>
          ),
        )
      )}
    </div>
  );

  return (
    <div className="aipane" onMouseEnter={() => bump((n) => n + 1)}>
      <div className="aihead">
        <button onClick={() => setShowSettings(!showSettings)}>{t('ai.settings')}</button>
        <button onClick={() => copy(buildSystemPrompt(lang, { script: host.scriptText, diagnostics: host.diagnostics }))}>{t('ai.copyPrompt')}</button>
        <span className="aifile">{chatApi.chat.path ? chatApi.chat.path.split(/[\\/]/).pop() : ''}{dirty ? ` ● ${t('ai.unsaved')}` : ''}</span>
      </div>
      <div className="aihead">
        <button onClick={() => void chatApi.save()} disabled={!chatApi.chat.messages.length && !chatApi.chat.path}>{t('ai.save')}</button>
        <button onClick={() => void chatApi.saveAs()} disabled={!chatApi.chat.messages.length}>{t('ai.saveAs')}</button>
        <button onClick={() => void chatApi.open()}>{t('ai.open')}</button>
        <button onClick={() => void newChat()} disabled={!chatApi.chat.messages.length && !chatApi.chat.path}>{t('ai.new')}</button>
      </div>
      {note && <div className={`nxstatus ${note.ok ? 'ok' : 'bad'}`}>{note.text}</div>}
      {showSettings && settings && (
        <div className="aiset">
          <label><input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /> {t('ai.enabled')}</label>
          <div className="nxrow"><span className="nxlabel">{t('ai.baseUrl')}</span><input style={{ flex: 1 }} value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} /></div>
          <div className="nxrow"><span className="nxlabel">{t('ai.model')}</span><input style={{ flex: 1 }} value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} /></div>
          <div className="nxrow">
            <span className="nxlabel">{t('ai.key')}</span>
            <input style={{ flex: 1 }} type="password" autoComplete="off" disabled={!settings.canEncrypt} value={form.key} placeholder={settings.hasKey ? t('ai.keySaved') : ''} onChange={(e) => setForm({ ...form, key: e.target.value })} />
            {settings.hasKey && <button onClick={() => void removeKey()}>{t('ai.keyRemove')}</button>}
          </div>
          {!settings.canEncrypt && <div className="muted">{t('ai.noEncrypt')}</div>}
          <label><input type="checkbox" checked={form.includeScript} onChange={(e) => setForm({ ...form, includeScript: e.target.checked })} /> {t('ai.includeScript')}</label>
          <div className="nxrow"><button onClick={() => void saveSettings()}>{t('ai.saveSettings')}</button><button onClick={() => void test()}>{t('ai.test')}</button></div>
        </div>
      )}
      {!showSettings && settings && !settings.enabled && <div className="muted">{t('ai.off')}</div>}
      <div className="ailist">
        {chatApi.chat.messages.map((m, i) => renderMessage(m, `m${i}`))}
        {stream && renderMessage({ role: 'assistant', content: stream.text || '...' }, 'stream')}
        <div ref={listEnd} />
      </div>
      {pending && (
        <div className="aipending">
          <div className="nxhead">{t('ai.changes')}</div>
          <pre className="aidiff">{diffLines(pending.old, pending.code).map((d, i) => <div key={i} className={`d${d.kind === '+' ? 'add' : d.kind === '-' ? 'del' : 'same'}`}>{d.kind} {d.text}</div>)}</pre>
          {pending.check.added.length ? (
            <div className="nxstatus bad">{t('ai.problemsAdded', { n: pending.check.added.length })}{pending.check.added.slice(0, 6).map((d, i) => <div key={i}>{d.message}</div>)}</div>
          ) : (
            <div className="nxstatus ok">{t('ai.noProblems')}</div>
          )}
          <div className="nxrow"><button onClick={apply}>{t('ai.apply')}</button><button onClick={() => setPending(null)}>{t('ai.cancel')}</button></div>
        </div>
      )}
      <div className="aiinput">
        {quotes.map((q, i) => (
          <span key={i} className="aiquote">
            <button onClick={() => host.goto(q.fromLine)}>{t('ai.lines', { from: q.fromLine, to: q.toLine })}: {short(q.text)}</button>
            <button onClick={() => setQuotes(quotes.filter((_, k) => k !== i))}>x</button>
          </span>
        ))}
        <textarea rows={3} value={input} placeholder={t('ai.placeholder')} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void send(); } }} />
        <div className="nxrow">
          <button onClick={quoteSelection}>{t('ai.quote')}</button>
          {stream ? <button onClick={() => void desktop?.aiCancel(stream.id)}>{t('ai.stop')}</button> : <button disabled={!input.trim() || !settings?.enabled} onClick={() => void send()}>{t('ai.send')}</button>}
        </div>
        {!showSettings && (
          <details>
            <summary>{t('ai.preview')}</summary>
            <pre className="aipreview">{preview}</pre>
          </details>
        )}
      </div>
    </div>
  );
}