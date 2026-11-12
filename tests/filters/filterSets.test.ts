// Run: node --experimental-strip-types --test tests/filters/filterSets.test.ts
//
// Filter sets: several named filters, each a full filter of its own. An event shows when it fits
// at least one set that is in force. These are the pure rules behind that.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_SETS, MAX_POLYGONS, MAX_POLYGON_POINTS, MAX_NAME, SET_COLORS, EMPTY_SET_FILTER,
  matchesSetFilter, planSetLimit, isLocked, setsOn, matchingSets, setsArchiveRange, setAcceptsAlert,
  isEmptySet, newSet, addPolygon, sanitizeSets, type FilterSet, type SetFilter,
} from '../../src/lib/filterSets.ts';

const H = 3600_000;
const NOW = Date.UTC(2026, 10, 12, 10, 0, 0);
type LL = [number, number];

// deno-lint-ignore no-explicit-any
const ev = (over: Record<string, unknown> = {}): any => ({
  id: 'e1', title: 'T', description: '', severity: 'high', latitude: 33.27, longitude: 35.2, locationName: 'Tyre',
  locationPrecision: 'city', country: 'Lebanon', region: '', city: '', sourceName: null, sourceUrl: null, sourceType: 'other',
  occurredAt: new Date(NOW - H).toISOString(), publishedAt: null, isBreaking: false, isVerified: false,
  category: { id: null, slug: 'airstrike', name: 'Airstrike', icon: '', color: '', markerColor: '' }, translations: {},
  ...over,
});
let n = 0;
const set = (over: Partial<SetFilter> = {}, extra: Partial<FilterSet> = {}): FilterSet => ({
  id: `s${++n}`, name: `Set ${n}`, color: SET_COLORS[0], enabled: true, filter: { ...EMPTY_SET_FILTER, ...over }, ...extra,
});
const square = (lat: number, lng: number, d = 0.2): LL[] => [[lat - d, lng - d], [lat - d, lng + d], [lat + d, lng + d], [lat + d, lng - d]];
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

test('limits and colours are the agreed ones', () => {
  assert.equal(MAX_SETS, 6);
  assert.equal(MAX_POLYGONS, 3);
  assert.equal(MAX_POLYGON_POINTS, 200);
  assert.equal(MAX_NAME, 40);
  assert.deepEqual([...SET_COLORS], ['#7c3aed', '#d97706', '#059669', '#db2777', '#0891b2', '#65a30d']);
});

test('inside a set the fields are AND', () => {
  const s = set({ areas: ['lebanon'], categories: ['airstrike'] }).filter;
  assert.equal(matchesSetFilter(ev(), s, NOW), true);
  assert.equal(matchesSetFilter(ev({ category: { slug: 'artillery-shelling' } }), s, NOW), false);
  assert.equal(matchesSetFilter(ev({ country: 'Iran' }), s, NOW), false);
});

test('place is country OR drawn area', () => {
  const s = set({ areas: ['lebanon'], polygons: [square(32.62, 36.1)] }).filter;
  assert.equal(matchesSetFilter(ev(), s, NOW), true);
  assert.equal(matchesSetFilter(ev({ country: 'Syria', latitude: 32.62, longitude: 36.1 }), s, NOW), true);
  assert.equal(matchesSetFilter(ev({ country: 'Syria', latitude: 36.2, longitude: 37.15 }), s, NOW), false);
});

test('an event inside the second of two drawn areas fits', () => {
  const s = set({ polygons: [square(30, 30), square(32.62, 36.1)] }).filter;
  assert.equal(matchesSetFilter(ev({ latitude: 32.62, longitude: 36.1 }), s, NOW), true);
});

test('a further place of the event inside the area is enough', () => {
  const s = set({ polygons: [square(32.62, 36.1)] }).filter;
  assert.equal(matchesSetFilter(ev({ places: [{ index: 0, name: 'x', nameEn: 'x', latitude: 32.62, longitude: 36.1, precision: 'city' }] }), s, NOW), true);
});

test('an empty set fits anything in its time window (live = 12 hours)', () => {
  const s = set().filter;
  assert.equal(matchesSetFilter(ev(), s, NOW), true);
  assert.equal(matchesSetFilter(ev({ occurredAt: iso(13 * H) }), s, NOW), false);
  assert.equal(isEmptySet(s), true);
  assert.equal(isEmptySet({ ...s, categories: ['uav'] }), false);
});

test('each set has its own time', () => {
  const a = set({ preset: '1h' });
  const b = set({ preset: '7d' });
  assert.deepEqual(matchingSets(ev({ occurredAt: iso(72 * H) }), [a, b], NOW), [b]);
});

test('an event between two far-apart time windows is not shown', () => {
  const a = set({ preset: 'custom', from: iso(240 * H), to: iso(216 * H) });
  const b = set({ preset: 'custom', from: iso(48 * H), to: iso(24 * H) });
  assert.deepEqual(matchingSets(ev({ occurredAt: iso(120 * H) }), [a, b], NOW), []);
  assert.deepEqual(setsArchiveRange([a, b], NOW), { from: iso(240 * H), to: iso(24 * H) });
});

