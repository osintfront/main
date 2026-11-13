import L from 'leaflet';
// MapLibre draws Hebrew/Arabic letters left-to-right (reversed) without this add-on. The package
// only exports its source entry, so the built file is taken by path; Vite copies it to /assets.
import rtlPluginUrl from '../../../node_modules/@mapbox/mapbox-gl-rtl-text/dist/mapbox-gl-rtl-text.js?url';

/**
 * OpenFreeMap vector maps (Liberty, Positron light, Dark), drawn in the browser by MapLibre GL.
 *
 * MapLibre is large (~250 KB gzipped), so it is downloaded only when a visitor picks this style:
 * this layer is a light placeholder that imports it on first add.
 *
 * Rotation: leaflet-rotate turns the map with CSS, but the MapLibre canvas is drawn for a
 * north-up view, so a rotated map would put roads under the wrong pins. While this layer is on,
 * the map stays north-up (any rotation request is turned into bearing 0) and the previous
 * behaviour is restored when the visitor picks another style.
 *
 * Fires `basefail` if MapLibre or the style cannot load, so the caller can fall back.
 */
export const OPENFREEMAP_STYLES = {
  liberty: 'https://tiles.openfreemap.org/styles/liberty',
  positron: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
} as const;
export type OpenFreeMapStyle = keyof typeof OPENFREEMAP_STYLES;
export const OPENFREEMAP_ATTRIBUTION =
  '<a href="https://openfreemap.org">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

type Rotatable = L.Map & { setBearing?: (b: number) => void; getBearing?: () => number };

/** MapLibre expression for a label in the site's language, falling back to Latin, then local. */
export function labelExpression(lang: string): unknown[] {
  return ['coalesce', ['get', `name:${lang}`], ['get', 'name:latin'], ['get', 'name']];
}

/** Once per page: MapLibre refuses a second registration. Loaded only when RTL text appears. */
let rtlRequested = false;
function ensureRtlPlugin(maplibre: { setRTLTextPlugin: (url: string, lazy: boolean) => Promise<void> }) {
  if (rtlRequested) return;
  rtlRequested = true;
  maplibre.setRTLTextPlugin(new URL(rtlPluginUrl, window.location.href).href, true).catch((err) => {
    console.warn('[map] right-to-left label support could not load', err);
  });
}

export class VectorBaseLayer extends L.Layer {
  private inner: L.Layer | null = null;
  private removed = false;
  private locked = false;
  private prevOwn: ((b: number) => void) | undefined;

  constructor(
    private readonly lang: string,
    private readonly styleName: OpenFreeMapStyle = 'liberty',
  ) {
    super({ attribution: OPENFREEMAP_ATTRIBUTION } as L.LayerOptions);
  }

  onAdd(map: L.Map): this {
    this.removed = false;
    this.lockNorthUp(map);
    void this.load(map);
    return this;
  }

  onRemove(map: L.Map): this {
    this.removed = true;
    if (this.inner) map.removeLayer(this.inner);
    this.inner = null;
    this.unlockRotation(map);
    return this;
  }

  private lockNorthUp(map: L.Map) {
    const m = map as Rotatable;
    if (this.locked || typeof m.setBearing !== 'function') return;
    // Keep whatever setBearing is installed now (ours wraps leaflet-rotate's) to restore later.
    this.prevOwn = Object.prototype.hasOwnProperty.call(m, 'setBearing') ? m.setBearing : undefined;
    const raw = m.setBearing.bind(m);
    raw(0);
    m.setBearing = () => raw(0);
    this.locked = true;
  }

  private unlockRotation(map: L.Map) {
    if (!this.locked) return;
    const m = map as Rotatable;
    if (this.prevOwn) m.setBearing = this.prevOwn;
    else delete (m as { setBearing?: unknown }).setBearing;
    this.prevOwn = undefined;
    this.locked = false;
  }

  private async load(map: L.Map) {
    try {
      const [{ maplibreGL }, maplibre] = await Promise.all([
        import('@maplibre/maplibre-gl-leaflet'),
        import('maplibre-gl'),
        import('maplibre-gl/dist/maplibre-gl.css'),
      ]);
      ensureRtlPlugin(maplibre);
      if (this.removed) return;
      const layer = maplibreGL({ style: OPENFREEMAP_STYLES[this.styleName], attributionControl: false });
      layer.addTo(map);
      this.inner = layer;
      const gl = layer.getMaplibreMap();
      let ready = false;
      gl.on('load', () => {
        ready = true;
        this.localiseLabels(gl);
        this.fire('tileload');
      });
      gl.on('error', () => {
        if (!ready) this.fire('basefail');
      });
    } catch (err) {
      console.warn('[map] vector map could not load', err);
      if (!this.removed) this.fire('basefail');
    }
  }

  /** Show place names in the site's language where OpenStreetMap has them. */
  private localiseLabels(gl: { getStyle: () => { layers?: Array<{ id: string; type: string; layout?: Record<string, unknown> }> }; setLayoutProperty: (id: string, k: string, v: unknown) => void }) {
    const layers = gl.getStyle().layers ?? [];
    for (const l of layers) {
      if (l.type !== 'symbol' || !l.layout || !('text-field' in l.layout)) continue;
      // Leave road shields / house numbers (refs, numbers) as they are.
      const field = JSON.stringify(l.layout['text-field']);
      if (!field.includes('name')) continue;
      try {
        gl.setLayoutProperty(l.id, 'text-field', labelExpression(this.lang));
      } catch {
        /* a layer with an unusual label: keep the style's own */
      }
    }
  }
}
