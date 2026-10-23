import { useMemo } from 'react';
import { getCategoryIcon } from '@/data/categoryRegistry';
import { useI18n } from '@/i18n';
import type { PublicEvent } from '@/types/event';
import { HFC_CATEGORY } from '@/config/hfcThreats';

/** Map legend: what the symbols on the map mean (categories on the map, with counts). Explains only — filtering is in the filter panel. */
export function CategoryLegend({ events, alertCount = 0 }: { events: PublicEvent[]; alertCount?: number }) {
  const { t, categoryLabel } = useI18n();
  const rows = useMemo(() => {
    const counts = new Map<string, { count: number; event: PublicEvent }>();
    for (const e of events) {
      const entry = counts.get(e.category.slug);
      if (entry) entry.count += 1;
      else counts.set(e.category.slug, { count: 1, event: e });
    }
    const list = [...counts.values()].sort((a, b) => b.count - a.count);
    // Active Home Front Command alerts always lead the legend.
    if (alertCount > 0) list.unshift({ count: alertCount, event: { category: HFC_CATEGORY } as PublicEvent });
    return list;
  }, [events, alertCount]);

  return (
    <section aria-labelledby="legend-heading" className="w-full">
      <h2 id="legend-heading" className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        {t('map.legend')}
      </h2>
      <p className="mb-2 text-[11px] leading-snug text-slate-500 dark:text-slate-400">{t('map.legendFilterHint')}</p>
      {rows.length === 0 ? (
        <p className="text-xs text-slate-500 dark:text-slate-400">{t('map.legendEmpty')}</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map(({ count, event }) => {
            const Icon = getCategoryIcon(event.category.icon);
            return (
              <li key={event.category.slug} className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                <span
                  className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-white"
                  style={{ backgroundColor: event.category.markerColor }}
                  aria-hidden
                >
                  <Icon className="size-3" />
                </span>
                <span className="min-w-0 flex-1 truncate">{categoryLabel(event.category.slug, event.category.name)}</span>
                <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">{count}</span>
              </li>
            );
          })}
        </ul>
      )}
      <ul className="mt-3 space-y-1.5 border-t border-slate-200 pt-2 text-[11px] leading-snug text-slate-600 dark:border-slate-700 dark:text-slate-400">
        <li className="flex items-start gap-2">
          <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-white text-[10px] font-bold text-slate-800 ring-2 ring-sky-500 dark:bg-slate-800 dark:text-white" aria-hidden>
            5
          </span>
          <span>{t('map.legendCluster')}</span>
        </li>
        <li className="flex items-start gap-2">
          <span className="mt-0.5 inline-block size-5 shrink-0 rounded border-2 border-red-600 bg-red-500/30" aria-hidden />
          <span>{t('map.legendAlerts')}</span>
        </li>
      </ul>
    </section>
  );
}
