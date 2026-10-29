import { placeNameIn } from '@/utils/places';
import { useEffect, useRef } from 'react';
import { Crosshair, ExternalLink, MapPin, X } from 'lucide-react';
import { useI18n } from '@/i18n';
import { isApproximateLocation, type PublicEvent } from '@/types/event';
import { formatDateTime, formatEventTime, formatRelative } from '@/utils/time';
import { hostnameOf } from '@/utils/url';
import { BreakingBadge, CategoryBadge, SeverityBadge, VerifiedBadge } from '@/components/common/Badges';
import { EventMedia } from './EventMedia';
import { EventText, eventTexts } from './EventText';
import { whereLabel } from '@/utils/places';
import { EventStaffEdit } from './EventStaffEdit';

interface EventDetailsDialogProps {
  event: PublicEvent;
  onClose: () => void;
  onLocate: (id: string) => void;
  /** Staff edits: reload after a change, and move the pin on the map. */
  onChanged?: () => void;
  onMovePin?: (id: string) => void;
  /** Other events split from the same report (one per category), and opening one of them. */
  related?: PublicEvent[];
  onOpenRelated?: (id: string) => void;
}

/**
 * Full event view: the whole description (no clamping), all metadata and the
 * source. A centred window on desktop, a full-height sheet on phones.
 * Event text is rendered as plain text — never as HTML.
 */
