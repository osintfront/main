import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, LogOut, UserCog } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useI18n } from '@/i18n';
import { RoleBadge } from '@/components/common/Badges';

function initials(name: string, email: string): string {
  const source = name.trim() || email;
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

export function UserMenu() {
  const { t } = useI18n();
  const { profile, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!profile) return null;
  const name = profile.fullName || profile.email;

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={t('admin.nav.userMenu')}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-lg p-1 pe-2 hover:bg-slate-900/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:hover:bg-white/10"
      >
        <span className="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-sky-500 to-indigo-600 text-xs font-bold text-white">
          {initials(profile.fullName, profile.email)}
        </span>
        <span className="hidden max-w-[10rem] flex-col items-start leading-tight sm:flex">
          <span className="w-full truncate text-sm font-semibold text-slate-900 dark:text-white">{name}</span>
          <span className="text-[11px] text-slate-500 dark:text-slate-400">{t(`role.${profile.role}`)}</span>
        </span>
        <ChevronDown className="size-4 text-slate-400" aria-hidden />
      </button>

      {open ? (
        <div
          id={menuId}
          role="menu"
          className="absolute end-0 top-full z-[1300] mt-2 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900"
        >
          <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-800">
            <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{name}</p>
            <p className="truncate text-xs text-slate-500 dark:text-slate-400" dir="ltr">
              {profile.email}
            </p>
            <div className="mt-2">
              <RoleBadge role={profile.role} />
            </div>
          </div>
          <div className="p-1.5">
            <Link
              to="/admin/account"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-slate-700 hover:bg-slate-100 focus-visible:bg-slate-100 focus-visible:outline-none dark:text-slate-200 dark:hover:bg-slate-800 dark:focus-visible:bg-slate-800"
            >
              <UserCog className="size-4" aria-hidden />
              {t('auth.accountSettings')}
            </Link>
            <button
              type="button"
              role="menuitem"
              disabled={signingOut}
              onClick={async () => {
                setSigningOut(true);
                await signOut();
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-red-700 hover:bg-red-50 focus-visible:bg-red-50 focus-visible:outline-none disabled:opacity-60 dark:text-red-400 dark:hover:bg-red-500/10 dark:focus-visible:bg-red-500/10"
            >
              <LogOut className="size-4 rtl:-scale-x-100" aria-hidden />
              {t('auth.signOut')}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
