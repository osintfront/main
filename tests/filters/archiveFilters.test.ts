// Run: node --experimental-strip-types --test tests/filters/archiveFilters.test.ts
// The archive page shows one chosen day; the visitor's time filter must not hide it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_FILTERS, archiveFilters, matchesFilters } from '../../src/lib/eventFilters.ts';
import type { PublicEvent } from '../../src/types/event.ts';

const now = Date.parse('2026-11-13T10:00:00Z');
const ev = (iso: string) => ({ id: 'e', occurredAt: iso, category: 'airstrike', severity: 'medium', title: 'x', country: '', locationName: '', lat: 32, lng: 35 }) as unknown as PublicEvent;

test('an event from three days ago passes in the archive', () => {
  for (const preset of ['live', '1h', '24h', '7d'] as const) {
    const f = archiveFilters({ ...EMPTY_FILTERS, preset });
    assert.equal(matchesFilters(ev('2026-11-10T08:00:00Z'), f, now), true, preset);
  }
});

test('other filters still apply in the archive', () => {
  const f = archiveFilters({ ...EMPTY_FILTERS, categories: ['killed'] });
  assert.equal(matchesFilters(ev('2026-11-10T08:00:00Z'), f, now), false);
});
