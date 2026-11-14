// Statistics dashboard — the mini map's geometry (pure, no imports; tests/ask/dashGeometry.test.ts).
// World units: Web Mercator over the Middle East box, x 0…1000 from its west edge, y 0 at its north edge.

export const REGION = { west: 24, east: 64, south: 11, north: 43 } as const;

const RAD = Math.PI / 180;
const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * RAD) / 2));
const SCALE = 1000 / ((REGION.east - REGION.west) * RAD);
const WORLD_W = 1000;
const WORLD_H = (mercY(REGION.north) - mercY(REGION.south)) * SCALE;
const K_MAX = 12;

export function project(lng: number, lat: number): [number, number] {
  return [(lng - REGION.west) * RAD * SCALE, (mercY(REGION.north) - mercY(lat)) * SCALE];
}

/** screen = world * k + (x, y) */
export interface View { k: number; x: number; y: number }

/** The view that shows these [lng, lat] points (none → the whole region), with a margin; k at most 8. */
export function fitView(points: [number, number][], w: number, h: number, pad = 28): View {
  const pts = points.length ? points.map(([lng, lat]) => project(lng, lat)) : [[0, 0], [WORLD_W, WORLD_H]];
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const bw = x1 - x0, bh = y1 - y0;
  const k = Math.min(8, bw > 0 ? (w - 2 * pad) / bw : Infinity, bh > 0 ? (h - 2 * pad) / bh : Infinity);
  return { k, x: w / 2 - ((x0 + x1) / 2) * k, y: h / 2 - ((y0 + y1) / 2) * k };
}

const fitAxis = (size: number, world: number, k: number, off: number) =>
  world * k >= size ? Math.min(0, Math.max(size - world * k, off)) : (size - world * k) / 2;

/** k between "the whole region fits" and 12; zoomed in, the box never shows beyond the region. */
export function clampView(v: View, w: number, h: number): View {
  const kMin = Math.min(w / WORLD_W, h / WORLD_H);
  const k = Math.min(K_MAX, Math.max(kMin, v.k));
  return { k, x: fitAxis(w, WORLD_W, k, v.x), y: fitAxis(h, WORLD_H, k, v.y) };
}

/** Zoom by factor around the screen point (cx, cy), then clamp. */
export function zoomAt(v: View, factor: number, cx: number, cy: number, w: number, h: number): View {
  const k = Math.min(K_MAX, v.k * factor);
  const wx = (cx - v.x) / v.k, wy = (cy - v.y) / v.k;
  return clampView({ k, x: cx - wx * k, y: cy - wy * k }, w, h);
}

export function viewKey(v: View): string {
  return [v.k, v.x, v.y].map((n) => n.toFixed(2)).join(',');
}

/** 6…22 px, by the square root of the share of the largest hotspot. */
export function hotspotRadius(count: number, max: number): number {
  return 6 + 16 * Math.sqrt(Math.max(0, count) / Math.max(1, max));
}

/** The chart's top: the first of 1, 2, 5 × 10^k at or above n; at least 4. */
export function niceMax(n: number): number {
  if (n <= 4) return 4;
  for (let p = 1; ; p *= 10) for (const m of [1, 2, 5]) if (m * p >= n) return m * p;
}

export function ringPath(ring: [number, number][]): string {
  return ring.map(([lng, lat], i) => { const [x, y] = project(lng, lat); return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`; }).join('') + 'Z';
}
