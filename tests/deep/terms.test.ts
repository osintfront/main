// Run: node --experimental-strip-types --test tests/deep/terms.test.ts
//
// Deep analysis, server side: the marks the editor returns for every event (people, weapons,
// organisations, places, terms) are cleaned here before they are stored.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TERM_KINDS, TERM_RULES, TERMS_PROP, cleanTerms, normTerm } from '../../supabase/functions/_shared/terms.ts';

const texts = { he: 'טד קרוז: הנשיא יסיים את המלחמה', en: 'Ted Cruz: the president will end the war' };

test('normTerm', () => {
  assert.equal(normTerm('  Ted   CRUZ '), 'ted cruz');
  assert.equal(normTerm('Heron–TP'), 'heron-tp');
  assert.equal(normTerm('מל״ט'), normTerm('מל"ט'));
  assert.equal(normTerm('חִיזְבַּאלְלָה'), 'חיזבאללה');
  assert.equal(normTerm('أحمد'), 'احمد');
  assert.equal(normTerm('"Radwan Force".'), 'radwan force');
  assert.equal(normTerm(null), '');
  assert.equal(normTerm('x'.repeat(200)).length, 80);
});

test('a valid mark keeps the casing of the text', () => {
  const out = cleanTerms([{ he: 'טד קרוז', en: 'ted cruz', name: 'Ted Cruz', kind: 'person' }], texts);
  assert.equal(out.length, 1);
  assert.equal(out[0].key, 'ted cruz');
  assert.equal(out[0].en, 'Ted Cruz');
  assert.deepEqual(out[0].keys, ['ted cruz', 'טד קרוז']);
});

test('bad marks are dropped; one language is enough', () => {
  assert.deepEqual(cleanTerms([{ he: 'טד קרוז', name: 'Ted Cruz', kind: 'animal' }], texts), []);
  assert.deepEqual(cleanTerms([{ he: 'טד קרוז', name: '', kind: 'person' }], texts), []);
  assert.deepEqual(cleanTerms([{ he: 'נתניהו', en: 'Netanyahu', name: 'Netanyahu', kind: 'person' }], texts), []);
  const [m] = cleanTerms([{ he: 'נתניהו', en: 'Ted Cruz', name: 'Ted Cruz', kind: 'person' }], texts);
  assert.equal(m.he, '');
  assert.equal(m.en, 'Ted Cruz');
});

test('limits, duplicates, rubbish', () => {
  const t = { he: '', en: 'a1 a2 a3 a4 a5 a6 a7 Hezbollah' };
  const seven = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7'].map((x) => ({ en: x, name: `Name ${x}`, kind: 'term' }));
  assert.equal(cleanTerms(seven, t).length, 6);
  assert.equal(cleanTerms([{ en: 'Hezbollah', name: 'Hezbollah', kind: 'org' }, { en: 'Hezbollah', name: 'hezbollah ', kind: 'org' }], t).length, 1);
  for (const v of ['x', null, [null, 5, {}]]) assert.deepEqual(cleanTerms(v, texts), []);
});

test('tool property and rules', () => {
  const p = JSON.stringify(TERMS_PROP);
  for (const k of TERM_KINDS) assert.ok(p.includes(k), k);
  for (const w of ['public role', 'never', 'private', 'exactly as written']) assert.ok(TERM_RULES.includes(w), w);
});
