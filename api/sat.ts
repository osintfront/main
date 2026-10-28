/// <reference types="node" />
// GET /api/sat — satellite pictures for the map's "satellite" layer.
//   ?key=1                                   members: a tile key for this week + which sources work
//   ?dates=1&src=s2|hlss30|hlsl30&bbox=w,s,e,n&days=60   members: days with a picture of this area
//   ?tile=z/x/y&date=YYYY-MM-DD&k=<key>      Sentinel-2 (10 m) tile from Copernicus (Sentinel Hub
//                                            Process API). Needs CDSE_CLIENT_ID + CDSE_CLIENT_SECRET.
// NASA pictures (HLS 30 m, VIIRS daily) are loaded by the browser straight from NASA GIBS.
import { env, isMember, json, tileKey, tileKeyOk } from './_lib/member.js';

const S2_READY = () => !!(env('CDSE_CLIENT_ID') && env('CDSE_CLIENT_SECRET'));
const DAY = /^\d{4}-\d{2}-\d{2}$/;

// ── Copernicus token (client credentials), kept while it is valid ──
let token: { value: string; until: number } | null = null;
async function cdseToken(): Promise<string> {
  if (token && token.until > Date.now() + 30_000) return token.value;
  const res = await fetch('https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: env('CDSE_CLIENT_ID'), client_secret: env('CDSE_CLIENT_SECRET') }),
  });
  if (!res.ok) throw new Error(`Copernicus sign-in failed: HTTP ${res.status}`);
  const out = await res.json();
  token = { value: String(out.access_token), until: Date.now() + Number(out.expires_in ?? 300) * 1000 };
  return token.value;
}

const EVALSCRIPT = `//VERSION=3
function setup(){return{input:["B04","B03","B02","dataMask"],output:{bands:4}};}
function evaluatePixel(s){return[2.6*s.B04,2.6*s.B03,2.6*s.B02,s.dataMask];}`;

