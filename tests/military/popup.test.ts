// Run: node --experimental-strip-types --test tests/military/popup.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { flag, milName, militaryPopup, type MilProps } from '../../src/lib/military.ts';
import { isNotBuilt } from '../../src/lib/infra.ts';

const foreign: MilProps = { k: 'naval', cc: 'DJ', n: 'Camp Lemonnier', op: 'US', opn: 'United States Navy', f: true, osm: 'w123', km2: 2.4 };

test('flags from country codes', () => {
  assert.equal(flag('US'), '🇺🇸');
  assert.equal(flag('un'), '🇺🇳');
  assert.equal(flag(undefined), '');
  assert.equal(flag('u'), '');
});

test('names: Hebrew, then English, then local', () => {
  const p: MilProps = { k: 'base', cc: 'JO', n: 'معسكر', en: 'Camp X', he: 'מחנה X' };
  assert.equal(milName(p, 'he'), 'מחנה X');
  assert.equal(milName(p, 'en'), 'Camp X');
  assert.equal(milName({ k: 'base', cc: 'JO', n: 'معسكر' }, 'en'), 'معسكر');
  assert.equal(milName({ k: 'base', cc: 'JO' }, 'he'), null);
});

test('a foreign base: operator, flag, highlight, links and credit', () => {
  const h = militaryPopup(foreign, 'en', null, 11.547, 43.155);
  for (const s of ['Operated by', 'United States Navy', '🇺🇸', '#eab308', '© OpenStreetMap contributors', 'https://www.openstreetmap.org/way/123', '≈ 2.4 km²']) {
    assert.ok(h.includes(s), s);
  }
  assert.ok(!h.includes('Wikidata'));
  const w = militaryPopup({ ...foreign, wd: 'Q1' }, 'en', null, 11.547, 43.155);
  assert.ok(w.includes('https://www.wikidata.org/wiki/Q1') && w.includes('Wikidata'));
});

test('a host-operated base is not highlighted', () => {
  const h = militaryPopup({ k: 'base', cc: 'EG', n: 'Camp', op: 'EG', opn: 'Egyptian Army' }, 'en', null, 30, 31);
  assert.ok(h.includes('Operated by') && h.includes('Egyptian Army'));
  assert.ok(!h.includes('#eab308'));
});

test('an unnamed site without operator: no undefined, no NaN, a dash for size', () => {
  const h = militaryPopup({ k: 'range', cc: 'SY' }, 'en', null, 35.1, 36.2);
  assert.ok(h.includes('Unnamed site'));
  assert.ok(!h.includes('Operated by'));
  assert.ok(!/undefined|NaN|null/.test(h), h);
  assert.ok(h.includes('—'));
});

test('Hebrew popup is right-to-left with Hebrew labels and the town', () => {
  const h = militaryPopup(foreign, 'he', 'ג׳יבוטי', 11.547, 43.155);
  assert.ok(h.includes('dir="rtl"'));
  assert.ok(h.includes('בסיס ימי'));
  assert.ok(h.includes('מופעל על ידי'));
  assert.ok(h.includes('ליד ג׳יבוטי'));
});

test('a foreign air base is labelled as an air base', () => {
  assert.ok(militaryPopup({ k: 'base', cc: 'QA', en: 'Al Udeid Air Base', air: true, op: 'US', f: true }, 'en', null, 25.1, 51.3).includes('air base'));
});

test('markup in names is escaped', () => {
  const h = militaryPopup({ k: 'base', cc: 'IQ', n: '<b>&"x' }, 'en', null, 33, 44);
  assert.ok(h.includes('&lt;b&gt;&amp;&quot;x'));
  assert.ok(!h.includes('<b>&'));
});

test('coordinates with five decimals', () => {
  assert.ok(militaryPopup(foreign, 'en', null, 25.1172, 51.315).includes('25.11720, 51.31500'));
});

test('a missing file is "not built yet", other errors are not', () => {
  assert.equal(isNotBuilt(new Error('HTTP 404')), true);
  assert.equal(isNotBuilt(new Error('HTTP 500')), false);
  assert.equal(isNotBuilt('nope'), false);
});
