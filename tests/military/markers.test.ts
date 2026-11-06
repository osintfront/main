// Run: node --experimental-strip-types --test tests/military/markers.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { MilitaryMarkers, foreignShown, type GroupLike } from '../../src/lib/militaryMarkers.ts';
import type { MilKind } from '../../src/lib/military.ts';

type Calls = Record<MilKind, string[]>;
function setup() {
  const calls: Calls = { base: [], naval: [], range: [], minor: [] };
  const shown: Record<string, string[]> = {};
  const group = (k: MilKind): GroupLike<string> => ({
    clearLayers: () => { calls[k].push('clear'); shown[k] = []; },
    addLayers: (m) => { calls[k].push(`add ${m.length}`); shown[k] = m; },
    addTo: () => { calls[k].push('addTo'); },
    remove: () => { calls[k].push('remove'); },
  });
  const mm = new MilitaryMarkers<string>(group);
  mm.setMarkers(['base', 'naval', 'range'], [
    { k: 'base', f: false, m: 'b1' }, { k: 'base', f: true, m: 'b2' }, { k: 'naval', f: false, m: 'n1' }, { k: 'range', f: false, m: 'r1' },
  ]);
  const reset = () => { for (const k of Object.keys(calls) as MilKind[]) calls[k] = []; };
  return { mm, calls, shown, reset };
}
const off = { base: false, naval: false, range: false, minor: false };

test('turning a kind on adds its markers; the others are not touched', () => {
  const { mm, calls, shown } = setup();
  mm.apply({ on: { ...off, base: true }, foreignOnly: false, zoomOk: false }, {});
  assert.deepEqual(shown.base, ['b1', 'b2']);
  assert.deepEqual(calls.naval, []);
});

test('toggling bunkers & checkpoints leaves the main kinds alone', () => {
  const { mm, calls, reset } = setup();
  mm.apply({ on: { ...off, base: true }, foreignOnly: false, zoomOk: true }, {});
  mm.setMarkers(['minor'], [{ k: 'minor', f: false, m: 'm1' }]);
  reset();
  mm.apply({ on: { ...off, base: true, minor: true }, foreignOnly: false, zoomOk: true }, {});
  assert.deepEqual(calls.base, []);
  assert.deepEqual(calls.minor, ['clear', 'add 1', 'addTo']);
});

test('crossing zoom 11 only touches bunkers & checkpoints, and only when they are on', () => {
  const { mm, calls, reset } = setup();
  mm.setMarkers(['minor'], [{ k: 'minor', f: false, m: 'm1' }]);
  mm.apply({ on: { ...off, base: true }, foreignOnly: false, zoomOk: false }, {});
  reset();
  mm.apply({ on: { ...off, base: true }, foreignOnly: false, zoomOk: true }, {});
  assert.deepEqual(calls, { base: [], naval: [], range: [], minor: [] });
  mm.apply({ on: { ...off, base: true, minor: true }, foreignOnly: false, zoomOk: true }, {});
  reset();
  mm.apply({ on: { ...off, base: true, minor: true }, foreignOnly: false, zoomOk: false }, {});
  assert.deepEqual(calls.base, []);
  assert.deepEqual(calls.minor, ['clear', 'remove']);
});

test('the foreign filter re-applies only the kinds that are shown', () => {
  const { mm, calls, shown, reset } = setup();
  mm.apply({ on: { ...off, base: true }, foreignOnly: false, zoomOk: false }, {});
  reset();
  mm.apply({ on: { ...off, base: true }, foreignOnly: true, zoomOk: false }, {});
  assert.deepEqual(shown.base, ['b2']);
  assert.deepEqual(calls.naval, []);
});

test('loading the minor file does not rebuild the main kinds', () => {
  const { mm, calls, reset } = setup();
  mm.apply({ on: { ...off, base: true, naval: true }, foreignOnly: false, zoomOk: false }, {});
  reset();
  mm.setMarkers(['minor'], [{ k: 'minor', f: false, m: 'm1' }]);
  mm.apply({ on: { ...off, base: true, naval: true }, foreignOnly: false, zoomOk: false }, {});
  assert.deepEqual(calls.base, []);
  assert.deepEqual(calls.naval, []);
});

test('new markers for a shown kind (language change) are re-applied', () => {
  const { mm, shown } = setup();
  mm.apply({ on: { ...off, base: true }, foreignOnly: false, zoomOk: false }, {});
  mm.setMarkers(['base', 'naval', 'range'], [{ k: 'base', f: false, m: 'B1' }]);
  mm.apply({ on: { ...off, base: true }, foreignOnly: false, zoomOk: false }, {});
  assert.deepEqual(shown.base, ['B1']);
});

test('removeAll takes every created group off the map', () => {
  const { mm, calls, reset } = setup();
  mm.apply({ on: { ...off, base: true }, foreignOnly: false, zoomOk: false }, {});
  reset();
  mm.removeAll();
  assert.deepEqual(calls.base, ['remove']);
});

const fc = (props: object[]) => ({ type: 'FeatureCollection', features: props.map((p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: p })) }) as GeoJSON.FeatureCollection;

test('the legend shows "Foreign-operated" only when a shown kind has a foreign site', () => {
  const main = fc([{ k: 'base', cc: 'QA', f: true }, { k: 'naval', cc: 'SY' }]);
  assert.equal(foreignShown([main, undefined], { ...off, base: true }), true);
  assert.equal(foreignShown([main, undefined], { ...off, naval: true }), false);
  assert.equal(foreignShown([undefined, undefined], { ...off, base: true }), false);
});
