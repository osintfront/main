// Builds public/data/me-admin0.geojson — the statistics dashboard's mini-map outlines: every Natural
// Earth 1:50m admin-0 country (public domain, from the world-atlas package) that touches the dashboard's
// Middle East box, clipped to it, 2 decimals, named as countries are stored on the site.
// Run: node tools/geo/build-me-admin0.mjs   (dev dependencies world-atlas, topojson-client)
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { feature } from 'topojson-client';

const require = createRequire(import.meta.url);
const world = JSON.parse(readFileSync(require.resolve('world-atlas/countries-50m.json'), 'utf8'));
// Keep in step with REGION in src/lib/dashGeometry.ts.
const R = { west: 24, east: 64, south: 11, north: 43 };
const RENAME = { 'N. Cyprus': 'Cyprus' };

const round = (n) => Math.round(n * 100) / 100;

/** Sutherland–Hodgman against one edge of the box. */
function clipEdge(ring, inside, cross) {
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const ia = inside(a), ib = inside(b);
    if (ia) out.push(a);
    if (ia !== ib) out.push(cross(a, b));
  }
  return out;
}
const atX = (x) => (a, b) => [x, a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0])];
const atY = (y) => (a, b) => [a[0] + ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]), y];

function clipRing(ring) {
  let r = ring.slice(0, -1);
  r = clipEdge(r, (p) => p[0] >= R.west, atX(R.west));
  r = clipEdge(r, (p) => p[0] <= R.east, atX(R.east));
  r = clipEdge(r, (p) => p[1] >= R.south, atY(R.south));
  r = clipEdge(r, (p) => p[1] <= R.north, atY(R.north));
  const pts = [];
  for (const [x, y] of r) {
    const p = [round(x), round(y)];
    const last = pts[pts.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) pts.push(p);
  }
  if (pts.length && (pts[0][0] !== pts[pts.length - 1][0] || pts[0][1] !== pts[pts.length - 1][1])) pts.push(pts[0]);
  return pts.length >= 4 ? pts : null;
}

const features = [];
for (const f of feature(world, world.objects.countries).features) {
  if (!f.geometry) continue;
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  const kept = polys.map((poly) => {
    const outer = clipRing(poly[0]);
    if (!outer) return null;
    return [outer, ...poly.slice(1).map(clipRing).filter(Boolean)];
  }).filter(Boolean);
  if (!kept.length) continue;
  const name = RENAME[f.properties.name] ?? f.properties.name;
  features.push({ type: 'Feature', properties: { name }, geometry: kept.length === 1 ? { type: 'Polygon', coordinates: kept[0] } : { type: 'MultiPolygon', coordinates: kept } });
}
const out = JSON.stringify({ type: 'FeatureCollection', features });
writeFileSync(new URL('../../public/data/me-admin0.geojson', import.meta.url), out);
console.log(`me-admin0.geojson: ${features.length} countries, ${out.length} bytes`);
