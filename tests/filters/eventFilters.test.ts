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
