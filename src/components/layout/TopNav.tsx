import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, SlidersHorizontal, History, LayoutDashboard, Radio, Search, X } from 'lucide-react';
import { SoundMenu } from './SoundMenu';
import { UserMenu } from './UserMenu';
import { useToast } from '@/components/common/Toast';
import { consumeSearchQuota } from '@/services/searchQuotaService';
import { cn } from '@/utils/cn';
import { useAuth } from '@/hooks/useAuth';
import { usePermissions } from '@/hooks/usePermissions';
import { useI18n } from '@/i18n';
import { Logo } from '@/components/common/Logo';
import { LanguageToggle, ThemeToggle } from '@/components/common/Toggles';

interface TopNavProps {
  query: string;
  onQueryChange: (value: string) => void;
  mode?: 'live' | 'archive';
  /** Filters button (map pages). */
  filterCount?: number;
  filtersOpen?: boolean;
  onToggleFilters?: () => void;
  /** The alert-sound menu opened (the page closes its filter panel). */
  onSoundOpen?: () => void;
}

export function TopNav({ query, onQueryChange, mode = 'live', filterCount = 0, filtersOpen = false, onToggleFilters, onSoundOpen }: TopNavProps) {
  const { t } = useI18n();
  const { status, profile } = useAuth();
  const { can } = usePermissions();
  const showAdmin = status === 'signed_in' && can('admin.access');
  // Phones: search is an icon that opens a full-width field over the bar.
  const [searchOpen, setSearchOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (searchOpen) inputRef.current?.focus();
  }, [searchOpen]);
  const closeSearch = () => setSearchOpen(false);
  // The search runs on Enter (not while typing): each new search uses the daily quota.
  const toast = useToast();
  const [draft, setDraft] = useState(query);
  const [checking, setChecking] = useState(false);
  useEffect(() => setDraft(query), [query]);
  const runSearch = async () => {
    const q = draft.trim();
    if (!q) return onQueryChange('');
    if (q === query.trim()) return;
    setChecking(true);
    try {
      const r = await consumeSearchQuota(q);
      if (!r.ok) {
        toast.error(t('search.quotaReached', { limit: r.limit ?? 3 }));
        return;
      }
      onQueryChange(q);
      if (!r.unlimited && typeof r.remaining === 'number') toast.success(t('search.quotaLeft', { count: r.remaining }));
    } catch {
      toast.error(t('search.failed'));
    } finally {
      setChecking(false);
    }
  };
  const iconBtn =
    'inline-flex size-10 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-900/5 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-sky-500 sm:size-9 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white';
  return (
    <header className="relative z-[1000] flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white/90 px-3 backdrop-blur sm:px-4 dark:border-slate-800 dark:bg-slate-950/90">
      <Logo />
      <nav aria-label={t('nav.viewSwitch')} className="hidden shrink-0 items-center rounded-full bg-slate-100 p-0.5 md:inline-flex dark:bg-slate-900">
        <Link
          to="/"
          aria-current={mode === 'live' ? 'page' : undefined}
          className={cn(
            'inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-bold uppercase tracking-wider',
            mode === 'live' ? 'bg-red-500/15 text-red-600 dark:text-red-400' : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white',
          )}
        >
          <span className={cn('size-1.5 rounded-full', mode === 'live' ? 'bg-red-500' : 'bg-slate-400')} aria-hidden />
          {t('nav.live')}
        </Link>
        <Link
          to="/archive"
          aria-current={mode === 'archive' ? 'page' : undefined}
          className={cn(
            'inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-bold uppercase tracking-wider',
            mode === 'archive' ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white' : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white',
          )}
        >
          <History className="size-3" aria-hidden />
          {t('nav.archive')}
        </Link>
      </nav>

      <form
        role="search"
        className={cn(
          'min-w-0 sm:mx-auto sm:block sm:w-full sm:max-w-md sm:flex-1',
          searchOpen
            ? 'absolute inset-0 z-10 flex items-center gap-1 bg-white px-2 sm:static sm:z-auto sm:bg-transparent sm:px-0 dark:bg-slate-950 sm:dark:bg-transparent'
            : 'hidden',
        )}
        onSubmit={(e) => {
          e.preventDefault();
          inputRef.current?.blur();
          void runSearch();
        }}
      >
        <button type="button" onClick={closeSearch} aria-label={t('common.close')} className={cn(iconBtn, 'shrink-0 sm:hidden')}>
          <ArrowLeft className="size-5 rtl:-scale-x-100" aria-hidden />
        </button>
        <label htmlFor="global-search" className="sr-only">
          {t('nav.searchLabel')}
        </label>
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input
            id="global-search"
            ref={inputRef}
            type="search"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              if (!e.target.value) onQueryChange('');
            }}
            disabled={checking}
            title={profile?.role === 'super_admin' ? undefined : t('search.quotaHint')}
            onKeyDown={(e) => e.key === 'Escape' && closeSearch()}
            enterKeyHint="search"
            placeholder={t('nav.searchPlaceholder')}
            maxLength={120}
            autoComplete="off"
            className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 ps-9 pe-8 text-base text-slate-900 sm:h-9 sm:text-sm placeholder:text-slate-400 focus:border-sky-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/30 dark:border-slate-800 dark:bg-slate-900 dark:text-white dark:focus:bg-slate-900 [&::-webkit-search-cancel-button]:hidden"
          />
          {draft || query ? (
            <button
              type="button"
              onClick={() => {
                setDraft('');
                onQueryChange('');
              }}
              aria-label={t('feed.clearSearch')}
              className="absolute end-1.5 top-1/2 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          ) : null}
        </div>
      </form>

      <nav className="ms-auto flex shrink-0 items-center gap-0.5 sm:ms-0" aria-label="Site">
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          aria-label={t('nav.openSearch')}
          className={cn(iconBtn, 'relative sm:hidden')}
        >
          <Search className="size-5" aria-hidden />
          {query ? <span className="absolute end-2 top-2 size-2 rounded-full bg-sky-500" aria-hidden /> : null}
        </button>
        {onToggleFilters ? (
          <button
            type="button"
            onClick={onToggleFilters}
            aria-expanded={filtersOpen}
            aria-label={filterCount ? t('filters.active', { count: filterCount }) : t('filters.button')}
            className={cn(
              iconBtn,
              'relative lg:w-auto lg:gap-1.5 lg:px-2.5 lg:text-sm lg:font-medium',
              filterCount ? 'text-sky-700 dark:text-sky-400' : '',
              filtersOpen ? 'bg-slate-900/5 dark:bg-white/10' : '',
            )}
          >
            <SlidersHorizontal className="size-5 lg:size-4" aria-hidden />
            <span className="hidden lg:inline">{t('filters.button')}</span>
            {filterCount ? (
              <span className="absolute end-0.5 top-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-sky-600 px-1 text-[10px] font-bold leading-4 text-white lg:static lg:ms-0.5">
                {filterCount}
              </span>
            ) : null}
          </button>
        ) : null}
        <Link
          to={mode === 'live' ? '/archive' : '/'}
          aria-label={mode === 'live' ? t('nav.archive') : t('nav.live')}
          title={mode === 'live' ? t('nav.archive') : t('nav.live')}
          className={cn(iconBtn, 'md:hidden')}
        >
          {mode === 'live' ? <History className="size-4" aria-hidden /> : <Radio className="size-4 text-red-500" aria-hidden />}
        </Link>
        {mode === 'live' ? <SoundMenu onOpen={onSoundOpen} /> : null}
        <LanguageToggle />
        <ThemeToggle />
        {showAdmin ? (
          <Link
            to="/admin"
            className="ms-1 hidden h-9 items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-sm font-semibold text-white hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 lg:inline-flex dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
          >
            <LayoutDashboard className="size-4" aria-hidden />
            {t('nav.admin')}
          </Link>
        ) : null}
        <UserMenu />
      </nav>
    </header>
  );
}
