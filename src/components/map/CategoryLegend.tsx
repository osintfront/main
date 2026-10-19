import { useMemo } from 'react';
import { getCategoryIcon } from '@/data/categoryRegistry';
import { useI18n } from '@/i18n';
import type { PublicEvent } from '@/types/event';

/** Categories present on the map with event counts. Becomes the layer control in Phase 6. */
export function CategoryLegend({ events }: { events: PublicEvent[] }) {
  const { t, categoryLabel } = useI18n();
  const rows = useMemo(() => {
    const counts = new Map<string, { count: number; event: PublicEvent }>();
    for (const e of events) {
      const entry = counts.get(e.category.slug);
      if (entry) entry.count += 1;
      else counts.set(e.category.slug, { count: 1, event: e });
    }
    return [...counts.values()].sort((a, b) => b.count - a.count);
  }, [events]);

  return (
    <section aria-labelledby="legend-heading" className="w-full">
      <h2 id="legend-heading" className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        {t('map.legend')}
      </h2>
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
    </section>
  );
}
