import { Languages, Moon, Sun } from 'lucide-react';
import { useTheme } from '@/context/ThemeContext';
import { useI18n } from '@/i18n';
import { IconButton } from './IconButton';

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const { t } = useI18n();
  const label = theme === 'dark' ? t('nav.themeToLight') : t('nav.themeToDark');
  return (
    <IconButton label={label} onClick={toggleTheme} tooltipSide="bottom-end">
      {theme === 'dark' ? <Sun className="size-[18px]" aria-hidden /> : <Moon className="size-[18px]" aria-hidden />}
    </IconButton>
  );
}

export function LanguageToggle() {
  const { t, toggleLang, lang } = useI18n();
  return (
    <button
      type="button"
      onClick={toggleLang}
      aria-label={t('nav.languageLabel')}
      lang={lang === 'en' ? 'he' : 'en'}
      className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-900/5 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white"
    >
      <Languages className="size-4" aria-hidden />
      <span className="hidden sm:inline">{t('nav.otherLanguage')}</span>
    </button>
  );
}
