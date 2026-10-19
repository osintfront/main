import { Database } from 'lucide-react';
import { sectionById } from '@/config/adminSections';
import { useI18n } from '@/i18n';

/**
 * Holding page for modules scheduled in later phases. The route, auth check
 * and permission check around it are real; only the module body is pending.
 */
export function ModulePlaceholderPage({ sectionId }: { sectionId: string }) {
  const { t } = useI18n();
  const section = sectionById(sectionId);
  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-xl bg-slate-900 text-white dark:bg-white dark:text-slate-900">
          <section.icon className="size-5" aria-hidden />
        </span>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{t(section.labelKey)}</h1>
          {section.descriptionKey ? (
            <p className="text-sm text-slate-600 dark:text-slate-400">{t(section.descriptionKey)}</p>
          ) : null}
        </div>
      </div>

      <div className="mt-8 rounded-2xl border border-dashed border-slate-300 bg-white p-6 dark:border-slate-700 dark:bg-slate-900">
        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-slate-600 dark:bg-slate-800 dark:text-slate-400">
          {t('admin.phase', { n: section.phase })}
        </span>
        <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          {t('admin.placeholder.body', { phase: section.phase })}
        </p>
        {section.backend?.length ? (
          <div className="mt-5">
            <h2 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              <Database className="size-3.5" aria-hidden />
              {t('admin.placeholder.backend')}
            </h2>
            <ul className="mt-2 flex flex-wrap gap-1.5" dir="ltr">
              {section.backend.map((item) => (
                <li
                  key={item}
                  className="rounded-md bg-slate-100 px-2 py-1 font-mono text-[11px] text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                >
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
