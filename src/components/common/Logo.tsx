import { Link, useLocation } from 'react-router-dom';
import { useI18n } from '@/i18n';
import { cn } from '@/utils/cn';

/** Fired when the logo is clicked on the page it already links to. */
export const HOME_EVENT = 'osintfront:home';

export function LogoMark({ className }: { className?: string }) {
  return <img src="/logo-mark.png" alt="" aria-hidden className={cn('size-8 object-contain', className)} />;
}

/** The full logo (emblem + OSINTFront wordmark), for large places such as the login page. */
export function LogoFull({ className }: { className?: string }) {
  return <img src="/logo.png" alt="OSINTFront" className={cn('h-24 w-auto rounded-2xl', className)} />;
}

export function Logo({ to = '/', subtitle }: { to?: string; subtitle?: string }) {
  const { t } = useI18n();
  const { pathname } = useLocation();
  return (
    <Link
      to={to}
      // Already on the page it points to (the map): the link alone changes nothing, so tell the
      // page to go back to its home view (map pane, no open panels or selection).
      onClick={() => {
        if (pathname === to) window.dispatchEvent(new Event(HOME_EVENT));
      }}
      className="flex items-center gap-2.5 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sky-500"
    >
      <LogoMark />
      <span className="hidden flex-col leading-none sm:flex">
        <span className="text-[15px] font-bold tracking-tight text-slate-900 dark:text-white">{t('app.name')}</span>
        <span className="mt-1 text-[11px] font-medium text-slate-500 dark:text-slate-400">{subtitle ?? t('app.tagline')}</span>
      </span>
    </Link>
  );
}