async function s2Tile(z: number, x: number, y: number, date: string): Promise<Response> {
  const R = 20037508.342789244;
  const size = (2 * R) / 2 ** z;
  const bbox = [-R + x * size, R - (y + 1) * size, -R + (x + 1) * size, R - y * size];
  const res = await fetch('https://sh.dataspace.copernicus.eu/api/v1/process', {
    method: 'POST',
    headers: { authorization: `Bearer ${await cdseToken()}`, 'content-type': 'application/json', accept: 'image/png' },
    body: JSON.stringify({
      input: {
        bounds: { bbox, properties: { crs: 'http://www.opengis.net/def/crs/EPSG/0/3857' } },
        data: [{ type: 'sentinel-2-l2a', dataFilter: { timeRange: { from: `${date}T00:00:00Z`, to: `${date}T23:59:59Z` }, mosaickingOrder: 'leastCC' } }],
      },
      output: { width: 256, height: 256, responses: [{ identifier: 'default', format: { type: 'image/png' } }] },
      evalscript: EVALSCRIPT,
    }),
  });
  if (!res.ok) {
    console.warn(`[sat] Sentinel-2 tile failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    return new Response(null, { status: res.status === 429 ? 429 : 502, headers: { 'cache-control': 'no-store' } });
  }
  // A past day's picture never changes: the CDN keeps it (one Copernicus request per tile).
  const past = date < new Date().toISOString().slice(0, 10);
  return new Response(await res.arrayBuffer(), {
    headers: { 'content-type': 'image/png', 'cache-control': past ? 'public, max-age=86400, s-maxage=31536000, immutable' : 'public, max-age=600, s-maxage=3600' },
  });
}

/** Days with a picture of the area (newest first), with the least cloud cover seen that day. */
async function dates(src: string, bbox: number[], days: number) {
  const to = new Date();
  const from = new Date(to.getTime() - days * 86400_000);
  const range = `${from.toISOString().slice(0, 19)}Z/${to.toISOString().slice(0, 19)}Z`;
  const base =
    src === 's2'
      ? `https://catalogue.dataspace.copernicus.eu/stac/collections/sentinel-2-l2a/items?bbox=${bbox.join(',')}&datetime=${range}&limit=100`
      : `https://cmr.earthdata.nasa.gov/stac/LPCLOUD/search?collections=${src === 'hlsl30' ? 'HLSL30_2.0' : 'HLSS30_2.0'}&bbox=${bbox.join(',')}&datetime=${range}&limit=100`;
  const byDay = new Map<string, number>();
  let url: string | null = base;
  for (let page = 0; url && page < 5; page++) {
    const res: Response = await fetch(url, { headers: { accept: 'application/geo+json' } });
    if (!res.ok) throw new Error(`catalogue HTTP ${res.status}`);
    const out: any = await res.json();
    for (const f of out?.features ?? []) {
      const day = String(f?.properties?.datetime ?? '').slice(0, 10);
      if (!DAY.test(day)) continue;
      const cc = Number(f?.properties?.['eo:cloud_cover']);
      const prev = byDay.get(day);
      byDay.set(day, Number.isFinite(cc) ? Math.min(prev ?? 100, cc) : prev ?? -1);
    }
    url = (out?.links ?? []).find((l: any) => l?.rel === 'next' && (!l.method || l.method === 'GET'))?.href ?? null;
  }
  return [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([date, cloud]) => ({ date, cloud: cloud < 0 ? null : Math.round(cloud) }));
}

export async function GET(req: Request): Promise<Response> {
  const q = new URL(req.url).searchParams;
  const tile = q.get('tile');
  if (tile) {
    if (!tileKeyOk(q.get('k'))) return new Response(null, { status: 403 });
    if (!S2_READY()) return new Response(null, { status: 404 });
    const m = tile.match(/^(\d{1,2})\/(\d{1,7})\/(\d{1,7})$/);
    const date = q.get('date') ?? '';
    if (!m || !DAY.test(date)) return new Response(null, { status: 400 });
    const [z, x, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    // Wide views would cost a lot of Copernicus quota for little detail: zoom in first.
    if (z < 8 || z > 16 || x >= 2 ** z || y >= 2 ** z) return new Response(null, { status: 400 });
    try {
      return await s2Tile(z, x, y, date);
    } catch (e) {
      console.warn('[sat]', String(e).slice(0, 200));
      return new Response(null, { status: 502, headers: { 'cache-control': 'no-store' } });
    }
  }
  if (!(await isMember(req))) return json({ error: 'unauthorized' }, 401);
  if (q.get('key') === '1') return json({ k: tileKey(), sentinel2: S2_READY() });
  if (q.get('dates') === '1') {
    const src = q.get('src') ?? 's2';
    if (!['s2', 'hlss30', 'hlsl30'].includes(src)) return json({ error: 'unknown source' }, 400);
    const bbox = (q.get('bbox') ?? '').split(',').map(Number);
    if (bbox.length !== 4 || bbox.some((n) => !Number.isFinite(n))) return json({ error: 'bbox=w,s,e,n' }, 400);
    // The catalogues accept small areas best: search around the middle of the view.
    const [w, s, e, n] = bbox;
    const cx = (w + e) / 2, cy = (s + n) / 2;
    const half = Math.min(0.5, Math.max(0.05, (e - w) / 2, (n - s) / 2));
    const days = Math.min(365, Math.max(7, Number(q.get('days')) || 60));
    try {
      const list = await dates(src, [cx - half, cy - half, cx + half, cy + half].map((v) => Math.round(v * 1000) / 1000), days);
      return json({ src, dates: list }, 200, 'private, max-age=900');
    } catch (e) {
      console.error('sat failed', String((e as Error)?.message ?? e).slice(0, 300));
      return json({ error: 'imagery unavailable' }, 502);
    }
  }
  return json({ error: 'nothing asked' }, 400);
}
