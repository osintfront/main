/// <reference types="node" />
// GET /api/weather?key=1                          — members: the weekly key the other routes need
// GET /api/weather?point=lat,lng&tz=Area/City&k=  — weather at a point: now, 48 hours, 7 days (MET Norway)
// GET /api/weather?tile=temp|wind/z/x/y&k=        — OpenWeatherMap map tiles (the key stays on the server)
// The key is part of the URL, so answers kept by the CDN are reachable only by members.
// MET Norway data: CC BY 4.0. Requests identify the site, as MET's terms ask.
import { env, isMember, json, tileKey, tileKeyOk } from './_lib/member.js';
import { normalizeMet, roundCoord } from './_lib/weatherNormalize.js';

const UA = 'osintfront.com weather (+https://osintfront.com)';
const MET = 'https://api.met.no/weatherapi/locationforecast/2.0/compact';
const OWM_LAYERS: Record<string, string> = { temp: 'temp_new', wind: 'wind_new' };

function validZone(tz: string | null): string {
  if (!tz) return 'Asia/Jerusalem';
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return tz;
  } catch {
    return 'Asia/Jerusalem';
  }
}

async function upstream(url: string, headers: Record<string, string>): Promise<globalThis.Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  try {
    return await fetch(url, { headers, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function point(q: URLSearchParams): Promise<Response> {
  const [lat, lng] = (q.get('point') ?? '').split(',').map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return json({ error: 'point=lat,lng' }, 400);
  const url = `${MET}?lat=${roundCoord(lat)}&lon=${roundCoord(lng)}`;
  try {
    const res = await upstream(url, { 'user-agent': UA, accept: 'application/json' });
    if (res.status === 429) {
      console.warn('[weather] MET rate limit');
      return json({ error: 'busy' }, 503); // no-store: the CDN keeps serving its stale copy meanwhile
    }
    if (!res.ok) return json({ error: 'weather unavailable' }, 502);
    const out = normalizeMet(await res.json(), validZone(q.get('tz')));
    return json(out, 200, 'public, max-age=300, s-maxage=1800, stale-while-revalidate=3600');
  } catch (e) {
    console.error('[weather] point failed', String((e as Error)?.message ?? e).slice(0, 200));
    return json({ error: 'weather unavailable' }, 502);
  }
}

async function tile(spec: string): Promise<Response> {
  const m = spec.match(/^(temp|wind)\/(\d{1,2})\/(\d{1,5})\/(\d{1,5})$/);
  if (!m) return new Response(null, { status: 400 });
  const [z, x, y] = [Number(m[2]), Number(m[3]), Number(m[4])];
  if (z > 12 || x >= 2 ** z || y >= 2 ** z) return new Response(null, { status: 400 });
  const key = env('OWM_API_KEY');
  if (!key) return new Response(null, { status: 503 });
  try {
    const res = await upstream(`https://tile.openweathermap.org/map/${OWM_LAYERS[m[1]]}/${z}/${x}/${y}.png?appid=${key}`, { 'user-agent': UA });
    if (!res.ok) return new Response(null, { status: 502, headers: { 'cache-control': 'no-store' } });
    return new Response(await res.arrayBuffer(), { status: 200, headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=300, s-maxage=600' } });
  } catch (e) {
    console.error('[weather] tile failed', String((e as Error)?.message ?? e).slice(0, 200));
    return new Response(null, { status: 502, headers: { 'cache-control': 'no-store' } });
  }
}

export async function GET(req: Request): Promise<Response> {
  const q = new URL(req.url).searchParams;
  if (q.get('key') === '1') {
    if (!(await isMember(req))) return json({ error: 'unauthorized' }, 401);
    return json({ k: tileKey() });
  }
  if (!tileKeyOk(q.get('k'))) return json({ error: 'forbidden' }, 403);
  if (q.get('point')) return point(q);
  const t = q.get('tile');
  if (t) return tile(t);
  return json({ error: 'nothing asked' }, 400);
}
