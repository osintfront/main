import { useCallback, useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { Globe2, LocateFixed, Maximize2 } from 'lucide-react';
import { mapConfig } from '@/config/map';
import { useTheme } from '@/context/ThemeContext';
import { useI18n } from '@/i18n';
import type { FocusRequest } from '@/hooks/useMapSelection';
import type { PublicEvent } from '@/types/event';
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
}

interface MarkerEntry {
  marker: L.Marker;
  event: PublicEvent;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

export function MapView({ events, selectedId, focusRequest, onMarkerSelect, onViewEvent }: MapViewProps) {
  const { theme } = useTheme();
  const { t, dir, locale, categoryLabel } = useI18n();

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerLayerRef = useRef<L.LayerGroup | null>(null);
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
