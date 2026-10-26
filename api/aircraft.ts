/// <reference types="node" />
// GET /api/aircraft?lat=..&lon=..&dist=..   (nautical miles, max 250) — live aircraft around a point
// GET /api/aircraft?mil=1                    — military aircraft worldwide
// Source: adsb.lol (open ADS-B data, no key). Members only. A short CDN cache keeps the load low:
// the position is rounded so nearby views share one answer.
import { isMember, json } from './_lib/member.js';

interface Plane {
  hex: string; flight: string; reg: string; type: string; desc: string; lat: number; lon: number;
  alt: number | 'ground' | null; gs: number | null; track: number | null; squawk: string; mil: boolean;
  category: string; seen: number | null;
}

function slim(a: any): Plane | null {
  const lat = Number(a?.lat), lon = Number(a?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const alt = a?.alt_baro === 'ground' ? 'ground' : Number.isFinite(Number(a?.alt_baro)) ? Number(a.alt_baro) : Number.isFinite(Number(a?.alt_geom)) ? Number(a.alt_geom) : null;
  const track = [a?.track, a?.true_heading, a?.calc_track, a?.mag_heading].map(Number).find((v) => Number.isFinite(v));
  return {
    hex: String(a?.hex ?? '').replace(/^~/, ''),
    flight: String(a?.flight ?? '').trim(),
    reg: String(a?.r ?? ''),
    type: String(a?.t ?? ''),
    desc: String(a?.desc ?? ''),
    lat: Math.round(lat * 1e5) / 1e5,
    lon: Math.round(lon * 1e5) / 1e5,
    alt,
    gs: Number.isFinite(Number(a?.gs)) ? Math.round(Number(a.gs)) : null,
    track: track ?? null,
    squawk: String(a?.squawk ?? ''),
    // readsb dbFlags: bit 1 = military.
    mil: (Number(a?.dbFlags) & 1) === 1,
    category: String(a?.category ?? ''),
    seen: Number.isFinite(Number(a?.seen_pos)) ? Number(a.seen_pos) : Number.isFinite(Number(a?.seen)) ? Number(a.seen) : null,
  };
}

export async function GET(req: Request): Promise<Response> {
  if (!(await isMember(req))) return json({ error: 'unauthorized' }, 401);
  const q = new URL(req.url).searchParams;
  let url: string;
  if (q.get('mil') === '1') {
    url = 'https://api.adsb.lol/v2/mil';
  } else {
    const lat = Number(q.get('lat')), lon = Number(q.get('lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return json({ error: 'lat/lon' }, 400);
    const dist = Math.min(250, Math.max(10, Math.round(Number(q.get('dist')) || 150)));
    url = `https://api.adsb.lol/v2/lat/${Math.round(lat * 4) / 4}/lon/${Math.round(lon * 4) / 4}/dist/${Math.ceil(dist / 25) * 25}`;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  try {
    const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'osintfront.com map' }, signal: ctrl.signal });
    if (!res.ok) return json({ error: `adsb.lol HTTP ${res.status}` }, 502);
    const out: any = await res.json();
    const planes = (Array.isArray(out?.ac) ? out.ac : []).map(slim).filter(Boolean);
    return json({ now: Number(out?.now) || Date.now(), planes }, 200, 'public, max-age=5, s-maxage=8, stale-while-revalidate=10');
  } catch (e) {
    return json({ error: String((e as Error)?.name === 'AbortError' ? 'adsb.lol timeout' : (e as Error)?.message ?? e).slice(0, 160) }, 502);
  } finally {
    clearTimeout(timer);
  }
}
