import L from 'leaflet';
import { TILE_PROVIDERS, mapConfig, type MapTheme, type TileLayerSpec, type TileProviderId } from '@/config/map';

/** Map styles a visitor can pick: the standard map plus OpenStreetMap-based layers. */
export const BASE_STYLES = ['standard', 'cyclosm', 'transport', 'topo'] as const;
export type BaseStyle = (typeof BASE_STYLES)[number];

const OSM = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** Extra styles (same in light and dark: they are detailed maps, inverting them hurts). */
const STYLE_SPECS: Record<Exclude<BaseStyle, 'standard'>, TileLayerSpec> = {
  cyclosm: {
    url: 'https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',
    attribution: `${OSM} · <a href="https://www.cyclosm.org">CyclOSM</a>`,
    subdomains: 'abc',
    maxZoom: 20,
  },
  transport: {
    // ÖPNVKarte (public transport). Thunderforest's transport map needs an API key.
    url: 'https://tileserver.memomaps.de/tilegen/{z}/{x}/{y}.png',
    attribution: `${OSM} · <a href="https://memomaps.de/">memomaps.de</a> CC-BY-SA`,
    maxZoom: 18,
  },
  topo: {
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: `${OSM} · SRTM · <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)`,
    subdomains: 'abc',
    maxZoom: 17,
  },
};

const STORAGE_KEY = 'ofm.mapStyle';

export function loadBaseStyle(): BaseStyle {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return (BASE_STYLES as readonly string[]).includes(v ?? '') ? (v as BaseStyle) : 'standard';
  } catch {
    return 'standard';
  }
}

export function saveBaseStyle(style: BaseStyle): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, style);
  } catch {
    /* storage blocked: the choice lasts for this page */
  }
}

function tileLayer(spec: TileLayerSpec): L.Layer {
  return L.tileLayer(spec.url, {
    attribution: spec.attribution,
    // Zoom past the style's last level by scaling its tiles instead of showing nothing.
    maxZoom: Math.max(spec.maxZoom, mapConfig.maxZoom),
    maxNativeZoom: spec.maxZoom,
    subdomains: spec.subdomains ?? 'abc',
    className: spec.className,
    // No detectRetina: CARTO's {r} placeholder already serves @2x tiles on high-DPI
    // screens. Using both shrinks map labels to half size on retina displays.
    crossOrigin: true,
  });
}

/**
 * Builds the base tile layer for the configured provider (or a chosen style). This is the
 * single integration point for swapping map vendors (see src/config/map.ts).
 */
export function createBaseLayer(theme: MapTheme, provider: TileProviderId = mapConfig.provider, style: BaseStyle = 'standard'): L.Layer {
  if (style !== 'standard') return tileLayer(STYLE_SPECS[style]);
  if (provider === 'google') {
    // Google Maps requires leaflet.gridlayer.googlemutant + the Maps JS API.
    // Until that is wired in, fall back to OpenStreetMap so the map never renders blank.
    console.warn('[map] Google tiles are not wired up yet — falling back to OpenStreetMap. See src/config/map.ts.');
    return createBaseLayer(theme, 'osm');
  }
  return tileLayer(TILE_PROVIDERS[provider][theme]);
}
