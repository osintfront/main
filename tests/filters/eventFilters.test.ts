// Run: node --experimental-strip-types --test tests/filters/eventFilters.test.ts
//
// Saved filters are cleaned before use: whatever is in the browser's storage, the map gets a
// valid filter (sanitizeFilters, shared by the general filter and the filter sets).
import test from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_FILTERS, sanitizeFilters } from '../../src/lib/eventFilters.ts';

test('not an object → the empty filter', () => {
  assert.deepEqual(sanitizeFilters(null), EMPTY_FILTERS);
  assert.deepEqual(sanitizeFilters('x'), EMPTY_FILTERS);
});

test('a valid filter comes back as it was', () => {
  const f = { ...EMPTY_FILTERS, preset: '7d', areas: ['lebanon'], categories: ['uav'], breakingOnly: true, polygon: [[1, 2], [3, 4], [5, 6]] };
  assert.deepEqual(sanitizeFilters(f), f);
});

test('wrong values are cleaned', () => {
  const out = sanitizeFilters({ areas: ['lebanon', 5], preset: 'nope', polygon: [[1, 2]] });
  assert.deepEqual(out.areas, ['lebanon']);
  assert.equal(out.preset, 'live');
  assert.equal(out.polygon, null);
  assert.equal(sanitizeFilters({ breakingOnly: 'yes' }).breakingOnly, false);
});

// ─── Secondary event types ─────────────────────────────────────────────────────
// deno-lint-ignore no-explicit-any
const sev = (over: Record<string, unknown> = {}): any => ({
  id: 'e1', title: 'T', description: '', severity: 'high', latitude: 33.27, longitude: 35.2, locationName: 'Tyre',
  locationPrecision: 'city', country: 'Lebanon', region: '', city: '', sourceName: null, sourceUrl: null, sourceType: 'other',
  occurredAt: new Date(Date.now() - 3600_000).toISOString(), publishedAt: null, isBreaking: false, isVerified: false,
  category: { id: null, slug: 'uav', name: 'UAV', icon: '', color: '', markerColor: '' }, translations: {},
  ...over,
});
const K = sev({ category: { slug: 'killed' }, secondaryCategories: [{ slug: 'airstrike' }] });

test('event types: main first, secondary when asked', async () => {
  const { eventCategorySlugs } = await import('../../src/lib/eventFilters.ts');
  assert.deepEqual(eventCategorySlugs(K, true), ['killed', 'airstrike']);
  assert.deepEqual(eventCategorySlugs(K, false), ['killed']);
  assert.deepEqual(eventCategorySlugs(sev(), true), ['uav']);
});

test('type filter matches secondary types unless main only', async () => {
  const { matchesFilters, activeFilterCount } = await import('../../src/lib/eventFilters.ts');
  assert.equal(matchesFilters(K, { ...EMPTY_FILTERS, preset: '7d', categories: ['airstrike'] }), true);
  assert.equal(matchesFilters(K, { ...EMPTY_FILTERS, preset: '7d', categories: ['airstrike'], mainOnly: true }), false);
  assert.equal(matchesFilters(K, { ...EMPTY_FILTERS, preset: '7d', categories: ['killed'], mainOnly: true }), true);
  assert.equal(activeFilterCount({ ...EMPTY_FILTERS, mainOnly: true }), 0);
});

test('main only is cleaned', () => {
  assert.equal(sanitizeFilters({ categories: ['uav'] }).mainOnly, false);
  assert.equal(sanitizeFilters({ mainOnly: 'yes' }).mainOnly, false);
  assert.equal(sanitizeFilters({ mainOnly: true }).mainOnly, true);
});
