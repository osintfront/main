// Run: node --experimental-strip-types --test tests/deep/editorWiring.test.ts
//
// The editor returns term marks in the call it already makes (models and token limits unchanged),
// and every writer stores them. Text checks: these files run on Deno with remote imports.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p: string) => readFileSync(`supabase/functions/${p}`, 'utf8');

test('editor wiring', () => {
  const s = read('_shared/editor.ts');
  for (const w of ['props.terms = TERMS_PROP', 'TERM_RULES', 'cleanTerms(raw.terms', 'max_tokens: 4500', 'claude-sonnet-5-5', 'claude-haiku-5-5']) assert.ok(s.includes(w), w);
});

test('writers store the marks', () => {
  for (const f of ['whatsapp-ingest/index.ts', 'intel-crawler/index.ts', 'event-agent/index.ts']) assert.ok(read(f).includes('saveEventTerms('), f);
});
