// Run: node --experimental-strip-types --test tests/dedupe/samePlace.test.ts
//
// 14 Nov 2026: sigintt's "ISR drone activity in the highlighted areas of Iran" (and its map) was
// hung on Rubio's statement about Iran, because both were pinned on the whole country "Iran"
// within the hour. A whole country (or region) is not "the same place".
import test from 'node:test';
import assert from 'node:assert/strict';
import { narrowPlaceKeys as placeKeys, samePlaceEvent } from '../../supabase/functions/_shared/samePlace.ts';

const at = new Date('2026-11-14T00:54:10Z');
const ev = (id: string, location_name: string, place_en: string, occurred_at = '2026-11-14T00:21:27Z') =>
  ({ id, location_name, occurred_at, ai_suggestions: { place_en } });

test('a whole country is not the same place (the Rubio / sigintt case)', () => {
  const rubio = ev('rubio', 'Iran', 'Iran');
  assert.equal(samePlaceEvent([rubio], placeKeys('ایران', 'Iran'), at), null);
  assert.equal(samePlaceEvent([rubio], placeKeys('איראן', 'Iran'), at), null);
  assert.equal(samePlaceEvent([ev('l', 'لبنان', 'Lebanon')], placeKeys('Lebanon'), at), null);
  assert.equal(samePlaceEvent([ev('m', 'Middle East', 'Middle East')], placeKeys('המזרח התיכון', 'Middle East'), at), null);
});

test('a town still matches within the hour', () => {
  const e = ev('k', 'كفركلا', 'Kafr Kila');
  assert.equal(samePlaceEvent([e], placeKeys('כפר כילא', 'Kafr Kila'), at)?.id, 'k');
});

test('a town matches even when one side also names the country', () => {
  const e = ev('i', 'Isfahan', 'Isfahan');
  assert.equal(samePlaceEvent([e], placeKeys('Iran', 'Isfahan'), at)?.id, 'i');
});

test('still nothing after an hour', () => {
  const e = ev('k', 'Kafr Kila', 'Kafr Kila', '2026-11-13T23:40:00Z');
  assert.equal(samePlaceEvent([e], placeKeys('Kafr Kila'), at), null);
});

test('Tyre ("Sur") is a town, not Syria — and Syria never matches it', () => {
  assert.equal(samePlaceEvent([ev('t', 'صور', 'Sur')], placeKeys('צור', 'Sur'), at)?.id, 't');
  assert.equal(samePlaceEvent([ev('s', 'سوريا', 'Syria')], placeKeys('צור', 'Sur'), at), null);
});
