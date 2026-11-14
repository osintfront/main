// Run: node --experimental-strip-types --test tests/map/placeHe.test.ts
//
// Hebrew place names: the editor's Hebrew name is kept (location_name_he), and the Hebrew-letters
// fallback for Arabic-script names also handles Persian letters and common strait names.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hebrewPlaceName } from '../../supabase/functions/_shared/placeHe.ts';
import { arabicToHebrew, placeLabel } from '../../src/utils/places.ts';

test('editor Hebrew place name is picked (main name, else first Hebrew location)', () => {
  assert.equal(hebrewPlaceName({ location_name: 'מצר הורמוז (Strait of Hormuz)', locations: [] }), 'מצר הורמוז');
  assert.equal(hebrewPlaceName({ location_name: '', locations: [{ name: 'בנדר עבאס' }] }), 'בנדר עבאס');
  assert.equal(hebrewPlaceName({ location_name: 'Strait of Hormuz', locations: [{ name: 'تنگه هرمز' }] }), null);
  assert.equal(hebrewPlaceName({ location_name: '', locations: [] }), null);
});

test('Persian letters never leak into the Hebrew fallback', () => {
  const he = arabicToHebrew('تنگه هرمز');
  assert.equal(/[؀-ۿ]/.test(he), false, he);
  assert.equal(he, 'מצר הורמוז');
  assert.equal(arabicToHebrew('مضيق هرمز'), 'מצר הורמוז');
  assert.equal(/[؀-ۿ]/.test(arabicToHebrew('چابهار پیشوا ژاله کرج')), false);
});

test('Hebrew site shows the stored Hebrew name first', () => {
  assert.equal(placeLabel({ locationName: 'تنگه هرمز', locationNameHe: 'מצר הורמוז', locationNameEn: 'Strait of Hormuz' }, 'he'), 'מצר הורמוז');
});

test('both editor paths store the Hebrew place name', async () => {
  const { readFileSync } = await import('node:fs');
  for (const fn of ['whatsapp-ingest', 'event-agent']) {
    const src = readFileSync(`supabase/functions/${fn}/index.ts`, 'utf8');
    assert.match(src, /hebrewPlaceName\(/, fn);
    assert.match(src, /location_name_he: placeHe/, fn);
  }
});
