import { useCallback, useDeferredValue, useMemo, useState } from 'react';
import { List, Map as MapIcon } from 'lucide-react';
import { useI18n } from '@/i18n';
import { usePublicEvents } from '@/hooks/useEvents';
import { useMapSelection } from '@/hooks/useMapSelection';
import { useHfcAlerts } from '@/hooks/useHfcAlerts';
import type { PublicEvent } from '@/types/event';
import { cn } from '@/utils/cn';
import { AdSlot } from '@/components/common/AdSlot';
import { TopNav } from '@/components/layout/TopNav';
import { EventFeed } from '@/components/feed/EventFeed';
import { MapView } from '@/components/map/MapView';
import { CategoryLegend } from '@/components/map/CategoryLegend';

type MobilePane = 'map' | 'feed';

function matchesQuery(event: PublicEvent, needle: string, categoryName: string): boolean {
  if (!needle) return true;
  const haystack = [event.title, event.description, event.locationName, event.city, event.region, event.country, categoryName]
    .join(' ')
    .toLocaleLowerCase();
  return needle
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

export function MapPage() {
  const { t, categoryLabel } = useI18n();
  const { events, status, error, isDemo, lastUpdated, reload } = usePublicEvents();
  const { selectedId, focusRequest, select } = useMapSelection();
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query.trim());
  const [mobilePane, setMobilePane] = useState<MobilePane>('map');
  const { alerts, now: alertsNow } = useHfcAlerts();
  const [alertFocus, setAlertFocus] = useState<{ id: string; nonce: number } | null>(null);
  const handleLocateAlert = useCallback((id: string) => {
    setMobilePane('map');
    setAlertFocus({ id, nonce: Date.now() });
  }, []);

  const visibleEvents = useMemo(
    () =>
      events
        .filter((e) => matchesQuery(e, deferredQuery, categoryLabel(e.category.slug, e.category.name)))
        .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()),
    [events, deferredQuery, categoryLabel],
  );

  // Card → map: fly to marker. On phones, switch to the map pane first.
  const handleLocate = useCallback(
    (id: string) => {
      setMobilePane('map');
      select(id, 'feed');
    },
    [select],
  );

  // Marker → card: highlight and scroll the card into view.
  const handleMarkerSelect = useCallback((id: string) => select(id, 'map'), [select]);

  // Popup "View event": show the full card (switches to the feed on phones).
  const handleViewEvent = useCallback(
    (id: string) => {
      setMobilePane('feed');
      select(id, 'popup');
    },
    [select],
  );

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <a
        href="#main-map"
        className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-[2000] focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:shadow"
      >
        {t('common.skipToContent')}
      </a>
      <TopNav query={query} onQueryChange={setQuery} />

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(340px,380px)_minmax(0,1fr)] xl:grid-cols-[380px_minmax(0,1fr)_196px]">
        {/* Column 1 — live feed (inline-start: left in English, right in Hebrew) */}
        <aside
          className={cn(
            'min-h-0 flex-col border-e border-slate-200 bg-white pb-16 lg:flex lg:pb-0 dark:border-slate-800 dark:bg-slate-950',
            mobilePane === 'feed' ? 'flex' : 'hidden',
          )}
        >
          <EventFeed
            events={visibleEvents}
            status={status}
            error={error}
            isDemo={isDemo}
            query={deferredQuery}
            selectedId={selectedId}
            focusRequest={focusRequest}
            lastUpdated={lastUpdated}
            onRetry={reload}
            onClearQuery={() => setQuery('')}
            onLocate={handleLocate}
            alerts={alerts}
            alertsNow={alertsNow}
            onLocateAlert={handleLocateAlert}
            footer={
              <div className="hidden border-t border-slate-200 p-3 lg:block [@media(max-height:720px)]:hidden dark:border-slate-800">
                <AdSlot variant="square" slotId="feed-rectangle" />
              </div>
            }
            inlineAd={<AdSlot variant="square" slotId="feed-rectangle-inline" className="py-1" />}
          />
        </aside>

        {/* Column 2 — banner + map */}
        <main
          id="main-map"
          className={cn('min-h-0 flex-col pb-16 lg:flex lg:pb-0', mobilePane === 'map' ? 'flex' : 'hidden')}
        >
          <div className="flex shrink-0 justify-center border-b border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-950">
            <AdSlot variant="banner" slotId="map-leaderboard" />
          </div>
          <div className="relative min-h-0 flex-1">
            <MapView
              events={visibleEvents}
              selectedId={selectedId}
              focusRequest={focusRequest}
              onMarkerSelect={handleMarkerSelect}
              onViewEvent={handleViewEvent}
              alerts={alerts}
              alertFocus={alertFocus}
            />
          </div>
        </main>

        {/* Column 3 — legend + skyscraper (wide screens) */}
        <aside className="ofm-scroll hidden min-h-0 flex-col items-center gap-5 overflow-y-auto border-s border-slate-200 bg-white px-4 py-4 xl:flex dark:border-slate-800 dark:bg-slate-950">
          <CategoryLegend events={visibleEvents} alertCount={alerts.length} />
          <AdSlot variant="skyscraper" slotId="sidebar-skyscraper" />
        </aside>
      </div>

      {/* Phone pane switcher */}
      <nav
        aria-label={t('map.label')}
        className="fixed inset-x-0 bottom-0 z-[1000] flex justify-center pb-[max(env(safe-area-inset-bottom),12px)] lg:hidden"
      >
        <div className="flex rounded-full bg-slate-900/95 p-1 shadow-xl ring-1 ring-white/10 backdrop-blur dark:bg-slate-800/95">
          {(
            [
              ['map', MapIcon, t('mobile.map')],
              ['feed', List, `${t('mobile.feed')} · ${visibleEvents.length + alerts.length}`],
            ] as const
          ).map(([pane, Icon, label]) => (
            <button
              key={pane}
              type="button"
              aria-pressed={mobilePane === pane}
              onClick={() => setMobilePane(pane)}
              className={cn(
                'inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400',
                mobilePane === pane ? 'bg-white text-slate-900' : 'text-slate-300 hover:text-white',
              )}
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
