// Run: node --experimental-strip-types --test tests/ask/statsMerge.test.ts
//
// Statistics dashboard — the counting engine's first half: cleaning the model's classification of a
// batch, and merging the events that fit into distinct incidents (repeat reports count once).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanClassified, mergeIncidents, reportCount, type Classified, type StatsEvent } from '../../supabase/functions/_shared/askStatsCore.ts';

const T0 = Date.parse('2026-11-12T08:00:00Z');
// Quneitra; 0.018° latitude ≈ 2 km, 0.072° ≈ 8 km.
const LAT = 33.125, LNG = 35.824;
function ev(id: string, minute: number, over: Partial<Classified> = {}): Classified {
  return {
    id, occurred_at: new Date(T0 + minute * 60_000).toISOString(), title: `t-${id}`, title_en: null, description: '',
    category_slug: 'airstrike', country: 'Syria', location_name: 'Quneitra', latitude: LAT, longitude: LNG,
    location_precision: 'exact', source_count: 0, fits: 'yes', actor: '', target: '', place: '', incident: '', ...over,
  };
}
const groups = (xs: Classified[]) => mergeIncidents(xs, 'he').map((i) => i.ids);

test('cleanClassified: missing, repeated, out of range and unknown fits are unsure', () => {
  const batch: StatsEvent[] = [ev('a', 0), ev('b', 1), ev('c', 2)];
  const out = cleanClassified(batch, { items: [
    { n: 1, fits: 'yes', actor: 'Israel', target: 'Syria', place: 'Quneitra', incident: 'x' },
    { n: 1, fits: 'no' }, { n: 9, fits: 'yes' }, { n: 3, fits: 'maybe' },
  ] });
  assert.deepEqual(out.map((x) => x.fits), ['yes', 'unsure', 'unsure']);
  assert.deepEqual(out.map((x) => x.id), ['a', 'b', 'c']);
  assert.equal(out[0].actor, 'Israel');
  for (const raw of [null, 'x', {}]) assert.deepEqual(cleanClassified(batch, raw).map((x) => x.fits), ['unsure', 'unsure', 'unsure']);
  assert.equal(cleanClassified([ev('a', 0)], { items: [{ n: 1, fits: 'yes', place: 'p'.repeat(500) }] })[0].place.length, 80);
});

test('reportCount: the event itself plus its merged sources', () => {
  assert.equal(reportCount(0), 1);
  assert.equal(reportCount(2), 3);
  assert.equal(reportCount(-1), 1);
});

test('a. repeat reports 2 km and 20 minutes apart are one incident', () => {
  const r = mergeIncidents([ev('b', 20, { latitude: LAT + 0.018 }), ev('a', 0)], 'he');
  assert.equal(r.length, 1);
  assert.deepEqual(r[0].ids, ['a', 'b']);
  assert.equal(r[0].reports, 2);
  assert.equal(r[0].at, ev('a', 0).occurred_at);
  assert.equal(r[0].n, 1);
});

test('b. an event the dedupe agent already merged counts all its reports', () => {
  assert.equal(mergeIncidents([ev('a', 0, { source_count: 3 })], 'he')[0].reports, 4);
});

test('c. 8 km apart with different names are two incidents', () => {
  assert.equal(mergeIncidents([ev('a', 0), ev('b', 10, { latitude: LAT + 0.072, location_name: 'Khan Arnabah' })], 'he').length, 2);
});

test('d. the 60-minute window', () => {
  assert.equal(mergeIncidents([ev('a', 0), ev('b', 60)], 'he').length, 1);
  assert.equal(mergeIncidents([ev('a', 0), ev('b', 61)], 'he').length, 2);
});

test('e. names in two scripts merge through a shared key; different towns do not', () => {
  const noPin = { latitude: null, longitude: null };
  assert.equal(mergeIncidents([ev('a', 0, { ...noPin, location_name: 'الخيام', place: 'Khiam' }), ev('b', 5, { ...noPin, location_name: 'Khiam' })], 'he').length, 1);
  assert.equal(mergeIncidents([ev('a', 0, { ...noPin, location_name: 'Khiam' }), ev('b', 5, { ...noPin, location_name: 'Bint Jbeil' })], 'he').length, 2);
});

test('f. country-level pins are never merged by distance or by the country name', () => {
  const c = { location_precision: 'country', location_name: 'Syria', latitude: 35, longitude: 38 };
  assert.equal(mergeIncidents([ev('a', 0, c), ev('b', 5, c)], 'he').length, 2);
});

test('g. different actors stay apart; one empty actor does not', () => {
  assert.equal(mergeIncidents([ev('a', 0, { actor: 'Israel' }), ev('b', 0, { actor: 'Hezbollah' })], 'he').length, 2);
  assert.equal(mergeIncidents([ev('a', 0, { actor: 'Israel' }), ev('b', 0, { actor: '' })], 'he').length, 1);
});

test('h. kinds: statements never join strikes; strike and shelling may', () => {
  assert.equal(mergeIncidents([ev('a', 0, { category_slug: 'statements' }), ev('b', 0)], 'he').length, 2);
  assert.equal(mergeIncidents([ev('a', 0), ev('b', 0, { category_slug: 'artillery-shelling' })], 'he').length, 1);
});

test('i. no chaining: an event joins only an incident whose earliest event is close', () => {
  assert.deepEqual(groups([ev('a', 0), ev('b', 50), ev('c', 100)]), [['a', 'b'], ['c']]);
});

test('j. only events that fit are counted', () => {
  const ids = mergeIncidents([ev('a', 0), ev('b', 200, { fits: 'no' }), ev('c', 400, { fits: 'unsure' })], 'he').flatMap((i) => i.ids);
  assert.deepEqual(ids, ['a']);
});

test('k. deterministic: order of input does not matter, n follows time', () => {
  const xs = [ev('a', 0), ev('b', 90), ev('c', 10), ev('d', 300, { latitude: LAT + 0.072, location_name: 'Hermon' }), ev('e', 95)];
  const one = mergeIncidents(xs, 'he');
  assert.deepEqual(mergeIncidents([...xs].reverse(), 'he'), one);
  assert.deepEqual(mergeIncidents([xs[3], xs[0], xs[4], xs[1], xs[2]], 'he'), one);
  assert.deepEqual(one.map((i) => i.n), [1, 2, 3]);
  assert.ok(one[0].at < one[1].at && one[1].at < one[2].at);
});

test('l. the incident title follows the language', () => {
  assert.equal(mergeIncidents([ev('a', 0, { title: 'כותרת', title_en: 'Title' })], 'en')[0].title, 'Title');
  assert.equal(mergeIncidents([ev('a', 0, { title: 'כותרת' })], 'en')[0].title, 'כותרת');
  assert.equal(mergeIncidents([ev('a', 0, { title: 'כותרת', title_en: 'Title' })], 'he')[0].title, 'כותרת');
});
