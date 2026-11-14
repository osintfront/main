import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, List, Map as MapIcon } from 'lucide-react';
import { isValidDay, shiftDay, toDayString, useArchivedEvents } from '@/hooks/useArchivedEvents';
import { useI18n } from '@/i18n';
import { usePublicEvents } from '@/hooks/useEvents';
import { PAGE_RELOADED, useMapSelection } from '@/hooks/useMapSelection';
import { HOME_EVENT } from '@/components/common/Logo';
import { openGate, openGateFor } from '@/components/plans/GateDialog';
import { openEventAllowed } from '@/lib/featureUse';
import { featureLimit, hasFeature, planConfigReady, usePlanVersion } from '@/lib/plans';
import { useFilterSets } from '@/hooks/useFilterSets';
import { useEeiList } from '@/hooks/useEeiList';
import { eeiMatches, theatreColor, theatresOn, waitingCount } from '@/lib/eeiLens';
import { MAX_SETS, addPolygon, matchingSets, planSetLimit, pushFilters, setAcceptsAlert, setsArchiveRange, setsOn, switchOffSets, type FilterSet } from '@/lib/filterSets';
import { useHfcAlerts } from '@/hooks/useHfcAlerts';
import type { PublicEvent } from '@/types/event';
import { cn } from '@/utils/cn';
import { useAds } from '@/lib/ads';
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
import { pinTarget, type PinRef } from '@/lib/pinTarget';
import { useArchiveRange } from '@/hooks/useArchiveRange';
import { EMPTY_FILTERS, activeFilterCount, archiveFilters, loadFilters, saveFilters, isOnMap, matchesFilters, needsArchive, pointInPolygon, type EventFilters, type LatLng } from '@/lib/eventFilters';
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
import { fetchPublicEvent, fetchPublicEventsByIdsAll } from '@/services/eventService';
import { friendlyError } from '@/services/serviceError';
import { compileEei, matchesEei } from '@/lib/eei';
import { useAuth } from '@/hooks/useAuth';
import { AskMap } from '@/components/map/AskMap';
import { StatsDashboard } from '@/components/ask/StatsDashboard';
import { AskError, dashboardPeriod, type AskAnswer } from '@/services/askService';
import { turnToShow } from '@/lib/askChat';
import { selectionEvents, showsEvents, shownSummary, type DashSelection, type Preset } from '@/lib/askStats';
import { useAskQuota } from '@/hooks/useAskQuota';
import { useDashboardPoll } from '@/hooks/useDashboardPoll';
import { OfiFab } from '@/components/ofi/OfiFab';

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
  // Ads (Stage C): guests and Free only, when switched on in app_settings.
  const adAuth = useAuth();
  const ads = useAds(adAuth.profile, adAuth.status !== 'loading');
  // Ads only on the live map with content: none in the archive or on an empty page
  // (Google: no ads on screens without publisher content).
  // Ad slots are off until the ad account is approved (placeholders hidden).
  const showAds = ads.show && !isArchive && events.length > 0;
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
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [drawMode, setDrawMode] = useState<DrawMode | null>(null);
  const effectiveFilters = useMemo(() => (isArchive ? archiveFilters(filters) : filters), [filters, isArchive]);
  // Filter sets: several named filters; while one is in force they replace the general filter.
  // Live map only (not the archive page). Sets past the plan's limit are kept but locked.
  usePlanVersion(); // re-render when the plan rows load
  const toast = useToast();
  const { sets, setSets } = useFilterSets();
  // Until the plan rows and the sign-in are known, keep the saved sets as they are (no flicker to the
  // general filter and back, no sign-up window for a set that will turn out to be locked).
  const { profile, status: authStatus } = useAuth();
  const plansSettled = planConfigReady() && authStatus !== 'loading';
  const setLimit = plansSettled ? planSetLimit(hasFeature(undefined, 'filter_sets'), featureLimit('filter_sets')) : MAX_SETS;
  const activeSets = useMemo(() => (isArchive ? [] : setsOn(sets, setLimit)), [isArchive, sets, setLimit]);
  // Push follows what the site shows: the sets in force (general filter paused), else the general filter.
  // Not on the archive page (no sets there) — it would overwrite the live choice. Waits for the plan rows.
  useEffect(() => {
    if (isArchive || !plansSettled) return;
    syncPush(pushFilters(soundPrefs.scope, filters, activeSets), [...soundPrefs.mutedCategories], lang);
  }, [isArchive, plansSettled, filters, activeSets, soundPrefs.scope, soundPrefs.mutedCategories, lang]);
  // Free-text EEI (צי"ח): the user's theatres act like more sets (OR). Live map only, Pro / Max.
  const eeiAllowed = authStatus === 'signed_in' && hasFeature(undefined, 'eei_text');
  const eei = useEeiList(!isArchive && eeiAllowed, lastUpdated);
  const eeiOn = useMemo(() => (isArchive || !eeiAllowed ? [] : theatresOn(eei.list, eei.view)), [isArchive, eeiAllowed, eei.list, eei.view]);
  /** Sets and EEI theatres in force: while any is, the general filter is paused. */
  const inForce = activeSets.length + eeiOn.length;
  // The panel reopens on the set it was editing; a drawing can be for a set (drawTarget).
  const [panelScopeRaw, setPanelScope] = useState<string | null>(null);
  const panelScope = panelScopeRaw === 'eei' || (panelScopeRaw && sets.some((x) => x.id === panelScopeRaw)) ? panelScopeRaw : null;
  const drawTargetRef = useRef<string | null>(null);
  const { view: eeiView, setView: setEeiView, list: eeiList } = eei;
  const switchSetsOff = useCallback(() => {
    setSets((list) => switchOffSets(list, setLimit));
    // EEI theatres are switched off too — the list itself is never deleted here.
    if (eeiList?.theatres.length) setEeiView({ ...eeiView, off: eeiList.theatres.map((x) => x.id) });
  }, [setSets, setLimit, eeiList, eeiView, setEeiView]);
  const archiveRange = useMemo(
    () => (isArchive ? null : activeSets.length ? setsArchiveRange(activeSets) : needsArchive(filters)),
    [filters, isArchive, activeSets],
  );
  const older = useArchiveRange(archiveRange);
  // "Ask the map" (signed-in users): a free-text question → answer + only the matching events.
  const isGuest = authStatus === 'signed_out';
  // A time range reaching past the live 24 hours needs an account (guests have no archive).
  useEffect(() => {
    if (archiveRange && isGuest && plansSettled) openGate('signup');
  }, [archiveRange, isGuest, plansSettled]);
  const canAsk = !isArchive && !isDemo && profile?.status === 'active';
  // It is a short conversation: a list of turns; the map and feed show the selected turn's events.
  const [askTurns, setAskTurns] = useState<AskAnswer[]>([]);
  const [askSelected, setAskSelected] = useState(0);
  // Statistics dashboards: polled while building; one may be open; its events may be on the map.
  useDashboardPoll(askTurns, setAskTurns);
  const askQuota = useAskQuota(canAsk);
  const [dashOpen, setDashOpen] = useState<number | null>(null);
  const [dashShown, setDashShown] = useState<{ turn: number; incidents: number; reports: number; missing: number; events: PublicEvent[] } | null>(null);
  const seenDone = useRef(new Set<string>());
  const refreshQuota = askQuota.refresh;
  useEffect(() => {
    // A dashboard (or a period rebuild) that just finished: open it the first time, refresh the credits.
    askTurns.forEach((turn, i) => {
      const d = turn.dashboard;
      if (d?.status !== 'done' || seenDone.current.has(d.id)) return;
      seenDone.current.add(d.id);
      setDashOpen(i);
      refreshQuota();
    });
  }, [askTurns, refreshQuota]);
  const selectedTurn = askTurns[askSelected] ?? null;
  const ask = !dashShown && selectedTurn && showsEvents(selectedTurn.mode) ? selectedTurn : null;
  const [askFit, setAskFit] = useState<{ key: number; points: [number, number][] } | null>(null);
  const fitAsk = useCallback((r: AskAnswer | undefined) => {
    if (r?.events.length) setAskFit({ key: Date.now(), points: r.events.filter(isOnMap).map((e) => [e.latitude, e.longitude]) });
  }, []);
  const handleAskTurns = useCallback(
    (turns: AskAnswer[]) => {
      setAskTurns(turns);
      if (!turns.length) {
        setDashOpen(null);
        setDashShown(null);
      }
      // A follow-up that found nothing keeps the map on the last answer with events (not a blank map).
      const show = turnToShow(turns);
      setAskSelected(show);
      fitAsk(turns[show]);
    },
    [fitAsk],
  );
  const handleAskSelect = useCallback(
    (i: number) => {
      setAskSelected(i);
      fitAsk(askTurns[i]);
    },
    [askTurns, fitAsk],
  );
  /** A press on a dashboard (or "Show on map"): the reports behind the chosen incidents, on the map and in the feed. */
  const showDashEvents = useCallback(
    async (turn: number, sel: DashSelection) => {
      const r = askTurns[turn]?.dashboard?.result;
      if (!r) return;
      const chosen = selectionEvents(r, sel);
      const events = await fetchPublicEventsByIdsAll(chosen.ids);
      setDashShown({ turn, ...shownSummary(chosen, events.map((e) => e.id)), events });
      setDashOpen(null);
      if (events.length) setAskFit({ key: Date.now(), points: events.filter(isOnMap).map((e) => [e.latitude, e.longitude]) });
      setMobilePane('map');
    },
    [askTurns],
  );
  /** A period chip: the same dashboard for another period, built while the old figures stay on screen. */
  const dashPeriod = useCallback(async (turn: number, preset: Preset) => {
    const d = askTurns[turn]?.dashboard;
    if (!d) return;
    const patch = (f: (x: NonNullable<AskAnswer['dashboard']>) => NonNullable<AskAnswer['dashboard']>) =>
      setAskTurns((cur) => cur.map((x, i) => (i === turn && x.dashboard ? { ...x, dashboard: f(x.dashboard) } : x)));
    try {
      const r = await dashboardPeriod(d.id, preset);
      patch((x) => ({ ...x, note: null, rebuild: { id: r.id, preset, stage: 'finding', progress: null } }));
    } catch (err) {
      const code = err instanceof AskError ? err.code : 'failed';
      patch((x) => ({ ...x, note: code === 'quota_dashboard' ? 'quota' : code === 'too_many' ? 'too_many' : code === 'busy' ? 'busy' : 'failed' }));
    }
  }, [askTurns]);
  const allEvents = useMemo(() => {
    const extra = [...older.events, ...(ask?.events ?? []), ...(dashShown?.events ?? [])];
    if (!extra.length) return events;
    const ids = new Set(events.map((e) => e.id));
    const out = [...events];
    for (const e of extra) if (!ids.has(e.id)) (ids.add(e.id), out.push(e));
    return out;
  }, [events, older.events, ask, dashShown]);
  // The archive has no time filter: it is not counted there.
  const filterCount = activeFilterCount(isArchive ? { ...effectiveFilters, preset: 'live' } : effectiveFilters);
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
  const drawForSet = useCallback(
    (id: string) => {
      drawTargetRef.current = id;
      startDrawing();
    },
    [startDrawing],
  );
  // Drawing for a set ended without a shape (cancelled): back to that set in the panel, nothing added.
  const handleDrawModeChange = useCallback((mode: DrawMode | null) => {
    setDrawMode(mode);
    const target = drawTargetRef.current;
    if (mode === null && target) {
      drawTargetRef.current = null;
      setPanelScope(target);
      setFiltersOpen(true);
    }
  }, []);
  const handleAreaDrawn = useCallback(
    (points: LatLng[]) => {
      const target = drawTargetRef.current;
      if (target) {
        // A drawing for a set goes into that set only (never into the general filter).
        drawTargetRef.current = null;
        setSets((list) => addPolygon(list, target, points, setLimit));
        setAskFit({ key: Date.now(), points });
        setDrawMode(null);
        setPanelScope(target);
        setFiltersOpen(true);
        return;
      }
      setFilters((f) => ({ ...f, polygon: points }));
      setDrawMode(null);
      if (inForce) {
        switchSetsOff();
        toast.success(t('sets.switchedOff'));
      }
    },
    [inForce, switchSetsOff, toast, t, setSets, setLimit],
  );
  const filterByCategory = useCallback(
    (slug: string) => {
      setFilters((f) => ({ ...f, categories: [slug] }));
      if (inForce) {
        switchSetsOff();
        toast.success(t('sets.switchedOff'));
      }
    },
    [inForce, switchSetsOff, toast, t],
  );
  const clearArea = useCallback(() => setFilters((f) => ({ ...f, polygon: null })), []);

  const visibleEvents = useMemo(
    () =>
      // A dashboard's events are shown as they are: the user's search and filters would break its numbers.
      dashShown ? [...dashShown.events].sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()) :
      (ask ? ask.events : allEvents)
        .filter((e) => matchesQuery(e, deferredQuery, [e.category, ...(e.secondaryCategories ?? [])].map((c) => categoryLabel(c.slug, c.name)).join(' ')))
        .filter((e) =>
          inForce
            ? matchingSets(e, activeSets).length > 0 || eeiMatches(e, eeiOn, eei.tags, eei.view).length > 0
            : matchesFilters(e, effectiveFilters) && (!eeiMatchers.length || eeiMatchers.some((m) => matchesEei(e, m))),
        )
        .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()),
    [dashShown, ask, allEvents, deferredQuery, categoryLabel, effectiveFilters, eeiMatchers, activeSets, eeiOn, eei.tags, eei.view],
  );
  // Which set each shown event fits (the first one): a coloured ring on the map, a tag in the feed.
  // Which set / theatre each shown event fits: a coloured ring on the map, a tag in the feed.
  // A manual set wins the colour; an event in both shows both names.
  const { tints, setTags } = useMemo(() => {
    if (!inForce) return { tints: undefined, setTags: undefined };
    const tints = new Map<string, string>();
    const setTags = new Map<string, { name: string; color: string; topic?: string; star?: boolean; more?: number }>();
    const order = eei.list?.theatres ?? [];
    for (const e of visibleEvents) {
      const s: FilterSet | undefined = matchingSets(e, activeSets)[0];
      const m = eeiOn.length ? eeiMatches(e, eeiOn, eei.tags, eei.view)[0] : undefined;
      if (!s && !m) continue;
      const setName = s ? s.name || `#${sets.indexOf(s) + 1}` : '';
      const thName = m ? (m.theatre.kind === 'exceptional' ? t('eeiList.exceptional') : m.theatre.name) : '';
      const color = s ? s.color : theatreColor(order.indexOf(m!.theatre));
      tints.set(e.id, color);
      const first = m && m.theatre.kind === 'theatre' ? m.topics[0] : undefined;
      setTags.set(e.id, {
        name: [setName, thName].filter(Boolean).join(' · '),
        color,
        topic: first?.label,
        star: first?.priority,
        more: m && m.topics.length > 1 ? m.topics.length - 1 : undefined,
      });
    }
    return { tints, setTags };
  }, [inForce, visibleEvents, activeSets, sets, eeiOn, eei.tags, eei.view, eei.list, t]);
  const eeiWaiting = useMemo(() => (eeiOn.length ? waitingCount(allEvents, eeiOn, eei.tags) : 0), [allEvents, eeiOn, eei.tags]);
  const setAreas = useMemo(
    () => activeSets.flatMap((s) => s.filter.polygons.map((points) => ({ points, color: s.color }))),
    [activeSets],
  );
  {
    const f = effectiveFilters;
    soundFilterRef.current = {
      active: !!ask || !!deferredQuery || filterCount > 0 || inForce > 0,
      ids: new Set(visibleEvents.map((e) => e.id)),
      alert: (a) => {
        // EEI theatres never accept a Home Front alert; only manual sets do.
        if (inForce) {
          const pts: LatLng[] = [...(a.center ? [a.center] : []), ...a.areaPoints.map((p) => [p.lat, p.lng] as LatLng)];
          return activeSets.some((s) => setAcceptsAlert(s, pts, HFC_CATEGORY.slug));
        }
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
  // A different list (filters, search, "ask the map", archive day) starts the feed again at its first batch.
  const feedResetKey = useMemo(
    () => JSON.stringify([isArchive ? day : null, effectiveFilters, deferredQuery, ask ? [askSelected, ask.events.length] : null, dashShown ? [dashShown.turn, dashShown.events.length] : null, activeSets, eeiOn.map((x) => x.id), eei.view]),
    [isArchive, day, effectiveFilters, deferredQuery, ask, askSelected, dashShown, activeSets, eeiOn, eei.view],
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

  // Marker → card: highlight and scroll the card into view. The tapped pin is remembered: on
  // phones (no pin popups) the card's "Move" must edit that pin, not the event's main pin.
  const [tappedPin, setTappedPin] = useState<PinRef | null>(null);
  const handleMarkerSelect = useCallback((id: string, place: number | null) => {
    setTappedPin({ id, place });
    select(id, 'map');
  }, [select]);

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
  const canMove = !isDemo && (can('event.edit.any') || can('event.edit.own'));
  const [moving, setMoving] = useState<MoveTarget | null>(null);
  const startMove = useCallback((target: MoveTarget) => {
    setDetailsId(null);
    setMobilePane('map');
    // The event being moved is the selected one: its pin is highlighted and, after saving or
    // cancelling, the phone card is that event — not the one selected before (a linked event
    // opened from another event's details used to leave the first one highlighted).
    select(target.id, 'popup');
    setMoving(target);
  }, [select]);
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
      // Older than the live 24 hours: guests see it after signing up.
      if (!ev) return void (isGuest && openGate('signup'));
      setLinkedEvent(ev);
      setDetailsId(ev.id);
    });
  }, [status, allEvents, select, isGuest]);
  // Event windows per day (plan): the window opens only once the plan allows it.
  usePlanVersion();
  const [allowedId, setAllowedId] = useState<string | null>(null);
  useEffect(() => {
    if (!detailsId || detailsId === allowedId || authStatus === 'loading') return;
    let alive = true;
    void openEventAllowed(detailsId, featureLimit('event_open'), authStatus === 'signed_in').then((why) => {
      if (!alive) return;
      if (why) {
        setDetailsId(null);
        openGateFor(why, 'event_open');
      } else setAllowedId(detailsId);
    });
    return () => {
      alive = false;
    };
  }, [detailsId, allowedId, authStatus]);
  const detailsEvent = detailsId && detailsId === allowedId ? allEvents.find((e) => e.id === detailsId) ?? (linkedEvent?.id === detailsId ? linkedEvent : null) : null;
  const closeDetails = useCallback(() => setDetailsId(null), []);
  // Phones: the selected event shows as a card along the bottom of the map.
  const sheetEvent =
    isPhone && mobilePane === 'map' && selectedId && !detailsId && !drawMode && !moving ? visibleEvents.find((e) => e.id === selectedId) ?? null : null;
  // Opening an event (also a linked one, from another event's details) selects it, so the
  // phone card and the highlighted pin behind the dialog are the event shown.
  const openDetailsFromSheet = useCallback((id: string) => {
    select(id, 'popup');
    setDetailsId(id);
  }, [select]);
  const locateFromDetails = useCallback(
    (id: string) => {
      setDetailsId(null);
      setMobilePane('map');
      select(id, 'feed');
    },
    [select],
  );

  // Logo clicked while already on the map: back to the plain map view.
  useEffect(() => {
    const home = () => {
      setMobilePane('map');
      setFiltersOpen(false);
      setDetailsId(null);
      clearSelection();
    };
    window.addEventListener(HOME_EVENT, home);
    return () => window.removeEventListener(HOME_EVENT, home);
  }, [clearSelection]);

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
        filterCount={inForce || filterCount}
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
          onDrawArea={() => {
            drawTargetRef.current = null; // a general drawing, even if a set's drawing was left open
            startDrawing();
          }}
          hideTime={isArchive}
          loadingArchive={older.loading}
          eeis={eeis}
          onAddEei={addEei}
          onRemoveEei={removeEei}
          {...(isArchive
            ? {}
            : {
                sets,
                setLimit,
                onSetsChange: setSets,
                scope: panelScope,
                onScopeChange: setPanelScope,
                onDrawForSet: drawForSet,
                setsInForce: inForce > 0,
                onSwitchSetsOff: switchSetsOff,
                eei: {
                  locked: !eeiAllowed,
                  count: eeiOn.length,
                  list: eei.list,
                  rawText: eei.rawText,
                  prev: eei.prev,
                  tags: eei.tags,
                  degraded: eei.degraded,
                  waiting: eeiWaiting,
                  view: eei.view,
                  onView: eei.setView,
                  onSave: eei.save,
                  onClear: eei.clear,
                  onRestore: eei.restore,
                  events: allEvents,
                },
              })}
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
            setTags={setTags}
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
            alerts={ask || dashShown ? NO_ALERTS : alerts}
            alertsNow={alertsNow}
            onLocateAlert={handleLocateAlert}
            title={isArchive ? t('archive.title') : undefined}
            live={!isArchive}
            resetKey={feedResetKey}
            toolbar={
              isArchive || filterCount || ask || inForce || dashShown ? (
                <div className="space-y-2">
                  {dashShown ? (
                    <div data-dash-shown className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-violet-600 px-3 text-xs font-semibold text-white">
                        {t('dash.shown', { incidents: dashShown.incidents, reports: dashShown.reports })}
                      </span>
                      {dashShown.missing > 0 ? (
                        <span data-dash-missing className="text-xs text-amber-700 dark:text-amber-400">{t('dash.missing', { n: dashShown.missing })}</span>
                      ) : null}
                      <button type="button" data-dash-action="back" onClick={() => setDashOpen(dashShown.turn)}
                        className="ms-auto h-8 rounded-lg px-2 text-xs font-semibold text-sky-700 hover:bg-sky-50 dark:text-sky-400 dark:hover:bg-sky-500/10">
                        {t('dash.back')}
                      </button>
                      <button type="button" data-dash-action="clear" onClick={() => setDashShown(null)}
                        className="h-8 rounded-lg px-2 text-xs font-semibold text-sky-700 hover:bg-sky-50 dark:text-sky-400 dark:hover:bg-sky-500/10">
                        {t('dash.clear')}
                      </button>
                    </div>
                  ) : null}
                  {ask ? (
                    <div className="flex items-center gap-2">
                      <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-violet-600 px-3 text-xs font-semibold text-white">
                        {t('ask.feedTitle')}
                      </span>
                      <span className="text-xs text-slate-500 dark:text-slate-400">{t('feed.count', { count: visibleEvents.length })}</span>
                      <button
                        type="button"
                        onClick={() => handleAskTurns([])}
                        className="ms-auto h-8 rounded-lg px-2 text-xs font-semibold text-sky-700 hover:bg-sky-50 dark:text-sky-400 dark:hover:bg-sky-500/10"
                      >
                        {t('ask.clear')}
                      </button>
                    </div>
                  ) : null}
                  {isArchive ? <ArchiveDayPicker day={day} onChange={setDay} /> : null}
                  {inForce ? (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setFiltersOpen(true)}
                        className="inline-flex h-8 items-center gap-1.5 rounded-full bg-sky-600 px-3 text-xs font-semibold text-white hover:bg-sky-500"
                      >
                        <SlidersHorizontal className="size-3.5" aria-hidden />
                        {activeSets.length || !eeiOn.length ? t('sets.active', { count: inForce }) : t('eeiList.active', { count: eeiOn.length })}
                      </button>
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        {t('feed.count', { count: visibleEvents.length })}
                      </span>
                      <button
                        type="button"
                        data-sets-off
                        onClick={switchSetsOff}
                        className="ms-auto h-8 rounded-lg px-2 text-xs font-semibold text-sky-700 hover:bg-sky-50 dark:text-sky-400 dark:hover:bg-sky-500/10"
                      >
                        {t('sets.switchOff')}
                      </button>
                    </div>
                  ) : filterCount ? (
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
                        onClick={() => {
                          setFilters(EMPTY_FILTERS);
                          switchSetsOff();
                        }}
                        className="ms-auto h-8 rounded-lg px-2 text-xs font-semibold text-sky-700 hover:bg-sky-50 dark:text-sky-400 dark:hover:bg-sky-500/10"
                      >
                        {t('filters.clearAll')}
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : undefined
            }
            emptyText={filterCount || inForce ? t('filters.none') : isArchive ? t('archive.empty') : undefined}
            footer={
              <>
                <SiteLinks className="justify-center border-t border-slate-200 px-3 py-2 dark:border-slate-800" />
              </>
            }
            adEvery={showAds ? ads.every : undefined}
          />
        </aside>

        {/* Column 2 — banner + map */}
        <main
          id="main-map"
          className={cn('min-h-0 flex-col pb-16 lg:flex lg:pb-0', mobilePane === 'map' ? 'flex' : 'hidden')}
        >
          {/* The top/bottom ad on the map is Google's anchor ad (Auto ads), not a slot here. */}
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
              area={inForce ? null : filters.polygon}
              setAreas={setAreas}
              tints={tints}
              drawMode={drawMode}
              onDrawModeChange={handleDrawModeChange}
              onAreaDrawn={handleAreaDrawn}
              onFilterCategory={filterByCategory}
              onClearArea={clearArea}
              moving={moving}
              onMoveRequest={canMove ? startMove : undefined}
              onMoveEnd={endMove}
              onMoveSave={saveMove}
              onPlaceCategory={canMove ? (target, slug) => void placeCategory(target, slug) : undefined}
              onPlaceLocate={canMove ? setLocating : undefined}
              canRemovePin={!isDemo && can('event.edit.any')}
              topSlot={canAsk ? <AskMap turns={askTurns} selected={askSelected} onTurns={handleAskTurns} onSelect={handleAskSelect} onCite={handleLocate} left={askQuota.left} onQuotaRefresh={askQuota.refresh} onOpenDashboard={setDashOpen} onShowDashboard={(i) => void showDashEvents(i, { kind: 'all' })} /> : undefined}
              fitTo={askFit}
            />
            {canAsk && !moving ? <QuickReportButton /> : null}
            {!isArchive && !isDemo && !moving ? <SocialSearchButton polygon={filters.polygon} /> : null}
            {!isArchive && !moving ? (
              <OfiFab stack={(canAsk && can('event.create') ? 1 : 0) + (!isDemo && filters.polygon && profile?.status === 'active' ? 1 : 0)} />
            ) : null}
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
            onMove={canMove ? (id) => startMove(pinTarget(id, tappedPin)) : undefined}
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
      {dashOpen !== null && askTurns[dashOpen]?.dashboard?.result ? (
        <StatsDashboard
          state={askTurns[dashOpen].dashboard!}
          staff={!!profile && profile.role !== 'viewer'}
          left={askQuota.left}
          onSelect={(sel) => void showDashEvents(dashOpen, sel)}
          onPeriod={(p) => void dashPeriod(dashOpen, p)}
          onClose={() => setDashOpen(null)}
        />
      ) : null}
    </div>
  );
}
