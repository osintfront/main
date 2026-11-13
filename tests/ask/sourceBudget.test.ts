// Run: node --experimental-strip-types --test tests/ask/sourceBudget.test.ts
// "Ask the map": which events go with the long original report (900 chars) — on a follow-up the events
// already shown come first, and fresh results still get their share of the long slots.
import test from 'node:test';
import assert from 'node:assert/strict';
import { longSource } from '../../supabase/functions/_shared/askInput.ts';

const longs = (prev: number, total: number) => Array.from({ length: total }, (_, i) => i).filter((i) => longSource(i, prev));

test('a first question: the first 40', () => {
  assert.deepEqual(longs(0, 60), Array.from({ length: 40 }, (_, i) => i));
});

test('a follow-up with 80 events already shown: 20 of them and the first 20 fresh', () => {
  const l = longs(80, 120);
  assert.equal(l.length, 40);
  assert.equal(l.filter((i) => i < 80).length, 20);
  assert.deepEqual(l.filter((i) => i >= 80), Array.from({ length: 20 }, (_, i) => 80 + i));
});

test('few events already shown: the rest of the 40 go to fresh ones', () => {
  const l = longs(5, 100);
  assert.equal(l.length, 40);
  assert.deepEqual(l.slice(0, 5), [0, 1, 2, 3, 4]);
  assert.equal(l[l.length - 1], 39);
});
