// Run: node --experimental-strip-types --test tests/ask/dashGeometry.test.ts
//
// Statistics dashboard — the mini map's geometry: Web Mercator over the Middle East box, fitting,
// clamped zoom and pan, hotspot sizes and chart scales.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REGION, clampView, fitView, hotspotRadius, niceMax, project, ringPath, viewKey, zoomAt } from '../../src/lib/dashGeometry.ts';

const W = 600, H = 400;
const screen = (v: { k: number; x: number; y: number }, p: [number, number]) => [p[0] * v.k + v.x, p[1] * v.k + v.y];

test('project: west/north corner at 0,0; east edge at 1000; north is up', () => {
  assert.deepEqual(project(24, 43).map((x) => Math.round(x * 1e6) / 1e6), [0, 0]);
  assert.equal(Math.round(project(64, 43)[0] * 1e6) / 1e6, 1000);
  assert.ok(project(40, 30)[0] > project(30, 30)[0]);
  assert.ok(project(35, 33)[1] < project(35, 20)[1]);
});

test('fitView: nothing → the whole region; points inside with a margin; one point centred', () => {
  const v = fitView([], W, H);
  for (const [lng, lat] of [[REGION.west, REGION.north], [REGION.east, REGION.north], [REGION.west, REGION.south], [REGION.east, REGION.south]] as [number, number][]) {
    const [x, y] = screen(v, project(lng, lat));
    assert.ok(x >= -0.5 && x <= W + 0.5 && y >= -0.5 && y <= H + 0.5, `${lng},${lat}`);
  }
  const two = fitView([[35.8, 33.1], [36.1, 32.6]], W, H);
  for (const p of [[35.8, 33.1], [36.1, 32.6]] as [number, number][]) {
    const [x, y] = screen(two, project(...p));
    assert.ok(x >= 27.5 && x <= W - 27.5 && y >= 27.5 && y <= H - 27.5);
  }
  const one = fitView([[35.8, 33.1]], W, H);
  assert.ok(one.k <= 8);
  const [x, y] = screen(one, project(35.8, 33.1));
  assert.ok(Math.abs(x - W / 2) <= 1 && Math.abs(y - H / 2) <= 1);
});

test('clampView: idempotent, bounded, never past the region when zoomed in', () => {
  const a = clampView({ k: 3, x: 5000, y: 0 }, W, H);
  assert.ok(a.x <= 0);
  assert.deepEqual(clampView(a, W, H), a);
  assert.ok(clampView({ k: 99, x: 0, y: 0 }, W, H).k <= 12);
  const small = clampView({ k: 0.0001, x: 0, y: 0 }, W, H);
  assert.deepEqual(clampView(small, W, H), small);
  assert.ok(small.k > 0.0001);
});

test('zoomAt: doubles k and keeps the point under the cursor', () => {
  const v = { k: 2, x: -500, y: -300 };
  const z = zoomAt(v, 2, 300, 200, W, H);
  assert.equal(z.k, 4);
  const world = [(300 - v.x) / v.k, (200 - v.y) / v.k];
  assert.ok(Math.abs(world[0] * z.k + z.x - 300) <= 0.5 && Math.abs(world[1] * z.k + z.y - 200) <= 0.5);
  assert.equal(zoomAt({ k: 10, x: -5000, y: -3000 }, 2, 300, 200, W, H).k, 12);
});

test('hotspotRadius, niceMax, viewKey, ringPath', () => {
  assert.equal(hotspotRadius(10, 10), 22);
  assert.ok(hotspotRadius(1, 10) >= 6);
  assert.ok(hotspotRadius(5, 10) > hotspotRadius(2, 10));
  assert.deepEqual([0, 5, 7, 14, 51].map(niceMax), [4, 5, 10, 20, 100]);
  assert.equal(viewKey({ k: 1.234, x: -5.678, y: 0 }), '1.23,-5.68,0.00');
  assert.match(ringPath([[35, 33], [36, 33], [36, 32]]), /^M[-\d.]+,[-\d.]+(L[-\d.]+,[-\d.]+){2}Z$/);
});
