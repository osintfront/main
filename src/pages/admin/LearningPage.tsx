import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Trash2 } from 'lucide-react';
import { Alert, Spinner } from '@/components/common/Feedback';
import { useToast } from '@/components/common/Toast';
import { usePermissions } from '@/hooks/usePermissions';
import { useI18n } from '@/i18n';
import { friendlyError } from '@/services/serviceError';
import {
  deleteCategoryCorrection,
  deleteLearnedPlace,
  fetchCategoryCorrections,
  fetchLearnedPlaces,
  type CategoryCorrection,
  type LearnedPlace,
} from '@/services/learningService';
import { formatDateTime } from '@/utils/time';

/** What the system learned from editors' corrections — review and remove. */
export function LearningPage() {
  const { t, locale, categoryLabel } = useI18n();
  const toast = useToast();
  const { can } = usePermissions();
  const canManage = can('settings.manage');
  const [places, setPlaces] = useState<LearnedPlace[]>([]);
  const [cats, setCats] = useState<CategoryCorrection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [p, c] = await Promise.all([fetchLearnedPlaces(), fetchCategoryCorrections()]);
      setPlaces(p);
      setCats(c);
      setError(null);
    } catch (err) {
      setError(friendlyError(err, t));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const removePlace = async (p: LearnedPlace) => {
    try {
      await deleteLearnedPlace(p.id);
      setPlaces((l) => l.filter((x) => x.id !== p.id));
      toast.success(t('learning.removed'));
    } catch (err) {
      toast.error(friendlyError(err, t));
    }
  };
  const removeCat = async (c: CategoryCorrection) => {
    try {
      await deleteCategoryCorrection(c.id);
      setCats((l) => l.filter((x) => x.id !== c.id));
      toast.success(t('learning.removed'));
    } catch (err) {
      toast.error(friendlyError(err, t));
    }
  };

  if (loading) return <Spinner label={t('common.loading')} />;

  const card = 'overflow-hidden rounded-xl bg-white ring-1 ring-slate-900/5 dark:bg-slate-900 dark:ring-white/10';
  const del = 'rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10';

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-xl font-bold text-slate-900 dark:text-white">{t('admin.nav.learning')}</h1>
      <p className="mt-1 max-w-3xl text-sm text-slate-600 dark:text-slate-400">{t('learning.intro')}</p>
      {error ? <Alert tone="error" className="mt-4">{error}</Alert> : null}

      <section className={`mt-5 ${card}`}>
        <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">{t('learning.places', { count: String(places.length) })}</h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{t('learning.placesHint')}</p>
        </div>
        {places.length === 0 ? (
          <p className="px-4 py-5 text-sm text-slate-500">{t('learning.placesEmpty')}</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {places.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-sm">
                <span className="min-w-0 flex-1" dir="auto">
                  <span className="font-medium text-slate-800 dark:text-slate-100">{p.name}</span>
                  <span className="text-slate-400"> → </span>
                  <span className="text-slate-700 dark:text-slate-300">{p.locationName || p.name}</span>
                  {p.country ? <span className="text-slate-500"> · {p.country}</span> : null}
                </span>
                <a
                  href={`https://www.google.com/maps?q=${p.latitude},${p.longitude}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  dir="ltr"
                  className="inline-flex items-center gap-1 text-xs text-sky-700 hover:underline dark:text-sky-400"
                >
                  {p.latitude.toFixed(4)}, {p.longitude.toFixed(4)}
                  <ExternalLink className="size-3" aria-hidden />
                </a>
                <span className="text-xs tabular-nums text-slate-500">{t('learning.used', { count: String(p.timesUsed) })}</span>
                <span className="text-xs text-slate-400">{formatDateTime(p.updatedAt, locale)}</span>
                {canManage ? (
                  <button type="button" onClick={() => void removePlace(p)} className={del} aria-label={t('learning.remove')}>
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={`mt-5 ${card}`}>
        <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">{t('learning.categories', { count: String(cats.length) })}</h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{t('learning.categoriesHint')}</p>
        </div>
        {cats.length === 0 ? (
          <p className="px-4 py-5 text-sm text-slate-500">{t('learning.categoriesEmpty')}</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {cats.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-sm">
                <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-300" dir="auto" title={c.text}>
                  {c.text}
                </span>
                <span className="text-xs">
                  <span className="text-slate-400 line-through">{categoryLabel(c.fromSlug)}</span>
                  <span className="text-slate-400"> → </span>
                  <span className="font-semibold text-emerald-700 dark:text-emerald-400">{categoryLabel(c.toSlug)}</span>
                </span>
                <span className="text-xs text-slate-400">{formatDateTime(c.createdAt, locale)}</span>
                {canManage ? (
                  <button type="button" onClick={() => void removeCat(c)} className={del} aria-label={t('learning.remove')}>
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
