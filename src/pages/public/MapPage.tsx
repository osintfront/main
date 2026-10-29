import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, List, Map as MapIcon } from 'lucide-react';
import { isValidDay, shiftDay, toDayString, useArchivedEvents } from '@/hooks/useArchivedEvents';
import { useI18n } from '@/i18n';
import { usePublicEvents } from '@/hooks/useEvents';
import { PAGE_RELOADED, useMapSelection } from '@/hooks/useMapSelection';
import { useHfcAlerts } from '@/hooks/useHfcAlerts';
import type { PublicEvent } from '@/types/event';
import { cn } from '@/utils/cn';
import { AdSlot } from '@/components/common/AdSlot';
import { SiteLinks } from '@/components/layout/SiteLinks';
import { TopNav } from '@/components/layout/TopNav';
import { EventFeed } from '@/components/feed/EventFeed';
import { MapView } from '@/components/map/MapView';
import { CategoryLegend } from '@/components/map/CategoryLegend';
import { QuickReportButton } from '@/components/map/QuickReport';
import { SocialSearchButton } from '@/components/map/SocialSearch';
import { EventDetailsDialog } from '@/components/feed/EventDetailsDialog';
import { MobileEventSheet } from '@/components/map/MobileEventSheet';
import { FilterPanel } from '@/components/filters/FilterPanel';
import type { DrawMode, MoveTarget } from '@/components/map/MapView';
import { useArchiveRange } from '@/hooks/useArchiveRange';
import { EMPTY_FILTERS, activeFilterCount, loadFilters, saveFilters, isOnMap, matchesFilters, needsArchive, pointInPolygon, type EventFilters, type LatLng } from '@/lib/eventFilters';
import type { HfcAlert } from '@/types/hfcAlert';
import { SlidersHorizontal } from 'lucide-react';
import { PHONE_QUERY, useMediaQuery } from '@/hooks/useMediaQuery';
import { installAudioUnlock, playChime } from '@/lib/notifySound';
import { isCategoryAudible, soundScope, useSoundSetting } from '@/hooks/useSoundSetting';
import { initPush, syncPush } from '@/lib/push';
import { HFC_CATEGORY } from '@/config/hfcThreats';
import { useEeis } from '@/hooks/useEeis';
import { usePermissions } from '@/hooks/usePermissions';
import { useToast } from '@/components/common/Toast';
import { addEventPlace, moveEventPin, moveEventPlace, removeEventPin, setPlaceCategory, setPlaceLocation } from '@/services/eventAdminService';
import { QuickLocationDialog } from '@/components/admin/events/QuickLocationDialog';
import { fetchPublicEvent } from '@/services/eventService';
import { friendlyError } from '@/services/serviceError';
import { compileEei, matchesEei } from '@/lib/eei';
import { useAuth } from '@/hooks/useAuth';
import { AskMap } from '@/components/map/AskMap';
import type { AskAnswer } from '@/services/askService';

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


