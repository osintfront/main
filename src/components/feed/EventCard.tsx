import { memo, useState, type CSSProperties, type MouseEvent } from 'react';
import { Crosshair, ExternalLink, FileText, MapPin, MapPinOff, Star } from 'lucide-react';
import { useI18n } from '@/i18n';
import { isApproximateLocation, type PublicEvent } from '@/types/event';
import { cn } from '@/utils/cn';
import { isOnMap } from '@/lib/eventFilters';
import { formatEventTime, formatRelative } from '@/utils/time';
import { hostnameOf } from '@/utils/url';
import { BreakingBadge, CategoryBadge, SecondaryBadges, SeverityBadge, VerifiedBadge } from '@/components/common/Badges';
import { EventMedia } from './EventMedia';
import { EventText, eventTexts } from './EventText';
import { useMediaTranslate } from './MediaTranslate';
import { whereLabel } from '@/utils/places';

interface EventCardProps {
  event: PublicEvent;
  selected: boolean;
  now: number;
  onLocate: (id: string) => void;
  isNew?: boolean;
  /** Opens the full event window (shown when the text is clamped). */
  onOpenDetails?: (id: string) => void;
  /** The filter set this event fits (first one), shown as a small coloured tag. */
  setTag?: { name: string; color: string; topic?: string; star?: boolean; more?: number };
}

function EventCardImpl({ event, selected, now, onLocate, isNew = false, onOpenDetails, setTag }: EventCardProps) {
  const { t, locale, lang } = useI18n();
  const { title } = eventTexts(event, lang);
  const where = whereLabel(event, lang);
  const placeCount = (event.places?.length ?? 0) + 1;
  const onMap = isOnMap(event);
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
        <SecondaryBadges categories={event.secondaryCategories} />
        <SeverityBadge severity={event.severity} />
        {setTag ? (
          <span data-set-tag className="inline-flex max-w-[16rem] items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
            <span className="size-2 shrink-0 rounded-full" style={{ background: setTag.color }} aria-hidden />
            <span className={setTag.topic ? 'max-w-[7rem] shrink-0 truncate' : 'truncate'} dir="auto">
              {setTag.name}
            </span>
            {setTag.topic ? (
              <span data-eei-topic className="inline-flex min-w-0 items-center gap-0.5 font-medium text-slate-600 dark:text-slate-300">
                ·{setTag.star ? <Star className="size-3 shrink-0 fill-amber-400 text-amber-500" aria-hidden /> : null}
                <span className="truncate" dir="auto">{setTag.topic}</span>
              </span>
            ) : null}
            {setTag.more ? <span className="shrink-0 font-mono text-[10px] opacity-70">+{setTag.more}</span> : null}
          </span>
        ) : null}
      </div>

      <h3 className="mt-2 text-[15px] font-semibold leading-snug text-slate-900 dark:text-white" dir="auto">
        {title}
      </h3>
      <CardText event={event} />

      <EventMedia eventId={event.id} occurredAt={event.occurredAt} kinds={event.mediaKinds} />

      {where ? (
        <p className="mt-2 flex items-center gap-1 text-xs font-medium text-slate-600 dark:text-slate-300">
          <MapPin className="size-3.5 shrink-0 text-slate-400" aria-hidden />
          <span className="truncate" dir="auto">
            {where}
          </span>
          {placeCount > 1 ? (
            <span
              className="shrink-0 rounded bg-sky-100 px-1.5 py-px text-[10px] font-semibold text-sky-800 dark:bg-sky-500/15 dark:text-sky-300"
              title={t('feed.placesHint')}
            >
              {t('feed.places', { count: placeCount })}
            </span>
          ) : isApproximateLocation(event.locationPrecision) ? (
            <span
              className="shrink-0 rounded bg-amber-100 px-1.5 py-px text-[10px] font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
              title={t('feed.approximateHint')}
            >
              {t('feed.approximate')}
            </span>
          ) : null}
        </p>
      ) : null}

      {/* Two groups that wrap as units: info (badge, source, sources) and actions (details, map). */}
      <footer className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-slate-100 pt-2.5 dark:border-slate-800">
        <div className="flex min-w-0 max-w-full items-center gap-3">
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
        {event.sources && event.sources.length ? (
          <button
            type="button"
            onClick={() => onOpenDetails?.(event.id)}
            className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
            title={t('details.moreSourcesHint')}
          >
            {t('details.moreSources', { count: event.sources.length })}
          </button>
        ) : null}
        </div>
        <div className="ms-auto flex shrink-0 items-center gap-2">
        {onOpenDetails ? (
          <button
            type="button"
            onClick={() => onOpenDetails(event.id)}
            className="inline-flex h-9 shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-slate-200 px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 sm:h-7 sm:rounded-md dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <FileText className="size-3.5" aria-hidden />
            {t('details.open')}
          </button>
        ) : null}
        {!onMap ? (
          <span className={cn('inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400')}>
            <MapPinOff className="size-3.5" aria-hidden />
            {t('feed.notOnMap')}
          </span>
        ) : (
        <button
          type="button"
          onClick={() => onLocate(event.id)}
          aria-label={t('feed.locateLabel', { title })}
          className={cn('inline-flex h-9 shrink-0 items-center gap-1 whitespace-nowrap rounded-lg bg-slate-900 px-3 text-xs sm:h-7 sm:rounded-md sm:px-2.5 font-semibold text-white transition-colors hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200')}
        >
          <Crosshair className="size-3.5" aria-hidden />
          {t('feed.locate')}
        </button>
        )}
        </div>
      </footer>
    </article>
  );
}

export const EventCard = memo(EventCardImpl);

/** The card's text with "Translate image/video" after Expand (as in the details window). */
function CardText({ event }: { event: PublicEvent }) {
  const [expOpen, setExpOpen] = useState(false);
  const mt = useMediaTranslate(event, expOpen);
  return <EventText event={event} compact onExpandedChange={setExpOpen} expandButtons={mt.button} expandPanel={mt.panel} />;
}
