// Run: node --experimental-strip-types --test tests/satsr/satEnhance.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BOX_M, CELL, SATSR_PRODUCTS, anyOpen, availableProducts, cellBox, clipPolygon, downloadName, enhanceDate,
  jobMessageKey, snapCell, swipeClips, swipeQuads, type Pt,
} from '../../src/lib/satEnhance.ts';

test('cells snap like the database (floor(v * 200 + 0.5))', () => {
  assert.equal(CELL, 200);
  assert.deepEqual(snapCell(31.5, 34.45), { cellX: 6890, cellY: 6300, lat: 31.5, lng: 34.45 });
  assert.deepEqual(snapCell(31.5024, 34.4476), { cellX: 6890, cellY: 6300, lat: 31.5, lng: 34.45 });
  assert.equal(snapCell(31.5025, 34.45).cellY, 6301); // a tie rounds up, as floor(x + 0.5) does in SQL
  assert.equal(snapCell(-0.0026, -0.0026).cellX, -1);
  assert.equal(snapCell(-0.0025, -0.0025).cellX, 0);
});

test('the preview box is ~2.56 km around the cell centre', () => {
  const [[s, w], [n, e]] = cellBox(31.5011, 34.4512);
  assert.ok(Math.abs((s + n) / 2 - 31.5) < 1e-9 && Math.abs((w + e) / 2 - 34.45) < 1e-9);
  const hKm = ((n - s) * 111_320) / 1000;
  const wKm = ((e - w) * 111_320 * Math.cos((31.5 * Math.PI) / 180)) / 1000;
  assert.ok(Math.abs(hKm - BOX_M / 1000) < 1e-6, String(hKm));
  assert.ok(Math.abs(wKm - BOX_M / 1000) < 1e-6, String(wKm));
});

test('enhance date only for Sentinel-2 sources', () => {
  assert.equal(enhanceDate(true, 's2', '2026-11-10'), '2026-11-10');
  assert.equal(enhanceDate(true, 'hlss30', '2026-11-10'), '2026-11-10');
  assert.equal(enhanceDate(true, 'hlsl30', '2026-11-10'), null);
  assert.equal(enhanceDate(true, 'viirs', '2026-11-10'), null);
  assert.equal(enhanceDate(false, 's2', '2026-11-10'), null);
  assert.equal(enhanceDate(true, 's2', ''), null);
  assert.equal(enhanceDate(true, 's2', 'nope'), null);
});

test('status line per job', () => {
  assert.deepEqual(jobMessageKey({ status: 'queued', queuePos: 3 }, true), { key: 'satsr.queued', vars: { n: 3 } });
  assert.deepEqual(jobMessageKey({ status: 'queued', queuePos: null }, true), { key: 'satsr.queued', vars: { n: 1 } });
  assert.deepEqual(jobMessageKey({ status: 'queued', queuePos: 3 }, false), { key: 'satsr.offline' });
  assert.deepEqual(jobMessageKey({ status: 'running' }, false), { key: 'satsr.running' });
  assert.deepEqual(jobMessageKey({ status: 'failed', errorCode: 'no_scene' }, true), { key: 'satsr.fail.no_scene' });
  assert.deepEqual(jobMessageKey({ status: 'failed', errorCode: 'timeout' }, true), { key: 'satsr.fail.other' });
  assert.deepEqual(jobMessageKey({ status: 'done', cacheHit: true }, true), { key: 'satsr.cached' });
  assert.deepEqual(jobMessageKey({ status: 'done', cacheHit: false }, true), { key: 'satsr.done' });
  assert.equal(anyOpen([{ status: 'done' }, { status: 'running' }]), true);
  assert.equal(anyOpen([{ status: 'done' }, { status: 'failed' }]), false);
});

test('download names name the product and before / after', () => {
  const job = { sceneDate: '2026-11-10', lat: 31.5, lng: 34.45 };
  assert.equal(downloadName(job, 'tci', 'sr'), 'osintfront-sat-2026-11-10-31.5000N-34.4500E-tci-after-2.5m.png');
  assert.equal(downloadName(job, 'irp', 'lr'), 'osintfront-sat-2026-11-10-31.5000N-34.4500E-irp-before-10m.png');
  assert.equal(downloadName({ sceneDate: null, lat: -1.25, lng: -70.5 }, 'ndvi', 'sr'), 'osintfront-sat-na-1.2500S-70.5000W-ndvi-after-2.5m.png');
});

