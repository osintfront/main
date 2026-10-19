import { Link } from 'react-router-dom';
import { LayoutDashboard, LogIn, Search, X } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { usePermissions } from '@/hooks/usePermissions';
import { useI18n } from '@/i18n';
import { Logo } from '@/components/common/Logo';
import { LanguageToggle, ThemeToggle } from '@/components/common/Toggles';

interface TopNavProps {
  query: string;
  onQueryChange: (value: string) => void;
}

export function TopNav({ query, onQueryChange }: TopNavProps) {
  const { t } = useI18n();
  const { status } = useAuth();
  const { can } = usePermissions();
  const showAdmin = status === 'signed_in' && can('dashboard.view');

  return (
    <header className="relative z-[1000] flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white/90 px-3 backdrop-blur sm:px-4 dark:border-slate-800 dark:bg-slate-950/90">
      <Logo />
      <span className="hidden items-center gap-1.5 rounded-full bg-red-500/10 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-red-600 md:inline-flex dark:text-red-400">
        <span className="size-1.5 rounded-full bg-red-500" aria-hidden />
        {t('nav.live')}
      </span>

      <form role="search" className="mx-auto w-full max-w-md min-w-0 flex-1" onSubmit={(e) => e.preventDefault()}>
        <label htmlFor="global-search" className="sr-only">
          {t('nav.searchLabel')}
        </label>
        <div className="relative">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input
            id="global-search"
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={t('nav.searchPlaceholder')}
            maxLength={120}
            autoComplete="off"
            className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 ps-9 pe-8 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/30 dark:border-slate-800 dark:bg-slate-900 dark:text-white dark:focus:bg-slate-900 [&::-webkit-search-cancel-button]:hidden"
          />
          {query ? (
            <button
              type="button"
              onClick={() => onQueryChange('')}
              aria-label={t('feed.clearSearch')}
              className="absolute end-1.5 top-1/2 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          ) : null}
        </div>
      </form>

      <nav className="flex shrink-0 items-center gap-0.5" aria-label="Site">
        <LanguageToggle />
        <ThemeToggle />
        {showAdmin ? (
          <Link
            to="/admin"
            className="ms-1 hidden h-9 items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-sm font-semibold text-white hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 sm:inline-flex dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
          >
            <LayoutDashboard className="size-4" aria-hidden />
            {t('nav.admin')}
          </Link>
        ) : (
          <Link
            to="/login"
            className="ms-1 hidden h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-slate-600 hover:bg-slate-900/5 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 lg:inline-flex dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white"
          >
            <LogIn className="size-4 rtl:-scale-x-100" aria-hidden />
            {t('nav.signIn')}
          </Link>
        )}
      </nav>
    </header>
  );
}
