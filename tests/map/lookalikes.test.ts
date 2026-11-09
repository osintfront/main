// Run: node --experimental-strip-types --test tests/map/lookalikes.test.ts
//
// One incident reported by several sources can slip past the dedupe agent. Both events stay in
// the feed, but on the map close look-alikes share one pin ("2 reports"): same category, main
// pins within ~2 km, within 3 hours, and headlines that mostly share their words. Nothing is
// merged or deleted, and no distinct pin is lost.
import test from 'node:test';
import assert from 'node:assert/strict';
import { groupLookalikes } from '../../src/lib/lookalikes.ts';
import type { PublicEvent } from '../../src/types/event.ts';

let n = 0;
const ev = (over: Partial<PublicEvent> & { en?: string }): PublicEvent => {
  const { en, ...rest } = over;
  return {
    id: `e${++n}`,
    title: en ?? 'x',
    latitude: 33.1,
    longitude: 35.3,
    locationPrecision: 'city',
    occurredAt: '2026-11-09T10:00:00Z',
    category: { slug: 'artillery-shelling' },
    translations: { en: { title: en ?? 'x' } },
    places: [],
    reportGroup: null,
    ...rest,
  } as unknown as PublicEvent;
};

test('two reports of one shelling share a pin; the earlier one keeps it', () => {
  const a = ev({ en: 'Israeli artillery shells Al-Mansouri in Tyre District', occurredAt: '2026-11-09T10:00:00Z' });
  const b = ev({ en: 'Report: Israeli artillery shells Al-Mansouri in Tyre district', occurredAt: '2026-11-09T11:14:00Z', longitude: 35.31 });
  const g = groupLookalikes([b, a]);
  assert.equal(g.pinOf(b.id), a.id);
  assert.equal(g.pinOf(a.id), a.id);
  assert.equal(g.reports(a.id), 2);
  assert.equal(g.hidden.has(b.id), true);
});

test('different category, place, time or headline: separate pins', () => {
  const base = ev({ en: 'Israeli artillery shells Al-Mansouri in Tyre District' });
  const otherCat = ev({ en: base.translations.en!.title, category: { slug: 'airstrike' } as PublicEvent['category'] });
  const far = ev({ en: base.translations.en!.title, latitude: 33.2 });
  const late = ev({ en: base.translations.en!.title, occurredAt: '2026-11-09T13:30:00Z' });
  const otherNews = ev({ en: 'Drone strike on a car near Bint Jbeil' });
  const g = groupLookalikes([base, otherCat, far, late, otherNews]);
  for (const e of [otherCat, far, late, otherNews]) assert.equal(g.pinOf(e.id), e.id, e.id);
  assert.equal(g.reports(base.id), 1);
  assert.equal(g.hidden.size, 0);
});

test('events split from one report are never grouped', () => {
  const a = ev({ en: 'Strikes on Al-Mansouri and Majdal Zoun', reportGroup: 'r1' });
  const b = ev({ en: 'Strikes on Al-Mansouri and Majdal Zoun', reportGroup: 'r1' });
  assert.equal(groupLookalikes([a, b]).hidden.size, 0);
});

test('an event with extra places of its own keeps its pins', () => {
  const a = ev({ en: 'Israeli artillery shells Al-Mansouri and Majdal Zoun' });
  const b = ev({
    en: 'Israeli artillery shells Al-Mansouri and Majdal Zoun',
    occurredAt: '2026-11-09T10:30:00Z',
    places: [{ index: 0, name: 'Majdal Zoun', nameEn: 'Majdal Zoun', latitude: 33.15, longitude: 35.25, precision: 'city', categorySlug: null }],
  });
  assert.equal(groupLookalikes([a, b]).hidden.has(b.id), false);
});

test('unpinned events are left alone', () => {
  const a = ev({ en: 'Statement by the foreign minister', locationPrecision: null, latitude: 0, longitude: 0 });
  const b = ev({ en: 'Statement by the foreign minister', locationPrecision: null, latitude: 0, longitude: 0 });
  assert.equal(groupLookalikes([a, b]).hidden.size, 0);
});

test('a chain of look-alikes cannot drift: each member stays close to the first report', () => {
  // a → b (2.5 h) and b → c (2.5 h) look alike, but c is 5 h after a: c gets its own pin.
  const a = ev({ en: 'Israeli artillery shells Al-Mansouri', occurredAt: '2026-11-09T10:00:00Z' });
  const b = ev({ en: 'Israeli artillery shells Al-Mansouri', occurredAt: '2026-11-09T12:30:00Z' });
  const c = ev({ en: 'Israeli artillery shells Al-Mansouri', occurredAt: '2026-11-09T15:00:00Z' });
  const g = groupLookalikes([a, b, c]);
  assert.equal(g.pinOf(b.id), a.id);
  assert.equal(g.pinOf(c.id), c.id);
  assert.equal(g.reports(a.id), 2);
});

test('three reports form one group of 3', () => {
  const a = ev({ en: 'Hostile drone flying over Beirut southern suburbs', category: { slug: 'uav' } as PublicEvent['category'] });
  const b = ev({ en: 'Drone flying over Beirut southern suburbs', category: { slug: 'uav' } as PublicEvent['category'], occurredAt: '2026-11-09T10:40:00Z' });
  const c = ev({ en: 'Hostile drone over Beirut southern suburbs', category: { slug: 'uav' } as PublicEvent['category'], occurredAt: '2026-11-09T11:20:00Z' });
  const g = groupLookalikes([c, b, a]);
  assert.equal(g.reports(a.id), 3);
  assert.deepEqual([g.pinOf(b.id), g.pinOf(c.id)], [a.id, a.id]);
});
