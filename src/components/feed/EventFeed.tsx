import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, Inbox, RefreshCw, Siren } from 'lucide-react';
import { useI18n } from '@/i18n';
import type { FocusRequest } from '@/hooks/useMapSelection';
import type { LoadStatus } from '@/hooks/useEvents';
import type { PublicEvent } from '@/types/event';
import type { HfcAlert } from '@/types/hfcAlert';
import { formatRelative } from '@/utils/time';
import { cn } from '@/utils/cn';
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
  /** Header refresh button: reload the events and go back to the newest. */
  onRefresh?: () => void;
  onClearQuery: () => void;
  onLocate: (id: string) => void;
  /** Events that just arrived by push — briefly highlighted. */
  newIds?: ReadonlySet<string>;
  onOpenDetails?: (id: string) => void;
  /** Active Home Front Command alerts, pinned above the events. */
  alerts?: HfcAlert[];
  alertsNow?: number;
  onLocateAlert?: (id: string) => void;
  /** Archive mode: different heading, no live indicator, a toolbar (day picker). */
  title?: string;
  live?: boolean;
  toolbar?: ReactNode;
  emptyText?: string;
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
  onRefresh,
  onClearQuery,
  onLocate,
  newIds,
  onOpenDetails,
  footer,
  inlineAd,
  alerts = [],
  alertsNow,
  onLocateAlert,
  title,
  live = true,
  toolbar,
  emptyText,
}: EventFeedProps) {
  const { t, locale } = useI18n();
  const now = useNow();

  // When a marker (or a shared URL) selects an event, bring its card into view —
  // once per selection. (Re-running on every list refresh pulled the reader back
  // to that card while they were scrolling through newer events.)
  const scrolledFor = useRef<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [spinning, setSpinning] = useState(false);
  const refresh = () => {
    if (!onRefresh) return;
    onRefresh();
    listRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    setSpinning(true);
    window.setTimeout(() => setSpinning(false), 800);
  };
  useEffect(() => {
    if (!focusRequest || focusRequest.source === 'feed') return;
    if (scrolledFor.current === focusRequest.nonce) return;
    const node = document.getElementById(`event-card-${focusRequest.id}`);
    if (!node) return; // not loaded yet: try again when the list arrives
    scrolledFor.current = focusRequest.nonce;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    node.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
  }, [focusRequest, events]);

  return (
    <section aria-labelledby="feed-heading" className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        {live ? (
          <span className="relative flex size-2.5" aria-hidden>
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-500 opacity-60 motion-reduce:animate-none" />
            <span className="relative inline-flex size-2.5 rounded-full bg-red-500" />
          </span>
        ) : null}
        <h2 id="feed-heading" className="text-sm font-bold uppercase tracking-wide text-slate-900 dark:text-white">
          {title ?? t('feed.title')}
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
        ) : live && lastUpdated ? (
          <span className="ms-auto text-[11px] text-slate-400 dark:text-slate-500">
            {t('feed.updated', { time: formatRelative(lastUpdated.toISOString(), locale, t('time.justNow'), now) })}
          </span>
        ) : null}
        {onRefresh ? (
          <button
            type="button"
            onClick={refresh}
            aria-label={t('feed.refresh')}
            title={t('feed.refresh')}
            className={cn(
              'inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-sky-500 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white',
              !isDemo && !(live && lastUpdated) && 'ms-auto',
            )}
          >
            <RefreshCw className={cn('size-4', spinning && 'animate-spin motion-reduce:animate-none')} aria-hidden />
          </button>
        ) : null}
      </div>

      {toolbar ? <div className="border-b border-slate-200 px-3 py-2.5 dark:border-slate-800">{toolbar}</div> : null}
      <div ref={listRef} className="ofm-scroll min-h-0 flex-1 overflow-y-auto px-3 py-3">
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
                {query ? t('feed.emptySearch', { query }) : (emptyText ?? t('feed.emptyNone'))}
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
            {/* One flat keyed list: the ad item has its own key, so new events move it but never
                remount it (an ad must not reload without a user action). */}
            {events.flatMap((event, index) => {
              const items = [
                <li key={event.id}>
                  <EventCard event={event} selected={event.id === selectedId} now={now} onLocate={onLocate} isNew={newIds?.has(event.id) ?? false} onOpenDetails={onOpenDetails} />
                </li>,
              ];
              if (inlineAd && index === Math.min(1, events.length - 1)) {
                items.push(
                  <li key="inline-ad" className="lg:hidden">
                    {inlineAd}
                  </li>,
                );
              }
              return items;
            })}
          </ul>
        )}
      </div>
      {footer}
    </section>
  );
}
