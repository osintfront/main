import { effectivePlan, PLAN_LABEL } from '@/lib/plans';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LayoutDashboard, LogOut, UserCog } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { usePermissions } from '@/hooks/usePermissions';
import { useI18n } from '@/i18n';

/** The signed-in account: name, back office (staff), sign out — on every screen size. */
export function UserMenu() {
  const { t } = useI18n();
  const { status, profile, user, signOut } = useAuth();
  const { can } = usePermissions();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (status !== 'signed_in') return null;
  const name = profile?.fullName || user?.email || '';
  const email = profile?.email || user?.email || '';
  const initials =
    name
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join('') || '?';
  const staff = can('admin.access');

  return (
    <div ref={ref} className="relative ms-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('user.menu')}
        title={name}
        className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-sky-500 to-indigo-600 text-xs font-bold text-white ring-2 ring-white hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:ring-slate-900"
      >
        {initials}
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute end-0 top-11 z-[1200] w-60 overflow-hidden rounded-xl bg-white shadow-xl ring-1 ring-slate-900/10 dark:bg-slate-900 dark:ring-white/10"
        >
          <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-800">
            <p className="truncate text-sm font-semibold text-slate-900 dark:text-white" dir="auto">
              {name}
            </p>
            {email && email !== name ? (
              <p className="truncate text-xs text-slate-500 dark:text-slate-400" dir="ltr">
                {email}
              </p>
            ) : null}
            {profile ? <p className="mt-1 text-[11px] font-medium text-sky-700 dark:text-sky-400">{t(`role.${profile.role}`)}</p> : null}
            {profile ? <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400" dir="rtl">החבילה שלך: {PLAN_LABEL[effectivePlan(profile)]}</p> : null}
          </div>
          {staff ? (
            <Link role="menuitem" to="/admin" onClick={() => setOpen(false)} className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800">
              <LayoutDashboard className="size-4" aria-hidden />
              {t('nav.admin')}
            </Link>
          ) : null}
          <Link role="menuitem" to={staff ? '/admin/account' : '/account'} onClick={() => setOpen(false)} className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800">
            <UserCog className="size-4" aria-hidden />
            {t('user.account')}
          </Link>
          <Link role="menuitem" to="/cancel-subscription" onClick={() => setOpen(false)} className="block px-4 py-2 text-xs text-slate-500 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800">
            ביטול מנוי
          </Link>
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              setOpen(false);
              void signOut().then(() => navigate('/login', { replace: true }));
            }}
            className="flex w-full items-center gap-2.5 border-t border-slate-100 px-4 py-2.5 text-start text-sm font-semibold text-red-700 hover:bg-red-50 dark:border-slate-800 dark:text-red-400 dark:hover:bg-red-500/10"
          >
            <LogOut className="size-4 rtl:-scale-x-100" aria-hidden />
            {t('auth.signOut')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
