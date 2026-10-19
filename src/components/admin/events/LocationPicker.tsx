import { useEffect, useRef, useState, type FormEvent } from 'react';
import L from 'leaflet';
import { Loader2, MapPin, Search } from 'lucide-react';
import { mapConfig } from '@/config/map';
import { useTheme } from '@/context/ThemeContext';
import { useI18n } from '@/i18n';
import { geocoder, GeocodingError, type GeocodeResult } from '@/services/geocodingService';
import { createBaseLayer } from '@/components/map/baseLayer';
import { createMarkerIcon } from '@/components/map/markerIcon';
import { Alert } from '@/components/common/Feedback';

interface LocationPickerProps {
  latitude: number | null;
  longitude: number | null;
  iconName: string;
  color: string;
  /** User placed or dragged the pin. */
  onPick: (lat: number, lng: number) => void;
  /** A search result was chosen: coordinates + place fields. */
  onSelectResult: (result: GeocodeResult) => void;
  /** Reverse-geocoded place for a pin the user placed (fills empty fields). */
  onReverse: (result: GeocodeResult) => void;
  error?: string | null;
}

/**
 * Map preview for the event form: search a place, click the map, or drag
 * the pin. All geocoding goes through the geocoding service module.
 */
export function LocationPicker({ latitude, longitude, iconName, color, onPick, onSelectResult, onReverse, error }: LocationPickerProps) {
  const { t, lang } = useI18n();
  const { theme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const baseRef = useRef<L.Layer | null>(null);
  const cb = useRef({ onPick, onReverse });
  cb.current = { onPick, onReverse };
  const langRef = useRef(lang);
  langRef.current = lang;

  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<GeocodeResult[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  const reverse = (lat: number, lng: number) => {
    geocoder
      .reverse(lat, lng, { language: langRef.current })
      .then((r) => r && cb.current.onReverse(r))
      .catch(() => {
        /* reverse lookup is a convenience; the coordinates are already set */
      });
  };

  // Create map once.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const hasPoint = latitude !== null && longitude !== null;
    const map = L.map(el, {
      center: hasPoint ? [latitude!, longitude!] : mapConfig.defaultView.center,
      zoom: hasPoint ? 12 : mapConfig.defaultView.zoom,
      minZoom: mapConfig.minZoom,
      maxZoom: mapConfig.maxZoom,
      worldCopyJump: true,
    });
    map.on('click', (e: L.LeafletMouseEvent) => {
      cb.current.onPick(e.latlng.lat, e.latlng.lng);
      reverse(e.latlng.lat, e.latlng.lng);
    });
    mapRef.current = map;
    const observer = new ResizeObserver(() => map.invalidateSize({ pan: false }));
    observer.observe(el);
    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      baseRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (baseRef.current) map.removeLayer(baseRef.current);
    baseRef.current = createBaseLayer(theme).addTo(map);
  }, [theme]);

  // Keep the marker in sync with the form's coordinates.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (latitude === null || longitude === null) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    const icon = createMarkerIcon({ iconName, color, severity: 'medium', selected: true, breaking: false });
    if (!markerRef.current) {
      const marker = L.marker([latitude, longitude], { icon, draggable: true, keyboard: true, title: t('form.pinTitle') });
      marker.on('dragend', () => {
        const p = marker.getLatLng();
        cb.current.onPick(p.lat, p.lng);
        reverse(p.lat, p.lng);
      });
      marker.addTo(map);
      markerRef.current = marker;
      if (!map.getBounds().contains([latitude, longitude])) map.setView([latitude, longitude], Math.max(map.getZoom(), 11));
    } else {
      markerRef.current.setIcon(icon);
      const current = markerRef.current.getLatLng();
      if (Math.abs(current.lat - latitude) > 1e-7 || Math.abs(current.lng - longitude) > 1e-7) {
        markerRef.current.setLatLng([latitude, longitude]);
        if (!map.getBounds().contains([latitude, longitude])) map.panTo([latitude, longitude]);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latitude, longitude, iconName, color]);

  const onSearch = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!query.trim() || searching) return;
    setSearching(true);
    setSearchError(null);
    try {
      const found = await geocoder.search(query, { language: lang });
      setResults(found);
    } catch (err) {
      setResults(null);
      setSearchError(err instanceof GeocodingError ? err.message : t('form.searchFailed'));
    } finally {
      setSearching(false);
    }
  };

  const choose = (r: GeocodeResult) => {
    onSelectResult(r);
    setResults(null);
    mapRef.current?.setView([r.latitude, r.longitude], 13);
  };

  return (
    <div className="flex flex-col gap-2">
      {/* A div, not a <form>: this lives inside the event form. */}
      <div className="flex gap-2" role="search">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void onSearch();
              }
            }}
            placeholder={t('form.searchPlace')}
            aria-label={t('form.searchPlace')}
            maxLength={200}
            className="h-10 w-full rounded-lg border border-slate-300 bg-white ps-9 pe-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
          />
        </div>
        <button
          type="button"
          onClick={() => void onSearch()}
          disabled={searching || !query.trim()}
          className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
        >
          {searching ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Search className="size-4" aria-hidden />}
          {t('form.search')}
        </button>
      </div>

      {searchError ? <Alert tone="error">{searchError}</Alert> : null}
      {results && results.length === 0 ? <Alert tone="warning">{t('form.locationNotFound')}</Alert> : null}
      {results && results.length > 0 ? (
        <ul className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900" aria-label={t('form.searchResults')}>
          {results.map((r, i) => (
            <li key={`${r.latitude},${r.longitude},${i}`}>
              <button
                type="button"
                onClick={() => choose(r)}
                className="flex w-full items-start gap-2 border-b border-slate-100 px-3 py-2 text-start text-sm last:border-0 hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none dark:border-slate-800 dark:hover:bg-slate-800 dark:focus-visible:bg-slate-800"
              >
                <MapPin className="mt-0.5 size-4 shrink-0 text-slate-400" aria-hidden />
                <span className="min-w-0">
                  <span className="block font-medium text-slate-900 dark:text-white" dir="auto">
                    {r.locationName}
                  </span>
                  <span className="block truncate text-xs text-slate-500 dark:text-slate-400" dir="auto">
                    {r.label}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="relative isolate overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
        <div ref={containerRef} className="ofm-map h-72 w-full sm:h-80" role="region" aria-label={t('form.mapLabel')} />
      </div>
      <p className={error ? 'text-xs font-medium text-red-600 dark:text-red-400' : 'text-xs text-slate-500 dark:text-slate-400'}>
        {error ?? (latitude === null ? t('form.mapHintEmpty') : t('form.mapHintSet'))}
      </p>
    </div>
  );
}
