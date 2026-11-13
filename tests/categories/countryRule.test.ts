// Run: node --experimental-strip-types --test tests/categories/countryRule.test.ts
// The event's country is where it happened (the pin), not the attacker's: an Israeli strike in Gaza → Palestine.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { COUNTRY_RULE, COUNTRY_RULE_HE } from '../../supabase/functions/_shared/countryRule.ts';

const read = (p: string) => readFileSync(`supabase/functions/${p}`, 'utf8');

test('the rule names the cases', () => {
  for (const w of ['where it happened', 'not the attacker', 'Palestine', 'statement']) assert.ok(COUNTRY_RULE.includes(w), w);
  for (const w of ['פלסטין', 'התוקף', 'הצהרה']) assert.ok(COUNTRY_RULE_HE.includes(w), w);
});

test('triage and the editor both use it', () => {
  assert.ok(read('whatsapp-ingest/index.ts').includes('COUNTRY_RULE'));
  const ed = read('_shared/editor.ts');
  assert.ok(ed.includes('COUNTRY_RULE_HE'), 'editor system prompt');
  assert.ok(ed.includes('COUNTRY_RULE}') || ed.includes('${COUNTRY_RULE'), 'editor tool field');
  assert.ok(!/Main country the report is about/.test(ed + read('whatsapp-ingest/index.ts')), 'old wording gone');
});
