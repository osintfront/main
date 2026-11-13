// Run: node --experimental-strip-types --test tests/fires/firesRequests.test.ts
// NASA GIBS fails a whole WMS tile when any one of its layers has no data for the day
// (Suomi NPP VIIRS has had none since late Oct 2026), so each satellite is asked on its own.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FIRE_LAYERS, firesRequests } from '../../src/lib/firesLayer.ts';

const now = Date.parse('2026-11-13T13:00:00Z');

test('each request asks for exactly one satellite layer', () => {
  for (const r of firesRequests(null, now)) assert.equal(r.layer.includes(','), false, r.layer);
});

test('with no chosen day: every satellite for yesterday and today (UTC)', () => {
  const reqs = firesRequests(null, now);
  assert.equal(reqs.length, FIRE_LAYERS.length * 2);
  assert.deepEqual([...new Set(reqs.map((r) => r.time))].sort(), ['2026-11-12', '2026-11-13']);
});

test('with a chosen day: that day and the one before', () => {
  const reqs = firesRequests('2026-10-20', now);
  assert.deepEqual([...new Set(reqs.map((r) => r.time))].sort(), ['2026-10-19', '2026-10-20']);
});

test('includes NOAA-20 and NOAA-21, which have current data', () => {
  assert.ok(FIRE_LAYERS.includes('VIIRS_NOAA20_Thermal_Anomalies_375m_All'));
  assert.ok(FIRE_LAYERS.includes('VIIRS_NOAA21_Thermal_Anomalies_375m_All'));
});
