import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, List, Map as MapIcon } from 'lucide-react';
import { isValidDay, shiftDay, toDayString, useArchivedEvents } from '@/hooks/useArchivedEvents';
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
import { EventDetailsDialog } from '@/components/feed/EventDetailsDialog';
import { MobileEventSheet } from '@/components/map/MobileEventSheet';
import { FilterPanel } from '@/components/filters/FilterPanel';
import type { DrawMode } from '@/components/map/MapView';
import { useArchiveRange } from '@/hooks/useArchiveRange';
import { EMPTY_FILTERS, activeFilterCount, isOnMap, matchesFilters, needsArchive, type EventFilters, type LatLng } from '@/lib/eventFilters';
import { SlidersHorizontal } from 'lucide-react';
import { PHONE_QUERY, useMediaQuery } from '@/hooks/useMediaQuery';
import { installAudioUnlock, playChime } from '@/lib/notifySound';
import { isCategoryAudible } from '@/hooks/useSoundSetting';
import { HFC_CATEGORY } from '@/config/hfcThreats';

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

const NO_IDS: ReadonlySet<string> = new Set();

function initialDay(): string {
  const fromUrl = new URLSearchParams(window.location.search).get('date');
  return isValidDay(fromUrl) ? fromUrl : toDayString(new Date());
}

/** Day picker for the archive: ‹ previous · date · next › */
function ArchiveDayPicker({ day, onChange }: { day: string; onChange: (day: string) => void }) {
  const { t, dir } = useI18n();
  const today = toDayString(new Date());
  const Prev = dir === 'rtl' ? ChevronRight : ChevronLeft;
  const Next = dir === 'rtl' ? ChevronLeft : ChevronRight;
  const btn =
    'inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-transparent focus-visible:outline-2 focus-visible:outline-sky-500 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-900';
  return (
    <div className="flex items-center gap-2">
      <button type="button" className={btn} onClick={() => onChange(shiftDay(day, -1))} aria-label={t('archive.prevDay')}>
        <Prev className="size-4" aria-hidden />
      </button>
      <label className="min-w-0 flex-1">
        <span className="sr-only">{t('archive.day')}</span>
        <input
          type="date"
          value={day}
          max={today}
          onChange={(e) => isValidDay(e.target.value) && onChange(e.target.value)}
          className="h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30 dark:border-slate-800 dark:bg-slate-900 dark:text-white dark:[color-scheme:dark]"
        />
      </label>
      <button type="button" className={btn} onClick={() => onChange(shiftDay(day, 1))} disabled={day >= today} aria-label={t('archive.nextDay')}>
        <Next className="size-4" aria-hidden />
      </button>
      {day !== today ? (
        <button
          type="button"
          onClick={() => onChange(today)}
          className="h-8 shrink-0 rounded-lg px-2 text-xs font-semibold text-sky-700 hover:bg-sky-50 dark:text-sky-400 dark:hover:bg-sky-500/10"
        >
          {t('archive.today')}
        </button>
      ) : null}
    </div>
  );
}

