// Run: node --experimental-strip-types --test tests/filters/pushFilters.test.ts
// Phone notifications follow what the site shows: with filter sets in force, the saved push filter
// is the sets (any of them), not the paused general filter (bug: it was null → every event).
import test from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_FILTERS, matchesPushFilters } from '../../src/lib/eventFilters.ts';
import { EMPTY_SET_FILTER, pushFilters, type FilterSet } from '../../src/lib/filterSets.ts';
import type { PublicEvent } from '../../src/types/event.ts';

const now = Date.parse('2026-11-14T03:00:00Z');
const ev = (slug: string) =>
  ({ id: slug, occurredAt: '2026-11-14T02:59:00Z', category: { slug }, secondaryCategories: [], severity: 'high', title: 'x', country: 'Israel', locationName: '', latitude: 32.08, longitude: 34.78, locationPrecision: 'exact', places: [], mediaKinds: [] }) as unknown as PublicEvent;
const set = (categories: string[]): FilterSet => ({ id: 's1', name: 'a', color: '#000', enabled: true, filter: { ...EMPTY_SET_FILTER, categories } });

test('sets in force + "only what is filtered" → the sets are saved, not null', () => {
  const saved = pushFilters('filtered', EMPTY_FILTERS, [set(['airstrike'])]);
  assert.ok(saved && 'sets' in saved);
  assert.equal(matchesPushFilters(ev('airstrike'), saved, now), true);
  assert.equal(matchesPushFilters(ev('fire'), saved, now), false);
});

test('an event in any one of the sets passes', () => {
  const saved = pushFilters('filtered', EMPTY_FILTERS, [set(['airstrike']), { ...set(['fire']), id: 's2' }]);
  assert.equal(matchesPushFilters(ev('fire'), saved, now), true);
  assert.equal(matchesPushFilters(ev('drone'), saved, now), false);
});

test('scope "all" → null (every event), also with sets', () => {
  assert.equal(pushFilters('all', { ...EMPTY_FILTERS, categories: ['fire'] }, [set(['airstrike'])]), null);
});

test('no sets: the general filter as before; empty general filter → null', () => {
  assert.equal(pushFilters('filtered', EMPTY_FILTERS, []), null);
  const g = pushFilters('filtered', { ...EMPTY_FILTERS, categories: ['fire'] }, []);
  assert.equal(matchesPushFilters(ev('fire'), g, now), true);
  assert.equal(matchesPushFilters(ev('airstrike'), g, now), false);
});

test('null saved filter → every event; a set time range does not block live pushes', () => {
  assert.equal(matchesPushFilters(ev('fire'), null, now), true);
  const saved = pushFilters('filtered', EMPTY_FILTERS, [{ ...set(['fire']), filter: { ...EMPTY_SET_FILTER, categories: ['fire'], preset: '1h' } }]);
  assert.equal(matchesPushFilters({ ...ev('fire'), occurredAt: '2026-11-13T20:00:00Z' } as PublicEvent, saved, now), true);
});
