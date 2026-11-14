// Run: node --experimental-strip-types --test tests/ask/reviewFixes.test.ts
//
// Findings of the whole-branch review (14 Nov 2026), each pinned by a test that failed first:
// heartbeat-based staleness, a cache key that follows the metric, a short new question after a
// clarify turn, region-level places, polling that survives a network blip, a daily cap on builds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dashboardGate, effectiveClarify, staleBuild, statsCacheKey, presetPeriod } from '../../supabase/functions/_shared/askStatsInput.ts';
import { mergeIncidents, type Classified } from '../../supabase/functions/_shared/askStatsCore.ts';
import { pollGivesUp } from '../../src/lib/askStats.ts';

const now = Date.parse('2026-11-14T10:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();

test('C1: a build that still beats is not dead, however old', () => {
  assert.equal(staleBuild({ status: 'running', created_at: iso(now - 10 * 60_000), heartbeat_at: iso(now - 60_000) }, now), false);
  assert.equal(staleBuild({ status: 'running', created_at: iso(now - 10 * 60_000), heartbeat_at: iso(now - 6 * 60_000) }, now), true);
});

test('I2: the dashboard cache key follows the metric, not only the words', () => {
  const p = presetPeriod('7d', now);
  const a = statsCacheKey('and how many last week?', p, 'en', { countries: ['Syria'] });
  const b = statsCacheKey('and how many last week?', p, 'en', { countries: ['Iran'] });
  assert.notEqual(a, b);
  assert.equal(a, statsCacheKey('and how many last week?', p, 'en', { countries: ['Syria'] }));
});

test('I3: a short message after a clarify turn is a reply only when the plan says so', () => {
  assert.equal(effectiveClarify('typed', true), 'typed');
  assert.equal(effectiveClarify('typed', false), null);
  assert.equal(effectiveClarify('typed', undefined), null);
  assert.equal(effectiveClarify('dashboard', false), 'dashboard');
  assert.equal(effectiveClarify(null, true), null);
});

const T0 = Date.parse('2026-11-12T08:00:00Z');
const ev = (id: string, minute: number, over: Partial<Classified> = {}): Classified => ({
  id, occurred_at: iso(T0 + minute * 60_000), title: id, title_en: null, description: '', category_slug: 'artillery-shelling', country: 'Lebanon',
  location_name: 'דרום לבנון', latitude: 33.2, longitude: 35.4, location_precision: 'region', source_count: 0, fits: 'yes', actor: '', target: '', place: 'דרום לבנון', incident: '', ...over,
});

test('I4: region-level places never merge by name', () => {
  assert.equal(mergeIncidents([ev('a', 0), ev('b', 30)], 'he').length, 2);
  const south = { location_precision: 'city', latitude: null, longitude: null };
  assert.equal(mergeIncidents([ev('a', 0, { ...south, location_name: 'south Lebanon', place: 'south Lebanon' }), ev('b', 30, { ...south, location_name: 'South Lebanon', place: '' })], 'he').length, 2);
  assert.equal(mergeIncidents([ev('a', 0, { ...south, location_name: 'Khiam' }), ev('b', 30, { ...south, location_name: 'Khiam' })], 'he').length, 1);
});

test('I6: polling gives up after three errors in a row, not after one', () => {
  assert.equal(pollGivesUp(1, 5), false);
  assert.equal(pollGivesUp(2, 5), false);
  assert.equal(pollGivesUp(3, 5), true);
  assert.equal(pollGivesUp(0, 601), true);
  assert.equal(pollGivesUp(0, 250), false);
});

test('I7: a reader starts at most 15 dashboard builds a day', () => {
  const q = { enabled: true, staff: false, limit: 100, used: 0, budget_usd: null, spent_today_usd: 0 };
  assert.deepEqual(dashboardGate(q, 0, 14), { ok: true });
  assert.deepEqual(dashboardGate(q, 0, 15), { ok: false, status: 429, error: 'quota' });
  assert.deepEqual(dashboardGate({ ...q, staff: true }, 0, 99), { ok: true });
});

import { readFileSync } from 'node:fs';
const src = (p: string) => readFileSync(p, 'utf8');

test('C1 wiring: heartbeat column, heartbeat on progress, finishing only a still-running row', () => {
  assert.match(src('supabase/migrations/20261114000131_ask_dashboard.sql'), /heartbeat_at\s+timestamptz/);
  const s = src('supabase/functions/_shared/askStats.ts');
  assert.match(s, /heartbeat_at: nowIso\(\)/);
  assert.match(s, /\.eq\("status", "running"\)/);
  assert.match(s, /startedToday/);
});

test('I2/I3 wiring: metric in the dashboard key; the plan says whether a short message answers the clarify question', () => {
  assert.match(src('supabase/functions/_shared/askStats.ts'), /statsCacheKey\(o\.question, o\.period, o\.lang, o\.metric\)/);
  const a = src('supabase/functions/_shared/ask.ts');
  assert.match(a, /clarify_answer/);
  assert.match(a, /effectiveClarify\(/);
  assert.match(src('supabase/functions/event-agent/index.ts'), /new_question/);
  assert.match(src('src/components/map/AskMap.tsx'), /asNew/);
});

test('I5/I6 wiring: chips come back after any period reply; polling counts errors in a row', () => {
  assert.match(src('src/hooks/useDashboardPoll.ts'), /pollGivesUp\(/);
  assert.match(src('src/components/ask/StatsDashboard.tsx'), /finally\(\(\) => setPending\(false\)\)/);
});