test('archive range: none when no set reaches past 24 hours', () => {
  assert.equal(setsArchiveRange([], NOW), null);
  assert.equal(setsArchiveRange([set({ preset: 'live' }), set({ preset: '24h' })], NOW), null);
  assert.equal(setsArchiveRange([set({ preset: '7d' })], NOW)?.from, iso(168 * H));
});

test('an event fitting two sets is listed once per set, in list order', () => {
  const a = set({ polygons: [square(33.27, 35.2)] });
  const b = set({ areas: ['lebanon'] });
  assert.deepEqual(matchingSets(ev(), [a, b], NOW), [a, b]);
  assert.deepEqual(matchingSets(ev(), [b, a], NOW), [b, a]);
});

test('plan limit', () => {
  assert.equal(planSetLimit(false, 6), 0);
  assert.equal(planSetLimit(true, null), 6);
  assert.equal(planSetLimit(true, 1), 1);
  assert.equal(planSetLimit(true, 99), 6);
  assert.equal(planSetLimit(true, -3), 0);
});

test('sets past the plan limit are locked, not removed', () => {
  const list = [set(), set(), set()];
  assert.deepEqual(setsOn(list, 1), [list[0]]);
  assert.equal(isLocked(list, list[0].id, 1), false);
  assert.equal(isLocked(list, list[1].id, 1), true);
  assert.equal(isLocked(list, list[2].id, 1), true);
  assert.deepEqual(setsOn(list, 0), []);
  const off = [set({}, { enabled: false }), set()];
  assert.deepEqual(setsOn(off, 1), []);
});

test('home-front alerts follow the sets', () => {
  const pt: LL[] = [[32.08, 34.78]];
  const A = 'home-front-alerts';
  assert.equal(setAcceptsAlert(set(), pt, A), true);
  assert.equal(setAcceptsAlert(set({ categories: ['airstrike'] }), pt, A), false);
  assert.equal(setAcceptsAlert(set({ areas: ['lebanon'] }), pt, A), false);
  assert.equal(setAcceptsAlert(set({ areas: ['israel'] }), pt, A), true);
  assert.equal(setAcceptsAlert(set({ polygons: [square(32.08, 34.78)] }), pt, A), true);
});

test('a new set takes the first free colour', () => {
  const a = newSet([], 'x'.repeat(60));
  assert.equal(a.color, '#7c3aed');
  assert.equal(a.enabled, true);
  assert.equal(a.name.length, 40);
  assert.deepEqual(a.filter, EMPTY_SET_FILTER);
  const b = newSet([a], 'b');
  const c = newSet([a, b], 'c');
  assert.equal(c.color, '#059669');
  assert.notEqual(a.id, b.id);
});

test('adding a drawn area', () => {
  const sets = [set(), set()];
  const sq = square(33, 35);
  const out = addPolygon(sets, sets[0].id, sq, 6);
  assert.equal(out[0].filter.polygons.length, 1);
  assert.equal(out[1], sets[1]);
  assert.equal(addPolygon(sets, 'nope', sq, 6), sets);
  assert.equal(addPolygon(sets, sets[1].id, sq, 1), sets, 'locked set');
  const full = [set({ polygons: [sq, sq, sq] })];
  assert.equal(addPolygon(full, full[0].id, sq, 6), full);
  assert.equal(addPolygon(sets, sets[0].id, [[1, 2], [3, 4]], 6), sets);
  assert.equal(addPolygon(sets, sets[0].id, Array.from({ length: 201 }, (_, i) => [i / 1000, 1] as LL), 6), sets);
});

test('saved sets: anything that is not a list is no sets', () => {
  for (const v of [null, 'x', {}, 7]) assert.deepEqual(sanitizeSets(v), []);
});

test('saved sets: broken items are fixed or dropped, never thrown on', () => {
  const sq = square(33, 35);
  const raw = [
    { id: 'a', name: 'n'.repeat(100), color: SET_COLORS[0], enabled: true, filter: { ...EMPTY_SET_FILTER, preset: 'bogus', polygons: [[[1, 2], [3, 4]], [[NaN, 1], [2, 3], [4, 5]], sq, sq, sq, sq] }, text: 'abc' },
    { name: 'no id' },
    { id: 'b', color: 'red' },
    { id: 'a', name: 'duplicate' },
  ];
  const out = sanitizeSets(raw);
  assert.equal(out.length, 2);
  assert.equal(out[0].name.length, 40);
  assert.equal(out[0].filter.preset, 'live');
  assert.equal(out[0].filter.polygons.length, 3);
  assert.equal(out[0].text, 'abc');
  assert.equal(out[1].id, 'b');
  assert.deepEqual(out[1].filter, EMPTY_SET_FILTER);
  assert.ok(SET_COLORS.includes(out[1].color));
  assert.notEqual(out[1].color, out[0].color);
  assert.equal(out[1].enabled, true);
});

test('saved sets: at most 6 are kept', () => {
  const many = Array.from({ length: 50 }, (_, i) => ({ id: `x${i}`, name: 'n', color: SET_COLORS[0], enabled: true, filter: EMPTY_SET_FILTER }));
  assert.equal(sanitizeSets(many).length, 6);
});
