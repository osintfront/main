import L from 'leaflet';
import { TILE_PROVIDERS, mapConfig, type MapTheme, type TileProviderId } from '@/config/map';

/**
 * Builds the base tile layer for the configured provider. This is the single
 * integration point for swapping map vendors (see src/config/map.ts).
 */
export function createBaseLayer(theme: MapTheme, provider: TileProviderId = mapConfig.provider): L.Layer {
  if (provider === 'google') {
    // Google Maps requires leaflet.gridlayer.googlemutant + the Maps JS API.
    // Until that is wired in, fall back to CARTO so the map never renders blank.
    console.warn('[map] Google tiles are not wired up yet — falling back to CARTO. See src/config/map.ts.');
    return createBaseLayer(theme, 'carto');
  }

  const spec = TILE_PROVIDERS[provider][theme];
  return L.tileLayer(spec.url, {
    attribution: spec.attribution,
    maxZoom: spec.maxZoom,
    subdomains: spec.subdomains ?? 'abc',
    className: spec.className,
    // No detectRetina: CARTO's {r} placeholder already serves @2x tiles on high-DPI
    // screens. Using both shrinks map labels to half size on retina displays.
    crossOrigin: true,
  });
}
