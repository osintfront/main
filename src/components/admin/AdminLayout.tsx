import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Map as MapIcon, Menu, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
import { ADMIN_SECTIONS } from '@/config/adminSections';
import { usePermissions } from '@/hooks/usePermissions';
import { useI18n } from '@/i18n';
import { cn } from '@/utils/cn';
import { Logo } from '@/components/common/Logo';
import { LanguageToggle, ThemeToggle } from '@/components/common/Toggles';
import { IconButton } from '@/components/common/IconButton';
import { UserMenu } from './UserMenu';

const COLLAPSE_KEY = 'ofm.admin.sidebarExpanded';

function SidebarNav({ compact, onNavigate }: { compact: boolean; onNavigate?: () => void }) {
  const { t } = useI18n();
  const { canAny } = usePermissions();
  const items = ADMIN_SECTIONS.filter((s) => s.showInNav && canAny(s.anyOf));

  const linkClass = (active: boolean) =>
    cn(
      'group flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors',
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500',
      active
        ? 'bg-sky-50 text-sky-800 dark:bg-sky-500/15 dark:text-sky-200'
        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white',
      compact && 'md:justify-center lg:justify-start',
    );

  const labelClass = cn(compact && 'md:sr-only lg:not-sr-only');

  return (
    <nav aria-label={t('admin.console')} className="flex flex-1 flex-col gap-1 p-3">
      {items.map((s) => (
        <NavLink
          key={s.id}
          to={s.path}
          end={s.route === '' || s.id === 'events'}
          onClick={onNavigate}
          title={compact ? t(s.labelKey) : undefined}
          className={({ isActive }) => linkClass(isActive)}
        >
          <s.icon className="size-[18px] shrink-0" aria-hidden />
          <span className={labelClass}>{t(s.labelKey)}</span>
        </NavLink>
      ))}
      <div className="mt-auto border-t border-slate-200 pt-3 dark:border-slate-800">
        <NavLink to="/" onClick={onNavigate} title={compact ? t('admin.nav.publicMap') : undefined} className={() => linkClass(false)}>
          <MapIcon className="size-[18px] shrink-0" aria-hidden />
          <span className={labelClass}>{t('admin.nav.publicMap')}</span>
        </NavLink>
      </div>
    </nav>
  );
}

/**
 * Admin shell. Desktop (lg+): fixed sidebar. Tablet (md): collapsible icon rail.
 * Mobile: off-canvas drawer. No advertising is rendered anywhere in here.
 */
export function AdminLayout() {
  const { t, dir } = useI18n();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [expanded, setExpanded] = useState<boolean>(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const drawerRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, expanded ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [expanded]);

  // Close the drawer on navigation.
  useEffect(() => setDrawerOpen(false), [location.pathname]);

  // Drawer: focus first link, close on Escape, keep focus inside.
  useEffect(() => {
    if (!drawerOpen) return;
    const drawer = drawerRef.current;
    const focusables = () =>
      Array.from(drawer?.querySelectorAll<HTMLElement>('a[href],button:not([disabled])') ?? []);
    focusables()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDrawerOpen(false);
        menuButtonRef.current?.focus();
      } else if (e.key === 'Tab') {
        const list = focusables();
        if (list.length === 0) return;
        const first = list[0];
        const last = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [drawerOpen]);

  const CollapseIcon = (expanded ? dir === 'rtl' : dir !== 'rtl') ? PanelLeftOpen : PanelLeftClose;

  return (
    <div className="flex min-h-dvh bg-slate-50 dark:bg-slate-950">
      {/* Tablet / desktop sidebar */}
      <aside
        className={cn(
          'sticky top-0 hidden h-dvh shrink-0 flex-col border-e border-slate-200 bg-white transition-[width] duration-200 md:flex dark:border-slate-800 dark:bg-slate-900',
          expanded ? 'md:w-64' : 'md:w-[68px]',
          'lg:w-64',
        )}
      >
        <div className={cn('flex h-14 items-center border-b border-slate-200 px-3 dark:border-slate-800', !expanded && 'md:justify-center lg:justify-start')}>
          <span className={cn(!expanded && 'md:hidden lg:block')}>
            <Logo to="/admin" subtitle={t('admin.console')} />
          </span>
          {!expanded ? (
            <span className="hidden md:block lg:hidden">
              <IconButton label={t('admin.nav.expand')} onClick={() => setExpanded(true)} tooltipSide="end">
                <CollapseIcon className="size-[18px]" aria-hidden />
              </IconButton>
            </span>
          ) : (
            <span className="ms-auto lg:hidden">
              <IconButton label={t('admin.nav.collapse')} onClick={() => setExpanded(false)} tooltipSide="end">
                <CollapseIcon className="size-[18px]" aria-hidden />
              </IconButton>
            </span>
          )}
        </div>
        <SidebarNav compact={!expanded} />
      </aside>

      {/* Mobile drawer */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-[1400] md:hidden" role="dialog" aria-modal="true" aria-label={t('admin.console')}>
          <button
            type="button"
            tabIndex={-1}
            aria-hidden
            className="absolute inset-0 bg-slate-950/50 backdrop-blur-[2px]"
            onClick={() => setDrawerOpen(false)}
          />
          <div
            ref={drawerRef}
            className="absolute inset-y-0 start-0 flex w-72 max-w-[85vw] flex-col bg-white shadow-2xl dark:bg-slate-900"
          >
            <div className="flex h-14 items-center justify-between border-b border-slate-200 px-3 dark:border-slate-800">
              <Logo to="/admin" subtitle={t('admin.console')} />
              <IconButton label={t('admin.nav.closeMenu')} onClick={() => setDrawerOpen(false)} tooltipSide="bottom-end">
                <X className="size-5" aria-hidden />
              </IconButton>
            </div>
            <SidebarNav compact={false} onNavigate={() => setDrawerOpen(false)} />
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-[1200] flex h-14 items-center gap-2 border-b border-slate-200 bg-white/90 px-3 backdrop-blur sm:px-5 dark:border-slate-800 dark:bg-slate-950/90">
          <span className="md:hidden">
            <button
              ref={menuButtonRef}
              type="button"
              aria-label={t('admin.nav.openMenu')}
              aria-expanded={drawerOpen}
              onClick={() => setDrawerOpen(true)}
              className="inline-flex size-9 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-900/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:text-slate-300 dark:hover:bg-white/10"
            >
              <Menu className="size-5" aria-hidden />
            </button>
          </span>
          <span className="text-sm font-semibold text-slate-500 dark:text-slate-400">{t('admin.console')}</span>
          <div className="ms-auto flex items-center gap-1">
            <LanguageToggle />
            <ThemeToggle />
            <span className="mx-1 h-6 w-px bg-slate-200 dark:bg-slate-800" aria-hidden />
            <UserMenu />
          </div>
        </header>
        <main id="admin-main" className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
