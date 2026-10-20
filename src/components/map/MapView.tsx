import { useCallback, useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { Globe2, LocateFixed, Maximize2, Siren } from 'lucide-react';
import { mapConfig } from '@/config/map';
import { useTheme } from '@/context/ThemeContext';
import { useI18n } from '@/i18n';
import type { FocusRequest } from '@/hooks/useMapSelection';
import type { PublicEvent } from '@/types/event';
import type { HfcAlert } from '@/types/hfcAlert';
import { alertNames, HFC_CATEGORY, threatInfo, zoneHeadline } from '@/config/hfcThreats';
import { formatEventTime } from '@/utils/time';
import { buildHfcPopup } from './hfcPopup';
import { createBaseLayer } from './baseLayer';
import { createMarkerIcon } from './markerIcon';
import { buildPopupContent } from './popupContent';
import { IconButton } from '@/components/common/IconButton';

interface MapViewProps {
  events: PublicEvent[];
  selectedId: string | null;
  focusRequest: FocusRequest | null;
  onMarkerSelect: (id: string) => void;
  onViewEvent: (id: string) => void;
  /** Active Home Front Command alerts, drawn as polygons under the event pins. */
  alerts?: HfcAlert[];
  alertFocus?: { id: string; nonce: number } | null;
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
  marker: L.Marker;
  event: PublicEvent;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

export function MapView({ events, selectedId, focusRequest, onMarkerSelect, onViewEvent, alerts = NO_ALERTS, alertFocus = null }: MapViewProps) {
  const { theme } = useTheme();
  const { t, dir, locale, lang, categoryLabel } = useI18n();

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerLayerRef = useRef<L.LayerGroup | null>(null);
  const alertLayerRef = useRef<L.LayerGroup | null>(null);
  const alertEntriesRef = useRef(new Map<string, AlertEntry>());
  const [alertsVersion, setAlertsVersion] = useState(0);
  const handledAlertFocusRef = useRef<number | null>(null);
  const baseLayerRef = useRef<L.Layer | null>(null);
  const zoomControlRef = useRef<L.Control.Zoom | null>(null);
  const markersRef = useRef(new Map<string, MarkerEntry>());
  const handledFocusRef = useRef<number | null>(null);
  const [markersVersion, setMarkersVersion] = useState(0);

  // Latest callbacks/selection without re-binding every marker.
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const onMarkerSelectRef = useRef(onMarkerSelect);
  onMarkerSelectRef.current = onMarkerSelect;
  const onViewEventRef = useRef(onViewEvent);
  onViewEventRef.current = onViewEvent;

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
    });
    alertLayerRef.current = L.layerGroup().addTo(map);
    markerLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    // Keeps tiles correct when the column is resized or shown on mobile.
    const observer = new ResizeObserver(() => map.invalidateSize({ pan: false }));
    observer.observe(container);

    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      markerLayerRef.current = null;
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
    const layer = createBaseLayer(theme);
    layer.addTo(map);
    baseLayerRef.current = layer;
  }, [theme]);

  // 3. Zoom control sits on the side away from the feed and follows the language.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    zoomControlRef.current?.remove();
    zoomControlRef.current = L.control
      .zoom({
        position: dir === 'rtl' ? 'topleft' : 'topright',
        zoomInTitle: t('map.zoomIn'),
        zoomOutTitle: t('map.zoomOut'),
      })
      .addTo(map);
  }, [dir, t]);

  // 4. One marker per event with valid coordinates.
  useEffect(() => {
    const layer = markerLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    markersRef.current.clear();

    for (const event of events) {
      const selected = event.id === selectedRef.current;
      const marker = L.marker([event.latitude, event.longitude], {
        icon: createMarkerIcon({
          iconName: event.category.icon,
          color: event.category.markerColor,
          severity: event.severity,
          selected,
          breaking: event.isBreaking,
        }),
        title: event.title,
        alt: event.title,
        keyboard: true,
        riseOnHover: true,
        zIndexOffset: selected ? 1000 : event.severity === 'critical' ? 400 : 0,
      });
      marker.bindPopup(
        () =>
          buildPopupContent(
            event,
            {
              categoryLabel: categoryLabel(event.category.slug, event.category.name),
              severityLabel: t(`severity.${event.severity}`),
              verified: t('feed.verified'),
              breaking: t('feed.breaking'),
              viewEvent: t('map.viewEvent'),
              openSource: t('map.openSource'),
              approximate: t('feed.approximate'),
              locale,
              dir,
            },
            (id) => onViewEventRef.current(id),
          ),
        { maxWidth: 320, minWidth: 240, autoPanPadding: [28, 28], className: 'ofm-popup-shell' },
      );
      marker.on('click', () => onMarkerSelectRef.current(event.id));
      marker.addTo(layer);
      markersRef.current.set(event.id, { marker, event });
    }
    setMarkersVersion((v) => v + 1);
  }, [events, t, dir, locale, categoryLabel]);

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
        shape.bindTooltip(`${threatLabel} · ${zoneHeadline(zones, areas, 2)}`, { sticky: true, direction: 'top', className: 'ofm-hfc-tooltip' });
        shape.bindPopup(popup, popupOptions);
        shape.addTo(layer);
        bounds = shape.getBounds();
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
    setAlertsVersion((v) => v + 1);
  }, [alerts, t, dir, locale, lang, categoryLabel]);

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

  // 5. Highlight the selected marker.
  useEffect(() => {
    markersRef.current.forEach(({ marker, event }, id) => {
      const selected = id === selectedId;
      marker.setIcon(
        createMarkerIcon({
          iconName: event.category.icon,
          color: event.category.markerColor,
          severity: event.severity,
          selected,
          breaking: event.isBreaking,
        }),
      );
      marker.setZIndexOffset(selected ? 1000 : event.severity === 'critical' ? 400 : 0);
    });
  }, [selectedId, markersVersion]);

  // 6. Fly to a marker when a card (or the URL) asks for it.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focusRequest || handledFocusRef.current === focusRequest.nonce) return;
    const entry = markersRef.current.get(focusRequest.id);
    if (!entry) return; // not loaded yet — re-runs when markers change
    handledFocusRef.current = focusRequest.nonce;

    if (focusRequest.source === 'map' || focusRequest.source === 'popup') {
      if (!entry.marker.isPopupOpen()) entry.marker.openPopup();
      return;
    }

    const target = entry.marker.getLatLng();
    const zoom = Math.max(map.getZoom(), mapConfig.focusZoom);
    let opened = false;
    const open = () => {
      if (opened) return;
      opened = true;
      entry.marker.openPopup();
    };
    map.closePopup();
    if (prefersReducedMotion()) {
      map.setView(target, zoom, { animate: false });
      open();
      return;
    }
    map.once('moveend', open);
    map.flyTo(target, zoom, { duration: 0.9 });
    const fallback = window.setTimeout(open, 1400);
    return () => {
      window.clearTimeout(fallback);
      map.off('moveend', open);
      // Interrupted before the popup opened (markers rebuilt, StrictMode remount):
      // let the next run retry this request instead of silently dropping it.
      if (!opened && handledFocusRef.current === focusRequest.nonce) handledFocusRef.current = null;
    };
  }, [focusRequest, markersVersion]);

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
    const bounds = L.latLngBounds(events.map((e) => [e.latitude, e.longitude] as [number, number]));
    map.flyToBounds(bounds, { padding: [56, 56], maxZoom: 11, duration: prefersReducedMotion() ? 0 : 0.8 });
  }, [events]);

  return (
    // `isolate` contains Leaflet's internal z-indexes (panes 400–700, controls 1000)
    // so they can't cover the top bar, menus or the phone pane switcher.
    <div className="relative isolate h-full w-full">
      <div ref={containerRef} className="ofm-map h-full w-full" role="region" aria-label={t('map.label')} />
      {alerts.length > 0 ? (
        <div className="pointer-events-none absolute inset-x-0 top-3 z-[500] flex justify-center px-16">
          <button
            type="button"
            onClick={fitAlerts}
            className="ofm-hfc-banner pointer-events-auto inline-flex max-w-full items-center gap-2 rounded-full bg-red-600 px-3.5 py-1.5 text-sm font-bold text-white shadow-lg ring-2 ring-red-300/60 hover:bg-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            <Siren className="size-4 shrink-0" aria-hidden />
            <span className="truncate">{t('hfc.banner', { count: alerts.length })}</span>
          </button>
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
      </div>
    </div>
  );
}
