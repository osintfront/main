// Run: node --experimental-strip-types --test tests/map/localizedTitle.test.ts
//
// Map pins show "category · headline" on hover. The headline must be in the reader's
// language: English readers saw the original Hebrew title (event.title) because the
// marker label skipped the translation that the feed cards and popups already use.
import test from 'node:test';
import assert from 'node:assert/strict';
import { localizedTitle, markerLabel } from '../../src/lib/localizedTitle.ts';
import type { PublicEvent } from '../../src/types/event.ts';

const event = {
  title: 'שתי תקיפות בחארת א-ראיס',
  translations: { en: { title: 'Two strikes in Haret al-Rais' }, he: { title: 'שתי תקיפות בחארת א-ראיס' } },
} as unknown as PublicEvent;

test('English reader gets the English title', () => {
  assert.equal(localizedTitle(event, 'en'), 'Two strikes in Haret al-Rais');
});

test('Hebrew reader gets the Hebrew title', () => {
  assert.equal(localizedTitle(event, 'he'), 'שתי תקיפות בחארת א-ראיס');
});

test('falls back to the stored title when there is no translation', () => {
  const untranslated = { title: 'כותרת', translations: {} } as unknown as PublicEvent;
  assert.equal(localizedTitle(untranslated, 'en'), 'כותרת');
});

test('marker label: headline only, or headline — place', () => {
  assert.equal(markerLabel(event, 'en'), 'Two strikes in Haret al-Rais');
  assert.equal(markerLabel(event, 'en', 'Haret al-Rais'), 'Two strikes in Haret al-Rais — Haret al-Rais');
});