test('products: several per job, unknown or half-made ones ignored', () => {
  assert.deepEqual(SATSR_PRODUCTS, ['tci', 'irp', 'ndvi']);
  const j = 'abc';
  const products = {
    ndvi: { sr: `${j}/ndvi_sr.png`, lr: `${j}/ndvi_lr.png` },
    tci: { sr: `${j}/tci_sr.png`, lr: `${j}/tci_lr.png` },
    irp: { sr: `${j}/irp_sr.png` },
    swir: { sr: 'x', lr: 'y' },
  };
  assert.deepEqual(availableProducts(products), ['tci', 'ndvi']);
  assert.deepEqual(availableProducts(null), []);
});

test('swipe halves split at the divider', () => {
  const q = swipeQuads(800, 600, 0.25);
  assert.deepEqual(q.left, [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 600 }, { x: 0, y: 600 }]);
  assert.deepEqual(q.right, [{ x: 200, y: 0 }, { x: 800, y: 0 }, { x: 800, y: 600 }, { x: 200, y: 600 }]);
  assert.equal(swipeQuads(800, 600, 2).left[1].x, 800); // clamped
  assert.equal(clipPolygon([{ x: 1.04, y: -2 }, { x: 3, y: 4.56 }]), 'polygon(1px -2px, 3px 4.6px)');
});

test('swipe clips follow a north-up map (pane = container minus pan offset)', () => {
  const pan = { x: -120, y: 35 };
  const c = swipeClips(1000, 500, 0.5, (p) => ({ x: p.x - pan.x, y: p.y - pan.y }));
  assert.equal(c.before, 'polygon(120px -35px, 620px -35px, 620px 465px, 120px 465px)');
  assert.equal(c.after, 'polygon(620px -35px, 1120px -35px, 1120px 465px, 620px 465px)');
});

test('swipe clips under leaflet-rotate: the screen line stays vertical on screen', () => {
  // leaflet-rotate: layer point = rotate(container point - mapPanePos, -bearing, around pivot) - pivot.
  const bearing = 30, pivot = { x: 400, y: 300 }, mapPos = { x: 10, y: -20 };
  const rad = (-bearing * Math.PI) / 180;
  const toPane = (p: Pt): Pt => {
    const x = p.x - mapPos.x - pivot.x, y = p.y - mapPos.y - pivot.y;
    return { x: x * Math.cos(rad) - y * Math.sin(rad), y: x * Math.sin(rad) + y * Math.cos(rad) };
  };
  const fromPane = (p: Pt): Pt => {
    const x = p.x * Math.cos(-rad) - p.y * Math.sin(-rad), y = p.x * Math.sin(-rad) + p.y * Math.cos(-rad);
    return { x: x + pivot.x + mapPos.x, y: y + pivot.y + mapPos.y };
  };
  const w = 800, h = 600, f = 0.4;
  const c = swipeClips(w, h, f, toPane);
  const parse = (s: string): Pt[] => s.slice(8, -1).split(', ').map((pt) => {
    const [x, y] = pt.split(' ').map((v) => parseFloat(v));
    return { x, y };
  });
  // back on screen, the "before" polygon is exactly the left part and the "after" polygon the right part
  const before = parse(c.before).map(fromPane), after = parse(c.after).map(fromPane);
  const near = (a: Pt, b: Pt) => Math.abs(a.x - b.x) < 0.2 && Math.abs(a.y - b.y) < 0.2;
  const q = swipeQuads(w, h, f);
  before.forEach((p, i) => assert.ok(near(p, q.left[i]), `before ${i}: ${JSON.stringify(p)}`));
  after.forEach((p, i) => assert.ok(near(p, q.right[i]), `after ${i}: ${JSON.stringify(p)}`));
  // and in pane coordinates the split edge is NOT axis-aligned (a rect() clip would be wrong here)
  const pb = parse(c.before);
  assert.ok(Math.abs(pb[1].x - pb[2].x) > 100);
});
