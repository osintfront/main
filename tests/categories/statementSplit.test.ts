// Run: node --experimental-strip-types --test tests/categories/statementSplit.test.ts
//
// A statement names places: where it was said, past strikes, threats, an attack it condemns.
// The editor sometimes tags those places with a strike kind, and the split then made a fake
// incident of each ("Airstrike: Asaluyeh, Tehran" out of Pezeshkian's COP31 speech; "Small-arms
// fire: Krakow" out of a Russian travel warning) and replaced the statement's headline with
// "Statements: <place>". A statement is never split: its places are mentions of it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mentionsOnly, MENTION_ONLY_MAIN } from '../../supabase/functions/_shared/secondaryCats.ts';

test('statements are the only mention-only main type', () => {
  assert.deepEqual(MENTION_ONLY_MAIN, ['statements']);
});

test("a statement's strike-tagged places become mentions of the statement", () => {
  const places = [
    { name: 'עסלויה', name_en: 'Asaluyeh', category_slug: 'airstrike', lat: 27.4, lng: 52.7 },
    { name: 'טהרן', name_en: 'Tehran', category_slug: 'airstrike', lat: 35.7, lng: 51.4 },
    { name: 'אנטליה', name_en: 'Antalya', category_slug: 'statements', lat: 36.9, lng: 30.7 },
    { name: 'בלי תג', name_en: 'Untagged' },
  ];
  const out = mentionsOnly('statements', places);
  assert.ok(out, 'relabelled');
  assert.deepEqual(out!.map((p) => p.category_slug), ['statements', 'statements', 'statements', undefined]);
  // Nothing else about a place changes.
  assert.equal(out![0].lat, 27.4);
  assert.equal(out![0].name_en, 'Asaluyeh');
});

test('a statement whose places are already statements: nothing to do', () => {
  assert.equal(mentionsOnly('statements', [{ name: 'x', category_slug: 'statements' }, { name: 'y' }]), null);
});

test('other main types are split as before', () => {
  const places = [{ name: 'a', category_slug: 'airstrike' }, { name: 'b', category_slug: 'artillery-shelling' }];
  assert.equal(mentionsOnly('airstrike', places), null);
  assert.equal(mentionsOnly('political-event', places), null);
  assert.equal(mentionsOnly(null, places), null);
});
