/**
 * Map configuration — the ONLY place that knows which tile provider is used.
 *
 * Swapping to Google Maps later:
 *   1. npm i leaflet.gridlayer.googlemutant
 *   2. Load the Google Maps JS API (key restricted by HTTP referrer).
 *   3. Implement the `google` branch in src/components/map/baseLayer.ts
 *      (L.gridLayer.googleMutant({ type: 'roadmap', styles: [...] })).
 *   4. Set VITE_MAP_TILE_PROVIDER=google.
 * No component outside src/components/map needs to change.
 *
 * Licensing note: CARTO and OpenStreetMap free tiles have usage policies that
 * restrict heavy or commercial traffic. Because this site carries advertising,
 * move to a paid plan (CARTO, MapTiler, Stadia, Mapbox or Google) before launch.
 */

export type TileProviderId = 'carto' | 'osm' | 'google';
export type MapTheme = 'light' | 'dark';

export interface TileLayerSpec {
  url: string;
  attribution: string;
  maxZoom: number;
  subdomains?: string;
  /** CSS class applied to the tile pane — used for desaturation filters. */
  className?: string;
}

export const TILE_PROVIDERS: Record<Exclude<TileProviderId, 'google'>, Record<MapTheme, TileLayerSpec>> = {
  carto: {
    light: {
      url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 19,
      className: 'ofm-tiles-muted',
    },
    dark: {
      url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 19,
      className: 'ofm-tiles-dark',
    },
  },
  osm: {
    light: {
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
      className: 'ofm-tiles-muted',
    },
    dark: {
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
      className: 'ofm-tiles-inverted',
    },
  },
};

function readProvider(): TileProviderId {
  // Default: OpenStreetMap — no API key needed. CARTO basemaps now require a key.
  const raw = (import.meta.env.VITE_MAP_TILE_PROVIDER ?? 'osm').toString().trim().toLowerCase();
  return raw === 'osm' || raw === 'google' || raw === 'carto' ? raw : 'osm';
}

export const mapConfig = {
  provider: readProvider(),
  /** Israel-centred default view; the Middle East preset is one click away. */
  defaultView: { center: [31.45, 35.0] as [number, number], zoom: 7 },
  regionView: { center: [31.0, 40.0] as [number, number], zoom: 5 },
  minZoom: 3,
  maxZoom: 18,
  focusZoom: 11,
};
