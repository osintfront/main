import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useI18n } from '@/i18n';

/** The bundle this tab runs (Vite: /assets/index-<hash>.js). */
function currentBundle(): string | null {
  const s = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]');
  return s ? new URL(s.src, location.href).pathname : null;
}

/**
 * A tab left open keeps running an old version of the site. Check the deployed page
 * every few minutes (and when the tab comes back) and offer a reload when it changed.
 */
export function UpdateBanner() {
  const { t } = useI18n();
  const [stale, setStale] = useState(false);

  useEffect(() => {
    const mine = currentBundle();
    if (!mine) return;
    let stop = false;
    const check = async () => {
      if (stop || document.visibilityState !== 'visible') return;
      try {
        const html = await (await fetch('/index.html', { cache: 'no-store' })).text();
        const m = html.match(/src="([^"]*\/assets\/[^"]+\.js)"/);
        if (m && new URL(m[1], location.href).pathname !== mine) setStale(true);
      } catch {
        /* offline: try again later */
      }
    };
    const timer = window.setInterval(check, 5 * 60_000);
    const onVis = () => void check();
    document.addEventListener('visibilitychange', onVis);
    void check();
    return () => {
      stop = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  if (!stale) return null;
  return (
    <div role="status" className="fixed inset-x-0 bottom-3 z-[3000] mx-auto flex w-fit max-w-[calc(100vw-2rem)] items-center gap-3 rounded-full bg-slate-900 px-4 py-2 text-sm text-white shadow-lg dark:bg-slate-100 dark:text-slate-900">
      <span>{t('update.available')}</span>
      <button
        type="button"
        onClick={() => location.reload()}
        className="inline-flex items-center gap-1 rounded-full bg-sky-500 px-3 py-1 font-semibold text-white hover:bg-sky-400"
      >
        <RefreshCw className="h-3.5 w-3.5" aria-hidden />
        {t('update.reload')}
      </button>
    </div>
  );
}
