// Run: node --experimental-strip-types --test tests/filters/setsMinors.test.ts
// Filter sets: default names never repeat; "Clear all" leaves sets past the plan's limit as they were.
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultSetName, switchOffSets, newSet, type FilterSet } from '../../src/lib/filterSets.ts';

const make = (n: number) => `Set ${n}`;
const named = (...names: string[]): FilterSet[] => names.reduce<FilterSet[]>((a, n) => [...a, newSet(a, n)], []);

test('the first free number, never a name in use', () => {
  assert.equal(defaultSetName([], make), 'Set 1');
  assert.equal(defaultSetName(named('Set 1', 'Set 2'), make), 'Set 3');
  // "Set 1" was deleted: 2 sets left, but "Set 3" exists — no second "Set 3".
  assert.equal(defaultSetName(named('Set 2', 'Set 3'), make), 'Set 1');
  assert.equal(defaultSetName(named('Set 1', 'Set 3'), make), 'Set 2');
  assert.equal(defaultSetName(named('Jordan', 'Set 2'), make), 'Set 1');
});

test('renaming a set to blank: its own old name does not count', () => {
  const sets = named('Set 1', 'Set 2');
  assert.equal(defaultSetName(sets, make, sets[1].id), 'Set 2');
});

test('"Clear all" switches off only the sets within the plan limit', () => {
  const sets = named('a', 'b', 'c');
  const out = switchOffSets(sets, 2);
  assert.deepEqual(out.map((s) => s.enabled), [false, false, true]);
  assert.equal(switchOffSets(out, 2), out, 'nothing to switch off → same array');
});

test('country counts inside a set with a drawn area count the whole country', async () => {
  const { panelMatcher } = await import('../../src/lib/filterSets.ts');
  const { EMPTY_FILTERS } = await import('../../src/lib/eventFilters.ts');
  const now = Date.now();
  const at = new Date(now - 3600_000).toISOString();
  const base = { id: 'x', title: 'T', description: '', severity: 'high', locationName: '', locationPrecision: 'city', region: '', city: '', sourceName: null, sourceUrl: null, sourceType: 'other', occurredAt: at, publishedAt: null, isBreaking: false, isVerified: false, category: { id: null, slug: 'airstrike', name: 'Airstrike', icon: '', color: '', markerColor: '' }, translations: {} };
  // deno-lint-ignore no-explicit-any
  const tyre: any = { ...base, latitude: 33.27, longitude: 35.2, country: 'Lebanon' };
  // deno-lint-ignore no-explicit-any
  const amman: any = { ...base, latitude: 31.95, longitude: 35.93, country: 'Jordan' };
  const area: [number, number][] = [[33.0, 35.0], [33.0, 35.4], [33.5, 35.4], [33.5, 35.0]]; // around Tyre only
  const m = panelMatcher([area], now);
  const f = { ...EMPTY_FILTERS, areas: [] };
  // Choosing a country adds its events (country OR drawn area): Jordan's count must include Amman.
  assert.equal(m(amman, f, true), true);
  assert.equal(m(tyre, f, true), true);
  // Other counts keep the place: Amman is outside the set's place.
  assert.equal(m(amman, f, false), false);
  assert.equal(m(tyre, f, false), true);
  // The general filter (no set) is unchanged.
  assert.equal(panelMatcher(undefined, now)(amman, f, true), true);
});
