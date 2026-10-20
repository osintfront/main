import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, Inbox, RefreshCw, Siren } from 'lucide-react';
import { useI18n } from '@/i18n';
import type { FocusRequest } from '@/hooks/useMapSelection';
import type { LoadStatus } from '@/hooks/useEvents';
import type { PublicEvent } from '@/types/event';
import type { HfcAlert } from '@/types/hfcAlert';
import { formatRelative } from '@/utils/time';
import { Button } from '@/components/common/Form';
import { EventCard } from './EventCard';
import { AlertCard } from './AlertCard';

interface EventFeedProps {
  events: PublicEvent[];
  status: LoadStatus;
  error: string | null;
  isDemo: boolean;
  query: string;
  selectedId: string | null;
  focusRequest: FocusRequest | null;
  lastUpdated: Date | null;
  onRetry: () => void;
  onClearQuery: () => void;
  onLocate: (id: string) => void;
  /** Active Home Front Command alerts, pinned above the events. */
  alerts?: HfcAlert[];
  alertsNow?: number;
  onLocateAlert?: (id: string) => void;
  /** Docked under the list on desktop. */
  footer?: ReactNode;
  /** Shown between cards on phones/tablets instead of the docked footer. */
  inlineAd?: ReactNode;
}

/** Re-renders relative timestamps once a minute. */
function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

function FeedSkeleton() {
  return (
    <ul className="space-y-3" aria-hidden>
      {Array.from({ length: 5 }).map((_, i) => (
        <li key={i} className="animate-pulse rounded-xl border border-slate-200 p-3.5 dark:border-slate-800">
          <div className="h-3 w-24 rounded bg-slate-200 dark:bg-slate-800" />
          <div className="mt-3 flex gap-2">
            <div className="h-4 w-28 rounded bg-slate-200 dark:bg-slate-800" />
            <div className="h-4 w-14 rounded bg-slate-200 dark:bg-slate-800" />
          </div>
          <div className="mt-3 h-4 w-11/12 rounded bg-slate-200 dark:bg-slate-800" />
          <div className="mt-2 h-3 w-full rounded bg-slate-100 dark:bg-slate-800/70" />
          <div className="mt-1.5 h-3 w-2/3 rounded bg-slate-100 dark:bg-slate-800/70" />
        </li>
      ))}
    </ul>
  );
}

export function EventFeed({
  events,
  status,
  error,
  isDemo,
  query,
  selectedId,
  focusRequest,
  lastUpdated,
  onRetry,
  onClearQuery,
  onLocate,
  footer,
  inlineAd,
  alerts = [],
  alertsNow,
  onLocateAlert,
}: EventFeedProps) {
  const { t, locale } = useI18n();
  const now = useNow();

  // When a marker (or a shared URL) selects an event, bring its card into view.
  useEffect(() => {
    if (!focusRequest || focusRequest.source === 'feed') return;
    const node = document.getElementById(`event-card-${focusRequest.id}`);
    if (!node) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    node.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
  }, [focusRequest, events]);

  return (
    <section aria-labelledby="feed-heading" className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <span className="relative flex size-2.5" aria-hidden>
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-500 opacity-60 motion-reduce:animate-none" />
          <span className="relative inline-flex size-2.5 rounded-full bg-red-500" />
        </span>
        <h2 id="feed-heading" className="text-sm font-bold uppercase tracking-wide text-slate-900 dark:text-white">
          {t('feed.title')}
        </h2>
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400" aria-live="polite">
          {status === 'ready' ? t('feed.count', { count: events.length }) : ''}
        </span>
        {isDemo ? (
          <span
            title={t('feed.demoHint')}
            className="ms-auto rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-900 dark:bg-amber-400/15 dark:text-amber-300"
          >
            {t('feed.demoBadge')}
          </span>
        ) : lastUpdated ? (
          <span className="ms-auto text-[11px] text-slate-400 dark:text-slate-500">
            {t('feed.updated', { time: formatRelative(lastUpdated.toISOString(), locale, t('time.justNow'), now) })}
          </span>
        ) : null}
      </div>

      <div className="ofm-scroll min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {alerts.length > 0 ? (
          <section aria-labelledby="hfc-heading" className="mb-4">
            <h3
              id="hfc-heading"
              className="mb-2 flex items-center gap-1.5 px-1 text-xs font-bold uppercase tracking-wide text-red-600 dark:text-red-400"
            >
              <Siren className="size-3.5" aria-hidden />
              {t('hfc.activeTitle', { count: alerts.length })}
            </h3>
            <ul className="space-y-3" aria-live="polite">
              {alerts.map((alert) => (
                <li key={alert.id}>
                  <AlertCard alert={alert} now={alertsNow ?? now} onLocate={(id) => onLocateAlert?.(id)} />
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {status === 'loading' ? (
          <FeedSkeleton />
        ) : status === 'error' ? (
          <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
            <AlertTriangle className="size-8 text-amber-500" aria-hidden />
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-white">{t('feed.errorTitle')}</p>
              {error ? <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{error}</p> : null}
            </div>
            <Button variant="secondary" size="sm" onClick={onRetry}>
              <RefreshCw className="size-3.5" aria-hidden />
              {t('feed.retry')}
            </Button>
          </div>
        ) : events.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
            <Inbox className="size-8 text-slate-400" aria-hidden />
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-white">{t('feed.emptyTitle')}</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {query ? t('feed.emptySearch', { query }) : t('feed.emptyNone')}
              </p>
            </div>
            {query ? (
              <Button variant="secondary" size="sm" onClick={onClearQuery}>
                {t('feed.clearSearch')}
              </Button>
            ) : null}
          </div>
        ) : (
          <ul className="space-y-3">
            {events.map((event, index) => (
              <Fragment key={event.id}>
                <li>
                  <EventCard event={event} selected={event.id === selectedId} now={now} onLocate={onLocate} />
                </li>
                {inlineAd && index === Math.min(1, events.length - 1) ? <li className="lg:hidden">{inlineAd}</li> : null}
              </Fragment>
            ))}
          </ul>
        )}
      </div>
      {footer}
    </section>
  );
}
