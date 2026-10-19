import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, ShieldCheck } from 'lucide-react';
import { ADMIN_SECTIONS } from '@/config/adminSections';
import { useAuth } from '@/hooks/useAuth';
import { usePermissions } from '@/hooks/usePermissions';
import { useI18n } from '@/i18n';
import { PERMISSIONS } from '@/lib/permissions';
import { formatDateTime } from '@/utils/time';
import { RoleBadge } from '@/components/common/Badges';

export function AdminHomePage() {
  const { t, locale } = useI18n();
  const { profile } = useAuth();
  const { canAny, granted } = usePermissions();
  if (!profile) return null;

  const modules = ADMIN_SECTIONS.filter((s) => s.id !== 'dashboard' && s.showInNav && s.descriptionKey && canAny(s.anyOf));

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <section className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            {t('admin.home.greeting', { name: profile.fullName || profile.email })}
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            {t('admin.home.subtitle', {
              role: t(`role.${profile.role}`),
              lastLogin: profile.lastLoginAt ? formatDateTime(profile.lastLoginAt, locale) : t('common.never'),
            })}
          </p>
        </div>
        <RoleBadge role={profile.role} />
      </section>

      <section className="flex gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 dark:border-emerald-500/20 dark:bg-emerald-500/5">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
        <div>
          <h2 className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">{t('admin.home.foundation')}</h2>
          <p className="mt-0.5 text-sm text-emerald-800/90 dark:text-emerald-200/80">{t('admin.home.foundationBody')}</p>
        </div>
      </section>

      <section aria-labelledby="modules-heading">
        <h2 id="modules-heading" className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          {t('admin.home.modules')}
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {modules.map((m) => (
            <li key={m.id}>
              <Link
                to={m.path}
                className="group flex h-full flex-col rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:border-sky-300 hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-sky-500/50"
              >
                <div className="flex items-center gap-2.5">
                  <span className="flex size-9 items-center justify-center rounded-lg bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                    <m.icon className="size-[18px]" aria-hidden />
                  </span>
                  <span className="font-semibold text-slate-900 dark:text-white">{t(m.labelKey)}</span>
                  <span
                    className={
                      m.phase <= 1
                        ? 'ms-auto rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300'
                        : 'ms-auto rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                    }
                  >
                    {m.phase <= 1 ? t('admin.available') : t('admin.phase', { n: m.phase })}
                  </span>
                </div>
                <p className="mt-2.5 flex-1 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                  {m.descriptionKey ? t(m.descriptionKey) : null}
                </p>
                <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-sky-700 dark:text-sky-400">
                  {t('admin.open')}
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5" aria-hidden />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="perm-heading">
        <h2 id="perm-heading" className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          {t('admin.home.permissions')}
        </h2>
        <ul className="flex flex-wrap gap-2">
          {PERMISSIONS.filter((p) => granted.has(p)).map((p) => (
            <li
              key={p}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
            >
              <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden />
              {t(`perm.${p}`)}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
