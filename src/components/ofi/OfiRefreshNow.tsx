import { useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { useI18n } from '@/i18n';
import { useToast } from '@/components/common/Toast';
import { adminRecompute } from '@/services/ofiService';
import { formatDateTime } from '@/utils/time';

/** The only account allowed to force an update (the server also requires the super_admin role). */
export const OFI_OWNER_EMAIL = 'osintfront@gmail.com';
const EVERY_H = 8;

/**
 * "Update now": reads every source again and recalculates, outside the 8-hour cycle.
 * The next automatic update is then 8 hours after this one (the runner reschedules it).
 */
export function OfiRefreshNow({ slug, last, next, onDone }: {
  slug: string; last: string | null; next: string | null; onDone: () => void;
}) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const go = async () => {
    setBusy(true);
    try {
      await adminRecompute(slug);
      toast.success(t('ofi.refresh.done', { h: EVERY_H }));
      onDone();
    } catch (e) {
      toast.error(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label={t('ofi.refresh.title')}
      className="flex flex-col gap-3 rounded-2xl border-2 border-dashed border-sky-300 bg-sky-50/50 p-4 sm:flex-row sm:items-center sm:justify-between dark:border-sky-500/40 dark:bg-sky-500/5">
      <div className="min-w-0 text-sm">
        <p className="font-semibold text-slate-900 dark:text-white">{t('ofi.refresh.title')}</p>
        <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
          {last ? t('ofi.refresh.last', { time: formatDateTime(last, locale) }) : '–'}
        </p>
        {next ? (
          <p className="text-xs text-slate-600 dark:text-slate-300">{t('ofi.refresh.next', { time: formatDateTime(next, locale), h: EVERY_H })}</p>
        ) : null}
        {busy ? <p className="mt-1 text-xs text-sky-700 dark:text-sky-400" role="status">{t('ofi.refresh.running')}</p> : null}
      </div>
      <button type="button" onClick={go} disabled={busy}
        className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-sky-600 px-5 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-60">
        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <RefreshCw className="size-4" aria-hidden />}
        {t('ofi.refresh.btn')}
      </button>
    </section>
  );
}
