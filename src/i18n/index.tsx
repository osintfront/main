import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { en, type TranslationKey } from './en';
import { he } from './he';

export type Language = 'en' | 'he';
export type Direction = 'ltr' | 'rtl';

const DICTIONARIES: Record<Language, Record<TranslationKey, string>> = { en, he };
const LOCALES: Record<Language, string> = { en: 'en-GB', he: 'he-IL' };
const STORAGE_KEY = 'ofm.lang';

type Vars = Record<string, string | number>;

interface I18nValue {
  lang: Language;
  dir: Direction;
  locale: string;
  setLang: (lang: Language) => void;
  toggleLang: () => void;
  t: (key: TranslationKey, vars?: Vars) => string;
  /** Translated label for a category slug, falling back to the canonical English name. */
  categoryLabel: (slug: string, fallbackName?: string) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

function readInitialLanguage(): Language {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'he' ? 'he' : 'en';
  } catch {
    return 'en';
  }
}

function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
  );
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(readInitialLanguage);
  const dir: Direction = lang === 'he' ? 'rtl' : 'ltr';

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      /* storage unavailable — language still applies for this visit */
    }
  }, [lang, dir]);

  const setLang = useCallback((next: Language) => setLangState(next), []);
  const toggleLang = useCallback(() => setLangState((l) => (l === 'en' ? 'he' : 'en')), []);

  const t = useCallback(
    (key: TranslationKey, vars?: Vars) => interpolate(DICTIONARIES[lang][key] ?? en[key] ?? key, vars),
    [lang],
  );

  const categoryLabel = useCallback(
    (slug: string, fallbackName?: string) => {
      const key = `category.${slug}` as TranslationKey;
      return DICTIONARIES[lang][key] ?? fallbackName ?? slug;
    },
    [lang],
  );

  const value = useMemo<I18nValue>(
    () => ({ lang, dir, locale: LOCALES[lang], setLang, toggleLang, t, categoryLabel }),
    [lang, dir, setLang, toggleLang, t, categoryLabel],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}

export type { TranslationKey };