const ADS_ENABLED = false;
const NO_ALERTS: never[] = [];
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
  // Ads only on the live map with content: none in the archive or on an empty page
  // (Google: no ads on screens without publisher content).
  // Ad slots are off until the ad account is approved (placeholders hidden).
  const showAds = ADS_ENABLED && !isArchive && events.length > 0;
  const { alerts, now: alertsNow, shapes: alertShapes, ready: alertsReady } = useHfcAlerts(!isArchive);

  // Sound: browsers allow audio only after an interaction, so unlock on the first one.
  useEffect(() => installAudioUnlock(), []);

  // Sound with a filter on: only for what the filter shows (visitor's choice, see SoundMenu).
  // Filled further down, once the filtered list is known (same render).
  const soundFilterRef = useRef<{ active: boolean; ids: Set<string>; alert: (a: HfcAlert) => boolean }>({
    active: false,
    ids: new Set(),
    alert: () => true,
  });
  const inSoundScope = (id: string) => soundScope() === 'all' || !soundFilterRef.current.active || soundFilterRef.current.ids.has(id);
  const alertInSoundScope = (a: HfcAlert) => soundScope() === 'all' || !soundFilterRef.current.active || soundFilterRef.current.alert(a);

  // Chime when a new event arrives by push (not on the first load).
  const heardEvents = useRef(new Set<string>());
  useEffect(() => {
    if (isArchive) return;
    const fresh = [...newIds].filter((id) => !heardEvents.current.has(id));
    fresh.forEach((id) => heardEvents.current.add(id));
    // Only if at least one new event is in a category the visitor wants to hear.
    const audible = events.some((e) => fresh.includes(e.id) && isCategoryAudible(e.category.slug) && inSoundScope(e.id));
    if (audible) playChime('event');
  }, [newIds, isArchive, events]);

  // Chime when a red alert starts or repeats (not for alerts already active when the page opened).
  const heardAlerts = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    if (isArchive || !alertsReady) return;
    const seen = heardAlerts.current;
    const next = new Map(alerts.map((a) => [a.id, a.lastAlertAt]));
    if (seen && alerts.some((a) => seen.get(a.id) !== a.lastAlertAt && alertInSoundScope(a)) && isCategoryAudible(HFC_CATEGORY.slug)) playChime('alert');
    heardAlerts.current = next;
  }, [alerts, alertsReady, isArchive]);
  const [alertFocus, setAlertFocus] = useState<{ id: string; nonce: number } | null>(null);
  const handleLocateAlert = useCallback((id: string) => {
    setMobilePane('map');
    setAlertFocus({ id, nonce: Date.now() });
  }, []);

  // Filters (time, areas, types, … and a drawn area). A time range reaching past the
  // live 24 hours also loads those archived events.
  const [filters, setFilters] = useState<EventFilters>(loadFilters);
  // Remember the visitor's choices: a refresh keeps every filter they set.
  useEffect(() => saveFilters(filters), [filters]);
  // Push notifications follow the same filters and the sound menu's event types.
  const soundPrefs = useSoundSetting();
  const { lang } = useI18n();
  useEffect(() => void initPush(), []);
  useEffect(() => {
    const scoped = soundPrefs.scope !== 'all' && activeFilterCount(filters) > 0;
    syncPush(scoped ? filters : null, [...soundPrefs.mutedCategories], lang);
  }, [filters, soundPrefs.scope, soundPrefs.mutedCategories, lang]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [drawMode, setDrawMode] = useState<DrawMode | null>(null);
  const effectiveFilters = useMemo(() => (isArchive ? { ...filters, preset: 'live' as const } : filters), [filters, isArchive]);
  const archiveRange = useMemo(() => (isArchive ? null : needsArchive(filters)), [filters, isArchive]);
  const older = useArchiveRange(archiveRange);
  // "Ask the map" (signed-in users): a free-text question → answer + only the matching events.
  const { profile } = useAuth();
  const canAsk = !isArchive && !isDemo && profile?.status === 'active';
  const [ask, setAsk] = useState<AskAnswer | null>(null);
  const [askFit, setAskFit] = useState<{ key: number; points: [number, number][] } | null>(null);
  const handleAskResult = useCallback((r: AskAnswer | null) => {
    setAsk(r);
    if (r?.events.length) setAskFit({ key: Date.now(), points: r.events.filter(isOnMap).map((e) => [e.latitude, e.longitude]) });
  }, []);
  const allEvents = useMemo(() => {
    const extra = [...older.events, ...(ask?.events ?? [])];
    if (!extra.length) return events;
    const ids = new Set(events.map((e) => e.id));
    const out = [...events];
    for (const e of extra) if (!ids.has(e.id)) (ids.add(e.id), out.push(e));
    return out;
  }, [events, older.events, ask]);
  const filterCount = activeFilterCount(effectiveFilters);
  // צי"ח: saved keyword queries; an event passes if it matches any query that is on.
  const { eeis, add: addEei, remove: removeEei } = useEeis();
  const eeiMatchers = useMemo(
    () => eeis.filter((q) => effectiveFilters.eeis.includes(q.id)).map((q) => compileEei(q.query)),
    [eeis, effectiveFilters.eeis],
  );
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
      (ask ? ask.events : allEvents)
        .filter((e) => matchesQuery(e, deferredQuery, categoryLabel(e.category.slug, e.category.name)))
        .filter((e) => matchesFilters(e, effectiveFilters))
        .filter((e) => !eeiMatchers.length || eeiMatchers.some((m) => matchesEei(e, m)))
        .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()),
    [ask, allEvents, deferredQuery, categoryLabel, effectiveFilters, eeiMatchers],
  );
  {
    const f = effectiveFilters;
    soundFilterRef.current = {
      active: !!ask || !!deferredQuery || filterCount > 0,
      ids: new Set(visibleEvents.map((e) => e.id)),
      alert: (a) => {
        if (f.categories.length && !f.categories.includes(HFC_CATEGORY.slug)) return false;
        if (f.areas.length && !f.areas.includes('israel')) return false;
        if (f.polygon && f.polygon.length >= 3) {
          const pts: LatLng[] = [...(a.center ? [a.center] : []), ...a.areaPoints.map((p) => [p.lat, p.lng] as LatLng)];
          if (!pts.some((p) => pointInPolygon(p, f.polygon!))) return false;
        }
        return true;
      },
    };
  }
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
  // Staff: move a pin from the map (popup or phone card, then confirm on the map).
  const { can } = usePermissions();
  const toast = useToast();
  const canMove = !isDemo && (can('event.edit.any') || can('event.edit.own'));
  const [moving, setMoving] = useState<MoveTarget | null>(null);
  const startMove = useCallback((target: MoveTarget) => {
    setDetailsId(null);
    setMobilePane('map');
    setMoving(target);
  }, []);
  const startMoveMain = useCallback((id: string) => startMove({ id, place: null }), [startMove]);
  const endMove = useCallback(() => setMoving(null), []);
  const saveMove = useCallback(
    async (target: MoveTarget, lat: number, lng: number, mode: 'move' | 'copy' | 'remove') => {
      try {
        if (mode === 'remove') await removeEventPin(target.id, target.place);
        else if (mode === 'copy') await addEventPlace(target.id, lat, lng, target.place);
        else if (target.place === null) await moveEventPin(target.id, lat, lng);
        else await moveEventPlace(target.id, target.place, lat, lng);
        toast.success(can('event.publish') ? t(mode === 'copy' ? 'move.copied' : mode === 'remove' ? 'move.removed' : 'move.saved') : t('list.sentForReview'));
        reload();
        return true;
      } catch (err) {
        toast.error(friendlyError(err, t));
        return false;
      }
    },
    [toast, t, reload, can],
  );
  // Staff, from an icon's window: another category for this icon, or its place by search.
  const placeCategory = useCallback(
    async (target: MoveTarget, slug: string) => {
      try {
        await setPlaceCategory(target.id, target.place, slug);
        toast.success(can('event.publish') ? t('move.saved') : t('list.sentForReview'));
        reload();
      } catch (err) {
        toast.error(friendlyError(err, t));
      }
    },
    [toast, t, reload, can],
  );
  const [locating, setLocating] = useState<MoveTarget | null>(null);
  const [locBusy, setLocBusy] = useState(false);
  const locatingEvent = locating ? allEvents.find((e) => e.id === locating.id) ?? null : null;
  const locatingPlace = locating && locating.place !== null ? locatingEvent?.places?.find((p) => p.index === locating.place) ?? null : null;
  const savePlaceLocation = useCallback(
    async (lat: number, lng: number, name: string) => {
      if (!locating) return;
      setLocBusy(true);
      try {
        await setPlaceLocation(locating.id, locating.place, lat, lng, name);
        toast.success(can('event.publish') ? t('move.saved') : t('list.sentForReview'));
        setLocating(null);
        reload();
      } catch (err) {
        toast.error(friendlyError(err, t));
      } finally {
        setLocBusy(false);
      }
    },
    [locating, toast, t, reload, can],
  );
  // A shared link (?event=<id>) opens that event — from the live list, else fetched (archive).
  const [linkedEvent, setLinkedEvent] = useState<PublicEvent | null>(null);
  const linkHandled = useRef(false);
  // Only the link the page was opened with — not ?event= that a later click puts in the URL.
  const openedWith = useRef(PAGE_RELOADED ? null : new URLSearchParams(window.location.search).get('event'));
  useEffect(() => {
    if (linkHandled.current || status !== 'ready') return;
    linkHandled.current = true;
    const id = openedWith.current;
    if (!id) return;
    const found = allEvents.find((e) => e.id === id);
    if (found) {
      select(id, 'feed');
      setDetailsId(id);
      return;
    }
    void fetchPublicEvent(id).then((ev) => {
      if (!ev) return;
      setLinkedEvent(ev);
      setDetailsId(ev.id);
    });
  }, [status, allEvents, select]);
  const detailsEvent = detailsId ? allEvents.find((e) => e.id === detailsId) ?? (linkedEvent?.id === detailsId ? linkedEvent : null) : null;
  const closeDetails = useCallback(() => setDetailsId(null), []);
  // Phones: the selected event shows as a card along the bottom of the map.
  const sheetEvent =
    isPhone && mobilePane === 'map' && selectedId && !detailsId && !drawMode && !moving ? visibleEvents.find((e) => e.id === selectedId) ?? null : null;
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
        onSoundOpen={() => setFiltersOpen(false)}
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
          eeis={eeis}
          onAddEei={addEei}
          onRemoveEei={removeEei}
        />
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(340px,380px)_minmax(0,1fr)] xl:grid-cols-[380px_minmax(0,1fr)]">
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
            onRefresh={isArchive ? undefined : reload}
            onClearQuery={() => setQuery('')}
            onLocate={handleLocate}
            newIds={newIds}
            onOpenDetails={handleViewEvent}
            alerts={ask ? NO_ALERTS : alerts}
            alertsNow={alertsNow}
            onLocateAlert={handleLocateAlert}
            title={isArchive ? t('archive.title') : undefined}
            live={!isArchive}
            toolbar={
              isArchive || filterCount || ask ? (
                <div className="space-y-2">
                  {ask ? (
                    <div className="flex items-center gap-2">
                      <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-violet-600 px-3 text-xs font-semibold text-white">
                        {t('ask.feedTitle')}
                      </span>
                      <span className="text-xs text-slate-500 dark:text-slate-400">{t('feed.count', { count: visibleEvents.length })}</span>
                      <button
                        type="button"
                        onClick={() => setAsk(null)}
                        className="ms-auto h-8 rounded-lg px-2 text-xs font-semibold text-sky-700 hover:bg-sky-50 dark:text-sky-400 dark:hover:bg-sky-500/10"
                      >
                        {t('ask.clear')}
                      </button>
                    </div>
                  ) : null}
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
              <>
                {showAds ? (
                  <div className="hidden border-t border-slate-200 p-3 lg:block [@media(max-height:720px)]:hidden dark:border-slate-800">
                    <AdSlot variant="square" slotId="feed-rectangle" />
                  </div>
                ) : null}
                <SiteLinks className="justify-center border-t border-slate-200 px-3 py-2 dark:border-slate-800" />
              </>
            }
            inlineAd={showAds ? <AdSlot variant="square" slotId="feed-rectangle-inline" className="py-1" /> : undefined}
          />
        </aside>

        {/* Column 2 — banner + map */}
        <main
          id="main-map"
          className={cn('min-h-0 flex-col pb-16 lg:flex lg:pb-0', mobilePane === 'map' ? 'flex' : 'hidden')}
        >
          {showAds ? (
            <div className="flex shrink-0 justify-center border-b border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-950">
              <AdSlot variant="banner" slotId="map-leaderboard" />
            </div>
          ) : null}
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
              onFilterCategory={(slug) => setFilters((f) => ({ ...f, categories: [slug] }))}
              onClearArea={clearArea}
              moving={moving}
              onMoveRequest={canMove ? startMove : undefined}
              onMoveEnd={endMove}
              onMoveSave={saveMove}
              onPlaceCategory={canMove ? (target, slug) => void placeCategory(target, slug) : undefined}
              onPlaceLocate={canMove ? setLocating : undefined}
              canRemovePin={!isDemo && can('event.edit.any')}
              topSlot={canAsk ? <AskMap result={ask} onResult={handleAskResult} onCite={handleLocate} /> : undefined}
              fitTo={askFit}
            />
            {canAsk && !moving ? <QuickReportButton /> : null}
            {!isArchive && !isDemo && !moving ? <SocialSearchButton polygon={filters.polygon} /> : null}
          </div>
        </main>

      </div>

      {sheetEvent ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(max(env(safe-area-inset-bottom),12px)+56px)] z-[1100] mx-auto max-w-lg lg:hidden">
          <MobileEventSheet
            key={sheetEvent.id}
            event={sheetEvent}
            onClose={clearSelection}
            onOpenDetails={openDetailsFromSheet}
            onMove={canMove ? startMoveMain : undefined}
          />
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
      {locating && locatingEvent ? (
        <QuickLocationDialog
          event={{
            title: locatingPlace ? `${locatingEvent.title} — ${locatingPlace.name || locatingPlace.nameEn}` : locatingEvent.title,
            latitude: locatingPlace ? locatingPlace.latitude : locatingEvent.latitude,
            longitude: locatingPlace ? locatingPlace.longitude : locatingEvent.longitude,
            locationName: locatingPlace ? locatingPlace.name || locatingPlace.nameEn : locatingEvent.locationName,
          }}
          iconName={locatingEvent.category.icon || 'CircleDot'}
          color={locatingEvent.category.markerColor || '#0284c7'}
          busy={locBusy}
          onCancel={() => setLocating(null)}
          onSave={(a, b, n) => void savePlaceLocation(a, b, n)}
        />
      ) : null}
      {detailsEvent ? <EventDetailsDialog event={detailsEvent} onClose={closeDetails} onLocate={locateFromDetails} onChanged={reload} onMovePin={canMove ? startMoveMain : undefined} related={detailsEvent.reportGroup ? allEvents.filter((e) => e.reportGroup === detailsEvent.reportGroup && e.id !== detailsEvent.id) : undefined} onOpenRelated={openDetailsFromSheet} /> : null}
    </div>
  );
}
