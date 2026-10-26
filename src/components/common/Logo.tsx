import { Link } from 'react-router-dom';
import { useI18n } from '@/i18n';
import { cn } from '@/utils/cn';

export function LogoMark({ className }: { className?: string }) {
  return <img src="/logo-mark.png" alt="" aria-hidden className={cn('size-8 rounded-lg object-cover', className)} />;
}

/** The full logo (emblem + OSINTFront wordmark), for large places such as the login page. */
export function LogoFull({ className }: { className?: string }) {
  return <img src="/logo.png" alt="OSINTFront" className={cn('h-24 w-auto rounded-2xl', className)} />;
}

export function Logo({ to = '/', subtitle }: { to?: string; subtitle?: string }) {
  const { t } = useI18n();
  return (
    <Link
      to={to}
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
