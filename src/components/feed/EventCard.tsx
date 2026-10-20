import { memo, type CSSProperties, type MouseEvent } from 'react';
import { Crosshair, ExternalLink, MapPin } from 'lucide-react';
import { useI18n } from '@/i18n';
import { isApproximateLocation, type PublicEvent } from '@/types/event';
import { cn } from '@/utils/cn';
import { formatEventTime, formatRelative } from '@/utils/time';
import { hostnameOf } from '@/utils/url';
import { BreakingBadge, CategoryBadge, SeverityBadge, VerifiedBadge } from '@/components/common/Badges';
import { EventMedia } from './EventMedia';

interface EventCardProps {
  event: PublicEvent;
  selected: boolean;
  now: number;
  onLocate: (id: string) => void;
  isNew?: boolean;
}

function EventCardImpl({ event, selected, now, onLocate, isNew = false }: EventCardProps) {
  const { t, locale, lang } = useI18n();
  const title = event.translations[lang]?.title || event.title;
  const description = event.translations[lang]?.description || event.description;
  const where = [event.locationName, event.country].filter(Boolean).join(', ');
  const sourceLabel = event.sourceName || (event.sourceUrl ? hostnameOf(event.sourceUrl) : '');

  const handleCardClick = (e: MouseEvent<HTMLElement>) => {
    // Links and buttons inside the card handle themselves.
    if ((e.target as HTMLElement).closest('a,button')) return;
    onLocate(event.id);
  };

  return (
    <article
      id={`event-card-${event.id}`}
      aria-current={selected ? 'true' : undefined}
      onClick={handleCardClick}
      style={{ '--card-accent': event.category.color } as CSSProperties}
      className={cn(
        isNew && 'ofm-card--new',
        'ofm-card group relative cursor-pointer rounded-xl border bg-white p-3.5 transition-[background-color,border-color,box-shadow] duration-150',
        'dark:bg-slate-900/70',
        selected
          ? 'border-sky-500 bg-sky-50/70 shadow-[0_0_0_3px_rgba(14,165,233,0.18)] dark:border-sky-400 dark:bg-sky-500/10'
          : 'border-slate-200 hover:border-slate-300 hover:shadow-sm dark:border-slate-800 dark:hover:border-slate-700',
      )}
    >
      <span className="ofm-card__accent" aria-hidden />
      <header className="flex flex-wrap items-center gap-1.5">
        <time
          dateTime={event.occurredAt}
          className="me-1 font-mono text-[11px] font-medium text-slate-500 tabular-nums dark:text-slate-400"
        >
          <bdi>{formatEventTime(event.occurredAt, locale)}</bdi>
          <span className="mx-1 text-slate-300 dark:text-slate-600" aria-hidden>
            ·
          </span>
          {formatRelative(event.occurredAt, locale, t('time.justNow'), now)}
        </time>
        {isNew ? (
          <span className="rounded-md bg-sky-600 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">{t('feed.new')}</span>
        ) : null}
        {event.isBreaking ? <BreakingBadge /> : null}
      </header>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <CategoryBadge category={event.category} />
        <SeverityBadge severity={event.severity} />
      </div>

      <h3 className="mt-2 text-[15px] font-semibold leading-snug text-slate-900 dark:text-white" dir="auto">
        {title}
      </h3>
      {description ? (
        <p className="mt-1 line-clamp-3 text-[13px] leading-relaxed text-slate-600 dark:text-slate-300" dir="auto">
          {description}
        </p>
      ) : null}

      <EventMedia eventId={event.id} occurredAt={event.occurredAt} />

      {where ? (
        <p className="mt-2 flex items-center gap-1 text-xs font-medium text-slate-600 dark:text-slate-300">
          <MapPin className="size-3.5 shrink-0 text-slate-400" aria-hidden />
          <span className="truncate" dir="auto">
            {where}
          </span>
          {isApproximateLocation(event.locationPrecision) ? (
            <span
              className="shrink-0 rounded bg-amber-100 px-1.5 py-px text-[10px] font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
              title={t('feed.approximateHint')}
            >
              {t('feed.approximate')}
            </span>
          ) : null}
        </p>
      ) : null}

      <footer className="mt-3 flex items-center gap-3 border-t border-slate-100 pt-2.5 dark:border-slate-800">
        <VerifiedBadge verified={event.isVerified} />
        {sourceLabel ? (
          event.sourceUrl ? (
            <a
              href={event.sourceUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="inline-flex min-w-0 items-center gap-1 text-[11px] font-medium text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline dark:text-slate-400 dark:hover:text-slate-200"
            >
              <span className="truncate">
                {t('feed.source')}: <bdi>{sourceLabel}</bdi>
              </span>
              <ExternalLink className="size-3 shrink-0" aria-hidden />
            </a>
          ) : (
            <span className="truncate text-[11px] text-slate-500 dark:text-slate-400">
              {t('feed.source')}: <bdi>{sourceLabel}</bdi>
            </span>
          )
        ) : null}
        <button
          type="button"
          onClick={() => onLocate(event.id)}
          aria-label={t('feed.locateLabel', { title })}
          className="ms-auto inline-flex h-7 shrink-0 items-center gap-1 rounded-md bg-slate-900 px-2.5 text-xs font-semibold text-white transition-colors hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
        >
          <Crosshair className="size-3.5" aria-hidden />
          {t('feed.locate')}
        </button>
      </footer>
    </article>
  );
}

export const EventCard = memo(EventCardImpl);
