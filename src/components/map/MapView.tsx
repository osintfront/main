import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import L from 'leaflet';
import 'leaflet.markercluster';
import { ROTATE_OPTIONS, enableDragRotate } from './mapRotate';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import { BookOpen, Check, Globe2, Layers, LocateFixed, Map as MapIcon, Maximize2, Octagon, PenLine, Siren, Undo2, X } from 'lucide-react';
import { octagon, pointInPolygon, type LatLng } from '@/lib/eventFilters';
import type { Severity } from '@/types/event';
import { mapConfig } from '@/config/map';
import { useTheme } from '@/context/ThemeContext';
import { useI18n } from '@/i18n';
import type { FocusRequest } from '@/hooks/useMapSelection';
import type { PublicEvent } from '@/types/event';
import type { HfcAlert, HfcShape } from '@/types/hfcAlert';
import { alertNames, HFC_CATEGORY, threatInfo, zoneHeadline } from '@/config/hfcThreats';
import { formatEventTime } from '@/utils/time';
import { buildHfcPopup } from './hfcPopup';
import { BASE_STYLES, createBaseLayer, createFiresLayer, loadBaseStyle, loadFiresOn, saveBaseStyle, saveFiresOn, type BaseStyle } from './baseLayer';
import { createMarkerIcon } from './markerIcon';
import { MapContextMenu, type ContextTarget } from './MapContextMenu';
import { DEFAULT_CATEGORIES } from '@/data/categoryRegistry';
import { buildPopupContent } from './popupContent';
import { IconButton } from '@/components/common/IconButton';
import { IntelLayers } from './IntelLayers';

interface MapViewProps {
  events: PublicEvent[];
  selectedId: string | null;
  focusRequest: FocusRequest | null;
  onMarkerSelect: (id: string) => void;
  onViewEvent: (id: string) => void;
  /** Active Home Front Command alerts, drawn as polygons under the event pins. */
  alerts?: HfcAlert[];
  alertFocus?: { id: string; nonce: number } | null;
  /** Neighbouring alert polygons merged for display (null: draw each alert's own). */
  alertShapes?: HfcShape[] | null;
  /**
   * Phones: no popups (the page shows a card along the bottom instead) and no
   * +/− buttons (pinch to zoom).
   */
  compact?: boolean;
  /** Category legend, shown from a map button where there is no legend column. */
  legend?: ReactNode;
  /** A tap on the map itself (not on a pin) — phones use it to close the event card. */
  onBackgroundClick?: () => void;
  /** Drawn-area filter: the applied area (outlined on the map). */
  area?: LatLng[] | null;
  /** Drawing an area right now ('polygon' = free shape, 'octagon' = centre + edge). */
  drawMode?: DrawMode | null;
  onDrawModeChange?: (mode: DrawMode | null) => void;
  onAreaDrawn?: (points: LatLng[]) => void;
  onClearArea?: () => void;
  /** Staff: the pin being moved — the event's main pin (place null) or one of its extra places. */
  moving?: MoveTarget | null;
  /** Staff: "change location" in a popup. Absent = visitors (no button). */
  onMoveRequest?: (target: MoveTarget) => void;
  onMoveEnd?: () => void;
  /** Save the new pin; resolve true when stored. */
  onMoveSave?: (target: MoveTarget, lat: number, lng: number, mode: 'move' | 'copy' | 'remove') => Promise<boolean>;
  /** Staff: change one icon's category, or set its place by search. */
  onPlaceCategory?: (target: MoveTarget, slug: string) => void;
  onPlaceLocate?: (target: MoveTarget) => void;
  /** Editors/admins: the move bar also offers "remove from map". */
  canRemovePin?: boolean;
  /** Right-click menu: "filter by this type". */
  onFilterCategory?: (slug: string) => void;
  /** Shown at the top centre, under the alerts banner (e.g. "ask the map"). */
  topSlot?: ReactNode;
  /** Zoom the map to these points whenever key changes (e.g. search results). */
  fitTo?: { key: number; points: [number, number][] } | null;
}

export type DrawMode = 'polygon' | 'octagon';
/** place = index in events.locations (EventPlace.index), null = the main pin. */
export interface MoveTarget {
  id: string;
  place: number | null;
}

const SEVERITY_RANK: Record<Severity, number> = { low: 0, medium: 1, high: 2, critical: 3 };

