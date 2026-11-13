// Run: node --experimental-strip-types --test tests/dedupe/signals.test.ts
//
// 13 Nov: the families' protest outside the UN base in Nabaa al-Fawar (11:49) and, eight hours
// later from another channel, "families of Syrians held by Israel appeal at Nabaa al-Fawwar"
// (20:05) stayed two events. Their headlines share little (0.116 < 0.12: "abductees" vs
// "detainees", Fawar vs Fawwar), but both carry the same place, نبع الفوار, and all three of
// the new event's photos are photos of the old one (0–2 bits apart). Pictures and the place are
// now signals too.
import test from 'node:test';
import assert from 'node:assert/strict';
import { focusedBatches, pictureTwin, samePicture, samePlace, couldBeSame } from '../../supabase/functions/_shared/dedupeMatch.ts';

const slug = new Map([['c-pr', 'protest-civil-unrest'], ['c-hum', 'humanitarian-event'], ['c-art', 'artillery-shelling']]);
let n = 0;
const ev = (o: any) => ({
  id: `s${++n}`, title: o.title, translations: o.en ? { en: { title: o.en } } : {}, category_id: o.cat ?? 'c-pr',
  country: o.country ?? 'Syria', occurred_at: o.at, created_at: o.created ?? o.at, ai_suggestions: o.split_from ? { split_from: o.split_from } : {},
  location_name: o.place ?? null, pictures: o.pictures ?? [],
});

const morning = () => ev({
  title: 'עצרת מחאה של משפחות נחטפים מול מפקדת אונדו"ף בכפר נבע אל-פוואר שבאזור קוניטרה',
  en: 'Protest vigil by families of abductees outside UNDOF headquarters in Nabaa al-Fawar, Quneitra countryside',
  at: '2026-11-13T09:49:16Z', place: 'نبع الفوار',
  pictures: ['64640c3c28297b71', '371a194d5d97ca8a', 'a4ec545c5e13734a', 'bf3a2cc82aa99999'],
});
const evening = () => ev({
  title: 'בני משפחות עצורים סורים בישראל קוראים בנבע אל-פוואר לפעול לשחרורם',
  en: 'Families of Syrians held by Israel appeal at Nabaa al-Fawwar for their release',
  at: '2026-11-13T18:05:08Z', place: 'نبع الفوار',
  pictures: ['371a194d5f97ca8a', 'a4ec545c5e13734a', 'bf3a2cc82a899999'],
});

test('the same photo re-saved by another channel is the same picture; a different one is not', () => {
  assert.equal(samePicture(morning(), evening()), true);
  assert.equal(samePicture(morning(), ev({ title: 'x', at: '2026-11-13T10:00:00Z', pictures: ['0000000000000000'] })), false);
  assert.equal(samePicture(morning(), ev({ title: 'x', at: '2026-11-13T10:00:00Z' })), false);
});

test('the same place is matched across spellings of the Arabic article and spaces', () => {
  assert.equal(samePlace(morning(), evening()), true);
  assert.equal(samePlace(ev({ title: 'a', at: '2026-11-13T10:00:00Z', place: 'الفوار' }), ev({ title: 'b', at: '2026-11-13T10:00:00Z', place: 'فوار' })), true);
  assert.equal(samePlace(morning(), ev({ title: 'x', at: '2026-11-13T10:00:00Z', place: 'القنيطرة' })), false);
  assert.equal(samePlace(ev({ title: 'a', at: '2026-11-13T10:00:00Z' }), ev({ title: 'b', at: '2026-11-13T10:00:00Z' })), false);
});

test('the Nabaa al-Fawar pair is shortlisted (first, marked "same photo") despite headline 0.116', () => {
  const m = morning(), e = evening();
  const others = Array.from({ length: 12 }, (_, i) => ev({ title: `מחאה ${i} של תושבים בעיר אחרת לגמרי ${i}`, at: '2026-11-13T12:00:00Z', place: `עיר ${i}` }));
  const [b] = focusedBatches(new Set([e.id]), [m, ...others, e], slug, { perEvent: 8 });
  assert.ok(b, 'asked');
  assert.equal(b.groups[0].candidates[0], m.id);
  const no = b.rows.findIndex((r) => r.id === m.id) + 1;
  assert.match(b.compare, new RegExp(`\\[${no}\\] \\(same photo\\)`));
});

test('a shared photo lets kinds differ (protest vs humanitarian), within the time window', () => {
  const m = morning();
  const e = { ...evening(), category_id: 'c-hum' };
  assert.equal(couldBeSame(m, e, slug), false);
  assert.equal(pictureTwin(m, e, slug), true);
  const late = { ...e, occurred_at: '2026-11-14T12:00:00Z' };
  assert.equal(pictureTwin(m, late, slug), false);
  const sib = { ...e, ai_suggestions: { split_from: m.id } };
  assert.equal(pictureTwin(m, sib, slug), false);
});

test('same-place look-alikes with weak headlines: at most two per NEW event', () => {
  const fresh = ev({ title: 'ירי בעיר עזה', en: 'Shooting in Gaza City', at: '2026-11-13T12:00:00Z', place: 'مدينة غزة', cat: 'c-art', country: 'Palestine' });
  const near = Array.from({ length: 6 }, (_, i) => ev({ title: `אירוע אחר לגמרי מספר ${i}`, at: `2026-11-13T1${i}:00:00Z`, place: 'مدينة غزة', cat: 'c-art', country: 'Palestine' }));
  const batches = focusedBatches(new Set([fresh.id]), [...near, fresh], slug, { perEvent: 8 });
  assert.equal(batches.length, 1);
  assert.equal(batches[0].groups[0].candidates.length, 2);
});
