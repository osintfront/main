// Run: node --experimental-strip-types --test tests/map/pinTarget.test.ts
//
// Phones have no pin popups: a tap opens the event card, and its "Move" button edits a pin.
// It always edited the event's main pin, so with several pins of one event on the map, moving
// or deleting the pin that was tapped changed a different one. The card must act on the pin
// that was tapped (its place index), and fall back to the main pin only when the card was
// opened some other way (feed, link, another event).
import test from 'node:test';
import assert from 'node:assert/strict';
import { pinTarget } from '../../src/lib/pinTarget.ts';

test('tapped a further place of the event: that place is edited', () => {
  assert.deepEqual(pinTarget('ev1', { id: 'ev1', place: 2 }), { id: 'ev1', place: 2 });
});

test('tapped the main pin: the main pin is edited', () => {
  assert.deepEqual(pinTarget('ev1', { id: 'ev1', place: null }), { id: 'ev1', place: null });
});

test('card opened from the feed or a link (no tap): the main pin', () => {
  assert.deepEqual(pinTarget('ev1', null), { id: 'ev1', place: null });
});

test('the last tap was on another event: the main pin of this one', () => {
  assert.deepEqual(pinTarget('ev1', { id: 'ev2', place: 3 }), { id: 'ev1', place: null });
});