export function EventDetailsDialog({ event, onClose, onLocate, onChanged, onMovePin, related, onOpenRelated }: EventDetailsDialogProps) {
  const { t, locale, lang } = useI18n();
  const closeRef = useRef<HTMLButtonElement>(null);
  const { title } = eventTexts(event, lang);
  const where = whereLabel(event, lang);
  const sourceLabel = event.sourceName || (event.sourceUrl ? hostnameOf(event.sourceUrl) : '');

  // Focus the close button, close on Escape, give focus back on close, and keep the page from scrolling.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[3000] flex items-end justify-center sm:items-center sm:p-6" role="presentation">
      <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="event-details-title"
        className="relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl ring-1 ring-slate-900/10 sm:max-h-[85vh] sm:max-w-2xl sm:rounded-2xl dark:bg-slate-900 dark:ring-white/10"
      >
        <header className="flex items-start gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              {event.isBreaking ? <BreakingBadge /> : null}
              <CategoryBadge category={event.category} />
              <SeverityBadge severity={event.severity} />
            </div>
            <h2 id="event-details-title" className="mt-2 text-lg font-bold leading-snug text-slate-900 sm:text-xl dark:text-white" dir="auto">
              {title}
            </h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              <bdi>{formatDateTime(event.occurredAt, locale)}</bdi>
              <span className="mx-1.5" aria-hidden>
                ·
              </span>
              {formatRelative(event.occurredAt, locale, t('time.justNow'))}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="-me-1 inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-sky-500 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
          >
            <X className="size-5" aria-hidden />
          </button>
        </header>

        <div className="ofm-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          {where ? (
            <p className="mb-3 flex flex-wrap items-center gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-200">
              <MapPin className="size-4 shrink-0 text-slate-400" aria-hidden />
              <span dir="auto">{where}</span>
              {isApproximateLocation(event.locationPrecision) ? (
                <span className="rounded bg-amber-100 px-1.5 py-px text-[10px] font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                  {t('feed.approximate')}
                </span>
              ) : null}
            </p>
          ) : null}
          {event.places && event.places.length ? (
            <ul className="-mt-1 mb-3 flex flex-wrap gap-1.5" aria-label={t('details.places', { count: event.places.length + 1 })}>
              {event.places.map((p, i) => (
                <li
                  key={`${p.latitude},${p.longitude},${i}`}
                  className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                >
                  <MapPin className="size-3 shrink-0 text-slate-400" aria-hidden />
                  <bdi>{placeNameIn(p, lang)}</bdi>
                </li>
              ))}
            </ul>
          ) : null}
          <EventText event={event} />
          {related && related.length ? (
            <section aria-labelledby="event-related-title" className="mt-4 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/50">
              <h3 id="event-related-title" className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {t('details.sameReport', { count: related.length })}
              </h3>
              <ul className="space-y-1.5">
                {related.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => onOpenRelated?.(r.id)}
                      className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-start text-sm text-slate-700 hover:bg-white dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      <CategoryBadge category={r.category} />
                      <span className="min-w-0 flex-1 truncate" dir="auto">
                        {eventTexts(r, lang).title}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <EventStaffEdit event={event} onChanged={onChanged} onMovePin={onMovePin} />
          <EventMedia eventId={event.id} occurredAt={event.occurredAt} />
          {event.sources && event.sources.length ? (
            <section aria-labelledby="event-sources-title" className="mt-5 border-t border-slate-200 pt-4 dark:border-slate-800">
              <h3 id="event-sources-title" className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {t('details.sources', { count: event.sources.length + (sourceLabel ? 1 : 0) })}
              </h3>
              <ul className="space-y-1.5 text-sm">
                {sourceLabel ? (
                  <li className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
                    <span className="size-1.5 shrink-0 rounded-full bg-slate-400" aria-hidden />
                    {event.sourceUrl ? (
                      <a href={event.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="min-w-0 truncate text-sky-700 hover:underline dark:text-sky-400">
                        <bdi>{sourceLabel}</bdi>
                      </a>
                    ) : (
                      <bdi className="min-w-0 truncate">{sourceLabel}</bdi>
                    )}
                    <span className="shrink-0 text-xs text-slate-400">{t('details.firstReport')}</span>
                  </li>
                ) : null}
                {event.sources.map((s, i) => (
                  <li key={`${s.url ?? s.name}-${i}`} className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
                    <span className="size-1.5 shrink-0 rounded-full bg-slate-400" aria-hidden />
                    {s.url ? (
                      <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex min-w-0 items-center gap-1 text-sky-700 hover:underline dark:text-sky-400">
                        <bdi className="truncate">{s.name || hostnameOf(s.url)}</bdi>
                        <ExternalLink className="size-3 shrink-0" aria-hidden />
                      </a>
                    ) : (
                      <bdi className="min-w-0 truncate">{s.name}</bdi>
                    )}
                    {s.kind === 'context' ? (
                      <span className="shrink-0 rounded bg-slate-100 px-1.5 py-px text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        {t('details.background')}
                      </span>
                    ) : null}
                    {s.at ? <span className="shrink-0 font-mono text-xs text-slate-400 tabular-nums">{s.kind === 'context' ? new Date(s.at).toLocaleDateString(locale) : formatEventTime(s.at, locale)}</span> : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        <footer className="flex flex-wrap items-center gap-3 border-t border-slate-200 px-5 py-3 pb-[max(env(safe-area-inset-bottom),12px)] dark:border-slate-800">
          <VerifiedBadge verified={event.isVerified} />
          {sourceLabel ? (
            event.sourceUrl ? (
              <a
                href={event.sourceUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="inline-flex min-w-0 items-center gap-1 text-xs font-medium text-sky-700 underline-offset-2 hover:underline dark:text-sky-400"
              >
                <span className="truncate">
                  {t('feed.source')}: <bdi>{sourceLabel}</bdi>
                </span>
                <ExternalLink className="size-3.5 shrink-0" aria-hidden />
              </a>
            ) : (
              <span className="min-w-0 truncate text-xs text-slate-500 dark:text-slate-400">
                {t('feed.source')}: <bdi>{sourceLabel}</bdi>
              </span>
            )
          ) : null}
          <button
            type="button"
            onClick={() => onLocate(event.id)}
            className="ms-auto inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 text-sm font-semibold text-white hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
          >
            <Crosshair className="size-4" aria-hidden />
            {t('feed.locate')}
          </button>
        </footer>
      </section>
    </div>
  );
}