/** One round icon with a count for pins that would overlap; ring colour = the most common category. */
function clusterIcon(cluster: L.MarkerCluster): L.DivIcon {
  const children = cluster.getAllChildMarkers();
  const count = cluster.getChildCount();
  const colors = new Map<string, number>();
  let worst = 0;
  for (const m of children) {
    const o = m.options as { ofmColor?: string; ofmSeverity?: Severity };
    if (o.ofmColor) colors.set(o.ofmColor, (colors.get(o.ofmColor) ?? 0) + 1);
    if (o.ofmSeverity) worst = Math.max(worst, SEVERITY_RANK[o.ofmSeverity]);
  }
  const color = [...colors.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '#334155';
  const size = count < 10 ? 36 : count < 50 ? 42 : 48;
  return L.divIcon({
    html: `<div class="ofm-cluster${worst >= 3 ? ' ofm-cluster--critical' : ''}" style="--cluster-color:${color};--cluster-size:${size}px"><span>${count}</span></div>`,
    className: 'ofm-cluster-wrap',
    iconSize: [size, size],
  });
}

interface AlertEntry {
  /** Pin of the first alerted place — its popup opens when the card asks. */
  marker: L.Marker | null;
  bounds: L.LatLngBounds | null;
}

/** Above this many places, alert pins switch to the compact size. */
const COMPACT_ALERT_PINS = 25;

const NO_ALERTS: HfcAlert[] = [];

interface MarkerEntry {
  /** Main pin first, then one pin per further place the report names. */
  markers: L.Marker[];
  event: PublicEvent;
}

/** All points of an event: the main pin and its further places. */
function eventPoints(event: PublicEvent): [number, number][] {
  return [[event.latitude, event.longitude], ...(event.places ?? []).map((p) => [p.latitude, p.longitude] as [number, number])];
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/**
 * Several pins on the very same spot, laid out so each one is visible and easy to tap:
 * 2–3 side by side, 4–12 in a ring around the spot, more in centred rows. Returns [x, y] pixels.
 */
function spread(i: number, n: number): [number, number] {
  if (n <= 1) return [0, 0];
  if (n <= 3) return [Math.round((i - (n - 1) / 2) * 38), 0];
  if (n <= 12) {
    const r = Math.max(34, (42 * n) / (2 * Math.PI));
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    return [Math.round(r * Math.cos(a)), Math.round(r * Math.sin(a) + r * 0.35)];
  }
  const cols = 6;
  const rows = Math.ceil(n / cols);
  const row = Math.floor(i / cols);
  const inRow = row === rows - 1 ? n - row * cols : cols;
  const col = i % cols;
  return [Math.round((col - (inRow - 1) / 2) * 38), Math.round((row - (rows - 1) / 2) * 44)];
}

export function MapView({
  onFilterCategory,
  events,
  selectedId,
  focusRequest,
  onMarkerSelect,
  onViewEvent,
  alerts = NO_ALERTS,
  alertFocus = null,
  alertShapes = null,
  compact = false,
  legend,
  onBackgroundClick,
  area = null,
  drawMode = null,
  onDrawModeChange,
  onAreaDrawn,
  onClearArea,
  moving = null,
  onMoveRequest,
  onMoveEnd,
  onMoveSave,
  onPlaceCategory,
  onPlaceLocate,
  canRemovePin = false,
  topSlot,
  fitTo = null,
}: MapViewProps) {
  const { theme } = useTheme();
  const { t, dir, locale, lang, categoryLabel } = useI18n();

  const containerRef = useRef<HTMLDivElement>(null);
  const [ctxMenu, setCtxMenu] = useState<ContextTarget | null>(null);
  const closeCtx = useCallback(() => setCtxMenu(null), []);
  const ctxRef = useRef(setCtxMenu);
  const hoverTips = typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const mapRef = useRef<L.Map | null>(null);
  const markerLayerRef = useRef<L.MarkerClusterGroup | null>(null);
  const drawLayerRef = useRef<L.LayerGroup | null>(null);
  const [draft, setDraft] = useState<LatLng[]>([]);
  const linkLayerRef = useRef<L.LayerGroup | null>(null);
  /** The focused event's pins, taken out of the clusters so they stay visible at any zoom. */
  const focusLayerRef = useRef<L.LayerGroup | null>(null);
  const focusedRef = useRef<{ id: string; markers: L.Marker[] } | null>(null);
  /** Moving pins between layers closes their popup: that close must not end the focus. */
  const relayeringRef = useRef(false);
  const topOverlayRef = useRef<HTMLDivElement>(null);
  const [legendOpen, setLegendOpen] = useState(false);
  const alertLayerRef = useRef<L.LayerGroup | null>(null);
  const alertEntriesRef = useRef(new Map<string, AlertEntry>());
  const [alertsVersion, setAlertsVersion] = useState(0);
  const handledAlertFocusRef = useRef<number | null>(null);
  const baseLayerRef = useRef<L.Layer | null>(null);
  const zoomControlRef = useRef<L.Control.Zoom | null>(null);
  const markersRef = useRef(new Map<string, MarkerEntry>());
  const handledFocusRef = useRef<number | null>(null);
  const [markersVersion, setMarkersVersion] = useState(0);
  /** The selected event whose focus (faded others, link lines) was ended by the visitor. */
  const [undimmedId, setUndimmedId] = useState<string | null>(null);
  const focusId = selectedId && selectedId !== undimmedId ? selectedId : null;

  // Latest callbacks/selection without re-binding every marker.
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const onMarkerSelectRef = useRef(onMarkerSelect);
  onMarkerSelectRef.current = onMarkerSelect;
  const onViewEventRef = useRef(onViewEvent);
  onViewEventRef.current = onViewEvent;
  const onBackgroundClickRef = useRef(onBackgroundClick);
  onBackgroundClickRef.current = onBackgroundClick;
  const onMoveRequestRef = useRef(onMoveRequest);
  onMoveRequestRef.current = onMoveRequest;
  const onPlaceCategoryRef = useRef(onPlaceCategory);
  onPlaceCategoryRef.current = onPlaceCategory;
  const onPlaceLocateRef = useRef(onPlaceLocate);
  onPlaceLocateRef.current = onPlaceLocate;
  const onMoveEndRef = useRef(onMoveEnd);
  onMoveEndRef.current = onMoveEnd;
  const onMoveSaveRef = useRef(onMoveSave);
  onMoveSaveRef.current = onMoveSave;
  const canMove = !!onMoveRequest;
  const moveLayerRef = useRef<L.LayerGroup | null>(null);
  const [movePos, setMovePos] = useState<LatLng | null>(null);
  const movePosRef = useRef<LatLng | null>(null);
  movePosRef.current = movePos;
  const [moveBusy, setMoveBusy] = useState(false);
  const [baseStyle, setBaseStyle] = useState<BaseStyle>(loadBaseStyle);
  const [styleFailed, setStyleFailed] = useState<BaseStyle | null>(null);
  const [stylesOpen, setStylesOpen] = useState(false);
  const [firesOn, setFiresOn] = useState(loadFiresOn);
  // Intelligence layers (satellite, ships, aircraft): their own panel; the fires follow the satellite day.
  const [leafletMap, setLeafletMap] = useState<L.Map | null>(null);
  const [intelOpen, setIntelOpen] = useState(false);
  const [firesDate, setFiresDate] = useState<string | null>(null);
  const toggleFires = useCallback((on: boolean) => {
    setFiresOn(on);
    saveFiresOn(on);
  }, []);
  const firesLayerRef = useRef<L.Layer | null>(null);
  const eventsRef = useRef(events);
  eventsRef.current = events;
  // While drawing, a tap on the map adds a corner instead of closing things.
  const drawClickRef = useRef<((p: LatLng) => void) | null>(null);

  // 1. Create the map once.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const map = L.map(container, {
      center: mapConfig.defaultView.center,
      zoom: mapConfig.defaultView.zoom,
      minZoom: mapConfig.minZoom,
      maxZoom: mapConfig.maxZoom,
      zoomControl: false,
      worldCopyJump: true,
      ...ROTATE_OPTIONS,
    });
    enableDragRotate(map);
    // A popup opened near the map's edge (or growing as its photo loads) is panned fully
    // into view, and never taller than the map (it scrolls inside instead).
    map.on('popupopen', (e: L.PopupEvent) => {
      const popup = e.popup as L.Popup & { _adjustPan?: () => void };
      const fit = () => {
        if (!map.hasLayer(popup)) return;
        // The bars along the top of the map (red-alert banner, "ask the map") sit above
        // Leaflet's panes: keep the window below them, or its top is hidden behind them.
        const box = container.getBoundingClientRect();
        const bar = topOverlayRef.current?.getBoundingClientRect();
        const top = bar && bar.height > 0 ? Math.max(24, Math.round(bar.bottom - box.top) + 12) : 24;
        popup.options.maxHeight = Math.max(160, map.getSize().y - top - 66);
        popup.options.autoPanPaddingTopLeft = L.point(24, top);
        popup.options.autoPanPaddingBottomRight = L.point(24, 24);
        popup.update();
        popup._adjustPan?.();
      };
      window.setTimeout(fit, 0);
      window.setTimeout(fit, 350);
      popup.getElement()?.querySelectorAll('img').forEach((img) => img.addEventListener('load', fit, { once: true }));
    });
    alertLayerRef.current = L.layerGroup().addTo(map);
    linkLayerRef.current = L.layerGroup().addTo(map);
    drawLayerRef.current = L.layerGroup().addTo(map);
    moveLayerRef.current = L.layerGroup().addTo(map);
    markerLayerRef.current = L.markerClusterGroup({
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      zoomToBoundsOnClick: true, // a tap on a cluster zooms in until its pins separate
      maxClusterRadius: (zoom: number) => (zoom >= 11 ? 32 : 48),
      disableClusteringAtZoom: 16,
      chunkedLoading: true,
      iconCreateFunction: clusterIcon,
    }).addTo(map);
    focusLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    setLeafletMap(map);
    // Right-click on the map: our investigation menu instead of the browser's (Leaflet then blocks the default menu).
    map.on('contextmenu', (e: L.LeafletMouseEvent) => {
      ctxRef.current({ x: e.containerPoint.x, y: e.containerPoint.y, lat: e.latlng.lat, lng: e.latlng.lng });
    });
    map.on('click', (e: L.LeafletMouseEvent) => {
      if (drawClickRef.current) drawClickRef.current([e.latlng.lat, e.latlng.lng]);
      else {
        setUndimmedId(selectedRef.current); // a tap on the empty map ends the focus
        onBackgroundClickRef.current?.();
      }
    });
    // Closing the event's window (✕) ends the focus; opening one (re)starts it.
    map.on('popupclose', () => {
      if (!relayeringRef.current) setUndimmedId(selectedRef.current);
    });
    map.on('popupopen', () => setUndimmedId(null));

    // Keeps tiles correct when the column is resized or shown on mobile.
    const observer = new ResizeObserver(() => map.invalidateSize({ pan: false }));
    observer.observe(container);

    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      setLeafletMap(null);
      markerLayerRef.current = null;
      linkLayerRef.current = null;
      drawLayerRef.current = null;
      moveLayerRef.current = null;
      alertLayerRef.current = null;
      alertEntriesRef.current.clear();
      handledAlertFocusRef.current = null;
      baseLayerRef.current = null;
      zoomControlRef.current = null;
      markersRef.current.clear();
      handledFocusRef.current = null;
    };
  }, []);

  // 2. Base tiles follow the theme.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (baseLayerRef.current) map.removeLayer(baseLayerRef.current);
    const layer = createBaseLayer(theme, undefined, baseStyle);
    layer.addTo(map);
    baseLayerRef.current = layer;
    // A style whose tile server refuses us shows an empty map: fall back to the standard map.
    if (baseStyle === 'standard') return;
    let loaded = 0;
    let failed = 0;
    const onLoad = () => (loaded += 1);
    const onError = () => {
      failed += 1;
      if (failed >= 6 && loaded === 0) {
        setStyleFailed(baseStyle);
        setBaseStyle('standard');
      }
    };
    layer.on('tileload', onLoad);
    layer.on('tileerror', onError);
    return () => {
      layer.off('tileload', onLoad);
      layer.off('tileerror', onError);
    };
  }, [theme, baseStyle]);

  // 2a. Zoom to a set of points (search results).
  const fitKey = fitTo?.key ?? 0;
  useEffect(() => {
    const map = mapRef.current;
    const pts = fitTo?.points ?? [];
    if (!map || !fitKey || !pts.length) return;
    if (pts.length === 1) map.setView(pts[0], Math.max(map.getZoom(), 10));
    else map.fitBounds(L.latLngBounds(pts), { padding: [60, 60], maxZoom: 11 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  // 2b. NASA FIRMS fires overlay (visitor's choice).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (firesLayerRef.current) {
      map.removeLayer(firesLayerRef.current);
      firesLayerRef.current = null;
    }
    if (!firesOn) return;
    try {
      firesLayerRef.current = createFiresLayer(firesDate).addTo(map);
    } catch {
      /* overlay is optional */
    }
  }, [firesOn, firesDate]);

  // 3. Zoom control sits on the side away from the feed and follows the language.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    zoomControlRef.current?.remove();
    zoomControlRef.current = null;
    if (compact) return; // phones: pinch to zoom
    zoomControlRef.current = L.control
      .zoom({
        position: dir === 'rtl' ? 'topleft' : 'topright',
        zoomInTitle: t('map.zoomIn'),
        zoomOutTitle: t('map.zoomOut'),
      })
      .addTo(map);
  }, [dir, t, compact]);

  // 4. One marker per place: the event's main pin plus a pin for every further place it names.
  //    Only events that are new or changed get new markers; the rest stay as they are, so a busy
  //    feed doesn't rebuild hundreds of pins (and close open popups) on every update.
  const builtWithRef = useRef<unknown[]>([]);
  useEffect(() => {
    const layer = markerLayerRef.current;
    if (!layer) return;
    const deps = [t, dir, locale, lang, categoryLabel, compact, canMove];
    const sameDeps = builtWithRef.current.length === deps.length && deps.every((d, i) => d === builtWithRef.current[i]);
    builtWithRef.current = deps;
    const wanted = new Map(events.map((e) => [e.id, e]));
    const gone: L.Marker[] = [];
    // Pins held out of the clusters go back first (they may be rebuilt below).
    const held = focusedRef.current;
    if (held) {
      relayeringRef.current = true;
      focusLayerRef.current?.clearLayers();
      relayeringRef.current = false;
      focusedRef.current = null;
      if (markersRef.current.get(held.id)?.markers === held.markers && sameDeps && wanted.get(held.id) === markersRef.current.get(held.id)?.event) {
        layer.addLayers(held.markers);
      }
    }
    if (!sameDeps) {
      layer.clearLayers();
      markersRef.current.clear();
    } else {
      markersRef.current.forEach((entry, id) => {
        if (wanted.get(id) !== entry.event) {
          gone.push(...entry.markers);
          markersRef.current.delete(id);
        }
      });
      if (gone.length) layer.removeLayers(gone);
    }
    const all: L.Marker[] = [];

    for (const event of events) {
      if (markersRef.current.has(event.id)) continue; // unchanged: keep its pins
      const selected = event.id === selectedRef.current;
      const places = [
        { lat: event.latitude, lng: event.longitude, label: event.title, place: null as number | null, categorySlug: null as string | null },
        ...(event.places ?? []).map((p) => ({
          categorySlug: p.categorySlug ?? null,
          place: p.index as number | null,
          lat: p.latitude,
          lng: p.longitude,
          label: `${event.title} — ${(lang === 'he' ? p.name : p.nameEn) || p.name || p.nameEn}`,
        })),
      ];
      const markers: L.Marker[] = [];
      places.forEach((place, index) => {
        // A place of a detailed report may have its own kind (airstrike / shelling / …).
        const own = place.categorySlug && place.categorySlug !== event.category.slug ? DEFAULT_CATEGORIES.find((c) => c.slug === place.categorySlug) : undefined;
        const marker = L.marker([place.lat, place.lng], {
          icon: createMarkerIcon({
            iconName: own?.icon ?? event.category.icon,
            color: own?.color ?? event.category.markerColor,
            severity: event.severity,
            selected,
            breaking: event.isBreaking,
            compact: index > 0,
          }),
          title: hoverTips ? '' : place.label,
          alt: place.label,
          keyboard: true,
          riseOnHover: true,
          zIndexOffset: selected ? 1000 : event.severity === 'critical' ? 400 : 0,
        });
        Object.assign(marker.options, { ofmColor: own?.color ?? event.category.markerColor, ofmSeverity: event.severity, ofmIcon: own?.icon ?? event.category.icon });
        if (!compact) {
          marker.bindPopup(
            () =>
              buildPopupContent(
                event,
                {
                  severityLabel: t(`severity.${event.severity}`),
                  verified: t('feed.verified'),
                  breaking: t('feed.breaking'),
                  viewEvent: t('map.viewEvent'),
                  openSource: t('map.openSource'),
                  approximate: t('feed.approximate'),
                  locale,
                  dir,
                  moveLocation: canMove ? t('move.button') : undefined,
                  locatePlace: canMove ? t('list.quickLocation') : undefined,
                  // Each icon shows its own kind; staff can switch it here.
                  categoryLabel: categoryLabel(own?.slug ?? event.category.slug, own?.name ?? event.category.name),
                  categorySlug: own?.slug ?? event.category.slug,
                  chipColor: own?.color ?? event.category.color,
                  categories: canMove
                    ? DEFAULT_CATEGORIES.filter((c) => !['home-front-alerts', 'other', 'uncategorized'].includes(c.slug)).map((c) => ({ slug: c.slug, label: categoryLabel(c.slug, c.name) }))
                    : undefined,
                },
                (id) => onViewEventRef.current(id),
                canMove
                  ? {
                      onMove: (id) => onMoveRequestRef.current?.({ id, place: place.place }),
                      onLocate: () => onPlaceLocateRef.current?.({ id: event.id, place: place.place }),
                      onCategory: (slug) => onPlaceCategoryRef.current?.({ id: event.id, place: place.place }, slug),
                    }
                  : {},
              ),
            { maxWidth: 320, minWidth: 240, autoPanPadding: [28, 28], className: 'ofm-popup-shell' },
          );
        }
        marker.on('click', () => onMarkerSelectRef.current(event.id));
        marker.on('contextmenu', (e: L.LeafletMouseEvent) => {
          L.DomEvent.stop(e);
          const pt = mapRef.current?.latLngToContainerPoint(e.latlng);
          ctxRef.current({ x: pt?.x ?? 0, y: pt?.y ?? 0, lat: place.lat, lng: place.lng, event, categorySlug: own?.slug ?? event.category.slug });
        });
        // Desktop hover: a short tooltip (type · headline).
        if (hoverTips && !compact) {
          const tip = document.createElement('div');
          tip.dir = dir;
          const b = document.createElement('b');
          b.textContent = categoryLabel(own?.slug ?? event.category.slug, own?.name ?? event.category.name);
          tip.append(b, document.createTextNode(` · ${place.label.length > 70 ? `${place.label.slice(0, 68)}…` : place.label}`));
          marker.bindTooltip(tip, { direction: 'top', offset: [0, -20], opacity: 0.95 });
        }
        all.push(marker);
        markers.push(marker);
      });
      markersRef.current.set(event.id, { markers, event });
    }
    if (all.length) layer.addLayers(all);
    // Several reports on the very same spot (the same village, two channels): their pins
    // stand side by side, so each one can be clicked even when one is held out of the clusters.
    if (all.length || gone.length || !sameDeps) {
      const stacks = new Map<string, { marker: L.Marker; event: MarkerEntry['event']; index: number }[]>();
      markersRef.current.forEach(({ markers, event }) =>
        markers.forEach((marker, index) => {
          const ll = marker.getLatLng();
          const key = `${ll.lat.toFixed(5)},${ll.lng.toFixed(5)}`;
          stacks.set(key, [...(stacks.get(key) ?? []), { marker, event, index }]);
        }),
      );
      stacks.forEach((list) => {
        list.sort((a, b) => (a.event.id < b.event.id ? -1 : 1));
        list.forEach(({ marker, event, index }, i) => {
          const [shift, shiftY] = spread(i, list.length);
          const o = marker.options as { ofmShift?: number; ofmShiftY?: number; ofmIcon?: string; ofmColor?: string };
          if ((o.ofmShift ?? 0) === shift && (o.ofmShiftY ?? 0) === shiftY) return;
          o.ofmShift = shift;
          o.ofmShiftY = shiftY;
          marker.setIcon(
            createMarkerIcon({
              iconName: o.ofmIcon ?? event.category.icon,
              color: o.ofmColor ?? event.category.markerColor,
              severity: event.severity,
              selected: event.id === selectedRef.current,
              breaking: event.isBreaking,
              compact: index > 0,
              shift,
              shiftY,
            }),
          );
        });
      });
    }
    if (all.length || gone.length || !sameDeps || held) setMarkersVersion((v) => v + 1);
  }, [events, t, dir, locale, lang, categoryLabel, compact, canMove]);

  // 4c. Staff: move a pin. Drag the pin or tap the map; ✓ saves, ✗ cancels.
  const movingId = moving?.id ?? null;
  const movingPlace = moving?.place ?? null;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !movingId) {
      setMovePos(null);
      return;
    }
    const ev = eventsRef.current.find((e) => e.id === movingId);
    const c = map.getCenter();
    const extra = movingPlace !== null ? ev?.places?.find((p) => p.index === movingPlace) : undefined;
    setMovePos(extra ? [extra.latitude, extra.longitude] : ev && ev.locationPrecision ? [ev.latitude, ev.longitude] : [c.lat, c.lng]);
    map.closePopup();
    drawClickRef.current = (p) => setMovePos(p);
    return () => {
      drawClickRef.current = null;
    };
  }, [movingId, movingPlace]);

  const [confirmRemove, setConfirmRemove] = useState(false);
  useEffect(() => setConfirmRemove(false), [movingId, movingPlace]);
  const saveMove = useCallback(async (mode: 'move' | 'copy' | 'remove' = 'move') => {
    const pos = movePosRef.current;
    if (!movingId || !onMoveSaveRef.current || (!pos && mode !== 'remove')) return;
    setMoveBusy(true);
    try {
      if (await onMoveSaveRef.current({ id: movingId, place: movingPlace }, pos?.[0] ?? 0, pos?.[1] ?? 0, mode)) onMoveEndRef.current?.();
    } finally {
      setMoveBusy(false);
    }
  }, [movingId, movingPlace]);
  const saveMoveRef = useRef(saveMove);
  saveMoveRef.current = saveMove;

  useEffect(() => {
    const layer = moveLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    if (!movingId || !movePos) return;
    const icon = L.divIcon({
      className: 'ofm-move',
      html:
        `<div class="ofm-move__actions">` +
        `<button type="button" data-act="ok" class="ofm-move__ok" title="${t('move.save')}" aria-label="${t('move.save')}"${moveBusy ? ' disabled' : ''}>✓</button>` +
        `<button type="button" data-act="copy" class="ofm-move__copy" title="${t('move.copy')}" aria-label="${t('move.copy')}"${moveBusy ? ' disabled' : ''}>⧉</button>` +
        `<button type="button" data-act="no" class="ofm-move__no" title="${t('move.cancel')}" aria-label="${t('move.cancel')}">✕</button>` +
        `</div><div class="ofm-move__pin"></div>`,
      iconSize: [0, 0],
      iconAnchor: [0, 0],
    });
    const pin = L.marker(movePos, { icon, draggable: !moveBusy, zIndexOffset: 5000, keyboard: false }).addTo(layer);
    pin.on('dragend', () => {
      const ll = pin.getLatLng();
      setMovePos([ll.lat, ll.lng]);
    });
    const el = pin.getElement();
    if (el) {
      el.querySelectorAll('button').forEach((b) => {
        L.DomEvent.on(b, 'mousedown touchstart dblclick', L.DomEvent.stopPropagation);
        L.DomEvent.on(b, 'click', (e) => {
          L.DomEvent.stop(e);
          if (b.dataset.act === 'ok') void saveMoveRef.current('move');
          else if (b.dataset.act === 'copy') void saveMoveRef.current('copy');
          else onMoveEndRef.current?.();
        });
      });
    }
  }, [movingId, movePos, moveBusy, t]);

  // 4b. Home Front Command alerts: merged polygon + a pulsing siren pin at its centre.
  useEffect(() => {
    const layer = alertLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    alertEntriesRef.current.clear();

    for (const alert of alerts) {
      const threat = threatInfo(alert.threat);
      const threatLabel = t(`hfc.threat.${threat.key}`);
      const { areas, zones } = alertNames(alert, lang);
      const popup = () =>
        buildHfcPopup(alert, {
          category: categoryLabel(HFC_CATEGORY.slug, HFC_CATEGORY.name),
          threat: threatLabel,
          color: threat.color,
          areas,
          zones,
          started: t('hfc.started'),
          lastAlert: t('hfc.lastAlert'),
          clearsAt: t('hfc.clearsAt', { time: formatEventTime(alert.expiresAt, locale) }),
          alertsCount: t('hfc.areasCount', { count: areas.length }),
          more: (n) => t('hfc.moreAreas', { count: n }),
          locale,
          dir,
        });
      const popupOptions = { maxWidth: 320, minWidth: 240, autoPanPadding: [28, 28] as [number, number], className: 'ofm-popup-shell' };

      let bounds: L.LatLngBounds | null = null;
      if (alert.geometry) {
        const shape = L.geoJSON(alert.geometry, {
          style: {
            color: threat.color,
            weight: 2,
            opacity: 0.95,
            fillColor: threat.color,
            fillOpacity: 0.28,
            className: 'ofm-hfc-area',
          },
        });
        bounds = shape.getBounds();
        if (!alertShapes) {
          shape.bindTooltip(`${threatLabel} · ${zoneHeadline(zones, areas, 2)}`, { sticky: true, direction: 'top', className: 'ofm-hfc-tooltip' });
          shape.bindPopup(popup, popupOptions);
          shape.addTo(layer);
        }
      }

      // A siren pin on every alerted place (the polygon shows their combined area).
      const points = alert.areaPoints.length
        ? alert.areaPoints
        : alert.center
          ? [{ name: zoneHeadline(zones, areas, 2), nameEn: null, lat: alert.center[0], lng: alert.center[1] }]
          : [];
      const compact = points.length > COMPACT_ALERT_PINS;
      let marker: L.Marker | null = null;
      for (const point of points) {
        const placeName = lang === 'he' ? point.name : point.nameEn || point.name;
        const pin = L.marker([point.lat, point.lng], {
          icon: createMarkerIcon({ iconName: 'Siren', color: threat.color, severity: 'critical', selected: false, breaking: true, compact }),
          title: `${threatLabel} — ${placeName}`,
          alt: `${threatLabel} — ${placeName}`,
          keyboard: true,
          zIndexOffset: 800,
        });
        pin.bindPopup(popup, popupOptions);
        pin.addTo(layer);
        if (!marker) marker = pin;
      }
      if (!bounds && points.length) bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number]));
      alertEntriesRef.current.set(alert.id, { marker, bounds });
    }

    // Merged shapes: one continuous polygon over touching areas of the same threat.
    if (alertShapes) {
      const byId = new Map(alerts.map((a) => [a.id, a]));
      for (const sh of alertShapes) {
        const threat = threatInfo(sh.threat);
        const names = sh.alertIds
          .map((id) => byId.get(id))
          .filter((a): a is HfcAlert => !!a)
          .map((a) => zoneHeadline(alertNames(a, lang).zones, alertNames(a, lang).areas, 1));
        const poly = L.geoJSON(sh.geometry, {
          style: { color: threat.color, weight: 2, opacity: 0.95, fillColor: threat.color, fillOpacity: 0.28, className: 'ofm-hfc-area' },
        });
        poly.bindTooltip(`${t(`hfc.threat.${threat.key}`)} · ${names.join(', ')}`, { sticky: true, direction: 'top', className: 'ofm-hfc-tooltip' });
        // Clicking the shape opens the popup of the alert closest to the top of the list.
        const first = sh.alertIds.map((id) => alertEntriesRef.current.get(id)?.marker).find(Boolean);
        if (first) poly.on('click', () => first.openPopup());
        poly.addTo(layer);
      }
    }
    setAlertsVersion((v) => v + 1);
  }, [alerts, alertShapes, t, dir, locale, lang, categoryLabel]);

  // 4c. Alert card "Locate": fit the polygon and open its popup.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !alertFocus || handledAlertFocusRef.current === alertFocus.nonce) return;
    const entry = alertEntriesRef.current.get(alertFocus.id);
    if (!entry || !entry.bounds) return;
    handledAlertFocusRef.current = alertFocus.nonce;
    map.closePopup();
    const open = () => entry.marker?.openPopup();
    const reduce = prefersReducedMotion();
    map.once('moveend', open);
    map.flyToBounds(entry.bounds, { padding: [56, 56], maxZoom: 12, duration: reduce ? 0 : 0.9 });
    const fallback = window.setTimeout(open, 1400);
    return () => {
      window.clearTimeout(fallback);
      map.off('moveend', open);
    };
  }, [alertFocus, alertsVersion]);

  const fitAlerts = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    let all: L.LatLngBounds | null = null;
    alertEntriesRef.current.forEach(({ bounds }) => {
      if (!bounds) return;
      all = all ? all.extend(bounds) : L.latLngBounds([]).extend(bounds);
    });
    const target = all as L.LatLngBounds | null;
    if (target && target.isValid()) {
      map.closePopup();
      map.flyToBounds(target, { padding: [56, 56], maxZoom: 11, duration: prefersReducedMotion() ? 0 : 0.8 });
    }
  }, []);

  // 5. Highlight the selected event's pins, and join its places with dashed lines.
  //    Only the previously and the newly selected events need new icons (new pins are built
  //    with the right one already).
  const lastSelectedRef = useRef<string | null>(null);
  useEffect(() => {
    const touched = new Set([lastSelectedRef.current, selectedId].filter(Boolean) as string[]);
    lastSelectedRef.current = selectedId ?? null;
    touched.forEach((id) => {
      const entry = markersRef.current.get(id);
      if (!entry) return;
      const { markers, event } = entry;
      const selected = id === selectedId;
      markers.forEach((marker, index) => {
        marker.setIcon(
          createMarkerIcon({
            iconName: (marker.options as { ofmIcon?: string }).ofmIcon ?? event.category.icon,
            color: (marker.options as { ofmColor?: string }).ofmColor ?? event.category.markerColor,
            severity: event.severity,
            selected,
            breaking: event.isBreaking,
            compact: index > 0,
            shift: (marker.options as { ofmShift?: number }).ofmShift,
            shiftY: (marker.options as { ofmShiftY?: number }).ofmShiftY,
          }),
        );
        marker.setZIndexOffset(selected ? 1000 : event.severity === 'critical' ? 400 : 0);
      });
    });
    const links = linkLayerRef.current;
    links?.clearLayers();
    const entry = focusId ? markersRef.current.get(focusId) : undefined;
    if (links && entry && entry.markers.length > 1) {
      const [main, ...rest] = eventPoints(entry.event);
      for (const point of rest) {
        L.polyline([main, point], {
          color: entry.event.category.markerColor,
          weight: 2,
          opacity: 0.8,
          dashArray: '6 6',
          interactive: false,
        }).addTo(links);
      }
    }
    // Events split from the same report (one per category): a thin line to each of them.
    const group = entry?.event.reportGroup;
    if (links && entry && group) {
      const [from] = eventPoints(entry.event);
      for (const other of markersRef.current.values()) {
        if (other === entry || other.event.reportGroup !== group) continue;
        for (const point of eventPoints(other.event)) {
          L.polyline([from, point], {
            color: other.event.category.markerColor,
            weight: 1.5,
            opacity: 0.7,
            dashArray: '2 6',
            interactive: false,
          }).addTo(links);
        }
      }
    }
  }, [selectedId, focusId, markersVersion]);

  // 6b. The focused event's pins leave the clusters (they stay visible, with their links,
  // when the map zooms out) and go back when the focus ends.
  useEffect(() => {
    const group = markerLayerRef.current;
    const holder = focusLayerRef.current;
    if (!group || !holder) return;
    const entry = focusId ? markersRef.current.get(focusId) : undefined;
    const cur = focusedRef.current;
    // The pin just clicked has its window open. Note it before the held pins go back: one of
    // them may stand on the same spot, the two merge into a cluster and the window closes.
    const open = entry?.markers.find((m) => m.isPopupOpen());
    if (cur && (cur.id !== focusId || entry?.markers !== cur.markers)) {
      // Moving pins in and out of the clusters closes windows: that is not the reader closing
      // one, so it must not end the focus.
      relayeringRef.current = true;
      holder.clearLayers();
      if (markersRef.current.get(cur.id)?.markers === cur.markers) group.addLayers(cur.markers);
      relayeringRef.current = false;
      focusedRef.current = null;
    }
    if (entry && focusId && !focusedRef.current) {
      relayeringRef.current = true;
      group.removeLayers(entry.markers);
      entry.markers.forEach((m) => holder.addLayer(m));
      relayeringRef.current = false;
      focusedRef.current = { id: focusId, markers: entry.markers };
      if (open && !compact) open.openPopup();
    }
  }, [focusId, markersVersion, compact]);

  // 6c. Dimming. A selected event with several places: its pins stay bright, every other
  // pin (and cluster) fades. A drawn area: the pins of a matching event that lie outside
  // the area fade (the event is shown because another of its places is inside).
  useEffect(() => {
    const container = containerRef.current;
    const focus = focusId ? markersRef.current.get(focusId) : undefined;
    const focusOn = !!focus && focus.markers.length > 1;
    const areaOn = !!area && area.length >= 3 && !drawMode;
    container?.classList.toggle('ofm-dim-clusters', focusOn);
    markersRef.current.forEach(({ markers }, id) => {
      markers.forEach((marker) => {
        let o = 1;
        if (focusOn && id !== focusId) o = 0.25;
        else if (areaOn) {
          const ll = marker.getLatLng();
          if (!pointInPolygon([ll.lat, ll.lng], area!)) o = 0.35;
        }
        marker.setOpacity(o);
      });
    });
    // Home Front Command alert pins fade with the other events.
    alertLayerRef.current?.eachLayer((l) => (l as L.Marker).setOpacity?.(focusOn ? 0.25 : 1));
  }, [focusId, markersVersion, area, drawMode, alerts]);

  // 7. Drawn-area filter. Drawing: each tap adds a corner (free shape), or centre then
  //    edge (octagon). The applied area stays outlined while the filter is on.
  const draftRef = useRef<LatLng[]>([]);
  const onAreaDrawnRef = useRef(onAreaDrawn);
  onAreaDrawnRef.current = onAreaDrawn;
  const setDraftBoth = useCallback((next: LatLng[]) => {
    draftRef.current = next;
    setDraft(next);
  }, []);
  const finishDrawing = useCallback(
    (points: LatLng[]) => {
      setDraftBoth([]);
      if (points.length >= 3) onAreaDrawnRef.current?.(points);
    },
    [setDraftBoth],
  );
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    setDraftBoth([]);
    if (!drawMode) return;
    map.closePopup();
    map.doubleClickZoom.disable();
    const container = map.getContainer();
    container.classList.add('ofm-drawing');
    drawClickRef.current = (p) => {
      const d = draftRef.current;
      if (drawMode === 'octagon') {
        if (d.length === 1) finishDrawing(octagon(d[0], p));
        else setDraftBoth([p]);
        return;
      }
      setDraftBoth([...d, p]);
    };
    return () => {
      drawClickRef.current = null;
      map.doubleClickZoom.enable();
      container.classList.remove('ofm-drawing');
    };
  }, [drawMode, finishDrawing, setDraftBoth]);

  useEffect(() => {
    const layer = drawLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    const style = { color: '#0284c7', weight: 2, dashArray: '6 4', fillColor: '#0ea5e9', fillOpacity: 0.08, interactive: false };
    if (area && area.length >= 3 && !drawMode) L.polygon(area, style).addTo(layer);
    if (drawMode && draft.length) {
      if (draft.length >= 3) L.polygon(draft, style).addTo(layer);
      else if (draft.length === 2) L.polyline(draft, style).addTo(layer);
      for (const p of draft) {
        L.circleMarker(p, { radius: 6, color: '#0284c7', weight: 2, fillColor: '#ffffff', fillOpacity: 1, interactive: false }).addTo(layer);
      }
    }
  }, [area, draft, drawMode]);

  // Show the whole area once it is applied.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !area || area.length < 3) return;
    map.flyToBounds(L.latLngBounds(area), { padding: [48, 48], maxZoom: 13, duration: prefersReducedMotion() ? 0 : 0.8 });
  }, [area]);

  // 6. Fly to a marker when a card (or the URL) asks for it.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focusRequest || handledFocusRef.current === focusRequest.nonce) return;
    const entry = markersRef.current.get(focusRequest.id);
    if (!entry) return; // not loaded yet — re-runs when markers change
    handledFocusRef.current = focusRequest.nonce;

    const main = entry.markers[0];
    if (focusRequest.source === 'map' || focusRequest.source === 'popup') {
      // Several places: zoom out (never in) so all of them are in view.
      if (focusRequest.source === 'map' && entry.markers.length > 1) {
        const bounds = L.latLngBounds(eventPoints(entry.event));
        const pad = L.point(64, 64);
        if (!map.getBounds().pad(-0.05).contains(bounds)) {
          const z = Math.min(map.getZoom(), map.getBoundsZoom(bounds, false, pad));
          map.flyTo(bounds.getCenter(), z, { duration: prefersReducedMotion() ? 0 : 0.6 });
          // Zooming out moves the open window with its pin: bring it back into view after.
          map.once('moveend', () => {
            const p = entry.markers.find((m) => m.isPopupOpen())?.getPopup() as (L.Popup & { _adjustPan?: () => void }) | undefined;
            p?._adjustPan?.();
          });
        }
      }
      if (!compact && !main.isPopupOpen() && !entry.markers.some((m) => m.isPopupOpen())) main.openPopup();
      return;
    }

    // Phones switch from the feed to the map in the same tap: Leaflet still has the
    // hidden (0×0) size cached, and fitting bounds to it gives NaN. Re-measure first.
    map.invalidateSize({ pan: false });
    const size = map.getSize();
    const points = size.x > 0 && size.y > 0 ? eventPoints(entry.event) : eventPoints(entry.event).slice(0, 1);
    const zoom = Math.max(map.getZoom(), mapConfig.focusZoom);
    let opened = false;
    const open = () => {
      if (opened) return;
      opened = true;
      // Still inside a cluster at this zoom? Zoom in until the pin stands on its own.
      const group = markerLayerRef.current;
      if (group && group.hasLayer(main) && group.getVisibleParent(main) !== main) {
        group.zoomToShowLayer(main, () => {
          if (!compact) main.openPopup();
        });
      } else if (!compact) main.openPopup();
    };
    map.closePopup();
    // Phones: the card along the bottom covers part of the map, so keep the pins above it.
    const padBottom = compact ? 220 : 56;
    if (prefersReducedMotion()) {
      if (points.length > 1) map.fitBounds(L.latLngBounds(points), { paddingTopLeft: [56, 56], paddingBottomRight: [56, padBottom], maxZoom: zoom, animate: false });
      else map.setView(main.getLatLng(), zoom, { animate: false });
      open();
      return;
    }
    map.once('moveend', open);
    if (points.length > 1) {
      try {
        map.flyToBounds(L.latLngBounds(points), { paddingTopLeft: [56, 56], paddingBottomRight: [56, padBottom], maxZoom: zoom, duration: 0.9 });
      } catch {
        map.setView(main.getLatLng(), zoom, { animate: false }); // never let a map animation break the page
        open();
      }
    } else if (compact) {
      // Centre the pin in the part of the map above the card.
      const targetPoint = map.project(main.getLatLng(), zoom).add([0, padBottom / 2 - 28]);
      map.flyTo(map.unproject(targetPoint, zoom), zoom, { duration: 0.9 });
    } else {
      map.flyTo(main.getLatLng(), zoom, { duration: 0.9 });
    }
    const fallback = window.setTimeout(open, 1400);
    return () => {
      window.clearTimeout(fallback);
      map.off('moveend', open);
      // Interrupted before the popup opened (markers rebuilt, StrictMode remount):
      // let the next run retry this request instead of silently dropping it.
      if (!opened && handledFocusRef.current === focusRequest.nonce) handledFocusRef.current = null;
    };
  }, [focusRequest, markersVersion, compact]);

  const resetView = useCallback(() => {
    const map = mapRef.current;
    map?.closePopup();
    map?.flyTo(mapConfig.defaultView.center, mapConfig.defaultView.zoom, { duration: prefersReducedMotion() ? 0 : 0.8 });
  }, []);

  const regionView = useCallback(() => {
    const map = mapRef.current;
    map?.closePopup();
    map?.flyTo(mapConfig.regionView.center, mapConfig.regionView.zoom, { duration: prefersReducedMotion() ? 0 : 0.8 });
  }, []);

  const fitAll = useCallback(() => {
    const map = mapRef.current;
    if (!map || events.length === 0) return;
    const bounds = L.latLngBounds(events.flatMap(eventPoints));
    map.flyToBounds(bounds, { padding: [56, 56], maxZoom: 11, duration: prefersReducedMotion() ? 0 : 0.8 });
  }, [events]);

  return (
    // `isolate` contains Leaflet's internal z-indexes (panes 400–700, controls 1000)
    // so they can't cover the top bar, menus or the phone pane switcher.
    <div className="relative isolate h-full w-full">
      <div ref={containerRef} className="ofm-map h-full w-full" role="region" aria-label={t('map.label')} />
      <MapContextMenu map={leafletMap} target={ctxMenu} onClose={closeCtx} onArea={onAreaDrawn} onFilterCategory={onFilterCategory} />
      {alerts.length > 0 || topSlot ? (
        <div ref={topOverlayRef} className="pointer-events-none absolute inset-x-0 top-3 z-[500] flex flex-col items-center gap-2 px-16">
          {alerts.length > 0 ? (
            <button
              type="button"
              onClick={fitAlerts}
              className="ofm-hfc-banner pointer-events-auto inline-flex max-w-full items-center gap-2 rounded-full bg-red-600 px-3.5 py-1.5 text-sm font-bold text-white shadow-lg ring-2 ring-red-300/60 hover:bg-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              <Siren className="size-4 shrink-0" aria-hidden />
              <span className="truncate">{t('hfc.banner', { count: alerts.length })}</span>
            </button>
          ) : null}
          {topSlot}
        </div>
      ) : null}
      <div className="pointer-events-none absolute start-3 top-3 z-[500] flex flex-col gap-2">
        <IconButton label={t('map.resetView')} onClick={resetView} className="pointer-events-auto shadow-md" variant="map">
          <LocateFixed className="size-4" aria-hidden />
        </IconButton>
        <IconButton label={t('map.regionView')} onClick={regionView} className="pointer-events-auto shadow-md" variant="map">
          <Globe2 className="size-4" aria-hidden />
        </IconButton>
        <IconButton
          label={t('map.fitAll')}
          onClick={fitAll}
          disabled={events.length === 0}
          className="pointer-events-auto shadow-md"
          variant="map"
        >
          <Maximize2 className="size-4" aria-hidden />
        </IconButton>
        <IconButton
          label={t('map.styles')}
          onClick={() => {
            setIntelOpen(false);
            setStylesOpen((v) => !v);
          }}
          aria-expanded={stylesOpen}
          className="pointer-events-auto shadow-md"
          variant="map"
        >
          <MapIcon className="size-4" aria-hidden />
        </IconButton>
        <IconButton
          label={lang === 'he' ? 'שכבות מודיעין: לוויין, אוניות, מטוסים' : 'Intelligence layers: satellite, ships, aircraft'}
          onClick={() => {
            setStylesOpen(false);
            setIntelOpen((v) => !v);
          }}
          aria-expanded={intelOpen}
          className="pointer-events-auto shadow-md"
          variant="map"
        >
          <Layers className="size-4" aria-hidden />
        </IconButton>

      </div>
      {drawMode ? (
        <div className="pointer-events-none absolute inset-x-0 top-3 z-[700] flex justify-center px-3">
          <div className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-1.5 rounded-2xl bg-white/95 p-2 shadow-xl ring-1 ring-slate-900/10 backdrop-blur dark:bg-slate-900/95 dark:ring-white/10">
            <p className="w-full px-1 pb-1 text-center text-xs font-medium text-slate-700 dark:text-slate-200">
              {drawMode === 'octagon' ? t('draw.octagonHint') : t('draw.polygonHint')}
            </p>
            <div className="flex rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800" role="group">
              {(
                [
                  ['polygon', PenLine, t('draw.free')],
                  ['octagon', Octagon, t('draw.octagon')],
                ] as const
              ).map(([mode, Icon, label]) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={drawMode === mode}
                  onClick={() => onDrawModeChange?.(mode)}
                  className={
                    'inline-flex h-9 items-center gap-1 rounded-md px-2.5 text-xs font-semibold ' +
                    (drawMode === mode ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white' : 'text-slate-600 dark:text-slate-300')
                  }
                >
                  <Icon className="size-3.5" aria-hidden />
                  {label}
                </button>
              ))}
            </div>
            {drawMode === 'polygon' ? (
              <button
                type="button"
                onClick={() => setDraftBoth(draftRef.current.slice(0, -1))}
                disabled={draft.length === 0}
                className="inline-flex h-9 items-center gap-1 rounded-lg px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Undo2 className="size-3.5 rtl:-scale-x-100" aria-hidden />
                {t('draw.undo')}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => onDrawModeChange?.(null)}
              className="inline-flex h-9 items-center rounded-lg px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              {t('draw.cancel')}
            </button>
            {drawMode === 'polygon' ? (
              <button
                type="button"
                onClick={() => finishDrawing(draftRef.current)}
                disabled={draft.length < 3}
                className="inline-flex h-9 items-center gap-1 rounded-lg bg-sky-600 px-3 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-40"
              >
                <Check className="size-3.5" aria-hidden />
                {t('draw.apply')}
              </button>
            ) : null}
          </div>
        </div>
      ) : area && area.length >= 3 ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-8 z-[600] flex justify-center px-3">
          <div className="pointer-events-auto inline-flex items-center gap-1 rounded-full bg-sky-600 py-1 ps-3 pe-1 text-xs font-semibold text-white shadow-lg">
            <Octagon className="size-3.5" aria-hidden />
            {t('filters.areaActive')}
            <button
              type="button"
              onClick={() => onDrawModeChange?.('polygon')}
              className="ms-1 rounded-full px-2 py-1 hover:bg-white/15"
            >
              {t('filters.redrawArea')}
            </button>
            <button
              type="button"
              onClick={onClearArea}
              aria-label={t('filters.clearArea')}
              className="inline-flex size-7 items-center justify-center rounded-full hover:bg-white/15"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        </div>
      ) : null}
      <IntelLayers map={leafletMap} open={intelOpen} onClose={() => setIntelOpen(false)} firesOn={firesOn} onFires={toggleFires} onFiresDate={setFiresDate} />
      {stylesOpen ? (
        <div className="absolute start-14 top-3 z-[650] w-52 rounded-xl bg-white/95 p-1.5 shadow-xl ring-1 ring-slate-900/10 backdrop-blur dark:bg-slate-900/95 dark:ring-white/10" role="menu">
          {BASE_STYLES.map((id) => (
            <button
              key={id}
              type="button"
              role="menuitemradio"
              aria-checked={baseStyle === id}
              onClick={() => {
                setStyleFailed(null);
                setBaseStyle(id);
                saveBaseStyle(id);
                setStylesOpen(false);
              }}
              className={
                'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-start text-sm ' +
                (baseStyle === id ? 'bg-sky-50 font-semibold text-sky-800 dark:bg-sky-500/15 dark:text-sky-200' : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800')
              }
            >
              {baseStyle === id ? <Check className="size-4" aria-hidden /> : <span className="size-4" aria-hidden />}
              <span className="min-w-0 flex-1">
                {t(`map.style.${id}`)}
                {styleFailed === id ? <span className="block text-[11px] font-normal text-amber-700 dark:text-amber-400">{t('map.styleFailed')}</span> : null}
              </span>
            </button>
          ))}
          <label className="mt-1 flex cursor-pointer items-center gap-2 border-t border-slate-100 px-2.5 pt-2 pb-1.5 text-sm text-slate-700 dark:border-slate-800 dark:text-slate-200">
            <input
              type="checkbox"
              className="size-4 accent-orange-600"
              checked={firesOn}
              onChange={(e) => {
                setFiresOn(e.target.checked);
                saveFiresOn(e.target.checked);
              }}
            />
            {t('map.fires')}
          </label>
        </div>
      ) : null}
      {movingId ? (
        <div className="pointer-events-none absolute inset-x-0 top-3 z-[700] flex justify-center px-3">
          <div className="pointer-events-auto flex max-w-full items-center gap-2 rounded-2xl bg-white/95 px-3 py-2 text-xs font-medium text-slate-700 shadow-xl ring-1 ring-slate-900/10 backdrop-blur dark:bg-slate-900/95 dark:text-slate-200 dark:ring-white/10">
            <span>{t('move.hint')}</span>
            <button
              type="button"
              onClick={() => void saveMove('move')}
              disabled={moveBusy}
              className="inline-flex h-8 items-center gap-1 rounded-lg bg-emerald-600 px-2.5 font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              <Check className="size-3.5" aria-hidden />
              {t('move.save')}
            </button>
            <button
              type="button"
              onClick={() => void saveMove('copy')}
              disabled={moveBusy}
              className="inline-flex h-8 items-center gap-1 rounded-lg bg-sky-600 px-2.5 font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
            >
              ⧉ {t('move.copy')}
            </button>
            {canRemovePin ? (
              <button
                type="button"
                onClick={() => (confirmRemove ? void saveMove('remove') : setConfirmRemove(true))}
                disabled={moveBusy}
                className={
                  'inline-flex h-8 items-center gap-1 rounded-lg px-2.5 font-semibold disabled:opacity-50 ' +
                  (confirmRemove ? 'bg-red-600 text-white hover:bg-red-500' : 'text-red-700 ring-1 ring-red-300 hover:bg-red-50 dark:text-red-400 dark:ring-red-500/40 dark:hover:bg-red-500/10')
                }
                title={t('move.removeHint')}
              >
                🗑 {confirmRemove ? t('move.removeConfirm') : t('move.remove')}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => onMoveEnd?.()}
              className="inline-flex h-8 items-center rounded-lg px-2.5 font-semibold hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              {t('move.cancel')}
            </button>
          </div>
        </div>
      ) : null}
      {legend && !drawMode && !moving ? (
        <button
          type="button"
          onClick={() => setLegendOpen((v) => !v)}
          aria-expanded={legendOpen}
          className={
            'absolute bottom-6 start-3 z-[600] inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold shadow-lg ring-1 backdrop-blur ' +
            (legendOpen
              ? 'bg-sky-600 text-white ring-sky-700'
              : 'bg-white/95 text-slate-800 ring-slate-900/10 hover:bg-white dark:bg-slate-900/95 dark:text-white dark:ring-white/10')
          }
        >
          <BookOpen className="size-4" aria-hidden />
          {t('map.showLegend')}
        </button>
      ) : null}
      {legend && legendOpen ? (
        <div className="ofm-scroll absolute bottom-16 start-3 z-[600] max-h-[min(60vh,460px)] w-64 overflow-y-auto rounded-xl bg-white/95 p-3 shadow-xl ring-1 ring-slate-900/10 backdrop-blur dark:bg-slate-900/95 dark:ring-white/10">
          <button
            type="button"
            onClick={() => setLegendOpen(false)}
            aria-label={t('common.close')}
            className="absolute end-1.5 top-1.5 inline-flex size-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <X className="size-4" aria-hidden />
          </button>
          {legend}
        </div>
      ) : null}
    </div>
  );
}
