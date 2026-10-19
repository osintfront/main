import { Link } from 'react-router-dom';
import { useI18n } from '@/i18n';
import { cn } from '@/utils/cn';

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('size-8', className)} aria-hidden>
      <rect width="32" height="32" rx="8" className="fill-slate-900 dark:fill-slate-800" />
      <circle cx="16" cy="16" r="9" fill="none" stroke="#38bdf8" strokeWidth="2" />
      <circle cx="16" cy="16" r="3.5" fill="#f43f5e" />
      <path d="M16 3v5M16 24v5M3 16h5M24 16h5" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
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
