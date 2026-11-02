import { useEffect, useState } from 'react';
import { useI18n } from '@/i18n';

/**
 * Cookie / local-storage notice. Today the site sets no non-essential cookies (Vercel Web
 * Analytics is cookieless; everything else in localStorage is functional — language, theme,
 * sound, session). So there is nothing to actually consent to yet — this is a heads-up with an
 * acknowledge action, not a consent gate, and it never blocks the site.
 *
 * When a real tracking/advertising cookie is added (see AdSlot), this is the place to turn
 * "essential" into real categories with on/off toggles and to make the choice required before
 * that script loads. The stored decision stays versioned (COOKIE_NOTICE_VERSION) so a future
 * change can show it again.
 */
const KEY = 'ofm.cookieNotice';
const COOKIE_NOTICE_VERSION = '1';

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function write(v: string) {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* ignore — the notice will just show again next visit */
  }
}

export function CookieNotice() {
  const { t } = useI18n();
  const [show, setShow] = useState(false);

  useEffect(() => {
    setShow(read() !== COOKIE_NOTICE_VERSION);
  }, []);

  if (!show) return null;

  const dismiss = (v: string) => {
    write(v);
    setShow(false);
  };

  return (
    <div
      role="region"
      aria-label={t('cookie.label')}
      className="fixed inset-x-0 bottom-0 z-[3100] border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95"
    >
      <div className="mx-auto flex max-w-3xl flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">
          {t('cookie.text')}{' '}
          <a href="/privacy" target="_blank" rel="noopener noreferrer" className="font-medium text-sky-700 underline dark:text-sky-400">
            {t('cookie.learnMore')}
          </a>
        </p>
        <div className="flex shrink-0 items-center gap-2 self-end sm:self-auto">
          <button
            type="button"
            onClick={() => dismiss(COOKIE_NOTICE_VERSION)}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-900/5 dark:text-slate-300 dark:hover:bg-white/10"
          >
            {t('cookie.reject')}
          </button>
          <button
            type="button"
            onClick={() => dismiss(COOKIE_NOTICE_VERSION)}
            className="rounded-lg bg-sky-600 px-3.5 py-1.5 text-sm font-semibold text-white hover:bg-sky-500"
          >
            {t('cookie.accept')}
          </button>
        </div>
      </div>
    </div>
  );
}
