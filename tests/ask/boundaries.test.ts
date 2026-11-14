// Run: node --experimental-strip-types --test tests/ask/boundaries.test.ts
//
// public/data/me-admin0.geojson — the mini map's country outlines (Natural Earth 1:50m, public domain):
// small, the region's countries under their stored names, clipped to the box, 2 decimals.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { REGION } from '../../src/lib/dashGeometry.ts';

const PATH = 'public/data/me-admin0.geojson';

test('small enough to lazy-load', () => {
  assert.ok(statSync(PATH).size <= 150_000, String(statSync(PATH).size));
});

test('countries, geometry, box and precision', () => {
  const fc = JSON.parse(readFileSync(PATH, 'utf8'));
  assert.equal(fc.type, 'FeatureCollection');
  const names = new Set(fc.features.map((f: any) => f.properties.name));
  for (const n of ['Israel', 'Palestine', 'Lebanon', 'Syria', 'Jordan', 'Iraq', 'Iran', 'Egypt', 'Saudi Arabia', 'Yemen', 'Turkey']) assert.ok(names.has(n), n);
  for (const f of fc.features) {
    assert.ok(['Polygon', 'MultiPolygon'].includes(f.geometry.type));
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys) for (const ring of poly) for (const [lng, lat] of ring) {
      assert.ok(lng >= REGION.west - 0.01 && lng <= REGION.east + 0.01 && lat >= REGION.south - 0.01 && lat <= REGION.north + 0.01);
      assert.equal(Math.round(lng * 100) / 100, lng);
      assert.equal(Math.round(lat * 100) / 100, lat);
    }
  }
});
