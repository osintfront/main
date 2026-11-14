// Run: node --experimental-strip-types --test tests/i18n/infoTips.test.ts
//
// Every (i) beside a map style, layer or sub-layer takes its text from the dictionaries under a key
// listed in src/lib/infoTips.ts. Each key must exist in both languages, short (≤ 160 characters),
// English without Hebrew letters and Hebrew with them. Every map style has its own tip.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { INFO_TIP_KEYS } from '../../src/lib/infoTips.ts';
import { en } from '../../src/i18n/en.ts';
import { he } from '../../src/i18n/he.ts';

const HEBREW = /[֐-׿]/;
const MAX = 160;
const dict = { en: en as Record<string, string>, he: he as Record<string, string> };

test('36 keys, no duplicates', () => {
  assert.equal(INFO_TIP_KEYS.length, 36);
  assert.equal(new Set(INFO_TIP_KEYS).size, INFO_TIP_KEYS.length);
});

for (const key of INFO_TIP_KEYS) {
  test(`${key}: both languages, non-empty, at most ${MAX} characters`, () => {
    for (const lang of ['en', 'he'] as const) {
      const v = dict[lang][key];
      assert.equal(typeof v, 'string', `${lang} missing ${key}`);
      assert.ok(v.trim().length > 0, `${lang} empty ${key}`);
      assert.ok(v.length <= MAX, `${lang} ${key} is ${v.length} characters`);
    }
    assert.ok(!HEBREW.test(dict.en[key]), `en ${key} has Hebrew letters`);
    assert.ok(HEBREW.test(dict.he[key]), `he ${key} has no Hebrew letters`);
  });
}

test('every map style has a tip', () => {
  // baseLayer.ts imports Leaflet, so the style list is read as text.
  const src = readFileSync('src/components/map/baseLayer.ts', 'utf8');
  const m = src.match(/export const BASE_STYLES = \[([^\]]*)\] as const/);
  assert.ok(m, 'BASE_STYLES not found');
  const styles = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  assert.equal(styles.length, 8);
  for (const s of styles) assert.ok((INFO_TIP_KEYS as readonly string[]).includes(`info.style.${s}`), `no tip for style ${s}`);
});