export function MapPage({ mode = 'live' }: { mode?: 'live' | 'archive' }) {
  const { t, categoryLabel } = useI18n();
  const isArchive = mode === 'archive';
  const live = usePublicEvents(!isArchive);
  const [day, setDay] = useState(initialDay);
  const archive = useArchivedEvents(day, isArchive);
  const { events, status, error, isDemo, lastUpdated, reload, newIds } = isArchive
    ? { ...archive, isDemo: false, lastUpdated: null, newIds: NO_IDS }
    : live;

  // Keep the chosen day in the URL so an archive view can be shared.
  useEffect(() => {
    if (!isArchive) return;
    const url = new URL(window.location.href);
    url.searchParams.set('date', day);
    window.history.replaceState(window.history.state, '', url);
  }, [day, isArchive]);
  const { selectedId, focusRequest, select, clear: clearSelection } = useMapSelection();
  const isPhone = useMediaQuery(PHONE_QUERY);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query.trim());
  const [mobilePane, setMobilePane] = useState<MobilePane>('map');
  const { alerts, now: alertsNow, shapes: alertShapes, ready: alertsReady } = useHfcAlerts(!isArchive);

  // Sound: browsers allow audio only after an interaction, so unlock on the first one.
  useEffect(() => installAudioUnlock(), []);

  // Chime when a new event arrives by push (not on the first load).
  const heardEvents = useRef(new Set<string>());
  useEffect(() => {
    if (isArchive) return;
    const fresh = [...newIds].filter((id) => !heardEvents.current.has(id));
    fresh.forEach((id) => heardEvents.current.add(id));
    // Only if at least one new event is in a category the visitor wants to hear.
    const audible = events.some((e) => fresh.includes(e.id) && isCategoryAudible(e.category.slug));
    if (audible) playChime('event');
  }, [newIds, isArchive, events]);

  // Chime when a red alert starts or repeats (not for alerts already active when the page opened).
  const heardAlerts = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    if (isArchive || !alertsReady) return;
    const seen = heardAlerts.current;
    const next = new Map(alerts.map((a) => [a.id, a.lastAlertAt]));
    if (seen && alerts.some((a) => seen.get(a.id) !== a.lastAlertAt) && isCategoryAudible(HFC_CATEGORY.slug)) playChime('alert');
    heardAlerts.current = next;
  }, [alerts, alertsReady, isArchive]);
  const [alertFocus, setAlertFocus] = useState<{ id: string; nonce: number } | null>(null);
  const handleLocateAlert = useCallback((id: string) => {
    setMobilePane('map');
    setAlertFocus({ id, nonce: Date.now() });
  }, []);

  // Filters (time, areas, types, … and a drawn area). A time range reaching past the
  // live 24 hours also loads those archived events.
  const [filters, setFilters] = useState<EventFilters>(EMPTY_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [drawMode, setDrawMode] = useState<DrawMode | null>(null);
  const effectiveFilters = useMemo(() => (isArchive ? { ...filters, preset: 'live' as const } : filters), [filters, isArchive]);
  const archiveRange = useMemo(() => (isArchive ? null : needsArchive(filters)), [filters, isArchive]);
  const older = useArchiveRange(archiveRange);
  const allEvents = useMemo(() => {
    if (!older.events.length) return events;
    const ids = new Set(events.map((e) => e.id));
    return [...events, ...older.events.filter((e) => !ids.has(e.id))];
  }, [events, older.events]);
  const filterCount = activeFilterCount(effectiveFilters);
  const startDrawing = useCallback(() => {
    setFiltersOpen(false);
    setMobilePane('map');
    setDrawMode('polygon');
  }, []);
  const handleAreaDrawn = useCallback((points: LatLng[]) => {
    setFilters((f) => ({ ...f, polygon: points }));
    setDrawMode(null);
  }, []);
  const clearArea = useCallback(() => setFilters((f) => ({ ...f, polygon: null })), []);

  const visibleEvents = useMemo(
    () =>
      allEvents
        .filter((e) => matchesQuery(e, deferredQuery, categoryLabel(e.category.slug, e.category.name)))
        .filter((e) => matchesFilters(e, effectiveFilters))
        .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()),
    [allEvents, deferredQuery, categoryLabel, effectiveFilters],
  );
  // The map pins only events with a specific place; country-only / no-location ones stay in the feed.
  const mapEvents = useMemo(() => visibleEvents.filter(isOnMap), [visibleEvents]);

  // Card → map: fly to marker. On phones, switch to the map pane first.
  const handleLocate = useCallback(
    (id: string) => {
      const ev = allEvents.find((e) => e.id === id);
      if (ev && !isOnMap(ev)) {
        // Not pinned on the map: open its details instead of flying nowhere.
        select(id, 'feed');
        setDetailsId(id);
        return;
      }
      setMobilePane('map');
      select(id, 'feed');
    },
    [select, allEvents],
  );

  // Marker → card: highlight and scroll the card into view.
  const handleMarkerSelect = useCallback((id: string) => select(id, 'map'), [select]);

  // Popup "View event": show the full card (switches to the feed on phones).
  // Popup "Event details" / card "Read more": open the full event window.
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const handleViewEvent = useCallback(
    (id: string) => {
      select(id, 'popup');
      setDetailsId(id);
    },
    [select],
  );
  const detailsEvent = detailsId ? allEvents.find((e) => e.id === detailsId) ?? null : null;
  const closeDetails = useCallback(() => setDetailsId(null), []);
  // Phones: the selected event shows as a card along the bottom of the map.
  const sheetEvent =
    isPhone && mobilePane === 'map' && selectedId && !detailsId && !drawMode ? visibleEvents.find((e) => e.id === selectedId) ?? null : null;
  const openDetailsFromSheet = useCallback((id: string) => setDetailsId(id), []);
  const locateFromDetails = useCallback(
    (id: string) => {
      setDetailsId(null);
      setMobilePane('map');
      select(id, 'feed');
    },
    [select],
  );

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <a
        href="#main-map"
        className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-[2000] focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:shadow"
      >
        {t('common.skipToContent')}
      </a>
      <TopNav
        query={query}
        onQueryChange={setQuery}
        mode={mode}
        filterCount={filterCount}
        filtersOpen={filtersOpen}
        onToggleFilters={() => setFiltersOpen((v) => !v)}
      />
      {filtersOpen ? (
        <FilterPanel
          filters={effectiveFilters}
          onChange={setFilters}
          onClose={() => setFiltersOpen(false)}
          events={allEvents}
          resultCount={visibleEvents.length}
          onDrawArea={startDrawing}
          hideTime={isArchive}
          loadingArchive={older.loading}
        />
      ) : null}

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
            newIds={newIds}
            onOpenDetails={handleViewEvent}
            alerts={alerts}
            alertsNow={alertsNow}
            onLocateAlert={handleLocateAlert}
            title={isArchive ? t('archive.title') : undefined}
            live={!isArchive}
            toolbar={
              isArchive || filterCount ? (
                <div className="space-y-2">
                  {isArchive ? <ArchiveDayPicker day={day} onChange={setDay} /> : null}
                  {filterCount ? (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setFiltersOpen(true)}
                        className="inline-flex h-8 items-center gap-1.5 rounded-full bg-sky-600 px-3 text-xs font-semibold text-white hover:bg-sky-500"
                      >
                        <SlidersHorizontal className="size-3.5" aria-hidden />
                        {t('filters.active', { count: filterCount })}
                      </button>
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        {t('feed.count', { count: visibleEvents.length })}
                      </span>
                      <button
                        type="button"
                        onClick={() => setFilters(EMPTY_FILTERS)}
                        className="ms-auto h-8 rounded-lg px-2 text-xs font-semibold text-sky-700 hover:bg-sky-50 dark:text-sky-400 dark:hover:bg-sky-500/10"
                      >
                        {t('filters.clearAll')}
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : undefined
            }
            emptyText={filterCount ? t('filters.none') : isArchive ? t('archive.empty') : undefined}
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
              events={mapEvents}
              selectedId={selectedId}
              focusRequest={focusRequest}
              onMarkerSelect={handleMarkerSelect}
              onViewEvent={handleViewEvent}
              alerts={alerts}
              alertFocus={alertFocus}
              alertShapes={alertShapes}
              compact={isPhone}
              legend={<CategoryLegend events={mapEvents} alertCount={alerts.length} />}
              onBackgroundClick={isPhone ? clearSelection : undefined}
              area={filters.polygon}
              drawMode={drawMode}
              onDrawModeChange={setDrawMode}
              onAreaDrawn={handleAreaDrawn}
              onClearArea={clearArea}
            />
          </div>
        </main>

        {/* Column 3 — legend + skyscraper (wide screens) */}
        <aside className="ofm-scroll hidden min-h-0 flex-col items-center gap-5 overflow-y-auto border-s border-slate-200 bg-white px-4 py-4 xl:flex dark:border-slate-800 dark:bg-slate-950">
          <CategoryLegend events={mapEvents} alertCount={alerts.length} />
          <AdSlot variant="skyscraper" slotId="sidebar-skyscraper" />
        </aside>
      </div>

      {sheetEvent ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(max(env(safe-area-inset-bottom),12px)+56px)] z-[1100] mx-auto max-w-lg lg:hidden">
          <MobileEventSheet key={sheetEvent.id} event={sheetEvent} onClose={clearSelection} onOpenDetails={openDetailsFromSheet} />
        </div>
      ) : null}

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
      {detailsEvent ? <EventDetailsDialog event={detailsEvent} onClose={closeDetails} onLocate={locateFromDetails} /> : null}
    </div>
  );
}
