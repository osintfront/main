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

test('guests get the event marks too (locked links on the headline)', () => {
  const m = readFileSync('supabase/migrations/20261113000112_deep_analysis.sql', 'utf8');
  const body = m.slice(m.indexOf('function public.event_terms_for'), m.indexOf('function public.deep_entry('));
  assert.ok(!body.includes("my_feature('event_summary')"));
});

test('event-agent expires a dead write and re-checks after the claim', () => {
  const s = read('event-agent/index.ts');
  assert.ok(s.includes('staleJob('));
  assert.ok(s.includes('overAfterClaim('));
});

test('the cron secret may also refresh an entry (internal checks)', () => {
  assert.ok(read('event-agent/index.ts').includes('(action === "deep_refresh" || (action === "deep_write" && typeof body?.text === "string")) && await cronOk(req)'));
});
