// Leaflet layers for the weather timeline + wiring of the member key to the Supabase session.
import L from 'leaflet';
import { supabase } from '@/integrations/supabase/client';
import { setWeatherAuth, type GfsManifest } from '@/lib/weather';
import { EUMET_LAYER_CLOUD, EUMET_LAYER_RAIN, EUMET_WMS_URL, GFS_BOUNDS, WEATHER_BUCKET } from '@/lib/weatherSources';

setWeatherAuth(async () => {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
});

export const WEATHER_PUBLIC_BASE = `${String(import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '')}/storage/v1/object/public/${WEATHER_BUCKET}/`;

/** Panes: observed IR clouds are an opaque grey picture, so their pane blends with "screen" (ground stays, clouds whiten). */
export function weatherPanes(map: L.Map): { clouds: string; rain: string } {
  const make = (name: string, z: number, css: Partial<CSSStyleDeclaration>) => {
    const pane = map.getPane(name) ?? map.createPane(name, map.getPane('rotatePane') ?? undefined);
    pane.style.zIndex = String(z);
    pane.style.pointerEvents = 'none';
    Object.assign(pane.style, css);
  };
  make('ofmWxClouds', 330, {});
  make('ofmWxRain', 340, {});
  return { clouds: 'ofmWxClouds', rain: 'ofmWxRain' };
}

/** A past hour from EUMETView: Meteosat IR clouds or observed rain (h60b, transparent where dry). */
export function pastLayer(kind: 'cloud' | 'rain', time: string, opacity: number, pane: string): L.TileLayer.WMS {
  const layer = L.tileLayer.wms(EUMET_WMS_URL, {
    layers: kind === 'cloud' ? EUMET_LAYER_CLOUD : EUMET_LAYER_RAIN,
    format: 'image/png', transparent: true, version: '1.3.0', opacity, pane,
    attribution: 'Satellite: EUMETSAT', crossOrigin: true,
    // Leaflet passes unknown options on as WMS parameters.
    ...({ time } as object),
  } as L.WMSOptions);
  if (kind === 'cloud') layer.on('add', () => {
    const el = layer.getContainer();
    if (el) { el.style.mixBlendMode = 'screen'; el.style.filter = 'contrast(1.8) brightness(0.85)'; }
  });
  return layer;
}

/** A forecast hour: one GFS frame picture over the Middle East box. */
export function forecastLayer(kind: 'cloud' | 'rain', frame: GfsManifest['frames'][number], opacity: number, pane: string): L.ImageOverlay {
  return L.imageOverlay(WEATHER_PUBLIC_BASE + (kind === 'cloud' ? frame.cloud : frame.rain), GFS_BOUNDS, {
    opacity, pane, interactive: false, attribution: 'Forecast: NOAA GFS', crossOrigin: true,
  });
}
