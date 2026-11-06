// Weather data for the map: the weekly member key, the point forecast (our /api/weather route), the GFS
// forecast-frame list and the timeline's frames. No Leaflet or Supabase imports here (see weatherLayers.ts),
// so this file runs in node tests as is.
import type { PointForecast } from '../../api/_lib/weatherNormalize';
import { GFS_MANIFEST_PATH } from './weatherSources.ts';

export type { Day, Hour, PointForecast } from '../../api/_lib/weatherNormalize';

type TokenSource = () => Promise<string | null>;
let token: TokenSource = async () => null;
/** Set once by weatherLayers.ts: how to get the signed-in user's session token. */
export function setWeatherAuth(fn: TokenSource) {
  token = fn;
  key = null;
}

let key: Promise<string> | null = null;
/** The weekly key for /api/weather (members only). Cached; `force` asks for a fresh one. */
export function weatherKey(force = false, fetcher: typeof fetch = fetch): Promise<string> {
  if (!key || force) {
    key = (async () => {
      const t = await token();
      const res = await fetcher('/api/weather?key=1', { headers: t ? { authorization: `Bearer ${t}` } : {} });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const out = await res.json();
      if (typeof out?.k !== 'string') throw new Error('no key');
      return out.k as string;
    })();
    key.catch(() => (key = null));
  }
  return key;
}

/** Weather at a point. A 403 means the weekly key rotated while the page was open: one fresh key, one retry. */
export async function fetchPoint(lat: number, lng: number, tz: string, fetcher: typeof fetch = fetch): Promise<PointForecast> {
  const c = (v: number) => String(Math.round(v * 1e4) / 1e4);
  const ask = async (k: string) => fetcher(`/api/weather?point=${c(lat)},${c(lng)}&tz=${encodeURIComponent(tz)}&k=${encodeURIComponent(k)}`);
  let res = await ask(await weatherKey(false, fetcher));
  if (res.status === 403) res = await ask(await weatherKey(true, fetcher));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export function owmTileUrl(layer: 'temp' | 'wind', k: string): string {
  return `/api/weather?tile=${layer}/{z}/{x}/{y}&k=${k}`;
}

export interface GfsManifest { run: string; bounds: [[number, number], [number, number]]; frames: { time: string; cloud: string; rain: string }[] }

/** The list of GFS forecast frames in the public bucket; null when there is none yet. */
export async function fetchGfsManifest(publicBase: string, fetcher: typeof fetch = fetch): Promise<GfsManifest | null> {
  try {
    const res = await fetcher(`${publicBase}${GFS_MANIFEST_PATH}?t=${Math.floor(Date.now() / 300_000)}`);
    if (!res.ok) return null;
    const m = await res.json();
    return Array.isArray(m?.frames) ? (m as GfsManifest) : null;
  } catch {
    return null;
  }
}

export interface Frame { time: string; offsetH: number; kind: 'observed' | 'forecast' }

/** Whole UTC hours from −past to +future around now: observed before now, forecast from now. */
export function buildFrames(now: Date, past = 6, future = 72): Frame[] {
  const base = Math.floor(now.getTime() / 3600_000) * 3600_000;
  const out: Frame[] = [];
  for (let h = -past; h <= future; h++) out.push({ time: new Date(base + h * 3600_000).toISOString(), offsetH: h, kind: h < 0 ? 'observed' : 'forecast' });
  return out;
}
