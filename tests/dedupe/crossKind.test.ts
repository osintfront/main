// Run: node --experimental-strip-types --test tests/dedupe/crossKind.test.ts
//
// 13 Nov: one report filed under two kinds stayed two events, because a pair across kinds
// (statement vs drone, statement vs military activity) needed headlines 0.6 alike:
// - CENTCOM: two IRGC drones launched toward Bahrain shot down — "statements" (13:01) and
//   "drone" (12:57), both under Bahrain, headlines 0.40 alike;
// - Maj. Gen. Vahidi attends the funeral of the unknown martyrs — "statements" (06:58) and
//   "military-activity" (08:13), both under Iran, 0.31 alike.
// Within one country the usual twin bar (0.3) now crosses kinds; the strong model still decides.
import test from 'node:test';
import assert from 'node:assert/strict';
import { focusedBatches, textTwin } from '../../supabase/functions/_shared/dedupeMatch.ts';

const slug = new Map([['c-st', 'statements'], ['c-mil', 'military-activity'], ['c-dr', 'drone'], ['c-air', 'airstrike']]);
let n = 0;
const ev = (o: { title: string; en?: string; cat: string; country: string | null; at: string; split_from?: string }) => ({
  id: `x${++n}`, title: o.title, translations: o.en ? { en: { title: o.en } } : {}, category_id: o.cat,
  country: o.country, occurred_at: o.at, created_at: o.at, ai_suggestions: o.split_from ? { split_from: o.split_from } : {},
});

const centcomDrone = () => ev({ title: 'פיקוד המרכז האמריקאי: הפלנו שני כטב"מים של משמרות המהפכה שנשלחו לעבר בחריין', en: 'CENTCOM: We shot down two IRGC drones launched toward Bahrain', cat: 'c-dr', country: 'Bahrain', at: '2026-11-13T12:57:00Z' });
const centcomStatement = () => ev({ title: 'סנטקום טוען: שני כטב"מים איראניים לעבר בחריין יורטו', en: 'CENTCOM claims two Iranian drones launched toward Bahrain were shot down', cat: 'c-st', country: 'Bahrain', at: '2026-11-13T13:01:00Z' });
const vahidiStatement = () => ev({ title: 'אלוף וחידי השתתף בטקס הלוויית "השהידים האלמונים"', en: 'Maj. Gen. Vahidi attends funeral ceremony for unknown martyrs', cat: 'c-st', country: 'Iran', at: '2026-11-13T06:58:00Z' });
const vahidiMilitary = () => ev({ title: 'מפקד משמרות המהפכה, האלוף וחידי, נכח בטקס הלוויה של חללי "ההגנה הקדושה" האלמונים', en: 'IRGC commander Maj. Gen. Vahidi attends funeral of unidentified Sacred Defense martyrs', cat: 'c-mil', country: 'Iran', at: '2026-11-13T08:13:00Z' });

test('one report filed under two kinds in the same country is a twin (CENTCOM drones, Bahrain)', () => {
  assert.equal(textTwin(centcomStatement(), centcomDrone(), slug), true);
});

test('one report filed under two kinds in the same country is a twin (Vahidi at the funeral, Iran)', () => {
  assert.equal(textTwin(vahidiMilitary(), vahidiStatement(), slug), true);
});

test('the cross-kind twin is shortlisted for the focused pass', () => {
  const old = centcomDrone(), fresh = centcomStatement();
  const [b] = focusedBatches(new Set([fresh.id]), [old, fresh], slug);
  assert.ok(b, 'asked');
  assert.deepEqual(b.groups[0].candidates, [old.id]);
});

test('across kinds, another country still needs a near-identical headline', () => {
  const a = centcomDrone();
  const b = { ...centcomStatement(), country: 'United States' };
  assert.equal(textTwin(a, b, slug), false);
});

test('across kinds, an unknown country is not "the same country"', () => {
  const a = { ...centcomDrone(), country: null };
  const b = { ...centcomStatement(), country: null };
  assert.equal(textTwin(a, b, slug), false);
});

test('across kinds, a loose match (below 0.3) in the same country is not a twin', () => {
  const a = ev({ title: 'תקיפה אווירית בחאן יונס', cat: 'c-air', country: 'Palestine', at: '2026-11-12T08:00:00Z' });
  const b = ev({ title: 'חמאס מגנה את התקיפה בחאן יונס ומאיים בתגובה', cat: 'c-st', country: 'Palestine', at: '2026-11-12T08:10:00Z' });
  assert.equal(textTwin(a, b, slug), false);
});

test('across kinds, the time window still holds (a strike: 6 h)', () => {
  const a = ev({ title: 'תקיפה אווירית בחאן יונס', cat: 'c-air', country: 'Palestine', at: '2026-11-12T08:00:00Z' });
  const b = ev({ title: 'דובר: תקיפה אווירית בחאן יונס', cat: 'c-st', country: 'Palestine', at: '2026-11-12T15:00:00Z' });
  assert.equal(textTwin(a, b, slug), false);
});
