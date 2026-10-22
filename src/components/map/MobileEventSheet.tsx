import { useEffect, useRef } from 'react';
import { ChevronRight, ExternalLink, MapPin, X } from 'lucide-react';
import { useI18n } from '@/i18n';
import { isApproximateLocation, type PublicEvent } from '@/types/event';
import { formatEventTime, formatRelative } from '@/utils/time';
import { hostnameOf } from '@/utils/url';
import { previewText } from '@/utils/text';
import { BreakingBadge, CategoryBadge, SeverityBadge } from '@/components/common/Badges';
import { whereLabel } from '@/utils/places';

interface MobileEventSheetProps {
  event: PublicEvent;
  onClose: () => void;
  onOpenDetails: (id: string) => void;
}

/**
 * Phones: tapping a pin shows the event in a card along the bottom of the map
 * (instead of a small popup over the pins). Swipe down or tap × to close.
 */
export function MobileEventSheet({ event, onClose, onOpenDetails }: MobileEventSheetProps) {
  const { t, locale, lang, dir } = useI18n();
  const title = event.translations[lang]?.title || event.title;
  const description = previewText(event.translations[lang]?.description || event.description);
  const where = whereLabel(event, lang);
  const placeCount = (event.places?.length ?? 0) + 1;
  const sourceLabel = event.sourceName || (event.sourceUrl ? hostnameOf(event.sourceUrl) : '');

  // Swipe down to dismiss.
  const startY = useRef<number | null>(null);
  const sheetRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <section
      ref={sheetRef}
      aria-label={title}
      className="ofm-sheet pointer-events-auto mx-3 rounded-2xl bg-white p-3.5 shadow-2xl ring-1 ring-slate-900/10 dark:bg-slate-900 dark:ring-white/10"
      onTouchStart={(e) => (startY.current = e.touches[0]?.clientY ?? null)}
      onTouchMove={(e) => {
        if (startY.current === null || !sheetRef.current) return;
        const dy = Math.max(0, (e.touches[0]?.clientY ?? 0) - startY.current);
        sheetRef.current.style.transform = `translateY(${dy}px)`;
      }}
      onTouchEnd={(e) => {
        const dy = (e.changedTouches[0]?.clientY ?? 0) - (startY.current ?? 0);
        startY.current = null;
        if (sheetRef.current) sheetRef.current.style.transform = '';
        if (dy > 60) onClose();
      }}
    >
      <div className="mx-auto -mt-1 mb-2 h-1 w-10 rounded-full bg-slate-300 dark:bg-slate-700" aria-hidden />
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          {event.isBreaking ? <BreakingBadge /> : null}
          <CategoryBadge category={event.category} />
          <SeverityBadge severity={event.severity} />
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.close')}
          className="-me-1.5 -mt-1 inline-flex size-10 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-sky-500 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
        >
          <X className="size-5" aria-hidden />
        </button>
      </div>

      <button type="button" onClick={() => onOpenDetails(event.id)} className="mt-1.5 block w-full text-start">
        <h3 className="line-clamp-2 text-base font-semibold leading-snug text-slate-900 dark:text-white" dir="auto">
          {title}
        </h3>
        {description ? (
          <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300" dir="auto">
            {description}
          </p>
        ) : null}
      </button>

      <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
        <time dateTime={event.occurredAt} className="font-mono tabular-nums">
          <bdi>{formatEventTime(event.occurredAt, locale)}</bdi> · {formatRelative(event.occurredAt, locale, t('time.justNow'))}
        </time>
        {where ? (
          <span className="inline-flex min-w-0 items-center gap-1 font-medium text-slate-600 dark:text-slate-300">
            <MapPin className="size-3.5 shrink-0 text-slate-400" aria-hidden />
            <span className="truncate" dir="auto">
              {where}
            </span>
          </span>
        ) : null}
        {placeCount > 1 ? (
          <span className="rounded bg-sky-100 px-1.5 py-px text-[10px] font-semibold text-sky-800 dark:bg-sky-500/15 dark:text-sky-300">
            {t('feed.places', { count: placeCount })}
          </span>
        ) : isApproximateLocation(event.locationPrecision) ? (
          <span className="rounded bg-amber-100 px-1.5 py-px text-[10px] font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
            {t('feed.approximate')}
          </span>
        ) : null}
      </p>

      <div className="mt-3 flex items-center gap-2">
        {event.sourceUrl && sourceLabel ? (
          <a
            href={event.sourceUrl}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="inline-flex h-10 min-w-0 items-center gap-1 rounded-xl px-2 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <span className="truncate">
              <bdi>{sourceLabel}</bdi>
            </span>
            <ExternalLink className="size-3.5 shrink-0" aria-hidden />
          </a>
        ) : null}
        <button
          type="button"
          onClick={() => onOpenDetails(event.id)}
          className="ms-auto inline-flex h-10 shrink-0 items-center gap-1 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
        >
          {t('map.viewEvent')}
          <ChevronRight className={dir === 'rtl' ? 'size-4 -scale-x-100' : 'size-4'} aria-hidden />
        </button>
      </div>
    </section>
  );
}
