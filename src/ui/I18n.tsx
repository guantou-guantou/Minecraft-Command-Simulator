import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { desktop } from './desktop.ts';
import { loadLang, saveLang, translate, type Key, type Lang } from './i18n.ts';

type T = (key: Key, vars?: Record<string, string | number>) => string;

const Ctx = createContext<{ lang: Lang; setLang: (l: Lang) => void; t: T }>({
  lang: 'en',
  setLang: () => {},
  t: (key, vars) => translate('en', key, vars),
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(loadLang);
  const t = useCallback<T>((key, vars) => translate(lang, key, vars), [lang]);
  useEffect(() => {
    saveLang(lang);
    document.documentElement.lang = lang;
    void desktop?.setLanguage(lang);
  }, [lang]);
  const value = useMemo(() => ({ lang, setLang, t }), [lang, t]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useT = () => useContext(Ctx).t;
export const useLang = () => {
  const c = useContext(Ctx);
  return [c.lang, c.setLang] as const;
};