import L from 'leaflet';
import { TILE_PROVIDERS, mapConfig, type MapTheme, type TileLayerSpec, type TileProviderId } from '@/config/map';
import { VectorBaseLayer } from './vectorBase';

/**
 * Map styles a visitor can pick: the standard map, OpenStreetMap-based layers, Esri satellite
 * imagery (plain or with place names), CARTO light/dark, and the OpenFreeMap vector map.
 */
export const BASE_STYLES = ['standard', 'topo', 'cyclosm', 'satellite', 'hybrid', 'light', 'dark', 'vector'] as const;
export type BaseStyle = (typeof BASE_STYLES)[number];

const OSM = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const CARTO = `${OSM} &copy; <a href="https://carto.com/attributions">CARTO</a>`;
const ESRI_IMAGERY = 'Imagery &copy; Esri, Maxar, Earthstar Geographics';

type RasterStyle = Exclude<BaseStyle, 'standard' | 'hybrid' | 'vector'>;

/** Extra styles (same in light and dark: they are detailed maps, inverting them hurts). */
const STYLE_SPECS: Record<RasterStyle, TileLayerSpec> = {
  cyclosm: {
    url: 'https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',
    attribution: `${OSM} · <a href="https://www.cyclosm.org">CyclOSM</a>`,
    subdomains: 'abc',
    maxZoom: 20,
  },
  topo: {
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: `${OSM} · SRTM · <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)`,
    subdomains: 'abc',
    maxZoom: 17,
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: ESRI_IMAGERY,
    maxZoom: 19,
  },
  light: {
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attribution: CARTO,
    subdomains: 'abcd',
    maxZoom: 19,
  },
  dark: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: CARTO,
    subdomains: 'abcd',
    maxZoom: 19,
  },
};

/** Place names, roads and borders drawn over the satellite picture (transparent tiles). */
const ESRI_LABELS: TileLayerSpec = {
  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
  attribution: 'Labels &copy; Esri',
  maxZoom: 19,
};

const STORAGE_KEY = 'ofm.mapStyle';
/** What a visitor sees before choosing: the topographic map. */
export const DEFAULT_STYLE: BaseStyle = 'topo';

export function loadBaseStyle(): BaseStyle {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return (BASE_STYLES as readonly string[]).includes(v ?? '') ? (v as BaseStyle) : DEFAULT_STYLE;
  } catch {
    return DEFAULT_STYLE;
  }
}

export function saveBaseStyle(style: BaseStyle): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, style);
  } catch {
    /* storage blocked: the choice lasts for this page */
  }
}

function tileLayer(spec: TileLayerSpec, cors = true): L.Layer {
  return L.tileLayer(spec.url, {
    attribution: spec.attribution,
    // Zoom past the style's last level by scaling its tiles instead of showing nothing.
    maxZoom: Math.max(spec.maxZoom, mapConfig.maxZoom),
    maxNativeZoom: spec.maxZoom,
    subdomains: spec.subdomains ?? 'abc',
    className: spec.className,
    // No detectRetina: CARTO's {r} placeholder already serves @2x tiles on high-DPI
    // screens. Using both shrinks map labels to half size on retina displays.
    // Only for servers that send CORS headers; others (CyclOSM) then load nothing at all.
    ...(cors ? { crossOrigin: true } : {}),
  });
}

/**
 * Builds the base tile layer for the configured provider (or a chosen style). This is the
 * single integration point for swapping map vendors (see src/config/map.ts).
 */
export function createBaseLayer(
  theme: MapTheme,
  provider: TileProviderId = mapConfig.provider,
  style: BaseStyle = 'standard',
  lang = 'en',
): L.Layer {
  if (style === 'vector') return new VectorBaseLayer(lang);
  if (style === 'hybrid') {
    // A feature group passes its tiles' load/error events up, so the fallback check still works.
    return L.featureGroup([tileLayer(STYLE_SPECS.satellite, false), tileLayer(ESRI_LABELS, false)]);
  }
  if (style !== 'standard') return tileLayer(STYLE_SPECS[style], false);
  if (provider === 'google') {
    // Google Maps requires leaflet.gridlayer.googlemutant + the Maps JS API.
    // Until that is wired in, fall back to OpenStreetMap so the map never renders blank.
    console.warn('[map] Google tiles are not wired up yet — falling back to OpenStreetMap. See src/config/map.ts.');
    return createBaseLayer(theme, 'osm');
  }
  return tileLayer(TILE_PROVIDERS[provider][theme]);
}

/**
 * NASA FIRMS active fires (VIIRS thermal anomalies) from NASA GIBS — free, no key.
 * Two days (yesterday + today, UTC) so the night's and the day's passes both show.
 */
export function createFiresLayer(date: string | null = null): L.Layer {
  // A chosen day (the satellite picture's): that day and the one before; else the last two days.
  const base = date ? Date.parse(`${date}T12:00:00Z`) : Date.now();
  const day = (offset: number) => new Date(base - offset * 86400_000).toISOString().slice(0, 10);
  const wms = (time: string) =>
    L.tileLayer.wms('https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi', {
      layers: 'VIIRS_NOAA20_Thermal_Anomalies_375m_All,VIIRS_SNPP_Thermal_Anomalies_375m_All',
      format: 'image/png',
      transparent: true,
      version: '1.1.1',
      attribution: 'Fires: <a href="https://firms.modaps.eosdis.nasa.gov/">NASA FIRMS</a> / GIBS',
      time, // extra WMS parameter (the day)
      zIndex: 350,
    } as L.WMSOptions);
  return L.layerGroup([wms(day(1)), wms(day(0))]);
}

const FIRES_KEY = 'ofm.mapFires';
export function loadFiresOn(): boolean {
  try {
    return window.localStorage.getItem(FIRES_KEY) === 'on';
  } catch {
    return false;
  }
}
export function saveFiresOn(on: boolean): void {
  try {
    window.localStorage.setItem(FIRES_KEY, on ? 'on' : 'off');
  } catch {
    /* storage blocked */
  }
}
