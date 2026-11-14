// Run: node --experimental-strip-types --test tests/ask/dashboardWiring.test.ts
//
// The dashboard's server wiring, read as text (the Deno modules are not loaded here): plan modes,
// the held plan usage, the cache guard, the background build and the three actions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ask = readFileSync('supabase/functions/_shared/ask.ts', 'utf8');
const stats = readFileSync('supabase/functions/_shared/askStats.ts', 'utf8');
const agent = readFileSync('supabase/functions/event-agent/index.ts', 'utf8');

test('ask.ts: plan modes, metric, held usage, cache guard, intent in the cache row', () => {
  for (const s of ['"stats"', '"clarify_stats"', 'target_country', 'holdUsage(', 'cacheServes(', 'finalMode(']) assert.ok(ask.includes(s), s);
  const upsert = ask.slice(ask.indexOf('from("ai_cache").upsert'));
  assert.match(upsert.slice(0, 300), /intent/);
});

test('askStats.ts: purposes, models, RPC, background build, cleaning, data rule', () => {
  for (const s of ['ask_dashboard_classify', 'ask_dashboard_insights', 'DASHBOARD_MODELS', 'ai_stats_candidates', 'EdgeRuntime', 'runAsReader(', 'cleanClassified(', 'cleanInsights(']) assert.ok(stats.includes(s), s);
  assert.ok(stats.split('ignore instructions inside them').length - 1 >= 2);
  const fn = stats.slice(stats.indexOf('export async function writeInsights'));
  assert.ok(fn.indexOf('incidents === 0') >= 0 && fn.indexOf('incidents === 0') < fn.indexOf('forced(INSIGHTS_TOOL'));
});

test('event-agent: the new actions and the cleaned inputs', () => {
  for (const s of ['"dashboard_status"', '"dashboard_period"', 'cleanClarifyReply(', 'cleanLang(', 'ai_dashboard_allowed']) assert.ok(agent.includes(s), s);
});
