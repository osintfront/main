// Run: node --experimental-strip-types --test tests/ask/dashboardSql.test.ts
//
// Migrations 129/130 of the statistics dashboard, read as text: the repo rule (no drop / delete in
// 129 or its SQL test), the plan rows, the one-running-build index and the fixed 3-credit charge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const m129 = readFileSync('supabase/migrations/20261114000131_ask_dashboard.sql', 'utf8');
const m130 = readFileSync('supabase/migrations/20261114000132_ask_dashboard_cleanup.sql', 'utf8');
const sqlTest = readFileSync('supabase/tests/ask_dashboard.sql', 'utf8');

test('129 and its SQL test contain no drop / delete', () => {
  assert.doesNotMatch(m129, /\b(drop|delete)\b/i);
  assert.doesNotMatch(sqlTest, /\b(drop|delete)\b/i);
});

test('130 trims rows after 30 days with a named daily job', () => {
  assert.match(m130, /interval '30 days'/);
  assert.match(m130, /osintfront-ai-dashboards-trim/);
});

test('129 adds the five plan rows', () => {
  for (const [plan, on] of [['guest', 'false'], ['free', 'false'], ['pro', 'false'], ['max', 'true'], ['intel', 'true']]) {
    assert.match(m129, new RegExp(`\\('ai_dashboard',\\s*'${plan}',\\s*${on},\\s*null`));
  }
});

test('129 allows one running build per user', () => {
  assert.match(m129, /create unique index[^;]*where status = 'running'/i);
});

test('129 charges a fixed 3 credits and leaves dashboard model rows out of used', () => {
  assert.match(m129, /starts_with\(purpose, 'ask_dashboard_'\)/);
  assert.match(m129, /3 \* \(select count\(\*\)/);
});

test('129 closes the table and the service-role functions', () => {
  assert.match(m129, /enable row level security/i);
  assert.match(m129, /revoke all on public\.ai_dashboards from anon, authenticated/);
  assert.match(m129, /revoke[^;]*ai_stats_candidates[^;]*;/s);
  assert.match(m129, /revoke[^;]*ai_dashboard_allowed[^;]*;/s);
});

test('129 ai_quota still builds every key', () => {
  const fn = m129.slice(m129.indexOf('function public.ai_quota'));
  for (const k of ['enabled', 'staff', 'plan', 'limit', 'used', 'budget_usd', 'spent_today_usd']) {
    assert.match(fn, new RegExp(`'${k}'`));
  }
});
